import { GoogleGenAI, Type } from '@google/genai';
import { getCurrentTimeContext, formatMeetingTime } from '../utils/datetime.js';

let aiInstance = null;

function getAiClient() {
  if (!aiInstance) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not defined in environment variables');
    }
    aiInstance = new GoogleGenAI({ apiKey });
  }
  return aiInstance;
}

/**
 * Memeriksa apakah fitur Gemini AI diaktifkan.
 * @returns {boolean}
 */
export function isGeminiEnabled() {
  return process.env.USE_GEMINI_AI === 'true' && Boolean(process.env.GEMINI_API_KEY);
}

/**
 * Menganalisis pesan teks dari pengguna WhatsApp menggunakan Gemini API.
 * Mengekstrak intent, waktu/tanggal meeting, durasi, topik, dan kebutuhan info tambahan.
 * Dilengkapi batas waktu (timeout) 6 detik agar tidak memperlambat respon bot.
 * 
 * @param {string} userMessage - Pesan chat dari pengguna WhatsApp
 * @param {string} senderName - Nama pengirim jika tersedia
 * @param {number} timeoutMs - Batas maksimal tunggu (default 6000 ms)
 * @returns {Promise<{
 *   intent: 'CREATE_MEETING' | 'OTHER',
 *   platform: 'ZOOM' | 'GMEET',
 *   topic: string,
 *   startTime: string | null,
 *   durationMinutes: number,
 *   needsMoreInfo: boolean,
 *   replyMessage: string
 * }|null>}
 */
/**
 * Memformat daftar arsip notula & action items meeting terbaru menjadi konteks teks ringkas untuk Gemini AI.
 */
function formatArchivesForPrompt(archives = [], maxEntries = 3) {
  if (!Array.isArray(archives) || archives.length === 0) return '';

  return archives.slice(0, maxEntries).map((a, idx) => {
    const waktu = formatMeetingTime(a.startTime);
    const pesertaList = Array.isArray(a.participants) && a.participants.length > 0
      ? `${a.participants.length} orang (${a.participants.slice(0, 25).join(', ')}${a.participants.length > 25 ? ', ...' : ''})`
      : 'Tidak tercatat';

    const detailLines = Array.isArray(a.summaryDetails) && a.summaryDetails.length > 0
      ? a.summaryDetails.map(d => `   - ${d.label ? `[${d.label}] ` : ''}${d.summary}`).join('\n')
      : '';

    let followUpLines = '';
    if (Array.isArray(a.actionItems) && a.actionItems.length > 0) {
      followUpLines = a.actionItems.map((it, i) =>
        `   ${i + 1}. [${it.prioritas || 'Medium'} | Target: ${it.target_deadline || 'IN PROGRESS'} | Status: ${it.status || 'On Progress'}] ${it.kapal_proyek ? `*${it.kapal_proyek}* - ` : ''}${it.isu_rangkuman} (PIC: ${it.pic || '-'})`
      ).join('\n');
    } else if (Array.isArray(a.nextSteps) && a.nextSteps.length > 0) {
      followUpLines = a.nextSteps.map((s, i) => `   ${i + 1}. ${s}`).join('\n');
    }

    return [
      `[ARSIP RAPAT #${idx + 1}]`,
      `- Tanggal (WIB): ${a.dateWib || '-'} | Waktu: ${waktu} | Durasi: ${a.duration || 0} Menit`,
      `- Topik: ${a.topic || '-'} | Platform: ${a.platform || 'ZOOM'} | ID: ${a.id}`,
      `- Peserta Hadir: ${pesertaList}`,
      a.summaryOverview ? `- Ringkasan Utama: ${a.summaryOverview}` : '',
      detailLines ? `- Detail Pembahasan:\n${detailLines}` : '',
      followUpLines ? `- Daftar Follow-Up / Action Items:\n${followUpLines}` : ''
    ].filter(Boolean).join('\n');
  }).join('\n\n');
}

export async function extractMeetingDetails(userMessage, senderName = '', { quotedText = '', activeMeetings = [], recentArchives = [], recentHistory = [] } = {}, timeoutMs = 15000) {
  if (!isGeminiEnabled()) return null;

  const ai = getAiClient();
  const modelName = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  const timeContext = getCurrentTimeContext();

  // Susun ringkasan jadwal rapat aktif agar AI bisa menjawab pertanyaan seputar jadwal rapat
  const meetingsSummary = (activeMeetings || []).map((m, idx) => {
    const formatted = formatMeetingTime(m.startTime);
    const requester = m.requesterPhone ? m.requesterPhone.split('@')[0] : 'Tidak tercatat';
    return `${idx + 1}. Topik: "${m.topic}", Platform: ${m.platform || 'ZOOM'}, Waktu: ${formatted}, Durasi: ${m.duration || 60} Menit, Nomor Pembuat: +${requester}, ID Meeting: ${m.id}, Link Join: ${m.joinUrl || '-'}${m.passcode ? `, Passcode: ${m.passcode}` : ''}`;
  }).join('\n');

  const archivesText = formatArchivesForPrompt(recentArchives, 2);
  const historyText = Array.isArray(recentHistory) && recentHistory.length > 0
    ? recentHistory.map(h => `- ${h.role === 'bot' ? 'Bot' : (h.sender || 'User')}: ${String(h.text || '').slice(0, 250)}`).join('\n')
    : '';

  const systemInstruction = `
Kamu adalah Asisten Eksekutif Cerdas WhatsApp untuk penjadwalan meeting (Zoom Meeting & Google Meet).
Waktu lokal saat ini: ${timeContext.localString}
Timezone: ${timeContext.timezone}
ISO Waktu Saat Ini: ${timeContext.isoString}

Daftar Jadwal Rapat yang Terdaftar di Sistem Saat Ini:
${meetingsSummary || '(Belum ada jadwal meeting yang terdaftar)'}

Gaya Bahasa:
- Sangat sopan, ramah, formal, profesional, dan solutif (standar asisten eksekutif).
- Gunakan sapaan Bapak/Ibu atau nama pengguna jika tersedia.

Panduan Tugas:
1. Jika pengguna berniat MEMBUAT/MENJADWALKAN meeting baru:
   - Set "intent" = "CREATE_MEETING".
   - Ekstrak "platform": "ZOOM" atau "GMEET" (default "ZOOM" jika tidak spesifik).
   - Ekstrak "topic": Judul/agenda meeting (contoh: "Diskusi Proyek Web", default: "Meeting").
   - Ekstrak "startTime": Hitung tanggal dan jam berdasarkan kata relatif (contoh: "jam 2 siang", "besok jam 10 pagi"). Konversikan ke format ISO 8601 lengkap dengan offset timezone.
   - Ekstrak "durationMinutes": Durasi meeting dalam menit (default: 60 menit).
   - Jika pengguna ingin membuat meeting tapi belum menyebutkan waktu sama sekali:
     - Set "needsMoreInfo" = true.
     - Tuliskan "replyMessage" yang ramah menanyakan kapan waktu yang diinginkan Bapak/Ibu.

2. Jika pengguna BERTANYA seputar jadwal rapat, siapa pembuat rapat, agenda jam tertentu, merespon/mengomentari pesan sebelumnya, atau percakapan umum:
   - Set "intent" = "OTHER".
   - Set "needsMoreInfo" = false.
   - Jawab pertanyaan pengguna secara cerdas, tepat, informatif, dan ringkas di dalam "replyMessage" dengan mengacu pada:
     a) Daftar jadwal rapat terdaftar di atas (misal siapa pembuatnya, jam berapa, apa topiknya, berapa lama durasinya).
     b) Pesan yang dikutip/dibalas (jika ada).
   - Contoh: Jika pengguna bertanya "jam 13 itu siapa yang buat dan buat apa?", periksa daftar jadwal di atas pada jam 13.00, lalu jawab dengan menyebutkan nama topik agendanya dan nomor pembuatnya dengan sopan.
   - Jika pengguna bertanya tentang solusi atau alternatif saat akun Zoom utama penuh / bentrok:
     Jelaskan bahwa ada 2 alternatif solusi:
     1) Google Meet: Tanpa batasan 40 menit, resmi dan dibuatkan otomatis oleh bot jika pengguna mengetik "buatkan gmeet sekarang".
     2) Akun Zoom Cadangan / Gratisan: Bisa digunakan jika tetap ingin Zoom (maksimal 40 menit per sesi, pengguna cukup mengetik "zoom gratisan" untuk mendapatkan link).
   - Jika pengguna bertanya tentang notula rapat, rekap kehadiran, B15M, atau ekspor file Excel (.xlsx):
     Ketahuilah bahwa sistem BOT SUDAH MEMILIKI fitur otomatis penyusunan Notula & File Excel (.xlsx) khusus rapat pagi B15M (jam 08:00 WIB atau judul B15M). JANGAN pernah menjawab bahwa fitur Excel belum tersedia! Arahkan pengguna mengetik "rekap b15m" atau "notula excel" untuk meminta ulang file Excel hari ini.
   - Jika pengguna bertanya tentang isi pembahasan meeting sebelumnya/tadi, siapa yang hadir, atau daftar follow-up/tindak lanjut saat ini:
     Gunakan HANYA data di bagian "ARSIP NOTULA & FOLLOW-UP RAPAT TERKINI" di bawah jika tersedia, dan jawab dengan poin-poin rapi (nama PIC, proyek/kapal, prioritas, deadline). Jika di arsip tidak ditemukan, sampaikan dengan jujur.
   - Jika pengguna hanya menyapa atau bertanya hal lain, jawab dengan ramah dan jelaskan bantuan yang dapat Anda berikan sebagai asisten penjadwalan.
${archivesText ? `\nARSIP NOTULA & FOLLOW-UP RAPAT TERKINI:\n${archivesText}` : ''}
${historyText ? `\nRIWAYAT PERCAKAPAN TERAKHIR DI CHAT INI:\n${historyText}` : ''}
`.trim();

  let userContent = `Pesan dari pengguna ${senderName ? `(${senderName})` : ''}: "${userMessage}"`;
  if (quotedText) {
    userContent = `[Konteks Pesan yang Dikutip/Dibalas]:\n"${quotedText}"\n\n` + userContent;
  }

  const callPromise = (async () => {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: userContent,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            intent: {
              type: Type.STRING,
              enum: ['CREATE_MEETING', 'OTHER'],
              description: 'Niat pengguna apakah ingin membuat meeting atau hal lain'
            },
            platform: {
              type: Type.STRING,
              enum: ['ZOOM', 'GMEET'],
              description: 'Platform meeting: ZOOM atau GMEET'
            },
            topic: {
              type: Type.STRING,
              description: 'Topik atau judul meeting'
            },
            startTime: {
              type: Type.STRING,
              description: 'Waktu mulai meeting dalam format ISO 8601 (misal 2026-09-08T14:00:00+07:00), atau null jika belum ada'
            },
            durationMinutes: {
              type: Type.INTEGER,
              description: 'Perkiraan durasi meeting dalam menit (default 60 jika tidak disebutkan)'
            },
            needsMoreInfo: {
              type: Type.BOOLEAN,
              description: 'True jika waktu meeting belum jelas atau perlu konfirmasi pengguna'
            },
            replyMessage: {
              type: Type.STRING,
              description: 'Pesan balasan formal ke pengguna WhatsApp'
            }
          },
          required: ['intent', 'platform', 'topic', 'durationMinutes', 'needsMoreInfo', 'replyMessage']
        }
      }
    });

    const text = response.text?.trim() || '{}';
    const parsed = JSON.parse(text);

    return {
      intent: parsed.intent || 'OTHER',
      platform: parsed.platform || 'ZOOM',
      topic: parsed.topic || (parsed.platform === 'GMEET' ? 'Google Meet' : 'Zoom Meeting'),
      startTime: parsed.startTime || null,
      durationMinutes: parsed.durationMinutes || Number(process.env.DEFAULT_MEETING_DURATION) || 60,
      needsMoreInfo: Boolean(parsed.needsMoreInfo),
      replyMessage: parsed.replyMessage || 'Halo! Saya asisten bot pembuat link Zoom & Google Meet otomatis.'
    };
  })();

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Gemini API timeout (${timeoutMs}ms)`)), timeoutMs)
  );

  try {
    return await Promise.race([callPromise, timeoutPromise]);
  } catch (error) {
    console.warn(`⚠️ Gemini API fallback warning (${error.message}). Melanjutkan tanpa AI.`);
    return null;
  }
}

/**
 * Mentranskripsikan pesan suara (Voice Note) WhatsApp menjadi teks bahasa Indonesia
 * menggunakan multimodal audio understanding dari Google Gemini API.
 * 
 * @param {Buffer} audioBuffer
 * @param {string} mimeType
 * @param {string} senderName
 * @param {number} timeoutMs
 * @returns {Promise<string|null>}
 */
export async function transcribeAudio(audioBuffer, mimeType = 'audio/ogg', senderName = '', timeoutMs = 15000) {
  if (!isGeminiEnabled() || !audioBuffer) return null;

  const ai = getAiClient();
  const modelName = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  const cleanMime = mimeType ? mimeType.split(';')[0].trim() : 'audio/ogg';

  const callPromise = (async () => {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: cleanMime,
                data: audioBuffer.toString('base64')
              }
            },
            {
              text: 'Dengarkan pesan suara berikut dan transkripsikan seluruh isi ucapannya secara akurat ke dalam teks bahasa Indonesia. Berikan HANYA teks murni hasil transkripsinya saja tanpa tanda kutip, tanpa penjelasan, dan tanpa komentar pembuka/penutup.'
            }
          ]
        }
      ]
    });

    const text = response.text?.trim() || '';
    return text.replace(/^["'`]+|["'`]+$/g, '').trim();
  })();

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Gemini Audio Transcription timeout (${timeoutMs}ms)`)), timeoutMs)
  );

  try {
    return await Promise.race([callPromise, timeoutPromise]);
  } catch (error) {
    console.warn(`⚠️ Gagal transkripsi pesan suara Gemini: ${error.message}`);
    return null;
  }
}

/**
 * Menganalisis pesan audio / voice note (VN) dari WhatsApp menggunakan Gemini API.
 * Mentranskripsikan audio dan mengekstrak perintah meeting secara langsung.
 * 
 * @param {Buffer} audioBuffer
 * @param {string} mimeType
 * @param {string} senderName
 * @param {number} timeoutMs
 */
export async function extractMeetingFromAudio(audioBuffer, mimeType = 'audio/ogg', senderName = '', timeoutMs = 15000) {
  if (!isGeminiEnabled() || !audioBuffer) return null;

  const ai = getAiClient();
  const modelName = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  const timeContext = getCurrentTimeContext();

  // Bersihkan mimeType (hilangkan parameter codecs jika ada agar diterima Gemini)
  const cleanMime = mimeType ? mimeType.split(';')[0].trim() : 'audio/ogg';

  const systemInstruction = `
Kamu adalah asisten eksekutif cerdas WhatsApp yang bertugas memproses pesan suara (Voice Note) pengguna untuk penjadwalan pertemuan online (Zoom Meeting atau Google Meet).
Waktu lokal saat ini: ${timeContext.localString}
Timezone: ${timeContext.timezone}
ISO Waktu Saat Ini: ${timeContext.isoString}

Tugas:
1. Dengarkan dan transkrip pesan suara pengguna secara akurat dalam bahasa Indonesia.
2. Analisis niat pengguna apakah ingin membuat meeting (CREATE_MEETING) atau hal lain (OTHER).
3. Jika membuat meeting:
   - Tentukan platform: "ZOOM" atau "GMEET" (default "ZOOM" jika tidak spesifik).
   - Ekstrak topik/agenda meeting.
   - Hitung tanggal & jam mulai (startTime) dalam ISO 8601 lengkap dengan offset timezone.
   - Ekstrak durasi (durationMinutes, default 60 menit).
   - needsMoreInfo = true jika waktu meeting belum jelas dalam rekaman suara.
`.trim();

  const callPromise = (async () => {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: cleanMime,
                data: audioBuffer.toString('base64')
              }
            },
            {
              text: `Pesan suara masuk dari pengguna ${senderName ? `(${senderName})` : ''}. Silakan transkripsikan dan analisis jadwal meetingnya.`
            }
          ]
        }
      ],
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            transcription: {
              type: Type.STRING,
              description: 'Teks transkripsi lengkap dari pesan suara'
            },
            intent: {
              type: Type.STRING,
              enum: ['CREATE_MEETING', 'OTHER'],
              description: 'Niat pengguna apakah ingin membuat meeting atau hal lain'
            },
            platform: {
              type: Type.STRING,
              enum: ['ZOOM', 'GMEET'],
              description: 'Platform meeting: ZOOM atau GMEET'
            },
            topic: {
              type: Type.STRING,
              description: 'Topik atau judul meeting'
            },
            startTime: {
              type: Type.STRING,
              description: 'Waktu mulai meeting dalam format ISO 8601, atau null jika belum ada'
            },
            durationMinutes: {
              type: Type.INTEGER,
              description: 'Perkiraan durasi meeting dalam menit'
            },
            needsMoreInfo: {
              type: Type.BOOLEAN,
              description: 'True jika waktu meeting belum jelas'
            },
            replyMessage: {
              type: Type.STRING,
              description: 'Pesan balasan formal ke pengguna WhatsApp'
            }
          },
          required: ['transcription', 'intent', 'platform', 'topic', 'durationMinutes', 'needsMoreInfo', 'replyMessage']
        }
      }
    });

    const text = response.text?.trim() || '{}';
    const parsed = JSON.parse(text);

    return {
      transcription: parsed.transcription || '',
      intent: parsed.intent || 'OTHER',
      platform: parsed.platform || 'ZOOM',
      topic: parsed.topic || (parsed.platform === 'GMEET' ? 'Google Meet' : 'Zoom Meeting'),
      startTime: parsed.startTime || null,
      durationMinutes: parsed.durationMinutes || Number(process.env.DEFAULT_MEETING_DURATION) || 60,
      needsMoreInfo: Boolean(parsed.needsMoreInfo),
      replyMessage: parsed.replyMessage || 'Pesan suara telah diterima.'
    };
  })();

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Gemini Audio API timeout (${timeoutMs}ms)`)), timeoutMs)
  );

  try {
    return await Promise.race([callPromise, timeoutPromise]);
  } catch (error) {
    console.warn(`⚠️ Gemini Audio processing warning (${error.message}).`);
    return null;
  }
}

/**
 * Menjawab pertanyaan pengguna seputar isi pembahasan rapat & daftar follow-up saat ini
 * berdasarkan arsip notula AI (Zoom / Google Meet) dan action items B15M.
 *
 * @param {string} questionText
 * @param {Array<object>} archives
 * @param {object} options
 * @param {number} timeoutMs
 * @returns {Promise<string|null>}
 */
export async function answerMeetingQuestion(
  questionText,
  archives = [],
  { senderName = '', activeMeetings = [], quotedText = '' } = {},
  timeoutMs = 15000
) {
  if (!isGeminiEnabled() || !Array.isArray(archives) || archives.length === 0) {
    return null;
  }

  const ai = getAiClient();
  const modelName = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  const timeContext = getCurrentTimeContext();
  const archivesText = formatArchivesForPrompt(archives, 3);

  const meetingsSummary = (activeMeetings || []).slice(0, 5).map((m, idx) => {
    const formatted = formatMeetingTime(m.startTime);
    return `${idx + 1}. "${m.topic}" (${formatted})`;
  }).join('\n');

  const prompt = `Kamu adalah Asisten Notula & Operasional Rapat WhatsApp (BOT AI ZOOM - Seven Oceans).
Waktu saat ini: ${timeContext.localString} (Tanggal WIB: ${timeContext.todayDate}).
Penanya: ${senderName || 'Bapak/Ibu'}.
${quotedText ? `Pesan yang dikutip penanya: "${quotedText}"\n` : ''}
DATA ARSIP NOTULA & TINDAK LANJUT RAPAT:
${archivesText}
${meetingsSummary ? `\nJADWAL MEETING TERDAFTAR HARI INI/TERDEKAT:\n${meetingsSummary}\n` : ''}
PERTANYAAN PENGGUNA:
"${questionText}"

ATURAN MENJAWAB:
1. Jawab HANYA berdasarkan fakta di DATA ARSIP di atas. JANGAN mengarang topik, kapal, atau PIC yang tidak tertulis di data.
2. Gunakan format WhatsApp ASLI yang rapi: pakai satu tanda bintang (*tebal*) dan _miring_. JANGAN memakai tanda ** (dua bintang) maupun heading ### markdown!
3. Sebutkan tanggal & jam rapat yang dirujuk agar jelas.
4. Jika pengguna menanyakan topik pembahasan ("bahas apa saja"), rangkum poin utama pembahasan per topik dengan bullet points.
5. Jika pengguna menanyakan follow-up / tindak lanjut ("yang di follow up sekarang apa"), kelompokkan atau urutkan mulai dari prioritas tertinggi (*URGENT* / *HIGH* / tenggat *Hari Ini* atau jam terdekat), sebutkan tugas + nama *PIC* + *kapal/proyek*-nya.
6. Jika pengguna menanyakan PIC, kapal, atau kehadiran tertentu, jawab spesifik sesuai data peserta / action items.
7. Di bagian paling bawah boleh tambahkan 1 baris tips singkat: _"💡 Ketik *rekap b15m* atau *notula excel* jika ingin mengunduh file Excel lengkapnya."_
8. Jika data untuk tanggal/topik yang diminta belum ada di arsip, jelaskan dengan jujur data mana yang saat ini tersedia.`;

  const callPromise = (async () => {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: prompt
    });
    const txt = (response.text || '').trim();
    return txt || null;
  })();

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Gemini QA timeout (${timeoutMs}ms)`)), timeoutMs)
  );

  try {
    return await Promise.race([callPromise, timeoutPromise]);
  } catch (error) {
    console.warn(`⚠️ Gemini Meeting Q&A warning (${error.message}):`, error.message);
    return null;
  }
}


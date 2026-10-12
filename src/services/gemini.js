import { GoogleGenAI, Type } from '@google/genai';
import { getCurrentTimeContext } from '../utils/datetime.js';

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
export async function extractMeetingDetails(userMessage, senderName = '', timeoutMs = 6000) {
  if (!isGeminiEnabled()) return null;

  const ai = getAiClient();
  const modelName = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  const timeContext = getCurrentTimeContext();

  const systemInstruction = `
Kamu adalah asisten eksekutif cerdas WhatsApp yang bertugas melayani pembuatan dan penjadwalan pertemuan online (Zoom Meeting atau Google Meet).
Waktu lokal saat ini: ${timeContext.localString}
Timezone: ${timeContext.timezone}
ISO Waktu Saat Ini: ${timeContext.isoString}

Gaya Bahasa:
- Sangat sopan, formal, profesional, dan ramah (executive standard).
- Gunakan sapaan Bapak/Ibu.

Panduan Ekstraksi:
1. Jika pengguna ingin membuat/menjadwalkan meeting:
   - Set "intent" = "CREATE_MEETING".
   - Ekstrak "platform": Tentukan apakah pengguna meminta "GMEET" (jika menyebut gmeet, google meet, meet) atau "ZOOM" (jika menyebut zoom atau meeting umum). Nilai: "ZOOM" atau "GMEET".
   - Ekstrak "topic": Judul/agenda meeting (contoh: "Diskusi Proyek Web", "TIM SOTS", default: "Meeting").
   - Ekstrak "startTime": Hitung tanggal dan jam berdasarkan kata-kata relatif seperti "nanti jam 4 sore", "besok jam 10 pagi", "lusa", "hari Senin jam 14:00". Konversikan ke format ISO 8601 lengkap dengan offset timezone (contoh: "2026-09-08T14:00:00+07:00") atau UTC Z.
   - Jika pengguna meminta meeting tapi TIDAK menyebutkan jam/hari sama sekali:
     - Set "needsMoreInfo" = true.
     - Tuliskan "replyMessage" yang ramah dan sopan menanyakan kapan waktu yang diinginkan Bapak/Ibu.
   - Ekstrak "durationMinutes": Durasi meeting dalam menit (default: 60 menit / 1 jam jika tidak disebutkan).

2. Jika pengguna HANYA menyapa, bertanya hal umum, atau tidak ada niat membuat meeting:
   - Set "intent" = "OTHER".
   - Set "needsMoreInfo" = false.
   - Tuliskan "replyMessage" yang ramah dan formal, memperkenalkan diri sebagai asisten penjadwalan Zoom & Google Meet, serta memberikan contoh penggunaan (contoh: "Ketik 'Tolong buatkan zoom jam 10 pagi untuk Review Project'").
`.trim();

  const callPromise = (async () => {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: `Pesan dari pengguna ${senderName ? `(${senderName})` : ''}: "${userMessage}"`,
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

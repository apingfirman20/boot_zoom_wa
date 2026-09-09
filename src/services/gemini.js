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
 * Menganalisis pesan teks dari pengguna WhatsApp menggunakan Gemini API.
 * Mengekstrak intent, waktu/tanggal meeting, durasi, topik, dan kebutuhan info tambahan.
 * 
 * @param {string} userMessage - Pesan chat dari pengguna WhatsApp
 * @param {string} senderName - Nama pengirim jika tersedia
 * @returns {Promise<{
 *   intent: 'CREATE_MEETING' | 'OTHER',
 *   topic: string,
 *   startTime: string | null,
 *   durationMinutes: number,
 *   needsMoreInfo: boolean,
 *   replyMessage: string
 * }>}
 */
export async function extractMeetingDetails(userMessage, senderName = '') {
  const ai = getAiClient();
  const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const timeContext = getCurrentTimeContext();

  const systemInstruction = `
Kamu adalah asisten cerdas WhatsApp yang bertugas mendeteksi apakah pengguna ingin menjadwalkan/membuat pertemuan video (Zoom Meeting).
Waktu lokal saat ini: ${timeContext.localString}
Timezone: ${timeContext.timezone}
ISO Waktu Saat Ini: ${timeContext.isoString}

Panduan Ekstraksi:
1. Jika pengguna ingin membuat/menjadwalkan meeting:
   - Set "intent" = "CREATE_MEETING".
   - Ekstrak "topic": Judul/agenda meeting (contoh: "Diskusi Proyek Web", "Meeting Koordinasi", default: "Meeting").
   - Ekstrak "startTime": Hitung tanggal dan jam berdasarkan kata-kata relatif seperti "nanti jam 4 sore", "besok jam 10 pagi", "lusa", "hari Senin jam 14:00". Konversikan ke format ISO 8601 lengkap dengan offset timezone (contoh: "2026-09-08T14:00:00+07:00") atau UTC Z.
   - Jika pengguna meminta meeting tapi TIDAK menyebutkan jam/hari sama sekali:
     - Set "needsMoreInfo" = true.
     - Tuliskan "replyMessage" yang ramah dan sopan menanyakan kapan waktu yang diinginkan.
   - Ekstrak "durationMinutes": Durasi meeting dalam menit (default: 60 menit / 1 jam jika tidak disebutkan).

2. Jika pengguna HANYA menyapa, bertanya hal umum, atau tidak ada niat membuat meeting:
   - Set "intent" = "OTHER".
   - Set "needsMoreInfo" = false.
   - Tuliskan "replyMessage" yang ramah, memperkenalkan diri sebagai bot pembuat link Zoom otomatis, dan memberi tahu cara menggunakannya (contoh: "Ketik 'Tolong buatkan meeting besok jam 2 siang'").
`.trim();

  try {
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
              description: 'Pesan balasan ke pengguna WhatsApp'
            }
          },
          required: ['intent', 'topic', 'durationMinutes', 'needsMoreInfo', 'replyMessage']
        }
      }
    });

    const text = response.text?.trim() || '{}';
    const parsed = JSON.parse(text);

    return {
      intent: parsed.intent || 'OTHER',
      topic: parsed.topic || 'Zoom Meeting',
      startTime: parsed.startTime || null,
      durationMinutes: parsed.durationMinutes || Number(process.env.DEFAULT_MEETING_DURATION) || 60,
      needsMoreInfo: Boolean(parsed.needsMoreInfo),
      replyMessage: parsed.replyMessage || 'Halo! Saya bot pembuat link Zoom otomatis.'
    };
  } catch (error) {
    console.error('Error saat memanggil Gemini API:', error);
    throw error;
  }
}

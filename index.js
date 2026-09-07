import { onRequest } from 'firebase-functions/v2/https';
import { extractMeetingDetails } from './src/services/gemini.js';
import { createZoomMeeting } from './src/services/zoom.js';
import { sendWhatsAppMessage, markWhatsAppAsRead } from './src/services/whatsapp.js';
import { formatMeetingTime } from './src/utils/datetime.js';

/**
 * Logika penanganan webhook WhatsApp (GET verifikasi Meta & POST pemrosesan pesan).
 * Dipisahkan agar mudah diuji secara modular dan dapat digunakan oleh Firebase Cloud Function.
 */
export async function handleWebhookRequest(req, res) {
  // ---------------------------------------------------------------------------
  // 1. GET: VERIFIKASI WEBHOOK DARI META / WHATSAPP
  // ---------------------------------------------------------------------------
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    const expectedVerifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

    if (mode === 'subscribe' && token === expectedVerifyToken) {
      console.log('Webhook WhatsApp berhasil diverifikasi oleh Meta.');
      return res.status(200).send(challenge);
    } else {
      console.warn('Verifikasi webhook gagal. Token tidak cocok atau parameter tidak valid.');
      return res.status(403).json({ error: 'Verification failed' });
    }
  }

  // ---------------------------------------------------------------------------
  // 2. POST: PENANGANAN PESAN MASUK DARI WHATSAPP
  // ---------------------------------------------------------------------------
  if (req.method === 'POST') {
    const body = req.body;

    // Pastikan payload berasal dari WhatsApp Business Account
    if (body?.object !== 'whatsapp_business_account') {
      return res.status(404).send('Not Found');
    }

    try {
      const entry = body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;

      // Abaikan event status pengiriman (sent/delivered/read) dengan 200 OK cepat
      if (!value?.messages || value.messages.length === 0) {
        return res.status(200).json({ status: 'ignored_status_update' });
      }

      const message = value.messages[0];
      const senderPhone = message.from; // Nomor telepon pengirim (contoh: "6281234567890")
      const messageId = message.id;
      const contact = value.contacts?.[0];
      const senderName = contact?.profile?.name || '';

      // Beri tanda pesan sudah dibaca (centang biru)
      await markWhatsAppAsRead(messageId);

      // Tangani jika pesan bukan teks biasa (misal: stiker/audio/gambar)
      if (message.type !== 'text' || !message.text?.body) {
        const notTextReply = `Halo ${senderName || 'Kak'}! 👋\nSaat ini saya hanya dapat memproses instruksi dalam format *teks* untuk membuat jadwal meeting Zoom.\n\nContoh: _"Tolong buatkan meeting besok jam 2 siang bahas evaluasi proyek"_`;
        await sendWhatsAppMessage(senderPhone, notTextReply);
        return res.status(200).json({ status: 'non_text_handled' });
      }

      const userText = message.text.body.trim();
      console.log(`[Pesan Masuk] Dari: ${senderPhone} (${senderName}): "${userText}"`);

      // Analisis teks pesan menggunakan Google Gemini AI
      const aiResult = await extractMeetingDetails(userText, senderName);
      console.log('[Hasil AI Gemini]:', JSON.stringify(aiResult));

      // ALUR 1: Pengguna berniat membuat meeting
      if (aiResult.intent === 'CREATE_MEETING') {
        if (aiResult.needsMoreInfo || !aiResult.startTime) {
          // Info waktu belum jelas / butuh konfirmasi
          await sendWhatsAppMessage(senderPhone, aiResult.replyMessage);
          return res.status(200).json({ status: 'needs_more_info_replied' });
        }

        // Buat Zoom Meeting via REST API
        try {
          const meeting = await createZoomMeeting({
            topic: aiResult.topic,
            startTime: aiResult.startTime,
            duration: aiResult.durationMinutes
          });

          const formattedTime = formatMeetingTime(aiResult.startTime);

          const successMessage = [
            `*✅ Link Zoom Meeting Berhasil Dibuat!*`,
            ``,
            `📌 *Topik:* ${meeting.topic}`,
            `🗓️ *Waktu:* ${formattedTime}`,
            `⏱️ *Durasi:* ±${meeting.duration} Menit`,
            ``,
            `🔗 *Link Zoom:*`,
            `${meeting.joinUrl}`,
            ``,
            `🆔 *Meeting ID:* ${meeting.meetingId}`,
            meeting.passcode ? `🔑 *Passcode:* ${meeting.passcode}` : null,
            ``,
            `_Link di atas sudah dapat langsung digunakan oleh peserta meeting._`
          ].filter(Boolean).join('\n');

          await sendWhatsAppMessage(senderPhone, successMessage);
          console.log(`[Zoom Berhasil Dibuat]: ID ${meeting.meetingId} untuk ${senderPhone}`);
          return res.status(200).json({ status: 'meeting_created_and_sent' });

        } catch (zoomError) {
          console.error('[Zoom API Error]:', zoomError);
          const errorMessage = `Maaf ${senderName || 'Kak'}, terjadi kendala teknis saat menghubungi Zoom API untuk membuat link meeting.\n\nDetail kendala: ${zoomError.message}`;
          await sendWhatsAppMessage(senderPhone, errorMessage);
          return res.status(200).json({ status: 'zoom_failed_replied' });
        }
      }

      // ALUR 2: Bukan intent meeting (chatting umum/sapaan/bantuan)
      await sendWhatsAppMessage(senderPhone, aiResult.replyMessage);
      return res.status(200).json({ status: 'general_replied' });

    } catch (error) {
      console.error('[Webhook POST Error]:', error);
      // Tetap kembalikan 200 OK agar webhook Meta tidak me-retry berulang kali
      return res.status(200).json({ error: error.message });
    }
  }

  // Method HTTP selain GET dan POST
  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}

/**
 * Definisi Firebase Cloud Function (Gen 2).
 * Dikonfigurasi dengan region Jakarta (asia-southeast2) untuk latensi terbaik.
 */
export const webhook = onRequest(
  {
    region: 'asia-southeast2', // Server Jakarta
    timeoutSeconds: 60,
    memory: '512MiB',
    cors: false
  },
  handleWebhookRequest
);

export default handleWebhookRequest;

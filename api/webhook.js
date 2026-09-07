import { extractMeetingDetails } from '../src/services/gemini.js';
import { createZoomMeeting } from '../src/services/zoom.js';
import { sendWhatsAppMessage, markWhatsAppAsRead } from '../src/services/whatsapp.js';
import { formatMeetingTime } from '../src/utils/datetime.js';

/**
 * Entry point Vercel Serverless Function untuk Webhook WhatsApp.
 * Mendukung GET (verifikasi webhook Meta) dan POST (event pesan masuk).
 */
export default async function handler(req, res) {
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

      // Jika event adalah status pengiriman (sent/delivered/read), langsung balas 200 OK
      if (!value?.messages || value.messages.length === 0) {
        return res.status(200).json({ status: 'ignored_status_update' });
      }

      const message = value.messages[0];
      const senderPhone = message.from; // Nomor telepon pengirim (misal: "6281234567890")
      const messageId = message.id;
      const contact = value.contacts?.[0];
      const senderName = contact?.profile?.name || '';

      // Tandai pesan sudah dibaca (centang biru)
      await markWhatsAppAsRead(messageId);

      // Tangani jika pesan bukan teks biasa (misal: audio, gambar, stiker)
      if (message.type !== 'text' || !message.text?.body) {
        const notTextReply = `Halo ${senderName || 'Kak'}! 👋\nSaat ini saya hanya dapat memproses instruksi dalam format *teks* untuk membuat jadwal meeting Zoom.\n\nContoh: _"Tolong buatkan meeting besok jam 2 siang bahas evaluasi proyek"_`;
        await sendWhatsAppMessage(senderPhone, notTextReply);
        return res.status(200).json({ status: 'non_text_handled' });
      }

      const userText = message.text.body.trim();
      console.log(`[Pesan Masuk] Dari: ${senderPhone} (${senderName}): "${userText}"`);

      // Analisis teks pesan menggunakan Gemini AI
      const aiResult = await extractMeetingDetails(userText, senderName);
      console.log('[Hasil AI Gemini]:', JSON.stringify(aiResult));

      // ALUR 1: Pengguna ingin membuat meeting
      if (aiResult.intent === 'CREATE_MEETING') {
        if (aiResult.needsMoreInfo || !aiResult.startTime) {
          // Info waktu kurang spesifik / butuh konfirmasi
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

      // ALUR 2: Bukan intent meeting (chatting santai/sapaan/bantuan)
      await sendWhatsAppMessage(senderPhone, aiResult.replyMessage);
      return res.status(200).json({ status: 'general_replied' });

    } catch (error) {
      console.error('[Webhook POST Error]:', error);
      // Tetap kembalikan 200 OK agar Meta tidak terus menerus me-retry webhook yang error
      return res.status(200).json({ error: error.message });
    }
  }

  // Method HTTP selain GET dan POST
  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}

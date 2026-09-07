import 'dotenv/config';
import http from 'http';
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import { extractMeetingDetails } from './src/services/gemini.js';
import { createZoomMeeting } from './src/services/zoom.js';
import { formatMeetingTime } from './src/utils/datetime.js';

const AUTH_FOLDER = './auth_info_baileys';

// -----------------------------------------------------------------------------
// 1. HEALTH CHECK HTTP SERVER (Wajib untuk Koyeb & Cloud Hosting)
// -----------------------------------------------------------------------------
const PORT = process.env.PORT || 8000;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('🤖 Bot Zoom AI WhatsApp (Baileys) aktif & berjalan 24/7 di Koyeb!\n');
});

server.listen(PORT, () => {
  console.log(`🌐 Health check server berjalan di port ${PORT} (Koyeb Ready)`);
});

// -----------------------------------------------------------------------------
// 2. WHATSAPP BAILEYS BOT (SCAN QR DI TERMINAL)
// -----------------------------------------------------------------------------
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
  const { version, isLatest } = await fetchLatestBaileysVersion();

  console.log(`\n🤖 Menjalankan WhatsApp Bot Zoom (Baileys v${version.join('.')}, isLatest: ${isLatest})...`);

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }), // Log bersih tanpa spam Baileys
    printQRInTerminal: false,
    browser: ['Bot Zoom AI', 'Chrome', '1.0.0']
  });

  // Simpan kredensial login setiap kali ada pembaruan sesi
  sock.ev.on('creds.update', saveCreds);

  // Pantau status koneksi & cetak QR Code di terminal
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n============================================================');
      console.log('📌 SCAN QR CODE DI BAWAH INI DENGAN WHATSAPP ANDA:');
      console.log('   (Buka WA di HP -> Titik Tiga / Pengaturan -> Perangkat Tertaut -> Tautkan Perangkat)');
      console.log('============================================================\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(`⚠️ Koneksi terputus (Status: ${statusCode}). Reconnect: ${shouldReconnect}`);

      if (shouldReconnect) {
        console.log('🔄 Menghubungkan kembali dalam 3 detik...');
        setTimeout(() => startBot(), 3000);
      } else {
        console.log('❌ Sesi telah logout dari WhatsApp. Silakan restart service di Koyeb untuk scan QR baru.');
      }
    } else if (connection === 'open') {
      console.log('\n============================================================');
      console.log('✅ WHATSAPP BOT BERHASIL TERHUBUNG & SIAP DIGUNAKAN 24/7!');
      console.log('   Nomor Anda sekarang siap menerima perintah jadwal meeting Zoom.');
      console.log('============================================================\n');
    }
  });

  // Tangani pesan WhatsApp masuk
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      // Abaikan update status atau broadcast
      if (msg.key.remoteJid === 'status@broadcast') continue;

      // Ambil teks pesan
      const messageText =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        '';

      if (!messageText || messageText.trim() === '') continue;

      const remoteJid = msg.key.remoteJid;
      const senderName = msg.pushName || 'Teman';
      const isFromMe = msg.key.fromMe;

      // Jika pesan dari nomor sendiri, proses hanya jika diawali perintah '!meeting' agar tidak looping
      if (isFromMe && !messageText.toLowerCase().startsWith('!meeting')) {
        continue;
      }

      console.log(`\n📩 [Pesan Masuk] Dari: ${senderName} (${remoteJid}): "${messageText}"`);

      try {
        // Beri tanda centang biru (read)
        await sock.readMessages([msg.key]);

        const cleanText = messageText.replace(/^!meeting\s*/i, '').trim();

        // 1. Analisis niat pesan via Google Gemini AI
        console.log('🤖 Menganalisis pesan dengan Gemini AI...');
        const aiResult = await extractMeetingDetails(cleanText, senderName);
        console.log('💡 Hasil Analisis Gemini:', JSON.stringify(aiResult));

        // ALUR 1: Niat membuat meeting Zoom
        if (aiResult.intent === 'CREATE_MEETING') {
          if (aiResult.needsMoreInfo || !aiResult.startTime) {
            // Waktu belum jelas, minta klarifikasi
            await sock.sendMessage(remoteJid, { text: aiResult.replyMessage }, { quoted: msg });
            continue;
          }

          // 2. Buat Meeting di Zoom via REST API
          console.log('📞 Menghubungi Zoom API...');
          try {
            const meeting = await createZoomMeeting({
              topic: aiResult.topic,
              startTime: aiResult.startTime,
              duration: aiResult.durationMinutes
            });

            const formattedTime = formatMeetingTime(aiResult.startTime);

            const replySuccess = [
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
              `_Link di atas sudah dapat langsung dibagikan kepada peserta meeting._`
            ].filter(Boolean).join('\n');

            await sock.sendMessage(remoteJid, { text: replySuccess }, { quoted: msg });
            console.log(`✅ Link Zoom berhasil dikirim ke ${remoteJid}!`);

          } catch (zoomErr) {
            console.error('❌ Gagal membuat Zoom meeting:', zoomErr.message);
            const errReply = `Maaf ${senderName}, terjadi kendala saat membuat meeting di Zoom: ${zoomErr.message}`;
            await sock.sendMessage(remoteJid, { text: errReply }, { quoted: msg });
          }

        } else {
          // ALUR 2: Obrolan umum / bukan meeting
          // Balas hanya jika chat pribadi (bukan grup) agar tidak spam di grup
          if (!remoteJid.endsWith('@g.us')) {
            await sock.sendMessage(remoteJid, { text: aiResult.replyMessage }, { quoted: msg });
          }
        }

      } catch (err) {
        console.error('❌ Error memproses pesan:', err);
      }
    }
  });
}

// Jalankan Bot
startBot().catch((err) => {
  console.error('Fatal Error saat menjalankan bot:', err);
});

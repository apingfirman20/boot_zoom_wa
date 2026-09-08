import 'dotenv/config';
import http from 'http';
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import { parseMeetingCommand } from './src/utils/parser.js';
import { createZoomMeeting } from './src/services/zoom.js';
import { formatMeetingTime } from './src/utils/datetime.js';
import { checkScheduleConflict, saveScheduledMeeting, getNearbyUpcomingMeeting } from './src/services/schedule.js';

const AUTH_FOLDER = './auth_info_baileys';

// -----------------------------------------------------------------------------
// 1. HEALTH CHECK HTTP SERVER (Wajib untuk Koyeb & Cloud Hosting)
// -----------------------------------------------------------------------------
const PORT = process.env.PORT || 8000;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('🤖 Bot Zoom AI WhatsApp (Baileys) aktif & berjalan 24/7 di Koyeb!\n');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`ℹ️ Port ${PORT} sedang digunakan oleh aplikasi lain, HTTP health-check dilewati (bot tetap berjalan normal).`);
  } else {
    console.error('HTTP server error:', err);
  }
});

server.listen(PORT, () => {
  console.log(`🌐 Health check server berjalan di port ${PORT}`);
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

      // Cegah looping jika pesan merupakan balasan dari bot itu sendiri
      if (
        messageText.startsWith('Berikut Pak/Bu') ||
        messageText.startsWith('Mohon maaf Pak/Bu') ||
        messageText.startsWith('Untuk di jam') ||
        messageText.startsWith('*✅ Link Zoom Meeting') ||
        messageText.startsWith('Maaf ')
      ) {
        continue;
      }

      // 1. Cek apakah pesan berisi kata kunci perintah Zoom / Meeting
      const command = parseMeetingCommand(messageText);

      // Jika TIDAK ADA kata kunci perintah meeting, abaikan sama sekali (tidak perlu dijawab)
      if (!command) {
        continue;
      }

      console.log(`\n📩 [Perintah Meeting Masuk] Dari: ${senderName} (${remoteJid}): "${messageText}"`);
      console.log(`📋 [Hasil Parser Template] Topik: "${command.topic}", Waktu: ${command.startTime}`);

      try {
        // Beri tanda centang biru (read)
        await sock.readMessages([msg.key]);

        // 2. CEK JADWAL BENTROK (Jam yang sama / Overlap)
        const { hasConflict, conflictingMeeting } = checkScheduleConflict(command.startTime, command.durationMinutes);
        if (hasConflict && conflictingMeeting) {
          const confTime = formatMeetingTime(conflictingMeeting.startTime);
          const replyConflict = `Mohon maaf Pak/Bu, di jam segitu (${confTime}) ada tim ${conflictingMeeting.topic} yang sedang meeting. Mohon ditunggu ya atau jadwalkan di jam lain, agar meeting tidak double.`;
          await sock.sendMessage(remoteJid, { text: replyConflict }, { quoted: msg });
          console.log(`⚠️ Ditolak: Jadwal bentrok dengan tim ${conflictingMeeting.topic} (${confTime})`);
          continue;
        }

        // 3. Buat Meeting di Zoom via REST API
        console.log('📞 Menghubungi Zoom API...');
        try {
          const meeting = await createZoomMeeting({
            topic: command.topic,
            startTime: command.startTime,
            duration: command.durationMinutes
          });

          // Simpan meeting ke database jadwal lokal agar dapat mendeteksi bentrok selanjutnya
          saveScheduledMeeting({
            meetingId: meeting.meetingId,
            topic: command.topic,
            startTime: command.startTime,
            duration: command.durationMinutes,
            joinUrl: meeting.joinUrl,
            passcode: meeting.passcode
          });

          const formattedTime = formatMeetingTime(command.startTime);

          // Template balasan utama sesuai permintaan
          const replySuccess = [
            `Berikut Pak/Bu untuk Link Zoomnya`,
            `Topik: ${meeting.topic}`,
            `Waktu: ${formattedTime}`,
            `🔗 Link Zoom:`,
            `${meeting.joinUrl}`,
            `🆔 Meeting ID: ${meeting.meetingId}`,
            meeting.passcode ? `🔑 Passcode: ${meeting.passcode}` : null,
            `Link di atas sudah dapat langsung dibagikan kepada peserta meeting.`
          ].filter(Boolean).join('\n');

          await sock.sendMessage(remoteJid, { text: replySuccess }, { quoted: msg });
          console.log(`✅ Link Zoom berhasil dikirim ke ${remoteJid}!`);

          // 4. CEK APAKAH ADA MEETING BERIKUTNYA YANG BERJARAK 1-2 JAM
          const nearbyMeeting = getNearbyUpcomingMeeting(command.startTime, command.durationMinutes);
          if (nearbyMeeting) {
            const nearbyDate = new Date(nearbyMeeting.startTime);
            const nearbyHour = new Intl.DateTimeFormat('id-ID', {
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
              timeZone: process.env.DEFAULT_TIMEZONE || 'Asia/Jakarta'
            }).format(nearbyDate);

            const followUpText = `Untuk di jam ${nearbyHour} zoom akan dipakai oleh tim ${nearbyMeeting.topic}, mohon dikondisikan ya.`;
            // Kirim sebagai chat lanjutan
            await sock.sendMessage(remoteJid, { text: followUpText });
            console.log(`📢 Keterangan lanjutan jadwal terdekat berhasil dikirim: "${followUpText}"`);
          }

        } catch (zoomErr) {
          console.error('❌ Gagal membuat Zoom meeting:', zoomErr.message);
          const errReply = `Maaf ${senderName}, terjadi kendala saat membuat meeting di Zoom: ${zoomErr.message}`;
          await sock.sendMessage(remoteJid, { text: errReply }, { quoted: msg });
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

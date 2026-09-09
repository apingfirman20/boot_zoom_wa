import 'dotenv/config';
import http from 'http';
import crypto from 'crypto';
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import {
  parseMeetingCommand,
  parseCancelCommand,
  parseListCommand,
  parseLiveRecordCommand
} from './src/utils/parser.js';
import {
  createZoomMeeting,
  deleteZoomMeeting,
  startLiveMeetingRecording,
  getMeetingRecordings,
  getPastMeetingDetails,
  getPastMeetingParticipants
} from './src/services/zoom.js';
import {
  formatMeetingTime,
  formatMeetingRange,
  formatDurationHuman
} from './src/utils/datetime.js';
import {
  checkScheduleConflict,
  saveScheduledMeeting,
  getNearbyUpcomingMeeting,
  getActiveMeetings,
  removeScheduledMeeting,
  syncMeetingsWithZoom,
  getCurrentLiveMeeting,
  updateMeetingRecording,
  getMeetingsPendingRecording,
  getMeetingsPendingSummary,
  getScheduledMeetingById
} from './src/services/schedule.js';

import fs from 'fs';
import path from 'path';
import util from 'util';

const STORAGE_DIR = process.env.STORAGE_DIR || '.';
const AUTH_FOLDER = path.join(STORAGE_DIR, 'auth_info_baileys');
let globalSock = null;
let latestQr = null;
let botStatus = 'connecting'; // 'connecting', 'waiting_qr', 'connected', 'disconnected'
let connectedUser = null;

// Setup file logger agar bot.log selalu terupdate baik di background maupun di terminal
let logStream = null;
try {
  logStream = fs.createWriteStream('./bot.log', { flags: 'a' });
  logStream.on('error', (err) => {
    origError.apply(console, ['⚠️ Gagal menulis ke bot.log (mungkin file sedang dibuka):', err.message]);
  });
} catch (e) {
  origError.apply(console, ['⚠️ Gagal menginisialisasi bot.log:', e.message]);
}

const origLog = console.log;
const origError = console.error;

console.log = function (...args) {
  const line = util.format(...args) + '\n';
  try { if (logStream) logStream.write(line); } catch (e) {}
  origLog.apply(console, args);
};

console.error = function (...args) {
  const line = util.format(...args) + '\n';
  try { if (logStream) logStream.write(line); } catch (e) {}
  origError.apply(console, args);
};

/**
 * Mengirim pesan notifikasi video rekaman dan password ke nomor pemesan / yang meminta rekam.
 */
async function sendRecordingNotification(meeting, recordings) {
  if (!globalSock) return;
  const targetPhone = meeting.recordRequesterPhone || meeting.requesterPhone;
  if (!targetPhone) {
    console.warn(`⚠️ Tidak ada nomor tujuan untuk mengirim rekaman meeting ${meeting.id}`);
    return;
  }

  const formattedTime = formatMeetingTime(meeting.startTime);
  const textMsg = [
    `🎬 *Rekaman Video Meeting Zoom Telah Siap!*`,
    ``,
    `📌 *Topik:* ${meeting.topic}`,
    `🗓️ *Waktu:* ${formattedTime}`,
    `🔗 *Link Video Rekaman:*`,
    `${recordings.shareUrl}`,
    ``,
    `🔑 *Password Rekaman:* ${recordings.password || '(Tanpa Password)'}`,
    ``,
    `Video rekaman dapat langsung ditonton atau diunduh melalui link di atas.`
  ].join('\n');

  try {
    await globalSock.sendMessage(targetPhone, { text: textMsg });
    console.log(`✅ Link rekaman meeting ID ${meeting.id} berhasil dikirim ke ${targetPhone}!`);
    updateMeetingRecording(meeting.id, { recordingSent: true });
  } catch (sendErr) {
    console.error(`Gagal mengirim pesan rekaman ke ${targetPhone}:`, sendErr.message);
  }
}

/**
 * Pengecekan berkala (polling) untuk meeting yang meminta rekaman dan belum dikirimkan videonya.
 */
async function pollPendingRecordings() {
  if (!globalSock) return;
  const pending = getMeetingsPendingRecording();
  if (pending.length === 0) return;

  for (const m of pending) {
    try {
      const rec = await getMeetingRecordings(m.id);
      if (rec && rec.shareUrl) {
        console.log(`🎬 Mendeteksi rekaman selesai di Zoom untuk meeting ${m.id} (${m.topic})`);
        await sendRecordingNotification(m, rec);
      }
    } catch (err) {
      // Ignored
    }
  }
}

// Cek status rekaman yang pending setiap 2 menit
setInterval(() => {
  pollPendingRecordings().catch(() => {});
}, 2 * 60 * 1000);

/**
 * Mengirim laporan rekap meeting (peserta yang bergabung dan total durasi aktual) ke pemesan.
 */
async function sendMeetingEndedSummary(meetingId, webhookObject = null) {
  if (!globalSock) return;
  const meeting = getScheduledMeetingById(meetingId);
  if (!meeting) return;

  if (meeting.summarySent) {
    return; // Sudah pernah dikirim
  }

  const targetPhone = meeting.requesterPhone || meeting.recordRequesterPhone;
  if (!targetPhone) {
    console.warn(`⚠️ Tidak ada nomor tujuan untuk mengirim rekap meeting ${meeting.id}`);
    return;
  }

  console.log(`📊 Mengumpulkan data rekap peserta untuk meeting ${meeting.id} (${meeting.topic})...`);

  // Beri kesempatan retry jika Zoom butuh beberapa detik untuk memproses data peserta
  let participants = [];
  let pastDetails = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      pastDetails = await getPastMeetingDetails(meeting.id);
      participants = await getPastMeetingParticipants(meeting.id);

      if (participants.length > 0) {
        break;
      }
    } catch (fetchErr) {
      console.error(`Percobaan ${attempt} mengambil data peserta meeting ${meeting.id} gagal:`, fetchErr.message);
    }

    if (attempt < 3) {
      await new Promise(r => setTimeout(r, 6000));
    }
  }

  const topic = pastDetails?.topic || webhookObject?.topic || meeting.topic || 'Zoom Meeting';
  const startTime = pastDetails?.startTime || webhookObject?.start_time || meeting.startTime;
  const endTime = pastDetails?.endTime || webhookObject?.end_time || null;
  const durationMinutes = pastDetails?.totalMinutes || pastDetails?.duration || webhookObject?.duration || meeting.duration || 60;

  const timeRange = formatMeetingRange(startTime, endTime);
  const durationText = formatDurationHuman(durationMinutes);

  let participantLines = [];
  if (participants.length > 0) {
    participantLines = participants.map((p, idx) => {
      const dur = p.durationText ? ` (${p.durationText})` : '';
      return `${idx + 1}. ${p.name}${dur}`;
    });
  } else {
    participantLines.push(`_Tidak ada peserta terdeteksi bergabung di ruang meeting._`);
  }

  const summaryMsg = [
    `📊 *LAPORAN KEHADIRAN ZOOM MEETING*`,
    ``,
    `📌 *Topik:* ${topic}`,
    `⏱️ *Waktu:* ${timeRange}`,
    `⏳ *Total Durasi:* ${durationText}`,
    `👥 *Total Peserta Hadir:* ${participants.length} Orang`,
    ``,
    `━━━━━━━━━━━━━━━━━━━`,
    `*DAFTAR PESERTA YANG BERGABUNG:*`,
    ...participantLines,
    `━━━━━━━━━━━━━━━━━━━`,
    `_Laporan otomatis dibuat setelah meeting berakhir._`
  ].join('\n');

  try {
    await globalSock.sendMessage(targetPhone, { text: summaryMsg });
    console.log(`✅ Laporan rekap peserta meeting ID ${meeting.id} (${participants.length} peserta) berhasil dikirim ke ${targetPhone}!`);
    updateMeetingRecording(meeting.id, { summarySent: true });
  } catch (sendErr) {
    console.error(`Gagal mengirim laporan rekap ke ${targetPhone}:`, sendErr.message);
  }
}

/**
 * Pengecekan berkala (polling) untuk meeting yang sudah selesai dan belum dikirimkan rekap pesertanya.
 */
async function pollPendingSummaries() {
  if (!globalSock) return;
  const pending = getMeetingsPendingSummary();
  if (pending.length === 0) return;

  for (const m of pending) {
    try {
      const pastDetails = await getPastMeetingDetails(m.id);
      // Jika data past meeting sudah memiliki end_time atau durasi, berarti meeting sudah selesai
      if (pastDetails && (pastDetails.endTime || pastDetails.duration > 0)) {
        console.log(`🏁 Mendeteksi meeting ${m.id} (${m.topic}) telah selesai di Zoom, memproses rekap...`);
        await sendMeetingEndedSummary(m.id, pastDetails);
      }
    } catch (err) {
      // Ignored
    }
  }
}

// Cek status rekap meeting yang selesai setiap 2 menit
setInterval(() => {
  pollPendingSummaries().catch(() => {});
}, 2 * 60 * 1000);


function getDashboardHtml() {
  const activeCount = getActiveMeetings().length;
  const isConnected = botStatus === 'connected';
  const isWaitingQr = botStatus === 'waiting_qr' && latestQr;
  const refreshInterval = isWaitingQr ? 5 : 20;

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bot Zoom AI WhatsApp - Status & QR</title>
  <meta http-equiv="refresh" content="${refreshInterval}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: radial-gradient(circle at 50% 20%, #1a1f35 0%, #0c0f1d 100%);
      color: #e2e8f0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px 16px;
    }
    .card {
      background: rgba(26, 32, 53, 0.7);
      backdrop-filter: blur(16px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 20px;
      padding: 32px;
      max-width: 480px;
      width: 100%;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
      text-align: center;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px;
      border-radius: 9999px;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 20px;
    }
    .badge-online { background: rgba(34, 197, 94, 0.15); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.3); }
    .badge-waiting { background: rgba(234, 179, 8, 0.15); color: #facc15; border: 1px solid rgba(234, 179, 8, 0.3); }
    .badge-dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
    h1 { font-size: 22px; font-weight: 700; margin-bottom: 8px; color: #fff; }
    p.desc { font-size: 14px; color: #94a3b8; margin-bottom: 24px; line-height: 1.5; }
    .qr-box {
      background: #ffffff;
      padding: 16px;
      border-radius: 16px;
      display: inline-block;
      margin-bottom: 20px;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
    }
    .qr-box img { display: block; border-radius: 8px; }
    .info-list {
      text-align: left;
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 12px;
      padding: 16px;
      font-size: 13px;
      margin-bottom: 20px;
    }
    .info-item {
      display: flex;
      justify-content: space-between;
      padding: 6px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }
    .info-item:last-child { border-bottom: none; }
    .info-label { color: #94a3b8; }
    .info-val { color: #f8fafc; font-weight: 600; }
    .features {
      text-align: left;
      background: rgba(59, 130, 246, 0.08);
      border: 1px solid rgba(59, 130, 246, 0.2);
      border-radius: 12px;
      padding: 14px;
      font-size: 12px;
      color: #93c5fd;
      line-height: 1.6;
    }
    .features b { color: #bfdbfe; }
    .footer { margin-top: 20px; font-size: 12px; color: #64748b; }
  </style>
</head>
<body>
  <div class="card">
    ${isConnected ? `
      <div class="badge badge-online">
        <span class="badge-dot"></span> WhatsApp Aktif & Siap 24/7
      </div>
      <h1>Bot Zoom AI Online</h1>
      <p class="desc">Sistem bot aktif di cloud dan siap melayani permintaan meeting serta rekaman otomatis.</p>
      <div class="info-list">
        <div class="info-item"><span class="info-label">Akun WhatsApp:</span><span class="info-val">${connectedUser || 'Terhubung'}</span></div>
        <div class="info-item"><span class="info-label">Jadwal Aktif:</span><span class="info-val">${activeCount} Meeting</span></div>
        <div class="info-item"><span class="info-label">Auto Cloud Recording:</span><span class="info-val" style="color: #4ade80;">Aktif</span></div>
        <div class="info-item"><span class="info-label">Server Uptime:</span><span class="info-val">${Math.floor(process.uptime() / 60)} menit</span></div>
      </div>
      <div class="features">
        <b>💡 Contoh Perintah WhatsApp:</b><br>
        • "buatkan link zoom sekarang untuk rapat jangan lupa di rekam"<br>
        • "cek jadwal zoom"<br>
        • "rekam" (ketika meeting berlangsung)
      </div>
    ` : isWaitingQr ? `
      <div class="badge badge-waiting">
        <span class="badge-dot"></span> Menunggu Scan WhatsApp
      </div>
      <h1>Scan QR Code WhatsApp</h1>
      <p class="desc">Buka WhatsApp di HP Anda &gt; Menu Titik Tiga / Pengaturan &gt; Perangkat Tertaut &gt; Tautkan Perangkat</p>
      <div class="qr-box">
        <img src="https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=4&data=${encodeURIComponent(latestQr)}" alt="QR Code" width="260" height="260" />
      </div>
      <p style="font-size: 12px; color: #94a3b8;">Halaman otomatis merefresh setiap 5 detik</p>
    ` : `
      <div class="badge badge-waiting">
        <span class="badge-dot"></span> Menghubungkan Server...
      </div>
      <h1>Memulai Layanan Bot</h1>
      <p class="desc">Sedang menginisialisasi modul WhatsApp Baileys dan koneksi Zoom API. Mohon tunggu beberapa detik...</p>
      <div style="padding: 24px 0; font-size: 28px;">⏳</div>
      <p style="font-size: 12px; color: #94a3b8;">Halaman akan merefresh otomatis</p>
    `}
    <div class="footer">Zoom AI Bot • Railway Cloud Deployment</div>
  </div>
</body>
</html>`;
}

// -----------------------------------------------------------------------------
// 1. HEALTH CHECK & ZOOM WEBHOOK HTTP SERVER
// -----------------------------------------------------------------------------
const PORT = process.env.PORT || 8000;
const server = http.createServer(async (req, res) => {
  // Dukungan Webhook Zoom (Event: recording.completed & URL Validation)
  if (req.method === 'POST' && (req.url === '/webhook/zoom' || req.url === '/zoom/webhook')) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');

        // URL Validation challenge dari Zoom Marketplace
        if (data.event === 'endpoint.url_validation') {
          const plainToken = data.payload?.plainToken;
          const secret = process.env.ZOOM_WEBHOOK_SECRET_TOKEN || process.env.ZOOM_CLIENT_SECRET || '';
          const hash = crypto.createHmac('sha256', secret).update(plainToken).digest('hex');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ plainToken, encryptedToken: hash }));
        }

        // Event rekaman selesai dari Zoom Cloud
        if (data.event === 'recording.completed') {
          const obj = data.payload?.object;
          if (obj) {
            console.log(`📹 [Zoom Webhook] Rekaman selesai untuk meeting ID: ${obj.id}`);
            const meetings = getActiveMeetings();
            const targetMeeting = meetings.find(m => String(m.id).trim() === String(obj.id).trim());

            const recData = {
              shareUrl: obj.share_url || '',
              password: obj.password || ''
            };

            if (targetMeeting) {
              await sendRecordingNotification(targetMeeting, recData);
            }
          }
        }

        // Event meeting selesai dari Zoom (Kirim laporan rekap kehadiran & durasi)
        if (data.event === 'meeting.ended') {
          const obj = data.payload?.object;
          if (obj && obj.id) {
            console.log(`🏁 [Zoom Webhook] Meeting selesai untuk meeting ID: ${obj.id}`);
            // Beri jeda 8 detik agar data log peserta selesai diproses oleh Zoom
            setTimeout(() => {
              sendMeetingEndedSummary(obj.id, obj).catch(err => {
                console.error(`Gagal memproses rekap webhook meeting ${obj.id}:`, err.message);
              });
            }, 8000);
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'success' }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // API Status Endpoint
  if (req.url === '/health' || req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      status: 'ok',
      botStatus,
      connectedUser,
      activeMeetingsCount: getActiveMeetings().length,
      uptimeSeconds: Math.floor(process.uptime())
    }));
  }

  // Dashboard Web / Scan QR
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(getDashboardHtml());
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`⚠️ Port ${PORT} sudah digunakan oleh proses bot lain! Mencegah bot ganda berjalan bersamaan.`);
    process.exit(0);
  } else {
    console.error('HTTP server error:', err);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Health check & Webhook server berjalan di port ${PORT}`);
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
  globalSock = sock;

  // Simpan kredensial login setiap kali ada pembaruan sesi
  sock.ev.on('creds.update', saveCreds);

  // Pantau status koneksi & cetak QR Code di terminal
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      latestQr = qr;
      botStatus = 'waiting_qr';
      console.log('\n============================================================');
      console.log('📌 SCAN QR CODE DI BAWAH INI DENGAN WHATSAPP ANDA:');
      console.log('   (Buka WA di HP -> Titik Tiga / Pengaturan -> Perangkat Tertaut -> Tautkan Perangkat)');
      console.log('============================================================\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      botStatus = 'disconnected';
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      
      // Jika digantikan sesi baru (440), jangan reconnect agar tidak terjadi perang koneksi bolak-balik
      if (statusCode === DisconnectReason.connectionReplaced) {
        console.log('⚠️ Sesi WhatsApp digantikan oleh koneksi bot baru (Status 440). Bot berhenti untuk mencegah konflik.');
        process.exit(0);
      }

      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(`⚠️ Koneksi terputus (Status: ${statusCode}). Reconnect: ${shouldReconnect}`);

      if (shouldReconnect) {
        console.log('🔄 Menghubungkan kembali dalam 3 detik...');
        setTimeout(() => startBot(), 3000);
      } else {
        console.log('❌ Sesi telah logout dari WhatsApp. Membersihkan sesi lama dan menyiapkan QR baru...');
        try {
          fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
        } catch (rmErr) {
          console.error('Gagal membersihkan auth folder:', rmErr.message);
        }
        setTimeout(() => startBot(), 2000);
      }
    } else if (connection === 'open') {
      latestQr = null;
      botStatus = 'connected';
      connectedUser = sock?.user?.id ? sock.user.id.split(':')[0] : 'Aktif';
      console.log('\n============================================================');
      console.log('✅ WHATSAPP BOT BERHASIL TERHUBUNG & SIAP DIGUNAKAN 24/7!');
      console.log('   Nomor Anda sekarang siap menerima perintah jadwal meeting Zoom.');
      console.log('============================================================\n');

      // Sinkronisasi jadwal dengan server Zoom saat bot terhubung
      try {
        await syncMeetingsWithZoom();
      } catch (syncErr) {
        console.error('Gagal sinkronisasi meeting awal:', syncErr.message);
      }

      // Cek rekaman yang sudah selesai & siap dikirimkan
      setTimeout(() => {
        pollPendingRecordings().catch(err => console.error('Gagal poll rekaman awal:', err.message));
        pollPendingSummaries().catch(err => console.error('Gagal poll rekap meeting awal:', err.message));
      }, 3000);
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
        messageText.startsWith('✅ *Jadwal Zoom') ||
        messageText.startsWith('📅') ||
        messageText.startsWith('🎬') ||
        messageText.startsWith('Maaf ')
      ) {
        continue;
      }

      // -----------------------------------------------------------------------
      // A. CEK PERINTAH BATALKAN / HAPUS MEETING
      // -----------------------------------------------------------------------
      const cancelCmd = parseCancelCommand(messageText);
      if (cancelCmd) {
        console.log(`\n🗑️ [Perintah Batal Masuk] Dari: ${senderName} (${remoteJid}): "${messageText}"`);
        try {
          await sock.readMessages([msg.key]);

          const activeMeetings = getActiveMeetings();
          let matchedMeeting = null;

          if (cancelCmd.meetingId) {
            matchedMeeting = activeMeetings.find(m => String(m.id).includes(cancelCmd.meetingId));
          } else if (cancelCmd.matchedHour !== null) {
            matchedMeeting = activeMeetings.find(m => {
              const d = new Date(m.startTime);
              return d.getHours() === cancelCmd.matchedHour;
            });
          } else if (cancelCmd.targetTopic) {
            const term = cancelCmd.targetTopic.toLowerCase();
            matchedMeeting = activeMeetings.find(m => (m.topic || '').toLowerCase().includes(term));
          } else if (activeMeetings.length === 1) {
            matchedMeeting = activeMeetings[0];
          }

          if (!matchedMeeting) {
            const noMatchText = `Mohon maaf Pak/Bu, tidak ditemukan jadwal meeting Zoom yang cocok untuk dibatalkan.\nKetik *cek jadwal zoom* untuk melihat jadwal yang masih aktif.`;
            await sock.sendMessage(remoteJid, { text: noMatchText }, { quoted: msg });
            continue;
          }

          try {
            await deleteZoomMeeting(matchedMeeting.id);
          } catch (delApiErr) {
            console.warn(`Peringatan saat panggil Zoom API delete (${delApiErr.message}), tetap bersihkan lokal.`);
          }

          removeScheduledMeeting(matchedMeeting.id);

          const formattedTime = formatMeetingTime(matchedMeeting.startTime);
          const replyCancel = [
            `✅ *Jadwal Zoom Berhasil Dibatalkan & Dihapus:*`,
            `📌 *Topik:* ${matchedMeeting.topic}`,
            `🗓️ *Waktu:* ${formattedTime}`,
            `🆔 *Meeting ID:* ${matchedMeeting.id}`,
            ``,
            `Jadwal pada jam tersebut sekarang sudah kosong dan bisa digunakan kembali.`
          ].join('\n');

          await sock.sendMessage(remoteJid, { text: replyCancel }, { quoted: msg });
          console.log(`✅ Meeting ${matchedMeeting.id} (${matchedMeeting.topic}) berhasil dibatalkan.`);
        } catch (cancelErr) {
          console.error('❌ Error memproses pembatalan meeting:', cancelErr);
        }
        continue;
      }

      // -----------------------------------------------------------------------
      // B. CEK PERINTAH LIHAT DAFTAR JADWAL ZOOM
      // -----------------------------------------------------------------------
      const listCmd = parseListCommand(messageText);
      if (listCmd) {
        console.log(`\n📋 [Perintah Cek Jadwal] Dari: ${senderName} (${remoteJid}): "${messageText}"`);
        try {
          await sock.readMessages([msg.key]);

          const validMeetings = await syncMeetingsWithZoom();

          if (validMeetings.length === 0) {
            const emptyReply = `📅 Saat ini belum ada jadwal meeting Zoom yang aktif.\nSeluruh jam masih kosong dan siap digunakan!`;
            await sock.sendMessage(remoteJid, { text: emptyReply }, { quoted: msg });
            continue;
          }

          const lines = [
            `📅 *Daftar Jadwal Meeting Zoom Aktif:*`,
            ``
          ];

          validMeetings.forEach((m, idx) => {
            const fTime = formatMeetingTime(m.startTime);
            lines.push(`${idx + 1}. *${m.topic}*`);
            lines.push(`   🗓️ Waktu: ${fTime}`);
            lines.push(`   🆔 Meeting ID: ${m.id}`);
            lines.push(``);
          });

          lines.push(`_Untuk membatalkan jadwal, contoh: "hapus zoom jam ${new Date(validMeetings[0].startTime).getHours()}"_`);

          await sock.sendMessage(remoteJid, { text: lines.join('\n') }, { quoted: msg });
        } catch (listErr) {
          console.error('❌ Error menampilkan daftar meeting:', listErr);
        }
        continue;
      }

      // -----------------------------------------------------------------------
      // C. CEK PERINTAH REKAM LIVE (Meeting Sedang Berlangsung)
      // -----------------------------------------------------------------------
      const liveRecCmd = parseLiveRecordCommand(messageText);
      if (liveRecCmd) {
        console.log(`\n📹 [Perintah Rekam Live Masuk] Dari: ${senderName} (${remoteJid}): "${messageText}"`);
        try {
          await sock.readMessages([msg.key]);

          const liveMeeting = getCurrentLiveMeeting();
          if (!liveMeeting) {
            const noLiveText = `Mohon maaf Pak/Bu, saat ini tidak terdeteksi meeting Zoom yang sedang aktif untuk direkam.\nKetik *cek jadwal zoom* untuk melihat daftar jadwal meeting.`;
            await sock.sendMessage(remoteJid, { text: noLiveText }, { quoted: msg });
            continue;
          }

          // Nyalakan rekaman via Zoom API
          await startLiveMeetingRecording(liveMeeting.id);

          // Update database jadwal lokal dengan nomor yang meminta rekam
          updateMeetingRecording(liveMeeting.id, {
            autoRecord: true,
            recordRequesterPhone: remoteJid
          });

          const replyLive = [
            `🎬 *Perekaman Meeting Zoom Diaktifkan!*`,
            ``,
            `📌 *Topik:* ${liveMeeting.topic}`,
            `🆔 *Meeting ID:* ${liveMeeting.id}`,
            ``,
            `Zoom meeting saat ini sedang direkam ke cloud. Setelah meeting selesai, link video rekaman dan passwordnya akan otomatis dikirimkan ke nomor ini.`
          ].join('\n');

          await sock.sendMessage(remoteJid, { text: replyLive }, { quoted: msg });
          console.log(`✅ Perekaman live meeting ${liveMeeting.id} (${liveMeeting.topic}) berhasil diaktifkan untuk ${remoteJid}`);
        } catch (recErr) {
          console.error('❌ Error memproses rekam live:', recErr);
        }
        continue;
      }

      // -----------------------------------------------------------------------
      // D. PROSES PERINTAH MEMBUAT MEETING ZOOM
      // -----------------------------------------------------------------------
      const command = parseMeetingCommand(messageText);

      // Jika TIDAK ADA kata kunci perintah meeting, abaikan sama sekali (tidak perlu dijawab)
      if (!command) {
        continue;
      }

      console.log(`\n📩 [Perintah Meeting Masuk] Dari: ${senderName} (${remoteJid}): "${messageText}"`);
      console.log(`📋 [Hasil Parser Template] Topik: "${command.topic}", Waktu: ${command.startTime}, AutoRecord: ${command.autoRecord}`);

      try {
        // Beri tanda centang biru (read)
        await sock.readMessages([msg.key]);

        // 2. CEK JADWAL BENTROK (Jam yang sama / Overlap)
        // Otomatis memvalidasi ke Zoom jika meeting ternyata sudah dihapus di Zoom oleh user
        const { hasConflict, conflictingMeeting } = await checkScheduleConflict(command.startTime, command.durationMinutes);
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
            duration: command.durationMinutes,
            autoRecord: command.autoRecord
          });

          // Simpan meeting ke database jadwal lokal agar dapat mendeteksi bentrok selanjutnya
          saveScheduledMeeting({
            meetingId: meeting.meetingId,
            topic: command.topic,
            startTime: command.startTime,
            duration: command.durationMinutes,
            joinUrl: meeting.joinUrl,
            passcode: meeting.passcode,
            autoRecord: command.autoRecord,
            requesterPhone: remoteJid,
            recordRequesterPhone: remoteJid
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
            command.autoRecord ? `📹 *Auto Recording (Cloud):* Aktif\n_Link video dan password rekaman akan otomatis dikirimkan ke chat ini setelah meeting selesai._` : null,
            `Link di atas sudah dapat langsung dibagikan kepada peserta meeting.`
          ].filter(Boolean).join('\n');

          await sock.sendMessage(remoteJid, { text: replySuccess }, { quoted: msg });
          console.log(`✅ Link Zoom berhasil dikirim ke ${remoteJid}!`);

          // 4. CEK APAKAH ADA MEETING BERIKUTNYA YANG BERJARAK 1-2 JAM
          const nearbyMeeting = await getNearbyUpcomingMeeting(command.startTime, command.durationMinutes);
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

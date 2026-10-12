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
  parseLiveRecordCommand,
  parseEditCommand,
  parseHelpCommand,
  parseSummaryCommand,
  parseEndMeetingCommand
} from './src/utils/parser.js';
import {
  createZoomMeeting,
  deleteZoomMeeting,
  updateZoomMeeting,
  startLiveMeetingRecording,
  getMeetingRecordings,
  getPastMeetingDetails,
  getPastMeetingParticipants,
  getZoomMeetingSummary,
  getRecentEndedMeetings,
  endZoomMeeting,
  getLiveZoomMeetings
} from './src/services/zoom.js';
import {
  createGoogleMeeting,
  isGoogleConfigured,
  getGooglePastMeetingDetails,
  getGoogleMeetingParticipants,
  getGoogleMeetingRecordings,
  getGoogleMeetingSummary,
  getRecentEndedGoogleMeetings
} from './src/services/gmeet.js';
import {
  extractMeetingDetails,
  isGeminiEnabled
} from './src/services/gemini.js';
import {
  formatMeetingTime,
  formatMeetingRange,
  formatDurationHuman,
  parseToDate,
  getDatePartsInTimezone
} from './src/utils/datetime.js';
import {
  checkScheduleConflict,
  saveScheduledMeeting,
  updateScheduledMeeting,
  getNearbyUpcomingMeeting,
  getActiveMeetings,
  removeScheduledMeeting,
  syncMeetingsWithZoom,
  getCurrentLiveMeeting,
  updateMeetingRecording,
  getMeetingsPendingRecording,
  getMeetingsPendingSummary,
  getMeetingsPendingAiSummary,
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

// Setup file logger (Hanya aktif di lokal Windows, dinonaktifkan di Railway/Cloud agar disk tidak penuh)
const isCloud = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_STATIC_URL || process.env.DISABLE_FILE_LOG);
let logStream = null;

if (!isCloud) {
  try {
    const logPath = './bot.log';
    // Batasi ukuran log lokal maksimal 5MB agar tidak membengkak puluhan MB
    if (fs.existsSync(logPath) && fs.statSync(logPath).size > 5 * 1024 * 1024) {
      fs.truncateSync(logPath, 0);
    }
    logStream = fs.createWriteStream(logPath, { flags: 'a' });
    logStream.on('error', (err) => {
      origError.apply(console, ['⚠️ Gagal menulis ke bot.log:', err.message]);
    });
  } catch (e) {
    origError.apply(console, ['⚠️ Gagal menginisialisasi bot.log:', e.message]);
  }
}

const origLog = console.log;
const origError = console.error;

if (!isCloud && logStream) {
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
}

/**
 * Format pesan instruksi / panduan bot yang lengkap, rapi, dan informatif.
 */
function formatHelpMessage(senderName = 'Bapak/Ibu') {
  return [
    `Yth. *${senderName}*,`,
    `Saya adalah *Asisten Virtual Penjadwalan Rapat (Zoom & Google Meet)*.`,
    `Berikut adalah panduan format instruksi yang dapat Anda pergunakan:`,
    ``,
    `📅 *1. PEMBUATAN JADWAL RAPAT*`,
    `Anda dapat menyampaikan permohonan jadwal secara langsung dengan menyebutkan platform, waktu, dan agenda:`,
    `• _"buatkan zoom jam 14.00 untuk koordinasi tim finance"_`,
    `• _"buat zoom besok jam 10 pagi topik review bulanan rekam"_ *(Perekaman Cloud)*`,
    `• _"buatkan google meet jam 10 untuk TIM SOTS"_`,
    `• _"minta link meet sekarang untuk rapat direksi"_`,
    ``,
    `📋 *2. PEMERIKSAAN JADWAL TERDAFTAR*`,
    `Untuk meninjau seluruh agenda rapat yang aktif:`,
    `• _"cek jadwal zoom"_ atau _"cek jadwal meeting"_`,
    `• _"!jadwal"_ atau _"!list"_`,
    ``,
    `✏️ *3. PERUBAHAN JADWAL (RESCHEDULE)*`,
    `Untuk memperbarui waktu atau topik agenda:`,
    `• _"ubah zoom jam 14.00 jadi jam 16.00"_`,
    `• _"ganti jadwal zoom tim finance ke besok jam 10 pagi"_`,
    `• _"reschedule zoom [Meeting ID] ke jam 15.00"_`,
    ``,
    `🗑️ *4. PEMBATALAN RAPAT*`,
    `Untuk membatalkan agenda rapat tertentu:`,
    `• _"batalkan zoom jam 14.00"_`,
    `• _"hapus zoom tim finance"_`,
    `• _"hapus zoom [Meeting ID]"_`,
    ``,
    `📹 *5. PEREKAMAN RAPAT LANGSUNG (LIVE)*`,
    `Untuk merekam rapat yang sedang berlangsung:`,
    `• _"rekam"_ atau _"rekam zoom sekarang"_`,
    ``,
    `🛑 *6. MENGAKHIRI RAPAT BERLANGSUNG*`,
    `Untuk menyelesaikan dan menutup rapat yang sedang berjalan:`,
    `• _"akhiri meeting"_ atau _"stop zoom"_`,
    `• _"end boy"_`,
    ``,
    `📊 *7. LAPORAN KEHADIRAN & NOTULA RAPAT*`,
    `Untuk memperoleh rekap kehadiran dan catatan rapat:`,
    `• _"rekap meeting"_ atau _"!rekap [Meeting ID]"_`,
    ``,
    `💡 _Catatan: Di dalam grup WhatsApp, silakan tag/mention akun ini untuk menyampaikan instruksi._`
  ].join('\n');
}

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

  const isGMeet = meeting.platform === 'GMEET';
  const platformName = isGMeet ? 'Google Meet' : 'Zoom Meeting';
  const formattedTime = formatMeetingTime(meeting.startTime);

  const textMsg = [
    `📹 *NOTIFIKASI REKAMAN RAPAT ${platformName.toUpperCase()}*`,
    ``,
    `Yth. Bapak/Ibu,`,
    `Rekaman video untuk agenda pertemuan berikut telah selesai diproses dan siap diakses:`,
    ``,
    `📌 *Topik Agenda:* ${meeting.topic}`,
    `🗓️ *Waktu Pertemuan:* ${formattedTime}`,
    `🔗 *Tautan Video Rekaman ${isGMeet ? '(Google Drive)' : ''}:*`,
    `${recordings.shareUrl}`
  ];

  if (!isGMeet) {
    textMsg.push(``);
    textMsg.push(`🔑 *Passcode Rekaman:* ${recordings.password || '(Tanpa Passcode)'}`);
  }

  textMsg.push(``);
  textMsg.push(`Rekaman dapat disaksikan atau diunduh langsung melalui tautan di atas.`);

  try {
    await globalSock.sendMessage(targetPhone, { text: textMsg.join('\n') });
    console.log(`✅ Link rekaman meeting ID ${meeting.id} (${platformName}) berhasil dikirim ke ${targetPhone}!`);
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
      if (m.platform === 'GMEET') {
        const rec = await getGoogleMeetingRecordings(m.spaceName || m.id);
        if (rec && rec.shareUrl && rec.state === 'FILE_GENERATED') {
          console.log(`🎬 Mendeteksi rekaman selesai di Google Drive untuk meeting ${m.id} (${m.topic})`);
          await sendRecordingNotification(m, rec);
        }
      } else {
        const rec = await getMeetingRecordings(m.id);
        if (rec && rec.shareUrl) {
          console.log(`🎬 Mendeteksi rekaman selesai di Zoom untuk meeting ${m.id} (${m.topic})`);
          await sendRecordingNotification(m, rec);
        }
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
async function sendMeetingEndedSummary(meetingId, webhookObject = null, targetRecipient = null) {
  if (!globalSock) return false;
  let meeting = getScheduledMeetingById(meetingId);
  const isGMeet = meeting?.platform === 'GMEET' ||
                  String(meetingId).includes('-') ||
                  String(meetingId).startsWith('spaces/') ||
                  String(meetingId).startsWith('conferenceRecords/');

  // Jika meeting tidak terdaftar di database lokal (misal dibuat langsung dari web/aplikasi Zoom atau Google Meet)
  if (!meeting) {
    if (isGMeet) {
      try {
        const pastDetails = await getGooglePastMeetingDetails(meetingId);
        if (pastDetails) {
          meeting = {
            id: pastDetails.meetingCode || String(meetingId),
            platform: 'GMEET',
            spaceName: pastDetails.spaceName || '',
            topic: pastDetails.topic || 'Google Meet',
            startTime: pastDetails.startTime || new Date().toISOString(),
            duration: pastDetails.duration || 60,
            requesterPhone: targetRecipient || process.env.DEFAULT_NOTIFICATION_PHONE || process.env.ADMIN_PHONE || null,
            recordRequesterPhone: null,
            summarySent: false
          };
        }
      } catch (e) {
        // Ignored
      }
    } else {
      try {
        const pastDetails = await getPastMeetingDetails(meetingId);
        meeting = {
          id: String(meetingId),
          platform: 'ZOOM',
          topic: pastDetails?.topic || webhookObject?.topic || 'Zoom Meeting',
          startTime: pastDetails?.startTime || webhookObject?.start_time || new Date().toISOString(),
          duration: pastDetails?.duration || webhookObject?.duration || 60,
          requesterPhone: targetRecipient || process.env.DEFAULT_NOTIFICATION_PHONE || process.env.ADMIN_PHONE || null,
          recordRequesterPhone: null,
          summarySent: false
        };
      } catch (e) {
        // Ignored
      }
    }
  }

  if (!meeting) return false;

  // Jika targetRecipient diberikan secara eksplisit (misal user meminta via chat), kirim meskipun summarySent=true
  if (meeting.summarySent && !targetRecipient) {
    return false; // Sudah pernah dikirim otomatis
  }

  const targetPhone = targetRecipient || meeting.requesterPhone || meeting.recordRequesterPhone || process.env.DEFAULT_NOTIFICATION_PHONE || process.env.ADMIN_PHONE;
  if (!targetPhone) {
    console.warn(`⚠️ Tidak ada nomor tujuan untuk mengirim rekap meeting ${meeting.id}`);
    return false;
  }

  const defaultTopic = isGMeet ? 'Google Meet' : 'Zoom Meeting';
  console.log(`📊 Mengumpulkan data rekap peserta untuk meeting ${meeting.id} (${meeting.topic || defaultTopic})...`);

  let participants = [];
  let pastDetails = null;

  if (isGMeet) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        pastDetails = await getGooglePastMeetingDetails(meeting.spaceName || meeting.id);
        if (pastDetails && pastDetails.conferenceRecordName) {
          participants = await getGoogleMeetingParticipants(pastDetails.conferenceRecordName);
          if (participants.length > 0) break;
        }
      } catch (fetchErr) {
        console.error(`Percobaan ${attempt} mengambil peserta Google Meet ${meeting.id} gagal:`, fetchErr.message);
      }

      if (attempt < 3 && participants.length === 0) {
        await new Promise(r => setTimeout(r, 4000));
      }
    }
  } else {
    // Zoom retry loop
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
  }

  const topic = pastDetails?.topic || webhookObject?.topic || meeting.topic || defaultTopic;
  const startTime = pastDetails?.startTime || webhookObject?.start_time || webhookObject?.startTime || meeting.startTime;
  const endTime = pastDetails?.endTime || webhookObject?.end_time || webhookObject?.endTime || null;

  // Hitung durasi aktual meeting dari jam meeting dimulai hingga selesai
  let durationMinutes = 0;
  if (startTime && endTime) {
    const startMs = parseToDate(startTime).getTime();
    const endMs = parseToDate(endTime).getTime();
    if (!isNaN(startMs) && !isNaN(endMs) && endMs > startMs) {
      durationMinutes = Math.round((endMs - startMs) / 60000);
    }
  }

  if (!durationMinutes || durationMinutes <= 0) {
    durationMinutes = pastDetails?.duration || webhookObject?.duration || meeting.duration || 0;
  }

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

  // Cek apakah ringkasan notula rapat dari AI sudah siap
  let aiSummary = null;
  try {
    if (isGMeet) {
      aiSummary = await getGoogleMeetingSummary(pastDetails?.conferenceRecordName || meeting.spaceName || meeting.id);
    } else {
      aiSummary = await getZoomMeetingSummary(meeting.id);
    }
  } catch (aiErr) {
    // AI mungkin masih memproses ringkasan
  }

  const platformTitle = isGMeet ? 'GOOGLE MEET' : 'ZOOM MEETING';
  const aiProvider = isGMeet ? 'Google Gemini AI' : 'Zoom AI';

  const summaryMsg = [
    `📊 *LAPORAN KEHADIRAN ${platformTitle}*`,
    ``,
    `📌 *Topik:* ${topic}`,
    `⏱️ *Waktu:* ${timeRange}`,
    `⏳ *Total Durasi:* ${durationText}`,
    `👥 *Total Peserta Hadir:* ${participants.length} Orang`,
    ``,
    `━━━━━━━━━━━━━━━━━━━`,
    `*DAFTAR PESERTA YANG BERGABUNG:*`,
    ...participantLines,
    `━━━━━━━━━━━━━━━━━━━`
  ];

  if (aiSummary && (aiSummary.summaryOverview || aiSummary.summaryDetails?.length > 0 || aiSummary.nextSteps?.length > 0)) {
    summaryMsg.push(``);
    summaryMsg.push(`🤖 *RINGKASAN & NOTULA RAPAT (${aiProvider.toUpperCase()})*`);
    if (aiSummary.summaryOverview) {
      summaryMsg.push(``);
      summaryMsg.push(`📖 *Rangkuman Pembahasan:*`);
      summaryMsg.push(aiSummary.summaryOverview);
    }
    if (aiSummary.summaryDetails && aiSummary.summaryDetails.length > 0) {
      summaryMsg.push(``);
      summaryMsg.push(`🔍 *Poin-Poin Penting:*`);
      aiSummary.summaryDetails.forEach(d => {
        if (d.label) summaryMsg.push(`• *${d.label}:* ${d.summary}`);
        else summaryMsg.push(`• ${d.summary}`);
      });
    }
    if (aiSummary.nextSteps && aiSummary.nextSteps.length > 0) {
      summaryMsg.push(``);
      summaryMsg.push(`✅ *Tindak Lanjut / Action Items:*`);
      aiSummary.nextSteps.forEach((s, idx) => {
        summaryMsg.push(`${idx + 1}. ${s}`);
      });
    }
    if (aiSummary.summaryDocUrl) {
      summaryMsg.push(``);
      summaryMsg.push(`📄 *Dokumen Notula Lengkap:* ${aiSummary.summaryDocUrl}`);
    }
    summaryMsg.push(``);
    summaryMsg.push(`━━━━━━━━━━━━━━━━━━━`);
    summaryMsg.push(`_Laporan kehadiran & notula otomatis disusun oleh ${aiProvider}._`);
  } else {
    summaryMsg.push(`_Laporan otomatis dibuat setelah meeting berakhir._`);
  }

  try {
    await globalSock.sendMessage(targetPhone, { text: summaryMsg.join('\n') });
    console.log(`✅ Laporan rekap peserta meeting ID ${meeting.id} (${participants.length} peserta) berhasil dikirim ke ${targetPhone}!`);
    updateMeetingRecording(meeting.id, {
      summarySent: true,
      aiSummarySent: Boolean(aiSummary)
    });
    return true;
  } catch (sendErr) {
    console.error(`Gagal mengirim laporan rekap ke ${targetPhone}:`, sendErr.message);
    return false;
  }
}

/**
 * Mengirimkan pesan ringkasan & notula rapat yang baru selesai disusun oleh AI (Zoom / Google Meet).
 */
async function sendAiSummaryNotification(meetingId, summaryObj = null) {
  if (!globalSock) return;
  const meeting = getScheduledMeetingById(meetingId);
  const targetPhone = meeting?.requesterPhone || meeting?.recordRequesterPhone;
  if (!targetPhone) return;

  // Jika sudah dikirimkan, jangan kirim ulang agar tidak dobel
  if (meeting?.aiSummarySent) return;

  const isGMeet = meeting?.platform === 'GMEET' ||
                  String(meetingId).includes('-') ||
                  String(meetingId).startsWith('spaces/');
  const aiProvider = isGMeet ? 'Google Gemini AI' : 'Zoom AI';

  let aiSummary = null;
  if (summaryObj && (summaryObj.summary_overview || summaryObj.summary_details || summaryObj.next_steps)) {
    const nextSteps = Array.isArray(summaryObj.next_steps)
      ? summaryObj.next_steps.map(s => typeof s === 'string' ? s : s.step).filter(Boolean)
      : [];
    const summaryDetails = Array.isArray(summaryObj.summary_details)
      ? summaryObj.summary_details.map(d => ({ label: d.label || '', summary: d.summary || '' })).filter(d => d.summary)
      : [];
    aiSummary = {
      summaryTitle: summaryObj.summary_title || '',
      summaryOverview: summaryObj.summary_overview || '',
      summaryDetails,
      nextSteps
    };
  } else if (isGMeet) {
    aiSummary = await getGoogleMeetingSummary(meeting?.spaceName || meetingId);
  } else {
    aiSummary = await getZoomMeetingSummary(meetingId);
  }

  if (!aiSummary || (!aiSummary.summaryOverview && aiSummary.summaryDetails.length === 0 && aiSummary.nextSteps.length === 0)) {
    return;
  }

  const defaultTopic = isGMeet ? 'Google Meet' : 'Zoom Meeting';
  const topic = meeting?.topic || aiSummary.summaryTitle || defaultTopic;
  const lines = [
    `🤖 *RINGKASAN & NOTULA RAPAT (${aiProvider.toUpperCase()})*`,
    ``,
    `📌 *Topik:* ${topic}`,
    `🆔 *Meeting ID:* ${meetingId}`,
    ``,
    `━━━━━━━━━━━━━━━━━━━`
  ];

  if (aiSummary.summaryOverview) {
    lines.push(`📖 *Rangkuman Pembahasan:*`);
    lines.push(aiSummary.summaryOverview);
    lines.push(``);
  }

  if (aiSummary.summaryDetails && aiSummary.summaryDetails.length > 0) {
    lines.push(`🔍 *Poin-Poin Penting:*`);
    aiSummary.summaryDetails.forEach(d => {
      if (d.label) lines.push(`• *${d.label}:* ${d.summary}`);
      else lines.push(`• ${d.summary}`);
    });
    lines.push(``);
  }

  if (aiSummary.nextSteps && aiSummary.nextSteps.length > 0) {
    lines.push(`✅ *Tindak Lanjut / Action Items:*`);
    aiSummary.nextSteps.forEach((s, idx) => {
      lines.push(`${idx + 1}. ${s}`);
    });
    lines.push(``);
  }

  if (aiSummary.summaryDocUrl) {
    lines.push(`📄 *Dokumen Notula Lengkap:* ${aiSummary.summaryDocUrl}`);
    lines.push(``);
  }

  lines.push(`━━━━━━━━━━━━━━━━━━━`);
  lines.push(`_Notula otomatis disusun oleh ${aiProvider}._`);

  try {
    await globalSock.sendMessage(targetPhone, { text: lines.join('\n') });
    console.log(`✅ Notula AI meeting ${meetingId} berhasil dikirim ke ${targetPhone}!`);
    updateMeetingRecording(meetingId, { aiSummarySent: true });
  } catch (err) {
    console.error(`Gagal mengirim notula AI ke ${targetPhone}:`, err.message);
  }
}

/**
 * Pengecekan berkala (polling) untuk meeting yang sudah selesai dan belum dikirimkan rekap pesertanya.
 */
async function pollPendingSummaries() {
  if (!globalSock) return;

  // 1. Cek meeting terjadwal di database jadwal lokal
  const pending = getMeetingsPendingSummary();
  for (const m of pending) {
    try {
      if (m.platform === 'GMEET') {
        const pastDetails = await getGooglePastMeetingDetails(m.spaceName || m.id);
        if (pastDetails && pastDetails.isEnded) {
          console.log(`🏁 Mendeteksi meeting Google Meet ${m.id} (${m.topic}) telah selesai, memproses rekap...`);
          await sendMeetingEndedSummary(m.id, pastDetails);
        }
      } else {
        const pastDetails = await getPastMeetingDetails(m.id);
        if (pastDetails && (pastDetails.endTime || pastDetails.duration > 0)) {
          console.log(`🏁 Mendeteksi meeting ${m.id} (${m.topic}) telah selesai di Zoom, memproses rekap...`);
          await sendMeetingEndedSummary(m.id, pastDetails);
        }
      }
    } catch (err) {
      // Ignored
    }
  }

  // 2. Cek meeting Zoom & Google Meet terbaru yang baru saja selesai
  const defaultRecipient = process.env.DEFAULT_NOTIFICATION_PHONE || process.env.ADMIN_PHONE;
  if (defaultRecipient) {
    try {
      const recentEnded = await getRecentEndedMeetings(3);
      for (const rm of recentEnded) {
        const local = getScheduledMeetingById(rm.id);
        if (!local || !local.summarySent) {
          await sendMeetingEndedSummary(rm.id, null, defaultRecipient);
        }
      }
    } catch (err) {
      // Ignored
    }

    try {
      const recentGMeet = await getRecentEndedGoogleMeetings(3);
      for (const gm of recentGMeet) {
        const local = getScheduledMeetingById(gm.id) || getScheduledMeetingById(gm.spaceName);
        if (!local || !local.summarySent) {
          await sendMeetingEndedSummary(gm.spaceName || gm.id, null, defaultRecipient);
        }
      }
    } catch (err) {
      // Ignored
    }
  }
}

/**
 * Pengecekan berkala (polling) untuk notula AI yang baru selesai diproses oleh server.
 */
async function pollPendingAiSummaries() {
  if (!globalSock) return;
  const pending = getMeetingsPendingAiSummary();
  if (pending.length === 0) return;

  for (const m of pending) {
    try {
      if (m.platform === 'GMEET') {
        const summary = await getGoogleMeetingSummary(m.spaceName || m.id);
        if (summary) {
          console.log(`🤖 Mendeteksi notula AI untuk Google Meet ${m.id} (${m.topic}) telah siap, mengirimkan...`);
          await sendAiSummaryNotification(m.id, summary);
        }
      } else {
        const summary = await getZoomMeetingSummary(m.id);
        if (summary) {
          console.log(`🤖 Mendeteksi notula AI untuk meeting ${m.id} (${m.topic}) telah siap, mengirimkan...`);
          await sendAiSummaryNotification(m.id, summary);
        }
      }
    } catch (err) {
      // Ignored
    }
  }
}

// Cek status rekap & notula meeting yang selesai setiap 2 menit
setInterval(() => {
  pollPendingSummaries().catch(() => {});
  pollPendingAiSummaries().catch(() => {});
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
        • "rekam" (ketika meeting berlangsung)<br>
        • "end boy" (otomatis menghentikan meeting yang sedang berlangsung)
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

        // Event ringkasan notula Zoom AI selesai dibuat (Zoom AI Companion)
        if (data.event === 'meeting.summary_completed') {
          const obj = data.payload?.object;
          const mId = obj?.id || obj?.meeting_id;
          if (mId) {
            console.log(`🤖 [Zoom Webhook] Notula AI selesai untuk meeting ID: ${mId}`);
            sendAiSummaryNotification(mId, obj).catch(err => {
              console.error(`Gagal memproses notula AI webhook meeting ${mId}:`, err.message);
            });
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

  // API Cek Notula & Rekap Meeting Terakhir (JSON)
  if (req.url.startsWith('/api/latest-summary')) {
    try {
      const recent = await getRecentEndedMeetings(1);
      if (recent.length === 0) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ error: 'Belum ada meeting yang selesai.' }));
      }
      const mId = recent[0].id;
      const details = await getPastMeetingDetails(mId);
      const participants = await getPastMeetingParticipants(mId);
      const aiSummary = await getZoomMeetingSummary(mId);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({
        meeting: details || recent[0],
        participants,
        aiSummary
      }, null, 2));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  // API Kirim Rekap Manual ke WhatsApp via HTTP
  if (req.url.startsWith('/api/send-summary')) {
    try {
      const urlObj = new URL(req.url, `http://${req.headers.host}`);
      let meetingId = urlObj.searchParams.get('meetingId');
      const phoneParam = urlObj.searchParams.get('phone');
      const phone = phoneParam ? (phoneParam.includes('@') ? phoneParam : `${phoneParam}@s.whatsapp.net`) : null;

      if (!meetingId) {
        const recent = await getRecentEndedMeetings(1);
        if (recent.length > 0) meetingId = recent[0].id;
      }

      if (!meetingId) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ error: 'Meeting ID tidak ditemukan.' }));
      }

      const ok = await sendMeetingEndedSummary(meetingId, null, phone);
      res.writeHead(ok ? 200 : 400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ success: ok, meetingId, sentTo: phone }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: err.message }));
    }
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
      const isGroup = remoteJid.endsWith('@g.us');
      const isPrivateChat = !isGroup;

      // Cek apakah bot di-tag / di-mention di grup
      const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
      const mentionedJid = contextInfo?.mentionedJid || [];
      const botNumber = sock.user?.id ? sock.user.id.split(':')[0] : '';
      const isBotMentioned = Boolean(botNumber && mentionedJid.some(jid => jid.startsWith(botNumber)));

      // Bersihkan mention tag bot dari teks (misal "@62812345678 buatkan zoom jam 2")
      let cleanText = messageText.trim();
      if (botNumber) {
        cleanText = cleanText.replace(new RegExp(`@${botNumber}\\b`, 'gi'), '').trim();
      }
      cleanText = cleanText.replace(/^@bot\b/i, '').trim();

      // Cegah looping jika pesan berasal dari akun bot itu sendiri
      if (isFromMe) continue;

      // Proteksi Grup: Di dalam grup WhatsApp, abaikan obrolan biasa yang BUKAN tentang meeting/jadwal
      // jika bot tidak di-tag/di-mention langsung oleh anggota grup (mencegah bot ikut-ikutan obrolan lain)
      if (isGroup && !isBotMentioned) {
        const hasMeetingContext = /(?:zoom|gmeet|google\s+meet|\bmeet\b|meeting|miting|jadwal|rapat)/i.test(cleanText) ||
                                  /^[!/#]/.test(cleanText);
        if (!hasMeetingContext) {
          continue; // Lewati obrolan biasa antar anggota grup agar bot tidak ikut-ikutan
        }
      }

      // Cegah looping jika pesan merupakan balasan teks template bot
      if (
        messageText.startsWith('Yth. Bapak/Ibu') ||
        messageText.startsWith('Mohon maaf Bapak/Ibu') ||
        messageText.startsWith('Pemberitahuan Jadwal') ||
        messageText.startsWith('Berikut Pak/Bu') ||
        messageText.startsWith('Mohon maaf Pak/Bu') ||
        messageText.startsWith('Untuk di jam') ||
        messageText.startsWith('*✅ Link Zoom Meeting') ||
        messageText.startsWith('✅ *Jadwal Zoom') ||
        messageText.startsWith('✅ *Konfirmasi') ||
        messageText.startsWith('📊 *LAPORAN') ||
        messageText.startsWith('📹 *NOTIFIKASI') ||
        messageText.startsWith('📅') ||
        messageText.startsWith('🎬') ||
        messageText.startsWith('👋 Halo') ||
        messageText.startsWith('Maaf ')
      ) {
        continue;
      }

      // -----------------------------------------------------------------------
      // A. CEK PERINTAH BATALKAN / HAPUS MEETING
      // -----------------------------------------------------------------------
      const cancelCmd = parseCancelCommand(cleanText);
      if (cancelCmd) {
        console.log(`\n🗑️ [Perintah Batal Masuk] Dari: ${senderName} (${remoteJid}): "${cleanText}"`);
        try {
          await sock.readMessages([msg.key]);

          const activeMeetings = getActiveMeetings();
          let matchedMeeting = null;

          if (cancelCmd.meetingId) {
            matchedMeeting = activeMeetings.find(m => String(m.id).includes(cancelCmd.meetingId));
          } else if (cancelCmd.matchedHour !== null) {
            matchedMeeting = activeMeetings.find(m => {
              const parts = getDatePartsInTimezone(m.startTime, process.env.DEFAULT_TIMEZONE || 'Asia/Jakarta');
              const hourMatch = parts.hour === cancelCmd.matchedHour ||
                                (cancelCmd.matchedHour > 12 && parts.hour === cancelCmd.matchedHour - 12) ||
                                (cancelCmd.matchedHour <= 12 && parts.hour === cancelCmd.matchedHour + 12);
              if (!hourMatch) return false;
              if (cancelCmd.matchedMinute !== null && cancelCmd.matchedMinute !== undefined && cancelCmd.matchedMinute > 0) {
                return parts.minute === cancelCmd.matchedMinute;
              }
              return true;
            });
          } else if (cancelCmd.targetTopic) {
            const term = cancelCmd.targetTopic.toLowerCase();
            matchedMeeting = activeMeetings.find(m => {
              const top = (m.topic || '').toLowerCase();
              return top.includes(term) || term.includes(top);
            });
          } else if (activeMeetings.length === 1) {
            matchedMeeting = activeMeetings[0];
          }

          if (!matchedMeeting) {
            const noMatchText = `Mohon maaf Bapak/Ibu, tidak ditemukan jadwal meeting yang cocok untuk dibatalkan.\nKetik *cek jadwal zoom* untuk melihat daftar jadwal yang masih aktif.`;
            await sock.sendMessage(remoteJid, { text: noMatchText }, { quoted: msg });
            continue;
          }

          const isGMeet = matchedMeeting.platform === 'GMEET';
          if (!isGMeet) {
            try {
              await deleteZoomMeeting(matchedMeeting.id);
            } catch (delApiErr) {
              console.warn(`Peringatan saat panggil Zoom API delete (${delApiErr.message}), tetap bersihkan lokal.`);
            }
          }

          removeScheduledMeeting(matchedMeeting.id);

          const formattedTime = formatMeetingTime(matchedMeeting.startTime);
          const platformName = isGMeet ? 'Google Meet' : 'Zoom';
          const replyCancel = [
            `✅ *Jadwal ${platformName} Berhasil Dibatalkan & Dihapus:*`,
            `📌 *Topik:* ${matchedMeeting.topic}`,
            `🗓️ *Waktu:* ${formattedTime}`,
            `🆔 *ID Meeting:* ${matchedMeeting.id}`,
            ``,
            `Jadwal pada jam tersebut sekarang sudah kosong dan bisa digunakan kembali.`
          ].join('\n');

          await sock.sendMessage(remoteJid, { text: replyCancel }, { quoted: msg });
          console.log(`✅ Meeting ${matchedMeeting.id} (${matchedMeeting.topic}) [${platformName}] berhasil dibatalkan.`);
        } catch (cancelErr) {
          console.error('❌ Error memproses pembatalan meeting:', cancelErr);
        }
        continue;
      }

      // -----------------------------------------------------------------------
      // B. CEK PERINTAH UBAH / EDIT / RESCHEDULE JADWAL MEETING
      // -----------------------------------------------------------------------
      const editCmd = parseEditCommand(cleanText);
      if (editCmd) {
        console.log(`\n✏️ [Perintah Edit Masuk] Dari: ${senderName} (${remoteJid}): "${cleanText}"`);
        try {
          await sock.readMessages([msg.key]);

          const activeMeetings = getActiveMeetings();
          let matchedMeeting = null;

          if (editCmd.meetingId) {
            matchedMeeting = activeMeetings.find(m => String(m.id).includes(editCmd.meetingId));
          } else if (editCmd.targetOldHour !== null) {
            matchedMeeting = activeMeetings.find(m => {
              const parts = getDatePartsInTimezone(m.startTime, process.env.DEFAULT_TIMEZONE || 'Asia/Jakarta');
              return parts.hour === editCmd.targetOldHour ||
                     (editCmd.targetOldHour > 12 && parts.hour === editCmd.targetOldHour - 12) ||
                     (editCmd.targetOldHour <= 12 && parts.hour === editCmd.targetOldHour + 12);
            });
          } else if (editCmd.targetTopic) {
            const term = editCmd.targetTopic.toLowerCase();
            matchedMeeting = activeMeetings.find(m => {
              const top = (m.topic || '').toLowerCase();
              return top.includes(term) || term.includes(top);
            });
          }
          
          if (!matchedMeeting && activeMeetings.length === 1 && (editCmd.newStartTime || editCmd.newTopic)) {
            matchedMeeting = activeMeetings[0];
          }

          // Abaikan jika tidak ada meeting yang cocok atau tidak ada instruksi perubahan waktu/topik yang jelas
          if (!matchedMeeting || (!editCmd.newStartTime && !editCmd.newTopic)) {
            continue;
          }

          const isGMeet = matchedMeeting.platform === 'GMEET';
          const newStartTime = editCmd.newStartTime || matchedMeeting.startTime;
          const newTopic = editCmd.newTopic || matchedMeeting.topic;
          const duration = matchedMeeting.duration || 60;

          // Cek bentrok jika waktu berubah (hanya untuk Zoom, karena host Zoom tidak bisa double meeting)
          if (!isGMeet && editCmd.newStartTime && editCmd.newStartTime !== matchedMeeting.startTime) {
            const { hasConflict, conflictingMeeting } = await checkScheduleConflict(newStartTime, duration, matchedMeeting.id);
            if (hasConflict && conflictingMeeting) {
              const confTime = formatMeetingTime(conflictingMeeting.startTime);
              const replyConflict = `Mohon maaf Pak/Bu, tidak dapat mengubah jadwal ke jam tersebut karena di jam segitu (${confTime}) sudah ada meeting tim *${conflictingMeeting.topic}*. Mohon pilih jam lain ya.`;
              await sock.sendMessage(remoteJid, { text: replyConflict }, { quoted: msg });
              continue;
            }
          }

          // Panggil Zoom API untuk update meeting jika platform Zoom
          if (!isGMeet) {
            try {
              await updateZoomMeeting(matchedMeeting.id, {
                topic: newTopic,
                startTime: newStartTime,
                duration: duration
              });
            } catch (zoomUpdateErr) {
              console.error('Gagal update meeting di server Zoom:', zoomUpdateErr.message);
              const errMsg = `Mohon maaf, terjadi kendala saat memperbarui meeting di Zoom: ${zoomUpdateErr.message}`;
              await sock.sendMessage(remoteJid, { text: errMsg }, { quoted: msg });
              continue;
            }
          }

          // Perbarui di database lokal
          updateScheduledMeeting(matchedMeeting.id, {
            topic: newTopic,
            startTime: newStartTime,
            duration: duration
          });

          const formattedNewTime = formatMeetingTime(newStartTime);
          const platformName = isGMeet ? 'Google Meet' : 'Zoom';
          const replySuccessEdit = [
            `✅ *Jadwal ${platformName} Berhasil Diperbarui / Reschedule:*`,
            `📌 *Topik:* ${newTopic}`,
            `🗓️ *Waktu Baru:* ${formattedNewTime}`,
            `🆔 *ID Meeting:* ${matchedMeeting.id}`,
            (!isGMeet && matchedMeeting.passcode) ? `🔑 *Passcode:* ${matchedMeeting.passcode}` : null,
            `🔗 *Link ${platformName}:*`,
            `${matchedMeeting.joinUrl}`,
            ``,
            `Link meeting tetap sama dan jadwal sudah diperbarui.`
          ].filter(Boolean).join('\n');

          await sock.sendMessage(remoteJid, { text: replySuccessEdit }, { quoted: msg });
          console.log(`✅ Meeting ${matchedMeeting.id} [${platformName}] berhasil diupdate ke waktu: ${formattedNewTime}, topik: ${newTopic}`);
        } catch (editErr) {
          console.error('❌ Error memproses edit meeting:', editErr);
        }
        continue;
      }

      // -----------------------------------------------------------------------
      // C. CEK PERINTAH LIHAT DAFTAR JADWAL ZOOM
      // -----------------------------------------------------------------------
      const listCmd = parseListCommand(cleanText);
      if (listCmd) {
        console.log(`\n📋 [Perintah Cek Jadwal] Dari: ${senderName} (${remoteJid}): "${cleanText}"`);
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
          lines.push(`_Untuk mengubah jadwal, contoh: "ubah zoom jam ${new Date(validMeetings[0].startTime).getHours()} jadi jam 4 sore"_`);

          await sock.sendMessage(remoteJid, { text: lines.join('\n') }, { quoted: msg });
        } catch (listErr) {
          console.error('❌ Error menampilkan daftar meeting:', listErr);
        }
        continue;
      }

      // -----------------------------------------------------------------------
      // D. CEK PERINTAH REKAM LIVE (Meeting Sedang Berlangsung)
      // -----------------------------------------------------------------------
      const liveRecCmd = parseLiveRecordCommand(cleanText);
      if (liveRecCmd) {
        console.log(`\n📹 [Perintah Rekam Live Masuk] Dari: ${senderName} (${remoteJid}): "${cleanText}"`);
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
      // E. CEK PERINTAH HENTIKAN MEETING (END BOY / END MEETING)
      // -----------------------------------------------------------------------
      const endCmd = parseEndMeetingCommand(cleanText);
      if (endCmd) {
        console.log(`\n🛑 [Perintah End Boy Masuk] Dari: ${senderName} (${remoteJid}): "${cleanText}"`);
        try {
          await sock.readMessages([msg.key]);

          // 1. Cari meeting yang sedang live / berlangsung
          let targetMeetingId = endCmd.meetingId;
          let targetTopic = 'Zoom Meeting';

          if (targetMeetingId) {
            const scheduled = getScheduledMeetingById(targetMeetingId);
            if (scheduled) targetTopic = scheduled.topic;
          } else {
            // Cek ke server Zoom apakah ada meeting live saat ini
            try {
              const liveZoomMeetings = await getLiveZoomMeetings();
              if (liveZoomMeetings.length > 0) {
                targetMeetingId = liveZoomMeetings[0].id;
                targetTopic = liveZoomMeetings[0].topic;
              }
            } catch (liveErr) {
              console.warn('Gagal cek live meetings via Zoom API:', liveErr.message);
            }

            // Fallback ke meeting live terjadwal di lokal
            if (!targetMeetingId) {
              const localLive = getCurrentLiveMeeting();
              if (localLive) {
                targetMeetingId = localLive.id;
                targetTopic = localLive.topic;
              } else {
                // Cek jika hanya ada 1 meeting aktif di database
                const active = getActiveMeetings();
                if (active.length === 1) {
                  targetMeetingId = active[0].id;
                  targetTopic = active[0].topic;
                }
              }
            }
          }

          if (!targetMeetingId) {
            const noLiveMsg = `Mohon maaf Pak/Bu, saat ini tidak terdeteksi adanya meeting Zoom yang sedang aktif/berlangsung untuk dihentikan.\nKetik *cek jadwal zoom* untuk melihat daftar jadwal meeting.`;
            await sock.sendMessage(remoteJid, { text: noLiveMsg }, { quoted: msg });
            continue;
          }

          // 2. Kirim sinyal akhiri meeting ke Zoom API
          console.log(`🛑 Menghentikan meeting ID ${targetMeetingId} (${targetTopic}) di Zoom...`);
          try {
            await endZoomMeeting(targetMeetingId);
          } catch (endErr) {
            console.error(`Gagal menghentikan meeting ${targetMeetingId} via Zoom API:`, endErr.message);
            if (endErr.message.includes('404') || endErr.message.includes('3001')) {
              await sock.sendMessage(remoteJid, {
                text: `Meeting ID *${targetMeetingId}* sudah selesai atau tidak aktif lagi di Zoom.`
              }, { quoted: msg });
              continue;
            }
            throw endErr;
          }

          // Format waktu sekarang (WIB/sesuai timezone)
          const nowStr = new Intl.DateTimeFormat('id-ID', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
            timeZone: process.env.DEFAULT_TIMEZONE || 'Asia/Jakarta'
          }).format(new Date());

          const replyEnd = [
            `🛑 *Meeting Zoom Berhasil Dihentikan!*`,
            ``,
            `📌 *Topik:* ${targetTopic}`,
            `🆔 *Meeting ID:* ${targetMeetingId}`,
            `⏱️ *Waktu Selesai:* ${nowStr} WIB`,
            ``,
            `Meeting telah resmi diakhiri untuk semua peserta.`,
            `📊 _Laporan rekap kehadiran & notula rapat sedang disiapkan dan akan otomatis dikirimkan sesaat lagi..._`
          ].join('\n');

          await sock.sendMessage(remoteJid, { text: replyEnd }, { quoted: msg });
          console.log(`✅ Meeting ${targetMeetingId} berhasil dihentikan oleh ${senderName} (${remoteJid})`);

          // Jadwalkan pengiriman laporan rekap kehadiran & notula 8 detik kemudian
          setTimeout(() => {
            sendMeetingEndedSummary(targetMeetingId, null, remoteJid).catch(err => {
              console.error(`Gagal mengirimkan rekap pasca end boy meeting ${targetMeetingId}:`, err.message);
            });
          }, 8000);

        } catch (endCmdErr) {
          console.error('❌ Error saat memproses end boy:', endCmdErr);
          await sock.sendMessage(remoteJid, {
            text: `Maaf Pak/Bu, terjadi kendala saat menghentikan meeting di Zoom: ${endCmdErr.message}`
          }, { quoted: msg });
        }
        continue;
      }

      // -----------------------------------------------------------------------
      // F. CEK PERINTAH REKAP KEHADIRAN & NOTULA ZOOM AI (!rekap, !summary, rekap meeting)
      // -----------------------------------------------------------------------
      const summaryCmd = parseSummaryCommand(cleanText);
      if (summaryCmd) {
        console.log(`\n📊 [Perintah Rekap/Summary Masuk] Dari: ${senderName} (${remoteJid}): "${cleanText}"`);
        try {
          await sock.readMessages([msg.key]);

          let targetMeetingId = summaryCmd.meetingId;
          if (!targetMeetingId) {
            const activeList = getActiveMeetings();
            const lastMeeting = activeList[activeList.length - 1];
            if (lastMeeting) {
              targetMeetingId = lastMeeting.spaceName || lastMeeting.id;
            }
          }
          if (!targetMeetingId) {
            const recent = await getRecentEndedMeetings(1);
            if (recent.length > 0) {
              targetMeetingId = recent[0].id;
            }
          }
          if (!targetMeetingId) {
            const recentGMeet = await getRecentEndedGoogleMeetings(1);
            if (recentGMeet.length > 0) {
              targetMeetingId = recentGMeet[0].spaceName || recentGMeet[0].id;
            }
          }

          if (!targetMeetingId) {
            const replyNoMeeting = `Maaf Pak/Bu, tidak ditemukan meeting yang baru selesai di akun Zoom maupun Google Meet.\nAnda bisa menyertakan Meeting ID atau Kode Meet secara spesifik, contoh:\n*!rekap 87103747663* (Zoom)\n*!rekap pcd-gzmt-gco* (Google Meet)`;
            await sock.sendMessage(remoteJid, { text: replyNoMeeting }, { quoted: msg });
            continue;
          }

          await sock.sendMessage(remoteJid, {
            text: `⏳ Sedang mengumpulkan data kehadiran dan notula AI untuk meeting *${targetMeetingId}*, mohon tunggu sebentar...`
          }, { quoted: msg });

          const ok = await sendMeetingEndedSummary(targetMeetingId, null, remoteJid);
          if (!ok) {
            const failMsg = `⚠️ Maaf, belum dapat mengambil rekap untuk meeting *${targetMeetingId}*.\nPastikan meeting tersebut sudah berakhir di server Zoom atau Google Meet.`;
            await sock.sendMessage(remoteJid, { text: failMsg }, { quoted: msg });
          }
        } catch (sumErr) {
          console.error('❌ Error memproses perintah rekap/summary:', sumErr);
        }
        continue;
      }

      // -----------------------------------------------------------------------
      // F. CEK PERINTAH BANTUAN / PANDUAN (!info, !help, Mention Grup, Sapaan PC)
      // -----------------------------------------------------------------------
      const helpCmd = parseHelpCommand(cleanText, { isGroup, isBotMentioned, isPrivateChat });
      if (helpCmd) {
        console.log(`\n💡 [Petunjuk/Panduan Diminta] Dari: ${senderName} (${remoteJid}, trigger: ${helpCmd.trigger}): "${cleanText}"`);
        try {
          await sock.readMessages([msg.key]);
          const helpText = formatHelpMessage(senderName);
          await sock.sendMessage(remoteJid, { text: helpText }, { quoted: msg });
          console.log(`✅ Pesan bantuan berhasil dikirimkan ke ${remoteJid}`);
        } catch (helpErr) {
          console.error('❌ Error mengirim pesan bantuan:', helpErr);
        }
        continue;
      }

      // -----------------------------------------------------------------------
      // F. PROSES PERINTAH MEMBUAT MEETING (ZOOM & GOOGLE MEET)
      // -----------------------------------------------------------------------
      let command = parseMeetingCommand(cleanText);

      // Fallback Cerdas: Jika regex lokal belum menangkap dan fitur Gemini AI diaktifkan
      if (!command && isGeminiEnabled()) {
        const isPrivateChat = !isGroup;
        // Di grup WhatsApp, hanya layani Gemini jika bot di-mention/di-tag langsung
        // agar bot tidak pernah "ikut-ikutan" percakapan bebas anggota grup
        const allowGemini = isPrivateChat || (isGroup && isBotMentioned);
        if (allowGemini) {
          try {
            console.log(`🤖 [Gemini AI Fallback] Menganalisis pesan dari ${senderName} (${remoteJid}): "${cleanText}"`);
            const aiRes = await extractMeetingDetails(cleanText, senderName);
            if (aiRes) {
              if (aiRes.intent === 'CREATE_MEETING') {
                if (aiRes.needsMoreInfo) {
                  await sock.readMessages([msg.key]);
                  await sock.sendMessage(remoteJid, { text: aiRes.replyMessage }, { quoted: msg });
                  continue;
                }
                command = {
                  platform: aiRes.platform || 'ZOOM',
                  topic: aiRes.topic || (aiRes.platform === 'GMEET' ? 'Google Meet' : 'Zoom Meeting'),
                  startTime: aiRes.startTime,
                  durationMinutes: aiRes.durationMinutes || 60,
                  autoRecord: true,
                  autoSummary: true
                };
                console.log(`🤖 [Gemini AI Berhasil Ekstraksi] Platform: ${command.platform}, Topik: "${command.topic}", Waktu: ${command.startTime}`);
              } else if (aiRes.intent === 'OTHER' && (isPrivateChat || isBotMentioned)) {
                await sock.readMessages([msg.key]);
                await sock.sendMessage(remoteJid, { text: aiRes.replyMessage }, { quoted: msg });
                continue;
              }
            }
          } catch (aiErr) {
            console.warn('⚠️ Gagal memproses fallback Gemini:', aiErr.message);
          }
        }
      }

      // Jika TIDAK ADA perintah meeting yang valid, abaikan sama sekali (tidak perlu dijawab)
      if (!command) {
        continue;
      }

      console.log(`\n📩 [Perintah Meeting Masuk] Dari: ${senderName} (${remoteJid}): "${cleanText}"`);
      console.log(`📋 [Hasil Parser Template] Topik: "${command.topic}", Waktu: ${command.startTime}, AutoRecord: ${command.autoRecord}`);

      try {
        // Beri tanda centang biru (read)
        await sock.readMessages([msg.key]);

        // 2. CEK JADWAL BENTROK (Hanya untuk Zoom, karena 1 akun host Zoom tidak bisa double meeting)
        if (command.platform === 'ZOOM') {
          const { hasConflict, conflictingMeeting } = await checkScheduleConflict(command.startTime, command.durationMinutes, null, 'ZOOM');
          if (hasConflict && conflictingMeeting) {
            const confTime = formatMeetingTime(conflictingMeeting.startTime);
            const replyConflict = `Mohon maaf Bapak/Ibu, pada waktu tersebut (${confTime}) akun Zoom sedang dipergunakan untuk agenda *${conflictingMeeting.topic}*.\n\n` +
              `💡 _Alternatif Solusi: Anda dapat menggunakan Google Meet (contoh: "buatkan gmeet jam 10") atau menjadwalkan Zoom pada waktu lain agar tidak bertabrakan._`;
            await sock.sendMessage(remoteJid, { text: replyConflict }, { quoted: msg });
            console.log(`⚠️ Ditolak: Jadwal Zoom bentrok dengan tim ${conflictingMeeting.topic} (${confTime})`);
            continue;
          }
        }

        // 3. Buat Meeting di Google Meet atau Zoom
        if (command.platform === 'GMEET') {
          console.log('📞 Menghubungi Google Meet API...');
          try {
            const meeting = await createGoogleMeeting({
              topic: command.topic,
              startTime: command.startTime,
              duration: command.durationMinutes,
              autoRecord: command.autoRecord,
              autoSummary: command.autoSummary
            });

            // Simpan meeting ke database jadwal lokal agar terdeteksi bentrok
            saveScheduledMeeting({
              meetingId: meeting.meetingCode || meeting.spaceName,
              platform: 'GMEET',
              spaceName: meeting.spaceName,
              topic: command.topic,
              startTime: command.startTime,
              duration: command.durationMinutes,
              joinUrl: meeting.joinUrl,
              passcode: '',
              autoRecord: meeting.autoRecord,
              requesterPhone: remoteJid,
              recordRequesterPhone: remoteJid
            });

            const formattedTime = formatMeetingTime(command.startTime);

            // Format balasan WhatsApp resmi & formal
            const replySuccess = [
              `Yth. Bapak/Ibu,`,
              `Berikut informasi tautan Google Meet yang telah berhasil dibuat:`,
              ``,
              `📌 *Topik Agenda:* ${meeting.topic}`,
              `🗓️ *Waktu Pelaksanaan:* ${formattedTime}`,
              `🔗 *Tautan Google Meet:*`,
              `${meeting.joinUrl}`,
              `🆔 *Kode Meeting:* ${meeting.meetingCode || meeting.spaceName}`,
              `🚪 *Akses Masuk:* Langsung Masuk (Tanpa menunggu persetujuan Host)`,
              meeting.autoRecord ? `📹 *Perekaman Otomatis:* Aktif (Tersimpan di Google Drive)` : null,
              meeting.autoSummary ? `📝 *Notula Rapat:* Aktif (Catatan otomatis disusun setelah rapat)` : null,
              ``,
              `Tautan di atas sudah dapat langsung dibagikan kepada seluruh peserta rapat.`
            ].filter(Boolean).join('\n');

            await sock.sendMessage(remoteJid, { text: replySuccess }, { quoted: msg });
            console.log(`✅ Link Google Meet berhasil dikirim ke ${remoteJid}!`);

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

              const followUpText = `Pemberitahuan Jadwal: Pada pukul ${nearbyHour} WIB, akun Zoom akan dipergunakan untuk agenda *${nearbyMeeting.topic}*. Mohon dapat menyesuaikan durasi rapat. Terima kasih.`;
              await sock.sendMessage(remoteJid, { text: followUpText });
              console.log(`📢 Keterangan lanjutan jadwal terdekat berhasil dikirim: "${followUpText}"`);
            }
          } catch (gmeetErr) {
            console.error('❌ Gagal membuat Google Meet:', gmeetErr.message);
            const errReply = `Mohon maaf Bapak/Ibu, terjadi kendala saat membuat Google Meet: ${gmeetErr.message}\n\n` +
              `_💡 Tips: Pastikan akun Google sudah terhubung dengan benar di sistem bot._`;
            await sock.sendMessage(remoteJid, { text: errReply }, { quoted: msg });
          }
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
            platform: 'ZOOM',
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

          // Template balasan resmi & formal
          const replySuccess = [
            `Yth. Bapak/Ibu,`,
            `Berikut rincian tautan Zoom Meeting yang telah berhasil dijadwalkan:`,
            ``,
            `📌 *Topik Agenda:* ${meeting.topic}`,
            `🗓️ *Waktu Pelaksanaan:* ${formattedTime}`,
            `🔗 *Tautan Zoom:*`,
            `${meeting.joinUrl}`,
            `🆔 *Meeting ID:* ${meeting.meetingId}`,
            meeting.passcode ? `🔑 *Passcode:* ${meeting.passcode}` : null,
            command.autoRecord ? `📹 *Perekaman Cloud:* Aktif\n_Tautan rekaman video dan passcode akan otomatis dikirimkan setelah pertemuan berakhir._` : null,
            ``,
            `Tautan di atas sudah dapat langsung dibagikan kepada seluruh peserta rapat.`
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

            const followUpText = `Pemberitahuan Jadwal: Pada pukul ${nearbyHour} WIB, akun Zoom akan dipergunakan untuk agenda *${nearbyMeeting.topic}*. Mohon dapat menyesuaikan durasi rapat. Terima kasih.`;
            await sock.sendMessage(remoteJid, { text: followUpText });
            console.log(`📢 Keterangan lanjutan jadwal terdekat berhasil dikirim: "${followUpText}"`);
          }

        } catch (zoomErr) {
          console.error('❌ Gagal membuat Zoom meeting:', zoomErr.message);
          const errReply = `Mohon maaf Bapak/Ibu, terjadi kendala saat membuat pertemuan di Zoom: ${zoomErr.message}`;
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

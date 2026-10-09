import fs from 'fs';
import path from 'path';
import { checkMeetingExists, getUpcomingZoomMeetings } from './zoom.js';
import { parseToDate } from '../utils/datetime.js';

const STORAGE_DIR = process.env.STORAGE_DIR || '.';
const DATA_DIR = path.join(STORAGE_DIR, 'data');
const MEETINGS_FILE = path.join(DATA_DIR, 'meetings.json');

// Pastikan direktori dan file data tersedia
function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(MEETINGS_FILE)) {
    fs.writeFileSync(MEETINGS_FILE, JSON.stringify([], null, 2), 'utf-8');
  }
}

/**
 * Mengambil semua meeting yang belum lewat (masih aktif / masa depan atau pending rekaman).
 */
export function getActiveMeetings() {
  ensureFile();
  try {
    const raw = fs.readFileSync(MEETINGS_FILE, 'utf-8');
    const list = JSON.parse(raw);
    const now = Date.now();

    // Simpan meeting aktif, meeting pending rekaman, pending rekap peserta, dan pending AI summary (hingga 12 jam)
    const active = list.filter(m => {
      const startTime = parseToDate(m.startTime).getTime();
      const endTime = startTime + (m.duration || Number(process.env.DEFAULT_MEETING_DURATION) || 60) * 60 * 1000;
      const isPendingRecording = m.autoRecord && !m.recordingSent;
      const isPendingSummary = !m.summarySent;
      const isPendingAiSummary = !m.aiSummarySent;

      if (isPendingRecording || isPendingSummary || isPendingAiSummary) {
        return endTime > (now - 12 * 3600 * 1000);
      }
      return endTime > (now - 4 * 3600 * 1000);
    });

    // Simpan kembali jika ada yang dibersihkan
    if (active.length !== list.length) {
      fs.writeFileSync(MEETINGS_FILE, JSON.stringify(active, null, 2), 'utf-8');
    }

    return active;
  } catch (err) {
    console.error('Gagal membaca data meeting:', err.message);
    return [];
  }
}

/**
 * Menyimpan data meeting baru ke penyimpanan lokal.
 */
export function saveScheduledMeeting(meeting) {
  ensureFile();
  try {
    const list = getActiveMeetings();
    list.push({
      id: meeting.meetingId || meeting.id,
      platform: meeting.platform || 'ZOOM',
      spaceName: meeting.spaceName || '',
      topic: meeting.topic,
      startTime: meeting.startTime,
      duration: Number(meeting.duration) || Number(process.env.DEFAULT_MEETING_DURATION) || 60,
      joinUrl: meeting.joinUrl,
      passcode: meeting.passcode || '',
      autoRecord: Boolean(meeting.autoRecord),
      requesterPhone: meeting.requesterPhone || '',
      recordRequesterPhone: meeting.recordRequesterPhone || meeting.requesterPhone || '',
      recordingSent: false,
      summarySent: false,
      aiSummarySent: false,
      createdAt: new Date().toISOString()
    });
    fs.writeFileSync(MEETINGS_FILE, JSON.stringify(list, null, 2), 'utf-8');
  } catch (err) {
    console.error('Gagal menyimpan meeting ke file:', err.message);
  }
}

/**
 * Mendapatkan meeting yang sedang live / berlangsung saat ini.
 * Digunakan saat ada perintah "rekam pak" untuk menentukan meeting mana yang direkam.
 * 
 * @returns {object|null}
 */
export function getCurrentLiveMeeting() {
  const meetings = getActiveMeetings();
  if (meetings.length === 0) return null;

  const now = Date.now();

  // 1. Cari meeting yang saat ini berada dalam rentang waktu mulai s.d. selesai (dengan buffer 10 menit sebelum & sesudah)
  const liveMeetings = meetings.filter(m => {
    const start = parseToDate(m.startTime).getTime();
    const end = start + (m.duration || Number(process.env.DEFAULT_MEETING_DURATION) || 60) * 60 * 1000;
    return now >= (start - 10 * 60 * 1000) && now <= (end + 15 * 60 * 1000);
  });

  if (liveMeetings.length > 0) {
    // Pilih meeting yang waktu mulainya paling dekat dengan sekarang
    return liveMeetings.sort((a, b) => {
      const diffA = Math.abs(parseToDate(a.startTime).getTime() - now);
      const diffB = Math.abs(parseToDate(b.startTime).getTime() - now);
      return diffA - diffB;
    })[0];
  }

  // 2. Jika tidak ada yang strictly live tapi hanya ada 1 meeting aktif hari ini, gunakan itu
  if (meetings.length === 1) {
    return meetings[0];
  }

  return null;
}

/**
 * Memperbarui status rekaman meeting (misal autoRecord diaktifkan, nomor penerima, atau recordingSent = true).
 * 
 * @param {string|number} meetingId
 * @param {object} updateData
 * @returns {boolean}
 */
export function updateMeetingRecording(meetingId, updateData = {}) {
  ensureFile();
  try {
    const raw = fs.readFileSync(MEETINGS_FILE, 'utf-8');
    const list = JSON.parse(raw);
    const targetId = String(meetingId).trim().toLowerCase();
    const targetIdClean = targetId.replace(/-/g, '').replace(/^spaces\//, '');
    let updated = false;

    for (const m of list) {
      const mId = String(m.id || '').trim().toLowerCase();
      const mSpace = String(m.spaceName || '').trim().toLowerCase();
      const mIdClean = mId.replace(/-/g, '').replace(/^spaces\//, '');
      const mSpaceClean = mSpace.replace(/-/g, '').replace(/^spaces\//, '');

      if (
        mId === targetId ||
        mSpace === targetId ||
        mIdClean === targetIdClean ||
        mSpaceClean === targetIdClean
      ) {
        Object.assign(m, updateData);
        updated = true;
        break;
      }
    }

    if (updated) {
      fs.writeFileSync(MEETINGS_FILE, JSON.stringify(list, null, 2), 'utf-8');
      return true;
    }
    return false;
  } catch (err) {
    console.error(`Gagal update status rekaman meeting ${meetingId}:`, err.message);
    return false;
  }
}

/**
 * Mengambil daftar meeting yang meminta autoRecord dan belum dikirimkan videonya.
 * 
 * @returns {Array<object>}
 */
export function getMeetingsPendingRecording() {
  const meetings = getActiveMeetings();
  const now = Date.now();

  return meetings.filter(m => {
    if (!m.autoRecord || m.recordingSent) return false;
    const start = new Date(m.startTime).getTime();
    // Hanya periksa meeting yang waktu mulainya sudah lewat (sudah berjalan / selesai)
    return now >= start;
  });
}

/**
 * Mengambil daftar meeting yang belum dikirimkan rekap pesertanya.
 * Memeriksa meeting yang sudah dimulai minimal 5 menit yang lalu.
 * 
 * @returns {Array<object>}
 */
export function getMeetingsPendingSummary() {
  const meetings = getActiveMeetings();
  const now = Date.now();

  return meetings.filter(m => {
    if (m.summarySent) return false;
    const start = parseToDate(m.startTime).getTime();
    return now >= (start + 5 * 60 * 1000);
  });
}

/**
 * Mengambil daftar meeting yang sudah selesai dan belum dikirimkan notula AI-nya.
 * 
 * @returns {Array<object>}
 */
export function getMeetingsPendingAiSummary() {
  const meetings = getActiveMeetings();
  const now = Date.now();

  return meetings.filter(m => {
    if (m.aiSummarySent) return false;
    const start = parseToDate(m.startTime).getTime();
    return now >= (start + 3 * 60 * 1000);
  });
}

/**
 * Mencari data meeting berdasarkan meeting ID.
 * 
 * @param {string|number} meetingId
 * @returns {object|null}
 */
export function getScheduledMeetingById(meetingId) {
  if (!meetingId) return null;
  const targetId = String(meetingId).trim().toLowerCase();
  const targetIdClean = targetId.replace(/-/g, '').replace(/^spaces\//, '');
  const meetings = getActiveMeetings();

  return meetings.find(m => {
    const mId = String(m.id || '').trim().toLowerCase();
    const mSpace = String(m.spaceName || '').trim().toLowerCase();
    const mIdClean = mId.replace(/-/g, '').replace(/^spaces\//, '');
    const mSpaceClean = mSpace.replace(/-/g, '').replace(/^spaces\//, '');

    return (
      mId === targetId ||
      mSpace === targetId ||
      mIdClean === targetIdClean ||
      mSpaceClean === targetIdClean
    );
  }) || null;
}

/**
 * Menghapus meeting dari data jadwal lokal berdasarkan ID meeting.
 * @param {string|number} meetingId
 * @returns {boolean} true jika berhasil dihapus
 */
export function removeScheduledMeeting(meetingId) {
  ensureFile();
  try {
    const raw = fs.readFileSync(MEETINGS_FILE, 'utf-8');
    const list = JSON.parse(raw);
    const targetId = String(meetingId).trim();
    const updated = list.filter(m => String(m.id).trim() !== targetId);

    if (updated.length !== list.length) {
      fs.writeFileSync(MEETINGS_FILE, JSON.stringify(updated, null, 2), 'utf-8');
      console.log(`🗑️ Meeting ID ${meetingId} berhasil dihapus dari jadwal lokal.`);
      return true;
    }
    return false;
  } catch (err) {
    console.error('Gagal menghapus meeting dari file:', err.message);
    return false;
  }
}

/**
 * Memperbarui data meeting yang tersimpan di jadwal lokal.
 * 
 * @param {string|number} meetingId
 * @param {object} updateData
 * @returns {object|null} Meeting data yang telah diupdate
 */
export function updateScheduledMeeting(meetingId, updateData = {}) {
  ensureFile();
  try {
    const raw = fs.readFileSync(MEETINGS_FILE, 'utf-8');
    const list = JSON.parse(raw);
    const targetId = String(meetingId).trim();
    let updatedMeeting = null;

    for (const m of list) {
      if (String(m.id).trim() === targetId) {
        Object.assign(m, updateData);
        updatedMeeting = m;
        break;
      }
    }

    if (updatedMeeting) {
      fs.writeFileSync(MEETINGS_FILE, JSON.stringify(list, null, 2), 'utf-8');
      console.log(`📝 Meeting ID ${meetingId} berhasil diperbarui di jadwal lokal.`);
      return updatedMeeting;
    }
    return null;
  } catch (err) {
    console.error(`Gagal memperbarui meeting ${meetingId} di database lokal:`, err.message);
    return null;
  }
}

/**
 * Sinkronisasi jadwal lokal dengan status sebenarnya di Zoom API.
 * Menghapus meeting yang sudah dihapus manual oleh user di aplikasi/web Zoom,
 * serta mengimpor meeting yang dibuat langsung di aplikasi Zoom ke database lokal.
 */
export async function syncMeetingsWithZoom() {
  const meetings = getActiveMeetings();
  const stillValid = [];

  // 1. Verifikasi meeting lokal yang masih ada di Zoom
  if (meetings.length > 0) {
    console.log(`🔄 Memverifikasi ${meetings.length} jadwal meeting dengan server Zoom...`);
    for (const m of meetings) {
      if (m.platform === 'ZOOM') {
        const exists = await checkMeetingExists(m.id);
        if (!exists) {
          console.log(`🗑️ Meeting ID ${m.id} (${m.topic}) sudah dihapus di Zoom, membersihkan dari database lokal.`);
          removeScheduledMeeting(m.id);
        } else {
          stillValid.push(m);
        }
      } else {
        stillValid.push(m);
      }
    }
  }

  // 2. Impor meeting yang dibuat langsung di aplikasi/web Zoom ke jadwal bot
  try {
    const upcomingZoom = await getUpcomingZoomMeetings();
    for (const zm of upcomingZoom) {
      const alreadyTracked = stillValid.some(m => String(m.id).trim() === String(zm.id).trim());
      if (!alreadyTracked && zm.startTime) {
        console.log(`📥 Mengimpor meeting dari Zoom App ke jadwal bot: ID ${zm.id} (${zm.topic}) pada ${zm.startTime}`);
        saveScheduledMeeting({
          meetingId: String(zm.id),
          platform: 'ZOOM',
          topic: zm.topic || 'Zoom Meeting',
          startTime: zm.startTime,
          duration: zm.duration || 60,
          joinUrl: zm.joinUrl || '',
          autoRecord: false
        });
        stillValid.push(zm);
      }
    }
  } catch (syncErr) {
    console.warn('⚠️ Gagal sinkronisasi meeting upcoming dari Zoom:', syncErr.message);
  }

  return stillValid;
}

/**
 * Cek apakah ada jadwal meeting yang bertabrakan (jam yang sama / overlap).
 * Memeriksa jadwal lokal DAN server Zoom API secara real-time untuk memastikan
 * tidak terjadi double meeting (termasuk meeting yang dibuat langsung dari aplikasi Zoom).
 * 
 * @param {string|Date} startTimeISO 
 * @param {number} durationMinutes 
 * @param {string|number|null} [excludeMeetingId=null] ID meeting yang dikecualikan (misal saat edit)
 * @param {'ZOOM'|'GMEET'} [targetPlatform='ZOOM'] Platform meeting yang akan dibuat
 * @returns {Promise<{ hasConflict: boolean, conflictingMeeting: object|null }>}
 */
export async function checkScheduleConflict(
  startTimeISO,
  durationMinutes = Number(process.env.DEFAULT_MEETING_DURATION) || 60,
  excludeMeetingId = null,
  targetPlatform = 'ZOOM'
) {
  // Google Meet tidak memiliki batasan 1 host akun seperti Zoom,
  // sehingga Google Meet tidak dibentrokkan dengan Zoom ataupun sesama Google Meet.
  if (targetPlatform === 'GMEET') {
    return { hasConflict: false, conflictingMeeting: null };
  }

  const targetStart = parseToDate(startTimeISO).getTime();
  if (isNaN(targetStart)) return { hasConflict: false, conflictingMeeting: null };

  const targetEnd = targetStart + durationMinutes * 60 * 1000;
  const meetings = getActiveMeetings();

  // 1. Kumpulkan daftar meeting yang harus dicek: Gabungan database lokal dan Zoom API real-time
  const meetingCandidates = [...meetings];

  try {
    const liveUpcoming = await getUpcomingZoomMeetings();
    for (const zm of liveUpcoming) {
      const existsInList = meetingCandidates.some(m => String(m.id).trim() === String(zm.id).trim());
      if (!existsInList) {
        meetingCandidates.push({
          id: String(zm.id),
          platform: 'ZOOM',
          topic: zm.topic || 'Zoom Meeting',
          startTime: zm.startTime,
          duration: zm.duration || 60
        });
      }
    }
  } catch (err) {
    // Jika Zoom API gagal, tetap gunakan database lokal
  }

  for (const m of meetingCandidates) {
    // Lewati jika ini adalah meeting yang sedang di-edit (tidak membenturkan dengan dirinya sendiri)
    if (excludeMeetingId && String(m.id).trim() === String(excludeMeetingId).trim()) {
      continue;
    }

    // Hanya bentrok jika meeting yang sudah ada adalah ZOOM (karena Zoom 1 akun host tidak bisa dipakai bersamaan)
    if (m.platform === 'GMEET') {
      continue;
    }

    const existingStart = parseToDate(m.startTime).getTime();
    if (isNaN(existingStart)) continue;

    const existingEnd = existingStart + (m.duration || Number(process.env.DEFAULT_MEETING_DURATION) || 60) * 60 * 1000;

    // Overlap terjadi jika waktu meeting baru beririsan dengan waktu meeting yang sudah ada
    if (targetStart < existingEnd && targetEnd > existingStart) {
      // Validasi langsung ke Zoom API: Apakah meeting ini masih eksis?
      const exists = await checkMeetingExists(m.id);
      if (!exists) {
        console.log(`💡 Jadwal bentrok dengan ID ${m.id} (${m.topic}) diabaikan karena meeting sudah dihapus di Zoom.`);
        removeScheduledMeeting(m.id);
        continue;
      }

      return {
        hasConflict: true,
        conflictingMeeting: m
      };
    }
  }

  return { hasConflict: false, conflictingMeeting: null };
}

/**
 * Cek apakah ada meeting lain yang berjarak 1-2 jam setelah meeting baru.
 * Otomatis memvalidasi keberadaan meeting di Zoom API.
 * 
 * @param {string|Date} startTimeISO 
 * @param {number} durationMinutes 
 * @returns {Promise<object|null>} Meeting terdekat dalam rentang 1-2 jam
 */
export async function getNearbyUpcomingMeeting(startTimeISO, durationMinutes = Number(process.env.DEFAULT_MEETING_DURATION) || 60) {
  const targetStart = parseToDate(startTimeISO).getTime();
  if (isNaN(targetStart)) return null;

  const targetEnd = targetStart + durationMinutes * 60 * 1000;
  const meetings = getActiveMeetings();

  // Cari meeting yang mulai setelah meeting ini, dalam rentang hingga 2.5 jam ke depan
  const nearby = meetings
    .filter(m => {
      const existingStart = parseToDate(m.startTime).getTime();
      const diffMs = existingStart - targetStart;
      const diffMinutes = diffMs / (60 * 1000);
      // Berjarak antara 30 menit s.d. 150 menit (sekitar 1-2 jam)
      return diffMinutes >= (durationMinutes - 10) && diffMinutes <= 150;
    })
    .sort((a, b) => parseToDate(a.startTime).getTime() - parseToDate(b.startTime).getTime());

  for (const m of nearby) {
    const exists = await checkMeetingExists(m.id);
    if (!exists) {
      removeScheduledMeeting(m.id);
      continue;
    }
    return m;
  }

  return null;
}



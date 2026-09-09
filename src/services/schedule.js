import fs from 'fs';
import path from 'path';
import { checkMeetingExists } from './zoom.js';
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

    // Simpan meeting aktif, meeting pending rekaman, dan meeting pending rekap peserta (hingga 12 jam)
    const active = list.filter(m => {
      const startTime = parseToDate(m.startTime).getTime();
      const endTime = startTime + (m.duration || Number(process.env.DEFAULT_MEETING_DURATION) || 60) * 60 * 1000;
      const isPendingRecording = m.autoRecord && !m.recordingSent;
      const isPendingSummary = !m.summarySent;

      if (isPendingRecording || isPendingSummary) {
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
      topic: meeting.topic,
      startTime: meeting.startTime,
      duration: Number(meeting.duration) || Number(process.env.DEFAULT_MEETING_DURATION) || 60,
      joinUrl: meeting.joinUrl,
      passcode: meeting.passcode,
      autoRecord: Boolean(meeting.autoRecord),
      requesterPhone: meeting.requesterPhone || '',
      recordRequesterPhone: meeting.recordRequesterPhone || meeting.requesterPhone || '',
      recordingSent: false,
      summarySent: false,
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
    const targetId = String(meetingId).trim();
    let updated = false;

    for (const m of list) {
      if (String(m.id).trim() === targetId) {
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
 * Mencari data meeting berdasarkan meeting ID.
 * 
 * @param {string|number} meetingId
 * @returns {object|null}
 */
export function getScheduledMeetingById(meetingId) {
  if (!meetingId) return null;
  const targetId = String(meetingId).trim();
  const meetings = getActiveMeetings();
  return meetings.find(m => String(m.id).trim() === targetId) || null;
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
 * Sinkronisasi jadwal lokal dengan status sebenarnya di Zoom API.
 * Menghapus meeting yang sudah dihapus manual oleh user di aplikasi/web Zoom.
 */
export async function syncMeetingsWithZoom() {
  const meetings = getActiveMeetings();
  if (meetings.length === 0) return [];

  console.log(`🔄 Memverifikasi ${meetings.length} jadwal meeting dengan server Zoom...`);
  const stillValid = [];

  for (const m of meetings) {
    const exists = await checkMeetingExists(m.id);
    if (!exists) {
      console.log(`🗑️ Meeting ID ${m.id} (${m.topic}) sudah dihapus di Zoom, membersihkan dari database lokal.`);
      removeScheduledMeeting(m.id);
    } else {
      stillValid.push(m);
    }
  }

  return stillValid;
}

/**
 * Cek apakah ada jadwal meeting yang bertabrakan (jam yang sama / overlap).
 * Otomatis memvalidasi ke Zoom API jika ada jadwal yang bentrok:
 * Jika meeting ternyata sudah dihapus di Zoom oleh user, jadwal lokal akan otomatis dibersihkan
 * dan tidak lagi dianggap bentrok.
 * 
 * @param {string|Date} startTimeISO 
 * @param {number} durationMinutes 
 * @returns {Promise<{ hasConflict: boolean, conflictingMeeting: object|null }>}
 */
export async function checkScheduleConflict(startTimeISO, durationMinutes = Number(process.env.DEFAULT_MEETING_DURATION) || 60) {
  const targetStart = parseToDate(startTimeISO).getTime();
  if (isNaN(targetStart)) return { hasConflict: false, conflictingMeeting: null };

  const targetEnd = targetStart + durationMinutes * 60 * 1000;
  const meetings = getActiveMeetings();

  for (const m of meetings) {
    const existingStart = parseToDate(m.startTime).getTime();
    if (isNaN(existingStart)) continue;

    const existingEnd = existingStart + (m.duration || Number(process.env.DEFAULT_MEETING_DURATION) || 60) * 60 * 1000;

    // Overlap terjadi jika waktu meeting baru beririsan dengan waktu meeting yang sudah ada
    // Misal: targetStart < existingEnd DAN targetEnd > existingStart
    if (targetStart < existingEnd && targetEnd > existingStart) {
      // Validasi langsung ke Zoom API: Apakah meeting ini masih eksis?
      const exists = await checkMeetingExists(m.id);
      if (!exists) {
        console.log(`💡 Jadwal bentrok dengan ID ${m.id} (${m.topic}) diabaikan karena meeting sudah dihapus di Zoom.`);
        removeScheduledMeeting(m.id);
        continue; // Lanjut cek meeting lain
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



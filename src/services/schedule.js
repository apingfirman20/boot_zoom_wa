import fs from 'fs';
import path from 'path';

const DATA_DIR = './data';
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
 * Mengambil semua meeting yang belum lewat (masih aktif / masa depan).
 */
export function getActiveMeetings() {
  ensureFile();
  try {
    const raw = fs.readFileSync(MEETINGS_FILE, 'utf-8');
    const list = JSON.parse(raw);
    const now = Date.now();

    // Hapus meeting yang sudah selesai lebih dari 3 jam lalu agar file tetap bersih
    const active = list.filter(m => {
      const startTime = new Date(m.startTime).getTime();
      const endTime = startTime + (m.duration || 45) * 60 * 1000;
      return endTime > (now - 3 * 3600 * 1000);
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
      duration: Number(meeting.duration) || 45,
      joinUrl: meeting.joinUrl,
      passcode: meeting.passcode,
      createdAt: new Date().toISOString()
    });
    fs.writeFileSync(MEETINGS_FILE, JSON.stringify(list, null, 2), 'utf-8');
  } catch (err) {
    console.error('Gagal menyimpan meeting ke file:', err.message);
  }
}

/**
 * Cek apakah ada jadwal meeting yang bertabrakan (jam yang sama / overlap).
 * @param {string|Date} startTimeISO 
 * @param {number} durationMinutes 
 * @returns {{ hasConflict: boolean, conflictingMeeting: object|null }}
 */
export function checkScheduleConflict(startTimeISO, durationMinutes = 45) {
  const targetStart = new Date(startTimeISO).getTime();
  if (isNaN(targetStart)) return { hasConflict: false, conflictingMeeting: null };

  const targetEnd = targetStart + durationMinutes * 60 * 1000;
  const meetings = getActiveMeetings();

  for (const m of meetings) {
    const existingStart = new Date(m.startTime).getTime();
    if (isNaN(existingStart)) continue;

    const existingEnd = existingStart + (m.duration || 45) * 60 * 1000;

    // Overlap terjadi jika waktu meeting baru beririsan dengan waktu meeting yang sudah ada
    // Misal: targetStart < existingEnd DAN targetEnd > existingStart
    if (targetStart < existingEnd && targetEnd > existingStart) {
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
 * @param {string|Date} startTimeISO 
 * @param {number} durationMinutes 
 * @returns {object|null} Meeting terdekat dalam rentang 1-2 jam
 */
export function getNearbyUpcomingMeeting(startTimeISO, durationMinutes = 45) {
  const targetStart = new Date(startTimeISO).getTime();
  if (isNaN(targetStart)) return null;

  const targetEnd = targetStart + durationMinutes * 60 * 1000;
  const meetings = getActiveMeetings();

  // Cari meeting yang mulai setelah meeting ini, dalam rentang hingga 2.5 jam ke depan
  const nearby = meetings
    .filter(m => {
      const existingStart = new Date(m.startTime).getTime();
      const diffMs = existingStart - targetStart;
      const diffMinutes = diffMs / (60 * 1000);
      // Berjarak antara 30 menit s.d. 150 menit (sekitar 1-2 jam)
      return diffMinutes >= (durationMinutes - 10) && diffMinutes <= 150;
    })
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  return nearby.length > 0 ? nearby[0] : null;
}

/**
 * Parser berbasis Rule/Template (Regex & Keyword Matching).
 * Mengerti perintah Zoom maupun Meeting (misal: "buatkan link meeting jam 1 siang dengan finance").
 * Jika pesan tidak terkait pembuatan meeting, pesan akan diabaikan (tidak dijawab).
 */

export function parseMeetingCommand(messageText) {
  if (!messageText || typeof messageText !== 'string') return null;

  const text = messageText.trim();
  const lower = text.toLowerCase();

  // 1. Validasi Keyword Trigger:
  // Trigger jika ada kata 'zoom', atau kata 'meeting' / 'miting' yang diikuti perintah/waktu, atau awalan '!'
  const hasZoom = lower.includes('zoom');
  const hasMeetingIntent = /(?:buat(?:kan)?|bikin|minta|jadwal(?:kan)?|link|tolong|ada)\s+(?:link\s+)?(?:meeting|miting)/i.test(lower) ||
                           /(?:meeting|miting)\s+(?:jam|besok|sekarang|dengan|buat|untuk)/i.test(lower);
  const isCommandPrefix = lower.startsWith('!meeting') || lower.startsWith('!zoom');

  if (!hasZoom && !hasMeetingIntent && !isCommandPrefix) {
    return null; // Abaikan pesan, jangan dijawab
  }

  // 2. Ekstraksi Waktu (Jam, Menit, Hari)
  const now = new Date();
  let targetDate = new Date(now);

  // Cek Hari
  if (lower.includes('besok')) {
    targetDate.setDate(targetDate.getDate() + 1);
  } else if (lower.includes('lusa')) {
    targetDate.setDate(targetDate.getDate() + 2);
  }

  // Cek Jam & Menit
  // Format: "jam 1 siang", "jam 2.30 sore", "jam 13:00", "jam 8 pagi", "14.00"
  let matchedHour = null;
  let matchedMinute = 0;

  const timeRegex = /(?:jam\s*)?(\d{1,2})[.:](\d{2})\s*(pagi|siang|sore|malam)?/i;
  const hourSimpleRegex = /jam\s*(\d{1,2})\s*(pagi|siang|sore|malam)?/i;

  const matchFull = lower.match(timeRegex);
  const matchSimple = lower.match(hourSimpleRegex);

  if (matchFull) {
    let hour = parseInt(matchFull[1], 10);
    matchedMinute = parseInt(matchFull[2], 10);
    const period = matchFull[3];

    if (period === 'siang' && hour >= 1 && hour < 12) hour += 12;
    if (period === 'sore' && hour >= 1 && hour < 12) hour += 12;
    if (period === 'malam' && hour >= 1 && hour < 12) hour += 12;
    matchedHour = hour;
  } else if (matchSimple) {
    let hour = parseInt(matchSimple[1], 10);
    const period = matchSimple[2];

    if (period === 'siang' && hour >= 1 && hour < 12) hour += 12;
    if (period === 'sore' && hour >= 1 && hour < 12) hour += 12;
    if (period === 'malam' && hour >= 1 && hour < 12) hour += 12;
    matchedHour = hour;
  }

  let startTimeISO = null;
  if (matchedHour !== null) {
    targetDate.setHours(matchedHour, matchedMinute, 0, 0);
    const year = targetDate.getFullYear();
    const month = String(targetDate.getMonth() + 1).padStart(2, '0');
    const day = String(targetDate.getDate()).padStart(2, '0');
    const hh = String(targetDate.getHours()).padStart(2, '0');
    const mm = String(targetDate.getMinutes()).padStart(2, '0');
    startTimeISO = `${year}-${month}-${day}T${hh}:${mm}:00`;
  } else {
    // Jika tidak menyebut jam atau menulis "sekarang", buat meeting sekarang (ISO now)
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    startTimeISO = `${year}-${month}-${day}T${hh}:${mm}:00`;
  }

  // 3. Ekstraksi Topik / Judul / Nama Tim
  let topic = 'Meeting Zoom';
  const fillerWords = ['dong', 'ya', 'yah', 'kak', 'bang', 'mas', 'mbak', 'min', 'bro', 'sis', 'pls', 'please', 'tolong', 'minta', 'buatkan', 'bikin', 'link', 'zoom', 'meeting', 'miting'];

  // Pola A: dengan/sama/buat/untuk/bahas/tentang/judul/topik [tim / topik]
  const topicPrefixRegex = /(?:dengan|sama|buat|untuk|bahas|tentang|judul|topik)\s+(?:tim\s+)?([a-zA-Z0-9\s-_]+)/i;
  const matchPrefix = text.match(topicPrefixRegex);

  if (matchPrefix && matchPrefix[1]) {
    let candidate = matchPrefix[1]
      .replace(/sekarang|besok|lusa|jam\s*\d+([.:]\d+)?\s*(pagi|siang|sore|malam)?/gi, '')
      .trim();

    const words = candidate.split(/\s+/).filter(w => !fillerWords.includes(w.toLowerCase()));
    if (words.length > 0) {
      topic = words.join(' ');
      topic = topic.charAt(0).toUpperCase() + topic.slice(1);
    }
  }

  // Jika pola A belum mendapatkan topik, bersihkan kata perintah umum
  if (topic === 'Meeting Zoom') {
    let cleaned = text
      .replace(/^!?(meeting|zoom)\s*/i, '')
      .replace(/buatkan|bikin|tolong|minta|buat|link|zoom|meeting|miting|jadwal(?:kan)?/gi, '')
      .replace(/sekarang|besok|lusa/gi, '')
      .replace(/(?:jam\s*)?\d{1,2}[.:]\d{2}\s*(pagi|siang|sore|malam)?/gi, '')
      .replace(/jam\s*\d{1,2}\s*(pagi|siang|sore|malam)?/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    const cleanedWords = cleaned.split(/\s+/).filter(w => !fillerWords.includes(w.toLowerCase()));
    cleaned = cleanedWords.join(' ');

    if (cleaned.length > 2) {
      topic = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    }
  }

  // 4. Ekstraksi Durasi (opsional, default 45 menit)
  let durationMinutes = 45;
  const durMatch = text.match(/(\d+)\s*(menit|jam)/i);
  if (durMatch) {
    const val = parseInt(durMatch[1], 10);
    if (durMatch[2].toLowerCase() === 'jam') {
      durationMinutes = val * 60;
    } else {
      durationMinutes = val;
    }
  }

  return {
    isMeetingCommand: true,
    topic: topic,
    startTime: startTimeISO,
    durationMinutes: durationMinutes
  };
}

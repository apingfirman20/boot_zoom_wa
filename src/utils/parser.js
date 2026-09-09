import { getTimezoneOffsetString, getNowInTimezone } from './datetime.js';

/**
 * Parser berbasis Rule/Template (Regex & Keyword Matching).
 * Mengerti perintah Zoom maupun Meeting (misal: "buatkan link meeting jam 1 siang dengan finance").
 * Jika pesan tidak terkait pembuatan meeting, pesan akan diabaikan (tidak dijawab).
 */

export function parseMeetingCommand(messageText, defaultTz = process.env.DEFAULT_TIMEZONE || 'Asia/Jakarta') {
  if (!messageText || typeof messageText !== 'string') return null;

  const text = messageText.trim();
  const lower = text.toLowerCase();

  // 1. Abaikan jika ini adalah perintah pembatalan / hapus atau cek jadwal
  const isCancel = /(?:hapus|batal(?:kan)?|cancel|delete)/i.test(lower);
  const isList = /(?:cek\s+jadwal|lihat\s+jadwal|daftar\s+jadwal|list\s+jadwal|jadwal\s+zoom|daftar\s+zoom|list\s+zoom|ada\s+jadwal\s+apa|!jadwal|!list)/i.test(lower);
  if (isCancel || isList) {
    return null;
  }

  // 2. Abaikan negasi eksplisit (misal: "jangan buat zoom", "bukan zoom", "gak usah zoom", "nggak usah buat zoom")
  const isNegation = /(?:jangan|bukan|gak\s*usah|nggak\s*usah|tidak\s*usah|gak\s*perlu|nggak\s*perlu)\s+(?:(?:buat(?:kan)?|bikin(?:in)?|minta|jadwal(?:kan)?)\s+)?(?:link\s+)?(?:zoom|meeting|miting)/i.test(lower);
  if (isNegation) {
    return null;
  }

  // 3. Deteksi apakah ini hanya obrolan biasa yang menyebut kata zoom / aplikasi zoom (BUKAN perintah membuat)
  // Contoh: "bener kok di zoomnya", "aku lagi di zoom", "zoom nya error", "suara di zoom", "buka zoom"
  const isCasualChatAboutZoom = /(?:^|\s)(?:di|pada|dalam)\s+zoom(?:nya)?(?:\s|$)/i.test(lower) ||
                                /(?:zoom(?:nya)?\s+(?:error|rusak|lemot|bermasalah|ngefreeze|lag|putus|aman|bagus|bisa|gabisa|gak\s+bisa))/i.test(lower) ||
                                /(?:lagi|sedang)\s+(?:buka|masuk|ikut|ada\s+di)\s+zoom/i.test(lower) ||
                                /(?:buka|tutup|update|install|download)\s+zoom/i.test(lower) ||
                                /(?:zoom\s+(?:siapa|apa|kenapa|kok|mana))/i.test(lower);

  // 4. Periksa apakah ada INTENSI EKSPLISIT untuk membuat meeting / meminta link zoom:
  const isCommandPrefix = /^[!/](?:meeting|zoom)/i.test(lower);

  // Kata kerja permintaan pembuatan meeting:
  // "buatkan zoom", "bikin link zoom", "minta zoom", "jadwalkan zoom", "booking zoom", "order zoom"
  const hasActionVerb = /(?:buat(?:kan)?|bikin(?:in)?|minta|jadwal(?:kan|in)?|tolong(?:\s+buat(?:kan)?|\s+bikin|\s+link)?|order|pesan|booking|create|generate|setup|siapkan)\s+(?:link\s+)?(?:zoom|meeting|miting)/i.test(lower) ||
                        /(?:ada\s+)?(?:link\s+)(?:zoom|meeting|miting)\s+(?:untuk|buat|jam|besok|sekarang|dong|ya|gak|kah)/i.test(lower) ||
                        /^(?:minta\s+)?link\s+(?:zoom|meeting|miting)(?:\s+(?:dong|ya|kak|pak|bu|min|bang))?$/i.test(lower);

  // Kata "zoom" atau "meeting" yang diikuti penunjuk waktu spesifik (misal: "zoom jam 2 siang", "meeting besok jam 10")
  const hasZoomWithTime = /(?:zoom|meeting|miting)\s+(?:hari\s+ini\s+|besok\s+|lusa\s+)?(?:jam\s*\d{1,2}|nanti\s+jam|\d{1,2}[.:]\d{2})/i.test(lower);

  // Jika tidak memenuhi satu pun kriteria intensi membuat meeting:
  if (!isCommandPrefix && !hasActionVerb && !hasZoomWithTime) {
    return null; // Abaikan pesan obrolan santai, jangan dijawab & jangan buat zoom!
  }

  // Jika terkena pola obrolan santai DAN tidak ada kata kerja perintah yang tegas:
  if (isCasualChatAboutZoom && !hasActionVerb && !isCommandPrefix) {
    return null;
  }

  // 5. Ekstraksi Waktu (Jam, Menit, Hari)
  const nowTz = getNowInTimezone(defaultTz);
  let targetYear = nowTz.year;
  let targetMonth = nowTz.month;
  let targetDay = nowTz.day;

  // Cek Hari (relatif terhadap hari ini dalam timezone target)
  let dayOffset = 0;
  if (lower.includes('besok')) {
    dayOffset = 1;
  } else if (lower.includes('lusa')) {
    dayOffset = 2;
  }

  if (dayOffset > 0) {
    const d = new Date(targetYear, targetMonth - 1, targetDay + dayOffset);
    targetYear = d.getFullYear();
    targetMonth = d.getMonth() + 1;
    targetDay = d.getDate();
  }

  // Cek Jam & Menit
  // Format: "jam 14.00 wib", "14:00 wib", "jam 1 siang", "jam 2.30 sore", "jam 8 pagi", "14.00"
  let matchedHour = null;
  let matchedMinute = 0;

  const timeRegex = /(?:jam\s*)?(\d{1,2})[.:](\d{2})(?:\s*(?:wib|wita|wit))?(?:\s*(pagi|siang|sore|malam))?/i;
  const hourSimpleRegex = /jam\s*(\d{1,2})(?:\s*(?:wib|wita|wit))?(?:\s*(pagi|siang|sore|malam))?/i;

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

  // Jika TIDAK ADA JAM yang disebutkan:
  // Hanya buat meeting "sekarang" jika memang ada kata perintah aksi yang jelas atau kata "sekarang"
  if (matchedHour === null) {
    const hasNowIntent = lower.includes('sekarang') || lower.includes('now') || lower.includes('langsung') || hasActionVerb || isCommandPrefix;
    if (!hasNowIntent) {
      return null; // Abaikan jika waktu tidak jelas dan bukan perintah eksplisit
    }
    matchedHour = nowTz.hour;
    matchedMinute = nowTz.minute;
  }

  // Format ISO dengan offset timezone yang pasti (+07:00) agar server di UTC tidak salah mengonversi jam
  const offset = getTimezoneOffsetString(defaultTz);
  const yStr = String(targetYear).padStart(4, '0');
  const mStr = String(targetMonth).padStart(2, '0');
  const dStr = String(targetDay).padStart(2, '0');
  const hhStr = String(matchedHour).padStart(2, '0');
  const mmStr = String(matchedMinute).padStart(2, '0');

  const startTimeISO = `${yStr}-${mStr}-${dStr}T${hhStr}:${mmStr}:00${offset}`;

  // 6. Ekstraksi Topik / Judul / Nama Tim
  let topic = 'Meeting Zoom';
  const fillerWords = [
    'dong', 'ya', 'yah', 'kak', 'bang', 'mas', 'mbak', 'min', 'bro', 'sis', 'pls', 'please',
    'tolong', 'minta', 'buatkan', 'bikin', 'link', 'zoom', 'meeting', 'miting',
    'rekam', 'direkam', 'record', 'recording', 'nanti', 'sekalian', 'jangan', 'lupa', 'di', 'juga',
    'wib', 'wita', 'wit'
  ];

  const recordCleanerRegex = /(?:jangan\s+lupa\s+)?(?:tolong\s+|nanti\s+|sekalian\s+|sambil\s+|mohon\s+)?(?:di\s*)?rekam(?:\s+ya)?|(?:auto\s*)?record(?:ing)?/gi;

  // Pola A: dengan/sama/buat/untuk/bahas/tentang/judul/topik [tim / topik]
  const topicPrefixRegex = /(?:dengan|sama|buat|untuk|bahas|tentang|judul|topik)\s+(?:tim\s+)?([a-zA-Z0-9\s-_]+)/i;
  const matchPrefix = text.match(topicPrefixRegex);

  if (matchPrefix && matchPrefix[1]) {
    let candidate = matchPrefix[1]
      .replace(/sekarang|besok|lusa|jam\s*\d+([.:]\d+)?\s*(pagi|siang|sore|malam)?/gi, '')
      .replace(/\b(?:wib|wita|wit)\b/gi, '')
      .replace(recordCleanerRegex, '')
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
      .replace(/^[!/](?:meeting|zoom)\s*/i, '')
      .replace(/buatkan|bikin|tolong|minta|buat|link|zoom|meeting|miting|jadwal(?:kan)?/gi, '')
      .replace(/sekarang|besok|lusa|juga/gi, '')
      .replace(/(?:jam\s*)?\d{1,2}[.:]\d{2}(?:\s*(?:wib|wita|wit))?(?:\s*(?:pagi|siang|sore|malam))?/gi, '')
      .replace(/jam\s*\d{1,2}(?:\s*(?:wib|wita|wit))?(?:\s*(?:pagi|siang|sore|malam))?/gi, '')
      .replace(/\b(?:wib|wita|wit)\b/gi, '')
      .replace(recordCleanerRegex, '')
      .replace(/\s+/g, ' ')
      .trim();

    const cleanedWords = cleaned.split(/\s+/).filter(w => !fillerWords.includes(w.toLowerCase()));
    cleaned = cleanedWords.join(' ');

    if (cleaned.length > 2) {
      topic = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    }
  }

  // 7. Ekstraksi Durasi (opsional, default 60 menit / 1 jam)
  let durationMinutes = Number(process.env.DEFAULT_MEETING_DURATION) || 60;
  const durMatch = text.match(/(\d+)\s*(menit|jam)/i);
  if (durMatch) {
    const val = parseInt(durMatch[1], 10);
    if (durMatch[2].toLowerCase() === 'jam') {
      durationMinutes = val * 60;
    } else {
      durationMinutes = val;
    }
  }

  // 8. Ekstraksi Permintaan Rekam Otomatis (Cloud Recording)
  // Menangkap 'di rekam', 'direkam', 'rekam', 'record', 'jangan lupa di rekam', dll.
  const autoRecord = /(?:jangan\s+lupa\s+)?(?:di\s*)?rekam|record(?:ing)?|auto\s*record/i.test(lower);

  return {
    isMeetingCommand: true,
    topic: topic,
    startTime: startTimeISO,
    durationMinutes: durationMinutes,
    autoRecord: autoRecord
  };
}


/**
 * Parsing perintah rekam meeting yang sedang berlangsung (live).
 * Contoh: "rekam", "rekam pak", "tolong rekam", "rekam zoom sekarang", "!rekam"
 */
export function parseLiveRecordCommand(messageText) {
  if (!messageText || typeof messageText !== 'string') return null;

  const text = messageText.trim();
  const lower = text.toLowerCase();

  // Pola trigger perintah rekam live:
  // 1. Pesan sangat pendek yang hanya berisi kata rekam/record (misal: "rekam", "rekam pak", "rekam dong", "record min")
  // 2. Perintah spesifik merekam meeting yang sedang berjalan
  const isShortRecord = /^(?:tolong\s+)?(?:jangan\s+lupa\s+)?(?:di\s*)?rekam(?:\s+(?:ya|yah|dong|pak|bu|kak|bang|mas|min|bro|zoom|meeting))?[.!]?$/i.test(lower);
  const isSpecificRecord = /(?:tolong\s+)?(?:mulai\s+)?(?:di\s*)?rekam\s+(?:meeting|zoom|sekarang|yang\s+ini|saat\s+ini)/i.test(lower) ||
                           /^!(?:rekam|record)/i.test(lower);

  if (!isShortRecord && !isSpecificRecord) {
    return null;
  }

  // Jangan trigger jika itu adalah perintah pembuatan meeting (misal: "buatkan zoom jam 1 siang nanti direkam ya")
  if (/(?:buat(?:kan)?|bikin|jadwal(?:kan)?|link)\s+.*zoom/i.test(lower) || /(?:jam|besok|lusa)\s+\d+/i.test(lower)) {
    return null;
  }

  return {
    isLiveRecordCommand: true
  };
}

/**
 * Parsing perintah pembatalan / penghapusan jadwal meeting.
 * Contoh: "hapus zoom jam 10", "batalkan meeting jam 1 siang", "batal zoom 82242480038"
 */
export function parseCancelCommand(messageText) {
  if (!messageText || typeof messageText !== 'string') return null;

  const text = messageText.trim();
  const lower = text.toLowerCase();

  const isCancelTrigger = /(?:hapus|batal(?:kan)?|cancel|delete)\s+(?:link\s+)?(?:zoom|meeting|miting|jadwal)/i.test(lower) ||
                          /(?:zoom|meeting|miting)\s+(?:dibatalkan|dihapus)/i.test(lower) ||
                          /^!(?:hapus|batal|cancel)/i.test(lower);

  if (!isCancelTrigger) return null;

  // 1. Cek apakah ada nomor ID Meeting langsung (biasanya 9-11 digit angka)
  const idMatch = text.match(/\b\d{9,11}\b/);
  const meetingId = idMatch ? idMatch[0] : null;

  // 2. Cek jam jika ada
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

  // 3. Cek nama tim / topik jika ada
  let targetTopic = null;
  const topicMatch = text.match(/(?:tim|buat|untuk|dengan|bahas|tentang)\s+([a-zA-Z0-9\s-_]+)/i);
  if (topicMatch && topicMatch[1]) {
    targetTopic = topicMatch[1]
      .replace(/sekarang|besok|lusa|jam\s*\d+([.:]\d+)?\s*(pagi|siang|sore|malam)?/gi, '')
      .trim();
  } else {
    let cleaned = text
      .replace(/^!(?:hapus|batal|cancel)\s*/i, '')
      .replace(/(?:hapus|batal(?:kan)?|cancel|delete)\s+(?:link\s+)?(?:zoom|meeting|miting|jadwal)?/gi, '')
      .replace(/sekarang|besok|lusa|hari ini/gi, '')
      .replace(/(?:jam\s*)?\d{1,2}[.:]\d{2}\s*(pagi|siang|sore|malam)?/gi, '')
      .replace(/jam\s*\d{1,2}\s*(pagi|siang|sore|malam)?/gi, '')
      .replace(/\b\d{9,11}\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned.length > 1) {
      targetTopic = cleaned;
    }
  }

  return {
    isCancelCommand: true,
    meetingId,
    matchedHour,
    matchedMinute,
    targetTopic
  };
}

/**
 * Parsing perintah melihat daftar meeting aktif / hari ini.
 * Contoh: "cek jadwal zoom", "lihat daftar meeting", "!jadwal"
 */
export function parseListCommand(messageText) {
  if (!messageText || typeof messageText !== 'string') return null;
  const lower = messageText.trim().toLowerCase();

  const isListTrigger = /(?:cek\s+jadwal|lihat\s+jadwal|daftar\s+jadwal|list\s+jadwal|jadwal\s+zoom|daftar\s+zoom|list\s+zoom|ada\s+jadwal\s+apa|jadwal\s+meeting|!jadwal|!list)/i.test(lower);

  if (!isListTrigger) return null;

  return {
    isListCommand: true
  };
}


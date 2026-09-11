import { getTimezoneOffsetString, getNowInTimezone } from './datetime.js';

/**
 * Menormalkan jam (1-12) ke format 24 jam dengan pemahaman waktu meeting di Indonesia (AM/PM).
 * 
 * Aturan:
 * 1. Jika sudah 24 jam (misal 13-23), biarkan.
 * 2. Jika ada penanda eksplisit:
 *    - 'siang', 'sore', 'malam': jika 1 s.d. 11, tambah 12. (12 siang tetap 12, 12 malam jadi 0).
 *    - 'pagi', 'subuh': jika 12, jadi 0. Jika 1 s.d. 11, tetap.
 * 3. Jika TANPA penanda waktu (misal hanya "jam 3", "jam 1", "jam 8"):
 *    - jam 1 s.d. 6: otomatis dianggap SIANG/SORE (13.00 - 18.00) karena meeting bisnis tidak diadakan jam 1-6 pagi.
 *    - jam 7 s.d. 11:
 *      * Jika hari ini (dayOffset === 0) dan jam sekarang sudah melewati jam tersebut (currentHour > h): otomatis MALAM (+12).
 *      * Contoh: saat ini jam 13.00, user mengetik "zoom jam 8", berarti jam 20.00 (malam).
 *      * Jika belum lewat atau untuk besok: tetap pagi (07.00 - 11.00).
 *    - jam 12: tetap 12 (siang).
 */
export function normalizeHour(hour, period = null, { dayOffset = 0, currentHour = 12 } = {}) {
  let h = parseInt(hour, 10);
  if (isNaN(h)) return null;

  // Jika sudah dalam format 24 jam (misal jam 13 s.d 23)
  if (h > 12) return h;

  const p = period ? period.toLowerCase().trim() : null;

  if (p) {
    if (p === 'pagi' || p === 'subuh') {
      return h === 12 ? 0 : h;
    }
    if (p === 'siang' || p === 'sore' || p === 'malam') {
      if (h === 12) {
        return p === 'malam' ? 0 : 12;
      }
      return h < 12 ? h + 12 : h;
    }
  }

  // Tanpa penanda eksplisit (konteks cerdas meeting)
  if (h >= 1 && h <= 6) {
    // 1 s.d 6 sore/siang (13:00 - 18:00)
    return h + 12;
  }

  if (h >= 7 && h <= 11) {
    // Jika hari ini dan jam pagi tersebut sudah lewat, otomatis jadikan malam (+12)
    if (dayOffset === 0 && currentHour >= 12 && currentHour > h) {
      return h + 12;
    }
    return h;
  }

  if (h === 12) {
    return 12; // 12 siang
  }

  return h;
}

/**
 * Parser berbasis Rule/Template (Regex & Keyword Matching).
 * Mengerti perintah Zoom maupun Meeting (misal: "buatkan link meeting jam 1 siang dengan finance").
 * Jika pesan tidak terkait pembuatan meeting, pesan akan diabaikan (tidak dijawab).
 */

export function parseMeetingCommand(messageText, defaultTz = process.env.DEFAULT_TIMEZONE || 'Asia/Jakarta') {
  if (!messageText || typeof messageText !== 'string') return null;

  const text = messageText.trim();
  const lower = text.toLowerCase();

  // 1. Abaikan jika ini adalah perintah pembatalan / hapus, cek jadwal, edit, atau info/panduan
  const isCancel = /(?:hapus|batal(?:kan)?|cancel|delete)/i.test(lower);
  const isList = /(?:cek\s+jadwal|lihat\s+jadwal|daftar\s+jadwal|list\s+jadwal|jadwal\s+zoom|daftar\s+zoom|list\s+zoom|ada\s+jadwal\s+apa|!jadwal|!list)/i.test(lower);
  const isEdit = /(?:ubah|ganti|edit|reschedule|geser)\s+(?:jadwal\s+)?(?:link\s+)?(?:zoom|meeting|miting)?/i.test(lower) || /^[!/](?:edit|ubah|reschedule)/i.test(lower);
  const isHelp = /^[!/#](?:info|help|bantuan|menu|panduan|petunjuk)\b/i.test(lower) || /^(?:info|help|menu|panduan|petunjuk|bantuan|cara\s+pakai|halo|hai|hi|p)$/i.test(lower);
  if (isCancel || isList || isEdit || isHelp) {
    return null;
  }

  // 2. Abaikan negasi eksplisit (misal: "jangan buat zoom", "bukan zoom", "gak usah zoom", "nggak usah buat zoom")
  const isNegation = /(?:jangan|bukan|gak\s*usah|nggak\s*usah|tidak\s*usah|gak\s*perlu|nggak\s*perlu)\s+(?:(?:buat(?:kan)?|bikin(?:in)?|minta|jadwal(?:kan)?)\s+)?(?:link\s+)?(?:zoom|meeting|miting)/i.test(lower);
  if (isNegation) {
    return null;
  }

  // 3. Deteksi apakah ini hanya obrolan biasa yang menyebut kata zoom / aplikasi zoom (BUKAN perintah membuat)
  const isCasualChatAboutZoom = /(?:^|\s)(?:di|pada|dalam)\s+zoom(?:nya)?(?:\s|$)/i.test(lower) ||
                                /(?:zoom(?:nya)?\s+(?:error|rusak|lemot|bermasalah|ngefreeze|lag|putus|aman|bagus|bisa|gabisa|gak\s+bisa))/i.test(lower) ||
                                /(?:lagi|sedang)\s+(?:buka|masuk|ikut|ada\s+di)\s+zoom/i.test(lower) ||
                                /(?:buka|tutup|update|install|download)\s+zoom/i.test(lower) ||
                                /(?:zoom\s+(?:siapa|apa|kenapa|kok|mana))/i.test(lower);

  // 4. Periksa apakah ada INTENSI EKSPLISIT untuk membuat meeting / meminta link zoom:
  const isCommandPrefix = /^[!/](?:meeting|zoom)/i.test(lower);

  // Kata kerja permintaan pembuatan meeting:
  const hasActionVerb = /(?:buat(?:kan)?|bikin(?:in)?|minta|jadwal(?:kan|in)?|tolong(?:\s+buat(?:kan)?|\s+bikin|\s+link)?|order|pesan|booking|create|generate|setup|siapkan)\s+(?:link\s+)?(?:zoom|meeting|miting)/i.test(lower) ||
                        /(?:ada\s+)?(?:link\s+)(?:zoom|meeting|miting)\s+(?:untuk|buat|jam|besok|sekarang|dong|ya|gak|kah)/i.test(lower) ||
                        /^(?:minta\s+)?link\s+(?:zoom|meeting|miting)(?:\s+(?:dong|ya|kak|pak|bu|min|bang))?$/i.test(lower);

  // Kata "zoom" atau "meeting" yang diikuti penunjuk waktu spesifik
  const hasZoomWithTime = /(?:zoom|meeting|miting)\s+(?:hari\s+ini\s+|besok\s+|lusa\s+)?(?:jam\s*\d{1,2}|nanti\s+jam|\d{1,2}[.:]\d{2})/i.test(lower);

  // Jika tidak memenuhi satu pun kriteria intensi membuat meeting:
  if (!isCommandPrefix && !hasActionVerb && !hasZoomWithTime) {
    return null;
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
  let matchedHour = null;
  let matchedMinute = 0;

  const timeRegex = /(?:jam\s*)?(\d{1,2})[.:](\d{2})(?:\s*(?:wib|wita|wit))?(?:\s*(pagi|siang|sore|malam|subuh))?/i;
  const hourSimpleRegex = /jam\s*(\d{1,2})(?:\s*(?:wib|wita|wit))?(?:\s*(pagi|siang|sore|malam|subuh))?/i;

  const matchFull = lower.match(timeRegex);
  const matchSimple = lower.match(hourSimpleRegex);

  if (matchFull) {
    let hour = parseInt(matchFull[1], 10);
    matchedMinute = parseInt(matchFull[2], 10);
    const period = matchFull[3];
    matchedHour = normalizeHour(hour, period, { dayOffset, currentHour: nowTz.hour });
  } else if (matchSimple) {
    let hour = parseInt(matchSimple[1], 10);
    const period = matchSimple[2];
    matchedHour = normalizeHour(hour, period, { dayOffset, currentHour: nowTz.hour });
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
  const timeRegex = /(?:jam\s*)?(\d{1,2})[.:](\d{2})\s*(pagi|siang|sore|malam|subuh)?/i;
  const hourSimpleRegex = /jam\s*(\d{1,2})\s*(pagi|siang|sore|malam|subuh)?/i;

  const matchFull = lower.match(timeRegex);
  const matchSimple = lower.match(hourSimpleRegex);

  if (matchFull) {
    let hour = parseInt(matchFull[1], 10);
    matchedMinute = parseInt(matchFull[2], 10);
    const period = matchFull[3];
    matchedHour = normalizeHour(hour, period);
  } else if (matchSimple) {
    let hour = parseInt(matchSimple[1], 10);
    const period = matchSimple[2];
    matchedHour = normalizeHour(hour, period);
  }

  // 3. Cek nama tim / topik jika ada
  let targetTopic = null;
  const topicMatch = text.match(/(?:tim|buat|untuk|dengan|bahas|tentang)\s+([a-zA-Z0-9\s-_]+)/i);
  if (topicMatch && topicMatch[1]) {
    targetTopic = topicMatch[1]
      .replace(/sekarang|besok|lusa|jam\s*\d+([.:]\d+)?\s*(pagi|siang|sore|malam|subuh)?/gi, '')
      .trim();
  } else {
    let cleaned = text
      .replace(/^!(?:hapus|batal|cancel)\s*/i, '')
      .replace(/(?:hapus|batal(?:kan)?|cancel|delete)\s+(?:link\s+)?(?:zoom|meeting|miting|jadwal)?/gi, '')
      .replace(/sekarang|besok|lusa|hari ini/gi, '')
      .replace(/(?:jam\s*)?\d{1,2}[.:]\d{2}\s*(pagi|siang|sore|malam|subuh)?/gi, '')
      .replace(/jam\s*\d{1,2}\s*(pagi|siang|sore|malam|subuh)?/gi, '')
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

/**
 * Parsing perintah ubah / edit / reschedule jadwal meeting Zoom.
 * Contoh:
 * - "ubah zoom jam 2 siang jadi jam 4 sore"
 * - "ganti jadwal zoom tim marketing ke besok jam 10 pagi"
 * - "reschedule zoom 89234567890 ke jam 3 sore"
 * - "edit topik zoom jam 2 jadi Review Project Alpha"
 * - "ganti jadwal zoom tim finance jadi sekarang saja"
 * 
 * @param {string} messageText 
 * @param {string} defaultTz 
 * @returns {object|null}
 */
export function parseEditCommand(messageText, defaultTz = process.env.DEFAULT_TIMEZONE || 'Asia/Jakarta') {
  if (!messageText || typeof messageText !== 'string') return null;

  const text = messageText.trim();
  const lower = text.toLowerCase();

  const isEditTrigger = /(?:ubah|ganti|edit|reschedule|geser)\s+(?:jadwal\s+)?(?:link\s+)?(?:zoom|meeting|miting)?/i.test(lower) ||
                        /^[!/](?:edit|ubah|reschedule)/i.test(lower);

  if (!isEditTrigger) return null;

  // 1. Ekstrak Meeting ID (9-11 digit) jika ada
  const idMatch = text.match(/\b\d{9,11}\b/);
  const meetingId = idMatch ? idMatch[0] : null;

  // 2. Pemisahan bagian LAMA (target yang mau diubah) dan bagian BARU (perubahan)
  // Dipisahkan oleh kata: "jadi", "menjadi", "ke", "pindah ke", "to"
  let oldPart = '';
  let newPart = '';

  const splitMatch = text.match(/(.*?)\s+(?:jadi|menjadi|ke|pindah\s+ke|to)\s+(.*)/i);
  if (splitMatch) {
    oldPart = splitMatch[1];
    newPart = splitMatch[2].trim();
  } else {
    oldPart = text;
    newPart = text;
  }

  // 3. Ekstrak waktu/target lama dari oldPart
  let targetOldHour = null;
  let targetTopic = null;

  if (oldPart) {
    const oldPartLower = oldPart.toLowerCase();
    const oldTimeRegex = /(?:jam\s*)?(\d{1,2})[.:](\d{2})?(?:\s*(pagi|siang|sore|malam|subuh))?/i;
    const oldHourSimpleRegex = /jam\s*(\d{1,2})(?:\s*(pagi|siang|sore|malam|subuh))?/i;

    const matchOldFull = oldPartLower.match(oldTimeRegex);
    const matchOldSimple = oldPartLower.match(oldHourSimpleRegex);

    if (matchOldFull && matchOldFull[1]) {
      let h = parseInt(matchOldFull[1], 10);
      const period = matchOldFull[3];
      targetOldHour = normalizeHour(h, period);
    } else if (matchOldSimple && matchOldSimple[1]) {
      let h = parseInt(matchOldSimple[1], 10);
      const period = matchOldSimple[2];
      targetOldHour = normalizeHour(h, period);
    }

    const topicMatch = oldPart.match(/(?:tim|untuk|dengan|buat|topik)\s+([a-zA-Z0-9\s-_]+)/i);
    if (topicMatch && topicMatch[1]) {
      const candidate = topicMatch[1]
        .replace(/jam\s*\d+/gi, '')
        .replace(/\b(?:zoom|meeting|miting)\b/gi, '')
        .trim();
      if (candidate.length > 1) {
        targetTopic = candidate;
      }
    }
  }

  // 4. Ekstrak waktu baru dari newPart
  let newHour = null;
  let newMinute = 0;
  let dayOffset = 0;
  const newPartLower = newPart.toLowerCase();

  if (newPartLower.includes('besok')) dayOffset = 1;
  else if (newPartLower.includes('lusa')) dayOffset = 2;

  const nowTz = getNowInTimezone(defaultTz);

  // Cek apakah meminta waktu "sekarang" / "sekarang saja" / "now" / "langsung"
  const isNow = /(?:sekarang(?:\s+saja)?|now|langsung)/i.test(newPartLower);

  if (isNow) {
    newHour = nowTz.hour;
    newMinute = nowTz.minute;
    dayOffset = 0;
  } else {
    const timeRegex = /(?:jam\s*)?(\d{1,2})[.:](\d{2})(?:\s*(?:wib|wita|wit))?(?:\s*(pagi|siang|sore|malam|subuh))?/i;
    const hourSimpleRegex = /jam\s*(\d{1,2})(?:\s*(?:wib|wita|wit))?(?:\s*(pagi|siang|sore|malam|subuh))?/i;

    const matchFull = newPartLower.match(timeRegex);
    const matchSimple = newPartLower.match(hourSimpleRegex);

    if (matchFull) {
      let hour = parseInt(matchFull[1], 10);
      newMinute = parseInt(matchFull[2], 10);
      const period = matchFull[3];
      newHour = normalizeHour(hour, period, { dayOffset, currentHour: nowTz.hour });
    } else if (matchSimple) {
      let hour = parseInt(matchSimple[1], 10);
      const period = matchSimple[2];
      newHour = normalizeHour(hour, period, { dayOffset, currentHour: nowTz.hour });
    }
  }

  // 5. Cek apakah ada perubahan topik baru
  let newTopic = null;
  if (oldPart.toLowerCase().includes('topik') || oldPart.toLowerCase().includes('judul')) {
    if (newPart) {
      newTopic = newPart
        .replace(/(?:jam\s*)?\d{1,2}[.:]\d{2}(?:\s*(?:wib|wita|wit))?(?:\s*(pagi|siang|sore|malam))?/gi, '')
        .replace(/jam\s*\d{1,2}(?:\s*(?:wib|wita|wit))?(?:\s*(pagi|siang|sore|malam))?/gi, '')
        .replace(/besok|lusa|hari ini/gi, '')
        .trim();
    }
  } else {
    const topicKeywordMatch = text.match(/(?:topik|judul)\s+(?:baru\s+)?(?:jadi|menjadi|ke)?\s*[:=]?\s*([a-zA-Z0-9\s-_]+)/i);
    if (topicKeywordMatch && topicKeywordMatch[1]) {
      newTopic = topicKeywordMatch[1]
        .replace(/(?:jam\s*)?\d{1,2}[.:]\d{2}/gi, '')
        .replace(/jam\s*\d{1,2}/gi, '')
        .replace(/besok|lusa|hari ini/gi, '')
        .trim();
    }
  }

  // Hitung ISO waktu baru jika jam baru terdeteksi
  let newStartTime = null;
  if (newHour !== null) {
    const nowTz = getNowInTimezone(defaultTz);
    let targetYear = nowTz.year;
    let targetMonth = nowTz.month;
    let targetDay = nowTz.day;

    if (dayOffset > 0) {
      const d = new Date(targetYear, targetMonth - 1, targetDay + dayOffset);
      targetYear = d.getFullYear();
      targetMonth = d.getMonth() + 1;
      targetDay = d.getDate();
    }

    const yyyy = targetYear;
    const mm = String(targetMonth).padStart(2, '0');
    const dd = String(targetDay).padStart(2, '0');
    const hh = String(newHour).padStart(2, '0');
    const min = String(newMinute).padStart(2, '0');
    const offset = getTimezoneOffsetString(defaultTz);

    newStartTime = `${yyyy}-${mm}-${dd}T${hh}:${min}:00${offset}`;
  }

  return {
    isEditCommand: true,
    meetingId,
    targetOldHour,
    targetTopic,
    newStartTime,
    newHour,
    newMinute,
    newTopic
  };
}

/**
 * Parsing perintah bantuan / panduan (!info, !help, !menu, dll),
 * sapaan di Personal Chat (PC), atau bot di-tag di grup tanpa perintah tertentu.
 * 
 * @param {string} messageText 
 * @param {object} options
 * @param {boolean} options.isGroup
 * @param {boolean} options.isBotMentioned
 * @param {boolean} options.isPrivateChat
 * @returns {object|null}
 */
export function parseHelpCommand(messageText, { isGroup = false, isBotMentioned = false, isPrivateChat = false } = {}) {
  // Jika bot di-mention di grup dan teks kosong / hanya whitespace
  if (isGroup && isBotMentioned && (!messageText || typeof messageText !== 'string' || messageText.trim() === '')) {
    return { isHelpCommand: true, trigger: 'group_mention' };
  }

  if (!messageText || typeof messageText !== 'string') return null;

  const text = messageText.trim();
  const lower = text.toLowerCase();

  // 1. Perintah eksplisit untuk panduan / bantuan
  const isExplicitHelp = /^[!/#](?:info|help|menu|panduan|bantuan|petunjuk)\b/i.test(lower) ||
                         /^(?:info\s+zoom|menu\s+bot|bantuan|panduan|petunjuk|cara\s+(?:pakai|booking|pesan|buat|jadwal(?:kan)?|edit|ubah|hapus|batal)|help|info)$/i.test(lower);

  if (isExplicitHelp) {
    return { isHelpCommand: true, trigger: 'explicit' };
  }

  // 2. Jika bot di-tag/di-mention di grup
  if (isGroup && isBotMentioned) {
    // Periksa apakah pesan mengandung aksi spesifik
    const hasSpecificAction = /(?:buat|bikin|jadwal|pesan|order|minta|booking|hapus|batal|cancel|delete|cek|lihat|daftar|list|ubah|ganti|edit|reschedule|geser|rekam|record)/i.test(lower);
    if (!hasSpecificAction) {
      return { isHelpCommand: true, trigger: 'group_mention' };
    }
  }

  // 3. Jika di Personal Chat (PC)
  if (isPrivateChat) {
    const isGreeting = /^(?:halo|hai|hi|hey|hello|assalamu['’]?alaikum|selamat\s+(?:pagi|siang|sore|malam)|permisi|p|ping|tes|test|min|bot|admin|assalamualaikum)[!.,? ]*$/i.test(lower) ||
                       /^(?:halo|hai|hi|hello|permisi|assalamu['’]?alaikum)\b/i.test(lower) ||
                       /(?:mau\s+tanya|bisa\s+bantu|tolong\s+bantu|butuh\s+bantuan|gimana\s+caranya|apa\s+menu(?:nya)?)/i.test(lower);

    const hasSpecificAction = /(?:buat|bikin|jadwal|pesan|order|minta|booking|hapus|batal|cancel|delete|cek|lihat|daftar|list|ubah|ganti|edit|reschedule|geser|rekam|record)/i.test(lower);

    if (isGreeting && !hasSpecificAction) {
      return { isHelpCommand: true, trigger: 'private_greeting' };
    }
  }

  return null;
}



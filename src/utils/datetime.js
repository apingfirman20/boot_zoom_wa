/**
 * Utility helper untuk kalkulasi dan format waktu berdasarkan timezone.
 */

/**
 * Menghitung string offset timezone (contoh: "+07:00" untuk Asia/Jakarta, "+08:00" untuk Asia/Makassar).
 * @param {string} timezone
 * @param {Date} date
 * @returns {string}
 */
export function getTimezoneOffsetString(timezone = process.env.DEFAULT_TIMEZONE || 'Asia/Jakarta', date = new Date()) {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'longOffset'
    });
    const parts = formatter.formatToParts(date);
    const tzPart = parts.find(p => p.type === 'timeZoneName');
    if (tzPart && tzPart.value) {
      const match = tzPart.value.match(/GMT([+-]\d{1,2}):?(\d{2})?/);
      if (match) {
        const sign = match[1].slice(0, 1);
        const hours = match[1].slice(1).padStart(2, '0');
        const minutes = (match[2] || '00').padStart(2, '0');
        return `${sign}${hours}:${minutes}`;
      }
    }
  } catch (e) {}
  return '+07:00';
}

/**
 * Mendapatkan komponen waktu saat ini (year, month, day, hour, minute, second)
 * dalam timezone target (default: Asia/Jakarta).
 * Mencegah kesalahan tanggal/jam ketika server berjalan di sistem dengan TZ=UTC (seperti Docker / Cloud).
 * 
 * @param {string} timezone
 * @returns {{ year: number, month: number, day: number, hour: number, minute: number, second: number }}
 */
export function getNowInTimezone(timezone = process.env.DEFAULT_TIMEZONE || 'Asia/Jakarta') {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(now);
  const getPart = (type) => parts.find(p => p.type === type)?.value;
  return {
    year: parseInt(getPart('year'), 10),
    month: parseInt(getPart('month'), 10),
    day: parseInt(getPart('day'), 10),
    hour: parseInt(getPart('hour'), 10),
    minute: parseInt(getPart('minute'), 10),
    second: parseInt(getPart('second'), 10)
  };
}

/**
 * Mengonversi input waktu menjadi Date yang tepat.
 * Jika input berupa string ISO tanpa offset timezone (contoh: "2026-09-08T14:00:00"),
 * maka otomatis ditambahkan offset timezone target sehingga runtime tidak menganggapnya sebagai UTC 14.00.
 * 
 * @param {string|Date} dateInput
 * @param {string} timezone
 * @returns {Date}
 */
export function parseToDate(dateInput, timezone = process.env.DEFAULT_TIMEZONE || 'Asia/Jakarta') {
  if (!dateInput) return new Date();
  if (dateInput instanceof Date) return dateInput;

  let str = String(dateInput).trim();
  // Jika string berformat ISO YYYY-MM-DDTHH:mm(:ss) tanpa penanda offset (+XX:XX, -XX:XX, atau Z)
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?$/i.test(str)) {
    const offset = getTimezoneOffsetString(timezone);
    str = str + offset;
  }
  return new Date(str);
}

/**
 * Mendapatkan informasi waktu saat ini dalam timezone target (default: Asia/Jakarta).
 * @param {string} timezone
 * @returns {{ now: Date, isoString: string, localString: string, timezone: string }}
 */
export function getCurrentTimeContext(timezone = process.env.DEFAULT_TIMEZONE || 'Asia/Jakarta') {
  const now = new Date();
  
  // Format waktu lokal ramah baca untuk prompt ke AI
  const localString = new Intl.DateTimeFormat('id-ID', {
    timeZone: timezone,
    dateStyle: 'full',
    timeStyle: 'long'
  }).format(now);

  return {
    now,
    isoString: now.toISOString(),
    localString,
    timezone
  };
}

/**
 * Memformat string ISO waktu meeting menjadi teks bahasa Indonesia yang ramah dibaca di WhatsApp.
 * Contoh: "Selasa, 8 September 2026 pukul 14.00 (Asia/Jakarta)"
 * @param {string|Date} dateInput
 * @param {string} timezone
 * @returns {string}
 */
export function formatMeetingTime(dateInput, timezone = process.env.DEFAULT_TIMEZONE || 'Asia/Jakarta') {
  try {
    const date = parseToDate(dateInput, timezone);
    if (isNaN(date.getTime())) {
      return String(dateInput);
    }

    const formattedDate = new Intl.DateTimeFormat('id-ID', {
      timeZone: timezone,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(date);

    return `${formattedDate} (${timezone})`;
  } catch {
    return String(dateInput);
  }
}


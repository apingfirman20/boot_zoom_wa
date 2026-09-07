/**
 * Utility helper untuk kalkulasi dan format waktu berdasarkan timezone.
 */

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
 * Contoh: "Senin, 08 September 2026, 14:00 WIB"
 * @param {string|Date} dateInput
 * @param {string} timezone
 * @returns {string}
 */
export function formatMeetingTime(dateInput, timezone = process.env.DEFAULT_TIMEZONE || 'Asia/Jakarta') {
  try {
    const date = new Date(dateInput);
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

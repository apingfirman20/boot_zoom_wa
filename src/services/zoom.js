/**
 * Service integrasi Zoom API menggunakan Server-to-Server OAuth.
 */

let cachedAccessToken = null;
let tokenExpiresAt = 0;

/**
 * Mendapatkan access token Zoom via Server-to-Server OAuth.
 * Dilengkapi caching in-memory selama token masih valid.
 * 
 * @returns {Promise<string>}
 */
export async function getZoomAccessToken() {
  const accountId = process.env.ZOOM_ACCOUNT_ID;
  const clientId = process.env.ZOOM_CLIENT_ID;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET;

  if (!accountId || !clientId || !clientSecret) {
    throw new Error('Zoom credentials (ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET) belum lengkap di environment variables');
  }

  // Gunakan token dari cache jika belum kedaluwarsa (beri buffer 60 detik)
  const now = Date.now();
  if (cachedAccessToken && now < tokenExpiresAt - 60000) {
    return cachedAccessToken;
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const tokenUrl = `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`;

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gagal mendapatkan Zoom access token (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  cachedAccessToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in * 1000);

  return cachedAccessToken;
}

/**
 * Membuat meeting baru di akun Zoom.
 * 
 * @param {Object} options
 * @param {string} options.topic - Judul meeting
 * @param {string} [options.startTime] - Waktu mulai ISO (contoh: 2026-09-08T14:00:00)
 * @param {number} [options.duration=45] - Durasi meeting (menit)
 * @param {string} [options.timezone] - Timezone (default: Asia/Jakarta)
 * @returns {Promise<{
 *   joinUrl: string,
 *   meetingId: string,
 *   passcode: string,
 *   topic: string,
 *   startTime: string,
 *   duration: number
 * }>}
 */
export async function createZoomMeeting({
  topic = 'WhatsApp AI Scheduled Meeting',
  startTime = null,
  duration = 45,
  timezone = process.env.DEFAULT_TIMEZONE || 'Asia/Jakarta'
}) {
  const accessToken = await getZoomAccessToken();

  const bodyPayload = {
    topic,
    type: 2, // Scheduled meeting
    duration: Number(duration) || 45,
    timezone,
    settings: {
      host_video: true,
      participant_video: true,
      join_before_host: false,
      mute_upon_entry: true,
      waiting_room: true
    }
  };

  if (startTime) {
    bodyPayload.start_time = startTime;
  }

  const response = await fetch('https://api.zoom.us/v2/users/me/meetings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(bodyPayload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gagal membuat Zoom Meeting (${response.status}): ${errorText}`);
  }

  const meetingData = await response.json();

  return {
    joinUrl: meetingData.join_url,
    meetingId: String(meetingData.id),
    passcode: meetingData.password || '',
    topic: meetingData.topic,
    startTime: meetingData.start_time,
    duration: meetingData.duration
  };
}

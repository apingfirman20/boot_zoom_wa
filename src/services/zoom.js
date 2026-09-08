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
  timezone = process.env.DEFAULT_TIMEZONE || 'Asia/Jakarta',
  autoRecord = false
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
      waiting_room: true,
      auto_recording: autoRecord ? 'cloud' : 'none'
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
    duration: meetingData.duration,
    autoRecord: Boolean(autoRecord)
  };
}

/**
 * Memeriksa apakah meeting tertentu masih ada/aktif di akun Zoom.
 * Menggunakan method PATCH kosong (hanya butuh scope meeting:write yang sudah dimiliki bot).
 * 
 * @param {string|number} meetingId
 * @returns {Promise<boolean>} true jika meeting masih ada di Zoom, false jika sudah dihapus
 */
export async function checkMeetingExists(meetingId) {
  if (!meetingId) return false;
  try {
    const accessToken = await getZoomAccessToken();
    const response = await fetch(`https://api.zoom.us/v2/meetings/${meetingId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });

    if (response.status === 204 || response.status === 200) {
      return true;
    }

    if (response.status === 404) {
      return false;
    }

    const data = await response.json().catch(() => ({}));
    if (data.code === 3001) {
      return false;
    }

    // Jika terjadi error lain di luar meeting tidak ada, asumsikan masih ada untuk keamanan
    return true;
  } catch (err) {
    console.error(`Gagal mengecek status meeting ${meetingId} di Zoom:`, err.message);
    return true;
  }
}

/**
 * Menghapus meeting dari akun Zoom via API.
 * 
 * @param {string|number} meetingId
 * @returns {Promise<boolean>}
 */
export async function deleteZoomMeeting(meetingId) {
  if (!meetingId) return false;
  const accessToken = await getZoomAccessToken();
  const response = await fetch(`https://api.zoom.us/v2/meetings/${meetingId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });

  if (response.status === 204 || response.status === 200 || response.status === 404) {
    return true;
  }

  const errorText = await response.text();
  throw new Error(`Gagal menghapus meeting di Zoom (${response.status}): ${errorText}`);
}

/**
 * Memulai perekaman Cloud pada meeting yang sedang berlangsung (live) atau terjadwal.
 * Mengaktifkan setting auto_recording cloud dan mengirim sinyal recording.start ke live meeting.
 * 
 * @param {string|number} meetingId
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export async function startLiveMeetingRecording(meetingId) {
  if (!meetingId) throw new Error('Meeting ID diperlukan untuk memulai rekaman.');
  const accessToken = await getZoomAccessToken();

  // 1. Update pengaturan meeting agar auto_recording diset ke 'cloud'
  try {
    await fetch(`https://api.zoom.us/v2/meetings/${meetingId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        settings: {
          auto_recording: 'cloud'
        }
      })
    });
  } catch (err) {
    console.warn(`Peringatan saat update settings meeting ${meetingId}:`, err.message);
  }

  // 2. Kirim sinyal in-meeting control recording.start jika meeting sudah berjalan (live)
  try {
    const resLive = await fetch(`https://api.zoom.us/v2/live_meetings/${meetingId}/events`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        method: 'recording.start'
      })
    });

    if (resLive.status === 204 || resLive.status === 200) {
      console.log(`🎬 Berhasil mengirim sinyal rekaman live ke meeting ID: ${meetingId}`);
      return { success: true, message: 'Rekaman live berhasil dimulai di Zoom.' };
    }
  } catch (err) {
    console.warn(`Peringatan saat panggil live_meetings/events ${meetingId}:`, err.message);
  }

  return { success: true, message: 'Perekaman Cloud Zoom telah diaktifkan untuk meeting ini.' };
}

export function clearZoomTokenCache() {
  cachedAccessToken = null;
  tokenExpiresAt = 0;
}

/**
 * Mengambil detail file rekaman Cloud dari meeting yang telah selesai.
 * 
 * @param {string|number} meetingId
 * @returns {Promise<{
 *   shareUrl: string,
 *   password: string,
 *   recordingFiles: Array
 * }|null>}
 */
export async function getMeetingRecordings(meetingId) {
  if (!meetingId) return null;
  try {
    const accessToken = await getZoomAccessToken();
    const response = await fetch(`https://api.zoom.us/v2/meetings/${meetingId}/recordings`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      if (response.status === 400 || response.status === 401) {
        // Reset cache token agar ketika user menambahkan scope di Zoom Marketplace, token langsung ter-refresh
        cachedAccessToken = null;
        tokenExpiresAt = 0;
      }
      return null;
    }

    const data = await response.json();
    return {
      shareUrl: data.share_url || '',
      password: data.password || '',
      recordingFiles: data.recording_files || [],
      duration: data.duration || 0,
      totalSize: data.total_size || 0
    };
  } catch (err) {
    console.error(`Gagal mengambil rekaman meeting ${meetingId}:`, err.message);
    return null;
  }
}



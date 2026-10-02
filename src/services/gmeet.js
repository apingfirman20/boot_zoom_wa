/**
 * Service integrasi Google Meet API v2 menggunakan OAuth 2.0 (Refresh Token).
 * Mendukung pembuatan link Google Meet dengan:
 * - accessType: OPEN (langsung masuk tanpa approval / knocking host)
 * - autoRecording: ON (otomatis rekam ke Google Cloud / Google Drive)
 * - smartNotes: ON (rangkuman / notula rapat otomatis dengan Gemini Workspace)
 */

let cachedAccessToken = null;
let tokenExpiresAt = 0;

/**
 * Memeriksa apakah konfigurasi kredensial Google Meet sudah lengkap di environment variables.
 * @returns {boolean}
 */
export function isGoogleConfigured() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REFRESH_TOKEN
  );
}

/**
 * Mendapatkan access token Google API via OAuth 2.0 Refresh Token.
 * Dilengkapi in-memory caching sebelum masa berlaku kedaluwarsa.
 * 
 * @returns {Promise<string>}
 */
export async function getGoogleAccessToken() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Kredensial Google (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN) belum lengkap di .env. ' +
      'Silakan jalankan "node setup-google.js" untuk menghubungkan akun Google Anda.'
    );
  }

  // Gunakan token dari cache jika masih berlaku (buffer 60 detik)
  const now = Date.now();
  if (cachedAccessToken && now < tokenExpiresAt - 60000) {
    return cachedAccessToken;
  }

  const tokenUrl = 'https://oauth2.googleapis.com/token';
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gagal mendapatkan Google access token (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  cachedAccessToken = data.access_token;
  tokenExpiresAt = Date.now() + ((data.expires_in || 3600) * 1000);

  return cachedAccessToken;
}

/**
 * Membuat ruangan Google Meet baru dengan konfigurasi:
 * - accessType = 'OPEN' (peserta langsung masuk tanpa tunggu di-acc / tanpa knocking)
 * - autoRecording = ON (otomatis rekam jika didukung akun)
 * - smartNotes = ON (otomatis rangkum catatan rapat Gemini jika didukung akun)
 * 
 * @param {Object} options
 * @param {string} options.topic - Judul atau topik meeting
 * @param {string} [options.startTime] - Waktu mulai ISO
 * @param {number} [options.duration=60] - Durasi meeting (menit)
 * @param {boolean} [options.autoRecord=true] - Otomatis mulai rekam
 * @param {boolean} [options.autoSummary=true] - Otomatis buat smart notes Gemini
 * @returns {Promise<{
 *   joinUrl: string,
 *   meetingCode: string,
 *   spaceName: string,
 *   topic: string,
 *   startTime: string,
 *   duration: number,
 *   autoRecord: boolean,
 *   autoSummary: boolean
 * }>}
 */
export async function createGoogleMeeting({
  topic = 'Google Meet',
  startTime = null,
  duration = Number(process.env.DEFAULT_MEETING_DURATION) || 60,
  autoRecord = true,
  autoSummary = true
} = {}) {
  const accessToken = await getGoogleAccessToken();

  // Susun payload konfigurasi Google Meet Space
  const config = {
    accessType: 'OPEN', // Langsung masuk tanpa approval host / knocking
    entryPointAccess: 'ALL'
  };

  const artifactConfig = {};
  if (autoRecord) {
    artifactConfig.recordingConfig = {
      autoRecordingGeneration: 'ON'
    };
  }
  if (autoSummary) {
    artifactConfig.smartNotesConfig = {
      autoSmartNotesGeneration: 'ON'
    };
    artifactConfig.transcriptionConfig = {
      autoTranscriptionGeneration: 'ON'
    };
  }

  if (Object.keys(artifactConfig).length > 0) {
    config.artifactConfig = artifactConfig;
  }

  const requestBody = { config };

  let response = await fetch('https://meet.googleapis.com/v2/spaces', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  // Jika gagal karena artifactConfig (misal lisensi akun belum mengaktifkan Smart Notes/Recording via API),
  // lakukan fallback ke OPEN access tanpa artifactConfig agar pembuatan link tetap 100% sukses
  if (!response.ok && response.status === 400 && Object.keys(artifactConfig).length > 0) {
    console.warn('⚠️ Google Meet API menolak artifactConfig, mencoba fallback dengan accessType: OPEN...');
    response = await fetch('https://meet.googleapis.com/v2/spaces', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        config: {
          accessType: 'OPEN',
          entryPointAccess: 'ALL'
        }
      })
    });
  }

  // Jika masih gagal (misal accessType OPEN tidak diizinkan oleh kebijakan domain organisasi),
  // fallback ke default space
  if (!response.ok && response.status === 400) {
    console.warn('⚠️ Google Meet API menolak accessType OPEN, mencoba fallback default space...');
    response = await fetch('https://meet.googleapis.com/v2/spaces', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gagal membuat Google Meet Space (${response.status}): ${errorText}`);
  }

  const spaceData = await response.json();

  return {
    joinUrl: spaceData.meetingUri,
    meetingCode: spaceData.meetingCode || spaceData.name?.replace('spaces/', '') || '',
    spaceName: spaceData.name || '',
    topic: topic || 'Google Meet',
    startTime: startTime || new Date().toISOString(),
    duration: Number(duration) || 60,
    autoRecord: Boolean(autoRecord),
    autoSummary: Boolean(autoSummary),
    accessType: spaceData.config?.accessType || 'OPEN'
  };
}

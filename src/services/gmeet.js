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

/**
 * Mendapatkan detail Space Google Meet berdasarkan kode meeting (misal pcd-gzmt-gco)
 * atau nama space (misal spaces/J8X_xKu8iKAB).
 * 
 * @param {string} spaceOrCode
 * @returns {Promise<object|null>}
 */
export async function getGoogleSpace(spaceOrCode) {
  if (!spaceOrCode) return null;
  const accessToken = await getGoogleAccessToken();
  const cleanId = String(spaceOrCode).trim().replace(/^spaces\//, '');
  
  try {
    const res = await fetch(`https://meet.googleapis.com/v2/spaces/${cleanId}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error(`Gagal mengambil detail Google Space ${spaceOrCode}:`, err.message);
    return null;
  }
}

/**
 * Mengambil daftar conference records untuk suatu space atau conference records terbaru.
 * 
 * @param {string} [spaceName]
 * @returns {Promise<Array<object>>}
 */
export async function getGoogleConferenceRecords(spaceName = null) {
  const accessToken = await getGoogleAccessToken();
  const url = 'https://meet.googleapis.com/v2/conferenceRecords?pageSize=50';

  if (spaceName) {
    const formattedSpace = spaceName.startsWith('spaces/') ? spaceName : `spaces/${spaceName}`;
    const filterQuery = `space.name="${formattedSpace}"`;
    const filterUrl = `${url}&filter=${encodeURIComponent(filterQuery)}`;

    try {
      const res = await fetch(filterUrl, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.conferenceRecords) && data.conferenceRecords.length > 0) {
          return data.conferenceRecords;
        }
      }
    } catch (filterErr) {
      // Lanjut ke fallback di bawah
    }

    // Fallback cerdas: Ambil daftar conference records terbaru dan filter secara lokal di memori
    // untuk mencegah kegagalan akibat URL encoding query filter di Google Meet API v2
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (!res.ok) return [];
      const data = await res.json();
      const records = data.conferenceRecords || [];
      const cleanTarget = formattedSpace.replace(/^spaces\//, '');
      return records.filter(r => r.space && (r.space.includes(cleanTarget) || cleanTarget.includes(r.space.replace(/^spaces\//, ''))));
    } catch (err) {
      console.error('Gagal mengambil Google conference records:', err.message);
      return [];
    }
  }

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.conferenceRecords || [];
  } catch (err) {
    console.error('Gagal mengambil Google conference records:', err.message);
    return [];
  }
}

/**
 * Mengambil detail rapat Google Meet yang telah selesai (durasi, start time, end time, dsb).
 * 
 * @param {string} spaceOrCode
 * @returns {Promise<object|null>}
 */
export async function getGooglePastMeetingDetails(spaceOrCode) {
  if (!spaceOrCode) return null;
  let targetSpaceName = spaceOrCode;
  let meetingCode = spaceOrCode;
  let spaceTopic = 'Google Meet';

  if (!String(spaceOrCode).startsWith('conferenceRecords/')) {
    const space = await getGoogleSpace(spaceOrCode);
    if (space) {
      targetSpaceName = space.name;
      meetingCode = space.meetingCode || space.name?.replace('spaces/', '');
    }
  }

  let confs = [];
  if (String(spaceOrCode).startsWith('conferenceRecords/')) {
    const accessToken = await getGoogleAccessToken();
    const res = await fetch(`https://meet.googleapis.com/v2/${spaceOrCode}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (res.ok) {
      confs = [await res.json()];
    }
  } else {
    confs = await getGoogleConferenceRecords(targetSpaceName);
  }

  if (!confs || confs.length === 0) return null;

  // Urutkan berdasarkan waktu mulai terbaru
  const sorted = confs.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
  const latestConf = sorted[0];

  let durationMinutes = 0;
  if (latestConf.startTime && latestConf.endTime) {
    const s = new Date(latestConf.startTime).getTime();
    const e = new Date(latestConf.endTime).getTime();
    if (e > s) {
      durationMinutes = Math.round((e - s) / 60000);
    }
  }

  return {
    id: meetingCode,
    meetingCode,
    conferenceRecordName: latestConf.name,
    spaceName: latestConf.space || targetSpaceName,
    topic: spaceTopic,
    startTime: latestConf.startTime,
    endTime: latestConf.endTime,
    duration: durationMinutes,
    isEnded: Boolean(latestConf.endTime)
  };
}

/**
 * Mengambil daftar peserta yang bergabung dalam rapat Google Meet.
 * 
 * @param {string} confRecordName
 * @returns {Promise<Array<object>>}
 */
export async function getGoogleMeetingParticipants(confRecordName) {
  if (!confRecordName) return [];
  const accessToken = await getGoogleAccessToken();

  try {
    const res = await fetch(`https://meet.googleapis.com/v2/${confRecordName}/participants?pageSize=100`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) return [];
    const data = await res.json();
    const participants = data.participants || [];

    return participants.map(p => {
      let durText = '';
      if (p.earliestStartTime && p.latestEndTime) {
        const s = new Date(p.earliestStartTime).getTime();
        const e = new Date(p.latestEndTime).getTime();
        if (e > s) {
          const mins = Math.round((e - s) / 60000);
          durText = `${mins} menit`;
        }
      }
      return {
        name: p.signedinUser?.displayName || 'Tamu Google Meet',
        email: p.signedinUser?.user || '',
        startTime: p.earliestStartTime,
        endTime: p.latestEndTime,
        durationText: durText
      };
    });
  } catch (err) {
    console.error(`Gagal mengambil data peserta Google Meet ${confRecordName}:`, err.message);
    return [];
  }
}

/**
 * Mengambil rekaman video Google Meet yang tersimpan di Google Drive.
 * 
 * @param {string} spaceOrCodeOrRecord
 * @returns {Promise<object|null>}
 */
export async function getGoogleMeetingRecordings(spaceOrCodeOrRecord) {
  if (!spaceOrCodeOrRecord) return null;
  const accessToken = await getGoogleAccessToken();
  let confRecordName = spaceOrCodeOrRecord;

  if (!String(confRecordName).startsWith('conferenceRecords/')) {
    const details = await getGooglePastMeetingDetails(spaceOrCodeOrRecord);
    if (!details || !details.conferenceRecordName) return null;
    confRecordName = details.conferenceRecordName;
  }

  try {
    const res = await fetch(`https://meet.googleapis.com/v2/${confRecordName}/recordings`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const recordings = data.recordings || [];
    const ready = recordings.find(r => r.state === 'FILE_GENERATED') || recordings[0];
    if (!ready || !ready.driveDestination) return null;

    const fileId = ready.driveDestination.file;
    const shareUrl = ready.driveDestination.exportUri || (fileId ? `https://drive.google.com/file/d/${fileId}/view?usp=sharing` : null);

    return {
      shareUrl,
      fileId,
      state: ready.state,
      password: ''
    };
  } catch (err) {
    console.error(`Gagal mengambil rekaman Google Meet ${confRecordName}:`, err.message);
    return null;
  }
}

/**
 * Mem-parsing teks dokumen Google Docs Quick Notes yang digenerate oleh Gemini Workspace.
 * 
 * @param {string} docText
 * @returns {object|null}
 */
export function parseGoogleNotes(docText) {
  if (!docText || typeof docText !== 'string') return null;

  const startIdx = docText.indexOf('Quick notes');
  if (startIdx === -1) return null;

  let endIdx = docText.indexOf('Want to see more?');
  if (endIdx === -1) {
    const timeMatch = docText.match(/\n\d{2}:\d{2}:\d{2}\s*\n/);
    endIdx = timeMatch ? timeMatch.index : docText.length;
  }

  const notesSection = docText.substring(startIdx, endIdx);
  const lines = notesSection.split('\n').map(l => l.trim()).filter(Boolean);

  let summaryOverview = '';
  const summaryDetails = [];
  const nextSteps = [];

  let currentSection = '';
  let currentDetailLabel = '';
  let currentDetailItems = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('Quick notes') || line.includes('Please rate') || line.includes('Meeting ') || line.includes('WIB')) {
      continue;
    }
    if (/^[A-Za-z]{3}\s+\d{1,2},\s+\d{4}$/.test(line)) {
      continue;
    }

    if (line.toLowerCase() === 'next steps') {
      if (currentDetailLabel && currentDetailItems.length > 0) {
        summaryDetails.push({ label: currentDetailLabel, summary: currentDetailItems.join(' ') });
        currentDetailLabel = '';
        currentDetailItems = [];
      }
      currentSection = 'nextSteps';
      continue;
    }

    if (currentSection === 'nextSteps') {
      if (line.startsWith('*')) {
        nextSteps.push(line.replace(/^\*\s*/, '').trim());
      } else {
        nextSteps.push(line);
      }
      continue;
    }

    if (!summaryOverview && !line.startsWith('*')) {
      summaryOverview = line;
      currentSection = 'details';
      continue;
    }

    if (!line.startsWith('*')) {
      if (currentDetailLabel && currentDetailItems.length > 0) {
        summaryDetails.push({ label: currentDetailLabel, summary: currentDetailItems.join(' ') });
      }
      currentDetailLabel = line;
      currentDetailItems = [];
    } else {
      currentDetailItems.push(line.replace(/^\*\s*/, '').trim());
    }
  }

  if (currentDetailLabel && currentDetailItems.length > 0) {
    summaryDetails.push({ label: currentDetailLabel, summary: currentDetailItems.join(' ') });
  }

  return {
    summaryOverview,
    summaryDetails,
    nextSteps
  };
}

/**
 * Mengambil ringkasan notula rapat Google Meet dari Google Docs / Transkrip.
 * 
 * @param {string} spaceOrCodeOrRecord
 * @returns {Promise<object|null>}
 */
export async function getGoogleMeetingSummary(spaceOrCodeOrRecord) {
  if (!spaceOrCodeOrRecord) return null;
  const accessToken = await getGoogleAccessToken();
  let confRecordName = spaceOrCodeOrRecord;

  if (!String(confRecordName).startsWith('conferenceRecords/')) {
    const details = await getGooglePastMeetingDetails(spaceOrCodeOrRecord);
    if (!details || !details.conferenceRecordName) return null;
    confRecordName = details.conferenceRecordName;
  }

  try {
    const res = await fetch(`https://meet.googleapis.com/v2/${confRecordName}/transcripts`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const transcripts = data.transcripts || [];
    const transcript = transcripts.find(t => t.state === 'FILE_GENERATED') || transcripts[0];
    if (!transcript) return null;

    const docId = transcript.docsDestination?.document;
    const docUrl = transcript.docsDestination?.exportUri;

    if (docId) {
      try {
        const docRes = await fetch(`https://www.googleapis.com/drive/v3/files/${docId}/export?mimeType=text/plain`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (docRes.ok) {
          const docText = await docRes.text();
          const parsed = parseGoogleNotes(docText);
          if (parsed && (parsed.summaryOverview || parsed.summaryDetails.length > 0 || parsed.nextSteps.length > 0)) {
            return {
              summaryOverview: parsed.summaryOverview,
              summaryDetails: parsed.summaryDetails,
              nextSteps: parsed.nextSteps,
              summaryDocUrl: docUrl
            };
          }
        }
      } catch (docErr) {
        console.warn('Gagal membaca Google Docs transkrip:', docErr.message);
      }
    }

    if (docUrl) {
      return {
        summaryOverview: 'Dokumen transkrip dan notula lengkap telah dibuat otomatis oleh Google Meet.',
        summaryDetails: [],
        nextSteps: [],
        summaryDocUrl: docUrl
      };
    }

    return null;
  } catch (err) {
    console.error(`Gagal mengambil summary Google Meet ${confRecordName}:`, err.message);
    return null;
  }
}

/**
 * Mengambil daftar rapat Google Meet terbaru yang telah selesai.
 * 
 * @param {number} [limit=3]
 * @returns {Promise<Array<object>>}
 */
export async function getRecentEndedGoogleMeetings(limit = 3) {
  const confs = await getGoogleConferenceRecords();
  if (!confs || confs.length === 0) return [];

  const ended = confs.filter(c => c.endTime);
  const sorted = ended.sort((a, b) => new Date(b.endTime).getTime() - new Date(a.endTime).getTime());

  return sorted.slice(0, limit).map(c => ({
    id: c.space?.replace('spaces/', '') || c.name,
    spaceName: c.space,
    conferenceRecordName: c.name,
    startTime: c.startTime,
    endTime: c.endTime
  }));
}


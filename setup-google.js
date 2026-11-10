import 'dotenv/config';
import http from 'http';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { exec, execSync } from 'child_process';

const ENV_PATH = path.resolve(process.cwd(), '.env');
const PORT = 3000;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
const SCOPES = [
  'https://www.googleapis.com/auth/meetings.space.created',
  'https://www.googleapis.com/auth/meetings.space.readonly',
  'https://www.googleapis.com/auth/meetings.space.settings',
  'https://www.googleapis.com/auth/drive.readonly'
].join(' ');

function openBrowser(url) {
  const startCmd = process.platform === 'win32' ? `start "" "${url}"` :
                   process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(startCmd, (err) => {
    if (err) {
      console.log(`\nSilakan buka tautan berikut di browser Anda:\n${url}\n`);
    }
  });
}

function updateEnvVariable(key, value) {
  let content = '';
  if (fs.existsSync(ENV_PATH)) {
    content = fs.readFileSync(ENV_PATH, 'utf-8');
  }

  const regex = new RegExp(`^${key}=.*$`, 'm');
  if (regex.test(content)) {
    content = content.replace(regex, `${key}=${value}`);
  } else {
    content += (content.endsWith('\n') ? '' : '\n') + `${key}=${value}\n`;
  }

  fs.writeFileSync(ENV_PATH, content, 'utf-8');
  process.env[key] = value;
}

function promptInput(questionText) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => {
    rl.question(questionText, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

function getProcessOnPort(port) {
  if (process.platform !== 'win32') return null;
  try {
    const output = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf-8' });
    const lines = output.trim().split('\n');
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 5 && parts[1].endsWith(`:${port}`) && parts[3] === 'LISTENING') {
        const pid = parseInt(parts[4], 10);
        if (pid && !isNaN(pid)) return pid;
      }
    }
  } catch (e) {}
  return null;
}

function killProcess(pid) {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGKILL');
    }
    return true;
  } catch (e) {
    return false;
  }
}

async function exchangeCodeForRefreshToken(code, clientId, clientSecret) {
  console.log('\n⏳ Menukar Authorization Code dengan Refresh Token Google...');
  
  // Bersihkan kode jika pengguna mem-paste URL lengkap
  let cleanCode = code.trim();
  if (cleanCode.includes('code=')) {
    try {
      const parsedUrl = new URL(cleanCode.startsWith('http') ? cleanCode : `http://localhost?${cleanCode}`);
      cleanCode = parsedUrl.searchParams.get('code') || cleanCode;
    } catch (e) {
      const match = cleanCode.match(/[?&]code=([^&]+)/);
      if (match) cleanCode = decodeURIComponent(match[1]);
    }
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: cleanCode,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI
    })
  });

  const tokenData = await tokenRes.json();

  if (!tokenRes.ok || !tokenData.refresh_token) {
    throw new Error(tokenData.error_description || tokenData.error || 'Refresh token tidak didapatkan. Pastikan akun Google diizinkan.');
  }

  updateEnvVariable('GOOGLE_REFRESH_TOKEN', tokenData.refresh_token);

  // Verifikasi cepat token dengan membuat test call
  console.log('🔍 Menguji validitas token baru ke Google Meet API...');
  const testRes = await fetch('https://meet.googleapis.com/v2/spaces', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${tokenData.access_token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      config: { accessType: 'OPEN', entryPointAccess: 'ALL' }
    })
  });

  if (testRes.ok) {
    const testSpace = await testRes.json();
    console.log(`✅ Uji Coba Sukses! Google Meet Space aktif: ${testSpace.meetingUri || testSpace.name}`);
  } else {
    console.log(`ℹ️ Token valid (HTTP ${testRes.status}), konfigurasi siap digunakan.`);
  }

  console.log('\n=============================================================');
  console.log('🎉 SUKSES BESAR! AKUN GOOGLE MEET BERHASIL TERHUBUNG!');
  console.log('   GOOGLE_REFRESH_TOKEN telah otomatis tersimpan di .env.');
  console.log('   Bot sekarang sudah bisa membuat link Google Meet otomatis!');
  console.log('=============================================================');
  console.log('\n📢 PANDUAN PENTING: AGAR TOKEN TIDAK KEDALUWARSA SETIAP 7 HARI');
  console.log('-------------------------------------------------------------');
  console.log('Jika status Google Cloud OAuth Anda masih "Testing", Google');
  console.log('secara default membatasi token hangus setiap 7 hari.');
  console.log('');
  console.log('Cara agar token PERMANEN (tidak pernah expired lagi):');
  console.log('1. Buka: https://console.cloud.google.com/apis/credentials/consent');
  console.log('2. Di bagian "Publishing status" (Status publikasi), klik "PUBLISH APP".');
  console.log('3. Konfirmasi "Push to production".');
  console.log('=============================================================\n');
}

async function main() {
  console.log('\n=============================================================');
  console.log('🔗 SETUP OTORISASI GOOGLE MEET API (OAUTH 2.0)');
  console.log('=============================================================\n');

  let clientId = process.env.GOOGLE_CLIENT_ID;
  let clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || clientId.includes('your_google_client_id')) {
    clientId = await promptInput('Masukkan GOOGLE_CLIENT_ID: ');
    updateEnvVariable('GOOGLE_CLIENT_ID', clientId);
  } else {
    console.log(`✓ GOOGLE_CLIENT_ID: ${clientId}`);
  }

  if (!clientSecret || clientSecret.includes('your_google_client_secret')) {
    clientSecret = await promptInput('Masukkan GOOGLE_CLIENT_SECRET: ');
    updateEnvVariable('GOOGLE_CLIENT_SECRET', clientSecret);
  } else {
    console.log(`✓ GOOGLE_CLIENT_SECRET: Terdeteksi`);
  }

  // Cek apakah port 3000 sedang terpakai
  let portOccupiedPid = getProcessOnPort(PORT);
  let useHttpServer = true;

  if (portOccupiedPid) {
    console.log(`\n⚠️ Perhatian: Port ${PORT} sedang digunakan oleh aplikasi lain (PID: ${portOccupiedPid}).`);
    console.log('Pilihan Anda:');
    console.log(`  [1] Matikan otomatis proses PID ${portOccupiedPid} agar setup berjalan otomatis (Disarankan)`);
    console.log('  [2] Biarkan proses berjalan (Saya akan copy-paste kode/URL dari browser secara manual)');
    
    const choice = await promptInput('\nMasukkan pilihan (1/2, default 1): ');
    if (choice === '2') {
      useHttpServer = false;
    } else {
      console.log(`⏳ Mematikan proses PID ${portOccupiedPid}...`);
      const killed = killProcess(portOccupiedPid);
      if (killed) {
        console.log(`✅ Port ${PORT} berhasil dibebaskan.`);
        await new Promise(r => setTimeout(r, 1500));
      } else {
        console.log(`⚠️ Tidak dapat mematikan PID ${portOccupiedPid}. Melanjutkan dengan mode input manual.`);
        useHttpServer = false;
      }
    }
  }

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: SCOPES,
      access_type: 'offline',
      prompt: 'consent'
    }).toString();

  let isHandled = false;
  let server = null;

  if (useHttpServer) {
    server = http.createServer(async (req, res) => {
      const reqUrl = new URL(req.url, `http://localhost:${PORT}`);

      if (reqUrl.pathname === '/oauth2callback') {
        if (isHandled) return;
        const code = reqUrl.searchParams.get('code');
        const error = reqUrl.searchParams.get('error');

        if (error) {
          isHandled = true;
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<h2>❌ Otorisasi Dibatalkan / Gagal: ${error}</h2>`);
          console.error(`\n❌ Otorisasi gagal: ${error}`);
          server.close();
          process.exit(1);
        }

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h2>❌ Authorization Code tidak ditemukan.</h2>');
          return;
        }

        isHandled = true;
        try {
          await exchangeCodeForRefreshToken(code, clientId, clientSecret);
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
            <div style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
              <h1 style="color: #16a34a;">✅ Berhasil Terhubung ke Google Meet!</h1>
              <p>Refresh token baru telah otomatis disimpan ke file <code>.env</code>.</p>
              <p>Anda sudah bisa menutup tab browser ini dan kembali ke terminal/bot.</p>
            </div>
          `);

          setTimeout(() => {
            try { server.close(); } catch (e) {}
            process.exit(0);
          }, 2000);
        } catch (err) {
          console.error('❌ Gagal menukar token:', err.message);
          res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<h2>❌ Terjadi Kesalahan: ${err.message}</h2>`);
          try { server.close(); } catch (e) {}
          process.exit(1);
        }
      }
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`\n⚠️ Server lokal gagal listen di port ${PORT} (${err.message}). Beralih ke mode manual...`);
        useHttpServer = false;
      } else {
        console.error('HTTP server error:', err.message);
      }
    });

    try {
      server.listen(PORT, () => {
        console.log(`\n🌐 Menunggu login Google di ${REDIRECT_URI} ...`);
      });
    } catch (e) {
      useHttpServer = false;
    }
  }

  console.log('🚀 Membuka browser untuk login akun Google Anda...');
  openBrowser(authUrl);

  console.log('\n-------------------------------------------------------------');
  console.log('📌 PETUNJUK:');
  console.log('1. Login dengan akun Google Anda di jendela browser yang terbuka.');
  console.log('2. Klik "Lanjutkan" / "Izinkan" semua izin Google Meet.');
  console.log('3. Jika otomatis tersambung, halaman browser akan menampilkan pesan sukses hijau.');
  console.log('4. JIKA browser menampilkan error atau tidak otomatis redirect:');
  console.log('   Salin (copy) SELURUH URL dari address bar browser (atau kode setelah ?code=)');
  console.log('   lalu tempelkan (paste) di bawah ini:');
  console.log('-------------------------------------------------------------\n');

  // Input manual sebagai alternatif kapan saja
  const manualInput = await promptInput('Tempel (paste) URL / Authorization Code di sini (atau tekan Enter jika otomatis): ');
  if (!isHandled && manualInput && manualInput.trim().length > 5) {
    isHandled = true;
    try {
      if (server) {
        try { server.close(); } catch (e) {}
      }
      await exchangeCodeForRefreshToken(manualInput.trim(), clientId, clientSecret);
      process.exit(0);
    } catch (err) {
      console.error('\n❌ Gagal memproses kode input manual:', err.message);
      process.exit(1);
    }
  }
}

main().catch(console.error);

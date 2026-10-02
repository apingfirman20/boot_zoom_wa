import 'dotenv/config';
import http from 'http';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { exec } from 'child_process';

const ENV_PATH = path.resolve(process.cwd(), '.env');
const PORT = 3000;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
const SCOPES = [
  'https://www.googleapis.com/auth/meetings.space.created',
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
}

async function promptInput(questionText) {
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

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: SCOPES,
      access_type: 'offline',
      prompt: 'consent'
    }).toString();

  const server = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url, `http://localhost:${PORT}`);

    if (reqUrl.pathname === '/oauth2callback') {
      const code = reqUrl.searchParams.get('code');
      const error = reqUrl.searchParams.get('error');

      if (error) {
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

      try {
        console.log('\n⏳ Menukar Authorization Code dengan Refresh Token...');
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code: code,
            grant_type: 'authorization_code',
            redirect_uri: REDIRECT_URI
          })
        });

        const tokenData = await tokenRes.json();

        if (!tokenRes.ok || !tokenData.refresh_token) {
          throw new Error(tokenData.error_description || tokenData.error || 'Refresh token tidak didapatkan. Pastikan prompt consent dipilih.');
        }

        updateEnvVariable('GOOGLE_REFRESH_TOKEN', tokenData.refresh_token);

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <div style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h1 style="color: #16a34a;">✅ Berhasil Terhubung ke Google Meet!</h1>
            <p>Refresh token telah otomatis disimpan ke file <code>.env</code>.</p>
            <p>Anda sudah bisa menutup jendela browser ini dan kembali ke terminal/bot.</p>
          </div>
        `);

        console.log('\n=============================================================');
        console.log('🎉 SUKSES! AKUN GOOGLE MEET BERHASIL TERHUBUNG!');
        console.log('   GOOGLE_REFRESH_TOKEN telah otomatis tersimpan di .env.');
        console.log('   Bot sekarang sudah bisa membuat link Google Meet otomatis!');
        console.log('=============================================================\n');

        setTimeout(() => {
          server.close();
          process.exit(0);
        }, 2000);

      } catch (err) {
        console.error('❌ Gagal menukar token:', err.message);
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<h2>❌ Terjadi Kesalahan: ${err.message}</h2>`);
        server.close();
        process.exit(1);
      }
    }
  });

  server.listen(PORT, () => {
    console.log(`\n🌐 Menunggu login Google di http://localhost:${PORT}/oauth2callback ...`);
    console.log('🚀 Membuka browser untuk login akun Google Workspace Pro Anda...');
    openBrowser(authUrl);
  });
}

main().catch(console.error);

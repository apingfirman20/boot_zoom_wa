# 🤖 WhatsApp Bot AI Zoom Generator (Scan QR Code via Terminal)

Bot WhatsApp yang menggunakan **nomor WhatsApp pribadi Anda sendiri** dengan metode **Scan QR Code langsung di terminal** (menggunakan library `@whiskeysockets/baileys`).

### ✨ Keunggulan Metode Ini:
- ❌ **TIDAK PERLU Meta for Developers / Facebook**
- ❌ **TIDAK PERLU Portofolio Bisnis / KTP / Iklan**
- ❌ **TIDAK PERLU nomor telepon baru**
- ✅ **Cukup Scan QR Code** langsung dari HP ke terminal!
- ✅ Didukung **Google Gemini AI** untuk ekstraksi jadwal meeting otomatis
- ✅ Terintegrasi **Zoom REST API (Server-to-Server OAuth)** untuk membuat link meeting
- ✅ Bisa dijalankan di **Laptop Lokal** maupun di-hosting di **Railway / Koyeb / VPS**

---

## 📁 Struktur Folder Proyek

```
BOT AI ZOOM/
├── bot.js                     # Script utama bot WhatsApp (Baileys + QR Terminal)
├── src/
│   ├── services/
│   │   ├── gemini.js          # Integrasi Google Gemini API (Structured JSON)
│   │   └── zoom.js            # Integrasi Zoom API (Server-to-Server OAuth)
│   └── utils/
│       └── datetime.js        # Helper zona waktu WIB & formatting tanggal Indonesia
├── .env.example               # Template environment variables (hanya butuh Gemini & Zoom)
├── .gitignore                 # Mengabaikan node_modules, auth_info_baileys, .env
├── package.json               # Dependensi & script ("npm start")
└── README.md                  # Panduan lengkap setup
```

---

## ⚙️ Hanya 2 Kredensial yang Dibutuhkan

Buka file `.env` di folder proyek Anda:

### 1. Google Gemini API (Gratis)
- Buka [https://aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
- Klik **Create API Key**
- Masukkan ke `.env`:
  ```env
  GEMINI_API_KEY=AIzaSy...
  ```

### 2. Zoom API (Server-to-Server OAuth) (Gratis)
- Buka [https://marketplace.zoom.us/](https://marketplace.zoom.us/)
- Login akun Zoom Anda
- Klik **Develop** -> **Build App** -> pilih kartu **Server-to-Server OAuth** -> klik **Create**
- Pada tab **App Credentials**, salin:
  ```env
  ZOOM_ACCOUNT_ID=...
  ZOOM_CLIENT_ID=...
  ZOOM_CLIENT_SECRET=...
  ```
- Pada tab **Scopes**, klik **Add Scopes**, centang **`meeting:write:admin`** (atau `meeting:write`).
- Lanjutkan ke tab **Activation**, klik **Activate your app**.

---

## 🚀 Cara Menjalankan Bot di Laptop

1. Pastikan file `.env` sudah diisi dengan API Key Gemini dan Zoom.
2. Jalankan perintah ini di terminal:
   ```bash
   npm start
   ```
3. Terminal akan langsung menampilkan **QR Code**!
4. Buka WhatsApp di HP Anda:
   - Ketuk titik tiga (Android) atau Pengaturan (iPhone)
   - Pilih **Perangkat Tertaut (Linked Devices)**
   - Ketuk **Tautkan Perangkat (Link a Device)**
   - Arahkan kamera HP ke QR Code yang muncul di terminal.
5. Begitu terhubung, bot akan menampilkan pesan:  
   `✅ WHATSAPP BOT BERHASIL TERHUBUNG & SIAP DIGUNAKAN!`

---

## 🌐 Cara Hosting 24 Jam di Railway (Tanpa Tergantung Laptop)

Jika Anda ingin bot tetap aktif 24 jam meskipun laptop mati:
1. Upload folder proyek ini ke repository **GitHub** pribadi Anda.
2. Buka [https://railway.app](https://railway.app) lalu login dengan akun GitHub Anda.
3. Klik **New Project** -> **Deploy from GitHub repo** -> Pilih repository bot ini.
4. Masuk ke tab **Variables** di Railway, masukkan variabel dari `.env` Anda (`GEMINI_API_KEY`, `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`).
5. Buka tab **Deployments** -> Klik **View Logs / Terminal Logs**.
6. **QR Code akan otomatis muncul di layar logs Railway Anda!**
7. Scan QR tersebut dengan HP Anda satu kali saja. Sesi login akan tersimpan dan bot akan aktif 24 jam nonstop di Railway!

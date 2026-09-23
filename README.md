# 🤖 WhatsApp Bot AI Zoom Generator (Hosting Gratis 24 Jam di Koyeb)

Bot WhatsApp berbasis **Baileys (`@whiskeysockets/baileys`)** dengan integrasi **Google Gemini AI** dan **Zoom API (Server-to-Server OAuth)** yang di-hosting **100% GRATIS SELAMANYA** di **[Koyeb](https://www.koyeb.com/)** tanpa perlu kartu kredit!

### ✨ Mengapa Metode Ini Terbaik untuk Anda?
- ❌ **TIDAK PERLU Meta Developer / Facebook** (Bebas dari error *"Akses Iklan Dibatasi"*).
- ❌ **TIDAK PERLU Kartu Kredit / Biaya Bulanan** (Koyeb menyediakan 1 server Eco gratis selamanya).
- ❌ **TIDAK PERLU Khawatir Laptop Mati** (Bot hidup 24 jam nonstop di cloud Koyeb).
- ✅ **Scan QR Code langsung dari layar Logs Koyeb** menggunakan WhatsApp di HP Anda.

---

## 📁 Struktur File

```
BOT AI ZOOM/
├── bot.js                     # Server utama bot (Baileys + Health check Koyeb)
├── src/
│   ├── services/
│   │   ├── gemini.js          # Google Gemini AI Structured Output
│   │   └── zoom.js            # Zoom API (Server-to-Server OAuth)
│   └── utils/
│       └── datetime.js        # Helper zona waktu WIB & formatting tanggal
├── .env.example               # Template environment variables
├── package.json               # Konfigurasi Node.js & dependencies
└── README.md                  # Panduan setup & deployment
```

---

## ⚙️ Variabel yang Dibutuhkan (Hanya 2 Layanan)

| Variabel | Wajib? | Keterangan & Sumber |
|---|:---:|---|
| `GEMINI_API_KEY` | **Ya** | API Key Gratis dari [Google AI Studio](https://aistudio.google.com/app/apikey) |
| `ZOOM_ACCOUNT_ID` | **Ya** | Account ID dari [Zoom App Marketplace](https://marketplace.zoom.us/) (App Server-to-Server OAuth) |
| `ZOOM_CLIENT_ID` | **Ya** | Client ID dari Zoom Marketplace |
| `ZOOM_CLIENT_SECRET` | **Ya** | Client Secret dari Zoom Marketplace |
| `DEFAULT_TIMEZONE` | Opsional | Zona waktu (default: `Asia/Jakarta`) |

---

## 🚀 Panduan Deploy ke Koyeb (Langkah Demi Langkah)

### Langkah 1: Push Proyek Ini ke GitHub Anda
1. Buat repository baru di [GitHub](https://github.com/new), misalnya beri nama: `wa-bot-zoom`.
2. Jalankan perintah ini di terminal Anda (ganti `USERNAME` dengan username GitHub Anda):
   ```bash
   git remote add origin https://github.com/USERNAME/wa-bot-zoom.git
   git branch -M main
   git push -u origin main
   ```

---

### Langkah 2: Buat Service di Koyeb
1. Buka [https://app.koyeb.com](https://app.koyeb.com) dan login menggunakan akun **GitHub** Anda.
2. Klik tombol **Create Service**.
3. Pilih sumber: **GitHub**.
4. Pilih repository `wa-bot-zoom` yang baru saja Anda push.
5. Pada bagian **Instance Type**:
   - Pilih **Eco Free** *(Gratis selamanya / $0/month)*.
6. Pada bagian **Environment Variables**, klik **Add Variable** dan masukkan:
   - `GEMINI_API_KEY` : (API key Gemini Anda)
   - `ZOOM_ACCOUNT_ID` : (Account ID Zoom Anda)
   - `ZOOM_CLIENT_ID` : (Client ID Zoom Anda)
   - `ZOOM_CLIENT_SECRET` : (Client Secret Zoom Anda)
   - `DEFAULT_TIMEZONE` : `Asia/Jakarta`
7. Klik tombol **Deploy** di bagian bawah.

---

## 💬 Daftar Perintah WhatsApp yang Didukung

| Perintah / Format Chat | Fungsi | Contoh |
|---|---|---|
| **Buat Meeting** | Membuat jadwal meeting baru di Zoom | `"buatkan zoom jam 2 siang dengan tim finance"` |
| **Buat Meeting + Rekam** | Membuat jadwal meeting dengan Auto Recording | `"zoom jam 3 sore topik pitching rekam"` |
| **Cek Jadwal** | Melihat semua jadwal meeting aktif | `"cek jadwal zoom"` atau `"!jadwal"` |
| **Edit / Reschedule** | Mengubah jam atau topik meeting | `"ubah zoom jam 2 siang jadi jam 4 sore"` |
| **Batalkan / Hapus** | Menghapus jadwal meeting dari Zoom | `"hapus zoom jam 2 siang"` atau `"!batal"` |
| **Rekam Live Meeting** | Memulai cloud recording meeting yang sedang live | `"rekam"` atau `"rekam zoom sekarang"` |
| **🛑 End Boy (Hentikan Meeting)** | **Menghentikan meeting yang sedang berlangsung secara otomatis** | **`"end boy"`** atau **`"end boy [Meeting ID]"`** / `"stop meeting"` |
| **Rekap / Summary AI** | Mengambil data kehadiran peserta & notula rapat AI | `"rekap"` atau `"!summary [Meeting ID]"` |
| **Bantuan / Menu** | Menampilkan panduan lengkap bot | `"!help"`, `"!menu"`, atau `"panduan"` |

---

### Langkah 3: Scan QR Code di Koyeb Logs
1. Setelah proses build selesai, buka tab **Logs** / **Console** di dashboard service Koyeb Anda.
2. **Gambar QR Code akan langsung tercetak jelas di layar log Koyeb!**
3. Ambil HP Anda, buka WhatsApp:
   - Ketuk titik tiga (Android) atau Pengaturan (iPhone).
   - Pilih **Perangkat Tertaut (Linked Devices)**.
   - Ketuk **Tautkan Perangkat (Link a Device)**.
   - Arahkan kamera HP ke QR Code yang ada di layar logs Koyeb.
4. **SELESAI!** Status akan berubah menjadi `✅ WHATSAPP BOT BERHASIL TERHUBUNG & SIAP DIGUNAKAN 24/7!`.

Sekarang Anda bisa mematikan laptop Anda, dan bot WhatsApp Anda akan tetap aktif melayani pembuatan link Zoom 24 jam nonstop!

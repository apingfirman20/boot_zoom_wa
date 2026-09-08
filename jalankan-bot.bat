@echo off
title WhatsApp Bot Zoom AI (Terminal)
echo ================================================================
echo   MENJALANKAN BOT WHATSAPP ZOOM AI (TERMINAL MODE)
echo ================================================================
echo.
echo Menghentikan bot background jika ada yang berjalan...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*bot.js*' }; if ($p) { $p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } }" >nul 2>&1
timeout /t 1 >nul
echo.
echo Pastikan koneksi internet stabil.
echo Tekan Ctrl + C jika ingin menghentikan bot.
echo.
node bot.js
pause

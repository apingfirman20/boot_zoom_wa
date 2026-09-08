@echo off
title Jalankan Bot di Background
echo ========================================================
echo   MENJALANKAN BOT WHATSAPP DI BACKGROUND (SENYAP)
echo ========================================================
echo.
echo [1/3] Memeriksa & membersihkan proses bot lama...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*bot.js*' }; if ($p) { $p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } }" >nul 2>&1
timeout /t 1 >nul

echo [2/3] Menjalankan bot di latar belakang (tanpa jendela CMD)...
wscript "%~dp0start-bot-silent.vbs"
timeout /t 3 >nul

echo [3/3] Memverifikasi status bot...
echo.
call "%~dp0cek-status.bat"

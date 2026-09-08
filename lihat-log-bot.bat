@echo off
title Log Aktivitas Bot WhatsApp Zoom
echo ========================================================
echo   LOG AKTIVITAS BOT WHATSAPP ZOOM (LIVE)
echo   (Tekan Ctrl + C untuk keluar dari tampilan log)
echo ========================================================
echo.
powershell -NoProfile -Command "if (Test-Path 'bot.log') { Get-Content 'bot.log' -Tail 30 -Wait } else { Write-Host 'File bot.log belum ada.' }"
pause

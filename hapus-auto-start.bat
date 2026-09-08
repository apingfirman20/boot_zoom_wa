@echo off
title Hapus Auto-Start Bot
echo ================================================================
echo   MENGHAPUS BOT DARI WINDOWS STARTUP
echo ================================================================
echo.
powershell -NoProfile -Command "$path = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\BotWhatsAppZoom.lnk'; if (Test-Path $path) { Remove-Item $path -Force; Write-Host 'Berhasil menghapus auto-start dari Windows Startup.' -ForegroundColor Green } else { Write-Host 'Auto-start tidak ditemukan.' -ForegroundColor Yellow }"
echo.
pause

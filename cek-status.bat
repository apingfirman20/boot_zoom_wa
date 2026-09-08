@echo off
title Status Bot WhatsApp Zoom
echo ========================================================
echo   STATUS BOT WHATSAPP ZOOM DI LAPTOP ANDA
echo ========================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$processes = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*bot.js*' };" ^
  "if ($processes) {" ^
  "    Write-Host '[AKTIF] Bot WhatsApp sedang berjalan di latar belakang!' -ForegroundColor Green;" ^
  "    foreach ($proc in $processes) {" ^
  "        Write-Host ('   - Process ID (PID): ' + $proc.ProcessId) -ForegroundColor Cyan;" ^
  "    };" ^
  "    try {" ^
  "        $res = Invoke-RestMethod -Uri http://localhost:8000 -TimeoutSec 2 -ErrorAction Stop;" ^
  "        Write-Host '   - Health Check: Aktif & Siap' -ForegroundColor Green;" ^
  "    } catch {" ^
  "        Write-Host '   - Health Check: Sedang inisialisasi' -ForegroundColor Yellow;" ^
  "    };" ^
  "} else {" ^
  "    Write-Host '[OFFLINE] Bot sedang tidak aktif di latar belakang.' -ForegroundColor Red;" ^
  "}"
echo.
echo --------------------------------------------------------
echo Tips:
echo - Untuk menyalakan di background : Double-click 'jalankan-background.bat'
echo - Untuk mematikan bot            : Double-click 'stop-bot.bat'
echo - Untuk melihat log aktivitas    : Double-click 'lihat-log-bot.bat'
echo --------------------------------------------------------
echo.
pause

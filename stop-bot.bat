@echo off
title Hentikan Bot WhatsApp Zoom
echo ========================================================
echo   MENGHENTIKAN BOT WHATSAPP (BACKGROUND)
echo ========================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$processes = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*bot.js*' };" ^
  "if ($processes) {" ^
  "    foreach ($proc in $processes) {" ^
  "        try {" ^
  "            Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue;" ^
  "            Write-Host ('Berhasil mematikan bot PID: ' + $proc.ProcessId) -ForegroundColor Green;" ^
  "        } catch {" ^
  "            Write-Host ('Gagal mematikan PID ' + $proc.ProcessId + ': ' + $_.Exception.Message) -ForegroundColor Red;" ^
  "        };" ^
  "    };" ^
  "} else {" ^
  "    Write-Host 'Tidak ada proses bot.js yang sedang berjalan.' -ForegroundColor Yellow;" ^
  "}"
echo.
echo Selesai.
pause

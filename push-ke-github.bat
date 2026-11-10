@echo off
title Push Update ke GitHub (Railway Auto-Deploy)
color 0a
echo ========================================================
echo   UNGGAH (PUSH) UPDATE BOT KE GITHUB UNTUK RAILWAY
echo ========================================================
echo.
echo Mengirimkan commit pembaruan fitur ke branch main...
echo.
git push origin main
echo.
if %ERRORLEVEL% equ 0 (
    echo ========================================================
    echo  [SUKSES] Berhasil di-push ke GitHub!
    echo  Railway akan otomatis mendeteksi dan melakukan redeploy!
    echo ========================================================
) else (
    echo [INFO] Jika muncul jendela login, silakan klik 'Sign in with your browser'.
)
echo.
pause

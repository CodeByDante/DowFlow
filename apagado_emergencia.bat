@echo off
echo ==============================================
echo   APAGADO DE EMERGENCIA - MOTORES DE DESCARGA
echo ==============================================
echo.
echo Cancelando procesos en segundo plano...
taskkill /F /IM yt-dlp.exe /T 2>NUL
taskkill /F /IM N_m3u8DL-RE.exe /T 2>NUL
taskkill /F /IM aria2c.exe /T 2>NUL
taskkill /F /IM ffmpeg.exe /T 2>NUL
echo.
echo [OK] Todos los motores de descarga han sido detenidos exitosamente.
echo.
pause

@echo off
setlocal
for %%I in ("%~dp0..") do set "PROJECT_ROOT=%%~fI"
echo =======================================================
echo Actualizador de Motores - Local Video Downloader
echo =======================================================
echo.

:: Asegurar que la carpeta bin existe
if not exist "%PROJECT_ROOT%\host\bin" mkdir "%PROJECT_ROOT%\host\bin"

:: Actualizar yt-dlp (El más importante)
echo [*] Actualizando yt-dlp...
if exist "%PROJECT_ROOT%\host\bin\yt-dlp.exe" (
    "%PROJECT_ROOT%\host\bin\yt-dlp.exe" --update-to master
) else (
    echo [!] yt-dlp no encontrado, descargando version inicial...
    powershell -Command "Invoke-WebRequest -Uri 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' -OutFile '%PROJECT_ROOT%\host\bin\yt-dlp.exe'"
)

:: Ejecutar los scripts de instalación para el resto de motores
echo [*] Actualizando FFmpeg...
python "%PROJECT_ROOT%\host\setup\install_ffmpeg.py"

echo [*] Actualizando N_m3u8DL-RE...
python "%PROJECT_ROOT%\host\setup\install_nm3u8dlre.py"

echo [*] Actualizando AtomicParsley...
python "%PROJECT_ROOT%\host\setup\install_atomicparsley.py"

echo.
echo =======================================================
echo Actualizacion completada. Todos los motores estan al dia.
echo =======================================================
pause

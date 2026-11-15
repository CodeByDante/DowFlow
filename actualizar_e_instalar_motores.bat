@echo off
setlocal
for %%I in ("%~dp0.") do set "PROJECT_ROOT=%%~fI"
echo =======================================================
echo Instalador y Actualizador de Motores - NekoDrop
echo =======================================================
echo.

python --version >nul 2>&1
if errorlevel 1 goto failed

:: Asegurar que la carpeta bin existe
if not exist "%PROJECT_ROOT%\host\bin" mkdir "%PROJECT_ROOT%\host\bin"

:: Actualizar yt-dlp (El más importante)
echo [*] Actualizando yt-dlp...
if exist "%PROJECT_ROOT%\host\bin\yt-dlp.exe" (
    "%PROJECT_ROOT%\host\bin\yt-dlp.exe" --update-to stable
) else (
    echo [!] yt-dlp no encontrado, descargando version inicial...
    powershell -Command "Invoke-WebRequest -Uri 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' -OutFile (Join-Path $env:PROJECT_ROOT 'host\bin\yt-dlp.exe')"
)
if errorlevel 1 goto failed

:: Ejecutar los scripts de instalación para el resto de motores
echo [*] Actualizando FFmpeg...
python "%PROJECT_ROOT%\host\setup\install_ffmpeg.py"
if errorlevel 1 goto failed

echo [*] Actualizando N_m3u8DL-RE...
python "%PROJECT_ROOT%\host\setup\install_nm3u8dlre.py"
if errorlevel 1 goto failed

echo [*] Actualizando AtomicParsley...
python "%PROJECT_ROOT%\host\setup\install_atomicparsley.py"
if errorlevel 1 goto failed

echo.
echo =======================================================
for %%E in (yt-dlp.exe ffmpeg.exe ffprobe.exe N_m3u8DL-RE.exe AtomicParsley.exe) do if not exist "%PROJECT_ROOT%\host\bin\%%E" goto failed
echo Instalacion y actualizacion de motores completada.
echo Archivos guardados en "%PROJECT_ROOT%\host\bin".
echo aria2 es opcional: colocar aria2c.exe en esa misma carpeta si se desea usar.
echo =======================================================
pause
exit /b 0

:failed
echo [ERROR] No se completo la instalacion o actualizacion de motores.
echo Comprueba Internet, Python y los mensajes anteriores.
pause
exit /b 1

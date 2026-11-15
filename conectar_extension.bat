@echo off
setlocal
echo =======================================================
echo Registro del host - NekoDrop
echo =======================================================
echo Carga la carpeta extension en el modo desarrollador del navegador.
echo Chrome: chrome://extensions  Edge: edge://extensions  Brave: brave://extensions
python "%~dp0host\setup\register_host.py"
if errorlevel 1 goto failed
echo [OK] Host registrado para este usuario en Chrome, Edge y Brave.
pause
exit /b 0

:failed
echo [ERROR] El registro no se completo. Revisa el mensaje anterior.
echo Comprueba Python y ejecuta instalar_requisitos.bat si falta.
pause
exit /b 1

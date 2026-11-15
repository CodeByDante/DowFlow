@echo off
setlocal
echo =======================================================
echo Requisitos - NekoDrop
echo =======================================================
python -c "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)" >nul 2>&1
if errorlevel 1 goto install_python

echo [OK] Python compatible encontrado.
python -c "import tkinter; tkinter.Tcl()" >nul 2>&1
if errorlevel 1 goto missing_tk

echo [OK] Tkinter disponible para seleccionar carpetas.
echo Siguiente paso: actualizar_e_instalar_motores.bat
pause
exit /b 0

:install_python
echo [!] Python no disponible o anterior a 3.8.
winget --version >nul 2>&1
if errorlevel 1 goto manual_python
winget install --id Python.Python.3.12 --exact --silent --accept-source-agreements --accept-package-agreements
if errorlevel 1 goto install_failed
echo [OK] winget termino sin errores.
echo Abre una nueva ventana de CMD y vuelve a ejecutar este archivo para verificar Python.
pause
exit /b 0

:manual_python
echo [!] winget no esta disponible. Instala Python y activa Add Python to PATH.
start "" "https://www.python.org/downloads/"
pause
exit /b 1

:install_failed
echo [ERROR] No se pudo instalar Python con winget.
echo Instala Python desde https://www.python.org/downloads/ y activa Add Python to PATH.
pause
exit /b 1

:missing_tk
echo [ERROR] Tkinter o Tcl no estan disponibles.
echo Repara la instalacion de Python incluyendo tcl/tk and IDLE.
pause
exit /b 1

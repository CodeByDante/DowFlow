@echo off
setlocal
echo =======================================================
echo Instalador de Requisitos - Local Video Downloader
echo =======================================================
echo.

:: 1. Comprobar si Python está instalado
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Python no detectado en el sistema.
    echo [*] Intentando instalar Python mediante winget...
    
    winget --version >nul 2>&1
    if %errorlevel% equ 0 (
        winget install --id Python.Python.3.12 --exact --silent --accept-source-agreements --accept-package-agreements
        echo.
        echo [*] Instalacion de Python iniciada. 
        echo [!] IMPORTANTE: Por favor, reinicia esta ventana de comandos tras la instalacion.
    ) else (
        echo [!] winget no esta disponible. 
        echo [*] Abriendo la pagina oficial de descarga de Python...
        start https://www.python.org/downloads/
        echo Por favor, instala Python manualmente y asegurate de marcar "Add Python to PATH".
    )
    pause
    exit
) else (
    echo [OK] Python ya esta instalado en el sistema.
)

:: 2. Instalar librerias de Python si fueran necesarias
:: (Actualmente el proyecto usa librerias estandar para evitar dependencias,
:: pero aqui se pueden añadir en el futuro si usas 'pip install')
echo [*] Verificando entorno de Python...
python -c "import tkinter" >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] ADVERTENCIA: Tkinter no parece estar instalado. 
    echo Esto es necesario para el selector de carpetas.
    echo Si el selector no funciona, reinstala Python marcando "tcl/tk and IDLE".
) else (
    echo [OK] Entorno de interfaz grafica (Tkinter) listo.
)

echo.
echo =======================================================
echo Verificacion de requisitos completada.
echo Ya puedes ejecutar 'scripts\actualizar_motores.bat'.
echo =======================================================
pause

@echo off
echo =======================================================
echo Instalador del Descargador de Videos (Native Messaging)
echo =======================================================
echo.
echo Ve a tu navegador (Chrome o Edge).
echo Abre "chrome://extensions" o "edge://extensions"
echo Asegurate de que el "Modo Desarrollador" este activado.
echo Carga la extension desde la carpeta "extension".
echo.
set /p extid="Copia el ID generado para la extension y pegalo aqui: "

:: Crear el archivo JSON de manifiesto con ruta absoluta (Windows lo requiere y con \\ escapado)
set "absolutepath=%~dp0host\download_host.bat"
:: Normalizar ruta
for %%i in ("%absolutepath%") do set "absolutepath=%%~fi"
set "escapedpath=%absolutepath:\=\\%"
echo {"name":"com.gonzalo.videodownloader","description":"Descargador de Videos Local","path":"%escapedpath%","type":"stdio","allowed_origins":["chrome-extension://%extid%/"]} > "%~dp0host\com.gonzalo.videodownloader.json"

echo.
echo Registrando el host en Windows...
:: Chrome
REG ADD "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.gonzalo.videodownloader" /ve /t REG_SZ /d "%~dp0host\com.gonzalo.videodownloader.json" /f
:: Edge
REG ADD "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.gonzalo.videodownloader" /ve /t REG_SZ /d "%~dp0host\com.gonzalo.videodownloader.json" /f
:: Brave
REG ADD "HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.gonzalo.videodownloader" /ve /t REG_SZ /d "%~dp0host\com.gonzalo.videodownloader.json" /f

echo.
echo !Instalacion Completada con Exito!
echo Ya puedes usar el boton de descargar en el navegador.
pause

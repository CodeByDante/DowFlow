# Local Video Downloader

Extensión para navegadores Chromium conectada a un host local en Python mediante Native Messaging. Permite descargar video o audio, elegir formatos y calidad, consultar listas de reproducción y gestionar descargas. El procesamiento se realiza en el PC con yt-dlp, FFmpeg y motores opcionales.

## Instalación en Windows

1. Ejecutar `instalar_requisitos.bat`. Comprueba Python y la disponibilidad de Tkinter para elegir carpetas.
2. Ejecutar `scripts/actualizar_motores.bat`. Instala o actualiza yt-dlp, FFmpeg, N_m3u8DL-RE y AtomicParsley dentro de `host/bin/`. Requiere conexión a Internet. aria2 es opcional y este script no lo instala; para usarlo, colocar `aria2c.exe` en `host/bin/`.
3. Abrir `chrome://extensions`, `edge://extensions` o `brave://extensions`, activar el modo desarrollador y cargar la carpeta `extension` como extensión descomprimida.
4. Ejecutar `install_host.bat` e introducir el ID de la extensión. Genera el manifiesto local y registra el host para el usuario actual en Chrome, Edge y Brave. No requiere permisos de administrador porque utiliza HKCU.
5. Abrir una página con contenido multimedia, abrir la extensión, elegir la configuración y descargar.

Si se mueve la carpeta del proyecto o cambia el ID de la extensión, volver a ejecutar `install_host.bat`.

## Estructura y mantenimiento

El [mapa del proyecto](docs/ESTRUCTURA.md) explica cada carpeta y archivo. El [registro de limpieza](docs/LIMPIEZA.md) documenta lo retirado, los cambios y las limitaciones pendientes.

- `extension/`: interfaz y coordinación desde el navegador.
- `host/`: descarga, conversión y comunicación con los programas locales.
- `scripts/`: actualización y herramientas auxiliares para Windows.
- `tools/`: utilidades para desarrollar el proyecto.
- `docs/`: documentación de estructura y mantenimiento.

Los binarios, registros, cookies y la configuración generada para cada PC no se publican en Git. Los iconos se incluyen directamente en Git y en las descargas ZIP.

## Verificación

Pruebas automáticas sin descargas ni conexión de red:

```sh
python -m unittest discover -s host/tests -p "test_*.py" -v
node --check extension/js/background.js
node --check extension/js/popup.js
node --check extension/js/tools.js
```

Las pruebas manuales en `host/tests/manual/` requieren Windows, motores instalados y URLs elegidas por el usuario. Realizan descargas en la carpeta Downloads y no se ejecutan con la batería automática:

```sh
python host/tests/manual/test_download.py URL
python host/tests/manual/test_batch_downloads.py URL1 URL2
python host/tests/manual/test_postprocessor_resilience.py URL
```

La utilidad `tools/resize.py` necesita Pillow, solo para preparar iconos:

```sh
python -m pip install Pillow
python tools/resize.py imagen_original.png extension/icons/icon.png
```

## Alcance

La calidad y los formatos dependen de lo que ofrezca el origen y de los motores instalados. La compatibilidad con cada sitio puede cambiar. Los permisos de cookies y acceso a sitios se utilizan para detectar contenido y descargar con la sesión del navegador cuando el usuario lo selecciona.

El script `scripts/apagado_emergencia.bat` es un recurso manual de último uso: finaliza todos los procesos con los nombres de los motores, incluidos los iniciados por otros programas. Para cancelar normalmente, usar la interfaz de la extensión.

Utilizar únicamente con contenido que se tenga derecho a descargar.

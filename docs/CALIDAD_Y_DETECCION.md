# Calidad y detección — DowFlow 1.3.1

## Calidad fija

La opción se comparte entre popup y panel. Resoluciones: 144, 240, 360, 480, 720, 1080, 1440, 2160 y 4320p. El valor inicial es 1080p. Se oculta al elegir audio y conserva el valor guardado para volver a video.

| Límite elegido | Fuente disponible | Resultado |
|---|---|---|
| 1080p | 360, 720, 1080 y 2160p | Selecciona 1080p. |
| 1080p | Solo hasta 720p | Conserva 720p, sin ampliarlo. |
| 1080p | Solo un archivo de 2160p | Descarga la fuente y la reduce a 1080p. |

La reducción utiliza FFmpeg y verifica la altura final con ffprobe. Requiere ambas herramientas instaladas y puede tardar más que una descarga directa. Primero se buscan formatos menores o iguales al límite para evitar conversiones innecesarias. Nunca se anuncia una descarga fija como completada si no se pudo verificar o aplicar su límite. Si una conversión falla, el archivo original se conserva y se informa del error.

El límite corresponde a la altura del archivo en píxeles. No aumenta la resolución de fuentes menores.

## Detector de formatos

Se utilizan los identificadores reales devueltos por yt-dlp, no números inventados a partir de la altura. Las listas se ordenan por altura y tasa de bits sin modificar la caché; la tasa se muestra en kb/s. Se omiten imágenes, audio independiente e identificadores duplicados.

Al cambiar al modo Detector con el popup abierto se inicia la consulta. Las consultas simultáneas del mismo enlace y origen se agrupan; solo las respuestas válidas se guardan en una caché de cinco minutos. Reintentar fuerza una nueva consulta. La consulta usa la página de origen y cookies cuando corresponda y tiene tiempo máximo.

El formato seleccionado llega al host. Los formatos de video sin audio se combinan con audio disponible; si el formato ya contiene audio no se duplica la pista. Si el formato desapareció del origen, se comunica un error en lugar de descargar otra calidad silenciosamente. Los enlaces manuales y lotes muestran una elección por video antes de encolarlo.

Calidad fija y Detector utilizan yt-dlp o su integración con aria2, porque los motores directo y N_m3u8DL-RE no aplicaban estas selecciones en el código anterior.

## Rastreo y búsqueda de enlaces

El rastreador escucha solicitudes y respuestas multimedia. Reconoce HLS/M3U8, DASH/MPD y archivos de video; también puede reconocer respuestas por su tipo de contenido. Ya no descarta todos los enlaces por pertenecer a TikTok o Facebook. Conserva los parámetros de URLs firmadas y no trata segmentos `.ts` o `.m4s` como videos independientes. Mantiene hasta 100 enlaces por pestaña.

Al desactivarlo deja de capturar, borra su lista y retira las tarjetas antiguas del popup. Las tareas de descarga existentes se conservan.

Los dos botones hacen búsquedas reales sobre la página y marcos accesibles. Buscar streams filtra listas HLS/DASH. Buscar en página busca también archivos multimedia. No recargan la página ni cierran el popup. Indican el número de enlaces y cuántos son nuevos; si no encuentran nada, sugieren reproducir el video y volver a buscar.

Un enlace encontrado es un candidato: no acredita que siga vigente ni que se pueda descargar. Algunos reproductores no exponen URLs reutilizables, requieren sesión o cargan recursos fuera de lo que puede inspeccionar la extensión. No se promete compatibilidad universal.

## Automatización de motor

| Situación | Selección |
|---|---|
| Idioma preferido, audio, subtítulos o calidad seleccionada | yt-dlp; puede conservar aria2 manual como acelerador. |
| HLS/DASH directo sin requisitos adicionales | N_m3u8DL-RE. Si falta y existe yt-dlp, usa esa alternativa. |
| MP4 directo, sin conversión, selección ni contexto de sesión | Python nativo. |
| Página web, cookies o referencia a otra página | yt-dlp. |
| Automatización desactivada | Conserva el motor manual cuando es compatible con las opciones. Para elegir pistas de idioma utiliza yt-dlp o aria2 con yt-dlp. |

La consola compartida explica la elección. Un motor ausente produce una alternativa segura cuando existe, o un mensaje que indica ejecutar `actualizar_e_instalar_motores.bat`. aria2 sigue siendo opcional.

## Verificación

Las pruebas JavaScript usan los HTML y código reales con APIs de Chrome simuladas para comprobar controles, selección de formatos, errores y reintentos, mensajería, caché y captura de enlaces. Las pruebas Python comprueban selectores, herramientas disponibles y reducción de resolución con videos sintéticos y FFmpeg real cuando está instalado. También se contrastó la selección de resoluciones con la biblioteca yt-dlp sobre listas de formatos sintéticas, sin descargar contenido externo.

La ejecución completa de la extensión con páginas reales y motores en Windows sigue pendiente. [Cómo actualizar la extensión y el host a la versión 1.3.1](../README_GUIA.md#actualizar-una-instalación-existente)

La selección Español/Original requiere consultar pistas con yt-dlp. Para conservar la pista habitual del origen y permitir otros motores compatibles, elegir Del sitio. Ver [Idiomas de audio](IDIOMAS_AUDIO.md).

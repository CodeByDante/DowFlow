# Audio y subtítulos en DowFlow 1.3.1

## Comportamiento

| Opción | Selección |
|---|---|
| Español | Primera opción al instalar. Elige una pista en español (`es`, `es-419`, `es-ES`, `spa` y variantes). Si falta, usa la original identificada. |
| Original | Pista marcada como original por los metadatos del origen. |
| Del sitio | Conserva la selección habitual del origen/motor sin una consulta adicional de idioma. |

Si el sitio no identifica la pista original, se respeta la preferencia predeterminada de su extractor. La consola indica expresamente esta limitación. No se inventa un idioma original ni se genera un doblaje.

La función se aplica a video, audio y modos Máxima, Mínima, Preguntar, Detector y Calidad fija. En Detector se conserva el formato de video seleccionado y se toma la pista de audio preferida.

## Corrección técnica

DowFlow consulta los metadatos de los formatos antes de descargar. Se elige una pista concreta, priorizando idioma/original y evitando audiodescripción si existe una pista normal. Las preferencias de códec y tasa se aplican después de determinar el grupo de idioma. La consola informa del idioma y del identificador elegido.

DowFlow reutiliza los metadatos que ya consultó al preparar la descarga. Los formatos conservan sus URLs y atributos técnicos, pero se preparan roles de video y audio separados para que FFmpeg tome únicamente los streams seleccionados. Esto permite combinar video de alta resolución con un doblaje disponible solo dentro de otro contenedor de menor resolución, sin reducir el video ni añadir la pista equivocada.

Si un único archivo ya contiene varios audios, el componente de DowFlow en `host/yt_plugins/` comprueba las pistas del propio archivo con ffprobe. Usa sus etiquetas de idioma y de pista original para elegir el audio antes de la mezcla o de la conversión a solo audio. Si solo existe un formato combinado, se descarga una vez. Los metadatos de consulta y cookies por tarea se guardan en la carpeta temporal de esa descarga y se eliminan al finalizar. La consulta admite cancelación y un límite de 90 segundos.

Español y Original necesitan yt-dlp o aria2 a través de yt-dlp. Los motores directo y N_m3u8DL-RE no se utilizan para ignorar esa preferencia. Del sitio permite conservar los otros motores cuando las opciones sean compatibles. La clave de configuración anterior se conserva para mantener las preferencias de instalaciones existentes.

## Alcance

La selección funciona con sitios y extractores que identifican pistas de audio. La consola avisa cuando faltan los datos del idioma. DowFlow utiliza los doblajes disponibles en el origen.

## Qué enlace usar

En YouTube, usa la página de reproducción o la URL de Shorts. Cuando el Detector o el menú contextual reconocen una pista de YouTube y su página de origen, DowFlow consulta los formatos de la página. En las listas usa la página indicada para cada entrada. En otros sitios, pega la página del video o un manifiesto con las distintas pistas. Un archivo con un único audio solo permite guardar ese audio.

## Subtítulos y reproducción en VLC

Cada sesión del navegador empieza con **Subtítulos → Desactivados**, incluso si una instalación anterior los guardó como activados. Para incluirlos en las siguientes descargas de video, selecciona **Añadir pistas (ES/EN)**. El popup, la Caja de Herramientas, las listas y el menú contextual comparten esa elección. Puedes volver a **Desactivados** para las descargas posteriores.

DowFlow solicita hasta una pista web por idioma. Da prioridad a los subtítulos manuales y usa los automáticos si falta una pista manual compatible. Si el sitio rechaza una pista, la consola lo indica y la descarga continúa con las pistas disponibles.

Las pistas de subtítulos disponibles en español o inglés se guardan dentro del archivo y quedan apagadas inicialmente. Para mostrarlas en VLC, abre el video, entra en **Subtítulo → Pista de subtítulos** y elige el idioma. En el mismo menú puedes volver a **Desactivar**. Para consultar el audio que guardaste, entra en **Audio → Pista de audio**. Si quieres guardar otro doblaje que ofrezca el origen, cambia **Pista de audio preferida** en DowFlow y vuelve a descargar el video. Si repites un título en la misma carpeta, la nueva copia recibe un número como `(2)`, de modo que puedes conservar ambos idiomas.

## Verificación

| Comprobación | Resultado |
|---|---|
| Metadatos públicos de un video de MrBeast | En una simulación de selección con yt-dlp, **Español** eligió el formato `140-9` (`es`) y **Original** eligió `140-23` (`en-US`). Estos identificadores corresponden al video de la prueba. |
| Subtítulos del mismo video de MrBeast | Se descargaron sus dos pistas manuales. Los archivos ES y EN contenían texto con marcas de tiempo. |
| Reproducción de archivos de prueba en VLC 3.0.24 | Dos fuentes locales representaban el audio original con un tono de 440 Hz y el doblaje con otro de 880 Hz. VLC reprodujo el tono correspondiente a la opción seleccionada. |
| Subtítulos en VLC 3.0.24 para Linux | Nueve descargas de prueba con el host local cubrieron HLS, MP4, MKV y MP3. En los videos con subtítulos, VLC comenzó con las pistas apagadas, permitió seleccionar cada idioma disponible y volver a desactivarlo. También se comprobó el resultado sin subtítulos y el audio original cuando faltaba el doblaje. |
| Popup, Caja de Herramientas y menú contextual | Las pruebas de integración simulan el reinicio del navegador, la actualización desde subtítulos activados, la selección por sesión y el envío de opciones a lotes y playlists. |

La comprobación con MrBeast cubrió la selección de sus formatos públicos y la lectura de sus subtítulos. Está pendiente comprobar la descarga y reproducción de ese video desde Windows. La disponibilidad de audios y subtítulos depende del video y de las pistas que el extractor consiga identificar.

La prueba automática de mezcla multilingüe utiliza el paquete de desarrollo opcional `yt-dlp==2026.10.26` y requiere FFmpeg y ffprobe en PATH. Las pruebas cubren variantes regionales del español, audio descriptivo, archivos combinados, descarga solo de audio y cancelación de la consulta. La aplicación de Windows usa sus propios motores en `host/bin/`.

## Interfaz de calidad fija

Calidad fija utiliza el mismo botón seleccionable que Máxima, Mínima, Preguntar y Detector. Aparece inmediatamente después de Detector en el mismo grupo en popup y panel. El selector de resolución aparece debajo al elegir ese modo.

[Cómo actualizar la extensión y el host en Windows](../README_GUIA.md#actualizar-una-instalación-existente)

# Idiomas de audio — NekoDrop 1.3.0

## Comportamiento

| Opción | Selección |
|---|---|
| Español | Pista española disponible: es, es-419, es-ES, spa y variantes. Si falta, original identificada. |
| Original | Pista marcada como original por los metadatos del origen. |
| Del sitio | Conserva la selección habitual del origen/motor sin una consulta adicional de idioma. |

Si el sitio no identifica la pista original, se respeta la preferencia predeterminada de su extractor. La consola indica expresamente esta limitación. No se inventa un idioma original ni se genera un doblaje.

La función se aplica a video, audio y modos Máxima, Mínima, Preguntar, Detector y Calidad fija. En Detector se conserva el formato de video seleccionado y se toma la pista de audio preferida.

## Corrección técnica

La versión anterior añadía `lang:es`, `lang:spa` y `lang:es-419` al orden de formatos de yt-dlp. El campo `lang` es una preferencia numérica del extractor, no una selección por código ISO. Además, las ramas de fallback podían elegir otra pista por su códec o tasa de bits.

Ahora se consultan los metadatos de formatos antes de descargar. Se elige una pista concreta, priorizando idioma/original y evitando audiodescripción si existe una pista normal. Las preferencias de códec y tasa se aplican después de determinar el grupo de idioma. La consola informa del idioma y del identificador elegido.

Se reutiliza la información extraída para la descarga, evitando una segunda consulta de la página. Los formatos conservan sus URLs y atributos técnicos, pero se preparan roles de video y audio separados para que FFmpeg tome únicamente los streams seleccionados. Esto permite combinar video de alta resolución con un doblaje disponible solo dentro de otro contenedor de menor resolución, sin reducir el video ni añadir la pista equivocada.

Si solo existe un formato combinado, se descarga una vez. Los metadatos de consulta y cookies por tarea se guardan en la carpeta temporal de esa descarga y se eliminan al finalizar. La consulta admite cancelación y un límite de 90 segundos.

Español y Original necesitan yt-dlp o aria2 a través de yt-dlp. Los motores directo y N_m3u8DL-RE no se utilizan para ignorar esa preferencia. Del sitio permite conservar los otros motores cuando las opciones sean compatibles. La clave de configuración anterior se conserva para mantener las preferencias de instalaciones existentes.

## Alcance

Funciona con los sitios y extractores que exponen pistas e idiomas utilizables. No obliga al origen a ofrecer todos los doblajes del reproductor y no infiere el idioma escuchando el audio. Si no hay metadatos de pistas, se informa de la limitación y no se promete un doblaje concreto.

## Verificación

Las pruebas cubren español de distintas regiones, español con menor tasa de bits que el original, fallback a original, ausencia de identificación, audio descriptivo, archivos combinados, descarga solo de audio, reutilización de metadatos y cancelación durante la consulta. La interfaz comparte la elección entre popup y panel.

Una prueba opcional con yt-dlp y FFmpeg reales genera fuentes locales: un video de 360p con tono de 440 Hz como original y otro de 180p con tono de 880 Hz como doblaje. Comprueba que el resultado conserva 360p, contiene una sola pista de audio y tiene el tono correspondiente a Español u Original. No necesita descargar videos de terceros.

Para esa prueba, instalar el paquete de desarrollo opcional `yt-dlp==2026.10.26` y disponer de FFmpeg y ffprobe en PATH. La app no utiliza este paquete de pruebas: ejecuta sus herramientas de `host/bin/`.

No se ha verificado todavía una descarga real de MrBeast ni la ejecución completa en Windows desde este entorno. La disponibilidad de pistas depende del video, sitio, sesión y versión del extractor.

## Interfaz de calidad fija

Calidad fija utiliza el mismo botón seleccionable que Máxima, Mínima, Preguntar y Detector. Aparece inmediatamente después de Detector en el mismo grupo en popup y panel; el selector de resolución aparece debajo solo cuando se elige ese modo.

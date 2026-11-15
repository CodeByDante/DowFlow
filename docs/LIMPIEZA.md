# Limpieza y correcciones

## Retirado del árbol actual

- 141 registros de `host/bin/Logs/`. Son salidas de ejecución y no código fuente.
- `extension/js/content.js`: solo contenía un comentario y no tenía referencias en el proyecto.
- `host/com.gonzalo.videodownloader.json`: configuración generada con una ruta e ID de otra PC. El instalador sigue generando este archivo para cada usuario.
- `host/tests/test.py`: ensayo con rutas personales absolutas y descargas al ejecutarse; se conserva la cobertura manual de descarga en `host/tests/manual/`.
- `scratch/extract_batch.py`: extracción puntual con una lista fija de enlaces y ejecución inmediata al importar, sin referencias desde la aplicación.

No se reescribió el historial de Git. Los archivos retirados siguen recuperables desde la revisión anterior.

## Conservado y organizado

Las otras tres pruebas de `scratch/` se movieron a `host/tests/manual/`. Reciben URLs por consola, ya no llevan enlaces fijos y sus rutas apuntan al host desde su nueva ubicación. `tools/resize.py` recibe rutas por consola y no modifica archivos al importarse. La biblioteca HLS, los iconos y los motores auxiliares se conservan porque tienen una función en la aplicación.

## Corregido

- El cierre del canal Native Messaging usaba una variable inexistente. Ahora comparte la cancelación de los procesos activos y marca también las descargas nativas para detenerlas.
- El actualizador resuelve la raíz desde `scripts/` y escribe en `host/bin/`, no en `scripts/host/bin/`.
- La comprobación de Tkinter importa el módulo sin abrir una ventana que bloquee el instalador.
- El historial de popup y panel asigna títulos, fechas y atributos con métodos DOM, sin interpolar datos como HTML.
- El instalador de AtomicParsley vuelve a verificar certificados HTTPS.
- Se excluyen registros y configuración generada mediante `.gitignore`.
- El README refleja las rutas, el orden de instalación y que aria2 se instala por separado.

## Verificación y límites

La batería automática cubre cierre sin entrada, cancelación de descargas nativas, continuidad al encontrar un proceso ya terminado y cancelación por PID en Windows mediante simulación. Se comprueba sintaxis de Python y JavaScript y se verifica que los scripts manuales muestren ayuda al no recibir URLs.

No se han ejecutado los instaladores, el navegador ni descargas reales en Windows. Las comprobaciones automáticas no acreditan compatibilidad con todos los sitios.

## Pendiente de una revisión funcional en Windows

- Probar instalación completa, vista previa, formatos, cookies, lotes y cancelación desde la extensión.
- Revisar límites y lectura de mensajes Native Messaging, colisiones de nombres y limpieza de temporales.
- Reducir duplicaciones entre popup y panel y separar el host por responsabilidades.
- Revisar permisos de la extensión según las funciones que se quieran conservar.
- Mejorar el reporte de fallos y la verificación de integridad de los instaladores de herramientas.
- Sustituir el apagado manual por nombre por una solución que identifique solo los procesos de esta aplicación.

## Identidad visual

Se rediseñó el logo original manteniendo el gato, avión y violeta. Un mismo símbolo se aplica en la barra de extensión (16/32/48/128 px), cabecera del popup, cabecera del panel, favicon y Acerca de (fuente de 512 px). Los PNG se guardan directamente en Git para que las descargas ZIP incluyan imágenes utilizables.

Se verificaron las dimensiones y transparencia de los iconos y sus referencias en HTML y manifest. La revisión visual completa de la interfaz queda pendiente: el navegador de pruebas no pudo iniciarse en este entorno.

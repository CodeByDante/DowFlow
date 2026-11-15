# Sincronización del popup y panel — 1.2.0

Ambas vistas usan `js/state.js` para leer valores iniciales, escuchar cambios y representar los mismos controles. Los valores predeterminados, los booleanos y los subtítulos se normalizan de la misma manera. Las actualizaciones visuales no vuelven a escribir en el almacenamiento.

## Cambios

- Ajustes en ambos sentidos: carpeta, formato, calidad, motor y selección automática, hilos, concurrencia, audio, idioma, subtítulos, cookies, detector y nombres por lote.
- Actualización de los campos y sus paneles dependientes al cambiar la configuración desde la otra vista.
- Historial con un mismo renderizador y borrado centralizado; las finalizaciones concurrentes se guardan en orden para evitar sobrescribir entradas.
- Consola compartida con un solo flujo ordenado de mensajes, sin receptores duplicados. Limpiar, copiar y desplazarse al final están disponibles en las dos vistas.
- Suscripción de tareas antes de leer el estado inicial, para conservar las actualizaciones y eliminaciones que lleguen durante la apertura.
- Tarjetas identificadas por tarea: dos descargas del mismo enlace ya no se confunden.
- Actualización compartida al limpiar tareas finalizadas. Las cancelaciones ignoran respuestas tardías de un proceso desconectado.
- El límite de concurrencia llena los puestos disponibles al aumentarlo y contabiliza cada tarea una sola vez.
- El gestor envía a Python las opciones de idioma y subtítulos que antes omitía.
- El menú contextual también utiliza el mismo proceso de selección de motor y cola.

## Verificación

`npm ci` y `npm test` ejecutan pruebas con los HTML y JavaScript reales dentro de JSDOM y un gestor de fondo con APIs Chrome simuladas. Cubren ajustes bidireccionales, ausencia de bucles de escritura, nombres y carpeta, diseño dependiente, historial, mensajes únicos, borrado de consola, valores antiguos, descargas concurrentes, respuestas iniciales atrasadas, cancelación y reapertura de vistas.

Las pruebas Python se ejecutan con `python -m unittest discover -s host/tests -p "test_*.py" -v`.

No se han ejecutado descargas reales ni los instaladores en Windows desde este entorno. Las pruebas simulan la mensajería y los procesos nativos; no acreditan compatibilidad con cada sitio.

## Instaladores revisados

`instalar_requisitos.bat` comprueba Python 3.8 o superior y Tkinter/Tcl. La detección de winget usa comprobaciones de error evaluadas al ejecutarse, y los fallos terminan con código de error.

`conectar_extension.bat` llama a `host/setup/register_host.py`. El script valida que el ID tenga 32 caracteres de a a p, genera JSON con las rutas correctamente escapadas y registra el host en HKCU para Chrome, Edge y Brave. Solo anuncia éxito al completar el registro. Requiere Windows y Python en PATH.

Los motores se instalan con `actualizar_e_instalar_motores.bat` y se guardan en `host/bin/`. aria2 sigue siendo opcional y requiere instalación por separado.

## Aplicar la actualización en tu PC

1. Descargar o actualizar la carpeta del proyecto.
2. En la página de extensiones del navegador, pulsar Recargar.
3. Cerrar el panel antiguo y abrirlo otra vez. Comprobar versión 1.2.0.
4. Si cambió la ruta del proyecto o el ID de la extensión, volver a ejecutar `conectar_extension.bat`.

La sincronización corresponde a vistas de la misma instalación y perfil del navegador. No sincroniza configuraciones entre Chrome y Edge, otros perfiles o distintos equipos. Los registros y tareas del gestor viven durante la sesión del proceso de fondo; no constituyen un sistema de recuperación de descargas tras reiniciar el navegador.

## Inicio y organización

Los tres BAT de uso manual están en la raíz. Ejecutar primero `instalar_requisitos.bat`, después `actualizar_e_instalar_motores.bat` y finalmente cargar la extensión y ejecutar `conectar_extension.bat` con su ID. Los motores se guardan en `host/bin/`.

Ninguno configura un arranque automático con Windows. El navegador inicia el host cuando la extensión necesita comunicarse con Python. `host/download_host.bat` es el lanzador interno, no un paso adicional para el usuario.

# Local Video Downloader

Sistema de descarga de contenido multimedia basado en una extensión de navegador y un host nativo en Python. Permite la extracción de video y audio en alta resolución mediante la integración de herramientas profesionales de procesamiento.

## Descripción

Esta solución utiliza el protocolo de mensajería nativa de los navegadores basados en Chromium para superar las limitaciones de las extensiones convencionales. El procesamiento y la descarga se delegan a un host local, permitiendo el uso de motores como yt-dlp, aria2 y N_m3u8DL-RE para una eficiencia máxima y soporte para protocolos complejos (HLS, DASH).

## Características Principales

*   **Descarga de Alta Resolución:** Soporte hasta 4K/8K dependiendo de la disponibilidad del origen.
*   **Conversión de Audio:** Extracción y conversión a formatos como MP3, M4A u OPUS.
*   **Motores de Descarga:** Integración con yt-dlp, N_m3u8DL-RE y aceleración mediante aria2.
*   **Gestión de Metadatos:** Incrustación automática de miniaturas, subtítulos y metadatos descriptivos.
*   **Interfaz de Usuario:** Panel de control integrado con detector de streams y selector de calidad.

## Estructura del Proyecto

```text
.
├── extension/                # Código fuente de la extensión de navegador
│   ├── manifest.json         # Manifiesto de la extensión (v3)
│   ├── background.js         # Service worker para gestión de tareas y sniffer
│   ├── popup.html            # Interfaz de usuario principal
│   ├── popup.js              # Lógica de la interfaz y comunicación
│   ├── popup.css             # Estilos de la UI
│   ├── lib/                  # Librerías externas (hls.js)
│   └── icons/                # Activos visuales
│
├── host/                     # Backend local (Native Messaging Host)
│   ├── download_host.py      # Lógica principal de gestión de procesos
│   ├── download_host.bat     # Lanzador de entrada para el navegador
│   ├── bin/                  # Binarios ejecutables (Excluidos de Git)
│   ├── setup/                # Scripts de instalación de dependencias
│   │   └── install_*.py      # Descargadores de dependencias
│   └── tests/                # Entorno de pruebas y muestras
│
├── tools/                    # Utilidades de desarrollo
│   └── resize.py             # Script de procesamiento de iconos
│
├── .gitignore                # Reglas de exclusión para control de versiones
├── instalar_requisitos.bat   # Comprueba e instala Python (Paso 1)
├── actualizar_motores.bat    # Descarga los motores de descarga (Paso 2)
├── install_host.bat          # Registra el sistema en el navegador (Paso 3)
└── README.md                 # Documentación técnica del proyecto
```

## Instalación

### Requisitos del Sistema
*   Python 3.8 o superior.
*   Navegador basado en Chromium (Chrome, Edge, Brave, etc.).

### Configuración del Host
1.  Ejecutar `instalar_requisitos.bat`. Este script verificará si Python está instalado y, en caso contrario, intentará instalarlo automáticamente mediante `winget`.
2.  Ejecutar `actualizar_motores.bat`. Esto descargará y configurará automáticamente todos los binarios necesarios (`yt-dlp`, `ffmpeg`, etc.) en la carpeta `host/bin`.
3.  Ejecutar `install_host.bat` con privilegios de administrador. Siga las instrucciones en pantalla para registrar la extensión mediante su ID.

### Instalación de la Extensión
1.  Acceder a la sección de extensiones del navegador (`chrome://extensions`).
2.  Habilitar el "Modo de desarrollador".
3.  Seleccionar "Cargar descomprimida" y elegir la carpeta `extension` de este repositorio.

## Uso
1.  Acceder al sitio web del cual se desea extraer el contenido.
2.  Abrir la extensión desde la barra de herramientas.
3.  Seleccionar los parámetros de calidad y formato deseados.
4.  Iniciar el proceso de descarga. El progreso se mostrará en tiempo real en el panel de la extensión.

## Nota Legal
Este software se proporciona exclusivamente para fines educativos y de respaldo personal. El usuario es responsable de cumplir con los términos de servicio de las plataformas de terceros y las leyes de propiedad intelectual vigentes.

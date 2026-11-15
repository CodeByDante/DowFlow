document.addEventListener('DOMContentLoaded', () => {
  const menuToggleBtn = document.getElementById('menuToggleBtn');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  const navItems = document.querySelectorAll('.nav-item');
  const viewSections = document.querySelectorAll('.view-section');

  // Toggle Sidebar on mobile/small screens
  function toggleSidebar() {
    sidebar.classList.toggle('active');
    overlay.classList.toggle('active');
  }

  menuToggleBtn.addEventListener('click', toggleSidebar);
  overlay.addEventListener('click', toggleSidebar);

  // Global Navigation function
  window.switchTab = function(targetId) {
    navItems.forEach(n => {
      n.classList.remove('active');
      if (n.getAttribute('data-target') === targetId) {
        n.classList.add('active');
      }
    });

    viewSections.forEach(v => {
      v.classList.remove('active');
      if (v.id === targetId) {
        v.classList.add('active');
      }
    });

    if (window.innerWidth < 900) {
      sidebar.classList.remove('active');
      overlay.classList.remove('active');
    }
  };

  // Bind click to sidebar items
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      window.switchTab(item.getAttribute('data-target'));
    });
  });

  // Bind click to Dashboard Cards
  const cardDownloader = document.getElementById('card-downloader');
  if (cardDownloader) {
    cardDownloader.addEventListener('click', () => window.switchTab('view-downloader'));
  }

  const cardConsole = document.getElementById('card-console');
  if (cardConsole) {
    cardConsole.addEventListener('click', () => window.switchTab('view-console'));
  }

  const cardPlaylist = document.getElementById('card-playlist');
  if (cardPlaylist) {
    cardPlaylist.addEventListener('click', () => window.switchTab('view-playlist'));
  }

  const cardActive = document.getElementById('card-active');
  if (cardActive) {
    cardActive.addEventListener('click', () => window.switchTab('view-active'));
  }

  const cardSettings = document.getElementById('card-settings');
  if (cardSettings) {
    cardSettings.addEventListener('click', () => window.switchTab('view-settings'));
  }

  const cardHistory = document.getElementById('card-history');
  if (cardHistory) {
    cardHistory.addEventListener('click', () => window.switchTab('view-history'));
  }

  window.addEventListener('resize', () => {
    if (window.innerWidth >= 900) {
      sidebar.classList.remove('active');
      overlay.classList.remove('active');
    }
  });

  // --- DOWNLOADER AND CONSOLE LOGIC ---
  const startBulkDownloadBtn = document.getElementById('startBulkDownloadBtn');
  const bulkUrlsInput = document.getElementById('bulkUrlsInput');
  const toolConsole = document.getElementById('toolConsole');

  function printToConsole(text, color = '#a1a1aa') {
    if (!toolConsole) return;
    const span = document.createElement('span');
    span.style.color = color;
    span.innerText = text + '\n';
    toolConsole.appendChild(span);

    while (toolConsole.children.length > 300) {
      toolConsole.removeChild(toolConsole.firstChild);
    }

    const scrollContainer = toolConsole.parentElement;
    if (scrollContainer) {
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
    }
  }

  // Console Initialization
  if (toolConsole) {
      chrome.runtime.sendMessage({ action: "get_console_logs" }, (response) => {
          if (response && response.success && response.logs && response.logs.length > 0) {
              response.logs.forEach(item => {
                  let prefix = item.title ? `[${item.title}] ` : "";
                  printToConsole(`${prefix}${item.log}`, '#4da6ff');
              });
          }
      });
  }

  // Background Messages listener
  chrome.runtime.onMessage.addListener((request) => {
      if (request.action === "download_log") {
          if (toolConsole) {
              let prefix = request.title ? `[${request.title}] ` : "";
              printToConsole(`${prefix}${request.log}`, '#4da6ff');
          }
      }
  });

  if (startBulkDownloadBtn && bulkUrlsInput && toolConsole) {
    startBulkDownloadBtn.addEventListener('click', () => {
      let urls = bulkUrlsInput.value.split('\n').map(u => u.trim()).filter(u => u.length > 0);
      if (urls.length === 0) {
        printToConsole('>> Error: No se encontraron enlaces para procesar.', '#ff4d4d');
        return;
      }

      printToConsole(`\n>> Iniciando lote de ${urls.length} descarga(s)...`, '#4da6ff');
      
      // Auto-switch to Console Tab
      window.switchTab('view-console');

      chrome.storage.local.get(null, (config) => {
        urls.forEach((url, index) => {
          let namingMode = config.batchNamingMode || 'original';
          let customPrefix = (config.batchCustomPrefix || '').trim();
          let title = `Lote_${index+1}`;
          let isAutoTitle = true;

          if (namingMode === 'lote') {
            title = `Lote ${index + 1}`;
            isAutoTitle = false;
          } else if (namingMode === 'lista') {
            title = `Lista ${index + 1}`;
            isAutoTitle = false;
          } else if (namingMode === 'custom') {
            let pfx = customPrefix || 'Video';
            title = `${pfx} ${index + 1}`;
            isAutoTitle = false;
          }

          let msg = {
            action: 'download',
            url: url,
            title: title,
            qualitySetting: config.qualitySetting || 'max',
            formatSetting: config.formatSetting || 'mp4',
            engineSetting: config.engineSetting || 'ytdlp',
            threadCount: parseInt(config.threadCount || 8),
            ytAudioLang: config.ytAudioLang || 'es',
            ytSubs: config.ytSubs || 'off',
            savePath: config.customSavePath || '',
            audioFormat: config.audioFormat || 'best',
            audioQuality: config.audioQuality || '0',
            audioConvert: config.audioConvert || 'mp3',
            videoFormatPref: config.videoFormatPref || 'legado',
            isAutoTitle: isAutoTitle
          };
          printToConsole(`>> Enviando a cola ${index+1}/${urls.length}: ${url} [Nombre: ${msg.title}]`, '#4ade80');
          chrome.runtime.sendMessage(msg, (response) => {
             if (response && response.success) {
                 printToConsole(`[COLA] ${msg.title} encolado correctamente.`, '#a1a1aa');
             } else {
                 printToConsole(`[ERROR] No se pudo encolar ${url}`, '#ff4d4d');
             }
          });
        });
      });
    });

    const activeDownloadsWrapper = document.getElementById('activeDownloadsWrapper');
    const consoleVideoCardTemplate = document.getElementById('consoleVideoCardTemplate');

    function updateConsoleCard(task) {
        if (!activeDownloadsWrapper || !consoleVideoCardTemplate) return;
        let cardId = 'console_card_' + task.id;
        let card = document.getElementById(cardId);
        
        if (!card) {
            // Eliminar si cancelado/error/completado y no existe previamente
            if (task.status === 'error' || task.status === 'cancelled' || task.status === 'completed') return;
            
            card = consoleVideoCardTemplate.content.cloneNode(true).querySelector('.console-video-card');
            card.id = cardId;
            activeDownloadsWrapper.appendChild(card);
        }

        if (task.title) {
            card.querySelector('.card-title').innerText = task.title;
        }

        let progressBar = card.querySelector('.card-progress-bar');
        let statusText = card.querySelector('.card-status-text');
        let msgText = card.querySelector('.card-msg');

        if (task.status === "progress" || task.status === "started") {
            let pct = task.percent || "0%";
            statusText.innerText = pct;
            statusText.style.color = "#4da6ff";
            let val = parseFloat(pct);
            if (!isNaN(val)) progressBar.style.width = val + "%";
            progressBar.style.backgroundColor = "#4da6ff";
            msgText.innerText = "Descargando...";
        } else if (task.status === "completed") {
            statusText.innerText = "100%";
            statusText.style.color = "#4ade80";
            progressBar.style.width = "100%";
            progressBar.style.backgroundColor = "#4ade80";
            msgText.innerText = "¡Completado!";
            setTimeout(() => card.remove(), 5000); // Remove after 5 seconds
        } else if (task.status === "error") {
            statusText.innerText = "Error";
            statusText.style.color = "#ff4d4d";
            progressBar.style.width = "100%";
            progressBar.style.backgroundColor = "#ff4d4d";
            msgText.innerText = task.error || "Fallido";
            setTimeout(() => card.remove(), 5000);
        } else if (task.status === "cancelled") {
            statusText.innerText = "Cancelado";
            statusText.style.color = "#ffb84d";
            progressBar.style.width = "100%";
            progressBar.style.backgroundColor = "#ffb84d";
            msgText.innerText = "Cancelado";
            setTimeout(() => card.remove(), 5000);
        } else if (task.status === "queued") {
            statusText.innerText = "En cola";
            statusText.style.color = "#ffb84d";
            progressBar.style.width = "0%";
            progressBar.style.backgroundColor = "#ffb84d";
            msgText.innerText = "Esperando turno...";
        }
    }

    // Load active downloads on init
    chrome.runtime.sendMessage({ action: "get_active_downloads" }, (response) => {
        if (response && response.success && response.tasks) {
            Object.values(response.tasks).forEach(task => updateConsoleCard(task));
        }
    });

    const failedDownloadsContainer = document.getElementById('failedDownloadsContainer');
    const failedDownloadsList = document.getElementById('failedDownloadsList');
    const clearFailedBtn = document.getElementById('clearFailedBtn');

    function addFailedDownload(task) {
        if (!failedDownloadsContainer || !failedDownloadsList) return;

        // Evitar duplicados
        let existing = document.getElementById('failed_item_' + task.id);
        if (existing) return;

        const div = document.createElement('div');
        div.id = 'failed_item_' + task.id;
        div.setAttribute('data-failed-url', task.url);
        div.style.display = 'flex';
        div.style.flexDirection = 'column';
        div.style.gap = '4px';
        div.style.background = 'rgba(255, 77, 77, 0.03)';
        div.style.border = '1px solid rgba(255, 77, 77, 0.15)';
        div.style.padding = '10px 12px';
        div.style.borderRadius = '6px';
        div.style.fontSize = '12px';

        const titleRow = document.createElement('div');
        titleRow.style.display = 'flex';
        titleRow.style.justifyContent = 'space-between';
        titleRow.style.fontWeight = '600';
        titleRow.style.color = '#ff8a8a';
        titleRow.innerHTML = `
            <span>${task.title || 'Descarga'}</span>
            <span style="font-size: 10px; font-weight: normal; color: rgba(255,77,77,0.7); cursor: pointer;" class="copy-failed-url" title="Copiar URL">Copiar URL</span>
        `;

        const urlRow = document.createElement('div');
        urlRow.style.color = '#8c8d91';
        urlRow.style.whiteSpace = 'nowrap';
        urlRow.style.overflow = 'hidden';
        urlRow.style.textOverflow = 'ellipsis';
        urlRow.style.cursor = 'pointer';
        urlRow.innerText = task.url;
        urlRow.title = "Abrir enlace: " + task.url;
        urlRow.addEventListener('click', () => { window.open(task.url, '_blank'); });

        titleRow.querySelector('.copy-failed-url').addEventListener('click', (e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(task.url).then(() => {
                const span = e.target;
                span.innerText = "¡Copiado!";
                setTimeout(() => { span.innerText = "Copiar URL"; }, 1500);
            });
        });

        const errorRow = document.createElement('div');
        errorRow.style.color = '#ff6b6b';
        errorRow.style.fontSize = '11px';
        errorRow.style.marginTop = '4px';
        errorRow.style.fontFamily = 'monospace';
        errorRow.innerText = `Error: ${task.error || 'La descarga falló o fue interrumpida.'}`;

        div.appendChild(titleRow);
        div.appendChild(urlRow);
        div.appendChild(errorRow);

        failedDownloadsList.appendChild(div);
        failedDownloadsContainer.style.display = 'flex';
    }

    const copyAllFailedBtn = document.getElementById('copyAllFailedBtn');
    if (copyAllFailedBtn) {
        copyAllFailedBtn.addEventListener('click', () => {
            const items = failedDownloadsList.querySelectorAll('[data-failed-url]');
            const urls = Array.from(items).map(item => item.getAttribute('data-failed-url'));
            if (urls.length === 0) return;

            navigator.clipboard.writeText(urls.join('\n')).then(() => {
                const originalText = copyAllFailedBtn.innerText;
                copyAllFailedBtn.innerText = "¡Copiados!";
                copyAllFailedBtn.style.color = "#4ade80";
                setTimeout(() => {
                    copyAllFailedBtn.innerText = originalText;
                    copyAllFailedBtn.style.color = "#4da6ff";
                }, 2000);
            });
        });
    }

    if (clearFailedBtn && failedDownloadsList && failedDownloadsContainer) {
        clearFailedBtn.addEventListener('click', () => {
            failedDownloadsList.innerHTML = '';
            failedDownloadsContainer.style.display = 'none';
        });
    }

    // Listen to background.js broadcasts so both consoles are synced
    chrome.runtime.onMessage.addListener((request) => {
      if (request.action === "download_log") {
          let prefix = request.title ? `[${request.title}] ` : "";
          printToConsole(`[HOST] ${prefix}${request.log}`, '#8c8d91');
      }
      if (request.action === "download_update" && request.task) {
          updateConsoleCard(request.task);
          
          if (request.task.status === "error") {
              printToConsole(`[ERROR] ${request.task.title}: ${request.task.error}`, '#ff4d4d');
              addFailedDownload(request.task);
          } else if (request.task.status === "completed") {
              printToConsole(`[OK] ${request.task.title} descargado.`, '#4ade80');
          } else if (request.task.status === "cancelled") {
              printToConsole(`[INFO] ${request.task.title} cancelado.`, '#ffb84d');
          }
      }
      if (request.action === "download_remove" && request.id) {
          let card = document.getElementById('console_card_' + request.id);
          if (card) card.remove();
      }
    });
  }

  // --- PLAYLIST DOWNLOADER LOGIC ---
  const fetchPlaylistBtn = document.getElementById('fetchPlaylistBtn');
  const playlistUrlInput = document.getElementById('playlistUrlInput');
  const playlistStatus = document.getElementById('playlistStatus');
  const playlistResultsContainer = document.getElementById('playlistResultsContainer');
  const playlistCountTitle = document.getElementById('playlistCountTitle');
  const playlistVideosList = document.getElementById('playlistVideosList');
  const selectAllPlaylistBtn = document.getElementById('selectAllPlaylistBtn');
  const downloadSelectedPlaylistBtn = document.getElementById('downloadSelectedPlaylistBtn');

  let currentPlaylistVideos = [];

  if (fetchPlaylistBtn) {
    fetchPlaylistBtn.addEventListener('click', () => {
      let url = playlistUrlInput.value.trim();
      if (!url) return;

      fetchPlaylistBtn.disabled = true;
      playlistStatus.innerText = 'Analizando playlist... Esto puede tardar unos segundos.';
      playlistStatus.style.color = 'var(--primary-color)';
      playlistResultsContainer.style.display = 'none';

      chrome.runtime.sendMessage({ action: 'get_playlist_info', url: url }, (res) => {
        fetchPlaylistBtn.disabled = false;
        
        if (chrome.runtime.lastError) {
          playlistStatus.innerText = 'Error de conexión con el núcleo de la extensión.';
          playlistStatus.style.color = '#ff4d4d';
          return;
        }

        if (!res || !res.success || !res.info) {
          playlistStatus.innerText = 'Error: No se pudo obtener información de la Playlist.';
          playlistStatus.style.color = '#ff4d4d';
          return;
        }

        let entries = res.info.entries || [];
        // A veces yt-dlp devuelve solo un objeto si es un video normal
        if (entries.length === 0) {
            if (res.info.id) {
                entries = [res.info]; // Es un solo video
            } else {
                playlistStatus.innerText = 'No se encontraron videos en este enlace.';
                playlistStatus.style.color = '#ffb84d';
                return;
            }
        }

        currentPlaylistVideos = entries.filter(e => e && e.title).map(e => ({
          title: e.title,
          url: e.url || e.webpage_url || (e.id ? `https://www.youtube.com/watch?v=${e.id}` : null),
          duration: e.duration || 0
        })).filter(e => e.url);

        if (currentPlaylistVideos.length === 0) {
            playlistStatus.innerText = 'No se encontraron enlaces de video válidos en la Playlist.';
            playlistStatus.style.color = '#ffb84d';
            return;
        }

        playlistStatus.innerText = '';
        playlistResultsContainer.style.display = 'flex';
        playlistCountTitle.innerText = `${currentPlaylistVideos.length} videos encontrados`;
        
        renderPlaylistVideos();
      });
    });

    let allSelected = true;
    selectAllPlaylistBtn.addEventListener('click', () => {
        allSelected = !allSelected;
        const checkboxes = document.querySelectorAll('.playlist-video-checkbox');
        checkboxes.forEach(cb => cb.checked = allSelected);
        selectAllPlaylistBtn.innerText = allSelected ? "Deseleccionar Todos" : "Seleccionar Todos";
    });

    downloadSelectedPlaylistBtn.addEventListener('click', () => {
        const checkboxes = document.querySelectorAll('.playlist-video-checkbox');
        let itemsToDownload = [];
        checkboxes.forEach((cb, index) => {
            if (cb.checked) {
                itemsToDownload.push(currentPlaylistVideos[index]);
            }
        });

        if (itemsToDownload.length === 0) {
            alert("No hay videos seleccionados.");
            return;
        }

        // Enviar a descarga (bulk)
        chrome.storage.local.get(null, (config) => {
            itemsToDownload.forEach((item, idx) => {
                let namingMode = config.batchNamingMode || 'original';
                let customPrefix = (config.batchCustomPrefix || '').trim();
                let title = item.title || `Playlist_Item_${idx+1}`;
                let isAutoTitle = !item.title;

                if (namingMode === 'lote') {
                    title = `Lote ${idx + 1}`;
                    isAutoTitle = false;
                } else if (namingMode === 'lista') {
                    title = `Lista ${idx + 1}`;
                    isAutoTitle = false;
                } else if (namingMode === 'custom') {
                    let pfx = customPrefix || 'Video';
                    title = `${pfx} ${idx + 1}`;
                    isAutoTitle = false;
                }

                let msg = {
                    action: 'download',
                    url: item.url,
                    title: title,
                    qualitySetting: config.qualitySetting || 'max',
                    formatSetting: config.formatSetting || 'mp4',
                    engineSetting: config.engineSetting || 'ytdlp',
                    threadCount: parseInt(config.threadCount || 8),
                    ytAudioLang: config.ytAudioLang || 'es',
                    ytSubs: config.ytSubs || 'off',
                    savePath: config.customSavePath || '',
                    audioFormat: config.audioFormat || 'best',
                    audioQuality: config.audioQuality || '0',
                    audioConvert: config.audioConvert || 'mp3',
                    videoFormatPref: config.videoFormatPref || 'legado',
                    isAutoTitle: isAutoTitle
                };
                chrome.runtime.sendMessage(msg);
            });
            
            // Switch to console
            window.switchTab('view-console');
        });
    });

    function renderPlaylistVideos() {
        playlistVideosList.innerHTML = '';
        currentPlaylistVideos.forEach((video, index) => {
            const div = document.createElement('div');
            div.style.display = 'flex';
            div.style.alignItems = 'center';
            div.style.gap = '10px';
            div.style.background = 'rgba(255,255,255,0.03)';
            div.style.padding = '8px 12px';
            div.style.borderRadius = '6px';
            div.style.border = '1px solid var(--border-color)';

            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.className = 'playlist-video-checkbox';
            cb.checked = true;
            cb.style.cursor = 'pointer';

            const titleSpan = document.createElement('span');
            titleSpan.innerText = `${index + 1}. ${video.title}`;
            titleSpan.style.fontSize = '13px';
            titleSpan.style.color = '#e0e0e0';
            titleSpan.style.whiteSpace = 'nowrap';
            titleSpan.style.overflow = 'hidden';
            titleSpan.style.textOverflow = 'ellipsis';
            titleSpan.style.flex = '1';

            div.appendChild(cb);
            div.appendChild(titleSpan);

            // Toggle checkbox on row click
            titleSpan.style.cursor = 'pointer';
            titleSpan.addEventListener('click', () => { cb.checked = !cb.checked; });

            playlistVideosList.appendChild(div);
        });
    }
  }

  // --- SETTINGS LOGIC ---
  const settingsKeys = [
    'customSavePath', 'formatSetting', 'qualitySetting', 'engineSetting', 
    'threadCount', 'audioFormat', 'audioQuality', 'audioConvert', 
    'videoFormatPref', 'customMode', 'snifferEnabled', 'ytAudioLang', 'ytSubs', 'cookiesSetting',
    'maxConcurrentDownloads', 'batchNamingMode', 'batchCustomPrefix', 'autoEngine'
  ];

  const selectFolderBtn = document.getElementById('selectFolderBtn');
  const savePathDisplay = document.getElementById('savePathDisplay');

  if (selectFolderBtn && savePathDisplay) {
      chrome.storage.local.get(settingsKeys, (result) => {
        if (result.customSavePath) { savePathDisplay.innerText = result.customSavePath; }
        else { savePathDisplay.innerText = "Ninguna seleccionada (Descargas)"; }

        syncBatchNamingSettings(result.batchNamingMode || 'original', result.batchCustomPrefix || '');

        const setRadio = (name, val) => {
          const el = document.querySelector(`input[name="${name}"][value="${val}"]`);
          if (el) el.checked = true;
        };

        setRadio('formatSetting', result.formatSetting || 'mp4');
        setRadio('qualitySetting', result.qualitySetting || 'max');
        setRadio('engineSetting', result.engineSetting || 'ytdlp');
        setRadio('autoEngine', result.autoEngine !== false ? 'on' : 'off');
        setRadio('videoFormatPref', result.videoFormatPref || 'legado');
        setRadio('customModeSetting', result.customMode === true ? 'on' : 'off');
        setRadio('snifferSetting', result.snifferEnabled !== false ? 'on' : 'off');
        setRadio('ytAudioLang', result.ytAudioLang || 'es');
        setRadio('ytSubs', result.ytSubs || 'off');
        setRadio('cookiesSetting', result.cookiesSetting || 'none');

        const threadSlider = document.getElementById('threadSlider');
        const threadCountLabel = document.getElementById('threadCountLabel');
        if (threadSlider && threadCountLabel) {
            threadSlider.value = result.threadCount || 8;
            threadCountLabel.innerText = `Hilos: ${threadSlider.value}`;
            threadCountLabel.style.color = parseInt(threadSlider.value) > 24 ? '#ff4d4d' : '#e5e5e5';
        }

        const e = result.engineSetting || 'ytdlp';
        const threadSettingContainer = document.getElementById('threadSettingContainer');
        if (threadSettingContainer) {
            threadSettingContainer.style.display = 'block';
        }

        const concurrencySlider = document.getElementById('concurrencySlider');
        const concurrencyCountLabel = document.getElementById('concurrencyCountLabel');
        if (concurrencySlider && concurrencyCountLabel) {
            concurrencySlider.value = result.maxConcurrentDownloads || 1;
            concurrencyCountLabel.innerText = `Descargas a la vez: ${concurrencySlider.value}`;
        }

        function updateThreadDescription(engine) {
            const desc = document.getElementById('threadDescription');
            if (!desc) return;
            if (engine === 'ytdlp') {
                desc.innerHTML = "<b>Motor por defecto (yt-dlp):</b> Seguro y confiable. Divide el archivo en partes. <br><b>Recomendación:</b> 4 a 8 hilos. Valores mayores (10+) pueden causar bloqueos en servidores comunes.";
            } else if (engine === 'aria2') {
                desc.innerHTML = "<b>Acelerador (aria2):</b> Motor agresivo. Abre múltiples conexiones simultáneas.<br><b>Recomendación:</b> 8 a 16 hilos. Ideal para exprimir tu ancho de banda en descargas directas.";
            } else if (engine === 'nm3u8') {
                desc.innerHTML = "<b>Motor Extremo (N_m3u8DL):</b> Especializado en streaming (.m3u8). Procesa fragmentos en paralelo.<br><b>Recomendación:</b> 8 a 24 hilos. Valores extremos (+24) bajo tu propia responsabilidad.";
            }
        }
        updateThreadDescription(e);


        const audioFormatSelect = document.getElementById('audioFormatSelect');
        const audioQualitySelect = document.getElementById('audioQualitySelect');
        const audioConvertSelect = document.getElementById('audioConvertSelect');
        
        if (audioFormatSelect) audioFormatSelect.value = result.audioFormat || 'best';
        if (audioQualitySelect) audioQualitySelect.value = result.audioQuality || '0';
        if (audioConvertSelect) audioConvertSelect.value = result.audioConvert || 'mp3';

        updateUIBasedOnFormat(result.formatSetting || 'mp4');
      });

      // Bind changes
      const bindRadio = (name, storageKey, callback) => {
          document.querySelectorAll(`input[name="${name}"]`).forEach(r => {
              r.addEventListener('change', (e) => {
                  let val = e.target.value;
                  if (val === 'on') val = true;
                  if (val === 'off') val = false;
                  chrome.storage.local.set({ [storageKey]: val }, () => {
                      if (callback) callback(val);
                  });
              });
          });
      };

      bindRadio('formatSetting', 'formatSetting', (val) => updateUIBasedOnFormat(val));
      bindRadio('qualitySetting', 'qualitySetting');
      bindRadio('autoEngine', 'autoEngine');
      bindRadio('engineSetting', 'engineSetting', (val) => {
          const t = document.getElementById('threadSettingContainer');
          if (t) t.style.display = 'block';
          
          const desc = document.getElementById('threadDescription');
          if (desc) {
              if (val === 'ytdlp') {
                  desc.innerHTML = "<b>Motor por defecto (yt-dlp):</b> Seguro y confiable. Divide el archivo en partes. <br><b>Recomendación:</b> 4 a 8 hilos. Valores mayores (10+) pueden causar bloqueos en servidores comunes.";
              } else if (val === 'aria2') {
                  desc.innerHTML = "<b>Acelerador (aria2):</b> Motor agresivo. Abre múltiples conexiones simultáneas.<br><b>Recomendación:</b> 8 a 16 hilos. Ideal para exprimir tu ancho de banda en descargas directas.";
              } else if (val === 'nm3u8') {
                  desc.innerHTML = "<b>Motor Extremo (N_m3u8DL):</b> Especializado en streaming (.m3u8). Procesa fragmentos en paralelo.<br><b>Recomendación:</b> 8 a 24 hilos. Valores extremos (+24) bajo tu propia responsabilidad.";
              }
          }
      });
      bindRadio('videoFormatPref', 'videoFormatPref');
      bindRadio('customModeSetting', 'customMode');
      bindRadio('snifferSetting', 'snifferEnabled');
      bindRadio('ytAudioLang', 'ytAudioLang');
      bindRadio('ytSubs', 'ytSubs');
      bindRadio('cookiesSetting', 'cookiesSetting');

      const threadSlider = document.getElementById('threadSlider');
      if (threadSlider) {
          threadSlider.addEventListener('input', (e) => {
              let val = parseInt(e.target.value);
              let tl = document.getElementById('threadCountLabel');
              tl.innerText = `Hilos: ${val}`;
              tl.style.color = val > 24 ? '#ff4d4d' : '#e5e5e5';
          });
          threadSlider.addEventListener('change', (e) => {
              chrome.storage.local.set({ threadCount: parseInt(e.target.value) });
          });
      }

      const concurrencySlider = document.getElementById('concurrencySlider');
      if (concurrencySlider) {
          concurrencySlider.addEventListener('input', (e) => {
              let val = parseInt(e.target.value);
              let cl = document.getElementById('concurrencyCountLabel');
              if (cl) cl.innerText = `Descargas a la vez: ${val}`;
          });
          concurrencySlider.addEventListener('change', (e) => {
              chrome.storage.local.set({ maxConcurrentDownloads: parseInt(e.target.value) });
          });
      }

      ['audioFormatSelect', 'audioQualitySelect', 'audioConvertSelect'].forEach(id => {
          const el = document.getElementById(id);
          if (el) {
              el.addEventListener('change', (e) => {
                  let key = id.replace('Select', '');
                  chrome.storage.local.set({ [key]: e.target.value });
              });
          }
      });

      function syncBatchNamingSettings(mode, customPrefix) {
          const bSel = document.getElementById('batchNamingSelect');
          const cSel = document.getElementById('configBatchNamingSelect');
          const cSel2 = document.getElementById('configBatchNamingSelect2');
          const bInput = document.getElementById('batchCustomPrefixInput');
          const cInput = document.getElementById('configBatchCustomPrefixInput');
          const cInput2 = document.getElementById('configBatchCustomPrefixInput2');
          const cWrap = document.getElementById('configBatchCustomPrefixWrap');
          const cWrap2 = document.getElementById('configBatchCustomPrefixWrap2');

          if (bSel) bSel.value = mode || 'original';
          if (cSel) cSel.value = mode || 'original';
          if (cSel2) cSel2.value = mode || 'original';

          if (bInput) bInput.value = customPrefix || '';
          if (cInput) cInput.value = customPrefix || '';
          if (cInput2) cInput2.value = customPrefix || '';

          const isCustom = (mode === 'custom');
          if (bInput) bInput.style.display = isCustom ? 'inline-block' : 'none';
          if (cWrap) cWrap.style.display = isCustom ? 'block' : 'none';
          if (cWrap2) cWrap2.style.display = isCustom ? 'block' : 'none';
      }

      const onBatchNamingChange = (e) => {
          const mode = e.target.value;
          chrome.storage.local.get(['batchCustomPrefix'], (res) => {
              const prefix = res.batchCustomPrefix || '';
              chrome.storage.local.set({ batchNamingMode: mode }, () => {
                  syncBatchNamingSettings(mode, prefix);
              });
          });
      };

      const bSel = document.getElementById('batchNamingSelect');
      const cSel = document.getElementById('configBatchNamingSelect');
      const cSel2 = document.getElementById('configBatchNamingSelect2');
      if (bSel) bSel.addEventListener('change', onBatchNamingChange);
      if (cSel) cSel.addEventListener('change', onBatchNamingChange);
      if (cSel2) cSel2.addEventListener('change', onBatchNamingChange);

      const onBatchPrefixChange = (e) => {
          const prefix = e.target.value;
          chrome.storage.local.get(['batchNamingMode'], (res) => {
              const mode = res.batchNamingMode || 'original';
              chrome.storage.local.set({ batchCustomPrefix: prefix }, () => {
                  syncBatchNamingSettings(mode, prefix);
              });
          });
      };

      const bInput = document.getElementById('batchCustomPrefixInput');
      const cInput = document.getElementById('configBatchCustomPrefixInput');
      const cInput2 = document.getElementById('configBatchCustomPrefixInput2');
      if (bInput) {
          bInput.addEventListener('input', onBatchPrefixChange);
          bInput.addEventListener('change', onBatchPrefixChange);
      }
      if (cInput) {
          cInput.addEventListener('input', onBatchPrefixChange);
          cInput.addEventListener('change', onBatchPrefixChange);
      }
      if (cInput2) {
          cInput2.addEventListener('input', onBatchPrefixChange);
          cInput2.addEventListener('change', onBatchPrefixChange);
      }

      selectFolderBtn.addEventListener('click', () => {
          chrome.runtime.sendMessage({ action: "select_folder" }, (response) => {
              if (response && response.success) {
                  if (response.status === "folder_selected" && response.path) {
                      chrome.storage.local.set({ customSavePath: response.path }, () => {
                          savePathDisplay.innerText = response.path;
                      });
                  }
              }
          });
      });

      function updateUIBasedOnFormat(format) {
          const qContainer = document.getElementById('qualitySettingContainer');
          const vContainer = document.getElementById('videoPreferenceContainer');
          const aLabel = document.getElementById('audioSettingsLabel');

          if (format === 'mp3') {
              if (qContainer) qContainer.style.display = 'none';
              if (vContainer) vContainer.style.display = 'none';
              if (aLabel) aLabel.innerText = 'Ajustes de Audio';
          } else {
              if (qContainer) qContainer.style.display = 'block';
              if (vContainer) vContainer.style.display = 'block';
              if (aLabel) aLabel.innerText = 'Ajustes del Audio del Video';
          }
      }

      // Sync changes made from the extension popup in real-time
      chrome.storage.onChanged.addListener((changes, namespace) => {
          if (namespace !== 'local') return;

          const setRadioIfChanged = (name, key) => {
              if (changes[key]) {
                  let val = changes[key].newValue;
                  if (val === true) val = 'on';
                  if (val === false) val = 'off';
                  const el = document.querySelector(`input[name="${name}"][value="${val}"]`);
                  if (el) el.checked = true;
              }
          };

          if (changes.customSavePath) {
              savePathDisplay.innerText = changes.customSavePath.newValue || "Ninguna seleccionada (Descargas)";
          }

          setRadioIfChanged('formatSetting', 'formatSetting');
          if (changes.formatSetting) updateUIBasedOnFormat(changes.formatSetting.newValue);

          setRadioIfChanged('qualitySetting', 'qualitySetting');
          setRadioIfChanged('engineSetting', 'engineSetting');
          if (changes.engineSetting) {
              const t = document.getElementById('threadSettingContainer');
              if (t) t.style.display = 'block';
              
              const desc = document.getElementById('threadDescription');
              if (desc) {
                  let val = changes.engineSetting.newValue;
                  if (val === 'ytdlp') {
                      desc.innerHTML = "<b>Motor por defecto (yt-dlp):</b> Seguro y confiable. Divide el archivo en partes. <br><b>Recomendación:</b> 4 a 8 hilos. Valores mayores (10+) pueden causar bloqueos en servidores comunes.";
                  } else if (val === 'aria2') {
                      desc.innerHTML = "<b>Acelerador (aria2):</b> Motor agresivo. Abre múltiples conexiones simultáneas.<br><b>Recomendación:</b> 8 a 16 hilos. Ideal para exprimir tu ancho de banda en descargas directas.";
                  } else if (val === 'nm3u8') {
                      desc.innerHTML = "<b>Motor Extremo (N_m3u8DL):</b> Especializado en streaming (.m3u8). Procesa fragmentos en paralelo.<br><b>Recomendación:</b> 8 a 24 hilos. Valores extremos (+24) bajo tu propia responsabilidad.";
                  }
              }
          }

          setRadioIfChanged('videoFormatPref', 'videoFormatPref');
          setRadioIfChanged('customModeSetting', 'customMode');
          setRadioIfChanged('snifferSetting', 'snifferEnabled');
          setRadioIfChanged('ytAudioLang', 'ytAudioLang');
          setRadioIfChanged('ytSubs', 'ytSubs');
          setRadioIfChanged('cookiesSetting', 'cookiesSetting');

          if (changes.threadCount) {
              const ts = document.getElementById('threadSlider');
              const tl = document.getElementById('threadCountLabel');
              if (ts && tl) {
                  let val = parseInt(changes.threadCount.newValue);
                  ts.value = val;
                  tl.innerText = `Hilos: ${val}`;
                  tl.style.color = val > 24 ? '#ff4d4d' : '#e5e5e5';
              }
          }

          if (changes.maxConcurrentDownloads) {
              const cs = document.getElementById('concurrencySlider');
              const cl = document.getElementById('concurrencyCountLabel');
              if (cs && cl) {
                  let val = parseInt(changes.maxConcurrentDownloads.newValue || 1);
                  cs.value = val;
                  cl.innerText = `Descargas a la vez: ${val}`;
              }
          }

          if (changes.audioFormat) {
              const el = document.getElementById('audioFormatSelect');
              if (el) el.value = changes.audioFormat.newValue;
          }
          if (changes.audioQuality) {
              const el = document.getElementById('audioQualitySelect');
              if (el) el.value = changes.audioQuality.newValue;
          }
          if (changes.audioConvert) {
              const el = document.getElementById('audioConvertSelect');
              if (el) el.value = changes.audioConvert.newValue;
          }
      });
  }

  // Console Action Buttons
  const clearConsoleBtn = document.getElementById('clearConsoleBtn');
  const copyConsoleBtn = document.getElementById('copyConsoleBtn');
  const scrollBottomBtn = document.getElementById('scrollBottomBtn');

  if (clearConsoleBtn && toolConsole) {
      clearConsoleBtn.addEventListener('click', () => {
          toolConsole.innerHTML = '';
          chrome.runtime.sendMessage({ action: "clear_console_logs" });
      });
  }

  if (copyConsoleBtn && toolConsole) {
      copyConsoleBtn.addEventListener('click', () => {
          navigator.clipboard.writeText(toolConsole.innerText).then(() => {
              const originalText = copyConsoleBtn.innerText;
              copyConsoleBtn.innerText = "Copiado ✓";
              setTimeout(() => { copyConsoleBtn.innerText = originalText; }, 2000);
          }).catch(err => {
              console.error("Error al copiar: ", err);
          });
      });
  }

  if (scrollBottomBtn && toolConsole) {
      scrollBottomBtn.addEventListener('click', () => {
          toolConsole.scrollTop = toolConsole.scrollHeight;
      });
  }

  // Emergency Stop Button
  const emergencyStopBtn = document.getElementById('emergencyStopBtn');
  if (emergencyStopBtn) {
      emergencyStopBtn.addEventListener('click', () => {
          if (confirm('¿Estás seguro de que deseas detener de forma total todas las descargas activas y vaciar la cola?')) {
              chrome.runtime.sendMessage({ action: 'emergency_stop' }, (response) => {
                  if (response && response.success) {
                      printToConsole('\n>> [EMERGENCIA] Parada de emergencia ejecutada por el usuario.', '#ff4d4d');
                  }
              });
          }
      });
  }

  // --- HISTORIAL LOGIC ---
  const historyListDashboard = document.getElementById('historyListDashboard');
  const clearHistoryBtnDashboard = document.getElementById('clearHistoryBtnDashboard');

  function loadHistoryDashboard() {
      if (!historyListDashboard) return;
      chrome.storage.local.get(['downloadHistory'], (result) => {
          const history = result.downloadHistory || [];
          historyListDashboard.innerHTML = '';
          
          if (history.length === 0) {
              historyListDashboard.innerHTML = '<div style="color: var(--text-muted); text-align: center; margin-top: 20px;">No hay descargas recientes.</div>';
              return;
          }
          
          history.slice().reverse().forEach(item => {
              const div = document.createElement('div');
              div.className = 'history-item-popup';
              div.innerHTML = `
                  <div class="history-title-popup" title=""></div>
                  <div class="history-date-popup"></div>
                  <div class="history-actions-popup">
                    <button class="action-btn secondary btn-small open-url-btn" data-url="">Ver Origen</button>
                    <button class="action-btn secondary btn-small open-folder-btn" data-file="">Abrir Ubicación</button>
                  </div>
              `;
                const titleElement = div.querySelector('.history-title-popup');
                titleElement.textContent = item.title || '';
                titleElement.title = item.title || '';
                div.querySelector('.history-date-popup').textContent = new Date(item.date).toLocaleString();
                div.querySelector('.open-url-btn').setAttribute('data-url', item.url || '');
                div.querySelector('.open-folder-btn').setAttribute('data-file', item.final_file || '');
              
              div.querySelector('.open-url-btn').addEventListener('click', (e) => {
                  window.open(e.target.getAttribute('data-url'), '_blank');
              });
              
              div.querySelector('.open-folder-btn').addEventListener('click', (e) => {
                  let file = e.target.getAttribute('data-file');
                  if (file) {
                      chrome.runtime.sendMessage({ action: "open_folder", file: file }, () => { });
                  } else {
                      chrome.runtime.sendMessage({ action: "open_folder" }, () => { });
                  }
              });

              historyListDashboard.appendChild(div);
          });
      });
  }

  if (clearHistoryBtnDashboard) {
      clearHistoryBtnDashboard.addEventListener('click', () => {
          chrome.storage.local.set({ downloadHistory: [] }, () => {
              loadHistoryDashboard();
          });
      });
  }

  // Load history whenever the tab is clicked
  const navHistory = document.querySelector('.nav-item[data-target="view-history"]');
  if (navHistory) {
      navHistory.addEventListener('click', loadHistoryDashboard);
  }
  if (cardHistory) {
      cardHistory.addEventListener('click', loadHistoryDashboard);
  }

  // Also load initially just in case
  loadHistoryDashboard();
});

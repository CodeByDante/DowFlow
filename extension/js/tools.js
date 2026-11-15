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

  function printToConsole(text) {
    if (!toolConsole) return;
    chrome.runtime.sendMessage({ action: 'append_console_log', log: text }, () => { void chrome.runtime.lastError; });
  }

  AppState.bindConsole(toolConsole);

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

      AppState.readSettings(config => {
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
            threadCount: parseInt(config.threadCount || 4),
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
            const cancel = document.createElement('button');
            cancel.className = 'btn-primary cancel-task-btn';
            cancel.textContent = 'Cancelar';
            cancel.addEventListener('click', () => chrome.runtime.sendMessage({ action: 'cancel_download', id: task.id }, () => { void chrome.runtime.lastError; }));
            card.appendChild(cancel);
            activeDownloadsWrapper.appendChild(card);
        }

        const cancelButton = card.querySelector('.cancel-task-btn');
        if (cancelButton) cancelButton.hidden = !['queued', 'started', 'progress'].includes(task.status);
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
            <span class="failed-title"></span>
            <span style="font-size: 10px; font-weight: normal; color: rgba(255,77,77,0.7); cursor: pointer;" class="copy-failed-url" title="Copiar URL">Copiar URL</span>
        `;

        titleRow.querySelector('.failed-title').textContent = task.title || 'Descarga';
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
            chrome.runtime.sendMessage({ action: 'clear_finished', status: 'error' }, () => { void chrome.runtime.lastError; });
        });
    }

    AppState.watchTasks((tasks) => {
        activeDownloadsWrapper.querySelectorAll('.console-video-card').forEach(card => {
            if (!tasks[card.id.replace('console_card_', '')]) card.remove();
        });
        if (failedDownloadsList) failedDownloadsList.replaceChildren();
        if (failedDownloadsContainer) failedDownloadsContainer.style.display = 'none';
        Object.values(tasks).forEach(task => {
            updateConsoleCard(task);
            if (task.status === 'error') addFailedDownload(task);
        });
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
        AppState.readSettings(config => {
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
                    threadCount: parseInt(config.threadCount || 4),
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

  // Shared settings implementation with the popup.
  AppState.bindSettings(document);
  const selectFolderBtn = document.getElementById('selectFolderBtn');
  if (selectFolderBtn) selectFolderBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'select_folder' }, response => {
          if (response?.success && response.status === 'folder_selected') {
              chrome.storage.local.set({ customSavePath: response.path });
          }
      });
  });

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

  AppState.bindHistory(document.getElementById('historyListDashboard'), document.getElementById('clearHistoryBtnDashboard'), true);
});

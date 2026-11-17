document.addEventListener('DOMContentLoaded', () => {
    // Navigation Tabs logic
    const tabs = document.querySelectorAll('.tab');
    const panels = document.querySelectorAll('.panel');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            panels.forEach(p => p.classList.remove('active'));

            tab.classList.add('active');
            const targetId = 'panel-' + tab.getAttribute('data-tab');
            document.getElementById(targetId).classList.add('active');
        });
    });

    // Local Storage Cache
    const downloadsList = document.getElementById('downloadsList');
    const clearHistoryBtn = document.getElementById('clearHistoryBtn');

    AppState.bindHistory(downloadsList, clearHistoryBtn);

    // Settings Logic
    const openFolderBtn = document.getElementById('openFolderBtn');
    const sniffedVideosCard = document.getElementById('sniffedVideosCard');
    const sniffedLinksList = document.getElementById('sniffedLinksList');
    let customPathObj = null;
    let sniffedUrlOverride = null;

    const selectFolderBtn = document.getElementById('selectFolderBtn');
    const savePathDisplay = document.getElementById('savePathDisplay');
    const savePathStatus = document.getElementById('savePathStatus');

    const qualitySettingContainer = document.getElementById('qualitySettingContainer');
    const videoPreferenceContainer = document.getElementById('videoPreferenceContainer');
    const audioSettingsContainer = document.getElementById('audioSettingsContainer');
    const audioSettingsLabel = document.getElementById('audioSettingsLabel');
    const audioFormatSelect = document.getElementById('audioFormatSelect');
    const audioQualitySelect = document.getElementById('audioQualitySelect');
    const audioConvertSelect = document.getElementById('audioConvertSelect');
    const threadSlider = document.getElementById('threadSlider');
    const threadCountLabel = document.getElementById('threadCountLabel');
    const threadSettingContainer = document.getElementById('threadSettingContainer');
    const concurrencySlider = document.getElementById('concurrencySlider');
    const concurrencyCountLabel = document.getElementById('concurrencyCountLabel');

    const customModeToggle = document.getElementById('customModeToggle');
    const snifferToggle = document.getElementById('snifferToggle');
    const manualCardContainer = document.getElementById('manualCardContainer');
    const manualUrlInput = document.getElementById('manualUrlInput');
    const manualQualityDrop = document.getElementById('manualQualityDrop');
    const manualDownloadBtn = document.getElementById('manualDownloadBtn');
    const pasteUrlBtn = document.getElementById('pasteUrlBtn');
    const clearErrorsBtn = document.getElementById('clearErrorsBtn');
    const snifferStatusFooter = document.getElementById('snifferStatusFooter');
    const snifferCountBadge = document.getElementById('snifferCountBadge');
    const forceDetectBtn = document.getElementById('forceDetectBtn');
    const forceDetectHtmlBtn = document.getElementById('forceDetectHtmlBtn');
    const forceDetectJavBtn = document.getElementById('forceDetectJavBtn');
    const openToolsBtn = document.getElementById('openToolsBtn');

    if (openToolsBtn) {
        openToolsBtn.addEventListener('click', () => {
            chrome.tabs.create({ url: chrome.runtime.getURL('tools.html') });
        });
    }

    function bindScanButton(button, mode, label) {
        if (!button) return;
        button.addEventListener('click', () => {
            button.disabled = true; button.innerText = 'Buscando...';
            chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
                if (!tabs?.[0] || !/^https?:/i.test(tabs[0].url || '')) {
                    button.disabled = false; button.innerText = label;
                    button.title = 'Abre una pagina web para buscar enlaces multimedia.';
                    return;
                }
                chrome.runtime.sendMessage({ action: 'scan_page', tabId: tabs[0].id, mode }, response => {
                    button.disabled = false;
                    const error = chrome.runtime.lastError?.message || response?.error;
                    button.innerText = error ? 'No se pudo buscar' : response?.count ? `${response.count} enlaces (${response.added} nuevos)` : 'Sin enlaces encontrados';
                    button.title = error || (response?.count ? 'Enlaces encontrados; su descarga depende del origen.' : 'Reproduce el video y vuelve a buscar. Algunos reproductores no exponen enlaces directos.');
                    setTimeout(() => { button.innerText = label; }, 4000);
                });
            });
        });
    }
    bindScanButton(forceDetectBtn, 'streams', 'Buscar streams');
    bindScanButton(forceDetectHtmlBtn, 'html', 'Buscar en página');

    if (forceDetectJavBtn) {
        forceDetectJavBtn.addEventListener('click', () => {
            forceDetectJavBtn.innerText = "Buscando...";
            forceDetectJavBtn.disabled = true;
            
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs.length === 0) return;
                const activeTab = tabs[0];
                const tabId = activeTab.id;
                
                chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    func: () => {
                        try {
                            const html = document.documentElement.outerHTML;
                            
                            // 1. 123AV JSON
                            const match123 = html.match(/player\(JSON\.parse\('([^']+)'\)/);
                            if (match123) {
                                let rawJson = match123[1];
                                let jsonStr = rawJson.replace(/\\"/g, '"').replace(/\\\//g, '/');
                                jsonStr = jsonStr.replace(/\\u([0-9a-fA-F]{4})/g, (m, grp) => String.fromCharCode(parseInt(grp, 16)));
                                const playerData = JSON.parse(jsonStr);
                                for (const item of playerData) {
                                    if (item.url && item.url.includes('surrit.')) {
                                        return { type: '123av', surritUrl: item.url };
                                    }
                                }
                            }
                            
                            // 2. MissAV packer
                            const splitMatch = html.match(/'([^']+)'\.split\('\|'\)/);
                            if (splitMatch) {
                                const words = splitMatch[1].split('|');
                                const pMatch = html.match(/\}\('(.*?)', *\d+, *\d+,/);
                                if (pMatch) {
                                    let p = pMatch[1];
                                    function base36(i) { return i.toString(36); }
                                    for (let i = words.length - 1; i >= 0; i--) {
                                        const word = words[i];
                                        if (word) {
                                            const idx = base36(i);
                                            const regex = new RegExp('\\b' + idx + '\\b', 'g');
                                            p = p.replace(regex, word);
                                        }
                                    }
                                    const m3u8Links = p.match(/https?:\/\/surrit\.com[^\s'"]+\.m3u8/);
                                    if (m3u8Links) {
                                        return { type: 'missav', m3u8Url: m3u8Links[0] };
                                    }
                                }
                            }
                            
                            // 3. direct Regex for surrit.com
                            const m3u8Matches = html.match(/https?:\/\/surrit\.com\/[a-zA-Z0-9-]+\/[^\s'"]+\.m3u8/);
                            if (m3u8Matches) {
                                return { type: 'missav', m3u8Url: m3u8Matches[0] };
                            }
                            
                            // 4. DOM
                            const sources = Array.from(document.querySelectorAll('video, source, iframe'));
                            for (const srcEl of sources) {
                                const src = srcEl.src || srcEl.getAttribute('src');
                                if (src && (src.includes('surrit.com') || src.includes('surrit.store')) && src.includes('.m3u8')) {
                                    return { type: 'missav', m3u8Url: src };
                                }
                            }
                        } catch (e) {
                            console.error(e);
                        }
                        return null;
                    }
                }, async (results) => {
                    forceDetectJavBtn.innerText = "Detección JAV";
                    forceDetectJavBtn.disabled = false;
                    
                    if (chrome.runtime.lastError || !results || !results[0] || !results[0].result) {
                        forceDetectJavBtn.innerText = "No Encontrado";
                        setTimeout(() => { forceDetectJavBtn.innerText = "Detección JAV"; }, 2000);
                        return;
                    }
                    
                    const res = results[0].result;
                    let finalM3u8 = null;
                    if (res.type === '123av' && res.surritUrl) {
                        try {
                            const urlObj = new URL(res.surritUrl);
                            const videoId = urlObj.pathname.split('/').pop();
                            const poster = urlObj.searchParams.get('poster') || '';
                            const streamApiUrl = `https://surrit.store/stream?id=${videoId}&poster=${encodeURIComponent(poster)}`;
                            
                            const apiRes = await fetch(streamApiUrl);
                            const data = await apiRes.json();
                            if (data && data.media && data.media.stream) {
                                finalM3u8 = data.media.stream;
                            }
                        } catch (err) {
                            console.error(err);
                        }
                    } else if (res.type === 'missav' && res.m3u8Url) {
                        finalM3u8 = res.m3u8Url;
                    }
                    
                    if (finalM3u8) {
                        chrome.storage.local.get(['sniffedUrls'], (s2) => {
                            let currentDict = s2.sniffedUrls || {};
                            if (!currentDict[tabId]) currentDict[tabId] = [];
                            if (!currentDict[tabId].includes(finalM3u8)) {
                                currentDict[tabId].push(finalM3u8);
                                chrome.storage.local.set({ sniffedUrls: currentDict }, () => {
                                    forceDetectJavBtn.innerText = "¡Detectado!";
                                    setTimeout(() => { forceDetectJavBtn.innerText = "Detección JAV"; }, 2000);
                                    renderDetectorUI();
                                });
                            } else {
                                forceDetectJavBtn.innerText = "Ya Detectado";
                                setTimeout(() => { forceDetectJavBtn.innerText = "Detección JAV"; }, 2000);
                            }
                        });
                    } else {
                        forceDetectJavBtn.innerText = "No Encontrado";
                        setTimeout(() => { forceDetectJavBtn.innerText = "Detección JAV"; }, 2000);
                    }
                });
            });
        });
    }

    AppState.bindSettings(document, (state, keys) => {
        if (keys.includes('formatSetting') || keys.includes('qualitySetting')) updateAllDropdowns();
        if (keys.includes('customMode') || keys.includes('snifferEnabled')) renderDetectorUI();
    });
    AppState.watchStorage(['sniffedUrls'], () => renderDetectorUI());
    AppState.bindConsole(document.getElementById('debugConsole'));

    if (clearErrorsBtn) {
        clearErrorsBtn.addEventListener('click', () => {
            const cards = document.querySelectorAll('#cardsWrapper .detected-video-card');
            cards.forEach(card => {
                const stMsg = card.querySelector('.status-msg');
                const btn = card.querySelector('.main-btn');
                if ((stMsg && (stMsg.innerText.includes('Error') || stMsg.innerText.includes('Completado') || stMsg.innerText.includes('Cancelado'))) || (btn && (btn.innerText === "Fallido" || btn.innerText === "¡Listo!"))) {
                    let activeTaskId = card.getAttribute('data-taskid');
                    if (activeTaskId) {
                        chrome.runtime.sendMessage({ action: "clear_task", id: activeTaskId });
                    }
                    card.style.opacity = '0';
                    setTimeout(() => card.remove(), 200);
                }
            });
            setTimeout(() => {
                if (document.getElementById('cardsWrapper').children.length === 0) {
                    document.getElementById('emptyState').style.display = "flex";
                }
            }, 250);
        });
    }

    const emergencyStopBtn = document.getElementById('emergencyStopBtn');
    if (emergencyStopBtn) {
        emergencyStopBtn.addEventListener('click', () => {
            if (confirm('¿Estás seguro de que deseas detener de forma total todas las descargas activas y vaciar la cola?')) {
                chrome.runtime.sendMessage({ action: 'emergency_stop' }, (response) => {
                    if (response && response.success) {
                        const cards = document.querySelectorAll('#cardsWrapper .detected-video-card');
                        cards.forEach(card => {
                            const stMsg = card.querySelector('.status-msg');
                            const stPct = card.querySelector('.status-percent');
                            const barFill = card.querySelector('.bar-fill');
                            const btn = card.querySelector('.main-btn');
                            
                            if (stMsg) { stMsg.innerText = "Cancelado (Emergencia)"; stMsg.style.color = "#ffb84d"; }
                            if (stPct) { stPct.innerText = "Cancelado"; stPct.style.color = "#ffb84d"; }
                            if (barFill) { barFill.style.width = "100%"; barFill.style.backgroundColor = "#8c8d91"; }
                            if (btn) { btn.innerText = "Descargar"; btn.disabled = false; btn.style.borderColor = ""; btn.style.color = ""; btn.style.backgroundColor = ""; }
                        });
                    }
                });
            }
        });
    }

    const linkCountDisplay = document.getElementById('linkCountDisplay');

    function updateLinkCount() {
        if (!linkCountDisplay) return;
        const text = manualUrlInput.value.trim();
        if (!text) {
            linkCountDisplay.innerText = "0 enlaces";
            return;
        }
        const count = text.split(/[\s\n,]+/).filter(u => u.trim().startsWith('http')).length;
        linkCountDisplay.innerText = count === 1 ? "1 enlace" : `${count} enlaces`;
    }

    if (pasteUrlBtn) {
        pasteUrlBtn.addEventListener('click', async () => {
            try {
                const text = await navigator.clipboard.readText();
                manualUrlInput.value = text;
                pasteUrlBtn.style.color = '#4ade80'; // Success green flash
                setTimeout(() => { pasteUrlBtn.style.color = '#8c8d91'; }, 800);
                updateLinkCount();
            } catch (err) {
                console.error('Failed to read clipboard: ', err);
            }
        });
    }

    if (manualUrlInput) {
        manualUrlInput.addEventListener('input', updateLinkCount);
        // Also catch manual pastes specifically to update immediately
        manualUrlInput.addEventListener('paste', () => { setTimeout(updateLinkCount, 50); });
    }

    if (manualDownloadBtn) {
        manualDownloadBtn.addEventListener('click', () => {
            const urlsText = manualUrlInput.value.trim();
            if (!urlsText) return;
            const urls = urlsText.split(/[\s\n,]+/).filter(u => u.trim().startsWith('http'));
            if (urls.length === 0) return;

            if (manualDownloadBtn.innerText === "Descargar" || manualDownloadBtn.innerText === "Fallido" || manualDownloadBtn.innerText === "Añadir a Cola") {
                AppState.readSettings(cfg => {
                    const namingMode = cfg.batchNamingMode || 'original';
                    const customPrefix = (cfg.batchCustomPrefix || '').trim();

                    urls.forEach((url, index) => {
                        let title = urls.length === 1 ? "Descarga Manual" : `Lista (${index + 1}/${urls.length})`;
                        let isAutoTitle = true;

                        if (urls.length > 1) {
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
                        }

                        setTimeout(() => {
                            startDownloadTask(manualDownloadBtn, title, url, manualQualityDrop.value, "", cfg, isAutoTitle);
                        }, index * 100);
                    });
                });
                
                // Clear the input after adding to queue
                manualUrlInput.value = "";
                
                // Resetear el botón estético en 2 segundos
                setTimeout(() => {
                    if (manualDownloadBtn.innerText === "Procesando...") {
                        manualDownloadBtn.innerText = "Descargar";
                        manualDownloadBtn.disabled = false;
                    }
                }, 2000);
            }
        });
    }

    function updateAllDropdowns() {
        chrome.storage.local.get(['formatSetting', 'qualitySetting'], (res) => {
            const f = res.formatSetting || 'mp4';
            const q = res.qualitySetting || 'max';
            document.querySelectorAll('.detected-video-card').forEach(card => {
                const drop = card.querySelector('.quality-dropdown');
                const detDrop = card.querySelector('.detect-dropdown');
                
                if (drop) {
                    if (f === 'mp4' && q === 'ask') drop.classList.remove('hidden');
                    else drop.classList.add('hidden');
                }
                
                if (detDrop) {
                    if (f === 'mp4' && q === 'detect') {
                        detDrop.classList.remove('hidden');
                        if (!card.hasAttribute('data-taskid')) AppState.loadFormats(detDrop, card.getAttribute('data-url'), card.dataset.pageUrl || '');
                    } else {
                        detDrop.classList.add('hidden');
                        if (detDrop._retry) detDrop._retry.hidden = true;
                    }
                }
            });
        });
    }

    selectFolderBtn.addEventListener('click', () => {
        selectFolderBtn.disabled = true;
        selectFolderBtn.innerText = "Abriendo ventana...";
        chrome.runtime.sendMessage({ action: "select_folder" }, (response) => {
            selectFolderBtn.disabled = false;
            selectFolderBtn.innerText = "Seleccionar Carpeta...";
            if (chrome.runtime.lastError) {
                savePathStatus.innerText = "Error: " + chrome.runtime.lastError.message;
                savePathStatus.style.color = "#ff4d4d";
                return;
            }
            if (response && response.success && response.status === "folder_selected") {
                const path = response.path;
                chrome.storage.local.set({ customSavePath: path }, () => {
                    savePathDisplay.innerText = path;
                    savePathStatus.innerText = "¡Ruta guardada exitosamente!";
                    savePathStatus.style.color = "#4ade80";
                    setTimeout(() => {
                        savePathStatus.innerText = "Si no seleccionas nada, se guardará en Descargas por defecto.";
                        savePathStatus.style.color = "#6a6b70";
                    }, 3000);
                });
            } else if (response && response.success && response.status === "folder_selection_cancelled") {
            } else {
                savePathStatus.innerText = "Error al seleccionar carpeta.";
                savePathStatus.style.color = "#ff4d4d";
            }
        });
    });

    // Main Detector Logic
    const cardsWrapper = document.getElementById('cardsWrapper');
    const emptyState = document.getElementById('emptyState');
    const template = document.getElementById('videoCardTemplate');

    function deduplicateSniffs(urls) {
        return [...new Set(urls.filter(url => {
            try {
                const parsed = new URL(url.replace('#ACTUAL', ''));
                return /^https?:$/.test(parsed.protocol) && !/\.(ts|m4s|vtt|jpg|jpeg|png|gif|webp|svg|css|js)$/i.test(parsed.pathname);
            } catch (_) { return false; }
        }))];
    }

    function startDownloadTask(btn, title, url, dropdownValue, pageUrl, result, isAutoTitle = false) {
        btn.disabled = true;
        btn.innerText = "Procesando...";

        let customFormatId = '';
        if (result.qualitySetting === 'detect' && btn.closest('.detected-video-card')) {
            const detector = btn.closest('.detected-video-card').querySelector('.detect-dropdown');
            const saved = btn.closest('.detected-video-card').dataset.formatId;
            if ((!detector || detector.disabled || !detector.value) && !saved) {
                btn.disabled = false; btn.innerText = 'Descargar';
                const status = btn.closest('.detected-video-card').querySelector('.status-msg');
                if (status) { status.style.display = 'block'; status.innerText = detector?.dataset.error || 'Espera a que termine la deteccion y selecciona un formato.'; }
                return;
            }
            customFormatId = !detector?.disabled && detector?.value ? detector.value : saved;
        } else if (result.qualitySetting === 'ask') {
            customFormatId = dropdownValue;
            if (!customFormatId) customFormatId = "1080";
        }

        const payload = {
            action: "download",
            title: title,
            url: url,
            pageUrl: pageUrl,
            savePath: result.customSavePath || "",
            formatSetting: result.formatSetting || "mp4",
            qualitySetting: result.qualitySetting || "max",
            engineSetting: result.engineSetting || "ytdlp",
            threadCount: result.threadCount || 4,
            audioFormat: result.audioFormat || "best",
            audioQuality: result.audioQuality || "0",
            audioConvert: result.audioConvert || "mp3",
            videoFormatPref: result.videoFormatPref || "legado",
            customFormatId: customFormatId,
            netscapeCookies: "", // Extraído de forma centralizada en background.js
            ytAudioLang: result.ytAudioLang || "es",
            ytSubs: result.ytSubs || "off",
            isAutoTitle: isAutoTitle
        };
        AppState.sendDownload(payload, (response) => {
            if (chrome.runtime.lastError) {
                btn.innerText = "Error Host";
                btn.disabled = false;
                return;
            }
            if (response && response.success) {
                // La historia se guarda cuando la descarga se completa exitosamente en background.js
                // Actualización visual instantánea para evitar lag percibido
                createOrUpdateCard(url, title, true, {
                    id: response.id,
                    url: url,
                    pageUrl: pageUrl,
                    title: title,
                    status: "queued",
                    percent: "0"
                });
            } else {
                btn.innerText = "Fallido";
                btn.disabled = false;
            }
        });
    }

    // One card per detected URL or queued task.
    function createOrUpdateCard(url, title, isTask, taskState, pageUrl = taskState?.pageUrl) {
        // Task IDs distinguish concurrent downloads of the same URL.
        let id = isTask && taskState?.id ? "vid_task_" + taskState.id : "vid_" + btoa(unescape(encodeURIComponent(url))).replace(/[^a-zA-Z0-9]/g, '');
        let el = document.getElementById(id);

        if (!el) {
            el = template.content.cloneNode(true).querySelector('.detected-video-card');
            el.id = id;
            el.setAttribute('data-url', url);
            el.dataset.pageUrl = pageUrl || '';
            
            let badge = el.querySelector('.type-badge');
            if (badge) {
                let badgeText = 'VIDEO';
                let bgColor = 'rgba(158, 158, 158, 0.15)';
                let textColor = '#e0e0e0';
                let borderColor = 'rgba(158, 158, 158, 0.4)';

                if (url.includes('.m3u8') || url.includes('/m3u8/') || title.includes('[HLS]')) {
                    badgeText = 'HLS / M3U8';
                    bgColor = 'rgba(156, 39, 176, 0.15)';
                    textColor = '#e1bee7';
                    borderColor = 'rgba(156, 39, 176, 0.4)';
                    title = title.replace(' [HLS]', ''); // Limpiar el titulo
                } else if (url.includes('.mp4') || title.includes('[MP4]')) {
                    badgeText = 'MP4';
                    bgColor = 'rgba(33, 150, 243, 0.15)';
                    textColor = '#bbdefb';
                    borderColor = 'rgba(33, 150, 243, 0.4)';
                    title = title.replace(' [MP4]', ''); // Limpiar el titulo
                } else if (url.includes('youtube.com') || url.includes('youtu.be')) {
                    badgeText = 'YOUTUBE';
                    bgColor = 'rgba(244, 67, 54, 0.15)';
                    textColor = '#ffcdd2';
                    borderColor = 'rgba(244, 67, 54, 0.4)';
                }

                badge.innerText = badgeText;
                badge.style.backgroundColor = bgColor;
                badge.style.color = textColor;
                badge.style.border = `1px solid ${borderColor}`;
                badge.classList.remove('hidden');
            }

            let titleInput = el.querySelector('.preview-title');
            if (titleInput) {
                if (titleInput.tagName === 'INPUT') {
                    if (!titleInput.value || document.activeElement !== titleInput) {
                        titleInput.value = title;
                    }
                    
                    titleInput.addEventListener('click', (e) => {
                        if (e.detail >= 3) {
                            titleInput.removeAttribute('readonly');
                            titleInput.style.cursor = 'text';
                            titleInput.style.background = 'rgba(0,0,0,0.2)';
                            titleInput.style.border = '1px solid #4da6ff';
                            titleInput.style.padding = '4px 6px';
                            titleInput.focus();
                        }
                    });
                    
                    titleInput.addEventListener('blur', () => {
                        titleInput.setAttribute('readonly', 'true');
                        titleInput.style.cursor = 'default';
                        titleInput.style.background = 'transparent';
                        titleInput.style.border = '1px solid transparent';
                        titleInput.style.padding = '0px';
                        titleInput.scrollLeft = 0; // Para que el texto largo vuelva al principio
                    });
                } else {
                    titleInput.innerText = title;
                    titleInput.title = title;
                }
            }
            
            let previewUrlEl = el.querySelector('.preview-url');
            previewUrlEl.innerText = url;
            previewUrlEl.addEventListener('click', () => {
                window.open(url, '_blank');
            });

            let copyBtn = el.querySelector('.copy-url-btn');
            if (copyBtn) {
                copyBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(url);
                    
                    let svgPath = copyBtn.querySelector('path');
                    let originalD = svgPath.getAttribute('d');
                    
                    // Cambiar a icono de "Check"
                    svgPath.setAttribute('d', 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z');
                    copyBtn.style.color = '#4ade80';
                    
                    setTimeout(() => {
                        // Revertir a icono de "Copiar"
                        if(svgPath) svgPath.setAttribute('d', originalD);
                        if(copyBtn) copyBtn.style.color = '#8c8d91';
                    }, 1200);
                });
            }

            // Se eliminó la configuración de video preview a pedido del usuario

            cardsWrapper.appendChild(el);

            let btn = el.querySelector('.main-btn');
            let drop = el.querySelector('.quality-dropdown');

            AppState.readSettings(settings => {
                if (settings.formatSetting === 'mp4' && settings.qualitySetting === 'ask') drop.classList.remove('hidden');
                const detector = el.querySelector('.detect-dropdown');
                if (!isTask && settings.formatSetting === 'mp4' && settings.qualitySetting === 'detect' && detector) {
                    detector.classList.remove('hidden');
                    AppState.loadFormats(detector, url, pageUrl);
                }
            });

            btn.addEventListener('click', () => {
                if (btn.innerText === "Descargar" || btn.innerText === "Fallido" || btn.innerText === "Cancelado") {
                    let selectedQuality = drop.value;
                    let detDrop = el.querySelector('.detect-dropdown');
                    
                    let titleInput = el.querySelector('.preview-title');
                    let currentTitle = titleInput && titleInput.tagName === 'INPUT' ? (titleInput.value.trim() || title) : title;
                    
                    AppState.readSettings(res => {
                        if (res.qualitySetting === 'detect' && detDrop && !detDrop.classList.contains('hidden')) {
                            selectedQuality = detDrop.value;
                        }
                        startDownloadTask(btn, currentTitle, url, selectedQuality, pageUrl, res);
                    });
                } else if (btn.innerText === "Cancelar") {
                    let activeTaskId = el.getAttribute('data-taskid');
                    if (activeTaskId) {
                        chrome.runtime.sendMessage({ action: "cancel_download", id: activeTaskId });
                        btn.innerText = "Cancelando...";
                        btn.disabled = true;
                    }
                }
            });
        }

        let btn = el.querySelector('.main-btn');
        let progCtx = el.querySelector('.progress-box');
        let barFill = el.querySelector('.bar-fill');
        let stPercent = el.querySelector('.status-percent');
        let stMsg = el.querySelector('.status-msg');

        if (isTask && taskState) {
            el.setAttribute('data-taskid', taskState.id);
            el.dataset.formatId = taskState.customFormatId || '';

            if (taskState.status === "progress" || taskState.status === "started") {
                progCtx.classList.remove('hidden');
                stMsg.style.display = "block";
                stPercent.style.display = "block";
                barFill.parentElement.style.display = "block";

                btn.innerText = "Cancelar";
                btn.disabled = false;
                btn.style.backgroundColor = "transparent";
                btn.style.borderColor = "#ff4d4d";
                btn.style.color = "#ff4d4d";

                let newPercent = parseFloat(taskState.percent || 0);
                let currentPercent = parseFloat(barFill.style.width || 0);

                // Evitar saltos hacia atrás causados por el multi-hilo de yt-dlp
                if (newPercent >= currentPercent || newPercent < 5) {
                    barFill.style.width = taskState.percent + "%";
                    stPercent.innerText = taskState.percent + "%";
                }

                stMsg.innerText = "Descargando...";
                stPercent.style.color = "#4da6ff";
                stMsg.style.color = "#4da6ff";
                barFill.style.backgroundColor = "#4da6ff";
            } else if (taskState.status === "completed") {
                progCtx.classList.remove('hidden');
                stMsg.style.display = "block";
                stPercent.style.display = "block";
                barFill.parentElement.style.display = "block";

                btn.innerText = "¡Listo!";
                btn.disabled = true;
                btn.style.borderColor = "#4ade80";
                btn.style.color = "#4ade80";

                barFill.style.width = "100%";
                stPercent.innerText = "100%";
                stPercent.style.color = "#4ade80";
                stMsg.style.color = "#4ade80";
                barFill.style.backgroundColor = "#4ade80";
                stMsg.innerText = "¡Completado!";
            } else if (taskState.status === "error") {
                progCtx.classList.remove('hidden');
                barFill.parentElement.style.display = "none";
                stPercent.style.display = "none";
                stMsg.style.display = "block";

                stMsg.innerText = "Error: " + (taskState.error || "La descarga falló");
                stMsg.style.color = "#ff4d4d";
                btn.innerText = "Descargar";
                btn.disabled = false;
                btn.style.borderColor = ""; btn.style.color = ""; btn.style.backgroundColor = "";

                if (el.parentElement) {
                    el.parentElement.appendChild(el);
                }
            } else if (taskState.status === "cancelled") {
                progCtx.classList.remove('hidden');
                stMsg.style.display = "block";
                stPercent.style.display = "block";
                barFill.parentElement.style.display = "block";

                btn.innerText = "Descargar";
                btn.disabled = false;
                btn.style.borderColor = ""; btn.style.color = ""; btn.style.backgroundColor = "";

                barFill.style.width = "100%";
                stPercent.innerText = "Cancelado";
                stPercent.style.color = "#8c8d91";
                stMsg.style.color = "#8c8d91";
                barFill.style.backgroundColor = "#8c8d91";
                stMsg.innerText = "Cancelado";
            } else if (taskState.status === "queued") {
                progCtx.classList.remove('hidden');
                stMsg.style.display = "block";
                stPercent.style.display = "block";
                barFill.parentElement.style.display = "block";

                btn.innerText = "Cancelar";
                btn.disabled = false;
                btn.style.backgroundColor = "transparent";
                btn.style.borderColor = "#ffb84d";
                btn.style.color = "#ffb84d";

                barFill.style.width = "0%";
                stPercent.innerText = "En cola";
                stMsg.innerText = "Esperando su turno...";
                stPercent.style.color = "#ffb84d";
                stMsg.style.color = "#ffb84d";
                barFill.style.backgroundColor = "#ffb84d";
            }
        }
    }

    let sharedTasks = {};
    let detectorRevision = 0;
    function renderDetectorUI() {
        const revision = ++detectorRevision;
                chrome.tabs.query({ active: true, currentWindow: true }, (tabsResponse) => {
                    if (revision !== detectorRevision || !tabsResponse || tabsResponse.length === 0) return;
                    const currentTab = tabsResponse[0];
                    const currentUrl = currentTab.url;
                    const tabId = currentTab.id;

                    // Extractor automático JAV (123AV / MissAV)
                    if (currentUrl && currentUrl.startsWith('http')) {
                        const lowerUrl = currentUrl.toLowerCase();
                        const is123av = lowerUrl.includes('123av.com') || lowerUrl.includes('123av.org') || lowerUrl.includes('123av.me');
                        const isMissav = lowerUrl.includes('missav.com') || lowerUrl.includes('missav.ws');
                        
                        if (forceDetectJavBtn) {
                            if (is123av || isMissav) forceDetectJavBtn.classList.remove('hidden');
                            else forceDetectJavBtn.classList.add('hidden');
                        }
                        
                        if ((is123av && lowerUrl.includes('/v/')) || (isMissav && /\/[a-z0-9]+-\d+/i.test(lowerUrl))) {
                            chrome.storage.local.get(['sniffedUrls'], (storeRes) => {
                                const sniffedDict = storeRes.sniffedUrls || {};
                                const currentSniffs = sniffedDict[tabId] || [];
                                
                                const hasHls = currentSniffs.some(u => u.includes('.m3u8') || u.includes('/m3u8/'));
                                if (hasHls) return;
                                
                                chrome.scripting.executeScript({
                                    target: { tabId: tabId },
                                    func: () => {
                                        try {
                                            const html = document.documentElement.outerHTML;
                                            
                                            // 1. Intentar player(JSON.parse(...)) para 123AV
                                            const match123 = html.match(/player\(JSON\.parse\('([^']+)'\)/);
                                            if (match123) {
                                                let rawJson = match123[1];
                                                let jsonStr = rawJson.replace(/\\"/g, '"').replace(/\\\//g, '/');
                                                jsonStr = jsonStr.replace(/\\u([0-9a-fA-F]{4})/g, (m, grp) => String.fromCharCode(parseInt(grp, 16)));
                                                const playerData = JSON.parse(jsonStr);
                                                for (const item of playerData) {
                                                    if (item.url && item.url.includes('surrit.')) {
                                                        return { type: '123av', surritUrl: item.url };
                                                    }
                                                }
                                            }
                                            
                                            // 2. Intentar packer de MissAV
                                            const splitMatch = html.match(/'([^']+)'\.split\('\|'\)/);
                                            if (splitMatch) {
                                                const words = splitMatch[1].split('|');
                                                const pMatch = html.match(/\}\('(.*?)', *\d+, *\d+,/);
                                                if (pMatch) {
                                                    let p = pMatch[1];
                                                    function base36(i) { return i.toString(36); }
                                                    for (let i = words.length - 1; i >= 0; i--) {
                                                        const word = words[i];
                                                        if (word) {
                                                            const idx = base36(i);
                                                            const regex = new RegExp('\\b' + idx + '\\b', 'g');
                                                            p = p.replace(regex, word);
                                                        }
                                                    }
                                                    const m3u8Links = p.match(/https?:\/\/surrit\.com[^\s'"]+\.m3u8/);
                                                    if (m3u8Links) {
                                                        return { type: 'missav', m3u8Url: m3u8Links[0] };
                                                    }
                                                }
                                            }
                                            
                                            // 3. Regex simple para surrit.com
                                            const m3u8Matches = html.match(/https?:\/\/surrit\.com\/[a-zA-Z0-9-]+\/[^\s'"]+\.m3u8/);
                                            if (m3u8Matches) {
                                                return { type: 'missav', m3u8Url: m3u8Matches[0] };
                                            }
                                            
                                            // 4. Buscar en DOM
                                            const sources = Array.from(document.querySelectorAll('video, source, iframe'));
                                            for (const srcEl of sources) {
                                                const src = srcEl.src || srcEl.getAttribute('src');
                                                if (src && (src.includes('surrit.com') || src.includes('surrit.store')) && src.includes('.m3u8')) {
                                                    return { type: 'missav', m3u8Url: src };
                                                }
                                            }
                                        } catch (e) {
                                            console.error(e);
                                        }
                                        return null;
                                    }
                                }, async (scriptResults) => {
                                    if (chrome.runtime.lastError || !scriptResults || !scriptResults[0] || !scriptResults[0].result) return;
                                    const res = scriptResults[0].result;
                                    
                                    let finalM3u8 = null;
                                    if (res.type === '123av' && res.surritUrl) {
                                        try {
                                            const urlObj = new URL(res.surritUrl);
                                            const videoId = urlObj.pathname.split('/').pop();
                                            const poster = urlObj.searchParams.get('poster') || '';
                                            const streamApiUrl = `https://surrit.store/stream?id=${videoId}&poster=${encodeURIComponent(poster)}`;
                                            
                                            const apiRes = await fetch(streamApiUrl, {
                                                headers: {
                                                    'Referer': res.surritUrl,
                                                    'Origin': 'https://surrit.store'
                                                }
                                            });
                                            const data = await apiRes.json();
                                            if (data && data.media && data.media.stream) {
                                                finalM3u8 = data.media.stream;
                                            }
                                        } catch (err) {
                                            console.error("Error fetching 123AV stream API:", err);
                                        }
                                    } else if (res.type === 'missav' && res.m3u8Url) {
                                        finalM3u8 = res.m3u8Url;
                                    }
                                    
                                    if (finalM3u8) {
                                        chrome.storage.local.get(['sniffedUrls'], (s2) => {
                                            let currentDict = s2.sniffedUrls || {};
                                            if (!currentDict[tabId]) currentDict[tabId] = [];
                                            if (!currentDict[tabId].includes(finalM3u8)) {
                                                currentDict[tabId].push(finalM3u8);
                                                chrome.storage.local.set({ sniffedUrls: currentDict }, () => {
                                                    renderDetectorUI();
                                                });
                                            }
                                        });
                                    }
                                });
                            });
                        }
                    }

                    let hasAny = false;



                    let isHomepage = false;
                    try {
                        let parsed = new URL(currentUrl);
                        if ((parsed.pathname === '/' || parsed.pathname === '') && !parsed.search) {
                            isHomepage = true;
                        }
                    } catch(e) {}

                    let cleanTabTitle = (currentTab.title || 'Video Actual').replace(/^\(\d+\)\s*/, '').replace(/ - YouTube$/, '').trim();

                    if (currentUrl.startsWith('http') && !isHomepage) {
                        // Siempre mostrar la URL principal, excepto si es la página de inicio (raíz)
                        createOrUpdateCard(currentUrl, cleanTabTitle, false, null, currentUrl);
                        hasAny = true;

                        let currId = "vid_" + btoa(unescape(encodeURIComponent(currentUrl))).replace(/[^a-zA-Z0-9]/g, '');
                        let currEl = document.getElementById(currId);
                        if (currEl && currEl.parentElement) {
                            currEl.parentElement.prepend(currEl);
                        }
                    }

                    // Sniffed (TikTok, Streams) Cards
                    chrome.storage.local.get(['sniffedUrls', 'snifferEnabled'], function (result) {
                        if (revision !== detectorRevision) return;
                        const isSnifferEnabled = result.snifferEnabled !== false;
                        const dot = document.querySelector('.status-dot');
                        if (dot) dot.style.backgroundColor = isSnifferEnabled ? '#00e676' : '#6a6b70';

                        let rawSniffs = (result.sniffedUrls || {})[tabId] || [];
                        let sniffs = deduplicateSniffs(rawSniffs);
                        const visibleUrls = new Set(sniffs.map(url => url.replace('#ACTUAL', '')));
                        if (currentUrl.startsWith('http') && !isHomepage) visibleUrls.add(currentUrl);
                        cardsWrapper.querySelectorAll('.detected-video-card:not([data-taskid])').forEach(card => {
                            if (!visibleUrls.has(card.getAttribute('data-url'))) card.remove();
                        });
                        
                        if (snifferCountBadge) {
                            snifferCountBadge.innerText = `${sniffs.length} enlaces`;
                        }

                        sniffs.forEach((s_url, index) => {
                            let cleanTabTitle = currentTab.title ? currentTab.title.replace(/^\(\d+\)\s*/, '').replace(/ - YouTube$/, '').trim() : "Stream de Video";
                            let baseTitle = cleanTabTitle;
                            
                            let streamType = /\.m3u8|\/m3u8\//i.test(s_url) ? " [HLS]" : /\.mpd/i.test(s_url) ? " [DASH]" : " [Video]";
                            
                            if (s_url.includes('#ACTUAL')) {
                                streamType = " ⭐ [ACTUAL]" + streamType;
                                s_url = s_url.replace('#ACTUAL', '');
                            }
                            
                            let title = baseTitle + streamType;

                            createOrUpdateCard(s_url, title, false, null, currentUrl);
                            hasAny = true;
                        });

                        // Render active tasks at the bottom
                        Object.values(sharedTasks).forEach(task => {
                            createOrUpdateCard(task.url, task.title, true, task);
                            let taskId = "vid_task_" + task.id;
                            let taskEl = document.getElementById(taskId);
                            if (taskEl && taskEl.parentElement) {
                                taskEl.parentElement.appendChild(taskEl); // Forzar que las descargas activas vayan al final
                            }
                            hasAny = true;
                        });

                        if (!hasAny && !document.querySelector('input[name="customModeSetting"][value="on"]')?.checked) {
                            emptyState.style.display = "flex";
                        } else {
                            emptyState.style.display = "none";
                        }
                    });
                });
    }

    AppState.watchTasks((tasks, event) => {
        sharedTasks = tasks;
        cardsWrapper.querySelectorAll('[data-taskid]').forEach(card => {
            if (!tasks[card.getAttribute('data-taskid')]) card.remove();
        });
        Object.values(tasks).forEach(task => createOrUpdateCard(task.url, task.title, true, task));
        if (!event) renderDetectorUI();
    });
});

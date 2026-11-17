importScripts('state.js', 'media-scan.js');
let activeTasks = {};
let activePorts = {};
let snifferEnabled = true;
let maxConcurrentDownloadsLimit = 1;
let consoleLogsCache = [];
let consoleRevision = 0;
const consoleEpoch = `${Date.now()}_${Math.random()}`;
// Serialize history mutations so concurrent completions and clears cannot lose entries.
let historyQueue = Promise.resolve();
function updateHistory(transform) {
    historyQueue = historyQueue.then(() => new Promise(resolve => {
        chrome.storage.local.get(['downloadHistory'], result => {
            chrome.storage.local.set({ downloadHistory: transform(result.downloadHistory || []) }, resolve);
        });
    }));
    return historyQueue;
}


function broadcastLog(id, title, log) {
    const entry = { title, log, sequence: ++consoleRevision };
    consoleLogsCache.push(entry);
    if (consoleLogsCache.length > 500) {
        consoleLogsCache.shift();
    }
    try {
        chrome.runtime.sendMessage({
            action: "download_log",
            id: id,
            title: title,
            log: log,
            entry,
            revision: consoleRevision,
            epoch: consoleEpoch
        }, () => { let _ = chrome.runtime.lastError; });
    } catch(err) {}
}

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: "download_video_link",
        title: "Descargar con DowFlow",
        contexts: ["video", "link", "page"]
    });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "download_video_link") {
        let targetUrl = info.srcUrl || info.linkUrl || info.pageUrl || (tab ? tab.url : "");
        if (!targetUrl) return;
        const sourcePage = info.frameUrl || info.pageUrl || tab?.url;
        const hasVideoPage = info.srcUrl && AppState.mediaSourceUrl(info.srcUrl, sourcePage) !== info.srcUrl;
        
        let title = (tab && tab.title) ? tab.title.replace(/^\(\d+\)\s*/, '').replace(/ - YouTube$/, '').trim() : "Video Descargado (Menú)";
        
        AppState.readSettings(result => {
            let request = {
                action: "download",
                url: targetUrl,
                pageUrl: hasVideoPage ? sourcePage : undefined,
                title: title,
                savePath: result.customSavePath || "",
                formatSetting: result.formatSetting || "mp4",
                qualitySetting: result.qualitySetting || "max",
                engineSetting: result.engineSetting || "ytdlp",
                threadCount: result.threadCount || 4,
                audioFormat: result.audioFormat || "best",
                audioQuality: result.audioQuality || "0",
                audioConvert: result.audioConvert || "mp3",
                videoFormatPref: result.videoFormatPref || "legado",
                ytAudioLang: result.ytAudioLang || "es",
                ytSubs: result.ytSubs || "off",
                isAutoTitle: false
            };
            
            queueDownload(request);
        });
    }
});

AppState.watchStorage(['snifferEnabled', 'maxConcurrentDownloads'], (values, keys) => {
    const settings = AppState.normalize(values);
    snifferEnabled = settings.snifferEnabled;
    maxConcurrentDownloadsLimit = settings.maxConcurrentDownloads;
    if (keys.includes('snifferEnabled') && !snifferEnabled) updateSniffs(urls => { for (const id of Object.keys(urls)) delete urls[id]; });
    processDownloadQueue();
});

const formatRequests = new Map();
const formatCache = new Map();
function fetchVideoInfo(url, pageUrl, callback, refresh = false) {
    const sourceUrl = AppState.mediaSourceUrl(url, pageUrl);
    const key = `${sourceUrl}\n${pageUrl || ''}`;
    if (refresh) formatCache.delete(key);
    const cached = formatCache.get(key);
    if (cached && Date.now() - cached.time < 300000) { callback(cached.response); return; }
    if (formatRequests.has(key)) { formatRequests.get(key).push(callback); return; }
    formatRequests.set(key, [callback]);
    let port, timer, finished = false;
    function finish(response) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (response.success && response.status === 'info' && response.info?.formats?.length) {
            formatCache.set(key, { time: Date.now(), response });
            if (formatCache.size > 50) formatCache.delete(formatCache.keys().next().value);
        }
        const callbacks = formatRequests.get(key) || [];
        formatRequests.delete(key);
        try { port?.disconnect(); } catch (_) {}
        callbacks.forEach(fn => fn(response));
    }
    function launch(cookies) {
        try {
            port = chrome.runtime.connectNative('com.gonzalo.videodownloader');
            port.onMessage.addListener(message => {
                if (message.status === 'info' || message.status === 'error') finish({ success: message.status === 'info', ...message });
            });
            port.onDisconnect.addListener(() => finish({ success: false, error: chrome.runtime.lastError?.message || 'El host se desconecto durante la deteccion.' }));
            timer = setTimeout(() => finish({ success: false, error: 'La deteccion tardo demasiado. Vuelve a intentarlo.' }), 65000);
            port.postMessage({ command: 'get_info', url: sourceUrl, pageUrl: pageUrl || '', netscapeCookies: cookies || '' });
        } catch (error) { finish({ success: false, error: error.message }); }
    }
    AppState.readSettings(settings => {
        let host = '';
        try { host = new URL(url).hostname; } catch (_) {}
        if (settings.cookiesSetting === 'chrome' || /(^|\.)(youtube\.com|youtu\.be|instagram\.com|tiktok\.com)$/.test(host)) {
            getCookiesForDomain(pageUrl || url, null, launch);
        } else launch('');
    });
}
function prefetchQuality(videoUrl) {
    AppState.readSettings(settings => {
        if (settings.qualitySetting === 'detect') fetchVideoInfo(videoUrl, '', () => {});
    });
}

let snifferQueue = Promise.resolve();
function updateSniffs(transform) {
    snifferQueue = snifferQueue.then(() => new Promise(resolve => {
        chrome.storage.local.get(['sniffedUrls'], result => {
            const urls = result.sniffedUrls || {};
            transform(urls);
            chrome.storage.local.set({ sniffedUrls: urls }, () => resolve(urls));
        });
    }));
    return snifferQueue;
}
function rememberMedia(details, fromHeader = false) {
    if (!snifferEnabled || details.tabId < 0) return;
    let pathname;
    try {
        const parsed = new URL(details.url);
        if (!['http:', 'https:'].includes(parsed.protocol)) return;
        pathname = parsed.pathname.toLowerCase();
    } catch (_) { return; }
    if (/\.(ts|m4s|vtt|jpg|jpeg|png|gif|webp|svg|css|js)$/.test(pathname)) return;
    const recognized = /\.(m3u8|mpd|mp4|webm|mkv|mov|m4v)(?:$|\/)/.test(pathname) || pathname.includes('/m3u8/');
    if (!recognized && details.type !== 'media' && !fromHeader) return;
    updateSniffs(urls => {
        const list = urls[details.tabId] || [];
        if (!list.includes(details.url)) urls[details.tabId] = [...list, details.url].slice(-100);
    });
}
chrome.webRequest.onBeforeRequest.addListener(details => rememberMedia(details), { urls: ['<all_urls>'] });
chrome.webRequest.onHeadersReceived?.addListener(details => {
    const type = details.responseHeaders?.find(header => header.name.toLowerCase() === 'content-type')?.value || '';
    if (/^(video\/|application\/(vnd\.apple\.mpegurl|x-mpegurl|dash\+xml))/i.test(type)) rememberMedia(details, true);
}, { urls: ['<all_urls>'] }, ['responseHeaders']);
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url) {
        updateSniffs(urls => { delete urls[tabId]; });
        if (/youtube\.com|youtu\.be/.test(changeInfo.url)) prefetchQuality(changeInfo.url);
    }
});
chrome.tabs.onRemoved.addListener(tabId => updateSniffs(urls => { delete urls[tabId]; }));
function scanPage(tabId, mode, callback) {
    if (!Number.isInteger(tabId)) { callback({ success: false, error: 'No hay una pestaña web activa.' }); return; }
    chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: scanMediaPage, args: [mode] }, results => {
        if (chrome.runtime.lastError) { callback({ success: false, error: chrome.runtime.lastError.message }); return; }
        const found = new Set((results || []).flatMap(frame => (frame.result || []).map(item => item.url)));
        chrome.storage.local.get(['sniffedUrls'], result => {
            const previous = result.sniffedUrls?.[tabId] || [];
            if (mode === 'streams') previous.filter(url => /\.m3u8|\.mpd|\/m3u8\//i.test(url)).forEach(url => found.add(url));
            const added = [...found].filter(url => !previous.includes(url)).length;
            updateSniffs(urls => { urls[tabId] = [...new Set([...(urls[tabId] || []), ...found])].slice(-100); })
                .then(() => callback({ success: true, count: found.size, added, urls: [...found] }));
        });
    });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Manejador del Método 1 (eliminado)

  if (request.action === 'scan_page') {
      scanPage(request.tabId, request.mode === 'streams' ? 'streams' : 'html', sendResponse);
      return true;
  }

  if (request.action === "emergency_stop") {
      // 1. Cancel all queued downloads in downloadQueue
      downloadQueue.forEach(item => {
          let taskId = item.downloadId;
          if (activeTasks[taskId]) {
              activeTasks[taskId].status = "cancelled";
              try { chrome.runtime.sendMessage({ action: "download_update", task: activeTasks[taskId] }, () => { let _ = chrome.runtime.lastError; }); } catch(err) {}
              setTimeout(() => {
                  delete activeTasks[taskId];
                  try { chrome.runtime.sendMessage({ action: "download_remove", id: taskId }, () => { let _ = chrome.runtime.lastError; }); } catch(e) {}
              }, 3000);
          }
      });
      downloadQueue = [];

      // 2. Cancel all active downloads
      Object.keys(activePorts).forEach(taskId => {
          let task = activeTasks[taskId];
          if (task) {
              task.status = "cancelled";
              try { chrome.runtime.sendMessage({ action: "download_update", task: task }, () => { let _ = chrome.runtime.lastError; }); } catch(err) {}
          }
          let port = activePorts[taskId];
          if (port) {
              try { port.disconnect(); } catch(e) {}
          }
          delete activePorts[taskId];
          
          setTimeout(() => {
              if (activeTasks[taskId]) {
                  delete activeTasks[taskId];
                  try { chrome.runtime.sendMessage({ action: "download_remove", id: taskId }, () => { let _ = chrome.runtime.lastError; }); } catch(e) {}
              }
          }, 3000);
      });

      // Reset active count
      runningSlots.clear();

      // Broadcast emergency log
      broadcastLog(null, null, "[EMERGENCIA] Parada de emergencia activada. Se han cancelado y eliminado todas las descargas activas y en cola.");

      sendResponse({ success: true });
      return true;
  }

  if (request.action === "get_active_downloads") {
      sendResponse({ success: true, tasks: activeTasks });
      return true;
  }

  if (request.action === "get_console_logs") {
      sendResponse({ success: true, logs: consoleLogsCache, revision: consoleRevision, epoch: consoleEpoch });
      return true;
  }

  if (request.action === "clear_console_logs") {
      consoleLogsCache = [];
      consoleRevision++;
      chrome.runtime.sendMessage({ action: 'console_cleared', revision: consoleRevision, epoch: consoleEpoch }, () => { void chrome.runtime.lastError; });
      sendResponse({ success: true });
      return true;
  }

  if (request.action === 'append_console_log') {
      broadcastLog(null, null, String(request.log || ''));
      sendResponse({ success: true });
      return;
  }
  if (request.action === 'clear_history') {
      updateHistory(() => []).then(() => sendResponse({ success: true }));
      return true;
  }
  if (request.action === 'clear_task' || request.action === 'clear_finished') {
      const ids = request.action === 'clear_task' ? [request.id] : Object.keys(activeTasks);
      for (const id of ids) {
          const task = activeTasks[id];
          if (!task || !['completed', 'cancelled', 'error'].includes(task.status)) continue;
          if (request.status && task.status !== request.status) continue;
          delete activeTasks[id];
          chrome.runtime.sendMessage({ action: 'download_remove', id }, () => { void chrome.runtime.lastError; });
      }
      sendResponse({ success: true });
      return;
  }

  if (request.action === "cancel_download") {
      let task = activeTasks[request.id];
      if (task && ["queued", "started", "progress"].includes(task.status)) {
          task.status = "cancelled";
          try { chrome.runtime.sendMessage({ action: "download_update", task: task }, () => { let _ = chrome.runtime.lastError; }); } catch(err) {}
          
          let port = activePorts[request.id];
          if (port) {
              delete activePorts[request.id];
              port.disconnect(); // Terminate native host instantly
              runningSlots.delete(request.id); // Release only this task's slot
              setTimeout(processDownloadQueue, 500); // Process next
          } else {
              // It's queued, not started natively yet
              // Remove it from the queue immediately so it won't be processed
              downloadQueue = downloadQueue.filter(q => q.downloadId !== request.id);
          }
          
          setTimeout(() => {
              if (activeTasks[request.id]) {
                  delete activeTasks[request.id];
                  if (activePorts[request.id]) delete activePorts[request.id];
                  try { chrome.runtime.sendMessage({ action: "download_remove", id: request.id }, () => { let _ = chrome.runtime.lastError; }); } catch(err) {}
              }
          }, 2000);
      }
      sendResponse({ success: Boolean(task) });
      return true;
  }

  if (request.action === 'get_info') {
      fetchVideoInfo(request.url, request.pageUrl, sendResponse, request.refresh === true);
      return true;
  }

  if (request.action === "download" || request.action === "open_folder" || request.action === "get_playlist_info" || request.action === "select_folder") {
    
    if (request.action === "open_folder" || request.action === "get_playlist_info" || request.action === "select_folder") {
        const hostName = "com.gonzalo.videodownloader";
        let port;
        try {
            port = chrome.runtime.connectNative(hostName);
            let responded = false;
            port.onMessage.addListener((message) => {
                if (!responded) {
                    sendResponse({ success: true, ...message });
                    responded = true;
                    try { port.disconnect(); } catch(e) {}
                }
            });
            port.onDisconnect.addListener(() => {
                if (!responded) {
                    sendResponse({ success: false, error: chrome.runtime.lastError ? chrome.runtime.lastError.message : "Desconectado" });
                    responded = true;
                }
            });
            port.postMessage({ command: request.action, url: request.url, file: request.file || request.final_file });
        } catch(e) {
            sendResponse({ success: false, error: e.message });
        }
        return true;
    }

    queueDownload(request, sendResponse);
    return true; // Asynchronous response
  }
});

function queueDownload(request, sendResponse = () => {}) {
    // Action === "download"
    AppState.readSettings(res => {
        const normalized = AppState.normalize({ ...res, ...request });
        Object.assign(request, normalized);
        request.savePath = request.savePath ?? normalized.customSavePath;
        const autoEngine = res.autoEngine;
        if (request.formatSetting !== 'mp3' && request.qualitySetting === 'detect' && !/^[A-Za-z0-9_.-]+$/.test(request.customFormatId || '')) {
            sendResponse({ success: false, error: 'Detector: selecciona un formato antes de descargar.' });
            return;
        }
        const decision = AppState.chooseEngine(request, autoEngine);
        request.engineSetting = decision.engine;
        request.autoEngine = autoEngine;

        let downloadId = "dl_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
        
        activeTasks[downloadId] = {
            id: downloadId,
            title: request.title || "Video",
            url: request.url,
            percent: "0",
            qualitySetting: request.qualitySetting,
            engineSetting: request.engineSetting,
            engineReason: decision.reason,
            customFormatId: request.customFormatId || "",
            pageUrl: request.pageUrl || "",
            status: "queued"
        };

        broadcastLog(downloadId, request.title, `[Motor] ${request.engineSetting}: ${decision.reason}`);
        downloadQueue.push({
            downloadId: downloadId,
            request: request
        });
        
        sendResponse({ success: true, queued: true, id: downloadId });
        try { chrome.runtime.sendMessage({ action: "download_update", task: activeTasks[downloadId] }, () => { let _ = chrome.runtime.lastError; }); } catch(err) {}

        processDownloadQueue();
    });
}

let downloadQueue = [];
const runningSlots = new Set();

function getCookiesForDomain(targetUrl, downloadId, callback) {
    function logMsg(msg) {
        console.log(msg);
        broadcastLog(downloadId, null, msg);
    }

    if (!chrome.cookies) {
        logMsg("[-] ERROR CRÍTICO: chrome.cookies no está disponible. DEBES recargar la extensión desde chrome://extensions.");
        return callback('');
    }

    let query = { url: targetUrl };
    try {
        let domain = new URL(targetUrl).hostname;
        if (domain.startsWith("www.")) {
            domain = domain.substring(4);
        }
        if (domain.includes("instagram.com") || domain.includes("youtube.com") || domain.includes("tiktok.com")) {
            query = { domain: domain };
        }
    } catch(e) {}

    chrome.cookies.getAll(query, (cookies) => {
        if (chrome.runtime.lastError) {
            logMsg("[-] Error al extraer cookies: " + chrome.runtime.lastError.message);
            return callback('');
        }
        let cookieString = "# Netscape HTTP Cookie File\n";
        if (cookies && cookies.length > 0) {
            logMsg(`[*] Extraídas ${cookies.length} cookies nativas para ${targetUrl} con éxito.`);
            cookies.forEach(c => {
                let domain = c.domain;
                let includesSub = domain.startsWith('.') ? "TRUE" : "FALSE";
                let path = c.path;
                let secure = c.secure ? "TRUE" : "FALSE";
                let expiration = c.expirationDate ? Math.floor(c.expirationDate) : Math.floor(Date.now() / 1000) + 3600;
                cookieString += `${domain}\t${includesSub}\t${path}\t${secure}\t${expiration}\t${c.name}\t${c.value}\n`;
            });
            callback(cookieString);
        } else {
            logMsg(`[-] ADVERTENCIA: 0 cookies encontradas en Chrome para ${targetUrl}.`);
            callback('');
        }
    });
}

function processDownloadQueue() {
    if (runningSlots.size >= maxConcurrentDownloadsLimit) return;
    if (downloadQueue.length === 0) return;

    let queuedItem = downloadQueue.shift();
    let downloadId = queuedItem.downloadId;
    let request = queuedItem.request;

    if (!activeTasks[downloadId] || activeTasks[downloadId].status !== "queued") {
        // Was cleared or cancelled before it started
        processDownloadQueue();
        return;
    }

    runningSlots.add(downloadId);
    activeTasks[downloadId].status = "started";
    chrome.runtime.sendMessage({ action: 'download_update', task: activeTasks[downloadId] }, () => { void chrome.runtime.lastError; });
    broadcastLog(downloadId, null, `[COLA] Iniciando descarga de "${activeTasks[downloadId].title}". Numero de descargas paralelas: ${runningSlots.size} (Límite: ${maxConcurrentDownloadsLimit})`);

    // Extraer cookies de forma centralizada en background.js antes de conectar con el host nativo
    chrome.storage.local.get(['cookiesSetting'], (storageRes) => {
        let cookiesSetting = storageRes.cookiesSetting || 'none';
        let url = request.url || '';
        let shouldGetCookies = false;
        let targetDomain = url;

        if (url.includes("youtube.com") || url.includes("youtu.be")) {
            shouldGetCookies = true;
            targetDomain = "https://www.youtube.com";
        } else if (url.includes("instagram.com")) {
            shouldGetCookies = true;
            targetDomain = "https://www.instagram.com";
        } else if (url.includes("tiktok.com")) {
            shouldGetCookies = true;
            targetDomain = "https://www.tiktok.com";
        } else if (cookiesSetting === "chrome") {
            shouldGetCookies = true;
            try {
                let parsed = new URL(url);
                targetDomain = parsed.protocol + "//" + parsed.hostname;
            } catch(e) {}
        }

        if (shouldGetCookies) {
            getCookiesForDomain(targetDomain, downloadId, (cookiesStr) => {
                request.netscapeCookies = cookiesStr;
                launchNativeDownload(downloadId, request);
            });
        } else {
            request.netscapeCookies = '';
            launchNativeDownload(downloadId, request);
        }
    });
    // Fill all free slots, including after the concurrency setting increases.
    processDownloadQueue();
}

function launchNativeDownload(downloadId, request) {
    if (!activeTasks[downloadId] || activeTasks[downloadId].status !== "started") {
        // Cancelado o removido durante la obtención de cookies
        runningSlots.delete(downloadId);
        setTimeout(processDownloadQueue, 500);
        return;
    }

    const hostName = "com.gonzalo.videodownloader";
    let port;
    try {
        port = chrome.runtime.connectNative(hostName);
        activePorts[downloadId] = port;
    } catch (e) {
        activeTasks[downloadId].status = "error";
        activeTasks[downloadId].error = e.message;
        try { chrome.runtime.sendMessage({ action: "download_update", task: activeTasks[downloadId] }, () => { let _ = chrome.runtime.lastError; }); } catch(err) {}
        
        runningSlots.delete(downloadId);
        broadcastLog(downloadId, null, `[COLA] Error al conectar con el host para "${activeTasks[downloadId].title}". (Simultáneas activas restantes: ${runningSlots.size}/${maxConcurrentDownloadsLimit})`);
        setTimeout(processDownloadQueue, 500);
        return;
    }

    port.onMessage.addListener((message) => {
        if (activePorts[downloadId] !== port) return;
        if (message.status === "log") {
            let title = activeTasks[downloadId] ? activeTasks[downloadId].title : "Descarga";
            broadcastLog(downloadId, title, message.log);
        }
        else if (message.status === "progress" || message.status === "completed" || message.status === "error" || message.status === "cancelled" || message.status === "started") {
            
            if (activeTasks[downloadId]) {
                activeTasks[downloadId].status = message.status;
                if (message.percent) activeTasks[downloadId].percent = message.percent;
                if (message.error) activeTasks[downloadId].error = message.error;
                if (message.final_file) activeTasks[downloadId].final_file = message.final_file;
            }
            try { chrome.runtime.sendMessage({ action: "download_update", task: activeTasks[downloadId] }, () => { let _ = chrome.runtime.lastError; }); } catch(err) {}
            
            if (message.status === "completed" || message.status === "cancelled" || message.status === "error") {
                if (message.status === "completed" && activeTasks[downloadId]) {
                    let final_file = message.final_file || "";
                    let title = activeTasks[downloadId].title;
                    let url = activeTasks[downloadId].url;
                    updateHistory(history => [...history, { title, url, final_file, date: new Date().toISOString() }]);
                }
                runningSlots.delete(downloadId);

                // Disconnect the native port immediately to close the Python process
                let port = activePorts[downloadId];
                if (port) {
                    delete activePorts[downloadId];
                    try { port.disconnect(); } catch(e) {}
                }

                let taskName = activeTasks[downloadId] ? activeTasks[downloadId].title : "Descarga";
                broadcastLog(downloadId, null, `[COLA] Finalizó "${taskName}" con estado: ${message.status}. (Simultáneas activas restantes: ${runningSlots.size}/${maxConcurrentDownloadsLimit})`);
                setTimeout(processDownloadQueue, 1500); // 1.5s delay to cool down between sequential downloads

                if (message.status !== "error") {
                    setTimeout(() => {
                        if (activeTasks[downloadId]) {
                            delete activeTasks[downloadId];
                            try { chrome.runtime.sendMessage({ action: "download_remove", id: downloadId }, () => { let _ = chrome.runtime.lastError; }); } catch(e) {}
                        }
                    }, 4000);
                }
            }
        }
    });

    port.onDisconnect.addListener(() => {
        if (activePorts[downloadId]) {
            delete activePorts[downloadId];
            
            if (activeTasks[downloadId] && (activeTasks[downloadId].status === "queued" || activeTasks[downloadId].status === "started" || activeTasks[downloadId].status === "progress")) {
                let err = chrome.runtime.lastError ? chrome.runtime.lastError.message : "Desconectado inesperadamente";
                activeTasks[downloadId].status = "error";
                activeTasks[downloadId].error = err;
                try { chrome.runtime.sendMessage({ action: "download_update", task: activeTasks[downloadId] }, () => {}); } catch(e) {}
                
                runningSlots.delete(downloadId);
                let taskName = activeTasks[downloadId] ? activeTasks[downloadId].title : "Descarga";
                broadcastLog(downloadId, null, `[COLA] Error en "${taskName}": Desconectado inesperadamente. (Simultáneas activas restantes: ${runningSlots.size}/${maxConcurrentDownloadsLimit})`);
                setTimeout(processDownloadQueue, 1000);
            }
        }
    });

    port.postMessage({ 
        command: "download", 
        title: request.title,
        url: AppState.mediaSourceUrl(request.url, request.pageUrl),
        pageUrl: request.pageUrl,
        savePath: request.savePath,
        formatSetting: request.formatSetting,
        qualitySetting: request.qualitySetting,
        fixedQuality: request.fixedQuality,
        engineSetting: request.engineSetting,
        autoEngine: request.autoEngine,
        threadCount: request.threadCount,
        audioFormat: request.audioFormat,
        audioQuality: request.audioQuality,
        audioConvert: request.audioConvert,
        videoFormatPref: request.videoFormatPref,
        customFormatId: request.customFormatId,
        netscapeCookies: request.netscapeCookies,
        isAutoTitle: request.isAutoTitle,
        ytAudioLang: request.ytAudioLang,
        ytSubs: request.ytSubs
    });
}

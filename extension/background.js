let activeTasks = {};
let activePorts = {};
let snifferEnabled = true;
let maxConcurrentDownloadsLimit = 1;

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: "download_video_link",
        title: "Descargar con Local Downloader",
        contexts: ["video", "link", "page"]
    });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "download_video_link") {
        let targetUrl = info.srcUrl || info.linkUrl || info.pageUrl || (tab ? tab.url : "");
        if (!targetUrl) return;
        
        let title = (tab && tab.title) ? tab.title.replace(/^\(\d+\)\s*/, '').replace(/ - YouTube$/, '').trim() : "Video Descargado (Menú)";
        
        chrome.storage.local.get(['customSavePath', 'formatSetting', 'qualitySetting', 'engineSetting', 'threadCount', 'audioFormat', 'audioQuality', 'audioConvert', 'videoFormatPref', 'ytAudioLang', 'ytSubs'], (result) => {
            let request = {
                action: "download",
                url: targetUrl,
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
            
            let downloadId = "dl_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
            
            activeTasks[downloadId] = {
                id: downloadId,
                title: title,
                url: targetUrl,
                percent: "0",
                status: "queued"
            };

            downloadQueue.push({
                downloadId: downloadId,
                request: request
            });
            
            try { chrome.runtime.sendMessage({ action: "download_update", task: activeTasks[downloadId] }, () => { let _ = chrome.runtime.lastError; }); } catch(err) {}

            processDownloadQueue();
        });
    }
});

chrome.storage.local.get(['snifferEnabled', 'maxConcurrentDownloads'], (res) => {
    if (res.snifferEnabled === false) snifferEnabled = false;
    if (res.maxConcurrentDownloads) {
        maxConcurrentDownloadsLimit = parseInt(res.maxConcurrentDownloads);
    }
});

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (changes.snifferEnabled) {
        snifferEnabled = changes.snifferEnabled.newValue;
    }
    if (changes.maxConcurrentDownloads) {
        maxConcurrentDownloadsLimit = parseInt(changes.maxConcurrentDownloads.newValue || 1);
        processDownloadQueue();
    }
});

function prefetchQuality(videoUrl) {
    let cacheKey = videoUrl;
    if (videoUrl.includes('youtube.com/watch')) {
        let match = videoUrl.match(/([?&]v=[^&]+)/);
        if (match) cacheKey = "yt_" + match[1];
    }
    
    chrome.storage.local.get(['qualitySetting', 'prefetchedQualities'], function(result) {
        if (result.qualitySetting === 'detect') {
            let cache = result.prefetchedQualities || {};
            if (cache[cacheKey] && (Date.now() - cache[cacheKey].timestamp < 300000)) return;
            
            try {
                let port = chrome.runtime.connectNative("com.gonzalo.videodownloader");
                port.onMessage.addListener((message) => {
                    if (message.status === "info") {
                        chrome.storage.local.get(['prefetchedQualities'], (r2) => {
                            let freshCache = r2.prefetchedQualities || {};
                            freshCache[cacheKey] = { timestamp: Date.now(), formats: message.info.formats };
                            chrome.storage.local.set({ prefetchedQualities: freshCache });
                        });
                    }
                    port.disconnect();
                });
                port.postMessage({ command: "get_info", url: videoUrl });
            } catch(e) {}
        }
    });
}

chrome.webRequest.onBeforeRequest.addListener(
  function(details) {
    if (!snifferEnabled) return;
    if (details.tabId >= 0) {
      const url = details.url;
      const isMedia = details.type === "media";
      const isDirectVideo = url.includes(".m3u8") || url.includes("/m3u8/") || url.includes(".mp4");
      
      if (isDirectVideo || isMedia) {
        if (url.includes('tiktok') || url.includes('tiktokcdn') || url.includes('facebook') || url.includes('fbcdn')) return;
        
        chrome.storage.local.get(['sniffedUrls'], function(result) {
          let urls = result.sniffedUrls || {};
          if (!urls[details.tabId]) urls[details.tabId] = [];
          
          if (!urls[details.tabId].includes(url)) {
             urls[details.tabId].push(url);
             chrome.storage.local.set({ sniffedUrls: urls });
             
             // Disparar precarga automáticamente apenas un nuevo video sea detectado (M3U8, MP4, etc)
             prefetchQuality(url);
          }
        });
      }
    }
  },
  { urls: ["<all_urls>"] }
);

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url) {
         chrome.storage.local.get(['sniffedUrls'], function(result) {
             let urls = result.sniffedUrls || {};
             delete urls[tabId];
             chrome.storage.local.set({ sniffedUrls: urls });
             
             // Disparar precarga para YouTube (ya que YouTube oculta sus streams directos)
             if (changeInfo.url.includes('youtube.com/watch') || changeInfo.url.includes('youtu.be/')) {
                 prefetchQuality(changeInfo.url);
             }
         });
    }
});

chrome.tabs.onRemoved.addListener((tabId) => {
    chrome.storage.local.get(['sniffedUrls'], function(result) {
        let urls = result.sniffedUrls || {};
        delete urls[tabId];
        chrome.storage.local.set({ sniffedUrls: urls });
    });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Manejador del Método 1 (eliminado)

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
      activeDownloadsCount = 0;

      // Broadcast emergency log
      try {
          chrome.runtime.sendMessage({
              action: "download_log",
              log: "[EMERGENCIA] Parada de emergencia activada. Se han cancelado y eliminado todas las descargas activas y en cola."
          }, () => { let _ = chrome.runtime.lastError; });
      } catch(err) {}

      sendResponse({ success: true });
      return true;
  }

  if (request.action === "get_active_downloads") {
      sendResponse({ success: true, tasks: activeTasks });
      return true;
  }

  if (request.action === "clear_task") {
      if (activeTasks[request.id]) {
          delete activeTasks[request.id];
          delete activePorts[request.id];
      }
      return true;
  }

  if (request.action === "cancel_download") {
      let task = activeTasks[request.id];
      if (task) {
          task.status = "cancelled";
          try { chrome.runtime.sendMessage({ action: "download_update", task: task }, () => { let _ = chrome.runtime.lastError; }); } catch(err) {}
          
          let port = activePorts[request.id];
          if (port) {
              port.disconnect(); // Terminate native host instantly
              activeDownloadsCount--; // Free slot
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
      return true;
  }

  if (request.action === "download" || request.action === "open_folder" || request.action === "get_info" || request.action === "get_playlist_info" || request.action === "select_folder") {
    
    if (request.action === "open_folder" || request.action === "get_info" || request.action === "get_playlist_info" || request.action === "select_folder") {
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
            port.postMessage({ command: request.action, url: request.url });
        } catch(e) {
            sendResponse({ success: false, error: e.message });
        }
        return true;
    }

    // Action === "download"
    let downloadId = "dl_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
    
    activeTasks[downloadId] = {
        id: downloadId,
        title: request.title || "Video",
        url: request.url,
        percent: "0",
        status: "queued"
    };

    downloadQueue.push({
        downloadId: downloadId,
        request: request
    });
    
    sendResponse({ success: true, queued: true, id: downloadId });
    try { chrome.runtime.sendMessage({ action: "download_update", task: activeTasks[downloadId] }, () => { let _ = chrome.runtime.lastError; }); } catch(err) {}

    processDownloadQueue();
    return true; // Asynchronous response
  }
});

let downloadQueue = [];
let activeDownloadsCount = 0;

function getCookiesForDomain(targetUrl, downloadId, callback) {
    function logMsg(msg) {
        console.log(msg);
        try {
            chrome.runtime.sendMessage({
                action: "download_log",
                id: downloadId,
                log: msg
            }, () => { let _ = chrome.runtime.lastError; });
        } catch(err) {}
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
    if (activeDownloadsCount >= maxConcurrentDownloadsLimit) return;
    if (downloadQueue.length === 0) return;

    let queuedItem = downloadQueue.shift();
    let downloadId = queuedItem.downloadId;
    let request = queuedItem.request;

    if (!activeTasks[downloadId] || activeTasks[downloadId].status !== "queued") {
        // Was cleared or cancelled before it started
        processDownloadQueue();
        return;
    }

    activeDownloadsCount++;
    activeTasks[downloadId].status = "started";
    try {
        chrome.runtime.sendMessage({
            action: "download_log",
            id: downloadId,
            log: `[COLA] Iniciando descarga de "${activeTasks[downloadId].title}". (Simultáneas activas: ${activeDownloadsCount}/${maxConcurrentDownloadsLimit})`
        }, () => { let _ = chrome.runtime.lastError; });
    } catch(err) {}

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
}

function launchNativeDownload(downloadId, request) {
    if (!activeTasks[downloadId] || activeTasks[downloadId].status !== "started") {
        // Cancelado o removido durante la obtención de cookies
        activeDownloadsCount--;
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
        
        activeDownloadsCount--;
        try {
            chrome.runtime.sendMessage({
                action: "download_log",
                id: downloadId,
                log: `[COLA] Error al conectar con el host para "${activeTasks[downloadId].title}". (Simultáneas activas restantes: ${activeDownloadsCount}/${maxConcurrentDownloadsLimit})`
            }, () => { let _ = chrome.runtime.lastError; });
        } catch(err) {}
        setTimeout(processDownloadQueue, 500);
        return;
    }

    port.onMessage.addListener((message) => {
        if (message.status === "log") {
            try {
                let title = activeTasks[downloadId] ? activeTasks[downloadId].title : "Descarga";
                chrome.runtime.sendMessage({ action: "download_log", id: downloadId, title: title, log: message.log }, () => { let _ = chrome.runtime.lastError; });
            } catch(err) {}
        }
        else if (message.status === "progress" || message.status === "completed" || message.status === "error" || message.status === "cancelled" || message.status === "started") {
            
            if (activeTasks[downloadId]) {
                activeTasks[downloadId].status = message.status;
                if (message.percent) activeTasks[downloadId].percent = message.percent;
                if (message.error) activeTasks[downloadId].error = message.error;
            }
            try { chrome.runtime.sendMessage({ action: "download_update", task: activeTasks[downloadId] }, () => { let _ = chrome.runtime.lastError; }); } catch(err) {}
            
            if (message.status === "completed" || message.status === "cancelled" || message.status === "error") {
                if (message.status === "completed" && activeTasks[downloadId]) {
                    let final_file = message.final_file || "";
                    let title = activeTasks[downloadId].title;
                    let url = activeTasks[downloadId].url;
                    chrome.storage.local.get(['downloadHistory'], (res) => {
                        let history = res.downloadHistory || [];
                        history.push({ title: title, url: url, final_file: final_file, date: new Date().toISOString() });
                        chrome.storage.local.set({ downloadHistory: history });
                    });
                }
                activeDownloadsCount--;

                // Disconnect the native port immediately to close the Python process
                let port = activePorts[downloadId];
                if (port) {
                    delete activePorts[downloadId];
                    try { port.disconnect(); } catch(e) {}
                }

                try {
                    let taskName = activeTasks[downloadId] ? activeTasks[downloadId].title : "Descarga";
                    chrome.runtime.sendMessage({
                        action: "download_log",
                        id: downloadId,
                        log: `[COLA] Finalizó "${taskName}" con estado: ${message.status}. (Simultáneas activas restantes: ${activeDownloadsCount}/${maxConcurrentDownloadsLimit})`
                    }, () => { let _ = chrome.runtime.lastError; });
                } catch(err) {}
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
                
                activeDownloadsCount--;
                try {
                    let taskName = activeTasks[downloadId] ? activeTasks[downloadId].title : "Descarga";
                    chrome.runtime.sendMessage({
                        action: "download_log",
                        id: downloadId,
                        log: `[COLA] Error en "${taskName}": Desconectado inesperadamente. (Simultáneas activas restantes: ${activeDownloadsCount}/${maxConcurrentDownloadsLimit})`
                    }, () => { let _ = chrome.runtime.lastError; });
                } catch(err) {}
                setTimeout(processDownloadQueue, 1000);
            }
        }
    });

    port.postMessage({ 
        command: "download", 
        title: request.title,
        url: request.url, 
        pageUrl: request.pageUrl,
        savePath: request.savePath,
        formatSetting: request.formatSetting,
        qualitySetting: request.qualitySetting,
        engineSetting: request.engineSetting,
        threadCount: request.threadCount,
        audioFormat: request.audioFormat,
        audioQuality: request.audioQuality,
        audioConvert: request.audioConvert,
        videoFormatPref: request.videoFormatPref,
        customFormatId: request.customFormatId,
        netscapeCookies: request.netscapeCookies,
        isAutoTitle: request.isAutoTitle
    });
}

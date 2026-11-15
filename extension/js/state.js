/* Shared state and controls for popup and tools. DOM updates never write back. */
(function (root) {
    'use strict';
    const defaults = Object.freeze({
        customSavePath: '', formatSetting: 'mp4', qualitySetting: 'max', fixedQuality: '1080',
        engineSetting: 'ytdlp', autoEngine: true, threadCount: 4,
        audioFormat: 'best', audioQuality: '0', audioConvert: 'mp3',
        videoFormatPref: 'legado', customMode: false, snifferEnabled: true,
        ytAudioLang: 'es', ytSubs: 'off', cookiesSetting: 'none',
        maxConcurrentDownloads: 1, batchNamingMode: 'original', batchCustomPrefix: ''
    });
    const booleanKeys = new Set(['autoEngine', 'customMode', 'snifferEnabled']);
    const radioKeys = {
        formatSetting: 'formatSetting', qualitySetting: 'qualitySetting',
        engineSetting: 'engineSetting', autoEngine: 'autoEngine',
        videoFormatPref: 'videoFormatPref', customModeSetting: 'customMode',
        snifferSetting: 'snifferEnabled', ytAudioLang: 'ytAudioLang',
        ytSubs: 'ytSubs', cookiesSetting: 'cookiesSetting'
    };
    const controlKeys = {
        fixedQualitySelect: 'fixedQuality', threadSlider: 'threadCount', concurrencySlider: 'maxConcurrentDownloads',
        audioFormatSelect: 'audioFormat', audioQualitySelect: 'audioQuality',
        audioConvertSelect: 'audioConvert', popupBatchNamingSelect: 'batchNamingMode',
        batchNamingSelect: 'batchNamingMode', configBatchNamingSelect: 'batchNamingMode',
        configBatchNamingSelect2: 'batchNamingMode',
        popupBatchCustomPrefixInput: 'batchCustomPrefix', batchCustomPrefixInput: 'batchCustomPrefix',
        configBatchCustomPrefixInput: 'batchCustomPrefix', configBatchCustomPrefixInput2: 'batchCustomPrefix'
    };
    function normalize(values = {}) {
        const state = { ...defaults };
        for (const key of Object.keys(defaults)) {
            const value = values[key];
            if (value === undefined || value === null) continue;
            if (booleanKeys.has(key)) state[key] = value === true || value === 'on';
            else if (key === 'fixedQuality') state[key] = ['144','240','360','480','720','1080','1440','2160','4320'].includes(String(value)) ? String(value) : '1080';
            else if (key === 'ytSubs') state[key] = value === true || value === 'on' ? 'on' : 'off';
            else if (key === 'threadCount' || key === 'maxConcurrentDownloads') {
                const limit = key === 'threadCount' ? 36 : 50;
                state[key] = Math.min(limit, Math.max(1, parseInt(value, 10) || defaults[key]));
            } else state[key] = String(value);
        }
        return state;
    }
    function chooseEngine(request, automatic = true) {
        const manual = ['ytdlp', 'aria2', 'nm3u8', 'native'].includes(request.engineSetting) ? request.engineSetting : 'ytdlp';
        const needsProcessing = request.formatSetting === 'mp3' || ['fixed', 'detect', 'ask', 'min'].includes(request.qualitySetting) || request.ytSubs === 'on';
        if (needsProcessing) {
            return { engine: !automatic && manual === 'aria2' ? 'aria2' : 'ytdlp',
                reason: 'El formato, la calidad o los subtitulos solicitados necesitan seleccion o procesamiento con yt-dlp.' };
        }
        if (!automatic) return { engine: manual, reason: 'Se conserva el motor elegido manualmente.' };
        let url;
        try { url = new URL(request.url); } catch (_) { return { engine: 'ytdlp', reason: 'Enlace general: yt-dlp analizara el contenido.' }; }
        const pathname = url.pathname.toLowerCase();
        if (request.cookiesSetting === 'chrome' || (request.pageUrl && request.pageUrl !== request.url)) {
            return { engine: 'ytdlp', reason: 'El enlace puede necesitar cookies o la pagina de origen.' };
        }
        if (/\.(m3u8|mpd)(?:$|\/)/.test(pathname) || pathname.includes('/m3u8/')) {
            return { engine: 'nm3u8', reason: 'Lista HLS/DASH directa: motor especializado en segmentos.' };
        }
        if (/\.mp4$/.test(pathname)) return { engine: 'native', reason: 'Archivo MP4 directo sin conversion ni seleccion de calidad.' };
        return { engine: 'ytdlp', reason: 'Pagina web u otro formato: yt-dlp analizara sus opciones.' };
    }
    function readSettings(callback) {
        chrome.storage.local.get(Object.keys(defaults), values => callback(normalize(values)));
    }
    // Subscribe before reading, so changes during the initial read win over its snapshot.
    function watchLocal(keys, callback) {
        let initialized = false;
        let pending = {};
        let state = {};
        const listener = (changes, namespace) => {
            if (namespace !== 'local') return;
            const patch = {};
            for (const key of keys) if (changes[key]) patch[key] = changes[key].newValue;
            if (!Object.keys(patch).length) return;
            if (!initialized) { Object.assign(pending, patch); return; }
            Object.assign(state, patch);
            callback({ ...state }, Object.keys(patch));
        };
        chrome.storage.onChanged.addListener(listener);
        chrome.storage.local.get(keys, values => {
            state = { ...values, ...pending };
            initialized = true;
            callback({ ...state }, keys);
            pending = {};
        });
        return () => chrome.storage.onChanged.removeListener(listener);
    }
    function bindSettings(doc, onChange = () => {}) {
        const write = (key, value) => {
            const normalized = normalize({ [key]: value })[key];
            chrome.storage.local.set({ [key]: normalized });
        };
        for (const [name, key] of Object.entries(radioKeys)) {
            doc.querySelectorAll(`input[name="${name}"]`).forEach(el => {
                el.addEventListener('change', () => { if (el.checked) write(key, el.value); });
            });
        }
        for (const [id, key] of Object.entries(controlKeys)) {
            const el = doc.getElementById(id);
            if (!el) continue;
            el.addEventListener(el.type === 'range' || key === 'batchCustomPrefix' ? 'input' : 'change', () => write(key, el.value));
        }
        return watchLocal(Object.keys(defaults), (values, keys) => {
            const state = normalize(values);
            const byId = (id, apply) => { const el = doc.getElementById(id); if (el) apply(el); };
            for (const [name, key] of Object.entries(radioKeys)) {
                const value = booleanKeys.has(key) ? (state[key] ? 'on' : 'off') : state[key];
                doc.querySelectorAll(`input[name="${name}"]`).forEach(el => { el.checked = el.value === value; });
            }
            for (const [id, key] of Object.entries(controlKeys)) byId(id, el => {
                if (el.value !== String(state[key])) el.value = state[key];
            });
            byId('savePathDisplay', el => { el.textContent = state.customSavePath || 'Ninguna seleccionada (Descargas)'; });
            byId('threadCountLabel', el => {
                el.textContent = `Hilos: ${state.threadCount}`;
                el.style.color = state.threadCount > 24 ? '#ff4d4d' : '#e5e5e5';
            });
            byId('concurrencyCountLabel', el => { el.textContent = `Descargas a la vez: ${state.maxConcurrentDownloads}`; });
            const audioOnly = state.formatSetting === 'mp3';
            byId('fixedQualityWrap', el => { el.style.display = !audioOnly && state.qualitySetting === 'fixed' ? 'block' : 'none'; });
            for (const id of ['qualitySettingContainer', 'videoPreferenceContainer']) byId(id, el => { el.style.display = audioOnly ? 'none' : 'block'; });
            byId('audioSettingsLabel', el => { el.textContent = audioOnly ? 'Ajustes de Audio' : 'Ajustes del Audio del Video'; });
            byId('manualCardContainer', el => { el.style.display = state.customMode ? 'block' : 'none'; });
            const dot = doc.querySelector('.status-dot');
            if (dot) dot.style.backgroundColor = state.snifferEnabled ? '#00e676' : '#6a6b70';
            for (const id of ['popupBatchCustomPrefixWrap', 'configBatchCustomPrefixWrap', 'configBatchCustomPrefixWrap2']) byId(id, el => { el.style.display = state.batchNamingMode === 'custom' ? 'block' : 'none'; });
            byId('batchCustomPrefixInput', el => { el.style.display = state.batchNamingMode === 'custom' ? 'inline-block' : 'none'; });
            byId('threadSettingContainer', el => { el.style.display = state.engineSetting === 'native' ? 'none' : 'block'; });
            const descriptions = {
                ytdlp: 'yt-dlp: descargador general. Recomendación: 4 a 8 hilos.',
                aria2: 'aria2: múltiples conexiones. Recomendación: 8 a 16 hilos.',
                nm3u8: 'N_m3u8DL-RE: streams por segmentos. Recomendación: 8 a 24 hilos.',
                native: 'Python: descarga directa. Este motor no utiliza el ajuste de hilos.'
            };
            byId('threadDescription', el => { el.textContent = descriptions[state.engineSetting] || ''; });
            onChange(state, keys);
        });
    }
    // One ordered stream for both consoles. Buffer live events during the initial snapshot.
    function watchConsole(callback) {
        let ready = false, pending = [], revision = -1, logs = [], epoch = null;
        function apply(message) {
            if (message.epoch !== epoch) { epoch = message.epoch; revision = -1; logs = []; }
            if (message.revision <= revision) return;
            revision = message.revision;
            if (message.action === 'console_cleared') logs = [];
            else logs = [...logs, message.entry].slice(-500);
            callback(logs.slice());
        }
        const listener = message => {
            if (message.action !== 'download_log' && message.action !== 'console_cleared') return;
            if (!ready) pending.push(message);
            else apply(message);
        };
        chrome.runtime.onMessage.addListener(listener);
        chrome.runtime.sendMessage({ action: 'get_console_logs' }, response => {
            if (chrome.runtime.lastError) return;
            logs = response?.logs || [];
            revision = response?.revision ?? 0;
            epoch = response?.epoch;
            ready = true;
            callback(logs.slice());
            pending.sort((a, b) => a.revision - b.revision).forEach(apply);
            pending = [];
        });
        return () => chrome.runtime.onMessage.removeListener(listener);
    }
    function loadFormats(select, url, pageUrl = '', refresh = false) {
        const key = `${url}\n${pageUrl}`;
        if (!refresh && select.dataset.loadedUrl === key) return Promise.resolve(true);
        if (select._loading) return select._loading;
        const doc = select.ownerDocument;
        select.disabled = true;
        select.replaceChildren(new root.Option('Detectando formatos...', ''));
        let retry = select._retry;
        if (!retry) {
            retry = doc.createElement('button');
            retry.type = 'button'; retry.className = 'action-btn secondary detector-retry-btn';
            retry.textContent = 'Reintentar'; retry.title = 'Volver a consultar los formatos';
            retry.addEventListener('click', () => loadFormats(select, url, pageUrl, true));
            select.insertAdjacentElement('afterend', retry);
            select._retry = retry;
        }
        retry.hidden = false; retry.disabled = true;
        select._loading = new Promise(resolve => {
            chrome.runtime.sendMessage({ action: 'get_info', url, pageUrl, refresh }, response => {
                const error = chrome.runtime.lastError?.message || response?.error;
                const formats = response?.success ? response.info?.formats || [] : [];
                select.replaceChildren();
                if (error || !formats.length) {
                    select.append(new root.Option('No se pudieron detectar formatos', ''));
                    select.title = error || 'El origen no ofrece formatos de video detectables.';
                    select.dataset.error = select.title;
                    delete select.dataset.loadedUrl;
                    select.disabled = true;
                } else {
                    const seen = new Set();
                    const sorted = formats.slice().sort((a, b) => (Number(b.height) || 0) - (Number(a.height) || 0) || (Number(b.tbr) || 0) - (Number(a.tbr) || 0));
                    for (const format of sorted) {
                        const id = String(format.format_id || '');
                        if (!/^[A-Za-z0-9_.-]+$/.test(id) || seen.has(id)) continue;
                        seen.add(id);
                        const resolution = format.resolution || (format.height ? `${format.height}p` : 'Resolucion no informada');
                        const bitrate = Number(format.tbr) > 0 ? ` · ${Math.round(format.tbr)} kb/s` : '';
                        select.append(new root.Option(`${resolution} · ${(format.ext || '').toUpperCase()}${bitrate} · ${id}`, id));
                    }
                    if (select.options.length) {
                        select.dataset.loadedUrl = key; delete select.dataset.error;
                        select.disabled = false; select.title = 'Elige el formato real que se descargara';
                    } else {
                        select.append(new root.Option('No hay formatos de video validos', ''));
                        select.disabled = true;
                    }
                }
                retry.disabled = false; select._loading = null;
                resolve(!select.disabled);
            });
        });
        return select._loading;
    }
    let dialogQueue = Promise.resolve();
    function chooseFormat(url, title, pageUrl) {
        const run = () => new Promise(resolve => {
            const doc = root.document;
            const dialog = doc.createElement('dialog');
            dialog.className = 'detector-format-dialog';
            dialog.style.cssText = 'max-width:440px;width:calc(100% - 48px);background:#202127;color:#eee;border:1px solid #9f58ef;border-radius:12px;padding:20px;';
            const heading = doc.createElement('h3'); heading.textContent = 'Detector: elige la calidad';
            const caption = doc.createElement('p'); caption.textContent = title || url;
            const select = doc.createElement('select'); select.className = 'detector-format-select'; select.style.cssText = 'width:100%;margin-bottom:14px;';
            const submit = doc.createElement('button'); submit.textContent = 'Descargar'; submit.className = 'action-btn'; submit.disabled = true;
            const cancel = doc.createElement('button'); cancel.textContent = 'Cancelar'; cancel.className = 'action-btn secondary';
            const finish = id => { dialog.remove(); resolve(id); };
            submit.addEventListener('click', () => { if (!select.disabled && select.value) finish(select.value); });
            cancel.addEventListener('click', () => finish(null));
            dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null); });
            select.addEventListener('change', () => { submit.disabled = select.disabled || !select.value; });
            dialog.append(heading, caption, select, submit, cancel); doc.body.append(dialog);
            if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
            loadFormats(select, url, pageUrl).then(ok => { submit.disabled = !ok; });
            // Retrying may turn the selector back into a usable state without a change event.
            const observer = new root.MutationObserver(() => { submit.disabled = select.disabled || !select.value; });
            observer.observe(select, { attributes: true, childList: true });
            const remove = dialog.remove.bind(dialog);
            dialog.remove = () => { observer.disconnect(); remove(); };
        });
        const result = dialogQueue.then(run, run);
        dialogQueue = result.catch(() => null);
        return result;
    }
    function sendDownload(payload, callback = () => {}) {
        readSettings(async settings => {
            const request = { ...payload, fixedQuality: settings.fixedQuality };
            if (request.formatSetting !== 'mp3' && request.qualitySetting === 'detect' && !request.customFormatId) {
                request.customFormatId = await chooseFormat(request.url, request.title, request.pageUrl || '');
                if (!request.customFormatId) { callback({ success: false, error: 'Seleccion de formato cancelada.' }); return; }
            }
            chrome.runtime.sendMessage(request, callback);
        });
    }
    function bindHistory(element, clearButton, dashboard = false) {
        if (!element) return;
        const doc = element.ownerDocument;
        if (clearButton) clearButton.addEventListener('click', () => {
            chrome.runtime.sendMessage({ action: 'clear_history' }, () => { void chrome.runtime.lastError; });
        });
        return watchLocal(['downloadHistory'], values => {
            element.replaceChildren();
            const history = values.downloadHistory || [];
            if (!history.length) {
                const empty = doc.createElement('p');
                empty.textContent = 'No hay descargas recientes.';
                element.appendChild(empty);
            }
            for (const item of history.slice().reverse()) {
                const card = doc.createElement('div');
                card.className = dashboard ? 'history-item-popup' : 'history-item';
                const title = doc.createElement('div');
                title.className = dashboard ? 'history-title-popup' : 'history-title';
                title.textContent = title.title = item.title || '';
                const date = doc.createElement('div');
                date.className = dashboard ? 'history-date-popup' : 'history-date';
                date.textContent = new Date(item.date).toLocaleString();
                const actions = doc.createElement('div');
                actions.className = dashboard ? 'history-actions-popup' : 'history-actions';
                const source = doc.createElement('button');
                source.className = 'action-btn secondary btn-small open-url-btn';
                source.textContent = 'Ver Origen';
                source.addEventListener('click', () => {
                    if (/^https?:\/\//i.test(item.url || '')) root.open(item.url, '_blank', 'noopener');
                });
                const folder = doc.createElement('button');
                folder.className = 'action-btn secondary btn-small open-folder-btn';
                folder.textContent = 'Abrir Ubicación';
                folder.addEventListener('click', () => chrome.runtime.sendMessage({ action: 'open_folder', file: item.final_file || '' }, () => { void chrome.runtime.lastError; }));
                actions.append(source, folder);
                card.append(title, date, actions);
                element.appendChild(card);
            }
        });
    }
    function watchTasks(callback) {
        let ready = false, pending = [], tasks = {};
        function apply(event, notify = true) {
            if (event.action === 'download_remove') delete tasks[event.id];
            else if (event.task) tasks[event.task.id] = event.task;
            if (notify) callback({ ...tasks }, event);
        }
        const listener = event => {
            if (!['download_update', 'download_remove'].includes(event.action)) return;
            if (!ready) pending.push(event);
            else apply(event);
        };
        chrome.runtime.onMessage.addListener(listener);
        chrome.runtime.sendMessage({ action: 'get_active_downloads' }, response => {
            if (chrome.runtime.lastError) return;
            tasks = { ...(response?.tasks || {}) };
            pending.forEach(event => apply(event, false));
            pending = [];
            ready = true;
            callback({ ...tasks }, null);
        });
        return () => chrome.runtime.onMessage.removeListener(listener);
    }
    function bindConsole(element) {
        if (!element) return;
        const doc = element.ownerDocument;
        const clear = doc.getElementById('clearConsoleBtn');
        const copy = doc.getElementById('copyConsoleBtn');
        const scroll = doc.getElementById('scrollBottomBtn');
        if (clear) clear.addEventListener('click', () => chrome.runtime.sendMessage({ action: 'clear_console_logs' }, () => { void chrome.runtime.lastError; }));
        if (copy) copy.addEventListener('click', () => root.navigator.clipboard.writeText(element.textContent).catch(console.error));
        if (scroll) scroll.addEventListener('click', () => { element.scrollTop = element.scrollHeight; });
        return watchConsole(logs => {
            const text = logs.map(item => `${item.title ? `[${item.title}] ` : ''}${item.log}`).join('\n');
            element.textContent = text;
            element.scrollTop = element.scrollHeight;
        });
    }
    root.AppState = { defaults, normalize, chooseEngine, readSettings, watchLocal, bindSettings, watchConsole, bindConsole, bindHistory, watchTasks, loadFormats, sendDownload };
})(globalThis);

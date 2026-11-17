const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const extension = path.join(__dirname, '..');
const source = name => fs.readFileSync(path.join(extension, 'js', name), 'utf8');
const clone = value => value === undefined ? undefined : structuredClone(value);
const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };
function event() {
    const listeners = new Set();
    return { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn), emit: (...args) => [...listeners].forEach(fn => fn(...args)) };
}
function createBus(initial = {}) {
    const clients = [], ports = [], timers = [], data = clone(initial), session = {};
    let writes = 0;
    const bus = {
        data, session, ports, timers, formatResponses: new Map(), scanResults: [], get writes() { return writes; },
        activeTab: { id: 1, url: 'https://example.com/video', title: 'Example video' },
        client() {
            const changes = event(), messages = event();
            function storageArea(area, values) {
                return {
                    get(keys, callback) {
                        const result = keys === null ? clone(values) : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(k => k in values).map(k => [k, clone(values[k])]));
                        queueMicrotask(() => callback(result));
                    },
                    set(patch, callback = () => {}) {
                        writes++;
                        const changed = {};
                        for (const [key, value] of Object.entries(patch)) {
                            if (JSON.stringify(values[key]) === JSON.stringify(value)) continue;
                            changed[key] = { oldValue: clone(values[key]), newValue: clone(value) };
                            values[key] = clone(value);
                        }
                        queueMicrotask(() => { if (Object.keys(changed).length) clients.forEach(c => c.storage.onChanged.emit(clone(changed), area)); callback(); });
                    }
                };
            }
            const client = {
                storage: { onChanged: changes, local: storageArea('local', data), session: storageArea('session', session) },
                runtime: { onMessage: messages, onInstalled: event(), lastError: undefined,
                    getURL: name => `chrome-extension://test/${name}`,
                    sendMessage(message, callback = () => {}) {
                        let answered = false, asynchronous = false;
                        const reply = response => { if (!answered) { answered = true; queueMicrotask(() => callback(clone(response))); } };
                        queueMicrotask(() => {
                            clients.filter(c => c !== client).forEach(c => {
                                // Only the worker handles commands; all pages receive notifications.
                                if (c.handler) asynchronous = c.handler(clone(message), {}, reply) === true || asynchronous;
                                c.runtime.onMessage.emit(clone(message), {}, reply);
                            });
                            if (!answered && !asynchronous) reply(undefined);
                        });
                    },
                    connectNative() {
                        const port = { onMessage: event(), onDisconnect: event(), posted: [],
                            postMessage(message) {
                                this.posted.push(clone(message));
                                if (message.command === 'get_info' && bus.formatResponses.has(message.url)) {
                                    queueMicrotask(() => this.onMessage.emit(clone(bus.formatResponses.get(message.url))));
                                }
                            },
                            disconnect() { this.onDisconnect.emit(); }
                        };
                        ports.push(port);
                        return port;
                    }
                },
                tabs: { query: (_, cb) => queueMicrotask(() => cb([clone(bus.activeTab)])), create() {}, onUpdated: event(), onRemoved: event() },
                webRequest: { onBeforeRequest: event(), onHeadersReceived: event() }, contextMenus: { create() {}, onClicked: event() },
                cookies: { getAll: (_, cb) => queueMicrotask(() => cb([])) },
                scripting: { executeScript: (_, cb) => queueMicrotask(() => cb?.(clone(bus.scanResults))) }
            };
            clients.push(client);
            return client;
        },
        worker() {
            const chrome = bus.client();
            chrome.runtime.onMessage.addListener = fn => { chrome.handler = fn; };
            const context = vm.createContext({ chrome, console, URL, setTimeout: fn => { timers.push(fn); }, clearTimeout() {} });
            context.importScripts = (...names) => names.forEach(name => vm.runInContext(source(name), context));
            vm.runInContext(source('background.js'), context);
            return context;
        },
        async page(name) {
            const errors = [];
            const dom = new JSDOM(fs.readFileSync(path.join(extension, `${name}.html`), 'utf8'), { runScripts: 'outside-only', url: `https://extension.test/${name}.html` });
            await new Promise(resolve => dom.window.addEventListener('load', resolve, { once: true }));
            dom.window.chrome = bus.client();
            dom.window.confirm = () => true;
            dom.window.alert = () => {};
            dom.window.addEventListener('error', e => errors.push(e.error));
            Object.defineProperty(dom.window.navigator, 'clipboard', { value: { writeText: async () => {}, readText: async () => '' } });
            dom.window.eval(source('state.js'));
            dom.window.eval(source(`${name}.js`));
            dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
            await flush();
            assert.deepEqual(errors, [], 'UI initialization must not throw');
            return dom;
        }
    };
    return bus;
}
function setRadio(dom, name, value) {
    const el = dom.window.document.querySelector(`input[name="${name}"][value="${value}"]`);
    assert.ok(el, `Missing ${name}=${value}`);
    el.checked = true;
    el.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
}
function setControl(dom, id, value, type = 'change') {
    const el = dom.window.document.getElementById(id);
    assert.ok(el, id);
    el.value = value;
    el.dispatchEvent(new dom.window.Event(type, { bubbles: true }));
}
const send = (client, message) => new Promise(resolve => client.runtime.sendMessage(message, resolve));
async function setup(initial = {}) {
    const bus = createBus(initial);
    const worker = bus.worker();
    const popup = await bus.page('popup'), tools = await bus.page('tools');
    return { bus, popup, tools, worker };
}

test('all common settings synchronize in both directions, without feedback writes', async t => {
    const { bus, popup, tools } = await setup();
    t.after(() => { popup.window.close(); tools.window.close(); });
    for (const [from, to] of [[popup, tools], [tools, popup]]) {
        for (const [name, value, key, stored] of [
            ['formatSetting', 'mp3', 'formatSetting', 'mp3'], ['formatSetting', 'mp4', 'formatSetting', 'mp4'],
            ['qualitySetting', 'min', 'qualitySetting', 'min'], ['engineSetting', 'native', 'engineSetting', 'native'],
            ['autoEngine', 'off', 'autoEngine', false], ['autoEngine', 'on', 'autoEngine', true],
            ['customModeSetting', 'on', 'customMode', true], ['customModeSetting', 'off', 'customMode', false],
            ['snifferSetting', 'off', 'snifferEnabled', false], ['snifferSetting', 'on', 'snifferEnabled', true],
            ['ytSubs', 'on', 'ytSubs', 'on'], ['ytSubs', 'off', 'ytSubs', 'off'],
            ['ytAudioLang', 'orig', 'ytAudioLang', 'orig'], ['videoFormatPref', 'calidad', 'videoFormatPref', 'calidad'],
            ['cookiesSetting', 'chrome', 'cookiesSetting', 'chrome']
        ]) {
            setRadio(from, name, value);
            await flush();
            assert.equal((key === 'ytSubs' ? bus.session : bus.data)[key], stored);
            assert.equal(to.window.document.querySelector(`input[name="${name}"]:checked`).value, value);
        }
        for (const [id, value, key, eventType] of [
            ['threadSlider', '12', 'threadCount', 'input'], ['concurrencySlider', '3', 'maxConcurrentDownloads', 'input'],
            ['audioFormatSelect', 'm4a', 'audioFormat', 'change'], ['audioQualitySelect', '128', 'audioQuality', 'change'],
            ['audioConvertSelect', 'none', 'audioConvert', 'change']
        ]) {
            const before = bus.writes;
            setControl(from, id, value, eventType);
            await flush();
            assert.equal(String(bus.data[key]), value);
            assert.equal(to.window.document.getElementById(id).value, value);
            assert.equal(bus.writes, before + 1, 'rendering must not write back');
        }
    }
});

test('batch naming, prefix, folder and dependent layout update across both pages', async t => {
    const { bus, popup, tools } = await setup();
    t.after(() => { popup.window.close(); tools.window.close(); });
    setControl(popup, 'popupBatchNamingSelect', 'custom');
    setControl(popup, 'popupBatchCustomPrefixInput', 'Mi colección', 'input');
    await flush();
    assert.equal(tools.window.document.getElementById('configBatchNamingSelect').value, 'custom');
    assert.equal(tools.window.document.getElementById('batchCustomPrefixInput').value, 'Mi colección');
    setControl(tools, 'batchCustomPrefixInput', 'Otra colección', 'input');
    await flush();
    assert.equal(popup.window.document.getElementById('popupBatchCustomPrefixInput').value, 'Otra colección');
    tools.window.chrome.storage.local.set({ customSavePath: 'D:\\Videos' });
    setRadio(tools, 'formatSetting', 'mp3');
    setRadio(tools, 'customModeSetting', 'on');
    await flush();
    for (const dom of [popup, tools]) {
        assert.equal(dom.window.document.getElementById('savePathDisplay').textContent, 'D:\\Videos');
        assert.equal(dom.window.document.getElementById('qualitySettingContainer').style.display, 'none');
    }
    assert.equal(popup.window.document.getElementById('manualCardContainer').style.display, 'block');
    assert.equal(bus.data.batchCustomPrefix, 'Otra colección');
});

test('history refreshes and clears in both pages; hostile titles remain text', async t => {
    const { bus, popup, tools } = await setup();
    t.after(() => { popup.window.close(); tools.window.close(); });
    popup.window.chrome.storage.local.set({ downloadHistory: [{ title: '<img src=x onerror=alert(1)>', url: 'https://example.com/video', date: new Date().toISOString() }] });
    await flush();
    for (const [dom, selector] of [[popup, '#downloadsList'], [tools, '#historyListDashboard']]) {
        assert.match(dom.window.document.querySelector(selector).textContent, /<img/);
        assert.equal(dom.window.document.querySelector(`${selector} img`), null);
    }
    tools.window.document.getElementById('clearHistoryBtnDashboard').click();
    await flush();
    assert.equal(bus.data.downloadHistory.length, 0);
    assert.equal(popup.window.document.querySelectorAll('.history-item').length, 0);
    assert.equal(tools.window.document.querySelectorAll('.history-item-popup').length, 0);
});

test('console messages appear once in both pages and clearing propagates', async t => {
    const { popup, tools } = await setup();
    t.after(() => { popup.window.close(); tools.window.close(); });
    await send(tools.window.chrome, { action: 'append_console_log', log: 'ONE UNIQUE LOG' });
    await flush();
    for (const [dom, id] of [[popup, 'debugConsole'], [tools, 'toolConsole']]) {
        assert.equal(dom.window.document.getElementById(id).textContent, 'ONE UNIQUE LOG');
    }
    popup.window.document.getElementById('clearConsoleBtn').click();
    await flush();
    assert.equal(tools.window.document.getElementById('toolConsole').textContent, '');
    assert.equal(popup.window.document.getElementById('debugConsole').textContent, '');
});

test('legacy local subtitle consent is ignored and legacy engine flags keep working', async t => {
    const { popup, tools } = await setup({ ytSubs: true, autoEngine: 'off', snifferEnabled: 'off' });
    t.after(() => { popup.window.close(); tools.window.close(); });
    for (const dom of [popup, tools]) {
        assert.equal(dom.window.document.querySelector('input[name="ytSubs"]:checked').value, 'off');
        assert.equal(dom.window.document.querySelector('input[name="autoEngine"]:checked').value, 'off');
        assert.equal(dom.window.document.getElementById('threadSlider').value, '4');
    }
});

test('simultaneous completions preserve history and share task progress/removal', async t => {
    const { bus, popup, tools } = await setup({ autoEngine: false, maxConcurrentDownloads: 2 });
    t.after(() => { popup.window.close(); tools.window.close(); });
    const a = await send(popup.window.chrome, { action: 'download', url: 'https://example.com/a.mp4', title: 'A', engineSetting: 'native', ytSubs: true });
    const b = await send(tools.window.chrome, { action: 'download', url: 'https://example.com/a.mp4', title: 'B', engineSetting: 'native' });
    await flush();
    assert.notEqual(a.id, b.id);
    assert.equal(bus.ports.length, 2);
    assert.equal(bus.ports[0].posted[0].ytSubs, 'on');
    bus.ports[0].onMessage.emit({ status: 'progress', percent: '42' });
    await flush();
    assert.ok(popup.window.document.querySelector(`[data-taskid="${a.id}"]`));
    assert.ok(popup.window.document.querySelector(`[data-taskid="${b.id}"]`));
    assert.equal(tools.window.document.querySelector(`#console_card_${a.id} .card-status-text`).innerText, '42');
    bus.ports.forEach((port, i) => port.onMessage.emit({ status: 'completed', final_file: `D:\\${i}.mp4` }));
    await flush();
    assert.equal(bus.data.downloadHistory.length, 2);
    await send(popup.window.chrome, { action: 'clear_task', id: a.id });
    await flush();
    assert.equal(tools.window.document.getElementById(`console_card_${a.id}`), null);
    assert.equal(popup.window.document.querySelector(`[data-taskid="${a.id}"]`), null);
});

test('settings changes arriving during the initial read override stale snapshots', () => {
    const bus = createBus(), chrome = bus.client();
    let read;
    chrome.storage.local.get = (_, callback) => { read = callback; };
    const context = vm.createContext({ chrome, console });
    vm.runInContext(source('state.js'), context);
    const seen = [];
    context.AppState.watchStorage(['formatSetting', 'batchCustomPrefix'], values => seen.push(values));
    chrome.storage.onChanged.emit({ formatSetting: { newValue: 'mp3' }, batchCustomPrefix: { newValue: 'Nuevo' } }, 'local');
    read({ formatSetting: 'mp4', batchCustomPrefix: 'Viejo' });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].formatSetting, 'mp3');
    assert.equal(seen[0].batchCustomPrefix, 'Nuevo');
});

test('console buffers initial events, discards duplicate snapshots and accepts a new worker epoch', () => {
    const bus = createBus(), chrome = bus.client();
    let read;
    chrome.runtime.sendMessage = (_, callback) => { read = callback; };
    const context = vm.createContext({ chrome, console });
    vm.runInContext(source('state.js'), context);
    const seen = [];
    context.AppState.watchConsole(logs => seen.push(logs.map(item => item.log)));
    const event1 = { action: 'download_log', revision: 1, epoch: 'worker1', entry: { log: 'A', sequence: 1 } };
    chrome.runtime.onMessage.emit(event1);
    chrome.runtime.onMessage.emit({ action: 'console_cleared', revision: 2, epoch: 'worker1' });
    chrome.runtime.onMessage.emit({ action: 'download_log', revision: 3, epoch: 'worker1', entry: { log: 'B', sequence: 3 } });
    read({ logs: [event1.entry], revision: 1, epoch: 'worker1' });
    assert.equal(JSON.stringify(seen.at(-1)), '["B"]');
    chrome.runtime.onMessage.emit({ action: 'download_log', revision: 1, epoch: 'worker2', entry: { log: 'C', sequence: 1 } });
    assert.equal(JSON.stringify(seen.at(-1)), '["C"]');
});

test('task removal during initial hydration cannot resurrect an old card', () => {
    const bus = createBus(), chrome = bus.client();
    let read;
    chrome.runtime.sendMessage = (_, callback) => { read = callback; };
    const context = vm.createContext({ chrome, console });
    vm.runInContext(source('state.js'), context);
    let tasks;
    context.AppState.watchTasks(values => { tasks = values; });
    chrome.runtime.onMessage.emit({ action: 'download_remove', id: 'old' });
    chrome.runtime.onMessage.emit({ action: 'download_update', task: { id: 'new', status: 'progress', percent: '20' } });
    read({ tasks: { old: { id: 'old', status: 'started' } } });
    assert.equal(tasks.old, undefined);
    assert.equal(tasks.new.percent, '20');
});

test('increasing concurrency fills all available slots and cancellation ignores late results', async t => {
    const { bus, popup, tools } = await setup({ autoEngine: false, maxConcurrentDownloads: 1 });
    t.after(() => { popup.window.close(); tools.window.close(); });
    const requests = [];
    for (let i = 0; i < 3; i++) requests.push(await send(popup.window.chrome, { action: 'download', title: `V${i}`, url: `https://example.com/${i}.mp4`, engineSetting: 'native' }));
    await flush();
    assert.equal(bus.ports.length, 1);
    setControl(tools, 'concurrencySlider', '3', 'input');
    await flush();
    assert.equal(bus.ports.length, 3);
    await send(tools.window.chrome, { action: 'cancel_download', id: requests[0].id });
    await flush();
    bus.ports[0].onMessage.emit({ status: 'completed', final_file: 'should-not-exist.mp4' });
    await flush();
    assert.equal(bus.data.downloadHistory, undefined);
    const tasks = await send(popup.window.chrome, { action: 'get_active_downloads' });
    assert.equal(tasks.tasks[requests[0].id].status, 'cancelled');
    assert.equal(popup.window.document.querySelector(`[data-taskid="${requests[0].id}"] .status-percent`).innerText, 'Cancelado');
    assert.equal(tools.window.document.querySelector(`#console_card_${requests[0].id} .card-status-text`).innerText, 'Cancelado');
});

test('reopening either page loads the same saved settings, history, console and active tasks', async t => {
    const { bus, popup, tools } = await setup({ autoEngine: false });
    t.after(() => { popup.window.close(); tools.window.close(); });
    setRadio(tools, 'ytSubs', 'on');
    await send(tools.window.chrome, { action: 'append_console_log', log: 'Persistent while worker is running' });
    const response = await send(popup.window.chrome, { action: 'download', url: 'https://example.com/new.mp4', title: 'NEW', engineSetting: 'native' });
    await flush();
    const reopened = await bus.page('popup');
    t.after(() => reopened.window.close());
    assert.equal(reopened.window.document.querySelector('input[name="ytSubs"]:checked').value, 'on');
    assert.match(reopened.window.document.getElementById('debugConsole').textContent, /Persistent while worker/);
    assert.ok(reopened.window.document.querySelector(`[data-taskid="${response.id}"]`));
});

test('the panel cancel button cancels the same task displayed in the popup', async t => {
    const { popup, tools } = await setup({ autoEngine: false });
    t.after(() => { popup.window.close(); tools.window.close(); });
    const response = await send(popup.window.chrome, { action: 'download', title: 'Cancel me', url: 'https://example.com/cancel.mp4', engineSetting: 'native' });
    await flush();
    tools.window.document.querySelector(`#console_card_${response.id} .cancel-task-btn`).click();
    await flush();
    assert.equal(popup.window.document.querySelector(`[data-taskid="${response.id}"] .status-percent`).innerText, 'Cancelado');
    assert.equal(tools.window.document.querySelector(`#console_card_${response.id} .cancel-task-btn`).hidden, true);
});

const detectorInfo = { success: true, status: 'info', info: { formats: [
    { format_id: 'low-real', height: 360, resolution: '640x360', ext: 'mp4', tbr: 500 },
    { format_id: 'high-real', height: 1080, resolution: '1920x1080', ext: 'mp4', tbr: 2500 },
    { format_id: 'low-real', height: 360, ext: 'mp4' }
] } };

test('fixed quality synchronizes, hides in audio mode and reaches the native host', async t => {
    const { bus, popup, tools } = await setup({ autoEngine: false });
    t.after(() => { popup.window.close(); tools.window.close(); });
    setRadio(popup, 'qualitySetting', 'fixed');
    setControl(popup, 'fixedQualitySelect', '720');
    await flush();
    assert.equal(tools.window.document.getElementById('fixedQualitySelect').value, '720');
    assert.equal(tools.window.document.getElementById('fixedQualityWrap').style.display, 'block');
    setControl(tools, 'fixedQualitySelect', '1080');
    await flush();
    assert.equal(popup.window.document.getElementById('fixedQualitySelect').value, '1080');
    const result = await send(tools.window.chrome, { action: 'download', url: 'https://example.com/fixed.mp4', qualitySetting: 'fixed', engineSetting: 'native' });
    await flush();
    assert.equal(result.success, true);
    assert.equal(bus.ports.at(-1).posted[0].engineSetting, 'ytdlp');
    assert.equal(bus.ports.at(-1).posted[0].fixedQuality, '1080');
    setRadio(tools, 'formatSetting', 'mp3');
    await flush();
    assert.equal(popup.window.document.getElementById('fixedQualityWrap').style.display, 'none');
});

test('switching an open popup to Detector loads real IDs and sends the selected ID', async t => {
    const { bus, popup, tools } = await setup({ autoEngine: false });
    t.after(() => { popup.window.close(); tools.window.close(); });
    bus.formatResponses.set('https://example.com/video', detectorInfo);
    setRadio(tools, 'qualitySetting', 'detect');
    await flush();
    const card = popup.window.document.querySelector('#cardsWrapper .detected-video-card:not([data-taskid])');
    const selector = card.querySelector('.detect-dropdown');
    assert.equal(selector.disabled, false);
    assert.equal(selector.options.length, 2);
    assert.equal(selector.value, 'high-real');
    assert.match(selector.options[0].textContent, /2500 kb\/s/);
    assert.doesNotMatch(selector.options[0].textContent, /MB\/s|KB\/s/);
    selector.value = 'low-real';
    const button = card.querySelector('.main-btn');
    button.innerText = 'Descargar';
    button.click();
    await flush();
    const download = bus.ports.flatMap(port => port.posted).find(message => message.command === 'download');
    assert.ok(download);
    assert.equal(download.customFormatId, 'low-real');
    assert.equal(download.qualitySetting, 'detect');
    assert.equal(download.engineSetting, 'ytdlp');
});

test('Detector errors can be retried without enabling an empty selection', async t => {
    const { bus, popup, tools } = await setup();
    t.after(() => { popup.window.close(); tools.window.close(); });
    bus.formatResponses.set('https://example.com/video', { status: 'error', error: 'No se pudo consultar el origen' });
    setRadio(tools, 'qualitySetting', 'detect');
    await flush();
    const selector = popup.window.document.querySelector('.detect-dropdown');
    assert.equal(selector.disabled, true);
    assert.match(selector.dataset.error, /consultar/);
    bus.formatResponses.set('https://example.com/video', detectorInfo);
    selector._retry.click();
    await flush();
    assert.equal(selector.disabled, false);
    assert.equal(selector.value, 'high-real');
});

test('panel Detector asks for a real format before queuing a manual link', async t => {
    const { bus, popup, tools } = await setup({ autoEngine: false });
    t.after(() => { popup.window.close(); tools.window.close(); });
    bus.formatResponses.set('https://example.com/dialog', detectorInfo);
    let response;
    tools.window.AppState.sendDownload({ action: 'download', qualitySetting: 'detect', url: 'https://example.com/dialog', title: 'Choose format', engineSetting: 'native' }, result => { response = result; });
    await flush();
    const dialog = tools.window.document.querySelector('.detector-format-dialog');
    assert.ok(dialog);
    assert.equal(bus.ports.flatMap(port => port.posted).filter(msg => msg.command === 'download').length, 0);
    dialog.querySelector('select').value = 'low-real';
    [...dialog.querySelectorAll('button')].find(button => button.textContent === 'Descargar').click();
    await flush();
    assert.equal(response.success, true);
    assert.equal(bus.ports.flatMap(port => port.posted).find(msg => msg.command === 'download').customFormatId, 'low-real');
});

test('background rejects Detector downloads without a selected format', async () => {
    const bus = createBus(); bus.worker(); await flush();
    const response = await send(bus.client(), { action: 'download', url: 'https://example.com/video', qualitySetting: 'detect' });
    assert.equal(response.success, false);
    assert.match(response.error, /selecciona/);
    assert.equal(bus.ports.length, 0);
});

test('format queries coalesce, ignore log frames, cache success and refresh on demand', async () => {
    const bus = createBus(); bus.worker(); await flush();
    const client = bus.client();
    const a = send(client, { action: 'get_info', url: 'https://example.com/query' });
    const b = send(client, { action: 'get_info', url: 'https://example.com/query' });
    await flush();
    assert.equal(bus.ports.length, 1);
    bus.ports[0].onMessage.emit({ status: 'log', log: 'Working' });
    bus.ports[0].onMessage.emit(detectorInfo);
    assert.equal((await a).success, true);
    assert.equal((await b).success, true);
    assert.equal((await send(client, { action: 'get_info', url: 'https://example.com/query' })).success, true);
    assert.equal(bus.ports.length, 1);
    const refreshed = send(client, { action: 'get_info', url: 'https://example.com/query', refresh: true });
    await flush();
    assert.equal(bus.ports.length, 2);
    bus.ports[1].onMessage.emit(detectorInfo);
    assert.equal((await refreshed).success, true);
});

test('passive tracker includes DASH and signed links across sites, excludes segments and respects Off', async t => {
    const { bus, popup, tools, worker } = await setup();
    t.after(() => { popup.window.close(); tools.window.close(); });
    await flush();
    const emit = event => worker.chrome.webRequest.onBeforeRequest.emit({ tabId: 4, type: 'xmlhttprequest', ...event });
    emit({ url: 'https://fbcdn.example/video.mp4?token=a&range=10' });
    emit({ url: 'https://tiktokcdn.example/master.m3u8?sig=abc' });
    emit({ url: 'https://media.example/manifest.mpd' });
    emit({ url: 'https://media.example/segment.m4s' });
    worker.chrome.webRequest.onHeadersReceived.emit({ tabId: 4, type: 'xmlhttprequest', url: 'https://media.example/opaque?id=123', responseHeaders: [{ name: 'Content-Type', value: 'video/mp4' }] });
    await flush();
    assert.equal(bus.data.sniffedUrls[4].length, 4);
    assert.ok(bus.data.sniffedUrls[4].includes('https://fbcdn.example/video.mp4?token=a&range=10'));
    setRadio(tools, 'snifferSetting', 'off');
    await flush();
    emit({ url: 'https://media.example/ignored.mp4' });
    await flush();
    assert.equal(bus.data.sniffedUrls[4], undefined);
});

test('stream scan really searches the page without reloading and merges iframe results', async t => {
    const { bus, popup, tools } = await setup();
    t.after(() => { popup.window.close(); tools.window.close(); });
    bus.scanResults = [
        { result: [{ url: 'https://media.example/master.m3u8?sig=ABC', kind: 'HLS' }] },
        { result: [{ url: 'https://media.example/master.m3u8?sig=ABC', kind: 'HLS' }, { url: 'https://media.example/main.mpd', kind: 'DASH' }] }
    ];
    popup.window.document.getElementById('forceDetectBtn').click();
    await flush();
    assert.equal(bus.data.sniffedUrls[1].length, 2);
    assert.match(popup.window.document.getElementById('forceDetectBtn').innerText, /2 enlaces/);
    assert.equal(popup.window.document.getElementById('forceDetectBtn').disabled, false);
});

test('injected scanner preserves signed URLs and relative sources and ignores fragments and blobs', () => {
    const dom = new JSDOM('<video src="/file.mp4?token=A&amp;range=10"></video><video src="blob:abc"></video><a href="/master.m3u8?sig=Z">Stream</a><script>var clip="https://cdn.example/movie.webm"</script>', { runScripts: 'outside-only', url: 'https://page.example/watch' });
    Object.defineProperty(dom.window.performance, 'getEntriesByType', { value: () => [{ name: 'https://cdn.example/manifest.mpd' }, { name: 'https://cdn.example/segment.m4s' }] });
    dom.window.eval(source('media-scan.js'));
    const all = dom.window.scanMediaPage('html').map(item => item.url);
    assert.ok(all.includes('https://page.example/file.mp4?token=A&range=10'));
    assert.ok(all.includes('https://cdn.example/movie.webm'));
    assert.equal(all.some(url => url.includes('blob:') || url.endsWith('.m4s')), false);
    const streams = dom.window.scanMediaPage('streams');
    assert.equal(streams.length, 2);
    dom.window.close();
});

test('disabling the tracker removes its stale source cards from the popup', async t => {
    const { bus, popup, tools, worker } = await setup();
    t.after(() => { popup.window.close(); tools.window.close(); });
    worker.chrome.webRequest.onBeforeRequest.emit({ tabId: 1, type: 'media', url: 'https://media.example/stream.mp4' });
    await flush();
    assert.ok([...popup.window.document.querySelectorAll('#cardsWrapper [data-url]')].some(card => card.getAttribute('data-url') === 'https://media.example/stream.mp4'));
    setRadio(tools, 'snifferSetting', 'off');
    await flush();
    assert.equal([...popup.window.document.querySelectorAll('#cardsWrapper [data-url]')].some(card => card.getAttribute('data-url') === 'https://media.example/stream.mp4'), false);
});

test('automatic engine selection accounts for query strings, audio, quality, cookies and manual mode', () => {
    const chrome = createBus().client();
    const context = vm.createContext({ chrome, console, URL });
    vm.runInContext(source('state.js'), context);
    const base = { ...context.AppState.defaults, ytAudioLang: 'auto' };
    for (const [request, automatic, expected] of [
        [{ url: 'https://cdn.example/movie.mp4?token=A' }, true, 'native'],
        [{ url: 'https://cdn.example/master.m3u8?token=A' }, true, 'nm3u8'],
        [{ url: 'https://cdn.example/main.mpd' }, true, 'nm3u8'],
        [{ url: 'https://site.example/watch?next=master.m3u8' }, true, 'ytdlp'],
        [{ url: 'https://site.example/watch' }, true, 'ytdlp'],
        [{ url: 'https://cdn.example/movie.mp4', formatSetting: 'mp3' }, true, 'ytdlp'],
        [{ url: 'https://cdn.example/master.m3u8', qualitySetting: 'fixed' }, true, 'ytdlp'],
        [{ url: 'https://cdn.example/movie.mp4', qualitySetting: 'detect' }, true, 'ytdlp'],
        [{ url: 'https://cdn.example/movie.mp4', cookiesSetting: 'chrome' }, true, 'ytdlp'],
        [{ url: 'https://cdn.example/movie.mp4', ytSubs: 'on' }, true, 'ytdlp'],
        [{ url: 'https://cdn.example/movie.mp4', engineSetting: 'aria2' }, false, 'aria2'],
        [{ url: 'https://cdn.example/movie.mp4', engineSetting: 'native', formatSetting: 'mp3' }, false, 'ytdlp'],
    ]) {
        const choice = context.AppState.chooseEngine({ ...base, ...request }, automatic);
        assert.equal(choice.engine, expected, JSON.stringify(request));
        assert.ok(choice.reason.length > 0);
    }
});

test('automatic audio download cannot use the direct-video motor and its reason is visible', async t => {
    const { bus, popup, tools } = await setup({ autoEngine: true });
    t.after(() => { popup.window.close(); tools.window.close(); });
    await send(popup.window.chrome, { action: 'download', url: 'https://cdn.example/movie.mp4', formatSetting: 'mp3' });
    await flush();
    assert.equal(bus.ports.at(-1).posted[0].engineSetting, 'ytdlp');
    assert.match(tools.window.document.getElementById('toolConsole').textContent, /procesamiento/);
});

test('site-neutral audio preferences synchronize and are forwarded unchanged', async t => {
    const { bus, popup, tools } = await setup({ autoEngine: false });
    t.after(() => { popup.window.close(); tools.window.close(); });
    for (const value of ['es', 'orig', 'auto']) {
        setRadio(tools, 'ytAudioLang', value);
        await flush();
        assert.equal(popup.window.document.querySelector('input[name="ytAudioLang"]:checked').value, value);
    }
    setRadio(popup, 'ytAudioLang', 'es');
    await flush();
    assert.equal(tools.window.document.querySelector('input[name="ytAudioLang"]:checked').value, 'es');
    await send(tools.window.chrome, { action: 'download', url: 'https://other-site.example/video.m3u8', engineSetting: 'nm3u8' });
    await flush();
    assert.equal(bus.ports.at(-1).posted[0].ytAudioLang, 'es');
    assert.equal(bus.ports.at(-1).posted[0].engineSetting, 'ytdlp');
    assert.equal(popup.window.document.body.textContent.includes('Exclusivo de YouTube'), false);
    assert.equal(tools.window.document.body.textContent.includes('Exclusivo de YouTube'), false);
});

test('subtitles require a new opt-in after restart, including upgrades with local on', async t => {
    const { bus, popup, tools, worker } = await setup({ ytSubs: 'on', autoEngine: false, maxConcurrentDownloads: 6 });
    t.after(() => { popup.window.close(); tools.window.close(); });
    const track = 'https://r2.googlevideo.com/videoplayback?itag=140';
    const watch = 'https://www.youtube.com/watch?v=Abc_123-xyz';
    function downloadByMenu() {
        worker.chrome.contextMenus.onClicked.emit(
            { menuItemId: 'download_video_link', srcUrl: track, pageUrl: watch }, { title: 'Clip', url: watch });
    }
    downloadByMenu();
    await flush();
    const first = bus.ports.at(-1).posted[0];
    assert.equal(first.ytSubs, 'off');
    assert.equal(first.ytAudioLang, 'es');
    assert.equal(first.url, watch);

    setRadio(popup, 'ytSubs', 'on');
    setRadio(tools, 'ytAudioLang', 'orig');
    await flush();
    const panel = tools.window.document;
    panel.getElementById('bulkUrlsInput').value = 'https://example.com/first\nhttps://example.com/second';
    panel.getElementById('startBulkDownloadBtn').click();
    downloadByMenu();
    await flush();
    const optedIn = bus.ports.slice(1).map(port => port.posted[0]);
    assert.equal(optedIn.length, 3);
    assert.ok(optedIn.every(item => item.ytSubs === 'on' && item.ytAudioLang === 'orig' && item.autoEngine === false));

    const restarted = await setup(bus.data);
    t.after(() => { restarted.popup.window.close(); restarted.tools.window.close(); });
    for (const dom of [restarted.popup, restarted.tools]) {
        assert.equal(dom.window.document.querySelector('input[name="ytSubs"]:checked').value, 'off');
        assert.equal(dom.window.document.querySelector('input[name="ytAudioLang"]:checked').value, 'orig');
    }
    await send(restarted.popup.window.chrome, { action: 'download', url: watch });
    await flush();
    assert.equal(restarted.bus.ports.at(-1).posted[0].ytSubs, 'off');
});

test('popup manual batches keep the subtitle choice made when the batch was started', async t => {
    const { bus, popup, tools } = await setup({ ytSubs: 'on', maxConcurrentDownloads: 5 });
    t.after(() => { popup.window.close(); tools.window.close(); });
    const page = popup.window.document;
    const button = page.getElementById('manualDownloadBtn');
    // Run both staggered download callbacks after changing the live setting.
    const staged = [];
    popup.window.setTimeout = (run, delay) => { if (delay < 1000) staged.push(run); };
    setRadio(tools, 'ytSubs', 'on');
    await flush();
    button.innerText = 'Descargar';
    page.getElementById('manualUrlInput').value = 'https://example.com/a\nhttps://example.com/b';
    button.click();
    await flush();
    setRadio(tools, 'ytSubs', 'off');
    await flush();
    staged.forEach(run => run());
    await flush();
    const downloads = bus.ports.flatMap(port => port.posted).filter(msg => msg.command === 'download');
    assert.equal(downloads.length, 2);
    assert.ok(downloads.every(item => item.ytSubs === 'on' && item.ytAudioLang === 'es'));
});

test('popup Detector offers the watch page formats for a detected YouTube track', async t => {
    const bus = createBus({ ytSubs: 'on', qualitySetting: 'detect' });
    const watch = 'https://www.youtube.com/watch?v=Abc_123-xyz';
    bus.activeTab.url = watch + '&t=15';
    const track = 'https://r2.googlevideo.com/videoplayback?itag=137';
    bus.data.sniffedUrls = { 1: [track, 'https://r3.googlevideo.com/videoplayback?itag=140'] };
    bus.formatResponses.set(watch, detectorInfo);
    bus.formatResponses.set(bus.activeTab.url, detectorInfo);
    bus.worker();
    const popup = await bus.page('popup');
    t.after(() => popup.window.close());
    const trackQueries = bus.ports.flatMap(port => port.posted).filter(msg => msg.command === 'get_info' && msg.url === watch);
    assert.equal(trackQueries.length, 1, 'coalesce the individual track requests for a video');
    const card = [...popup.window.document.querySelectorAll('[data-url]')].find(el => el.dataset.url === track);
    const select = card.querySelector('.detect-dropdown');
    assert.equal(select.disabled, false);
    select.value = 'low-real';
    const button = card.querySelector('.main-btn');
    button.innerText = 'Descargar';
    button.click();
    await flush();
    const download = bus.ports.flatMap(port => port.posted).find(msg => msg.command === 'download');
    assert.equal(download.url, watch);
    assert.equal(download.customFormatId, 'low-real');
    assert.equal(download.engineSetting, 'ytdlp');
    assert.equal(download.ytAudioLang, 'es');
    assert.equal(download.ytSubs, 'off');
});

test('canonical pages require a recognized video and a related media source', async t => {
    const { popup, tools } = await setup();
    t.after(() => { popup.window.close(); tools.window.close(); });
    const { mediaSourceUrl, playlistEntryUrl } = popup.window.AppState;
    const id = 'Abc_123-xyz';
    const watch = 'https://www.youtube.com/watch?v=' + id;
    const track = 'https://rr1.googlevideo.com/videoplayback?itag=140';
    for (const page of [watch, 'https://youtu.be/' + id, 'https://m.youtube.com/shorts/' + id, 'https://www.youtube.com/embed/' + id]) {
        assert.equal(mediaSourceUrl(track, page), watch);
    }
    assert.equal(mediaSourceUrl('blob:https://www.youtube.com/blob-id', watch), watch);
    for (const [media, page] of [
        [track, 'https://www.youtube.com/playlist?list=1'], [track, 'https://www.youtube.com/watch?v=bad'],
        [track, 'https://www.youtube.com.evil.example/watch?v=' + id], [track, 'https://x@yOuTuBe.com/watch?v=' + id],
        ['https://evilgooglevideo.com/videoplayback', watch], ['https://cdn.example/video.mp4', watch],
        ['https://rr1.googlevideo.com/unrelated', watch], ['blob:https://example.com/blob-id', watch],
        [track, 'https://example.com/page'], [track, undefined]
    ]) assert.equal(mediaSourceUrl(media, page), media);
    assert.equal(playlistEntryUrl({ id }, 'https://other.example/playlist'), null);
    assert.equal(playlistEntryUrl({ id, ie_key: 'Vimeo' }, watch), null);
    assert.equal(playlistEntryUrl({ id, ie_key: 'Youtube' }, watch), watch);
    assert.equal(playlistEntryUrl({ webpage_url: 'javascript:alert(1)', url: track }, watch), track);
});

test('each selected playlist entry uses its own page and current session subtitle preference', async t => {
    const { bus, popup, tools } = await setup({ maxConcurrentDownloads: 3 });
    t.after(() => { popup.window.close(); tools.window.close(); });
    const panel = tools.window.document;
    setRadio(popup, 'ytSubs', 'on');
    setRadio(tools, 'ytAudioLang', 'orig');
    panel.getElementById('playlistUrlInput').value = 'https://example.com/playlist';
    panel.getElementById('fetchPlaylistBtn').click();
    await flush();
    const first = 'https://www.youtube.com/watch?v=Abc_123-xyz';
    const second = 'https://example.org/video/2';
    bus.ports[0].onMessage.emit({ status: 'info', info: { entries: [
        { title: 'First', webpage_url: first, url: 'https://r2.googlevideo.com/videoplayback?itag=140' },
        { title: 'Second', webpage_url: second, url: 'https://cdn.example/stream.mp4' }
    ] } });
    await flush();
    panel.getElementById('downloadSelectedPlaylistBtn').click();
    await flush();
    const downloads = bus.ports.flatMap(port => port.posted).filter(msg => msg.command === 'download');
    assert.deepEqual(downloads.map(msg => msg.url).sort(), [first, second].sort());
    assert.ok(downloads.every(msg => msg.ytSubs === 'on' && msg.ytAudioLang === 'orig' && msg.engineSetting === 'ytdlp'));
});

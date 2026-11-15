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
    const clients = [], ports = [], timers = [], data = clone(initial);
    let writes = 0;
    const bus = {
        data, ports, timers, get writes() { return writes; },
        client() {
            const changes = event(), messages = event();
            const client = {
                storage: { onChanged: changes, local: {
                    get(keys, callback) {
                        const result = keys === null ? clone(data) : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(k => k in data).map(k => [k, clone(data[k])]));
                        queueMicrotask(() => callback(result));
                    },
                    set(patch, callback = () => {}) {
                        writes++;
                        const changed = {};
                        for (const [key, value] of Object.entries(patch)) {
                            if (JSON.stringify(data[key]) === JSON.stringify(value)) continue;
                            changed[key] = { oldValue: clone(data[key]), newValue: clone(value) };
                            data[key] = clone(value);
                        }
                        queueMicrotask(() => { if (Object.keys(changed).length) clients.forEach(c => c.storage.onChanged.emit(clone(changed), 'local')); callback(); });
                    }
                } },
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
                            postMessage(message) { this.posted.push(clone(message)); },
                            disconnect() { this.onDisconnect.emit(); }
                        };
                        ports.push(port);
                        return port;
                    }
                },
                tabs: { query: (_, cb) => queueMicrotask(() => cb([{ id: 1, url: 'https://example.com/video', title: 'Example video' }])), create() {}, onUpdated: event(), onRemoved: event() },
                webRequest: { onBeforeRequest: event() }, contextMenus: { create() {}, onClicked: event() },
                cookies: { getAll: (_, cb) => queueMicrotask(() => cb([])) },
                scripting: { executeScript: (_, cb) => queueMicrotask(() => cb?.([{ result: null }])) }
            };
            clients.push(client);
            return client;
        },
        worker() {
            const chrome = bus.client();
            chrome.runtime.onMessage.addListener = fn => { chrome.handler = fn; };
            const context = vm.createContext({ chrome, console, URL, setTimeout: fn => { timers.push(fn); }, clearTimeout() {} });
            context.importScripts = name => vm.runInContext(source(name), context);
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
    bus.worker();
    const popup = await bus.page('popup'), tools = await bus.page('tools');
    return { bus, popup, tools };
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
            assert.equal(bus.data[key], stored);
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

test('legacy booleans normalize and both pages reopen with identical defaults', async t => {
    const { popup, tools } = await setup({ ytSubs: true, autoEngine: 'off', snifferEnabled: 'off' });
    t.after(() => { popup.window.close(); tools.window.close(); });
    for (const dom of [popup, tools]) {
        assert.equal(dom.window.document.querySelector('input[name="ytSubs"]:checked').value, 'on');
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
    context.AppState.watchLocal(['formatSetting', 'batchCustomPrefix'], values => seen.push(values));
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

/* This function is injected as-is: keep all dependencies inside the function. */
function scanMediaPage(mode = 'html') {
    const results = new Map();
    function add(raw, source) {
        if (typeof raw !== 'string') return;
        try {
            const url = new URL(raw.replace(/&amp;/g, '&'), document.baseURI);
            if (!['http:', 'https:'].includes(url.protocol)) return;
            const pathname = url.pathname.toLowerCase();
            if (/\.(ts|m4s|vtt|jpg|jpeg|png|gif|webp|svg|css|js)$/.test(pathname)) return;
            const stream = /\.(m3u8|mpd)(?:$|\/)/.test(pathname) || pathname.includes('/m3u8/');
            const file = /\.(mp4|webm|mkv|mov|m4v)$/.test(pathname);
            if (mode === 'streams' ? !stream : !stream && !file && source !== 'video') return;
            results.set(url.href, { url: url.href, source, kind: stream ? (pathname.includes('.mpd') ? 'DASH' : 'HLS') : 'video' });
        } catch (_) {}
    }
    performance.getEntriesByType('resource').forEach(entry => add(entry.name, 'red'));
    document.querySelectorAll('video, video source').forEach(el => add(el.currentSrc || el.src || el.getAttribute('src'), 'video'));
    document.querySelectorAll('a[href]').forEach(el => add(el.href, 'enlace'));
    const html = document.documentElement.innerHTML.replace(/\\\//g, '/').replace(/\\u0026/gi, '&').replace(/\\u003d/gi, '=');
    (html.match(/https?:\/\/[^"'\s<>\[\]\\{}]+/gi) || []).forEach(url => add(url, 'HTML'));
    return [...results.values()].slice(0, 100);
}

/* Offline shell: the app opens without a network; only model calls need one. */
const CACHE = 'aushadhi-v1';
const SHELL = ['./', './index.html', './styles.css', './app.js', './manifest.webmanifest'];

self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys()
            .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (e) => {
    const { request } = e;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    /* Never cache model APIs. */
    if (/api\.groq\.com|openrouter\.ai/.test(url.hostname)) return;

    /* CDN assets (pdf.js, fonts): cache-first, they are versioned. */
    if (url.origin !== location.origin) {
        e.respondWith(
            caches.match(request).then((hit) => hit || fetch(request).then((res) => {
                if (res.ok) { const c = res.clone(); caches.open(CACHE).then((k) => k.put(request, c)); }
                return res;
            }).catch(() => hit))
        );
        return;
    }

    /* Own files: network-first so updates land, cache as fallback. */
    e.respondWith(
        fetch(request).then((res) => {
            if (res.ok) { const c = res.clone(); caches.open(CACHE).then((k) => k.put(request, c)); }
            return res;
        }).catch(() => caches.match(request).then((hit) => hit || caches.match('./index.html')))
    );
});

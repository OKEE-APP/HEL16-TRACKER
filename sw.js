/* HEL16 Site Tracker offline layer.
   Keeps the app, its libraries and fonts on the phone so it opens with no signal.
   Site data is cached separately by Firestore; this file never touches it. */
const VERSION = 'hel16-2026-10-21-1';
const SHELL = ['./', 'index.html', 'progress.html', 'app.js', 'firebase-shim.js', 'config.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-180.png'];
const FB = 'https://www.gstatic.com/firebasejs/10.14.1/';
const CDN = [FB + 'firebase-app.js', FB + 'firebase-auth.js', FB + 'firebase-firestore.js', FB + 'firebase-storage.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js',
  'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=IBM+Plex+Mono:wght@500&family=IBM+Plex+Sans:wght@400;500;600&display=swap'];
const RUNTIME = 'hel16-runtime';   // CDN files, fonts and photos; kept across app updates
const CACHED_HOSTS = ['www.gstatic.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com', 'firebasestorage.googleapis.com'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })));
    const r = await caches.open(RUNTIME);
    await Promise.all(CDN.map(async u => { try { const res = await fetch(u, { mode: 'cors' }); if (res.ok) await r.put(u, res); } catch (x) {} }));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION && k !== RUNTIME) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.endsWith('/sw.js')) return;
    // the app itself: from the phone first, so it opens instantly with or without signal
    e.respondWith((async () => {
      const c = await caches.open(VERSION);
      const key = req.mode === 'navigate' ? (url.pathname.endsWith('/progress.html') ? 'progress.html' : 'index.html') : req;
      const hit = await c.match(key, { ignoreSearch: req.mode === 'navigate' });
      if (hit) return hit;
      try { return await fetch(req); } catch (x) { return (await c.match('index.html')) || Response.error(); }
    })());
    return;
  }
  if (CACHED_HOSTS.includes(url.hostname)) {
    // libraries, fonts and saved photos: keep a copy once seen
    e.respondWith((async () => {
      const r = await caches.open(RUNTIME);
      const hit = await r.match(req);
      if (hit) return hit;
      try { const res = await fetch(req); if (res.ok || res.type === 'opaque') r.put(req, res.clone()).catch(() => {}); return res; }
      catch (x) { return Response.error(); }
    })());
  }
  // everything else (Firestore, sign-in) goes straight to the network
});

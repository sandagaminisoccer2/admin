/* Service Worker — Sandaga Minisoccer
   Tujuan: aplikasi cepat dibuka & tetap hidup saat sinyal lemah/offline.
   Data Firebase TIDAK disentuh di sini (itu ditangani IndexedDB + Firebase di dalam aplikasi).
   >>> Setiap kali upload versi baru index.html ke GitHub, naikkan angka VERSION di bawah. <<< */
const VERSION = 'v4';
const SHELL = 'sandaga-shell-' + VERSION;
const LIBS = 'sandaga-libs-' + VERSION;
const SHELL_FILES = ['./', 'index.html', 'manifest.json', 'ikon.png'];
const NAV_TIMEOUT = 3500;   // jaringan lebih lambat dari ini → pakai salinan perangkat

const LIB_HOSTS = ['cdn.tailwindcss.com', 'cdn.jsdelivr.net', 'www.gstatic.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await Promise.all(SHELL_FILES.map((f) => c.add(f).catch(() => {})));   // file yang tidak ada dilewati
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keep = [SHELL, LIBS];
    for (const k of await caches.keys()) if (k.startsWith('sandaga-') && !keep.includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

const okToCache = (r) => r && (r.ok || r.type === 'opaque');

async function networkFirst(req) {
  const cache = await caches.open(SHELL);
  const cached = (await cache.match(req, { ignoreSearch: true })) ||
                 (await cache.match(new URL('index.html', self.registration.scope).href));
  const net = fetch(req).then((res) => { if (okToCache(res)) cache.put(req, res.clone()); return res; });
  if (!cached) return net;
  try {
    const res = await Promise.race([net, new Promise((r) => setTimeout(() => r(null), NAV_TIMEOUT))]);
    if (res) return res;
  } catch (_) { /* offline → salinan */ }
  net.catch(() => {});          // biarkan unduhan lanjut di latar untuk memperbarui salinan
  return cached;
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req, { ignoreSearch: cacheName === SHELL });
  const net = fetch(req).then((res) => { if (okToCache(res)) cache.put(req, res.clone()); return res; });
  if (cached) { net.catch(() => {}); return cached; }
  return net;
}

async function cacheFirst(req) {
  const cache = await caches.open(LIBS);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (okToCache(res)) cache.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.endsWith('/sw.js')) return;
    if (req.mode === 'navigate' || /\.html?$/.test(url.pathname)) { e.respondWith(networkFirst(req)); return; }
    e.respondWith(staleWhileRevalidate(req, SHELL));
    return;
  }
  if (LIB_HOSTS.includes(url.hostname)) {
    // versi terkunci (jsdelivr @x.y.z, firebasejs/9.22.0) → cache-first; sisanya (tailwind, font) → stale-while-revalidate
    const pinned = url.hostname === 'cdn.jsdelivr.net' || url.pathname.includes('/firebasejs/') || url.hostname === 'fonts.gstatic.com';
    if (url.hostname === 'www.gstatic.com' && !url.pathname.includes('/firebasejs/')) return;
    e.respondWith(pinned ? cacheFirst(req) : staleWhileRevalidate(req, LIBS));
  }
  // semua yang lain (Firebase database, dsb.) → tidak disentuh
});

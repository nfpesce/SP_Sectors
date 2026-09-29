const CACHE_NAME = 'spsectors-v3';
const SHELL_FILES = [
  './',
  './index.html',
  './style.css',
  './treemap.js',
  './app.js',
  './manifest.json',
  './sectors.json',
  './icons/icon-192.svg',
  './icons/icon-512.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache API calls
  if (url.hostname === 'finnhub.io' || url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Prefer the latest committed weights, but keep the last cached copy for outages/offline use.
  if (url.pathname.endsWith('/sectors.json')) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then(async (response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const copy = response.clone();
          const cache = await caches.open(CACHE_NAME);
          await cache.put(event.request, copy);
          return response;
        })
        .catch(async () => (await caches.match(event.request)) || Response.error())
    );
    return;
  }

  // Cache-first for app shell
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

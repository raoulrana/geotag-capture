/* App-shell cache. Network-first so the latest code always loads when online,
   falling back to cache offline. Map tiles & geocoding stay network-only. */
const CACHE = 'geotag-capture-v8';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './olc.js',
  './exif.js',
  './manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Never cache tiles or geocoding responses.
  if (url.hostname.includes('tile.openstreetmap.org') ||
      url.hostname.includes('nominatim.openstreetmap.org')) {
    return;
  }
  // Network-first for the app shell: always prefer fresh code, refresh the
  // cache, and fall back to the cached copy only when offline.
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          // Only cache successful, complete GET responses — never errors or
          // 206 partials (cache.put throws on partials and 404s poison offline).
          if (e.request.method === 'GET' && res.ok && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(e.request))
    );
  }
});

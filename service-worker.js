// Minimal service worker: caches the static app shell so the game installs
// as a PWA. Game data itself always goes over the network (socket.io),
// this never caches or interferes with live gameplay traffic.
const CACHE_NAME = 'doodle-duel-shell-v1';
const SHELL_FILES = [
  '/', '/index.html', '/style.css', '/client.js',
  '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Never intercept socket.io or API traffic — only the static shell files.
  if (url.pathname.startsWith('/socket.io/') || url.pathname.startsWith('/api/')) return;
  if (!SHELL_FILES.includes(url.pathname)) return;

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});

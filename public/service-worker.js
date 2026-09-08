// Minimal service worker — just enough to satisfy PWA installability requirements.
// It caches nothing aggressively (your app is mostly dynamic/live data anyway),
// but having a registered service worker is one of the checks PWABuilder and
// Android's install criteria look for.

const CACHE_NAME = 'studyai-shell-v1';
const SHELL_FILES = ['/', '/favicon-192.png', '/favicon-512.png'];

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

// Network-first: always try the real network (since this app is live/dynamic),
// only falling back to cache if the user is genuinely offline.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

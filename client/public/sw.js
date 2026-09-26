// ── Zoclo shell service worker ────────────────────────────────────────────
// Purpose #1: PWA installability. Chrome only fires `beforeinstallprompt`
// (the one-click native install dialog) when a service worker with a fetch
// handler controls the page. No SW = no native prompt = "how to install"
// instructions instead of a real install. This file is that requirement.
// v6: main.tsx now registers the SW at module eval (was window.load) so the
// SW is ACTIVE before Chrome checks install criteria — that's what makes
// Android mint a WebAPK (clean icon) instead of a badge-carrying shortcut.
// v7: stop precaching `/` + `/index.html`. Those are navigations — they go
// stale the instant Vercel deploys, and serving the precached copy (even
// only offline) is what reopened the "previous wrong build" inside the
// installed app. Precache only versioned/static files (manifest + icons);
// navigations stay NETWORK-FIRST with no stale precache to fall back to.
//
// Strategy: NETWORK-FIRST for everything, cache only as the offline
// fallback. We deliberately never serve from cache while online, so users
// always get the newest build the moment Vercel deploys (the app's own
// dead-chunk reload logic keeps working exactly as before).
const SHELL = 'zoclo-shell-v7';

const PRECACHE = [
  '/manifest.json',
  '/icons/zoclo-icon.png',
  '/icons/zoclo-icon-192.png',
  '/icons/zoclo-icon-maskable.png',
  '/icons/zoclo-icon-maskable-192.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function cacheable(response) {
  return response && response.ok && (response.type === 'basic' || response.type === 'default');
}

self.addEventListener('fetch', (event) => {
  // Never touch non-GET or cross-origin traffic (API, Google, CDN).
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations (/, /login, …): network first so the installed app always
  // opens the newest deploy. Offline → whatever navigation we cached during
  // a previous online visit (never a stale install-time precache).
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (cacheable(response)) {
            const copy = response.clone();
            caches.open(SHELL).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then((hit) => hit || caches.match('/index.html')))
    );
    return;
  }

  // Static assets: network first, refresh the cache opportunistically,
  // fall back to cache only when the network fails (offline).
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (cacheable(response)) {
          const copy = response.clone();
          caches.open(SHELL).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

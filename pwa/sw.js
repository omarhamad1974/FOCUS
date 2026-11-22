/*
 * Pingo service worker. vite.config.ts fills in VERSION and PRECACHE at build
 * time, so each deploy ships a new worker that replaces the old cache.
 *
 * - Pages (the app shell): network first, cached copy when offline or the
 *   network is slow, so a new deploy shows up on the next open.
 * - Hashed build files (assets/): cache first, they never change.
 * - Other site files (logo, icons, demo photos) and Google Fonts: served from
 *   cache at once and refreshed in the background.
 * - Everything else, Supabase above all (data, sign-in, uploads, photos), is
 *   never touched: it always goes straight to the network.
 */
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const SHELL = `pingo-shell-${VERSION}`;
const FILES = 'pingo-files';
const FONTS = 'pingo-fonts';
const SCOPE = new URL(self.registration.scope);
const INDEX = new URL('./', SCOPE).href;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await cache.addAll(PRECACHE.map((u) => new Request(new URL(u, SCOPE), { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = [SHELL, FILES, FONTS];
    for (const key of await caches.keys()) {
      if (key.startsWith('pingo-') && !keep.includes(key)) await caches.delete(key);
    }
    // Build files from older deploys are never asked for again.
    const files = await caches.open(FILES);
    for (const req of await files.keys()) {
      if (new URL(req.url).pathname.includes('/assets/')) await files.delete(req);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

/** Fresh copy when the network answers within `wait` ms, else the cached one. */
async function networkFirst(request, cacheKey, wait) {
  const cache = await caches.open(SHELL);
  const fresh = fetch(request).then((res) => {
    if (res.ok) cache.put(cacheKey, res.clone());
    return res;
  });
  fresh.catch(() => {});
  const cached = await cache.match(cacheKey);
  if (!cached) return fresh;
  const timeout = new Promise((done) => setTimeout(() => done(cached), wait));
  try {
    return await Promise.race([fresh, timeout]);
  } catch {
    return cached;
  }
}

async function cacheFirst(request) {
  const hit = await caches.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) (await caches.open(FILES)).put(request, res.clone());
  return res;
}

async function staleWhileRevalidate(request, name) {
  const cache = await caches.open(name);
  const hit = await caches.match(request);
  const fresh = fetch(request).then((res) => {
    if (res.ok || res.type === 'opaque') cache.put(request, res.clone());
    return res;
  }).catch(() => hit);
  return hit || fresh;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(req, FONTS));
    return;
  }
  // Supabase and any other outside service: not ours, never cached.
  if (url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return;
  if (url.pathname.endsWith('/sw.js')) return;

  if (req.mode === 'navigate' && (url.pathname === SCOPE.pathname || url.pathname.endsWith('/index.html'))) {
    // Hash routes all load the same page, so one cached copy serves every screen.
    event.respondWith(networkFirst(req, INDEX, 3500).catch(() => caches.match(INDEX)));
    return;
  }
  if (url.pathname.includes('/assets/')) {
    event.respondWith(cacheFirst(req));
    return;
  }
  event.respondWith(staleWhileRevalidate(req, FILES));
});

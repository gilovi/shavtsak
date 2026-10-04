// Makes the app open instantly and offline. The build's files (hashed names under assets/) never change, so
// they come from the cache; the page itself comes from the network when it answers quickly, else from the
// cache. The sheet itself (docs.google.com) is not handled here.
const CACHE = 'shavtsak-app';
const PAGE_TIMEOUT_MS = 3000;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(request.mode === 'navigate' ? page(request) : file(request));
});

async function page(request) {
  const cache = await caches.open(CACHE);
  const network = fetch(request).then(async (response) => {
    if (response.ok) {
      await cache.put(request, response.clone());
      await prune(cache, await response.clone().text());
    }
    return response;
  });
  const timeout = new Promise((resolve) => setTimeout(resolve, PAGE_TIMEOUT_MS));
  const quick = await Promise.race([network.catch(() => undefined), timeout]);
  if (quick) return quick;
  return (await cache.match(request, { ignoreSearch: true })) ?? network;
}

async function file(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

/** Drops the files of older builds: hashed assets the current page no longer refers to. */
async function prune(cache, html) {
  for (const request of await cache.keys()) {
    const { pathname } = new URL(request.url);
    const name = pathname.split('/').pop();
    if (pathname.includes('/assets/') && !html.includes(name)) await cache.delete(request);
  }
}

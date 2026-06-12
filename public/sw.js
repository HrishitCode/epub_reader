// Minimal service worker: cache-first for Next's immutable static assets,
// network for everything else. Enough for fast repeat loads + installability;
// full offline reading (caching epub files) is a future iteration.
const CACHE = "reader-static-v1"

self.addEventListener("install", () => self.skipWaiting())

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url)
  const isStatic = url.origin === self.location.origin && url.pathname.startsWith("/_next/static/")
  if (event.request.method !== "GET" || !isStatic) return // fall through to network

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(event.request)
      if (cached) return cached
      const res = await fetch(event.request)
      if (res.ok) cache.put(event.request, res.clone())
      return res
    })
  )
})

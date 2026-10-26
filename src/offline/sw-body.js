// The service worker of the site, which lets it open without a connection. The build puts the constants VERSION (what the
// files are, so a new build is a new version), FILES (every file of the site, as an address) and LATER (those of them that
// are kept only once they have been used, since most visitors never use them) in front of this.
// The files are kept in a cache of their own for each version. A new version waits until the person asks for it, or until
// every tab of the old one is closed, so that a tab that is open never finds that the files it still needs are gone.

const PREFIX = 'justinvideo-'
const CACHE = PREFIX + VERSION
// A page that the network takes longer than this to give is shown from the cache, if there is a copy.
const PATIENCE_MS = 3000

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES.filter((address) => !LATER.includes(address)))))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith(PREFIX) && name !== CACHE) await caches.delete(name)
      }
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'skip-waiting') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  event.respondWith(request.mode === 'navigate' ? page(request, url) : file(request, url))
})

/** A page: from the network when it answers, so that a new release is found, and from the cache when it does not. */
async function page(request, url) {
  const cache = await caches.open(CACHE)
  const copy = () => cache.match(url.pathname, { ignoreSearch: true }).then((hit) => hit || cache.match('/'))
  const fromNetwork = fetch(request).then((response) => {
    if (response.ok && FILES.includes(url.pathname)) void cache.put(url.pathname, response.clone())
    return response
  })
  try {
    return await Promise.race([
      fromNetwork,
      new Promise((resolve, reject) => setTimeout(() => copy().then((hit) => (hit ? resolve(hit) : reject(new Error('No copy yet')))), PATIENCE_MS)),
    ])
  } catch {
    const hit = await copy()
    return hit || fromNetwork
  }
}

/** Any other file: from the cache, where the files of the site were put when it was installed, and else from the network. */
async function file(request, url) {
  const cache = await caches.open(CACHE)
  const hit = await cache.match(url.pathname)
  if (hit) return hit
  const response = await fetch(request)
  if (response.ok && FILES.includes(url.pathname)) void cache.put(url.pathname, response.clone())
  return response
}

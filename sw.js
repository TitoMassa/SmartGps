const CACHE_NAME = 'smart-move-pro-cache-v1';
const APP_SHELL_URLS = [
  'index.html',
  // No need for separate css/js/app.js as they are embedded
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  'icons/icon-192x192.png',
  'icons/icon-512x512.png',
  'icons/maskable-icon.png'
  // Add other Leaflet assets if you notice them being requested and not working offline
];

self.addEventListener('install', (event) => {
  console.log('[SW] Install event');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching App Shell');
        return cache.addAll(APP_SHELL_URLS);
      })
      .catch(error => {
        console.error('[SW] Failed to cache app shell:', error);
      })
  );
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activate event');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  return self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Cache First for app shell resources
  if (APP_SHELL_URLS.some(url => event.request.url.endsWith(url) || event.request.url === new URL(url, self.location.origin).href)) {
    event.respondWith(
      caches.match(event.request)
        .then((response) => {
          if (response) {
            // console.log(`[SW] Serving from cache: ${event.request.url}`);
            return response;
          }
          // console.log(`[SW] Fetching from network: ${event.request.url}`);
          return fetch(event.request).then(networkResponse => {
            // Optionally, cache newly fetched app shell resources if they weren't in APP_SHELL_URLS initially
            // but match a pattern. For now, we only cache what's explicitly listed.
            return networkResponse;
          });
        })
        .catch(error => {
            console.error(`[SW] Error fetching ${event.request.url}:`, error);
            // You could return a fallback page here if appropriate
        })
    );
  } else {
    // For other requests (e.g., API calls, non-cached assets), go network first
    // console.log(`[SW] Network request (not in app shell): ${event.request.url}`);
    event.respondWith(
        fetch(event.request).catch(() => {
            // Minimal offline fallback for non-app shell items if needed
            // e.g., return new Response("Network error occurred", { status: 503, statusText: "Service Unavailable" });
        })
    );
  }
});

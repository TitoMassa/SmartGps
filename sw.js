// sw.js
const CACHE_NAME = 'smartmove-pro-cache-v2'; // Incrementa versión si cambias algo
const APP_SHELL_URLS = [
  'index.html',
  'css/style.css',
  'js/app.js',
  'manifest.json',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  // Si tienes imágenes de marcadores de Leaflet locales, añádelas también
  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  'icons/icon-192x192.png',
  'icons/icon-512x512.png'
];

self.addEventListener('install', (event) => {
  console.log('[SW] Install event');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching App Shell');
        // Usamos {cache: 'reload'} para asegurar que siempre buscamos la última versión
        // de estos archivos durante la instalación, especialmente para Leaflet CDN.
        const requests = APP_SHELL_URLS.map(url => new Request(url, {cache: 'reload'}));
        return cache.addAll(requests);
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
  return self.clients.claim(); // Permite al SW activado tomar control inmediatamente
});

self.addEventListener('fetch', (event) => {
  // Cache First para los recursos de la App Shell
  if (APP_SHELL_URLS.some(url => event.request.url.endsWith(new URL(url, self.location.origin).pathname))) {
      event.respondWith(
          caches.match(event.request).then((cachedResponse) => {
              if (cachedResponse) {
                  // console.log('[SW] Serving from cache:', event.request.url);
                  return cachedResponse;
              }
              // console.log('[SW] Fetching from network (and caching for app shell):', event.request.url);
              return fetch(event.request).then(networkResponse => {
                  return caches.open(CACHE_NAME).then(cache => {
                      // No es estrictamente necesario volver a cachear aquí si ya se hizo en install,
                      // pero podría ser útil si algo falló o para actualizaciones dinámicas.
                      // cache.put(event.request, networkResponse.clone()); // Opcional
                      return networkResponse;
                  });
              });
          })
      );
  } else {
      // Network first (o cache then network) para otros recursos (ej. tiles del mapa, APIs)
      event.respondWith(
          fetch(event.request)
              .then(networkResponse => {
                  // Opcional: cachear tiles del mapa si se desea, pero puede llenar la caché rápido.
                  // if (event.request.url.includes('tile.openstreetmap.org')) {
                  //   return caches.open(TILE_CACHE_NAME).then(cache => {
                  //     cache.put(event.request, networkResponse.clone());
                  //     return networkResponse;
                  //   });
                  // }
                  return networkResponse;
              })
              .catch(() => {
                  // Si la red falla, intentar servir desde caché si existe (para assets no-shell)
                  return caches.match(event.request).then(cachedResponse => {
                      if (cachedResponse) return cachedResponse;
                      // Aquí podrías retornar una página de offline genérica si lo deseas.
                      // console.warn('[SW] Network request failed, no cache match for:', event.request.url);
                  });
              })
      );
  }
});

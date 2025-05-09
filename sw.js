const CACHE_NAME = 'smart-move-pro-cache-v1';
const urlsToCache = [
  '/smart-move-pro/',
  '/smart-move-pro/index.html',
  '/smart-move-pro/css/style.css',
  '/smart-move-pro/js/app.js',
  '/smart-move-pro/icons/icon-192x192.png',
  '/smart-move-pro/icons/icon-512x512.png',
  // Asumiendo Leaflet local. Si usas CDN, no necesitas cachearlos aquí explícitamente
  // o podrías cachear las URLs del CDN si quieres control total.
  // Por simplicidad, asumimos que están en una carpeta 'leaflet' al mismo nivel que 'smart-move-pro'
  // o que se usa un CDN y no se cachean aquí.
  // Si están locales:
  // '../leaflet/leaflet.css',
  // '../leaflet/leaflet.js',
  // '../leaflet/images/marker-icon.png',
  // '../leaflet/images/marker-shadow.png'
  // Si usas CDN para Leaflet, no es estrictamente necesario cachearlos aquí,
  // pero podrías si quieres que funcione offline después de la primera carga.
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response; // Cache hit - return response
        }
        return fetch(event.request).then(
          networkResponse => {
            // Check if we received a valid response
            if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic' && networkResponse.type !== 'cors') {
              return networkResponse;
            }

            // IMPORTANT: Clone the response. A response is a stream
            // and because we want the browser to consume the response
            // as well as the cache consuming the response, we need
            // to clone it so we have two streams.
            const responseToCache = networkResponse.clone();

            // No cacheamos peticiones de extensión de chrome
            if (event.request.url.startsWith('chrome-extension://')) {
                return networkResponse;
            }
            
            // Solo cachear GET requests
            if (event.request.method === 'GET' && urlsToCache.includes(new URL(event.request.url).pathname) || 
                (event.request.url.startsWith('https://unpkg.com/leaflet') && urlsToCache.some(u => event.request.url.startsWith(u.substring(0, u.lastIndexOf('/')))))
            ) {
                caches.open(CACHE_NAME)
                  .then(cache => {
                    cache.put(event.request, responseToCache);
                  });
            }
            return networkResponse;
          }
        );
      })
  );
});

self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

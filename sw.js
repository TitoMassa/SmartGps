const CACHE_NAME = 'smartmovepro-cache-v2'; // Mantener o incrementar versión
const urlsToCache = [
    './', // Raíz, usualmente sirve index.html
    './index.html',
    './css/style.css',
    './js/app.js',
    './manifest.json',
    // URLs de Leaflet
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    // Íconos PWA
    './icons/icon-192x192.png',
    './icons/icon-512x512.png',
    './icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('SmartMovePro SW: Opened cache and caching: ', urlsToCache);
                return cache.addAll(urlsToCache)
                    .catch(error => {
                        console.error('SmartMovePro SW: Failed to cache one or more resources during install: ', error, event.request ? event.request.url : '');
                    });
            })
    );
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    const cacheWhitelist = [CACHE_NAME];
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheWhitelist.indexOf(cacheName) === -1) {
                        console.log('SmartMovePro SW: Deleting old cache: ', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    return self.clients.claim();
});

self.addEventListener('fetch', event => {
    // Ignorar peticiones que no son GET (ej. POST a una API, etc.)
    if (event.request.method !== 'GET') {
        return;
    }

    event.respondWith(
        caches.match(event.request)
            .then(response => {
                if (response) {
                    return response; // Servir desde caché
                }
                // No está en caché, ir a la red
                return fetch(event.request).then(
                    networkResponse => {
                        if (networkResponse && networkResponse.status === 200 &&
                            (event.request.url.startsWith('http'))) { // Solo cachear peticiones http/https válidas

                            // No cachear tiles de OpenStreetMap dinámicamente por defecto.
                            if (event.request.url.includes('tile.openstreetmap.org')) {
                                return networkResponse;
                            }

                            const responseToCache = networkResponse.clone();
                            caches.open(CACHE_NAME)
                                .then(cache => {
                                    cache.put(event.request, responseToCache);
                                });
                        }
                        return networkResponse;
                    }
                ).catch(error => {
                    console.warn('SmartMovePro SW: Fetch failed for:', event.request.url, error);
                    // Opcional: Podrías devolver una página offline genérica si la red falla
                    // if (event.request.mode === 'navigate') { // Solo para navegación de página
                    //    return caches.match('./offline.html');
                    // }
                });
            })
    );
});

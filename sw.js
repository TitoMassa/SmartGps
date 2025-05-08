const CACHE_NAME = 'smartmovepro-cache-v2'; // Incrementar versión si cambias assets
// Lista de archivos para precachear (la app shell básica)
const urlsToCache = [
    './', // Alias para index.html si se sirve desde la raíz
    './index.html',
    './css/style.css',
    './js/app.js',
    './manifest.json',
    // URLs de Leaflet (externas, pero importantes para la funcionalidad offline básica)
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    // Íconos (opcional, pero bueno para la experiencia offline completa)
    './icons/icon-192x192.png',
    './icons/icon-512x512.png',
    './icons/apple-touch-icon.png'
    // Puedes añadir más íconos si los consideras críticos para la shell
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Opened cache and caching: ', urlsToCache);
                return cache.addAll(urlsToCache)
                    .catch(error => {
                        console.error('Failed to cache one or more resources during install: ', error);
                        // Si un recurso crítico falla, podrías querer que la instalación falle.
                        // Por ahora, solo logueamos.
                    });
            })
    );
    self.skipWaiting(); // Forzar al SW a activarse inmediatamente
});

self.addEventListener('activate', event => {
    const cacheWhitelist = [CACHE_NAME];
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheWhitelist.indexOf(cacheName) === -1) {
                        console.log('Deleting old cache: ', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    return self.clients.claim(); // Tomar control de los clientes (páginas) inmediatamente
});

self.addEventListener('fetch', event => {
    // Estrategia: Cache First, luego Network.
    // Para peticiones de API o datos dinámicos, podrías usar Network First.
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // Cache hit - return response
                if (response) {
                    return response;
                }

                // No está en caché, ir a la red
                return fetch(event.request).then(
                    networkResponse => {
                        // Si la petición fue exitosa y es un tipo de recurso que queremos cachear dinámicamente:
                        if (networkResponse && networkResponse.status === 200 && 
                            (event.request.url.startsWith('http'))) { // Solo cachear peticiones http/https
                            
                            // No cachear tiles de OpenStreetMap dinámicamente por defecto,
                            // podrían llenar el caché muy rápido.
                            // Si se requiere cacheo de tiles, se necesita una estrategia más sofisticada.
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
                    console.warn('Fetch failed; returning offline page instead.', error);
                    // Opcional: Podrías devolver una página offline genérica si la red falla
                    // return caches.match('./offline.html');
                });
            })
    );
});

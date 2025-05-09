// sw.js
const CACHE_NAME = 'smart-move-pro-cache-v1.2'; // Incremented version
const urlsToCache = [
    '/',
    'index.html',
    'css/style.css',
    'js/app.js',
    'manifest.json',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    // Add paths to Leaflet images if they are self-hosted or critical
    // 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    // 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    'icons/icon-192x192.png',
    'icons/icon-512x512.png'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Cache abierto');
                // Add all URLs, but don't fail install if some external (unpkg) ones fail
                const cachePromises = urlsToCache.map(urlToCache => {
                    return cache.add(urlToCache).catch(err => {
                        console.warn(`Fallo al cachear ${urlToCache}: ${err}`);
                    });
                });
                return Promise.all(cachePromises);
            })
    );
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // Cache hit - return response
                if (response) {
                    return response;
                }

                // Clone the request because it's a stream and can only be consumed once.
                const fetchRequest = event.request.clone();

                return fetch(fetchRequest)
                    .then(response => {
                        // Check if we received a valid response
                        if (!response || response.status !== 200 || response.type !== 'basic' && !event.request.url.startsWith('https:')) {
                             // Don't cache opaque responses or non-http/https
                            return response;
                        }

                        // Clone the response because it's a stream and can only be consumed once.
                        const responseToCache = response.clone();

                        caches.open(CACHE_NAME)
                            .then(cache => {
                                cache.put(event.request, responseToCache);
                            });

                        return response;
                    })
                    .catch(error => {
                        console.error('Fetch failed; returning offline page instead.', error);
                        // Optionally, return a generic offline page:
                        // return caches.match('/offline.html'); 
                    });
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

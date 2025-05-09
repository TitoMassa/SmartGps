const CACHE_NAME = 'smart-move-pro-cache-v2'; // Increment version on change
const APP_SHELL_FILES = [
    '/', // Or '/index.html' if your server setup requires it
    '/index.html',
    '/css/style.css',
    '/js/app.js',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    // Crucial for Leaflet default markers to work offline
    'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    '/manifest.json',
    '/icons/icon-192x192.png', // Add other critical icons
    '/icons/icon-512x512.png'
];

self.addEventListener('install', event => {
    console.log('[SW] Install');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('[SW] Caching App Shell');
                // Use { cache: 'reload' } for CDN assets during install to ensure freshness if desired,
                // but be mindful of rate limits if CDN is aggressive. Default is fine too.
                const requests = APP_SHELL_FILES.map(url => {
                    if (url.startsWith('http')) { // External CDN URL
                        return new Request(url, { cache: 'reload' });
                    }
                    return url; // Local file
                });
                return cache.addAll(requests)
                    .catch(error => {
                        console.error('[SW] Failed to cache app shell files during install:', error);
                        // Log individual file fetch errors for debugging
                        requests.forEach(req => {
                            const urlToFetch = (typeof req === 'string') ? req : req.url;
                            fetch(urlToFetch).then(response => {
                                if (!response.ok) {
                                    console.error(`[SW] Failed to fetch for caching: ${urlToFetch}, status: ${response.status}`);
                                }
                            }).catch(fetchError => {
                                console.error(`[SW] Network error fetching for caching: ${urlToFetch}`, fetchError);
                            });
                        });
                    });
            })
    );
});

self.addEventListener('activate', event => {
    console.log('[SW] Activate');
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('[SW] Removing old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim()) // Ensure new SW takes control immediately
    );
});

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Serve app shell files from cache first
    if (APP_SHELL_FILES.includes(url.pathname) || APP_SHELL_FILES.includes(url.href) || (url.pathname === '/' && APP_SHELL_FILES.includes('/index.html'))) {
        event.respondWith(
            caches.match(event.request).then(cachedResponse => {
                if (cachedResponse) {
                    return cachedResponse;
                }
                return fetch(event.request).then(networkResponse => {
                    // Optionally cache again if missed during install (e.g., dynamic request)
                    // Be cautious with caching everything by default.
                    return networkResponse;
                });
            })
        );
        return;
    }

    // For other requests (e.g., API calls, map tiles), try network first, then cache.
    // This is a common strategy for dynamic content or third-party resources.
    event.respondWith(
        fetch(event.request)
            .then(networkResponse => {
                // If fetch is successful, clone and cache it for future offline use
                if (networkResponse && networkResponse.status === 200) {
                    // Only cache GET requests
                    if (event.request.method === 'GET' && (url.protocol === 'http:' || url.protocol === 'https:')) {
                         // Be careful about caching too much, especially from CDNs with versioned URLs.
                         // Map tiles are good candidates for caching.
                        const responseToCache = networkResponse.clone();
                        caches.open(CACHE_NAME).then(cache => {
                            cache.put(event.request, responseToCache);
                        });
                    }
                }
                return networkResponse;
            })
            .catch(() => {
                // If network fails, try to serve from cache
                return caches.match(event.request).then(cachedResponse => {
                    if (cachedResponse) {
                        return cachedResponse;
                    }
                    // If not in cache and network failed, return a proper error or offline fallback
                    // For map tiles, this might mean the map doesn't load more tiles when offline
                    // For other assets, you could return a specific offline.html or an error response.
                    if (event.request.destination === 'image') {
                        // return new Response('<svg>...</svg>', { headers: { 'Content-Type': 'image/svg+xml' } });
                    }
                    return new Response('Network error and not in cache', {
                        status: 408,
                        headers: { 'Content-Type': 'text/plain' },
                    });
                });
            })
    );
});

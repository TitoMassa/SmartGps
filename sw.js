const CACHE_NAME = 'smart-move-pro-cache-v2'; // Incremented version for updates
const APP_SHELL_URLS = [
    './', // Alias for index.html
    './index.html',
    // Leaflet assets (CDN, but good to cache if possible, though SW might not cache opaque responses by default)
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    // Icons for PWA (make sure these paths are correct relative to sw.js location)
    './icons/icon-192x192.png',
    './icons/icon-512x512.png'
    // El CSS y JS principal están embebidos en index.html, por lo que './' o './index.html' los cubre.
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[SW] Opened cache: ', CACHE_NAME);
                // Use addAll for atomic caching. If one fails, all fail.
                // For CDN resources, if they don't support CORS for caching, they might not be cached.
                // Consider fetching them with { mode: 'no-cors' } if caching opaque responses is acceptable,
                // or host them locally. For this example, we'll try to cache normally.
                const requests = APP_SHELL_URLS.map(url => {
                    if (url.startsWith('http')) { // External URL (CDN)
                        return new Request(url, { mode: 'cors' }); // Try CORS mode
                    }
                    return url; // Local URL
                });
                return cache.addAll(requests)
                    .catch(error => {
                        console.error('[SW] Failed to cache some resources during install:', error);
                        // Optionally, decide if this is a critical failure
                    });
            })
            .then(() => {
                console.log('[SW] All specified resources have been cached or attempted.');
            })
    );
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request)
            .then((response) => {
                if (response) {
                    // console.log('[SW] Serving from cache:', event.request.url);
                    return response; // Serve from cache
                }
                // console.log('[SW] Fetching from network:', event.request.url);
                return fetch(event.request).then(networkResponse => {
                    // Optional: Cache new requests dynamically (Cache then network strategy for dynamic content)
                    // Be careful with what you cache here. For app shell, install caching is usually enough.
                    return networkResponse;
                }).catch(error => {
                    console.error('[SW] Fetch failed; returning offline page or error for:', event.request.url, error);
                    // You could return a custom offline page here if desired for HTML navigations
                    // if (event.request.mode === 'navigate') {
                    //     return caches.match('./offline.html'); 
                    // }
                });
            })
    );
});

self.addEventListener('activate', (event) => {
    const cacheWhitelist = [CACHE_NAME];
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheWhitelist.indexOf(cacheName) === -1) {
                        console.log('[SW] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => {
            console.log('[SW] Activated and old caches cleaned.');
            return self.clients.claim(); // Ensure new SW takes control immediately
        })
    );
});

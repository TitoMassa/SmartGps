'use strict';

const APP_SHELL_CACHE_NAME = 'smart-move-pro-shell-v1';
const TILE_CACHE_NAME = 'smart-move-pro-tiles-v1';

// Lista de recursos que componen el "cascarón" de la aplicación.
const APP_SHELL_FILES = [
    './index.html', // La página principal
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
    // No es necesario añadir manifest.json o sw.js aquí.
];

// Evento 'install': Se dispara cuando el Service Worker se instala por primera vez.
self.addEventListener('install', event => {
    console.log('[Service Worker] Instalando...');
    event.waitUntil(
        caches.open(APP_SHELL_CACHE_NAME).then(cache => {
            console.log('[Service Worker] Cacheando el App Shell');
            return cache.addAll(APP_SHELL_FILES);
        })
    );
});

// Evento 'activate': Se dispara después de la instalación. Ideal para limpiar cachés viejas.
self.addEventListener('activate', event => {
    console.log('[Service Worker] Activando...');
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    // Si el nombre de la caché no es el actual del shell ni el de los tiles, la borramos.
                    if (cacheName !== APP_SHELL_CACHE_NAME && cacheName !== TILE_CACHE_NAME) {
                        console.log('[Service Worker] Borrando caché antigua:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    return self.clients.claim();
});

// Evento 'fetch': Se dispara cada vez que la aplicación realiza una petición de red.
self.addEventListener('fetch', event => {
    const requestUrl = new URL(event.request.url);

    // Estrategia para los tiles del mapa (Cache first, then network)
    if (requestUrl.hostname === 'a.tile.openstreetmap.org' ||
        requestUrl.hostname === 'b.tile.openstreetmap.org' ||
        requestUrl.hostname === 'c.tile.openstreetmap.org') {
        event.respondWith(
            caches.open(TILE_CACHE_NAME).then(cache => {
                return cache.match(event.request).then(response => {
                    // Si el tile está en caché, lo servimos desde ahí.
                    if (response) {
                        return response;
                    }
                    // Si no, lo pedimos a la red.
                    return fetch(event.request).then(networkResponse => {
                        // Y lo guardamos en caché para la próxima vez.
                        cache.put(event.request, networkResponse.clone());
                        return networkResponse;
                    }).catch(() => {
                        // Opcional: Podrías devolver un tile de "sin conexión" si falla la red.
                    });
                });
            })
        );
        return;
    }

    // Estrategia para el App Shell (Cache first)
    event.respondWith(
        caches.match(event.request).then(response => {
            // Si el recurso está en caché, lo devolvemos. Si no, lo pedimos a la red.
            return response || fetch(event.request);
        })
    );
});

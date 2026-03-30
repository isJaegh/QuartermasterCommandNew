// ============================================================================
// QUARTERMASTER COMMAND - SERVICE WORKER
// ============================================================================

const CACHE_NAME = 'qm-cache-v17'; // Bumped version to force a cache update

// The exact paths to all the new modular files
const urlsToCache = [
    './',
    './index.html',
    './styles.css',
    './manifest.json',
    './js/main.js',
    './js/state/store.js',
    './js/data/data.js',
    './js/data/lang.js',
    './js/data/helpContent.js',
    './js/core/app.js',
    './js/core/engine.js',
    './js/core/pipeline.js',
    './js/ui/modals.js',
    './js/ui/bank.js',
    './js/ui/market.js',
    './js/ui/theme.js',
    './js/ui/lookup.js',
    './js/network/discord.js',
    './js/utils/format.js',
    './js/utils/clipboard.js',
    './js/utils/toast.js',
    './js/utils/confirm.js',
    './js/data/langBase.js',
    './js/data/lang/en.js',
    './js/data/lang/fr.js',
    './js/data/lang/de.js',
    './js/data/lang/es.js',
    './js/data/lang/it.js',
    './js/data/lang/pt.js',
    './js/data/lang/ru.js',
    './js/data/lang/uk.js',
    './js/data/lang/pl.js',
    './js/data/lang/cs.js',
    './js/data/lang/hu.js',
    './js/data/lang/ro.js',
    './js/data/lang/sv.js',
    './js/data/lang/fi.js',
    './js/data/lang/tr.js',
    './js/data/lang/ar.js'
];

// 1. Install Event: Cache all essential files
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Opened cache');
                return cache.addAll(urlsToCache);
            })
    );
});

// 2. Fetch Event: Serve from cache first, then fall back to network
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // Cache hit - return response
                if (response) {
                    return response;
                }
                return fetch(event.request);
            })
    );
});

// 3. Activate Event: Clean up old, outdated caches
self.addEventListener('activate', event => {
    const cacheWhitelist = [CACHE_NAME];
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheWhitelist.indexOf(cacheName) === -1) {
                        return caches.delete(cacheName); // Nuke v1 cache
                    }
                })
            );
        })
    );
});
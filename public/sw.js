// Service Worker for YAAD PWA Offline Caching & Installability
const CACHE_NAME = 'yaad-pwa-cache-v10';

const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
  '/apple-touch-icon.png',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/pwa-maskable-512x512.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('Cache addAll warning:', err);
      });
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event listener required by Chromium PWA installability heuristic
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // HTML page navigation
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match('/index.html') || caches.match('/');
      })
    );
    return;
  }

  // Static assets
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200 && url.origin === self.location.origin) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});

// Handle notification interaction so window remains active until user reacts
// When user taps an action button (Complete / Snooze / Stop), process in background WITHOUT opening the app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const reminderId = event.notification.data?.reminderId;
  const action = event.action;

  // If user clicked quick action button (complete, snooze, stop), apply directly WITHOUT opening or focusing the app!
  if (action === 'complete' || action === 'snooze' || action === 'stop') {
    event.waitUntil(
      (async () => {
        // 1. Notify any active clients silently
        const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of clientList) {
          client.postMessage({
            type: 'YAAD_NOTIFICATION_ACTION',
            action: action,
            reminderId: reminderId,
          });
        }

        // 2. Also directly update IndexedDB vault if reminderId exists
        if (reminderId && 'indexedDB' in self) {
          try {
            await new Promise((resolve) => {
              const req = indexedDB.open('yaad_persistent_vault', 1);
              req.onsuccess = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('app_backups')) {
                  resolve(null);
                  return;
                }
                const tx = db.transaction(['app_backups'], 'readwrite');
                const store = tx.objectStore('app_backups');
                const getReq = store.get('latest_vault');
                getReq.onsuccess = () => {
                  const data = getReq.result;
                  if (data && Array.isArray(data.reminders)) {
                    if (action === 'complete') {
                      data.reminders = data.reminders.map((r) =>
                        r.id === reminderId ? { ...r, status: 'completed' } : r
                      );
                    } else if (action === 'snooze') {
                      data.reminders = data.reminders.map((r) =>
                        r.id === reminderId
                          ? { ...r, dueTimestamp: (r.dueTimestamp || Date.now()) + 15 * 60000, postponeCount: (r.postponeCount || 0) + 1 }
                          : r
                      );
                    }
                    data.updatedAt = Date.now();
                    store.put(data);
                  }
                  tx.oncomplete = () => resolve(null);
                  tx.onerror = () => resolve(null);
                };
                getReq.onerror = () => resolve(null);
              };
              req.onerror = () => resolve(null);
            });
          } catch (err) {
            console.warn('[SW] Background action vault sync:', err);
          }
        }
      })()
    );
    return;
  }

  // Only if clicked on notification body itself (no action button), open / focus the app
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url && 'focus' in client) {
          client.focus();
          if (reminderId) {
            client.postMessage({
              type: 'YAAD_NOTIFICATION_ACTION',
              action: 'open',
              reminderId: reminderId,
            });
          }
          return;
        }
      }
      if (self.clients.openWindow) {
        const urlToOpen = reminderId ? `/?alarmId=${encodeURIComponent(reminderId)}` : '/';
        return self.clients.openWindow(urlToOpen);
      }
    })
  );
});

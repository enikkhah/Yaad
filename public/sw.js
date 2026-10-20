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

// Track acknowledged reminder IDs so swiped/dismissed notifications re-appear until user actually reacts
const acknowledgedAlarmIds = new Set();

self.addEventListener('message', (event) => {
  if (event.data?.type === 'YAAD_DISMISS_ALARM_NOTIFICATION') {
    const reminderId = event.data.reminderId;
    if (reminderId) {
      acknowledgedAlarmIds.add(String(reminderId));
      self.registration.getNotifications({ tag: `yaad-rem-${reminderId}` }).then((list) => {
        list.forEach((n) => n.close());
      }).catch(() => {});
    }
  } else if (event.data?.type === 'YAAD_ACTIVATE_ALARM_NOTIFICATION') {
    const reminderId = event.data.reminderId;
    if (reminderId) {
      acknowledgedAlarmIds.delete(String(reminderId));
    }
  }
});

// Handle notification interaction so window remains active until user reacts
// When user taps an action button (Done / Snooze / Stop / Dismiss), process strictly in background WITHOUT opening the app
self.addEventListener('notificationclick', (event) => {
  // 1. Always close the notification first
  event.notification.close();

  const reminderId = event.notification.data?.reminderId;
  const action = event.action;

  if (reminderId) {
    acknowledgedAlarmIds.add(String(reminderId));
  }

  // 2. If user clicked quick action button (done, snooze, dismiss, stop), apply strictly in background WITHOUT opening or focusing the app!
  if (action === 'done' || action === 'snooze' || action === 'dismiss' || action === 'stop' || action === 'complete') {
    event.waitUntil(
      (async () => {
        // Broadcast action to all existing clients silently
        const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of clientList) {
          client.postMessage({
            type: 'YAAD_NOTIFICATION_ACTION',
            action: action,
            reminderId: reminderId,
          });
        }

        // Also directly update IndexedDB vault if reminderId exists
        if (reminderId && 'indexedDB' in self) {
          try {
            await new Promise((resolve) => {
              const req = indexedDB.open('yaad_persistent_vault');
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
                    if (action === 'done' || action === 'complete') {
                      data.reminders = data.reminders.map((r) =>
                        r.id === reminderId ? { ...r, status: 'completed', completedAt: Date.now(), acknowledged: true, lastActionAt: Date.now() } : r
                      );
                    } else if (action === 'snooze') {
                      data.reminders = data.reminders.map((r) =>
                        r.id === reminderId
                          ? { ...r, dueTimestamp: (r.dueTimestamp || Date.now()) + 15 * 60000, postponeCount: (r.postponeCount || 0) + 1, status: 'postponed', postponedAt: Date.now(), acknowledged: false, lastActionAt: Date.now() }
                          : r
                      );
                    } else if (action === 'stop' || action === 'dismiss') {
                      data.reminders = data.reminders.map((r) =>
                        r.id === reminderId
                          ? { ...r, acknowledged: true, notifiedAt: Date.now(), lastActionAt: Date.now() }
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

  // 3. Only if action is empty (user tapped directly on notification body itself), open / focus the app
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

// If user swipes/closes the out-of-app notification WITHOUT reacting (Complete / Snooze / Stop),
// re-show it continuously so the out-of-app notification persists until user reaction!
self.addEventListener('notificationclose', (event) => {
  const notif = event.notification;
  const data = notif?.data || {};
  const reminderId = data.reminderId;
  if (!reminderId || !data.persistentUntilReaction) return;
  if (acknowledgedAlarmIds.has(String(reminderId))) return;

  event.waitUntil(
    new Promise((resolve) => {
      setTimeout(async () => {
        if (acknowledgedAlarmIds.has(String(reminderId))) {
          resolve(null);
          return;
        }
        try {
          await self.registration.showNotification(notif.title, {
            body: notif.body,
            icon: notif.icon || '/pwa-192x192.png',
            badge: notif.badge || '/favicon.ico',
            tag: notif.tag || `yaad-rem-${reminderId}`,
            renotify: true,
            requireInteraction: true,
            vibrate: [500, 250, 500, 250, 500],
            data: {
              ...data,
              persistentUntilReaction: true,
            },
            actions: data.actions || [
              { action: 'done', title: '✓ انجام شد' },
              { action: 'snooze', title: '⏱ تعویق ۱۵ دقیقه' },
              { action: 'stop', title: '✕ توقف هشدار' },
            ],
          });
        } catch (err) {
          console.warn('[SW] Re-show persistent notification error:', err);
        }
        resolve(null);
      }, 2000);
    })
  );
});

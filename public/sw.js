// Service Worker for Yadnik Native Background Notifications, Offline Caching & PWA Installability
const CACHE_NAME = 'yadnik-pwa-cache-v7';

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

let scheduledAlarms = [];
let nextAlarmTimeoutId = null;

// IndexedDB Helper for persistent alarms storage across SW lifecycles
function openAlarmsDB() {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    const req = indexedDB.open('yadnik_alarms_db', 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('alarms')) {
        db.createObjectStore('alarms', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

async function getStoredAlarms() {
  try {
    const db = await openAlarmsDB();
    if (!db) return scheduledAlarms;
    return new Promise((resolve) => {
      const tx = db.transaction('alarms', 'readonly');
      const store = tx.objectStore('alarms');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve(scheduledAlarms);
    });
  } catch {
    return scheduledAlarms;
  }
}

async function saveStoredAlarms(list) {
  try {
    const db = await openAlarmsDB();
    if (!db) return;
    const tx = db.transaction('alarms', 'readwrite');
    const store = tx.objectStore('alarms');
    store.clear();
    list.forEach((item) => store.put(item));
  } catch (err) {
    console.warn('Could not save alarms to IndexedDB:', err);
  }
}

// Helper: Show native system notification from Service Worker & trigger in-app popup modal
function showAlarmNotification(alarm) {
  const title = `🔔 یادآور YAAD: ${alarm.title}`;
  const body = `زمان یادآوری: ${alarm.timeStr || ''}${alarm.description ? ' • ' + alarm.description : ''}`;

  // Notify any active/open window client to popup the AlarmModal with sound & camera flash immediately
  self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
    for (const client of clientList) {
      client.postMessage({
        type: 'TRIGGER_ALARM_MODAL',
        reminder: alarm,
      });
      if ('focus' in client) {
        client.focus().catch(() => {});
      }
    }
  });

  return self.registration.showNotification(title, {
    body,
    icon: '/pwa-192x192.png',
    badge: '/favicon.ico',
    tag: `yadnik-alarm-${alarm.id}`,
    renotify: true,
    requireInteraction: true,
    silent: false,
    vibrate: [500, 200, 500, 200, 500, 200, 1000],
    data: { reminderId: alarm.id, reminder: alarm },
    actions: [
      { action: 'complete', title: '✓ خاتمه (تیک انجام)' },
      { action: 'snooze', title: '⏱ به تعویق انداختن (۱۵ دقیقه)' },
      { action: 'dismiss', title: '✕ بستن' },
    ],
  });
}

// Check and trigger any alarms that are due
async function checkAndTriggerDueAlarms() {
  const now = Date.now();
  let list = scheduledAlarms;
  if (!list || list.length === 0) {
    list = await getStoredAlarms();
    scheduledAlarms = list;
  }

  const due = list.filter((a) => !a.triggered && a.dueTimestamp <= now + 2000);

  for (const alarm of due) {
    alarm.triggered = true;
    try {
      await showAlarmNotification(alarm);
    } catch (err) {
      console.warn('SW failed to show alarm notification:', err);
    }
  }

  if (due.length > 0) {
    await saveStoredAlarms(scheduledAlarms);
  }

  scheduleNextAlarmTimer();
}

// Plan the next timer for background notification delivery
function scheduleNextAlarmTimer() {
  if (nextAlarmTimeoutId) {
    clearTimeout(nextAlarmTimeoutId);
    nextAlarmTimeoutId = null;
  }

  const now = Date.now();
  const pending = scheduledAlarms
    .filter((a) => !a.triggered && a.dueTimestamp > now)
    .sort((a, b) => a.dueTimestamp - b.dueTimestamp);

  if (pending.length === 0) return null;

  const nextAlarm = pending[0];
  const delay = Math.max(200, nextAlarm.dueTimestamp - now);

  const maxDelay = 2147483647;
  const timeoutMs = Math.min(delay, maxDelay);

  nextAlarmTimeoutId = setTimeout(() => {
    checkAndTriggerDueAlarms();
  }, timeoutMs);

  return timeoutMs;
}

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
    }).then(() => self.clients.claim()).then(() => checkAndTriggerDueAlarms())
  );
});

// Listen for message from main app window (scheduling upcoming reminders)
self.addEventListener('message', (event) => {
  if (!event.data) return;

  if (event.data.type === 'SCHEDULE_REMINDERS') {
    const list = event.data.reminders || [];
    scheduledAlarms = list.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      dueTimestamp: r.dueTimestamp,
      timeStr: r.timeStr,
      triggered: false,
    }));

    saveStoredAlarms(scheduledAlarms);
    checkAndTriggerDueAlarms();

    // If next alarm is within 5 minutes, keep the service worker alive
    const timeoutMs = scheduleNextAlarmTimer();
    if (timeoutMs !== null && timeoutMs <= 300000 && event.waitUntil) {
      event.waitUntil(
        new Promise((resolve) => {
          setTimeout(async () => {
            await checkAndTriggerDueAlarms();
            resolve();
          }, timeoutMs);
        })
      );
    }
  } else if (event.data.type === 'TRIGGER_NOW_NOTIFICATION') {
    showAlarmNotification(event.data.reminder);
  }
});

// Background Sync & Periodic Sync (triggered even when tab/browser is closed)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'yadnik-check-reminders') {
    event.waitUntil(checkAndTriggerDueAlarms());
  }
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'yadnik-sync-reminders') {
    event.waitUntil(checkAndTriggerDueAlarms());
  }
});

// Push notification event listener (for push service)
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: event.data ? event.data.text() : 'یادآور یاد' };
  }

  const title = data.title || '🔔 یادآور YAAD';
  const options = {
    body: data.body || 'زمان یادآوری فرا رسیده است.',
    icon: '/pwa-192x192.png',
    badge: '/favicon.ico',
    tag: data.tag || 'yadnik-push-alarm',
    renotify: true,
    requireInteraction: true,
    vibrate: [500, 200, 500, 200, 500, 200, 1000],
    data: data.data || {},
    actions: [
      { action: 'complete', title: '✓ خاتمه' },
      { action: 'snooze', title: '⏱ به تعویق انداختن' },
      { action: 'dismiss', title: '✕ بستن' },
    ],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Fetch event listener required by Chromium PWA installability heuristic
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match('/index.html') || caches.match('/');
      })
    );
    return;
  }

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

self.addEventListener('notificationclick', (event) => {
  const notification = event.notification;
  const action = event.action; // 'complete', 'snooze', 'dismiss'
  const reminderId = notification.data?.reminderId;
  const reminder = notification.data?.reminder;

  notification.close();

  // If user completed or dismissed the alarm, update stored alarms so SW never re-triggers it
  if (reminderId && (action === 'complete' || action === 'dismiss')) {
    getStoredAlarms().then((list) => {
      const target = list.find((a) => a.id === reminderId);
      if (target) {
        target.triggered = true;
        if (action === 'complete') target.completed = true;
        saveStoredAlarms(list);
      }
    }).catch(() => {});
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // 1. Broadcast the action to ALL open app windows via postMessage and BroadcastChannel
      for (const client of clientList) {
        client.postMessage({
          type: 'YADNIK_NOTIFICATION_ACTION',
          action: action || 'focus',
          reminderId: reminderId,
          reminder: reminder,
        });
      }

      try {
        if (typeof BroadcastChannel !== 'undefined') {
          const bc = new BroadcastChannel('yadnik_alarm_channel');
          bc.postMessage({
            type: 'YADNIK_NOTIFICATION_ACTION',
            action: action || 'focus',
            reminderId: reminderId,
            reminder: reminder,
          });
          bc.close();
        }
      } catch (err) {
        // ignore
      }

      // 2. Window focus/navigation behavior:
      // If action is complete or dismiss, we do NOT force focus or re-open alarm window
      if (action === 'complete' || action === 'dismiss') {
        return;
      }

      // If user tapped notification body or snooze, focus existing window or open a new one
      if (clientList.length > 0 && 'focus' in clientList[0]) {
        return clientList[0].focus();
      }

      if (self.clients.openWindow) {
        const targetUrl = reminderId ? `/?alarmId=${reminderId}` : '/';
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

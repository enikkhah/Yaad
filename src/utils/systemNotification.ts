import { Reminder } from '../types';
import { formatJalaliTime } from './jalali';

let swRegistration: ServiceWorkerRegistration | null = null;

export async function initSystemNotifications(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined') return null;

  if ('serviceWorker' in navigator) {
    try {
      swRegistration = await navigator.serviceWorker.register('/sw.js');
      console.log('Notification Service Worker registered successfully');
      return swRegistration;
    } catch (err) {
      console.warn('Service worker registration error:', err);
    }
  }
  return null;
}

export function getSystemNotificationPermission(): NotificationPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'denied';
  }
  return Notification.permission;
}

export async function requestSystemNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }
  try {
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  } catch (err) {
    console.warn('Could not request notification permission:', err);
    return false;
  }
}

/**
 * Save alarms directly to IndexedDB so Service Worker always has persistent alarms data
 */
export function saveAlarmsToIndexedDB(alarms: any[]): Promise<void> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve();
    try {
      const req = indexedDB.open('yadnik_alarms_db', 1);
      req.onupgradeneeded = (e: any) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('alarms')) {
          db.createObjectStore('alarms', { keyPath: 'id' });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        try {
          const tx = db.transaction('alarms', 'readwrite');
          const store = tx.objectStore('alarms');
          store.clear();
          alarms.forEach((a) => store.put(a));
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        } catch {
          resolve();
        }
      };
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Fires a high-priority system alarm notification with action buttons:
 * - complete (تیک / خاتمه یادآوری)
 * - snooze (به تعویق انداختن ۱۵ دقیقه)
 * - dismiss (بستن)
 * Visible across the phone home screen, lock screen, and over other apps as a pop-up.
 */
export async function showSystemAlarmNotification(
  reminder: Reminder,
  onAction?: (action: 'complete' | 'snooze' | 'dismiss', reminderId: string) => void
): Promise<void> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return;
  }

  // Do not try to call requestPermission here if denied, as browsers block it inside timers
  if (Notification.permission !== 'granted') {
    return;
  }

  const title = `🔔 یادآور YAAD: ${reminder.title}`;
  const body = `زمان یادآوری: ${formatJalaliTime(reminder.dueTimestamp)}${
    reminder.description ? ` • ${reminder.description}` : ''
  }`;

  try {
    let reg = swRegistration;
    if (!reg && 'serviceWorker' in navigator) {
      reg = await navigator.serviceWorker.ready.catch(() => null);
    }

    if (reg && 'showNotification' in reg) {
      // Modern Android / Desktop notification with system action buttons
      await (reg as any).showNotification(title, {
        body,
        icon: '/pwa-192x192.png',
        badge: '/favicon.ico',
        tag: `yadnik-alarm-${reminder.id}`,
        renotify: true,
        requireInteraction: true,
        silent: false,
        vibrate: [500, 200, 500, 200, 500, 200, 1000],
        data: { reminderId: reminder.id, reminder },
        actions: [
          { action: 'complete', title: '✓ خاتمه (تیک انجام)' },
          { action: 'snooze', title: '⏱ به تعویق انداختن (۱۵ دقیقه)' },
          { action: 'dismiss', title: '✕ بستن' },
        ],
      });
      return;
    }

    // Fallback if service worker showNotification is not available
    const notif = new Notification(title, {
      body,
      icon: '/pwa-192x192.png',
      tag: `yadnik-alarm-${reminder.id}`,
      requireInteraction: true,
    });

    notif.onclick = () => {
      window.focus();
      notif.close();
      if (onAction) {
        onAction('complete', reminder.id);
      }
    };
  } catch (err) {
    console.warn('Failed to display system notification:', err);
  }
}

/**
 * Synchronizes upcoming reminders with the Service Worker and IndexedDB so background alarms
 * fire automatically even when the user is outside the app or phone screen is locked.
 */
export async function syncRemindersToServiceWorker(reminders: Reminder[]): Promise<void> {
  const now = Date.now();
  const upcoming = reminders
    .filter((r) => r.status === 'pending' && r.dueTimestamp >= now - 60000)
    .map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      dueTimestamp: r.dueTimestamp,
      timeStr: formatJalaliTime(r.dueTimestamp),
      triggered: false,
    }));

  // 1. Save to shared IndexedDB so SW reads it even if SW was terminated
  await saveAlarmsToIndexedDB(upcoming);

  // 2. Post message to active SW
  if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      let reg = swRegistration;
      if (!reg) {
        reg = await navigator.serviceWorker.ready.catch(() => null);
      }

      const targetWorker = navigator.serviceWorker.controller || reg?.active;
      if (targetWorker) {
        targetWorker.postMessage({
          type: 'SCHEDULE_REMINDERS',
          reminders: upcoming,
        });
      }

      // Attempt periodic sync registration if browser supports it
      if (reg && 'periodicSync' in (reg as any)) {
        try {
          await (reg as any).periodicSync.register('yadnik-check-reminders', {
            minInterval: 15 * 60 * 1000,
          });
        } catch {
          // Ignored
        }
      }
    } catch (err) {
      console.warn('Could not sync reminders to Service Worker:', err);
    }
  }
}

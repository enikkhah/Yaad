import { Reminder } from '../types';
import { formatJalaliTime } from './jalali';
import { unlockAudio } from './audio';

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
  unlockAudio();
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
 * 1-Click anticipation function: unlocks Web Audio engine, requests OS notification permission,
 * and synchronizes reminders immediately without burdening the user with multiple steps.
 */
export async function ensureNotificationAndAudioReady(reminders?: Reminder[]): Promise<boolean> {
  unlockAudio();
  const granted = await requestSystemNotificationPermission();
  if (reminders && reminders.length > 0) {
    syncRemindersToServiceWorker(reminders).catch(() => {});
  }
  return granted;
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

  // Clean title & Today, time formatted body exactly like the Android Reminder heads-up screenshot:
  const title = reminder.title;
  const timeStr = formatJalaliTime(reminder.dueTimestamp);
  const body = `Today, ${timeStr}${reminder.description ? ' • ' + reminder.description : ''}`;

  try {
    let reg = swRegistration;
    if (!reg && 'serviceWorker' in navigator) {
      reg = await navigator.serviceWorker.ready.catch(() => null);
    }

    if (reg && 'showNotification' in reg) {
      // Modern Android / Desktop notification with system action buttons
      await (reg as any).showNotification(title, {
        body,
        icon: '/purple-bell-192.png',
        badge: '/favicon.ico',
        tag: `yadnik-alarm-${reminder.id}`,
        renotify: true,
        requireInteraction: true,
        silent: false,
        vibrate: [500, 200, 500, 200, 500, 200, 1000],
        data: { reminderId: reminder.id, reminder },
        actions: [
          { action: 'complete', title: '✓ خاتمه / Done' },
          { action: 'snooze', title: '⏱ تعویق ۱۵د / Snooze' },
          { action: 'dismiss', title: '✕ بستن / Dismiss' },
        ],
      });
      return;
    }

    // Fallback if service worker showNotification is not available
    const notif = new Notification(title, {
      body,
      icon: '/purple-bell-192.png',
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

// VAPID Public Key for client push registration
const VAPID_PUBLIC_KEY = 'BEI2Bc7gWMwyXnyRMpJ_GF4iYJaOAu2QSWi5Bvv8IvYdAWCazyukOdGAOOtGNVvJ6jH77hCJzmyvqs2eTrte__w';

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return buffer;
}

export async function getOrRegisterPushSubscription(): Promise<PushSubscription | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return null;
  }

  try {
    let reg = swRegistration;
    if (!reg) {
      reg = await navigator.serviceWorker.ready;
    }
    if (!reg) return null;

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const convertedVapidKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedVapidKey,
      });
    }
    return sub;
  } catch (err) {
    console.warn('Could not register push subscription:', err);
    return null;
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
      category: r.category,
      priority: r.priority,
      ringTune: r.ringTune,
      useFlash: r.useFlash,
      status: r.status,
      dueTimestamp: r.dueTimestamp,
      timeStr: formatJalaliTime(r.dueTimestamp),
      triggered: false,
    }));

  // 1. Save to shared IndexedDB so SW reads it even if SW was terminated
  await saveAlarmsToIndexedDB(upcoming);

  // 2. Schedule on Cloud Server via real Web Push (guarantees push when browser is closed!)
  try {
    if (Notification.permission === 'granted') {
      const sub = await getOrRegisterPushSubscription();
      if (sub && upcoming.length > 0) {
        await fetch('/api/schedule-push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription: sub, reminders: upcoming }),
        });
      }
    }
  } catch (err) {
    // Non-fatal if offline or network error
  }

  // 3. Post message to active SW
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

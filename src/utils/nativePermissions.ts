import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Reminder } from '../types';
import { formatJalaliTime } from './jalali';
import { unlockAudio } from './audio';

export interface NativePermissionsStatus {
  notifications: boolean;
  microphone: boolean;
  camera: boolean;
  location: boolean;
}

/**
 * Checks if the current environment is running inside Capacitor (Native Android APK / iOS)
 */
export function isNativeAndroidApp(): boolean {
  if (typeof window === 'undefined') return false;
  return Capacitor.isNativePlatform() || (window as any).isCapacitor === true;
}

/**
 * Initialize high-importance Android Notification Channel for out-of-app reminder alarms
 * Matching native reminder apps (Samsung Reminder, Google Tasks) with sound, vibration, and heads-up banner
 */
export async function initAndroidNotificationChannel(): Promise<void> {
  if (!isNativeAndroidApp()) return;
  try {
    await LocalNotifications.createChannel({
      id: 'yadnik_alarms_channel',
      name: 'یادآورهای فوری YAAD (Heads-Up Alarms)',
      description: 'اعلان‌های کرکره‌ای، زنگ هشدار و ویبره یادآورها خارج از برنامه',
      importance: 5, // 5 = IMPORTANCE_HIGH / HEADS-UP
      visibility: 1, // 1 = VISIBILITY_PUBLIC (Lock Screen)
      sound: 'beep.wav',
      vibration: true,
      lights: true,
      lightColor: '#8b5cf6',
    });

    // Register notification action types (Done, Snooze 15m, Dismiss)
    await LocalNotifications.registerActionTypes({
      types: [
        {
          id: 'YAAD_REMINDER_ACTIONS',
          actions: [
            {
              id: 'complete',
              title: '✓ خاتمه / انجام شد',
              foreground: false,
            },
            {
              id: 'snooze',
              title: '⏱ تعویق ۱۵ دقیقه',
              foreground: false,
            },
            {
              id: 'dismiss',
              title: '✕ بستن',
              destructive: true,
              foreground: false,
            },
          ],
        },
      ],
    });
  } catch (err) {
    console.warn('Could not initialize Android notification channel:', err);
  }
}

/**
 * Request OS Notification Permission (Capacitor Native + Web Notification)
 */
export async function requestNotificationPermission(): Promise<boolean> {
  unlockAudio();
  if (typeof window === 'undefined') return false;

  // 1. If running as Capacitor native app
  if (isNativeAndroidApp()) {
    try {
      await initAndroidNotificationChannel();
      const status = await LocalNotifications.requestPermissions();
      return status.display === 'granted';
    } catch (err) {
      console.warn('Capacitor notification permission request error:', err);
    }
  }

  // 2. Standard Web / PWA Notification
  if ('Notification' in window) {
    try {
      const perm = await Notification.requestPermission();
      return perm === 'granted';
    } catch (err) {
      console.warn('Web notification permission error:', err);
      return false;
    }
  }
  return false;
}

/**
 * Request Microphone Permission (forces Android WebView OS permission prompt)
 */
export async function requestMicrophonePermission(): Promise<boolean> {
  unlockAudio();
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return false;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Stop tracks immediately after permission is granted
    stream.getTracks().forEach((track) => track.stop());
    return true;
  } catch (err) {
    console.warn('Microphone permission request failed:', err);
    return false;
  }
}

/**
 * Request Camera Permission (forces Android WebView OS permission prompt)
 */
export async function requestCameraPermission(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return false;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
    });
    stream.getTracks().forEach((track) => track.stop());
    return true;
  } catch (err) {
    console.warn('Camera permission request failed:', err);
    return false;
  }
}

/**
 * Request GPS / Geolocation Permission (forces Android WebView OS permission prompt)
 */
export async function requestLocationPermission(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return false;
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      () => resolve(true),
      (err) => {
        console.warn('Location permission request failed:', err);
        resolve(false);
      },
      { timeout: 8000, enableHighAccuracy: true }
    );
  });
}

/**
 * Check current status for all 4 native permissions
 */
export async function checkAllPermissionsStatus(): Promise<NativePermissionsStatus> {
  const result: NativePermissionsStatus = {
    notifications: false,
    microphone: false,
    camera: false,
    location: false,
  };

  if (typeof window === 'undefined') return result;

  // 1. Notification
  if (isNativeAndroidApp()) {
    try {
      const status = await LocalNotifications.checkPermissions();
      result.notifications = status.display === 'granted';
    } catch {
      result.notifications = 'Notification' in window && Notification.permission === 'granted';
    }
  } else {
    result.notifications = 'Notification' in window && Notification.permission === 'granted';
  }

  // 2. Permissions API query (Chrome / Chromium WebView)
  if (navigator.permissions && navigator.permissions.query) {
    try {
      const micStatus = await navigator.permissions.query({ name: 'microphone' as any });
      result.microphone = micStatus.state === 'granted';
    } catch {
      // Ignore
    }

    try {
      const camStatus = await navigator.permissions.query({ name: 'camera' as any });
      result.camera = camStatus.state === 'granted';
    } catch {
      // Ignore
    }

    try {
      const locStatus = await navigator.permissions.query({ name: 'geolocation' as any });
      result.location = locStatus.state === 'granted';
    } catch {
      // Ignore
    }
  }

  return result;
}

/**
 * Requests all essential native Android permissions with 1 click
 */
export async function requestAllNativePermissions(): Promise<NativePermissionsStatus> {
  const notifications = await requestNotificationPermission();
  const microphone = await requestMicrophonePermission();
  const camera = await requestCameraPermission();
  const location = await requestLocationPermission();

  return {
    notifications,
    microphone,
    camera,
    location,
  };
}

/**
 * Schedule or display out-of-app reminder notification with high-priority heads-up banner,
 * sound, vibration, and quick action buttons (Done, Snooze 15m, Dismiss), identical to Samsung Reminder / Google Tasks.
 */
export async function triggerOutOfAppNotification(
  reminder: Reminder,
  isImmediate = false
): Promise<boolean> {
  const timeFormatted = formatJalaliTime(reminder.dueTimestamp);
  const title = `🔔 یادآور YAAD: ${reminder.title}`;
  const body = `امروز، ${timeFormatted}${reminder.description ? ' • ' + reminder.description : ''}`;

  // 1. Native Capacitor Local Notification (Android APK)
  if (isNativeAndroidApp()) {
    try {
      await initAndroidNotificationChannel();
      const notificationId = Math.abs(
        reminder.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
      ) % 1000000;

      await LocalNotifications.schedule({
        notifications: [
          {
            id: notificationId,
            title,
            body,
            channelId: 'yadnik_alarms_channel',
            schedule: isImmediate ? undefined : { at: new Date(reminder.dueTimestamp) },
            sound: 'beep.wav',
            smallIcon: 'ic_stat_icon_config_sample',
            largeIcon: 'purple_bell_192',
            actionTypeId: 'YAAD_REMINDER_ACTIONS',
            extra: {
              reminderId: reminder.id,
              reminder,
            },
          },
        ],
      });
      return true;
    } catch (err) {
      console.warn('Failed to schedule Capacitor native local notification:', err);
    }
  }

  // 2. Web Service Worker Notification (PWA / Browser)
  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.ready.catch(() => null);
        if (reg && 'showNotification' in reg) {
          await (reg as any).showNotification(title, {
            body,
            icon: '/purple-bell-192.png',
            badge: '/favicon.ico',
            tag: `yadnik-alarm-${reminder.id}`,
            renotify: true,
            requireInteraction: true,
            silent: false,
            vibrate: [600, 200, 600, 200, 600, 200, 1000],
            data: { reminderId: reminder.id, reminder },
            actions: [
              { action: 'complete', title: '✓ خاتمه / انجام شد' },
              { action: 'snooze', title: '⏱ تعویق ۱۵ دقیقه' },
              { action: 'dismiss', title: '✕ بستن' },
            ],
          });
          return true;
        }
      }

      // Fallback
      new Notification(title, {
        body,
        icon: '/purple-bell-192.png',
        tag: `yadnik-alarm-${reminder.id}`,
      });
      return true;
    } catch (err) {
      console.warn('Failed to show Web notification:', err);
    }
  }

  return false;
}

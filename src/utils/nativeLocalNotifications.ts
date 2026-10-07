import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Reminder } from '../types';
import { formatJalaliTime } from './jalali';

export const NOTIFICATION_CHANNEL_ID = 'yaad_reminders_channel';
export const NOTIFICATION_ACTION_TYPE_ID = 'YAAD_REMINDER_ACTIONS';

let isChannelInitialized = false;

/**
 * Checks if running in native Android / iOS Capacitor environment.
 * If running on Web / PWA / browser, returns false so web execution is completely unaffected.
 */
export function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/**
 * Deterministically generates a stable 32-bit positive integer (1 to 2147483647)
 * from any reminder ID string. This ensures Android NotificationManager gets a valid
 * int ID, and editing/deleting always targets the exact same notification ID even
 * across app restarts.
 */
export function getNotificationId(reminderId: string | number): number {
  if (typeof reminderId === 'number') {
    return Math.abs(reminderId) % 2147483647 || 1;
  }
  let hash = 0;
  for (let i = 0; i < reminderId.length; i++) {
    hash = (hash * 31 + reminderId.charCodeAt(i)) & 0x7fffffff;
  }
  return hash === 0 ? 1 : hash;
}

/**
 * Initializes Android high-importance Notification Channel (Android 8.0+ / Oreo to Android 15+)
 * with Heads-Up Banner, sound, vibration, and lock screen visibility.
 */
export async function initNotificationChannel(): Promise<void> {
  if (!isNativeApp()) return;
  if (isChannelInitialized) return;

  try {
    await LocalNotifications.createChannel({
      id: NOTIFICATION_CHANNEL_ID,
      name: 'یادآورهای YAAD',
      description: 'اعلان‌های صوتی، لرزش و بنر بالای صفحه یادآورها در زمان مقرر',
      importance: 5, // 5 = IMPORTANCE_HIGH (enables heads-up banner popup over other apps)
      visibility: 1, // 1 = VISIBILITY_PUBLIC (shows on lock screen)
      sound: 'beep.wav',
      vibration: true,
      lights: true,
      lightColor: '#8b5cf6',
    });

    // Register quick notification actions (Done, Snooze 15m)
    await LocalNotifications.registerActionTypes({
      types: [
        {
          id: NOTIFICATION_ACTION_TYPE_ID,
          actions: [
            {
              id: 'complete',
              title: '✓ انجام شد',
              foreground: false,
            },
            {
              id: 'snooze',
              title: '⏱ تعویق ۱۵ دقیقه',
              foreground: false,
            },
          ],
        },
      ],
    });

    isChannelInitialized = true;
  } catch (err) {
    console.warn('Could not initialize Android notification channel:', err);
  }
}

/**
 * Checks if notification permission is currently granted on Android.
 */
export async function checkNotificationPermission(): Promise<boolean> {
  if (!isNativeApp()) return false;
  try {
    const status = await LocalNotifications.checkPermissions();
    return status.display === 'granted';
  } catch (err) {
    console.warn('Could not check notification permissions:', err);
    return false;
  }
}

/**
 * Requests Notification permission on Android (compatible with Android 13+ POST_NOTIFICATIONS).
 * Prompted automatically at the moment of first reminder creation.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!isNativeApp()) return false;
  try {
    await initNotificationChannel();
    const current = await LocalNotifications.checkPermissions();
    if (current.display === 'granted') {
      return true;
    }
    const requested = await LocalNotifications.requestPermissions();
    return requested.display === 'granted';
  } catch (err) {
    console.warn('Could not request notification permissions:', err);
    return false;
  }
}

/**
 * Schedules an Android Local Notification for a reminder at its exact date and time.
 * Works reliably even when the app is in the background or completely closed.
 */
export async function scheduleReminderNotification(reminder: Reminder): Promise<boolean> {
  if (!isNativeApp()) return false;

  // Only pending reminders in the future should be scheduled
  const now = Date.now();
  if (reminder.status !== 'pending' || reminder.dueTimestamp <= now) {
    return false;
  }

  try {
    // 1. Ensure permission is requested
    const hasPermission = await checkNotificationPermission();
    if (!hasPermission) {
      const granted = await requestNotificationPermission();
      if (!granted) {
        console.warn('Cannot schedule notification: permission not granted');
        return false;
      }
    } else {
      await initNotificationChannel();
    }

    const notifId = reminder.notificationId || getNotificationId(reminder.id);
    const timeFormatted = formatJalaliTime(reminder.dueTimestamp);

    // Title and body crafted from reminder info
    const title = `🔔 یادآور: ${reminder.title}`;
    const body = reminder.description
      ? `${reminder.description} • ساعت ${timeFormatted}`
      : `زمان انجام یادآور: ${timeFormatted}`;

    // Target date in device's local timezone
    const scheduledDate = new Date(reminder.dueTimestamp);

    await LocalNotifications.schedule({
      notifications: [
        {
          id: notifId,
          title,
          body,
          channelId: NOTIFICATION_CHANNEL_ID,
          schedule: {
            at: scheduledDate,
            allowWhileIdle: true, // Crucial for Android Doze mode / Exact alarms
          },
          sound: 'beep.wav',
          actionTypeId: NOTIFICATION_ACTION_TYPE_ID,
          extra: {
            reminderId: reminder.id,
            dueTimestamp: reminder.dueTimestamp,
          },
        },
      ],
    });

    return true;
  } catch (err) {
    console.warn(`Failed to schedule Local Notification for reminder ${reminder.id}:`, err);
    return false;
  }
}

/**
 * Cancels a previously scheduled Android Local Notification by reminder ID.
 * Called when a reminder is deleted, edited, or marked completed.
 */
export async function cancelReminderNotification(reminderId: string | number): Promise<boolean> {
  if (!isNativeApp()) return false;
  try {
    const notifId = getNotificationId(reminderId);
    await LocalNotifications.cancel({
      notifications: [{ id: notifId }],
    });
    return true;
  } catch (err) {
    console.warn(`Failed to cancel Local Notification for reminder ${reminderId}:`, err);
    return false;
  }
}

/**
 * Reschedules notification when a reminder is updated or postponed:
 * cancels the previous notification and schedules the new one.
 */
export async function rescheduleReminderNotification(
  previousId: string,
  updatedReminder: Reminder
): Promise<boolean> {
  if (!isNativeApp()) return false;
  await cancelReminderNotification(previousId);
  return scheduleReminderNotification(updatedReminder);
}

/**
 * Synchronizes all upcoming pending reminders with Android Local Notifications.
 * Ensures any future reminder has an active Alarm scheduled, e.g. after permissions are granted or on app mount.
 */
export async function syncAllRemindersWithLocalNotifications(reminders: Reminder[]): Promise<void> {
  if (!isNativeApp()) return;

  const now = Date.now();
  const upcomingPending = reminders.filter(
    (r) => r.status === 'pending' && r.dueTimestamp > now
  );

  for (const reminder of upcomingPending) {
    await scheduleReminderNotification(reminder);
  }
}

/**
 * Sets up listeners for user tapping the notification or selecting quick actions (Done, Snooze).
 */
export function setupNotificationListeners(
  onComplete?: (reminderId: string) => void,
  onSnooze?: (reminderId: string, minutes: number) => void
): void {
  if (!isNativeApp()) return;

  try {
    LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
      const reminderId = action.notification.extra?.reminderId;
      if (!reminderId) return;

      if (action.actionId === 'complete') {
        if (onComplete) onComplete(reminderId);
      } else if (action.actionId === 'snooze') {
        if (onSnooze) onSnooze(reminderId, 15);
      } else {
        // Direct tap on the notification banner (tapped to open app)
        // Handled naturally by Android bringing app to foreground
      }
    });
  } catch (err) {
    console.warn('Could not set up local notification listeners:', err);
  }
}

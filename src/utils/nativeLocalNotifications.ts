import { Capacitor } from '@capacitor/core';
import { LocalNotifications, PermissionStatus } from '@capacitor/local-notifications';
import { Reminder } from '../types';
import { formatJalaliTime } from './jalali';

export const NOTIFICATION_CHANNEL_ID = 'yaad_reminders_channel';
export const NOTIFICATION_ACTION_TYPE_ID = 'YAAD_REMINDER_ACTIONS';

let isChannelInitialized = false;

export interface PendingNotificationInfo {
  id: number;
  title?: string;
  body?: string;
  schedule?: any;
  extra?: any;
}

export interface ReminderScheduleDebugItem {
  reminderId: string;
  dueTimestamp: number;
  dateString: string;
  notificationId: number;
  scheduleResult: any;
  verifiedInPending: boolean;
  timestamp: string;
}

export interface TestScheduleDebugItem {
  notificationId: number;
  dueTimestamp: number;
  dateString: string;
  scheduleResult: any;
  verifiedInPending: boolean;
  timestamp: string;
}

export interface LocalNotificationDebugInfo {
  lastUpdated: string;
  isNative: boolean;
  platform: string;
  permissionStatus: PermissionStatus | any;
  lastReminderScheduled: ReminderScheduleDebugItem | null;
  lastTestScheduled: TestScheduleDebugItem | null;
  pendingCount: number;
  pendingList: PendingNotificationInfo[];
  lastScheduleResult: any;
  lastError: string | null;
  lastErrorStack?: string | null;
}

const STORAGE_DEBUG_KEY = 'yaad_local_notification_debug';

/**
 * Checks if running in native Android / iOS Capacitor environment.
 */
export function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return Capacitor.isNativePlatform() || (window as any).isCapacitor === true;
  } catch {
    return false;
  }
}

// Initialize default debug state
function loadInitialDebugState(): LocalNotificationDebugInfo {
  const defaultState: LocalNotificationDebugInfo = {
    lastUpdated: new Date().toISOString(),
    isNative: isNativeApp(),
    platform: Capacitor.getPlatform(),
    permissionStatus: isNativeApp()
      ? null
      : { display: 'web-preview', note: 'Capacitor native alarms run inside Android APK' },
    lastReminderScheduled: null,
    lastTestScheduled: null,
    pendingCount: 0,
    pendingList: [],
    lastScheduleResult: null,
    lastError: null,
    lastErrorStack: null,
  };

  if (typeof window === 'undefined') return defaultState;

  try {
    const raw = localStorage.getItem(STORAGE_DEBUG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...defaultState,
        ...parsed,
        isNative: isNativeApp(),
        platform: Capacitor.getPlatform(),
      };
    }
  } catch (err) {
    console.warn('Could not load local notification debug cache:', err);
  }

  return defaultState;
}

let currentDebugState: LocalNotificationDebugInfo = loadInitialDebugState();
const debugSubscribers = new Set<(info: LocalNotificationDebugInfo) => void>();

function updateDebugState(patch: Partial<LocalNotificationDebugInfo>): LocalNotificationDebugInfo {
  currentDebugState = {
    ...currentDebugState,
    ...patch,
    lastUpdated: patch.lastUpdated || new Date().toISOString(),
    isNative: isNativeApp(),
    platform: Capacitor.getPlatform(),
  };

  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_DEBUG_KEY, JSON.stringify(currentDebugState));
    }
  } catch {
    // ignore storage quota errors
  }

  // Notify listeners
  debugSubscribers.forEach((cb) => {
    try {
      cb(currentDebugState);
    } catch (e) {
      console.warn('Debug subscriber error:', e);
    }
  });

  return currentDebugState;
}

/**
 * Returns current snapshot of notification debug state
 */
export function getNotificationDebugSnapshot(): LocalNotificationDebugInfo {
  return currentDebugState;
}

/**
 * Subscribes to debug state updates (returns unsubscribe callback)
 */
export function subscribeNotificationDebug(
  callback: (info: LocalNotificationDebugInfo) => void
): () => void {
  debugSubscribers.add(callback);
  callback(currentDebugState);
  return () => {
    debugSubscribers.delete(callback);
  };
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
  if (!isNativeApp()) return true; // On web browser, bypass native check
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
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!isNativeApp()) return true;
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
 * Diagnostic requirements:
 * 1. Runs LocalNotifications.getPending() immediately after schedule()
 * 2. Verifies whether scheduled notification ID is actually in pending notifications
 * 3. Records full diagnostic telemetry (dueTimestamp, dateString, notifId, pending count,
 *    pending list, checkPermissions, schedule result, error)
 * Web compatibility:
 * When executed in Web browser, records simulation state without throwing errors.
 */
export async function scheduleReminderNotification(reminder: Reminder): Promise<boolean> {
  // Only pending reminders in the future should be scheduled
  const now = Date.now();
  if (reminder.status !== 'pending' || reminder.dueTimestamp <= now) {
    return false;
  }

  const notifId = reminder.notificationId || getNotificationId(reminder.id);
  const scheduledDate = new Date(reminder.dueTimestamp);
  const timeFormatted = formatJalaliTime(reminder.dueTimestamp);

  const title = `🔔 یادآور: ${reminder.title}`;
  const body = reminder.description
    ? `${reminder.description} • ساعت ${timeFormatted}`
    : `زمان انجام یادآور: ${timeFormatted}`;

  // Web Browser Handling: simulate queue in debug panel without triggering unsupported browser error
  if (!isNativeApp()) {
    const webScheduleResult = {
      notifications: [{
        id: notifId,
        title,
        body,
        schedule: { at: scheduledDate.toString(), allowWhileIdle: true },
        simulated: true,
      }],
    };

    const simulatedPendingItem: PendingNotificationInfo = {
      id: notifId,
      title,
      body,
      schedule: { at: scheduledDate.toString(), allowWhileIdle: true },
      extra: { reminderId: reminder.id, dueTimestamp: reminder.dueTimestamp },
    };

    const existingList = (currentDebugState.pendingList || []).filter((n) => n.id !== notifId);
    const updatedList = [simulatedPendingItem, ...existingList];

    updateDebugState({
      lastUpdated: new Date().toISOString(),
      permissionStatus: { display: 'granted (Web Preview)', note: 'Active natively in Android APK' },
      lastScheduleResult: webScheduleResult,
      lastError: null,
      lastErrorStack: null,
      lastReminderScheduled: {
        reminderId: reminder.id,
        dueTimestamp: reminder.dueTimestamp,
        dateString: scheduledDate.toString(),
        notificationId: notifId,
        scheduleResult: webScheduleResult,
        verifiedInPending: true,
        timestamp: new Date().toISOString(),
      },
      pendingCount: updatedList.length,
      pendingList: updatedList,
    });

    console.log(
      `[YAAD Debug] Reminder #${notifId} recorded in Web Preview. Native AlarmManager runs inside Android APK.`
    );
    return true;
  }

  // Native Android APK execution:
  try {
    // 1. Ensure permission is requested
    const hasPermission = await checkNotificationPermission();
    if (!hasPermission) {
      const granted = await requestNotificationPermission();
      if (!granted) {
        const permStatus = await LocalNotifications.checkPermissions().catch((e) => ({ error: e?.message }));
        const errMsg = 'مجوز اعلان اندروید داده نشده است (Notification permission not granted)';
        console.warn(errMsg);
        updateDebugState({
          lastError: errMsg,
          permissionStatus: permStatus,
        });
        return false;
      }
    } else {
      await initNotificationChannel();
    }

    // Call LocalNotifications.schedule with allowWhileIdle: true
    const scheduleResult = await LocalNotifications.schedule({
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

    // Requirement 1: Immediately run getPending() after schedule
    const pending = await LocalNotifications.getPending();

    // Requirement 2: Check if notification ID actually exists in pending list
    const verifiedInPending = (pending.notifications || []).some(
      (n: any) => n.id === notifId
    );

    const permStatus = await LocalNotifications.checkPermissions().catch((e) => ({
      error: e?.message,
    }));

    // Update debug state with complete details
    updateDebugState({
      lastUpdated: new Date().toISOString(),
      permissionStatus: permStatus,
      lastScheduleResult: scheduleResult,
      lastError: null,
      lastErrorStack: null,
      lastReminderScheduled: {
        reminderId: reminder.id,
        dueTimestamp: reminder.dueTimestamp,
        dateString: scheduledDate.toString(),
        notificationId: notifId,
        scheduleResult: scheduleResult,
        verifiedInPending,
        timestamp: new Date().toISOString(),
      },
      pendingCount: pending.notifications?.length || 0,
      pendingList: (pending.notifications || []).map((n: any) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        schedule: n.schedule,
        extra: n.extra,
      })),
    });

    console.log(
      `[YAAD Debug] Reminder scheduled -> ID: ${notifId}, At: ${scheduledDate.toString()}, Verified in pending: ${verifiedInPending}, Total pending: ${pending.notifications?.length}`
    );

    return true;
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    const stack = err?.stack || null;
    console.warn(`Failed to schedule Local Notification for reminder ${reminder.id}:`, err);

    let permStatus: any = null;
    let pending: any = { notifications: [] };
    try {
      permStatus = await LocalNotifications.checkPermissions();
      pending = await LocalNotifications.getPending();
    } catch {
      // ignore
    }

    updateDebugState({
      lastUpdated: new Date().toISOString(),
      permissionStatus: permStatus,
      lastError: errorMsg,
      lastErrorStack: stack,
      lastScheduleResult: null,
      lastReminderScheduled: {
        reminderId: reminder.id,
        dueTimestamp: reminder.dueTimestamp,
        dateString: scheduledDate.toString(),
        notificationId: notifId,
        scheduleResult: null,
        verifiedInPending: false,
        timestamp: new Date().toISOString(),
      },
      pendingCount: pending.notifications?.length || 0,
      pendingList: (pending.notifications || []).map((n: any) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        schedule: n.schedule,
        extra: n.extra,
      })),
    });

    return false;
  }
}

/**
 * Requirement 4: Test button logic
 * Directly and independently from the reminder system schedules a simple Local Notification
 * for exactly 60 seconds from now:
 *
 * LocalNotifications.schedule({
 *   notifications: [{
 *     id: 999999,
 *     title: 'YAAD Test',
 *     body: 'Android background notification test',
 *     schedule: {
 *       at: new Date(Date.now() + 60000),
 *       allowWhileIdle: true
 *     },
 *     channelId: 'yaad_reminders_channel'
 *   }]
 * });
 *
 * Runs getPending() immediately after schedule and updates the Debug Panel.
 * Compatible with Web Browser: in web preview, provides a smooth simulation without throwing
 * "Notifications not supported in this browser". In Native Android APK, runs real Capacitor plugin!
 */
export async function testAndroidNotification60Seconds(): Promise<LocalNotificationDebugInfo> {
  const testId = 999999;
  const targetDate = new Date(Date.now() + 60000);
  const dueTimestamp = targetDate.getTime();
  const dateString = targetDate.toString();

  // If running in Web Browser (AIS preview / desktop browser)
  if (!isNativeApp()) {
    const webScheduleResult = {
      notifications: [
        {
          id: testId,
          title: 'YAAD Test',
          body: 'Android background notification test',
          schedule: {
            at: dateString,
            allowWhileIdle: true,
          },
          channelId: NOTIFICATION_CHANNEL_ID,
          simulated: true,
        },
      ],
    };

    const newPendingItem: PendingNotificationInfo = {
      id: testId,
      title: 'YAAD Test',
      body: 'Android background notification test',
      schedule: {
        at: dateString,
        allowWhileIdle: true,
      },
      extra: { test: true },
    };

    // Filter out previous test if present, and add new test item
    const existingList = (currentDebugState.pendingList || []).filter((n) => n.id !== testId);
    const updatedList = [newPendingItem, ...existingList];

    const result = updateDebugState({
      lastUpdated: new Date().toISOString(),
      permissionStatus: {
        display: 'granted (Web Preview)',
        note: 'در اندروید، آلارم واقعی AlarmManager تنظیم می‌شود',
      },
      lastScheduleResult: webScheduleResult,
      lastError: null,
      lastErrorStack: null,
      lastTestScheduled: {
        notificationId: testId,
        dueTimestamp,
        dateString,
        scheduleResult: webScheduleResult,
        verifiedInPending: true,
        timestamp: new Date().toISOString(),
      },
      pendingCount: updatedList.length,
      pendingList: updatedList,
    });

    console.log(
      `[YAAD Debug] Test 60s Notification simulated in Web -> ID: 999999, At: ${dateString}. In Android APK, real native AlarmManager is scheduled.`
    );

    return result;
  }

  // Native Android APK execution:
  try {
    await initNotificationChannel();

    // Direct schedule call matching the prompt requirement
    const scheduleResult = await LocalNotifications.schedule({
      notifications: [
        {
          id: testId,
          title: 'YAAD Test',
          body: 'Android background notification test',
          schedule: {
            at: targetDate,
            allowWhileIdle: true,
          },
          channelId: NOTIFICATION_CHANNEL_ID,
        },
      ],
    });

    // Immediately run getPending()
    const pending = await LocalNotifications.getPending();

    // Verify whether test ID exists in pending list
    const verifiedInPending = (pending.notifications || []).some(
      (n: any) => n.id === testId
    );

    const permStatus = await LocalNotifications.checkPermissions().catch((e) => ({
      error: e?.message,
    }));

    const result = updateDebugState({
      lastUpdated: new Date().toISOString(),
      permissionStatus: permStatus,
      lastScheduleResult: scheduleResult,
      lastError: null,
      lastErrorStack: null,
      lastTestScheduled: {
        notificationId: testId,
        dueTimestamp,
        dateString,
        scheduleResult,
        verifiedInPending,
        timestamp: new Date().toISOString(),
      },
      pendingCount: pending.notifications?.length || 0,
      pendingList: (pending.notifications || []).map((n: any) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        schedule: n.schedule,
        extra: n.extra,
      })),
    });

    console.log(
      `[YAAD Debug] Test 60s Notification scheduled -> ID: 999999, At: ${dateString}, Verified in pending: ${verifiedInPending}, Total pending: ${pending.notifications?.length}`
    );

    return result;
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    const stack = err?.stack || null;
    console.warn('[YAAD Debug] Test notification 60s warning:', err);

    let permStatus: any = null;
    let pending: any = { notifications: [] };
    try {
      permStatus = await LocalNotifications.checkPermissions();
      pending = await LocalNotifications.getPending();
    } catch {
      // ignore
    }

    const result = updateDebugState({
      lastUpdated: new Date().toISOString(),
      permissionStatus: permStatus,
      lastError: errorMsg,
      lastErrorStack: stack,
      lastScheduleResult: null,
      lastTestScheduled: {
        notificationId: testId,
        dueTimestamp,
        dateString,
        scheduleResult: null,
        verifiedInPending: false,
        timestamp: new Date().toISOString(),
      },
      pendingCount: pending.notifications?.length || 0,
      pendingList: (pending.notifications || []).map((n: any) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        schedule: n.schedule,
        extra: n.extra,
      })),
    });

    return result;
  }
}

/**
 * Refreshes current pending notifications list and permissions status from native Android.
 * On web, keeps stored state without throwing unsupported browser errors.
 */
export async function refreshPendingNotificationsDebug(): Promise<LocalNotificationDebugInfo> {
  if (!isNativeApp()) {
    return updateDebugState({
      lastUpdated: new Date().toISOString(),
      permissionStatus: {
        display: 'web-preview',
        note: 'در محیط وب پرمیشن‌های نیتیو اندروید شبیه‌سازی می‌شوند',
      },
    });
  }

  try {
    let permStatus: any = null;
    try {
      permStatus = await LocalNotifications.checkPermissions();
    } catch (e: any) {
      permStatus = { error: e?.message || String(e) };
    }

    let pending: any = { notifications: [] };
    try {
      pending = await LocalNotifications.getPending();
    } catch (e: any) {
      pending = { notifications: [], error: e?.message || String(e) };
    }

    const verifiedReminder = currentDebugState.lastReminderScheduled
      ? (pending.notifications || []).some(
          (n: any) => n.id === currentDebugState.lastReminderScheduled?.notificationId
        )
      : false;

    const verifiedTest = currentDebugState.lastTestScheduled
      ? (pending.notifications || []).some(
          (n: any) => n.id === currentDebugState.lastTestScheduled?.notificationId
        )
      : false;

    const updated = updateDebugState({
      lastUpdated: new Date().toISOString(),
      permissionStatus: permStatus,
      pendingCount: pending.notifications?.length || 0,
      pendingList: (pending.notifications || []).map((n: any) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        schedule: n.schedule,
        extra: n.extra,
      })),
      ...(currentDebugState.lastReminderScheduled
        ? {
            lastReminderScheduled: {
              ...currentDebugState.lastReminderScheduled,
              verifiedInPending: verifiedReminder,
            },
          }
        : {}),
      ...(currentDebugTestScheduled()
        ? {
            lastTestScheduled: {
              ...currentDebugState.lastTestScheduled!,
              verifiedInPending: verifiedTest,
            },
          }
        : {}),
    });

    return updated;
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    return updateDebugState({
      lastUpdated: new Date().toISOString(),
      lastError: errorMsg,
      lastErrorStack: err?.stack || null,
    });
  }
}

function currentDebugTestScheduled() {
  return currentDebugState.lastTestScheduled !== null;
}

/**
 * Cancels a previously scheduled Android Local Notification by reminder ID.
 */
export async function cancelReminderNotification(reminderId: string | number): Promise<boolean> {
  const notifId = getNotificationId(reminderId);

  if (!isNativeApp()) {
    const updatedList = (currentDebugState.pendingList || []).filter((n) => n.id !== notifId);
    updateDebugState({
      lastUpdated: new Date().toISOString(),
      pendingCount: updatedList.length,
      pendingList: updatedList,
    });
    return true;
  }

  try {
    await LocalNotifications.cancel({
      notifications: [{ id: notifId }],
    });

    // Refresh pending notifications in debug state
    try {
      const pending = await LocalNotifications.getPending();
      updateDebugState({
        pendingCount: pending.notifications?.length || 0,
        pendingList: (pending.notifications || []).map((n: any) => ({
          id: n.id,
          title: n.title,
          body: n.body,
          schedule: n.schedule,
          extra: n.extra,
        })),
      });
    } catch {
      // ignore
    }

    return true;
  } catch (err) {
    console.warn(`Failed to cancel Local Notification for reminder ${reminderId}:`, err);
    return false;
  }
}

/**
 * Cancels the 60 seconds test notification (ID 999999)
 */
export async function cancelTestNotification(): Promise<void> {
  const testId = 999999;

  if (!isNativeApp()) {
    const updatedList = (currentDebugState.pendingList || []).filter((n) => n.id !== testId);
    updateDebugState({
      lastUpdated: new Date().toISOString(),
      lastTestScheduled: currentDebugState.lastTestScheduled
        ? { ...currentDebugState.lastTestScheduled, verifiedInPending: false }
        : null,
      pendingCount: updatedList.length,
      pendingList: updatedList,
    });
    return;
  }

  try {
    await LocalNotifications.cancel({
      notifications: [{ id: testId }],
    });
    const pending = await LocalNotifications.getPending();
    updateDebugState({
      lastUpdated: new Date().toISOString(),
      lastTestScheduled: currentDebugState.lastTestScheduled
        ? { ...currentDebugState.lastTestScheduled, verifiedInPending: false }
        : null,
      pendingCount: pending.notifications?.length || 0,
      pendingList: (pending.notifications || []).map((n: any) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        schedule: n.schedule,
        extra: n.extra,
      })),
    });
  } catch (err: any) {
    updateDebugState({
      lastError: `Cancel test notification failed: ${err?.message || String(err)}`,
    });
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
  await cancelReminderNotification(previousId);
  return scheduleReminderNotification(updatedReminder);
}

/**
 * Synchronizes all upcoming pending reminders with Android Local Notifications.
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
      }
    });
  } catch (err) {
    console.warn('Could not set up local notification listeners:', err);
  }
}

import { Capacitor } from '@capacitor/core';
import { LocalNotifications, PermissionStatus } from '@capacitor/local-notifications';
import { Reminder, AppSettings, PhoneAlarmSound } from '../types';
import { formatJalaliTime } from './jalali';
import { resolveAlarmSound } from './audio';

export const NOTIFICATION_CHANNEL_ID = 'yaad_reminders_channel';
export const NOTIFICATION_ACTION_TYPE_ID = 'YAAD_REMINDER_ACTIONS';

let isChannelInitialized = false;

/**
 * Dismisses delivered system notifications when the in-app alarm screen opens,
 * preventing duplicate alarm sounds/banners from ringing simultaneously.
 * (Calls LocalNotifications.removeAllDeliveredNotifications)
 */
export async function dismissDeliveredNotifications(_reminderId?: string | number): Promise<void> {
  if (!isNativeApp()) return;
  try {
    // Close all delivered notifications per user requirement
    await LocalNotifications.removeAllDeliveredNotifications().catch(() => {});
  } catch (err) {
    console.warn('Could not remove delivered notifications:', err);
  }
}

export const SOUND_FILE_MAP: Record<string, string> = {
  'digital-beep': 'digital_beep.wav',
  'radar': 'radar.wav',
  'marimba': 'marimba.wav',
  'morning-chime': 'morning_chime.wav',
  'zen-bowl': 'morning_chime.wav',
  'soft-harp': 'morning_chime.wav',
  'ocean-drop': 'morning_chime.wav',
  'wind-chimes': 'morning_chime.wav',
  'warm-pad': 'morning_chime.wav',
  'calm-piano': 'morning_chime.wav',
  'urgent-bell': 'urgent_bell.wav',
};

export function getSoundFileName(soundType?: string): string {
  if (!soundType) return 'digital_beep.wav';
  return SOUND_FILE_MAP[soundType] || 'digital_beep.wav';
}

export function getChannelIdForConfig(soundType?: string, volume: number = 0.85): string {
  if (volume <= 0.01) {
    return 'yaad_channel_silent';
  }
  const soundFile = getSoundFileName(soundType);
  const key = soundFile.replace('.wav', '');
  return `yaad_channel_${key}`;
}

export function getSavedAppSettings(): any {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('fa_settings_app_data_v1');
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return null;
}

/**
 * Initializes Android Notification Channels (Android 8.0+ / Oreo to Android 15+)
 * with Heads-Up Banner, user-selected sound, volume sensitivity, vibration, and lock screen visibility.
 */
export async function initNotificationChannel(): Promise<void> {
  if (!isNativeApp()) return;
  if (isChannelInitialized) return;

  try {
    // 1. Default fallback channel
    await LocalNotifications.createChannel({
      id: NOTIFICATION_CHANNEL_ID,
      name: 'یادآورهای YAAD (پیش‌فرض)',
      description: 'اعلان‌های صوتی، لرزش و بنر بالای صفحه یادآورها در زمان مقرر',
      importance: 5, // 5 = IMPORTANCE_HIGH (heads-up popup over other apps)
      visibility: 1, // 1 = VISIBILITY_PUBLIC (shows on lock screen)
      sound: 'digital_beep.wav',
      vibration: true,
    });

    // 2. Silent channel (for volume = 0% / mute)
    await LocalNotifications.createChannel({
      id: 'yaad_channel_silent',
      name: 'یادآورهای YAAD (بی‌صدا)',
      description: 'اعلان‌های بدون صدا و بدون لرزش در حالت سکوت',
      importance: 2, // 2 = IMPORTANCE_LOW (no sound, no vibration, silent in notification shade)
      visibility: 1,
      vibration: false,
    });

    // 3. Channels for each sound type so Android notification manager plays the exact selected tone
    const soundChannels = [
      { id: 'yaad_channel_digital_beep', name: 'یادآورهای YAAD (دیجیتال)', sound: 'digital_beep.wav' },
      { id: 'yaad_channel_radar', name: 'یادآورهای YAAD (رادار)', sound: 'radar.wav' },
      { id: 'yaad_channel_marimba', name: 'یادآورهای YAAD (ماریمبا)', sound: 'marimba.wav' },
      { id: 'yaad_channel_morning_chime', name: 'یادآورهای YAAD (صبحگاهی)', sound: 'morning_chime.wav' },
      { id: 'yaad_channel_urgent_bell', name: 'یادآورهای YAAD (زنگ فوری)', sound: 'urgent_bell.wav' },
    ];

    for (const sc of soundChannels) {
      await LocalNotifications.createChannel({
        id: sc.id,
        name: sc.name,
        description: 'اعلان‌های صوتی یادآور با صدای تنظیم‌شده در برنامه',
        importance: 5, // IMPORTANCE_HIGH (heads-up banner with sound & vibration)
        visibility: 1,
        sound: sc.sound,
        vibration: true,
      });
    }

    // Register quick notification actions (Done, Snooze 15m, Stop)
    // foreground: false ensures the reaction executes cleanly in background without launching/opening the app!
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
            {
              id: 'stop',
              title: '✕ توقف هشدار',
              foreground: false,
            },
          ],
        },
      ],
    });

    isChannelInitialized = true;
  } catch (err) {
    console.warn('Could not initialize Android notification channels:', err);
  }
}

/**
 * Syncs Android notification channels and settings when sound or volume is changed.
 */
export async function syncNotificationSoundAndVolume(soundType?: string, volume?: number): Promise<void> {
  if (!isNativeApp()) return;
  try {
    isChannelInitialized = false;
    await initNotificationChannel();
  } catch (err) {
    console.warn('Error syncing notification sound/volume:', err);
  }
}

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
 * Repeat intervals in minutes for continuous background alarm alerts until user reaction
 */
export const NOTIFICATION_REPEAT_OFFSETS_MINUTES = [
  0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 25, 30, 35, 40, 45, 50, 60
];

/**
 * Resolves all notification IDs for a reminder (primary ID + repeating alarms)
 */
export function getAllNotificationIdsForReminder(reminderId: string | number): number[] {
  const baseId = getNotificationId(reminderId);
  return [
    baseId,
    ...NOTIFICATION_REPEAT_OFFSETS_MINUTES.map((_, index) => (baseId + 1000 + index + 1) % 2147483647),
  ];
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
export async function scheduleReminderNotification(
  reminder: Reminder,
  currentSettings?: AppSettings
): Promise<boolean> {
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

  // 1. Resolve user-configured alarm sound and volume according to rule:
  // Only if reminder.ringTune is one of the 5 valid IDs (digital-beep, radar, marimba, morning-chime, urgent-bell), use it;
  // otherwise use settings.alarmSound, and if none, fallback to digital-beep.
  const appSettings = currentSettings || getSavedAppSettings();
  const soundType: PhoneAlarmSound = resolveAlarmSound(reminder.ringTune, appSettings?.alarmSound);
  const volume = appSettings?.alarmVolume !== undefined ? appSettings.alarmVolume : 0.85;

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
      extra: { reminderId: reminder.id, dueTimestamp: reminder.dueTimestamp, sound: soundType, volume },
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
      `[YAAD Debug] Reminder #${notifId} recorded in Web Preview. Sound: ${soundType}, Volume: ${volume}`
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

    const isSilent = volume <= 0.01;
    const targetChannelId = getChannelIdForConfig(soundType, volume);
    const soundFile = isSilent ? undefined : getSoundFileName(soundType);

    // Build notification queue: Primary notification + Repeating alarm notifications
    // Configured with ongoing: true, autoCancel: false and priority: 2 (PRIORITY_MAX)
    // so notification takes precedence over other apps and window stays open until user acts.
    const notificationsToSchedule: any[] = [
      {
        id: notifId,
        title,
        body,
        channelId: targetChannelId,
        schedule: {
          at: scheduledDate,
          allowWhileIdle: true, // Crucial for Android Doze mode / Exact alarms
        },
        sound: soundFile,
        priority: 2, // Android PRIORITY_MAX: Always prioritized over other app notifications
        ongoing: true, // Keeps notification persistent in notification drawer / lockscreen
        autoCancel: false, // Notification window stays open until user action
        actionTypeId: NOTIFICATION_ACTION_TYPE_ID,
        extra: {
          reminderId: reminder.id,
          dueTimestamp: reminder.dueTimestamp,
          sound: soundType,
          volume,
          isRepeat: false,
        },
      },
      ...NOTIFICATION_REPEAT_OFFSETS_MINUTES.map((offsetMins, index) => ({
        id: (notifId + 1000 + index + 1) % 2147483647,
        title: `⏰ تکرار آلارم: ${reminder.title}`,
        body: reminder.description
          ? `${reminder.description} • در انتظار عکس‌العمل شما (${timeFormatted})`
          : `یادآور در انتظار ثبت عکس‌العمل شماست (${timeFormatted})`,
        channelId: targetChannelId,
        schedule: {
          at: new Date(reminder.dueTimestamp + offsetMins * 60000),
          allowWhileIdle: true,
        },
        sound: soundFile,
        priority: 2, // Highest priority over other notifications
        ongoing: true,
        autoCancel: false,
        actionTypeId: NOTIFICATION_ACTION_TYPE_ID,
        extra: {
          reminderId: reminder.id,
          dueTimestamp: reminder.dueTimestamp,
          sound: soundType,
          volume,
          isRepeat: true,
          repeatIndex: index + 1,
        },
      })),
    ];

    // Call LocalNotifications.schedule with allowWhileIdle: true
    const scheduleResult = await LocalNotifications.schedule({
      notifications: notificationsToSchedule,
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
  const allIds = getAllNotificationIdsForReminder(reminderId);

  if (!isNativeApp()) {
    const updatedList = (currentDebugState.pendingList || []).filter((n) => !allIds.includes(n.id));
    updateDebugState({
      lastUpdated: new Date().toISOString(),
      pendingCount: updatedList.length,
      pendingList: updatedList,
    });
    return true;
  }

  try {
    await LocalNotifications.cancel({
      notifications: allIds.map((id) => ({ id })),
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
 * Fires an immediate Android local notification (used for Geofence entry/exit events).
 */
export async function fireImmediateLocalNotification(
  title: string,
  body: string,
  extraData?: any
): Promise<void> {
  if (!isNativeApp()) {
    // In web environment, log or trigger HTML5 notification if granted
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(title, { 
          body, 
          icon: '/pwa-192x192.png',
          requireInteraction: true,
        });
      } catch {
        // ignore
      }
    }
    return;
  }

  try {
    const notifId = Math.floor(Math.random() * 100000) + 100000;
    const settings = getSavedAppSettings();
    const channelId = getChannelIdForConfig(settings?.alarmSound, settings?.alarmVolume ?? 0.85);

    await LocalNotifications.schedule({
      notifications: [
        {
          id: notifId,
          title,
          body,
          channelId,
          ongoing: true,
          autoCancel: false,
          actionTypeId: NOTIFICATION_ACTION_TYPE_ID,
          smallIcon: 'ic_stat_notification',
          largeIcon: 'ic_stat_notification',
          extra: extraData || {},
        },
      ],
    });
  } catch (err) {
    console.warn('Failed to fire immediate local notification:', err);
  }
}

/**
 * Reschedules notification when a reminder is updated or postponed:
 * cancels the previous notification and schedules the new one.
 */
export async function rescheduleReminderNotification(
  previousId: string,
  updatedReminder: Reminder,
  currentSettings?: AppSettings
): Promise<boolean> {
  await cancelReminderNotification(previousId);
  return scheduleReminderNotification(updatedReminder, currentSettings);
}

/**
 * Synchronizes all upcoming pending reminders with Android Local Notifications.
 * Reschedules all pending reminders using the correct resolved sound.
 */
export async function syncAllRemindersWithLocalNotifications(
  reminders: Reminder[],
  currentSettings?: AppSettings
): Promise<void> {
  const appSettings = currentSettings || getSavedAppSettings();
  const now = Date.now();
  const upcomingPending = (reminders || []).filter(
    (r) => r.status === 'pending' && r.dueTimestamp > now
  );

  for (const reminder of upcomingPending) {
    await scheduleReminderNotification(reminder, appSettings);
  }
}

/**
 * Sets up listeners for user tapping the notification or selecting quick actions (Done, Snooze, Stop).
 * Actions with foreground: false run in the background without launching or opening the app.
 */
export function setupNotificationListeners(
  onComplete?: (reminderId: string) => void,
  onSnooze?: (reminderId: string, minutes: number) => void,
  onStop?: (reminderId: string) => void
): void {
  if (!isNativeApp()) return;

  try {
    LocalNotifications.addListener('localNotificationActionPerformed', async (action) => {
      const reminderId = action.notification.extra?.reminderId;
      if (!reminderId) return;

      // When user reacts, cancel repeating notifications for this reminder
      cancelReminderNotification(reminderId).catch(() => {});

      if (action.actionId === 'complete') {
        if (onComplete) onComplete(reminderId);
      } else if (action.actionId === 'snooze') {
        if (onSnooze) onSnooze(reminderId, 15);
      } else if (action.actionId === 'stop') {
        if (onStop) {
          onStop(reminderId);
        }
      }
    });
  } catch (err) {
    console.warn('Could not set up local notification listeners:', err);
  }
}

/**
 * Triggers or refreshes a persistent, continuous out-of-app notification (Service Worker / OS Notification / Native)
 * that stays active and re-alerts until the user explicitly reacts (Complete / Snooze / Stop).
 */
export async function triggerOutOfAppPersistentNotification(
  reminder: Reminder,
  settings?: AppSettings,
  onClickOpen?: (r: Reminder) => void
): Promise<void> {
  const isEn = settings?.language === 'en';
  const timeFormatted = formatJalaliTime(reminder.dueTimestamp, isEn ? 'en' : 'fa');
  const title = `🔔 ${reminder.title}`;
  const body = reminder.description
    ? `${reminder.description} • ${timeFormatted}`
    : isEn
    ? `Reminder due at ${timeFormatted} (Awaiting your action)`
    : `زمان انجام یادآور: ${timeFormatted} (در انتظار عکس‌العمل شما)`;

  // 1. If running in Native Android Capacitor, also fire/refresh ongoing high-priority notification
  if (isNativeApp()) {
    try {
      const notifId = reminder.notificationId || getNotificationId(reminder.id);
      const soundType = resolveAlarmSound(reminder.ringTune, settings?.alarmSound);
      const volume = settings?.alarmVolume !== undefined ? settings.alarmVolume : 0.85;
      const isSilent = volume <= 0.01;
      const targetChannelId = getChannelIdForConfig(soundType, volume);
      const soundFile = isSilent ? undefined : getSoundFileName(soundType);

      await LocalNotifications.schedule({
        notifications: [
          {
            id: notifId,
            title,
            body,
            channelId: targetChannelId,
            sound: soundFile,
            ongoing: true,
            autoCancel: false,
            actionTypeId: NOTIFICATION_ACTION_TYPE_ID,
            extra: {
              reminderId: reminder.id,
              dueTimestamp: reminder.dueTimestamp,
              sound: soundType,
              volume,
              persistentUntilReaction: true,
            },
          },
        ],
      });
    } catch {
      // ignore native schedule errors
    }
  }

  // 2. Web / PWA Service Worker persistent notification with renotify: true & action buttons
  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
    const actions = [
      { action: 'complete', title: isEn ? '✓ Mark Done' : '✓ انجام شد' },
      { action: 'snooze', title: isEn ? '⏱ Snooze 15m' : '⏱ تعویق ۱۵ دقیقه' },
      { action: 'stop', title: isEn ? '✕ Dismiss' : '✕ توقف هشدار' },
    ];

    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg && reg.showNotification) {
          if (navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({
              type: 'YAAD_ACTIVATE_ALARM_NOTIFICATION',
              reminderId: reminder.id,
            });
          }
          await reg.showNotification(title, {
            body,
            icon: '/pwa-192x192.png',
            badge: '/favicon.ico',
            tag: `yaad-rem-${reminder.id}`,
            renotify: true,
            requireInteraction: true,
            vibrate: [500, 250, 500, 250, 500],
            data: {
              reminderId: reminder.id,
              persistentUntilReaction: true,
              actions,
            },
            actions,
          } as any);
          return;
        }
      }
    } catch {
      // Fallback to standard Notification API below
    }

    try {
      const notif = new Notification(title, {
        body,
        icon: '/pwa-192x192.png',
        badge: '/favicon.ico',
        tag: `yaad-rem-${reminder.id}`,
        renotify: true,
        requireInteraction: true,
        data: { reminderId: reminder.id, persistentUntilReaction: true },
      } as any);
      notif.onclick = () => {
        window.focus();
        if (onClickOpen) onClickOpen(reminder);
        notif.close();
      };
    } catch {
      // ignore
    }
  }
}

/**
 * Clears the continuous out-of-app notification once the user reacts (Complete / Snooze / Stop)
 */
export async function clearOutOfAppPersistentNotification(reminderId: string | number): Promise<void> {
  await cancelReminderNotification(reminderId).catch(() => {});
  await dismissDeliveredNotifications(reminderId).catch(() => {});

  if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: 'YAAD_DISMISS_ALARM_NOTIFICATION',
          reminderId: String(reminderId),
        });
      }
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && reg.getNotifications) {
        const list = await reg.getNotifications({ tag: `yaad-rem-${reminderId}` });
        list.forEach((n) => n.close());
      }
    } catch {
      // ignore
    }
  }
}

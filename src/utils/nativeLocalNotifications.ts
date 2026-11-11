import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Reminder, AppSettings, PhoneAlarmSound } from '../types';
import { formatJalaliTime } from './jalali';
import { resolveAlarmSound, stopAlarmRinging } from './audio';

export const NOTIFICATION_CHANNEL_ID = 'yaad_reminders_channel_v3';
export const NOTIFICATION_ACTION_TYPE_ID = 'YAAD_REMINDER_ACTIONS';

let isChannelInitialized = false;

/**
 * Dismisses delivered system notifications when an explicit action (Done, Snooze, Dismiss) is taken.
 */
export async function dismissDeliveredNotifications(reminderId?: string | number): Promise<void> {
  if (!isNativeApp()) return;
  try {
    if (reminderId !== undefined && reminderId !== null) {
      const allIds = getAllNotificationIdsForReminder(reminderId);
      await LocalNotifications.removeDeliveredNotifications({
        notifications: allIds.map((id) => ({ id, title: '', body: '' })),
      }).catch(() => {});
    } else {
      await LocalNotifications.removeAllDeliveredNotifications().catch(() => {});
    }
  } catch (err) {
    console.warn('Could not remove delivered notifications:', err);
  }
}

export const SOUND_FILE_MAP: Record<string, string> = {
  'digital_beep': 'digital_beep.wav',
  'digital-beep': 'digital_beep.wav',
  'radar': 'radar.wav',
  'marimba': 'marimba.wav',
  'morning_chime': 'morning_chime.wav',
  'morning-chime': 'morning_chime.wav',
  'urgent_bell': 'urgent_bell.wav',
  'urgent-bell': 'urgent_bell.wav',
  'beep': 'beep.wav',
  'zen-bowl': 'zen_bowl.wav',
  'zen_bowl': 'zen_bowl.wav',
  'soft-harp': 'soft_harp.wav',
  'soft_harp': 'soft_harp.wav',
  'ocean-drop': 'ocean_drop.wav',
  'ocean_drop': 'ocean_drop.wav',
  'wind-chimes': 'wind_chimes.wav',
  'wind_chimes': 'wind_chimes.wav',
  'warm-pad': 'warm_pad.wav',
  'warm_pad': 'warm_pad.wav',
  'calm-piano': 'calm_piano.wav',
  'calm_piano': 'calm_piano.wav',
};

export function getSoundFileName(soundType?: string): string {
  if (!soundType) return 'digital_beep.wav';
  const normalized = soundType.replace(/-/g, '_');
  return SOUND_FILE_MAP[soundType] || SOUND_FILE_MAP[normalized] || 'digital_beep.wav';
}

export function getChannelIdForConfig(
  soundType?: string,
  volume: number = 0.85,
  vibrationEnabled: boolean = true
): string {
  if (volume <= 0.01) {
    return vibrationEnabled ? 'yaad_channel_v3_vibrate_only' : 'yaad_channel_v3_silent';
  }
  const soundFile = getSoundFileName(soundType);
  const key = soundFile.replace('.wav', '');
  return vibrationEnabled ? `yaad_channel_v3_${key}` : `yaad_channel_v3_${key}_novib`;
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
 * with Heads-Up Banner, user-selected sound, phone notification volume control, vibration toggle, and lock screen visibility.
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

    // 2. Top-pinned silent channel (used after 1 minute of unanswered alarm so notification stays at top of dropdown shade)
    await LocalNotifications.createChannel({
      id: 'yaad_channel_v3_silent',
      name: 'یادآورهای YAAD (بی‌صدا در صدر اعلان‌ها)',
      description: 'اعلان‌های بدون صدا و در صدر منوی کرکره‌ای پس از ۱ دقیقه بی‌پاسخ ماندن',
      importance: 5, // 5 = IMPORTANCE_HIGH so Android keeps it in the top Alerting section of the shade
      visibility: 1,
      vibration: false,
    });

    // 2b. Vibrate-only channel
    await LocalNotifications.createChannel({
      id: 'yaad_channel_v3_vibrate_only',
      name: 'یادآورهای YAAD (فقط ویبره)',
      description: 'اعلان‌های بدون صدا همراه با لرزش (ویبره)',
      importance: 5,
      visibility: 1,
      vibration: true,
    });

    // 3. Channels for all 12 sound types (with and without vibration) so Android notification manager plays the exact selected melody & vibration state
    const soundChannels = [
      { id: 'yaad_channel_v3_digital_beep', name: 'یادآورهای YAAD (دیجیتال)', sound: 'digital_beep.wav' },
      { id: 'yaad_channel_v3_radar', name: 'یادآورهای YAAD (رادار)', sound: 'radar.wav' },
      { id: 'yaad_channel_v3_marimba', name: 'یادآورهای YAAD (ماریمبا)', sound: 'marimba.wav' },
      { id: 'yaad_channel_v3_morning_chime', name: 'یادآورهای YAAD (صبحگاهی)', sound: 'morning_chime.wav' },
      { id: 'yaad_channel_v3_urgent_bell', name: 'یادآورهای YAAD (زنگ فوری)', sound: 'urgent_bell.wav' },
      { id: 'yaad_channel_v3_beep', name: 'یادآورهای YAAD (بوق ساده)', sound: 'beep.wav' },
      { id: 'yaad_channel_v3_zen_bowl', name: 'یادآورهای YAAD (کاسه تبتی)', sound: 'zen_bowl.wav' },
      { id: 'yaad_channel_v3_soft_harp', name: 'یادآورهای YAAD (آرپژ چنگ)', sound: 'soft_harp.wav' },
      { id: 'yaad_channel_v3_ocean_drop', name: 'یادآورهای YAAD (قطرات آب)', sound: 'ocean_drop.wav' },
      { id: 'yaad_channel_v3_wind_chimes', name: 'یادآورهای YAAD (زنگوله بادی)', sound: 'wind_chimes.wav' },
      { id: 'yaad_channel_v3_warm_pad', name: 'یادآورهای YAAD (موج گرم)', sound: 'warm_pad.wav' },
      { id: 'yaad_channel_v3_calm_piano', name: 'یادآورهای YAAD (پیانوی آرام)', sound: 'calm_piano.wav' },
    ];

    for (const sc of soundChannels) {
      await LocalNotifications.createChannel({
        id: sc.id,
        name: sc.name,
        description: 'اعلان‌های صوتی یادآور با صدای تنظیم‌شده و ویبره',
        importance: 5, // IMPORTANCE_HIGH (heads-up banner with sound & vibration)
        visibility: 1,
        sound: sc.sound,
        vibration: true,
      });

      await LocalNotifications.createChannel({
        id: `${sc.id}_novib`,
        name: `${sc.name} - بدون ویبره`,
        description: 'اعلان‌های صوتی یادآور بدون لرزش (ویبره خاموش)',
        importance: 5,
        visibility: 1,
        sound: sc.sound,
        vibration: false,
      });
    }

    // Register quick notification actions: «انجام شد» (Done), «تعویق ۱۵ دقیقه» (Snooze 15m), «ویرایش» (Edit)
    // Only 'edit' has foreground: true so tapping Edit opens the app and navigates to the Edit Reminder modal,
    // while Done and Snooze execute strictly in the background without opening the app.
    await LocalNotifications.registerActionTypes({
      types: [
        {
          id: NOTIFICATION_ACTION_TYPE_ID,
          actions: [
            {
              id: 'done',
              title: '✓ انجام شد',
              foreground: false,
            },
            {
              id: 'snooze',
              title: '⏱ تعویق ۱۵ دقیقه',
              foreground: false,
            },
            {
              id: 'edit',
              title: '✎ ویرایش',
              foreground: true,
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
 * Syncs Android notification channels and settings when sound, volume, or vibration is changed.
 */
export async function syncNotificationSoundAndVolume(
  _soundType?: string,
  _volume?: number,
  _vibrationEnabled?: boolean
): Promise<void> {
  if (!isNativeApp()) return;
  try {
    await initNotificationChannel();
  } catch (err) {
    console.warn('Error syncing notification sound/volume:', err);
  }
}

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

/**
 * Checks whether the user is currently inside the app (foreground & visible).
 * When inside the app, status-bar / heads-up notifications must NOT be posted on top of in-app alerts.
 */
export function isAppCurrentlyInForeground(): boolean {
  if (typeof document === 'undefined') return false;
  return document.visibilityState === 'visible';
}

/**
 * Deterministically generates a stable 32-bit positive integer (1 to 2147483647)
 * from any reminder ID string. This ensures Android NotificationManager gets a valid
 * int ID, and editing/deleting always targets the exact same notification ID even
 * across app restarts.
 */
export function getNotificationId(reminderId: string | number): number {
  if (typeof reminderId === 'number') {
    return (Math.abs(reminderId) % 600000000) + 1;
  }
  let hash = 0;
  for (let i = 0; i < reminderId.length; i++) {
    hash = (hash * 31 + reminderId.charCodeAt(i)) & 0x7fffffff;
  }
  return (Math.abs(hash) % 600000000) + 1;
}

/**
 * Repeats the 1-minute alarm notification every 15 minutes (15, 30, 45, 60, ... minutes)
 * if the user does not react (Done, Snooze, Edit, or Dismiss).
 */
export const NOTIFICATION_REPEAT_OFFSETS_MINUTES: number[] = Array.from(
  { length: 25 },
  (_, index) => (index + 1) * 15
);

/**
 * Resolves all notification IDs for a reminder (primary ID + all 25 repeat alarm slots)
 */
export function getAllNotificationIdsForReminder(reminderId: string | number): number[] {
  const baseId = getNotificationId(reminderId);
  return [
    baseId,
    ...Array.from({ length: 25 }, (_, index) => ((baseId + 1000 + index + 1) % 600000000) + 1),
  ];
}


/**
 * Checks if notification permission is currently granted on Android.
 */
export async function checkNotificationPermission(): Promise<boolean> {
  if (!isNativeApp()) {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      return Notification.permission === 'granted';
    }
    return false;
  }
  try {
    const [statusRes, enabledRes] = await Promise.allSettled([
      LocalNotifications.checkPermissions(),
      LocalNotifications.areEnabled(),
    ]);
    const displayState =
      statusRes.status === 'fulfilled' ? statusRes.value?.display : undefined;
    const areEnabledVal =
      enabledRes.status === 'fulfilled' ? enabledRes.value?.value : undefined;

    if (displayState === 'granted' || areEnabledVal === true) {
      return true;
    }
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      return true;
    }
    return false;
  } catch (err) {
    console.warn('Could not check notification permissions:', err);
    return false;
  }
}

/**
 * Requests Notification permission on Android (compatible with Android 13+ POST_NOTIFICATIONS) and Web/PWA.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!isNativeApp()) {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'granted') return true;
      try {
        const res = await Notification.requestPermission();
        return res === 'granted';
      } catch {
        return false;
      }
    }
    return false;
  }
  try {
    initNotificationChannel().catch(() => {});
    const current = await checkNotificationPermission();
    if (current) {
      return true;
    }
    const requested = await LocalNotifications.requestPermissions();
    if (requested?.display === 'granted') {
      return true;
    }
    const enabledAfter = await LocalNotifications.areEnabled().catch(() => ({ value: false }));
    return enabledAfter?.value === true;
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
  // Only active (non-deleted, non-acknowledged) pending or postponed reminders in the future should be scheduled
  const now = Date.now();
  if (
    reminder.deletedAt ||
    reminder.acknowledged === true ||
    (reminder.status !== 'pending' && reminder.status !== 'postponed') ||
    reminder.dueTimestamp <= now
  ) {
    return false;
  }

  const notifId = reminder.notificationId || getNotificationId(reminder.id);
  const scheduledDate = new Date(reminder.dueTimestamp);
  const timeFormatted = formatJalaliTime(reminder.dueTimestamp);

  const title = reminder.title;
  const body = reminder.description
    ? `${reminder.description} • ساعت ${timeFormatted}`
    : `ساعت ${timeFormatted}`;

  // 1. Resolve user-configured alarm sound and volume according to rule:
  // Only if reminder.ringTune is one of the valid IDs (digital_beep, radar, marimba, morning_chime, urgent_bell, beep), use it;
  // otherwise use settings.alarmSound, and if none, fallback to digital_beep.
  const appSettings = currentSettings || getSavedAppSettings();
  const soundType: PhoneAlarmSound = resolveAlarmSound(reminder.ringTune, appSettings?.alarmSound);
  const volume = appSettings?.alarmVolume !== undefined ? appSettings.alarmVolume : 0.85;
  const vibrationEnabled = appSettings?.vibrationEnabled !== false;

  if (!isNativeApp()) {
    return true;
  }

  // Native Android APK execution:
  try {
    const hasPermission = await checkNotificationPermission();
    if (!hasPermission) {
      const granted = await requestNotificationPermission();
      if (!granted) {
        return false;
      }
    } else {
      await initNotificationChannel();
    }

    const isSilent = volume <= 0.01;
    const targetChannelId = getChannelIdForConfig(soundType, volume, vibrationEnabled);
    const soundFile = isSilent ? undefined : getSoundFileName(soundType);

    const appTheme = appSettings?.theme || 'dark-gold';
    const appLang = appSettings?.language || 'fa';

    const notificationsToSchedule: any[] = [
      {
        id: notifId,
        title,
        body,
        channelId: targetChannelId,
        schedule: {
          at: scheduledDate,
          allowWhileIdle: true,
        },
        sound: soundFile,
        iconColor: '#FF8C00',
        priority: 2,
        ongoing: true,
        autoCancel: false,
        actionTypeId: NOTIFICATION_ACTION_TYPE_ID,
        extra: {
          reminderId: reminder.id,
          dueTimestamp: reminder.dueTimestamp,
          sound: soundType,
          volume,
          vibrationEnabled,
          theme: appTheme,
          language: appLang,
          isRepeat: false,
        },
      },
      ...NOTIFICATION_REPEAT_OFFSETS_MINUTES.map((offsetMins, index) => ({
        id: ((notifId + 1000 + index + 1) % 600000000) + 1,
        title: reminder.title,
        body: reminder.description
          ? `${reminder.description} • ساعت ${timeFormatted}`
          : `ساعت ${timeFormatted}`,
        channelId: targetChannelId,
        schedule: {
          at: new Date(reminder.dueTimestamp + offsetMins * 60000),
          allowWhileIdle: true,
        },
        sound: soundFile,
        iconColor: '#FF8C00',
        priority: 2,
        ongoing: true,
        autoCancel: false,
        actionTypeId: NOTIFICATION_ACTION_TYPE_ID,
        extra: {
          reminderId: reminder.id,
          dueTimestamp: reminder.dueTimestamp,
          sound: soundType,
          volume,
          theme: appTheme,
          language: appLang,
          isRepeat: true,
          repeatIndex: index + 1,
        },
      })),
    ];

    await LocalNotifications.schedule({
      notifications: notificationsToSchedule,
    });

    return true;
  } catch (err) {
    console.warn(`Failed to schedule Local Notification for reminder ${reminder.id}:`, err);
    return false;
  }
}

/**
 * Cancels a previously scheduled Android Local Notification by reminder ID.
 */
export async function cancelReminderNotification(reminderId: string | number): Promise<boolean> {
  if (!isNativeApp()) {
    return true;
  }

  const allIds = getAllNotificationIdsForReminder(reminderId);
  try {
    await LocalNotifications.cancel({
      notifications: allIds.map((id) => ({ id })),
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
    (r) =>
      !r.deletedAt &&
      r.acknowledged !== true &&
      (r.status === 'pending' || r.status === 'postponed') &&
      r.dueTimestamp > now
  );

  if (isNativeApp()) {
    try {
      const validIds = new Set<number>([999999]);
      for (const r of upcomingPending) {
        for (const id of getAllNotificationIdsForReminder(r.id)) {
          validIds.add(id);
        }
      }
      const pending = await LocalNotifications.getPending();
      const staleToCancel = (pending.notifications || [])
        .filter(
          (n: any) =>
            typeof n.id === 'number' &&
            !validIds.has(n.id) &&
            n.id < 700000000 &&
            n.id !== 889911 &&
            n.id !== 889912 &&
            n.id !== 889915
        )
        .map((n: any) => ({ id: n.id }));
      if (staleToCancel.length > 0) {
        await LocalNotifications.cancel({ notifications: staleToCancel }).catch(() => {});
      }
    } catch {
      // ignore
    }
  }

  for (const reminder of upcomingPending) {
    await scheduleReminderNotification(reminder, appSettings);
  }
}

/**
 * Sets up listeners for user selecting quick actions (Done, Snooze, Edit, Dismiss/Stop).
 * Actions with foreground: false (Done, Snooze) run strictly in the background without launching or opening the app.
 * ONLY the 'edit' action button has foreground: true, which launches the app and opens the Edit Reminder screen.
 */
export function setupNotificationListeners(
  onComplete?: (reminderId: string) => void,
  onSnooze?: (reminderId: string, minutes: number, snoozedUntil?: number) => void,
  onStop?: (reminderId: string) => void,
  onOpen?: (reminderId: string) => void,
  onEdit?: (reminderId: string) => void,
  onNoReaction1m?: (reminderId: string, snoozedUntil?: number) => void
): void {
  if (!isNativeApp()) return;

  try {
    // Do NOT dismiss delivered notifications when app is in foreground so that out-of-app notification audio plays cleanly without interruption
    LocalNotifications.addListener('localNotificationReceived', () => {});

    LocalNotifications.addListener('localNotificationActionPerformed', async (action) => {
      const actionId = action.actionId;
      const notifId = action.notification?.id;
      const extraObj = action.notification?.extra || {};
      const reminderId = extraObj.reminderId;
      const isGeofenceNotif = Boolean(extraObj.geofence);
      const geofenceItemId: string = extraObj.geofenceItemId || extraObj.locationId || '';
      const snoozedUntil =
        typeof (action as any).snoozedUntil === 'number' ? (action as any).snoozedUntil : undefined;

      // Dedicated handling for Geofence notifications (Status Bar & Lockscreen Edit / Got It)
      if (isGeofenceNotif) {
        try {
          stopAlarmRinging();
          const bridge = (window as any).YaadGeofenceBridge;
          if (bridge && typeof bridge.stopGeofenceAlertAudio === 'function') {
            bridge.stopGeofenceAlertAudio();
          }
        } catch {}
        if (typeof notifId === 'number') {
          LocalNotifications.cancel({ notifications: [{ id: notifId }] }).catch(() => {});
          LocalNotifications.removeDeliveredNotifications({
            notifications: [{ id: notifId, title: '', body: '' }],
          }).catch(() => {});
        }
        if (actionId === 'edit' && geofenceItemId) {
          window.dispatchEvent(
            new CustomEvent('yaad:edit-geofence-radius', {
              detail: { geofenceItemId },
            })
          );
        }
        return;
      }

      // Handle notifications without reminderId (e.g. 60s test notification)
      if (!reminderId) {
        if (
          actionId === 'done' ||
          actionId === 'complete' ||
          actionId === 'snooze' ||
          actionId === 'edit' ||
          actionId === 'stop' ||
          actionId === 'dismiss'
        ) {
          try {
            stopAlarmRinging();
          } catch {}
          if (typeof notifId === 'number') {
            LocalNotifications.cancel({ notifications: [{ id: notifId }] }).catch(() => {});
            LocalNotifications.removeDeliveredNotifications({
              notifications: [{ id: notifId, title: '', body: '' }],
            }).catch(() => {});
          }
        } else if (actionId === 'tap' || !actionId) {
          try {
            stopAlarmRinging();
          } catch {}
          if (onOpen) onOpen('');
        }
        return;
      }

      if (actionId === 'mute_after_1m') {
        try {
          stopAlarmRinging();
        } catch {}
        // Do NOT cancel or dismiss the delivered notification! It stays pinned at the top of the dropdown shade
        // while the reminder itself is moved to +15m in the future in the app timeline.
        if (onNoReaction1m) onNoReaction1m(reminderId, snoozedUntil);
        return;
      }

      if (actionId === 'done' || actionId === 'complete') {
        try {
          stopAlarmRinging();
        } catch {}
        cancelReminderNotification(reminderId).catch(() => {});
        dismissDeliveredNotifications(reminderId).catch(() => {});
        if (onComplete) onComplete(reminderId);
      } else if (actionId === 'snooze') {
        try {
          stopAlarmRinging();
        } catch {}
        cancelReminderNotification(reminderId).catch(() => {});
        dismissDeliveredNotifications(reminderId).catch(() => {});
        if (onSnooze) onSnooze(reminderId, 15, snoozedUntil);
      } else if (actionId === 'edit') {
        try {
          stopAlarmRinging();
        } catch {}
        cancelReminderNotification(reminderId).catch(() => {});
        dismissDeliveredNotifications(reminderId).catch(() => {});
        if (onEdit) onEdit(reminderId);
      } else if (actionId === 'stop' || actionId === 'dismiss') {
        try {
          stopAlarmRinging();
        } catch {}
        cancelReminderNotification(reminderId).catch(() => {});
        dismissDeliveredNotifications(reminderId).catch(() => {});
        if (onStop) onStop(reminderId);
      } else if (actionId === 'tap' || !actionId) {
        try {
          stopAlarmRinging();
        } catch {}
        // Tapping notification body opens the app directly to the Reminders Timeline
        if (onOpen) onOpen(reminderId);
      }
    });
  } catch (err) {
    console.warn('Could not set up local notification listeners:', err);
  }
}

/**
 * Triggers a persistent out-of-app notification (Service Worker / OS Notification / Native)
 * that stays open in the status bar while the alarm rings for 1 minute.
 */
export async function triggerOutOfAppPersistentNotification(
  reminder: Reminder,
  settings?: AppSettings,
  onClickOpen?: (r: Reminder) => void
): Promise<void> {
  // On Native Android Capacitor, TimedNotificationPublisher already fires the scheduled notification & sound at dueTimestamp.
  // Avoid re-scheduling a second duplicate notification from JS which would cause two sounds with a time lag.
  if (isNativeApp()) {
    return;
  }

  const isEn = settings?.language === 'en';
  const timeFormatted = formatJalaliTime(reminder.dueTimestamp, isEn ? 'en' : 'fa');
  const title = reminder.title;
  const body = reminder.description
    ? `${reminder.description} • ${timeFormatted}`
    : isEn
    ? `Time: ${timeFormatted}`
    : `ساعت ${timeFormatted}`;
  const vibrationEnabled = settings?.vibrationEnabled !== false;

  // 2. Web / PWA Service Worker persistent notification with action buttons
  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
    const actions = [
      { action: 'done', title: isEn ? '✓ Done' : '✓ انجام شد' },
      { action: 'snooze', title: isEn ? '⏱ Snooze 15m' : '⏱ تعویق ۱۵ دقیقه' },
      { action: 'edit', title: isEn ? '✎ Edit' : '✎ ویرایش' },
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
            badge: '/pwa-192x192.png',
            tag: `yaad-rem-${reminder.id}`,
            renotify: true,
            requireInteraction: true,
            vibrate: vibrationEnabled ? [500, 250, 500, 250, 500] : [],
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
        badge: '/pwa-192x192.png',
        tag: `yaad-rem-${reminder.id}`,
        renotify: true,
        requireInteraction: true,
        data: { reminderId: reminder.id, persistentUntilReaction: true },
      } as any);
      notif.onclick = () => {
        window.focus();
        if (onClickOpen) onClickOpen(reminder);
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

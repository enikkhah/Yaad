import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { AppSettings, InProgressItem } from '../types';
import { toPersianDigits } from './jalali';
import {
  NOTIFICATION_CHANNEL_ID,
  getChannelIdForConfig,
  requestNotificationPermission,
} from './nativeLocalNotifications';

export const IN_PROGRESS_STORAGE_KEY = 'fa_in_progress_items_v1';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Generates a deterministic 32-bit integer notification ID in the 800,000,000+ range
 * so it never collides with time/location reminder notification IDs.
 */
export const getInProgressNotificationId = (itemId: string): number => {
  let hash = 0;
  const key = `in_progress_${itemId}`;
  for (let i = 0; i < key.length; i++) {
    const char = key.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return 800000000 + (Math.abs(hash) % 100000000);
};

/**
 * Cancels the pending inactivity notification for an In-Progress item.
 */
export const cancelInProgressInactivityNotification = async (itemId: string): Promise<void> => {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const notifId = getInProgressNotificationId(itemId);
    await LocalNotifications.cancel({
      notifications: [{ id: notifId }],
    });
  } catch (err) {
    console.warn('Error cancelling in-progress inactivity notification:', err);
  }
};

/**
 * Schedules (or resets) a smart inactivity reminder notification via Capacitor Local Notifications.
 * Whenever an item's progress is updated (`lastUpdatedAt = Date.now()`), calling this function
 * cancels the old timer and schedules a fresh notification for `lastUpdatedAt + inactivityDays * 86400000`.
 */
export const scheduleInProgressInactivityNotification = async (
  item: InProgressItem,
  settings?: AppSettings
): Promise<void> => {
  // Always cancel any existing notification first so updating progress resets the countdown
  await cancelInProgressInactivityNotification(item.id);

  if (
    item.completed ||
    item.deletedAt ||
    !item.inactivityReminderEnabled ||
    !item.inactivityDays ||
    item.inactivityDays <= 0
  ) {
    return;
  }

  if (settings && settings.systemNotificationsEnabled === false) {
    return;
  }

  const triggerTimestamp = item.lastUpdatedAt + item.inactivityDays * DAY_MS;
  const now = Date.now();

  // Only schedule future notifications (at least 5 seconds ahead)
  if (triggerTimestamp <= now + 5000) {
    return;
  }

  if (!Capacitor.isNativePlatform()) {
    return;
  }

  try {
    const hasPermission = await requestNotificationPermission();
    if (!hasPermission) return;

    const isEn = settings?.language === 'en';
    const notifId = getInProgressNotificationId(item.id);
    const daysText = isEn ? `${item.inactivityDays}` : toPersianDigits(item.inactivityDays);
    const currentText = isEn ? `${item.currentProgress}` : toPersianDigits(item.currentProgress);
    const totalText =
      item.totalProgress && item.totalProgress > 0
        ? isEn
          ? ` / ${item.totalProgress}`
          : ` از ${toPersianDigits(item.totalProgress)}`
        : '';

    const title = isEn
      ? `⏳ Continue In-Progress: ${item.title}`
      : `⏳ یادآوری ادامه کار در جریان: ${item.title}`;

    const body = isEn
      ? `No update for ${daysText} days (Current: ${currentText}${totalText} ${item.unit}). Ready to make some progress?`
      : `${daysText} روز از آخرین بروزرسانی «${item.title}» گذشته است (پیشرفت فعلی: ${currentText}${totalText} ${item.unit}). وقت ادامه دادن است!`;

    const channelId = settings
      ? getChannelIdForConfig(
          settings.alarmSound || 'digital_beep',
          settings.alarmVolume ?? 0.85,
          settings.vibrationEnabled !== false
        )
      : NOTIFICATION_CHANNEL_ID;

    await LocalNotifications.schedule({
      notifications: [
        {
          id: notifId,
          title,
          body,
          schedule: {
            at: new Date(triggerTimestamp),
            allowWhileIdle: true,
          },
          channelId,
          extra: {
            inProgressItemId: item.id,
            type: 'in_progress_inactivity',
          },
        },
      ],
    });
  } catch (err) {
    console.warn('Error scheduling in-progress inactivity notification:', err);
  }
};

/**
 * Synchronizes all In-Progress items with Capacitor Local Notifications.
 */
export const syncAllInProgressNotifications = async (
  items: InProgressItem[],
  settings?: AppSettings
): Promise<void> => {
  if (!Capacitor.isNativePlatform()) return;
  try {
    for (const item of items) {
      await scheduleInProgressInactivityNotification(item, settings);
    }
  } catch (err) {
    console.warn('Error syncing in-progress notifications:', err);
  }
};

/**
 * Returns the elapsed days since lastUpdatedAt.
 */
export const getInactiveDaysCount = (item: InProgressItem, nowMs: number = Date.now()): number => {
  const diff = Math.max(0, nowMs - item.lastUpdatedAt);
  return Math.floor(diff / DAY_MS);
};

/**
 * Returns true if the item is active, has inactivity reminder enabled, and has not been updated
 * for at least `inactivityDays` days.
 */
export const isInProgressItemOverdue = (
  item: InProgressItem,
  nowMs: number = Date.now()
): boolean => {
  if (item.completed || item.deletedAt || !item.inactivityReminderEnabled) return false;
  const thresholdMs = (item.inactivityDays || 3) * DAY_MS;
  return nowMs - item.lastUpdatedAt >= thresholdMs;
};

/**
 * Formats relative time since last update in Persian or English.
 */
export const formatRelativeLastUpdate = (
  lastUpdatedAt: number,
  nowMs: number,
  isEn: boolean
): string => {
  const diffSec = Math.max(0, Math.floor((nowMs - lastUpdatedAt) / 1000));
  if (diffSec < 60) {
    return isEn ? 'Just now' : 'لحظاتی پیش';
  }
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return isEn ? `${diffMin}m ago` : `${toPersianDigits(diffMin)} دقیقه پیش`;
  }
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) {
    return isEn ? `${diffHours}h ago` : `${toPersianDigits(diffHours)} ساعت پیش`;
  }
  const diffDays = Math.floor(diffHours / 24);
  return isEn ? `${diffDays}d ago` : `${toPersianDigits(diffDays)} روز پیش`;
};

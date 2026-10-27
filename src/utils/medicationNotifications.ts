import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { MedicationItem } from '../types';
import { toPersianDigits } from './jalali';
import { getMedicationInstructionLabel } from './medicationFuzzy';
import {
  getChannelIdForConfig,
  getSavedAppSettings,
  getSoundFileName,
  initNotificationChannel,
} from './nativeLocalNotifications';

export const MEDICATION_STORAGE_KEY = 'fa_medication_app_data_v1';
export const MEDICATION_CHANNEL_ID = 'yaad_medication_channel_v1';

const ROLLING_WINDOW_DAYS = 7;

function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Formats a Date or timestamp into a local YYYY-MM-DD key used for daily dose checklists and logs.
 */
export function getLocalDayKey(tsOrDate: number | Date = Date.now()): string {
  const d = typeof tsOrDate === 'number' ? new Date(tsOrDate) : tsOrDate;
  const yyyy = d.getFullYear();
  const mm = (d.getMonth() + 1).toString().padStart(2, '0');
  const dd = d.getDate().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Generates a deterministic 32-bit positive integer Notification ID
 * for a specific medication + dayOffset + timeSlotIndex (or specific dateKey + scheduledTime).
 */
export function getMedicationDoseNotificationId(
  medicationId: string,
  dateKey: string,
  scheduledTime: string
): number {
  const raw = `yaad_med_${medicationId}_${dateKey}_${scheduledTime}`;
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (Math.abs(hash) % 800000000) + 1100000000;
}

/**
 * Checks whether a medication's treatment course is still active on a given timestamp.
 */
export function isMedicationActiveOnDate(med: MedicationItem, targetMs: number = Date.now()): boolean {
  if (!med.active || med.deletedAt) return false;
  if (!med.durationDays || med.durationDays <= 0) return true; // Unlimited / ongoing

  const startDay = new Date(med.startDate);
  startDay.setHours(0, 0, 0, 0);
  const endMs = startDay.getTime() + med.durationDays * 24 * 60 * 60 * 1000;
  return targetMs < endMs;
}

/**
 * Returns remaining treatment days if durationDays is set, or null if unlimited.
 */
export function getRemainingTreatmentDays(med: MedicationItem, nowMs: number = Date.now()): number | null {
  if (!med.durationDays || med.durationDays <= 0) return null;
  const startDay = new Date(med.startDate);
  startDay.setHours(0, 0, 0, 0);
  const endMs = startDay.getTime() + med.durationDays * 24 * 60 * 60 * 1000;
  const diffDays = Math.ceil((endMs - nowMs) / (24 * 60 * 60 * 1000));
  return Math.max(0, diffDays);
}

/**
 * Checks if a medication has low remaining stock (<= 2 days worth of doses or <= 0).
 */
export function isMedicationLowStock(med: MedicationItem): boolean {
  if (med.stockCount === undefined || med.stockCount === null) return false;
  const dailyConsumption = Math.max(1, med.scheduledTimes.length) * (med.dosageAmount || 1);
  const threshold = Math.max(med.dosageAmount || 1, dailyConsumption * 2);
  return med.stockCount <= threshold;
}

/**
 * Initializes the high-priority Medication Android Notification Channel with raw sound support.
 */
export async function initMedicationNotificationChannel(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    await initNotificationChannel();
    await LocalNotifications.createChannel({
      id: MEDICATION_CHANNEL_ID,
      name: 'یادآور تخصصی دارو (YAAD)',
      description: 'هشدار با اولویت بالا برای نوبت‌های مصرف دارو',
      importance: 5, // IMPORTANCE_HIGH (Heads-up banner + sound)
      visibility: 1, // VISIBILITY_PUBLIC
      sound: 'urgent_bell.wav',
      vibration: true,
    });
  } catch (err) {
    console.warn('Could not create medication notification channel:', err);
  }
}

/**
 * Cancels the notification for a single specific dose slot (e.g. when user checks it off in Daily Checklist).
 */
export async function cancelSingleMedicationDoseNotification(
  medicationId: string,
  dateKey: string,
  scheduledTime: string
): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const id = getMedicationDoseNotificationId(medicationId, dateKey, scheduledTime);
    await LocalNotifications.cancel({ notifications: [{ id }] }).catch(() => {});
    await LocalNotifications.removeDeliveredNotifications({
      notifications: [{ id, title: '', body: '' }],
    }).catch(() => {});
  } catch (err) {
    console.warn('Failed to cancel single medication dose notification:', err);
  }
}

/**
 * Cancels all scheduled notifications across the 7-day rolling window for a medication.
 */
export async function cancelMedicationNotifications(med: MedicationItem): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const now = new Date();
    const idsToCancel: { id: number }[] = [];

    for (let dayOffset = -1; dayOffset <= ROLLING_WINDOW_DAYS + 1; dayOffset++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset);
      const dateKey = getLocalDayKey(d);
      for (const timeStr of med.scheduledTimes) {
        idsToCancel.push({
          id: getMedicationDoseNotificationId(med.id, dateKey, timeStr),
        });
      }
    }

    if (idsToCancel.length > 0) {
      await LocalNotifications.cancel({ notifications: idsToCancel }).catch(() => {});
    }
  } catch (err) {
    console.warn('Failed to cancel medication notifications:', err);
  }
}

/**
 * Schedules high-priority Capacitor Local Notifications for the next 7 days (Rolling Window)
 * for a given medication, skipping any dose slots already marked as taken/missed in history.
 */
export async function scheduleMedicationNotifications(
  med: MedicationItem,
  language: 'fa' | 'en' = 'fa'
): Promise<void> {
  if (!isNativeApp()) return;

  try {
    await cancelMedicationNotifications(med);
    if (!med.active || med.deletedAt) return;
    if (med.stockCount !== undefined && med.stockCount <= 0) return;

    await initMedicationNotificationChannel();

    const savedSettings = getSavedAppSettings();
    const chosenSound = med.soundId || savedSettings?.alarmSound || 'urgent_bell';
    const soundFile = getSoundFileName(chosenSound);
    const channelId = getChannelIdForConfig(
      chosenSound,
      savedSettings?.alarmVolume ?? 0.9,
      savedSettings?.vibrationEnabled !== false
    );

    const isEn = language === 'en';
    const nowMs = Date.now();
    const today = new Date(nowMs);
    const notificationsToSchedule: any[] = [];

    const instructionText = getMedicationInstructionLabel(med.instruction, isEn);
    const doseDisplay = isEn
      ? `${med.dosageAmount} ${med.dosageUnit}`
      : `${toPersianDigits(med.dosageAmount)} ${med.dosageUnit}`;

    for (let dayOffset = 0; dayOffset < ROLLING_WINDOW_DAYS; dayOffset++) {
      const targetDate = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate() + dayOffset
      );
      const dateKey = getLocalDayKey(targetDate);

      for (const timeStr of med.scheduledTimes) {
        const [hStr, mStr] = timeStr.split(':');
        const hour = parseInt(hStr || '8', 10);
        const minute = parseInt(mStr || '0', 10);

        const slotDate = new Date(
          targetDate.getFullYear(),
          targetDate.getMonth(),
          targetDate.getDate(),
          hour,
          minute,
          0,
          0
        );
        const slotMs = slotDate.getTime();

        // Only schedule future slots within the active treatment duration
        if (slotMs <= nowMs + 3000) continue;
        if (!isMedicationActiveOnDate(med, slotMs)) continue;

        // Skip if already logged (taken or missed) for this dateKey + scheduledTime
        const alreadyLogged = med.history.some(
          (log) => log.dateKey === dateKey && log.scheduledTime === timeStr
        );
        if (alreadyLogged) continue;

        const notifId = getMedicationDoseNotificationId(med.id, dateKey, timeStr);
        const formattedTime = isEn ? timeStr : toPersianDigits(timeStr);

        const title = isEn
          ? `💊 Medication Time: ${med.name}`
          : `💊 زمان مصرف دارو: ${med.name}`;

        const body = isEn
          ? `Dose: ${doseDisplay} • ${instructionText} (${formattedTime})`
          : `مقدار: ${doseDisplay} • ${instructionText} (نوبت ساعت ${formattedTime})`;

        notificationsToSchedule.push({
          id: notifId,
          title,
          body,
          schedule: {
            at: slotDate,
            allowWhileIdle: true,
          },
          channelId: channelId || MEDICATION_CHANNEL_ID,
          sound: soundFile,
          smallIcon: 'ic_stat_notify',
          extra: {
            type: 'medication_dose',
            medicationId: med.id,
            dateKey,
            scheduledTime: timeStr,
          },
        });
      }
    }

    if (notificationsToSchedule.length > 0) {
      await LocalNotifications.schedule({
        notifications: notificationsToSchedule,
      });
    }
  } catch (err) {
    console.warn('Failed to schedule medication notifications:', err);
  }
}

/**
 * Syncs notifications for all active medications.
 */
export async function syncAllMedicationsNotifications(
  medications: MedicationItem[],
  language: 'fa' | 'en' = 'fa'
): Promise<void> {
  if (!isNativeApp()) return;
  for (const med of medications) {
    if (!med.deletedAt && med.active) {
      await scheduleMedicationNotifications(med, language);
    } else {
      await cancelMedicationNotifications(med);
    }
  }
}

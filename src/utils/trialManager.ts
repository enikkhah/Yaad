import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { LocalNotifications } from '@capacitor/local-notifications';

export const TRIAL_DURATION_DAYS = 40;
export const TRIAL_DURATION_MS = TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const CLOCK_ROLLBACK_TOLERANCE_MS = 2 * 60 * 1000; // 2 minutes grace for NTP / minor drift

const TRIAL_STORAGE_KEY = 'yaad_trial_state_v1';
const TRIAL_BANNER_DISMISSED_KEY = 'yaad_trial_banner_dismissed_v1';
const TRIAL_DATA_FILE_PATH = 'YAAD/yaad_trial_v1.json';

export const TRIAL_NOTIFICATION_IDS = {
  DAY_30: 750000030,
  DAY_37: 750000037,
  DAY_40: 750000040,
} as const;

export interface PersistedTrialRecord {
  version: number;
  trialStartedAt: number;
  lastSeenAt: number;
  clockTampered?: boolean;
  updatedAt: number;
}

export interface TrialStatus {
  trialStartedAt: number;
  trialEndsAt: number;
  lastSeenAt: number;
  effectiveNow: number;
  elapsedDays: number;
  remainingDays: number;
  remainingMs: number;
  isTrialActive: boolean;
  isExpired: boolean;
  clockTampered: boolean;
  shouldShowSoftBanner: boolean;
}

const isNative = (): boolean => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

function isValidTrialRecord(raw: any): raw is PersistedTrialRecord {
  return Boolean(
    raw &&
      typeof raw === 'object' &&
      typeof raw.trialStartedAt === 'number' &&
      Number.isFinite(raw.trialStartedAt) &&
      raw.trialStartedAt > 1_600_000_000_000 && // sanity > Sep 2020
      typeof raw.lastSeenAt === 'number' &&
      Number.isFinite(raw.lastSeenAt) &&
      raw.lastSeenAt >= raw.trialStartedAt
  );
}

function readLocalTrialRecord(): PersistedTrialRecord | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(TRIAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isValidTrialRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeLocalTrialRecord(record: PersistedTrialRecord): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(TRIAL_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // ignore storage quota failures
  }
}

async function readNativeTrialRecord(): Promise<PersistedTrialRecord | null> {
  if (!isNative()) return null;
  try {
    const res = await Filesystem.readFile({
      path: TRIAL_DATA_FILE_PATH,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    });
    if (!res?.data) return null;
    const text = typeof res.data === 'string' ? res.data : String(res.data);
    const parsed = JSON.parse(text);
    return isValidTrialRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function writeNativeTrialRecord(record: PersistedTrialRecord): Promise<void> {
  if (!isNative()) return;
  try {
    await Filesystem.mkdir({
      path: 'YAAD',
      directory: Directory.Data,
      recursive: true,
    }).catch(() => {});
    await Filesystem.writeFile({
      path: TRIAL_DATA_FILE_PATH,
      data: JSON.stringify(record),
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    });
  } catch {
    // ignore filesystem errors
  }
}

function mergeRecords(
  a: PersistedTrialRecord | null,
  b: PersistedTrialRecord | null,
  deviceNow: number
): { record: PersistedTrialRecord; rollbackDetected: boolean } {
  const candidates = [a, b].filter((r): r is PersistedTrialRecord => Boolean(r));
  if (candidates.length === 0) {
    return {
      record: {
        version: 1,
        trialStartedAt: deviceNow,
        lastSeenAt: deviceNow,
        clockTampered: false,
        updatedAt: deviceNow,
      },
      rollbackDetected: false,
    };
  }

  // Earliest start time prevents resetting the trial via deleting one storage layer;
  // Highest lastSeenAt prevents resetting monotonic clock progress.
  const earliestStart = Math.min(...candidates.map((c) => c.trialStartedAt));
  const highestSeen = Math.max(...candidates.map((c) => c.lastSeenAt));
  const wasAlreadyTampered = candidates.some((c) => Boolean(c.clockTampered));

  const rollbackDetected = deviceNow < highestSeen - CLOCK_ROLLBACK_TOLERANCE_MS;
  const nextLastSeen = Math.max(highestSeen, deviceNow);
  // Once monotonic time catches up well past highestSeen, clear transient clockTampered flag
  // only if trial isn't already over or clock wasn't repeatedly pulled far back; keep monotonic lastSeen!
  const clockTampered = rollbackDetected || (wasAlreadyTampered && deviceNow < highestSeen);

  return {
    record: {
      version: 1,
      trialStartedAt: earliestStart,
      lastSeenAt: nextLastSeen,
      clockTampered,
      updatedAt: deviceNow,
    },
    rollbackDetected,
  };
}

export function isTrialBannerDismissedRecently(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = localStorage.getItem(TRIAL_BANNER_DISMISSED_KEY);
    if (!raw) return false;
    const dismissedAt = Number(raw);
    if (!Number.isFinite(dismissedAt)) return false;
    // Re-show soft banner every 24h if still in final days or expired
    return Date.now() - dismissedAt < DAY_MS;
  } catch {
    return false;
  }
}

export function dismissTrialBanner(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(TRIAL_BANNER_DISMISSED_KEY, String(Date.now()));
  } catch {
    // ignore
  }
}

export function buildTrialStatus(record: PersistedTrialRecord, deviceNow: number = Date.now()): TrialStatus {
  const effectiveNow = Math.max(deviceNow, record.lastSeenAt);
  const trialEndsAt = record.trialStartedAt + TRIAL_DURATION_MS;
  const elapsedMs = Math.max(0, effectiveNow - record.trialStartedAt);
  const elapsedDays = Math.floor(elapsedMs / DAY_MS);
  const remainingMs = Math.max(0, trialEndsAt - effectiveNow);
  const remainingDays = Math.max(0, Math.ceil(remainingMs / DAY_MS));
  const isExpired = effectiveNow >= trialEndsAt;
  const isTrialActive = !isExpired;
  const shouldShowSoftBanner =
    !isTrialBannerDismissedRecently() && (isExpired || elapsedDays >= 30);

  return {
    trialStartedAt: record.trialStartedAt,
    trialEndsAt,
    lastSeenAt: record.lastSeenAt,
    effectiveNow,
    elapsedDays,
    remainingDays,
    remainingMs,
    isTrialActive,
    isExpired,
    clockTampered: Boolean(record.clockTampered),
    shouldShowSoftBanner,
  };
}

/**
 * Synchronous fast read for initial render using localStorage cache.
 * Full reconciliation with Directory.Data happens immediately via initAndReconcileTrialState().
 */
export function getFastTrialStatusSync(): TrialStatus {
  const now = Date.now();
  const local = readLocalTrialRecord();
  const { record } = mergeRecords(local, null, now);
  if (!local) {
    writeLocalTrialRecord(record);
  }
  return buildTrialStatus(record, now);
}

/**
 * Reconciles Trial start timestamp & monotonic lastSeenAt across localStorage and Directory.Data.
 * Rejects clock-rollback attempts without crashing or wiping any user data.
 */
export async function initAndReconcileTrialState(): Promise<TrialStatus> {
  const now = Date.now();
  const local = readLocalTrialRecord();
  const nativeRec = await readNativeTrialRecord();

  const { record } = mergeRecords(local, nativeRec, now);
  writeLocalTrialRecord(record);
  await writeNativeTrialRecord(record);

  return buildTrialStatus(record, now);
}

/**
 * Updates monotonic lastSeenAt periodically (e.g., on app foreground resume).
 */
export async function touchTrialClockTick(): Promise<TrialStatus> {
  return initAndReconcileTrialState();
}

export async function cancelTrialNotifications(): Promise<void> {
  if (!isNative()) return;
  try {
    await LocalNotifications.cancel({
      notifications: [
        { id: TRIAL_NOTIFICATION_IDS.DAY_30 },
        { id: TRIAL_NOTIFICATION_IDS.DAY_37 },
        { id: TRIAL_NOTIFICATION_IDS.DAY_40 },
      ],
    }).catch(() => {});
  } catch {
    // ignore
  }
}

/**
 * Schedules Day 30, Day 37, and Day 40 Trial reminder notifications (local notifications).
 * Automatically skipped/canceled if the user already owns a valid paid Pro plan.
 */
export async function scheduleTrialMilestoneNotifications(
  trialStatus: TrialStatus,
  hasPaidPro: boolean,
  language: 'fa' | 'en' = 'fa'
): Promise<void> {
  if (!isNative()) return;

  if (hasPaidPro || trialStatus.isExpired) {
    await cancelTrialNotifications();
    return;
  }

  try {
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted') return;

    const now = trialStatus.effectiveNow;
    const isFa = language === 'fa';

    const milestones = [
      {
        id: TRIAL_NOTIFICATION_IDS.DAY_30,
        day: 30,
        at: new Date(trialStatus.trialStartedAt + 30 * DAY_MS),
        title: isFa ? '۱۰ روز تا پایان دوره هدیه ۴۰ روزه یاد' : '10 days left in your 40-day YAAD trial',
        body: isFa
          ? 'همه امکانات پیشرفته یاد هنوز برای شما فعال است. برای ادامه بدون وقفه پس از روز ۴۰، نسخه Pro را ببینید.'
          : 'All Pro features are still active. Explore YAAD Pro to keep them unlocked after day 40.',
      },
      {
        id: TRIAL_NOTIFICATION_IDS.DAY_37,
        day: 37,
        at: new Date(trialStatus.trialStartedAt + 37 * DAY_MS),
        title: isFa ? '۳ روز پایانی دوره رایگان امکانات Pro' : '3 days left in your YAAD Pro trial',
        body: isFa
          ? 'فقط ۳ روز تا پایان دسترسی رایگان به حصار مکانی، مناسبت‌ها، عکس، دست‌خط، بک‌آپ و تم‌ها باقی مانده است.'
          : 'Only 3 days left before Pro features lock. All your saved data remains safe.',
      },
      {
        id: TRIAL_NOTIFICATION_IDS.DAY_40,
        day: 40,
        at: new Date(trialStatus.trialStartedAt + 40 * DAY_MS),
        title: isFa ? 'پایان دوره ۴۰ روزه امکانات Pro یاد' : 'Your 40-day YAAD Pro trial has ended',
        body: isFa
          ? 'یادآورهای نامحدود و زنگ تمام‌صفحه همچنان رایگان است. برای فعال‌سازی دوباره امکانات پیشرفته، نسخه Pro را فعال کنید.'
          : 'Unlimited reminders & full-screen alarms stay free forever. Upgrade to Pro anytime.',
      },
    ];

    const futureOnes = milestones.filter((m) => m.at.getTime() > Date.now() + 30_000 && m.at.getTime() > now);
    const pastIds = milestones
      .filter((m) => m.at.getTime() <= Date.now() + 30_000)
      .map((m) => ({ id: m.id }));

    if (pastIds.length > 0) {
      await LocalNotifications.cancel({ notifications: pastIds }).catch(() => {});
    }

    if (futureOnes.length > 0) {
      await LocalNotifications.cancel({ notifications: futureOnes.map((m) => ({ id: m.id })) }).catch(() => {});
      await LocalNotifications.schedule({
        notifications: futureOnes.map((m) => ({
          id: m.id,
          title: m.title,
          body: m.body,
          schedule: {
            at: m.at,
            allowWhileIdle: true,
          },
          channelId: 'yaad_channel_v3_digital_beep',
          extra: {
            openPro: true,
            trialMilestoneDay: m.day,
          },
        })),
      });
    }
  } catch {
    // non-fatal if notification scheduling is declined or restricted
  }
}

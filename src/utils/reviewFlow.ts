import { Capacitor } from '@capacitor/core';
import { AppLauncher } from '@capacitor/app-launcher';
import { Preferences } from '@capacitor/preferences';
import { Share } from '@capacitor/share';
import { APP_VERSION } from './version';
import { getStoreTarget } from '../config/billingConfig';

export const PACKAGE_NAME = 'com.yaad.reminder';
export const SUPPORT_EMAIL = 'info@narvanteam.ir';
export const FORMSPREE_ENDPOINT = 'https://formspree.io/f/narvanapplications@gmail.com';

const FEEDBACK_STATE_STORAGE_KEY = 'yaad_two_stage_feedback_state_v2';
const LEGACY_REVIEW_STATE_KEY = 'yaad_review_flow_completed_v1';
const FEEDBACK_LIST_KEY = 'yaad_user_internal_feedbacks_v1';

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const FORMSPREE_TIMEOUT_MS = 10_000;

export const MAX_FEEDBACK_LENGTH = 2000;
export const MAX_LOCAL_FEEDBACK_ITEMS = 20;
export const SIMPLE_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ReviewTargetStore = 'bazaar' | 'myket' | 'auto';
export type ReviewCompletionReason = 'rated' | 'feedback_sent' | 'dismissed';
export type FeedbackSubmitVia = 'formspree' | 'mailto' | 'failed';

export interface TwoStageFeedbackPersistedState {
  hasGivenFeedback: boolean;
  successCount: number;
  targetThreshold: number;
  lastDismissedAt: number | null;
  completedReason?: ReviewCompletionReason;
  completedAt?: number;
}

export interface TriggerReviewFlowOptions {
  store?: ReviewTargetStore;
  delayMs?: number;
  forceOpen?: boolean;
  onSubmitFeedback?: (feedbackText: string) => Promise<void> | void;
}

export const YAAD_OPEN_FEEDBACK_MODAL_EVENT = 'yaad:open-two-stage-feedback-modal';

/**
 * تولید عدد تصادفی صحیح بین ۵ تا ۱۰ (شامل ۵ و ۱۰)
 */
export function getRandomThresholdBetween5And10(): number {
  return Math.floor(Math.random() * 6) + 5;
}

function getDefaultState(): TwoStageFeedbackPersistedState {
  return {
    hasGivenFeedback: false,
    successCount: 0,
    targetThreshold: getRandomThresholdBetween5And10(),
    lastDismissedAt: null,
  };
}

/**
 * خواندن وضعیت بازخورد دو مرحله‌ای از LocalStorage
 */
export function getTwoStageFeedbackState(): TwoStageFeedbackPersistedState {
  if (typeof window === 'undefined') {
    return getDefaultState();
  }

  try {
    const raw = localStorage.getItem(FEEDBACK_STATE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<TwoStageFeedbackPersistedState>;
      const threshold =
        typeof parsed.targetThreshold === 'number' &&
        parsed.targetThreshold >= 5 &&
        parsed.targetThreshold <= 10
          ? parsed.targetThreshold
          : getRandomThresholdBetween5And10();

      return {
        hasGivenFeedback: Boolean(parsed.hasGivenFeedback),
        successCount: typeof parsed.successCount === 'number' ? Math.max(0, parsed.successCount) : 0,
        targetThreshold: threshold,
        lastDismissedAt: typeof parsed.lastDismissedAt === 'number' ? parsed.lastDismissedAt : null,
        completedReason: parsed.completedReason,
        completedAt: parsed.completedAt,
      };
    }

    // بررسی سازگاری با نسخه قبلی در صورتی که کاربر قبلاً امتیاز یا نظر ثبت کرده باشد
    const legacyRaw = localStorage.getItem(LEGACY_REVIEW_STATE_KEY);
    if (legacyRaw) {
      const legacyParsed = JSON.parse(legacyRaw);
      if (legacyParsed?.status === 'rated' || legacyParsed?.status === 'feedback_sent') {
        const migrated: TwoStageFeedbackPersistedState = {
          hasGivenFeedback: true,
          successCount: 0,
          targetThreshold: getRandomThresholdBetween5And10(),
          lastDismissedAt: null,
          completedReason: legacyParsed.status,
          completedAt: legacyParsed.timestamp || Date.now(),
        };
        saveTwoStageFeedbackState(migrated);
        return migrated;
      }
    }
  } catch {
    // ignore storage parse errors
  }

  const initial = getDefaultState();
  saveTwoStageFeedbackState(initial);
  return initial;
}

/**
 * ذخیره وضعیت بازخورد در LocalStorage و Capacitor Preferences
 */
export function saveTwoStageFeedbackState(state: TwoStageFeedbackPersistedState): void {
  if (typeof window === 'undefined') return;
  const serialized = JSON.stringify(state);

  try {
    localStorage.setItem(FEEDBACK_STATE_STORAGE_KEY, serialized);
  } catch {
    // ignore quota errors
  }

  try {
    Preferences.set({
      key: FEEDBACK_STATE_STORAGE_KEY,
      value: serialized,
    }).catch(() => {});
  } catch {
    // ignore
  }
}

/**
 * ثبت نهایی بازخورد (زمانی که کاربر امتیاز داده یا فرم پیشنهاد را با موفقیت ارسال کرده است)
 */
export async function markReviewFlowCompleted(reason: ReviewCompletionReason): Promise<void> {
  const current = getTwoStageFeedbackState();

  if (reason === 'dismissed') {
    markFeedbackModalDismissed();
    return;
  }

  const updated: TwoStageFeedbackPersistedState = {
    ...current,
    hasGivenFeedback: true,
    completedReason: reason,
    completedAt: Date.now(),
  };
  saveTwoStageFeedbackState(updated);
}

/**
 * ثبت بستن پنجره (دکمه X یا گزینه «بعداً») بدون ثبت بازخورد:
 * زمان آخرین نمایش ذخیره می‌شود تا حداقل ۳ روز دیگر نمایش داده نشود،
 * شمارنده صفر شده و یک آستانه تصادفی جدید بین ۵ تا ۱۰ تعیین می‌گردد.
 */
export function markFeedbackModalDismissed(): void {
  const current = getTwoStageFeedbackState();
  const updated: TwoStageFeedbackPersistedState = {
    ...current,
    lastDismissedAt: Date.now(),
    successCount: 0,
    targetThreshold: getRandomThresholdBetween5And10(),
  };
  saveTwoStageFeedbackState(updated);
}

async function canLaunchUrl(url: string): Promise<boolean> {
  try {
    const res = await AppLauncher.canOpenUrl({ url });
    return Boolean(res?.value);
  } catch {
    return false;
  }
}

async function tryOpenUrl(url: string): Promise<boolean> {
  try {
    const res = await AppLauncher.openUrl({ url });
    return res?.completed !== false;
  } catch {
    return false;
  }
}

async function openExternalWebUrl(url: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const opened = await tryOpenUrl(url);
    if (opened) return;
  }
  if (typeof window !== 'undefined') {
    window.location.href = url;
  }
}

/**
 * باز کردن صفحه ثبت نظر در کافه‌بازار یا مایکت بر اساس VITE_STORE و Capacitor AppLauncher
 */
export async function openStoreReviewPage(store: ReviewTargetStore = 'auto'): Promise<void> {
  const bazaarDeepLink = `bazaar://details?id=${PACKAGE_NAME}`;
  const myketDeepLink = `myket://comment?id=${PACKAGE_NAME}`;
  const bazaarWebFallback = `https://cafebazaar.ir/app/${PACKAGE_NAME}`;
  const myketWebFallback = `https://myket.ir/app/${PACKAGE_NAME}`;

  const envStore = getStoreTarget();
  let effectiveStore: ReviewTargetStore;
  if (envStore === 'bazaar') {
    effectiveStore = 'bazaar';
  } else if (envStore === 'myket') {
    effectiveStore = 'myket';
  } else {
    effectiveStore = store;
  }

  if (!Capacitor.isNativePlatform()) {
    if (typeof window !== 'undefined') {
      window.location.href = effectiveStore === 'myket' ? myketWebFallback : bazaarWebFallback;
    }
    return;
  }

  if (effectiveStore === 'bazaar') {
    const opened = await tryOpenUrl(bazaarDeepLink);
    if (!opened) {
      await openExternalWebUrl(bazaarWebFallback);
    }
    return;
  }

  if (effectiveStore === 'myket') {
    const opened = await tryOpenUrl(myketDeepLink);
    if (!opened) {
      await openExternalWebUrl(myketWebFallback);
    }
    return;
  }

  // حالت auto (فقط زمانی که VITE_STORE=none باشد)
  const bazaarInstalled =
    (await canLaunchUrl('com.farsitel.bazaar')) || (await canLaunchUrl(bazaarDeepLink));
  if (bazaarInstalled) {
    const opened = await tryOpenUrl(bazaarDeepLink);
    if (!opened) {
      await openExternalWebUrl(bazaarWebFallback);
    }
    return;
  }

  const myketInstalled =
    (await canLaunchUrl('ir.mservices.market')) || (await canLaunchUrl(myketDeepLink));
  if (myketInstalled) {
    const opened = await tryOpenUrl(myketDeepLink);
    if (!opened) {
      await openExternalWebUrl(myketWebFallback);
    }
    return;
  }

  // اگر بررسی نصب نتیجه نداد، ابتدا deep link بازار سپس مایکت را امتحان کن و در نهایت وب بازار
  if (await tryOpenUrl(bazaarDeepLink)) return;
  if (await tryOpenUrl(myketDeepLink)) return;
  await openExternalWebUrl(bazaarWebFallback);
}

let lastSupportShareCanceled = false;

export function wasLastSupportMailtoCanceled(): boolean {
  return lastSupportShareCanceled;
}

/**
 * باز کردن منوی اشتراک‌گذاری (در نیتیو) یا کلاینت ایمیل (در وب) با متن پیام پشتیبانی
 */
export async function openSupportMailto(text: string, userEmail?: string): Promise<boolean> {
  lastSupportShareCanceled = false;
  const cleanMessage = text.trim().slice(0, MAX_FEEDBACK_LENGTH);
  const cleanEmail = userEmail?.trim() || '';
  const storeTarget = getStoreTarget();
  const subjectText = 'نقد و پیشنهاد اپلیکیشن یاد (YAAD Feedback)';
  const replyLine = cleanEmail ? `\nایمیل کاربر: ${cleanEmail}` : '';
  const footerLine = `ارسال شده از اپلیکیشن یاد (${PACKAGE_NAME} | v${APP_VERSION} | ${storeTarget})`;

  if (Capacitor.isNativePlatform()) {
    try {
      navigator.clipboard?.writeText?.(SUPPORT_EMAIL).catch(() => {});
    } catch {
      // ignore clipboard errors
    }

    const shareText = `ارسال به: ${SUPPORT_EMAIL}\n\n${cleanMessage}${replyLine}\n\n---\n${footerLine}`;
    try {
      await Share.share({
        title: subjectText,
        text: shareText,
        dialogTitle: 'ارسال با ایمیل',
      });
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err || '');
      if (/cancel/i.test(msg)) {
        lastSupportShareCanceled = true;
      }
      return false;
    }
  }

  const subject = encodeURIComponent(subjectText);
  const body = encodeURIComponent(`${cleanMessage}${replyLine}\n\n---\n${footerLine}`);
  const mailtoUrl = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;

  try {
    if (typeof window !== 'undefined') {
      window.location.href = mailtoUrl;
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * ارسال مستقیم نقد یا پیشنهاد کاربر به سرویس Formspree و ذخیره محلی
 * به همراه قابلیت هدایت به ایمیل پشتیبانی در صورت خطا یا آفلاین بودن
 */
export async function submitNegativeFeedbackToSupport(
  feedbackText: string,
  userEmail?: string
): Promise<{ ok: boolean; via: FeedbackSubmitVia; canceled?: boolean }> {
  const cleanMessage = feedbackText.trim().slice(0, MAX_FEEDBACK_LENGTH);
  const cleanEmail = userEmail?.trim() || '';

  if (cleanEmail && !SIMPLE_EMAIL_REGEX.test(cleanEmail)) {
    return { ok: false, via: 'failed' };
  }

  const createdAt = new Date().toISOString();
  const storeTarget = getStoreTarget();

  // ۱. ذخیره در تاریخچه محلی (حداکثر ۲۰ مورد و هر مورد حداکثر ۲۰۰۰ کاراکتر)
  try {
    const parsed = JSON.parse(localStorage.getItem(FEEDBACK_LIST_KEY) || '[]');
    const existing = Array.isArray(parsed) ? parsed : [];
    existing.push({
      message: cleanMessage,
      email: cleanEmail || undefined,
      createdAt,
    });
    const bounded = existing.slice(-MAX_LOCAL_FEEDBACK_ITEMS);
    localStorage.setItem(FEEDBACK_LIST_KEY, JSON.stringify(bounded));
  } catch {
    // ignore storage errors
  }

  // ۲. ارسال به سرویس Formspree با timeout ده ثانیه‌ای
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FORMSPREE_TIMEOUT_MS);

  try {
    const payload: Record<string, string> = {
      app: 'YAAD Reminder',
      package: PACKAGE_NAME,
      appVersion: APP_VERSION,
      store: storeTarget,
      supportEmail: SUPPORT_EMAIL,
      message: cleanMessage,
      submittedAt: createdAt,
    };
    if (cleanEmail) {
      payload.email = cleanEmail;
    }

    const response = await fetch(FORMSPREE_ENDPOINT, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (response.ok) {
      return { ok: true, via: 'formspree' };
    }
  } catch {
    // در صورت عدم دسترسی به شبکه، تایم‌اوت یا خطای Formspree، هدایت به کلاینت ایمیل
  } finally {
    clearTimeout(timeoutId);
  }

  // ۳. هدایت به ایمیل تیم پشتیبانی (ارسال قطعی نیست و نیازمند تأیید کاربر در برنامه ایمیل است)
  const openedMailto = await openSupportMailto(cleanMessage, cleanEmail || undefined);
  if (openedMailto) {
    return { ok: false, via: 'mailto' };
  }

  return { ok: false, via: 'failed', canceled: wasLastSupportMailtoCanceled() };
}

/**
 * باز کردن مستقیم پاپ‌آپ بازخورد دو مرحله‌ای (مثلاً از بخش تنظیمات)
 */
export function openReviewDialogDirectly(options: TriggerReviewFlowOptions = {}): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(YAAD_OPEN_FEEDBACK_MODAL_EVENT, {
      detail: { ...options, forceOpen: true },
    })
  );
}

/**
 * تابع گلوبال بررسی و نمایش پاپ‌آپ در لحظات موفقیت کاربر
 * (مانند تیک زدن یک کار یا ثبت یادآور جدید):
 * - شمارنده موفقیت را ۱ واحد در LocalStorage افزایش می‌دهد.
 * - بررسی می‌کند:
 *   ۱. کاربر تاکنون بازخوردی ثبت نکرده باشد (hasGivenFeedback === false).
 *   ۲. شمارنده به عدد تصادفی بین ۵ تا ۱۰ (targetThreshold) رسیده باشد.
 *   ۳. از آخرین باری که پاپ‌آپ بسته شده / گزینه «بعداً» زده شده حداقل ۳ روز گذشته باشد.
 */
export async function triggerReviewFlow(options: TriggerReviewFlowOptions = {}): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  if (options.forceOpen) {
    openReviewDialogDirectly(options);
    return true;
  }

  const state = getTwoStageFeedbackState();

  // شرط ۱: کاربر تا به حال بازخوردی ثبت نکرده باشد
  if (state.hasGivenFeedback) {
    return false;
  }

  // افزایش شمارنده موفقیت در حافظه (LocalStorage)
  const nextCount = state.successCount + 1;
  const updatedState: TwoStageFeedbackPersistedState = {
    ...state,
    successCount: nextCount,
  };
  saveTwoStageFeedbackState(updatedState);

  // شرط ۲: شمارنده موفقیت به عدد تصادفی بین ۵ تا ۱۰ رسیده باشد
  if (nextCount < updatedState.targetThreshold) {
    return false;
  }

  // شرط ۳: از آخرین باری که پاپ‌آپ نمایش داده شده و کاربر «بعداً» یا بستن را زده، حداقل ۳ روز گذشته باشد
  const now = Date.now();
  if (
    typeof updatedState.lastDismissedAt === 'number' &&
    updatedState.lastDismissedAt > 0 &&
    now - updatedState.lastDismissedAt < THREE_DAYS_MS
  ) {
    return false;
  }

  const delayMs = typeof options.delayMs === 'number' ? options.delayMs : 650;
  setTimeout(() => {
    window.dispatchEvent(
      new CustomEvent(YAAD_OPEN_FEEDBACK_MODAL_EVENT, {
        detail: options,
      })
    );
  }, delayMs);

  return true;
}

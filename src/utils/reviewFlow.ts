import { Capacitor } from '@capacitor/core';

export const PACKAGE_NAME = 'com.yaad.reminder';
export const SUPPORT_EMAIL = 'info@narvanteam.ir';
export const FORMSPREE_ENDPOINT = 'https://formspree.io/f/xdkogpvr';

const FEEDBACK_STATE_STORAGE_KEY = 'yaad_two_stage_feedback_state_v2';
const LEGACY_REVIEW_STATE_KEY = 'yaad_review_flow_completed_v1';
const FEEDBACK_LIST_KEY = 'yaad_user_internal_feedbacks_v1';

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

export type ReviewTargetStore = 'bazaar' | 'myket' | 'auto';
export type ReviewCompletionReason = 'rated' | 'feedback_sent' | 'dismissed';

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
    const capPlugins = (window as any)?.Capacitor?.Plugins;
    if (capPlugins?.Preferences?.set) {
      capPlugins.Preferences.set({
        key: FEEDBACK_STATE_STORAGE_KEY,
        value: serialized,
      }).catch(() => {});
    }
  } catch {
    // ignore
  }
}

export async function hasCompletedReviewFlow(): Promise<boolean> {
  const state = getTwoStageFeedbackState();
  return state.hasGivenFeedback;
}

/**
 * ثبت نهایی بازخورد (زمانی که کاربر امتیاز داده یا فرم پیشنهاد را ارسال کرده است)
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

/**
 * باز کردن صفحه ثبت ۵ ستاره در کافه‌بازار یا مایکت با استفاده از لینک‌های استاندارد و Capacitor AppLauncher
 */
export async function openStoreReviewPage(store: ReviewTargetStore = 'auto'): Promise<void> {
  const bazaarDeepLink = `bazaar://details?id=${PACKAGE_NAME}`;
  const myketDeepLink = `myket://comment?id=${PACKAGE_NAME}`;
  const bazaarWebFallback = `https://cafebazaar.ir/app/${PACKAGE_NAME}`;
  const myketWebFallback = `https://myket.ir/app/${PACKAGE_NAME}`;

  const capAppLauncher = (window as any)?.Capacitor?.Plugins?.AppLauncher;

  const tryLaunchUrl = async (url: string): Promise<boolean> => {
    if (capAppLauncher?.openUrl) {
      try {
        if (capAppLauncher.canOpenUrl) {
          const canOpen = await capAppLauncher.canOpenUrl({ url });
          if (canOpen?.value) {
            await capAppLauncher.openUrl({ url });
            return true;
          }
        }
        await capAppLauncher.openUrl({ url });
        return true;
      } catch {
        return false;
      }
    }
    return false;
  };

  if (Capacitor.isNativePlatform()) {
    if (store === 'bazaar') {
      const opened = await tryLaunchUrl(bazaarDeepLink);
      if (!opened) window.location.href = bazaarDeepLink;
      return;
    }

    if (store === 'myket') {
      const opened = await tryLaunchUrl(myketDeepLink);
      if (!opened) window.location.href = myketDeepLink;
      return;
    }

    const openedBazaar = await tryLaunchUrl(bazaarDeepLink);
    if (openedBazaar) return;

    const openedMyket = await tryLaunchUrl(myketDeepLink);
    if (openedMyket) return;

    window.location.href = bazaarDeepLink;
  } else {
    window.location.href = store === 'myket' ? myketWebFallback : bazaarWebFallback;
  }
}

/**
 * ارسال مستقیم نقد یا پیشنهاد کاربر به سرویس Formspree و ذخیره محلی
 * به همراه قابلیت هدایت به ایمیل پشتیبانی در صورت آفلاین بودن
 */
export async function submitNegativeFeedbackToSupport(
  feedbackText: string,
  userEmail?: string
): Promise<{ ok: boolean; via: 'formspree' | 'mailto' }> {
  const cleanMessage = feedbackText.trim();
  const createdAt = new Date().toISOString();

  // ۱. ذخیره در تاریخچه محلی
  try {
    const existing = JSON.parse(localStorage.getItem(FEEDBACK_LIST_KEY) || '[]');
    existing.push({
      message: cleanMessage,
      email: userEmail?.trim() || undefined,
      createdAt,
    });
    localStorage.setItem(FEEDBACK_LIST_KEY, JSON.stringify(existing));
  } catch {
    // ignore storage errors
  }

  // ۲. ارسال به سرویس Formspree
  try {
    const response = await fetch(FORMSPREE_ENDPOINT, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        app: 'YAAD Reminder',
        package: PACKAGE_NAME,
        supportEmail: SUPPORT_EMAIL,
        userEmail: userEmail?.trim() || 'anonymous@yaad.app',
        message: cleanMessage,
        submittedAt: createdAt,
      }),
    });

    if (response.ok) {
      return { ok: true, via: 'formspree' };
    }
  } catch {
    // در صورت عدم دسترسی به شبکه یا خطای Formspree، هدایت به کلاینت ایمیل
  }

  // ۳. هدایت استاندارد به ایمیل تیم پشتیبانی (mailto:info@narvanteam.ir)
  const subject = encodeURIComponent('نقد و پیشنهاد اپلیکیشن یاد (YAAD Feedback)');
  const body = encodeURIComponent(
    `${cleanMessage}\n\n---\nارسال شده از اپلیکیشن یاد (${PACKAGE_NAME})`
  );
  const mailtoUrl = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;

  const capAppLauncher = (window as any)?.Capacitor?.Plugins?.AppLauncher;
  if (Capacitor.isNativePlatform() && capAppLauncher?.openUrl) {
    try {
      await capAppLauncher.openUrl({ url: mailtoUrl });
      return { ok: true, via: 'mailto' };
    } catch {
      // fallback below
    }
  }

  window.location.href = mailtoUrl;
  return { ok: true, via: 'mailto' };
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

/**
 * نام مستعار صریح برای فراخوانی در لحظات موفقیت کاربر
 */
export const recordUserSuccessForFeedback = triggerReviewFlow;

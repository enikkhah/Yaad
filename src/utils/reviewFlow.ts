import { Capacitor } from '@capacitor/core';

const PACKAGE_NAME = 'com.yaad.reminder';
const REVIEW_STATE_KEY = 'yaad_review_flow_completed_v1';
const FEEDBACK_LIST_KEY = 'yaad_user_internal_feedbacks_v1';
const STYLE_ELEMENT_ID = 'yaad-review-flow-styles';
const OVERLAY_ELEMENT_ID = 'yaad-review-overlay';

export type ReviewTargetStore = 'bazaar' | 'myket' | 'auto';
export type ReviewCompletionReason = 'rated' | 'feedback_sent' | 'dismissed';

export interface TriggerReviewFlowOptions {
  store?: ReviewTargetStore;
  delayMs?: number;
  onSubmitFeedback?: (feedbackText: string) => Promise<void> | void;
}

const DEFAULT_TARGET_STORE: ReviewTargetStore = 'auto';

function ensureReviewStylesInjected(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ELEMENT_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ELEMENT_ID;
  style.textContent = `
    .yaad-review-overlay {
      position: fixed;
      inset: 0;
      z-index: 99999;
      background: rgba(15, 23, 42, 0.58);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.25s ease;
      direction: rtl;
      font-family: 'Vazirmatn', system-ui, -apple-system, sans-serif;
    }

    .yaad-review-overlay.is-visible {
      opacity: 1;
      pointer-events: auto;
    }

    .yaad-review-card {
      width: 100%;
      max-width: 370px;
      background: #ffffff;
      border: 1px solid #d1fae5;
      border-radius: 22px;
      padding: 24px 20px 18px;
      box-shadow: 0 20px 45px -12px rgba(5, 150, 105, 0.25);
      text-align: center;
      transform: translateY(14px) scale(0.97);
      transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .yaad-review-overlay.is-visible .yaad-review-card {
      transform: translateY(0) scale(1);
    }

    .dark .yaad-review-card {
      background: #111f1a;
      border-color: rgba(16, 185, 129, 0.28);
      color: #ecfdf5;
    }

    .yaad-review-icon {
      width: 52px;
      height: 52px;
      margin: 0 auto 14px;
      border-radius: 16px;
      background: #ecfdf5;
      color: #059669;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .dark .yaad-review-icon {
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
    }

    .yaad-review-title {
      font-size: 15.5px;
      font-weight: 700;
      line-height: 1.75;
      color: #064e3b;
      margin: 0 0 18px;
    }

    .dark .yaad-review-title {
      color: #ecfdf5;
    }

    .yaad-review-stars {
      display: flex;
      justify-content: center;
      gap: 6px;
      margin-bottom: 14px;
      color: #10b981;
    }

    .yaad-review-actions {
      display: flex;
      gap: 10px;
      margin-bottom: 12px;
    }

    .yaad-btn {
      flex: 1;
      border: none;
      border-radius: 13px;
      padding: 11px 14px;
      font-family: inherit;
      font-size: 13.5px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.18s ease;
    }

    .yaad-btn:active {
      transform: scale(0.97);
    }

    .yaad-btn-primary {
      background: #10b981 !important;
      color: #ffffff !important;
      box-shadow: 0 6px 16px -4px rgba(16, 185, 129, 0.45);
    }

    .yaad-btn-primary:hover {
      background: #059669 !important;
    }

    .yaad-btn-secondary {
      background: #ecfdf5 !important;
      color: #047857 !important;
      border: 1px solid #a7f3d0 !important;
    }

    .dark .yaad-btn-secondary {
      background: rgba(16, 185, 129, 0.12) !important;
      color: #6ee7b7 !important;
      border-color: rgba(16, 185, 129, 0.28) !important;
    }

    .yaad-btn-later {
      background: transparent !important;
      border: none !important;
      color: #6b7280 !important;
      font-family: inherit;
      font-size: 12px;
      font-weight: 500;
      padding: 6px 10px;
      cursor: pointer;
    }

    .dark .yaad-btn-later {
      color: #9ca3af !important;
    }

    .yaad-review-textarea {
      width: 100%;
      min-height: 96px;
      box-sizing: border-box;
      border-radius: 14px;
      border: 1.5px solid #a7f3d0 !important;
      background: #f8fafc !important;
      padding: 12px;
      font-family: inherit;
      font-size: 13.5px;
      line-height: 1.6;
      color: #0f172a !important;
      resize: none;
      outline: none;
      margin-bottom: 12px;
      transition: border-color 0.2s ease;
    }

    .yaad-review-textarea:focus {
      border-color: #10b981 !important;
      background: #ffffff !important;
    }

    .dark .yaad-review-textarea {
      background: rgba(6, 78, 59, 0.25) !important;
      border-color: rgba(16, 185, 129, 0.35) !important;
      color: #ecfdf5 !important;
    }

    .yaad-review-error {
      color: #ef4444;
      font-size: 12px;
      margin: -6px 0 10px;
      text-align: right;
      display: none;
    }
  `;
  document.head.appendChild(style);
}

/**
 * ۵. بررسی و ذخیره وضعیت در Capacitor Preferences و localStorage
 */
export async function hasCompletedReviewFlow(): Promise<boolean> {
  try {
    if (localStorage.getItem(REVIEW_STATE_KEY)) {
      return true;
    }
    const capPlugins = (window as any)?.Capacitor?.Plugins;
    if (capPlugins?.Preferences?.get) {
      const { value } = await capPlugins.Preferences.get({ key: REVIEW_STATE_KEY });
      if (value) {
        localStorage.setItem(REVIEW_STATE_KEY, value);
        return true;
      }
    }
  } catch {
    // ignore storage errors
  }
  return false;
}

export async function markReviewFlowCompleted(reason: ReviewCompletionReason): Promise<void> {
  const payload = JSON.stringify({
    status: reason,
    timestamp: Date.now(),
  });

  try {
    localStorage.setItem(REVIEW_STATE_KEY, payload);
  } catch {
    // ignore localStorage quota errors
  }

  try {
    const capPlugins = (window as any)?.Capacitor?.Plugins;
    if (capPlugins?.Preferences?.set) {
      await capPlugins.Preferences.set({
        key: REVIEW_STATE_KEY,
        value: payload,
      });
    }
  } catch {
    // ignore native plugin errors
  }
}

/**
 * ۲. باز کردن مستقیم صفحه ثبت نظر در کافه‌بازار یا مایکت با استفاده از AppLauncher یا دیپ‌لینک
 */
export async function openStoreReviewPage(store: ReviewTargetStore = DEFAULT_TARGET_STORE): Promise<void> {
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

    // حالت 'auto': اول کافه‌بازار، در صورت عدم موفقیت مایکت
    const openedBazaar = await tryLaunchUrl(bazaarDeepLink);
    if (openedBazaar) return;

    const openedMyket = await tryLaunchUrl(myketDeepLink);
    if (openedMyket) return;

    window.location.href = bazaarDeepLink;
  } else {
    window.location.href = store === 'myket' ? myketWebFallback : bazaarWebFallback;
  }
}

function renderReviewDialog(options: TriggerReviewFlowOptions = {}): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(OVERLAY_ELEMENT_ID)) return;

  ensureReviewStylesInjected();

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ELEMENT_ID;
  overlay.className = 'yaad-review-overlay';

  const closeDialog = () => {
    overlay.classList.remove('is-visible');
    setTimeout(() => {
      overlay.remove();
    }, 260);
  };

  // ۱. دیالوگ اولیه با پالت سبز و کلمه «یاد» با رنگ برند (#FF8C00)
  overlay.innerHTML = `
    <div class="yaad-review-card" role="dialog" aria-modal="true">
      <div class="yaad-review-icon" id="yaad-review-icon">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/>
          <path d="m9 12 2 2 4-4"/>
        </svg>
      </div>

      <div id="yaad-review-body">
        <p class="yaad-review-title">آیا <span data-keep-color="true" style="color: #FF8C00 !important; font-weight: 900;">یاد</span> تونسته در مدیریت کارهاتون بهتون کمک کنه؟</p>
        <div class="yaad-review-actions">
          <button type="button" class="yaad-btn yaad-btn-primary" id="yaad-btn-yes">بله، عالی بود</button>
          <button type="button" class="yaad-btn yaad-btn-secondary" id="yaad-btn-no">نه، پیشنهاداتی دارم</button>
        </div>
      </div>

      <button type="button" class="yaad-btn-later" id="yaad-btn-later">یادآوری در فرصتی دیگر</button>
    </div>
  `;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('is-visible'));

  const bodyContainer = overlay.querySelector('#yaad-review-body') as HTMLElement | null;
  const laterBtn = overlay.querySelector('#yaad-btn-later') as HTMLButtonElement | null;
  const yesBtn = overlay.querySelector('#yaad-btn-yes') as HTMLButtonElement | null;
  const noBtn = overlay.querySelector('#yaad-btn-no') as HTMLButtonElement | null;

  if (!bodyContainer || !laterBtn || !yesBtn || !noBtn) return;

  // ۵. انتخاب «یادآوری در فرصتی دیگر» -> ذخیره وضعیت و عدم نمایش مجدد
  laterBtn.addEventListener('click', async () => {
    await markReviewFlowCompleted('dismissed');
    closeDialog();
  });

  // ۲. مسیر کاربر راضی (انتخاب «بله، عالی بود»)
  yesBtn.addEventListener('click', () => {
    const starsHtml = Array.from({ length: 5 })
      .map(
        () => `
        <svg width="22" height="22" viewBox="0 0 24 24" fill="#10b981" stroke="#10b981" stroke-width="1.5">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg>
      `
      )
      .join('');

    bodyContainer.innerHTML = `
      <div class="yaad-review-stars" aria-hidden="true">${starsHtml}</div>
      <p class="yaad-review-title">
        خوشحالیم که <span data-keep-color="true" style="color: #FF8C00 !important; font-weight: 900;">یاد</span> یادآور روزهای مهم شماست. ثبت امتیاز ۵ ستاره شما، به تیم ناروَن کمک می‌کنه امکانات بهتری را توسعه بده.
      </p>
      <div class="yaad-review-actions">
        <button type="button" class="yaad-btn yaad-btn-primary" id="yaad-btn-rate">ثبت امتیاز</button>
      </div>
    `;

    const rateBtn = overlay.querySelector('#yaad-btn-rate') as HTMLButtonElement | null;
    rateBtn?.addEventListener('click', async () => {
      await markReviewFlowCompleted('rated');
      closeDialog();
      await openStoreReviewPage(options.store || DEFAULT_TARGET_STORE);
    });
  });

  // ۳. مسیر کاربر ناراضی (انتخاب «نه، پیشنهاداتی دارم» -> فرم داخلی بدون خروج از اپ)
  noBtn.addEventListener('click', () => {
    bodyContainer.innerHTML = `
      <p class="yaad-review-title" style="margin-bottom: 12px;">
        لطفاً پیشنهاد یا مشکلتون درباره <span data-keep-color="true" style="color: #FF8C00 !important; font-weight: 900;">یاد</span> رو بنویسید تا در تیم ناروَن بررسی و برطرفش کنیم:
      </p>
      <textarea
        id="yaad-feedback-input"
        class="yaad-review-textarea"
        placeholder="پیشنهاد یا مشکل خود را اینجا بنویسید..."
      ></textarea>
      <div id="yaad-feedback-error" class="yaad-review-error">لطفاً پیش از ارسال، متن پیام خود را وارد کنید.</div>
      <div class="yaad-review-actions">
        <button type="button" class="yaad-btn yaad-btn-primary" id="yaad-btn-send-feedback">ارسال</button>
      </div>
    `;

    const textarea = overlay.querySelector('#yaad-feedback-input') as HTMLTextAreaElement | null;
    const errorEl = overlay.querySelector('#yaad-feedback-error') as HTMLElement | null;
    const sendBtn = overlay.querySelector('#yaad-btn-send-feedback') as HTMLButtonElement | null;

    textarea?.focus();

    sendBtn?.addEventListener('click', async () => {
      const feedbackText = textarea?.value.trim() || '';
      if (!feedbackText) {
        if (errorEl) errorEl.style.display = 'block';
        textarea?.focus();
        return;
      }

      try {
        const existing = JSON.parse(localStorage.getItem(FEEDBACK_LIST_KEY) || '[]');
        existing.push({ message: feedbackText, createdAt: new Date().toISOString() });
        localStorage.setItem(FEEDBACK_LIST_KEY, JSON.stringify(existing));
      } catch {
        // ignore
      }

      if (typeof options.onSubmitFeedback === 'function') {
        try {
          await options.onSubmitFeedback(feedbackText);
        } catch {
          // ignore callback errors
        }
      }

      await markReviewFlowCompleted('feedback_sent');

      laterBtn.style.display = 'none';
      bodyContainer.innerHTML = `
        <p class="yaad-review-title" style="margin-bottom: 6px; color: #059669;">
          سپاس از همراهی شما با <span data-keep-color="true" style="color: #FF8C00 !important; font-weight: 900;">یاد</span>!
        </p>
        <p style="font-size: 13.5px; color: #4b5563; line-height: 1.7; margin: 0 0 14px;">
          بازخورد ارزشمند شما با موفقیت ثبت شد و توسط تیم ناروَن بررسی خواهد شد.
        </p>
        <div class="yaad-review-actions">
          <button type="button" class="yaad-btn yaad-btn-secondary" id="yaad-btn-close-thanks">بستن</button>
        </div>
      `;

      const closeThanksBtn = overlay.querySelector('#yaad-btn-close-thanks') as HTMLButtonElement | null;
      closeThanksBtn?.addEventListener('click', closeDialog);
      setTimeout(closeDialog, 2500);
    });
  });
}

/**
 * نمایش مستقیم دیالوگ بازخورد (حتی اگر قبلاً بسته شده باشد)
 */
export function openReviewDialogDirectly(options: TriggerReviewFlowOptions = {}): void {
  renderReviewDialog(options);
}

/**
 * ۴. تابع مستقل زمان‌بندی (Timing)
 * فقط زمانی که این تابع پس از رویدادهای موفق (تیک خوردن تسک، ثبت هوشمند یا اجرای موفق جئوفنس)
 * فراخوانی شود و کاربر قبلاً وضعیت را ثبت نکرده باشد، دیالوگ نمایش داده می‌شود.
 */
export async function triggerReviewFlow(options: TriggerReviewFlowOptions = {}): Promise<boolean> {
  const alreadyCompleted = await hasCompletedReviewFlow();
  if (alreadyCompleted) {
    return false;
  }

  const delayMs = typeof options.delayMs === 'number' ? options.delayMs : 700;
  setTimeout(() => {
    renderReviewDialog(options);
  }, delayMs);

  return true;
}

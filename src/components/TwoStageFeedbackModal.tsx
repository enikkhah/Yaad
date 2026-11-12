import React, { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, ExternalLink, Mail, MessageSquareHeart, Send, Star, X } from 'lucide-react';
import {
  markFeedbackModalDismissed,
  markReviewFlowCompleted,
  openReviewDialogDirectly,
  openStoreReviewPage,
  ReviewTargetStore,
  submitNegativeFeedbackToSupport,
  SUPPORT_EMAIL,
  TriggerReviewFlowOptions,
  triggerReviewFlow,
  YAAD_OPEN_FEEDBACK_MODAL_EVENT,
} from '../utils/reviewFlow';

type FeedbackStage = 'initial' | 'positive' | 'negative' | 'submitted';

/**
 * هوک اختصاصی مدیریت و فراخوانی سیستم بازخورد دو مرحله‌ای در کامپوننت‌های React
 */
export function useTwoStageFeedback() {
  const recordSuccess = useCallback((options?: TriggerReviewFlowOptions) => {
    return triggerReviewFlow(options);
  }, []);

  const openFeedbackModal = useCallback((options?: TriggerReviewFlowOptions) => {
    openReviewDialogDirectly(options);
  }, []);

  return {
    recordSuccess,
    openFeedbackModal,
  };
}

export const TwoStageFeedbackModal: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [stage, setStage] = useState<FeedbackStage>('initial');
  const [options, setOptions] = useState<TriggerReviewFlowOptions>({});
  const [feedbackText, setFeedbackText] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOpenEvent = (event: Event) => {
      const customEvent = event as CustomEvent<TriggerReviewFlowOptions>;
      setOptions(customEvent.detail || {});
      setStage('initial');
      setFeedbackText('');
      setErrorMsg('');
      setIsSubmitting(false);
      setIsOpen(true);
    };

    window.addEventListener(YAAD_OPEN_FEEDBACK_MODAL_EVENT, handleOpenEvent);
    return () => {
      window.removeEventListener(YAAD_OPEN_FEEDBACK_MODAL_EVENT, handleOpenEvent);
    };
  }, []);

  // بستن پنجره با دکمه X یا «بعداً» (بدون ثبت بازخورد نهایی، اعمال فاصله زمانی ۳ روزه)
  const handleDismiss = () => {
    markFeedbackModalDismissed();
    setIsOpen(false);
  };

  // هدایت به کافه‌بازار / مایکت و ثبت نهایی بازخورد
  const handleRateInStore = async (targetStore: ReviewTargetStore = 'auto') => {
    await markReviewFlowCompleted('rated');
    setIsOpen(false);
    await openStoreReviewPage(options.store || targetStore);
  };

  // ارسال نقد یا پیشنهاد از طریق Formspree / ایمیل پشتیبانی
  const handleSubmitNegativeFeedback = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = feedbackText.trim();
    if (!trimmed) {
      setErrorMsg('لطفاً پیش از ارسال، نقد یا پیشنهاد خود را بنویسید.');
      return;
    }

    setErrorMsg('');
    setIsSubmitting(true);

    try {
      await submitNegativeFeedbackToSupport(trimmed, userEmail);
      if (typeof options.onSubmitFeedback === 'function') {
        await options.onSubmitFeedback(trimmed);
      }
      await markReviewFlowCompleted('feedback_sent');
      setStage('submitted');
      setTimeout(() => {
        setIsOpen(false);
      }, 2200);
    } finally {
      setIsSubmitting(false);
    }
  };

  // هدایت مستقیم به فرم تماس ایمیلی در صورت تمایل کاربر
  const handleDirectEmailContact = async () => {
    const trimmed = feedbackText.trim() || 'پیشنهاد / گزارش مشکل در اپلیکیشن یاد:';
    await submitNegativeFeedbackToSupport(trimmed, userEmail);
    await markReviewFlowCompleted('feedback_sent');
    setIsOpen(false);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={handleDismiss}
          className="fixed inset-0 z-[120] bg-black/75 backdrop-blur-md flex items-center justify-center p-4 select-none"
          dir="rtl"
        >
          <motion.div
            initial={{ scale: 0.93, y: 16, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.93, y: 16, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 330 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            className="relative w-full max-w-sm rounded-3xl bg-[#0D1B17] border border-emerald-500/30 shadow-[0_20px_50px_rgba(0,0,0,0.75),0_0_30px_rgba(16,185,129,0.14)] p-6 text-center text-stone-100 overflow-hidden"
          >
            {/* نور ملایم پس‌زمینه */}
            <div className="pointer-events-none absolute -top-16 left-1/2 -translate-x-1/2 w-48 h-32 rounded-full bg-emerald-500/15 blur-2xl" />

            {/* دکمه X نامحسوس برای بستن پنجره (بدون ثبت بازخورد) */}
            <button
              type="button"
              onClick={handleDismiss}
              aria-label="بستن"
              className="absolute top-3.5 left-3.5 w-8 h-8 rounded-full bg-stone-800/40 hover:bg-stone-800/80 text-stone-400 hover:text-stone-200 flex items-center justify-center transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            {/* مرحله اول: سنجش رضایت */}
            {stage === 'initial' && (
              <div className="space-y-4 pt-1">
                <div className="mx-auto w-13 h-13 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-inner">
                  <MessageSquareHeart className="w-6 h-6" />
                </div>

                <div className="space-y-2">
                  <h3 className="text-base sm:text-lg font-black text-white leading-snug">
                    حالِ «<span data-keep-color="true" className="text-[#FF8C00]">یاد</span>» با شما بهتر می‌شود! 🌱
                  </h3>
                  <p className="text-xs sm:text-sm font-medium text-stone-300 leading-relaxed">
                    آیا تا اینجا از تجربه کار با «<span data-keep-color="true" className="text-[#FF8C00] font-bold">یاد</span>» رضایت داشته‌اید؟
                  </p>
                </div>

                <div className="flex flex-col gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={() => setStage('positive')}
                    className="w-full min-h-[44px] py-2.5 px-4 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-stone-950 font-black text-xs sm:text-sm shadow-lg shadow-emerald-500/25 transition-all active:scale-98 cursor-pointer flex items-center justify-center gap-2"
                  >
                    <span>بله، دوستش دارم 💛</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setStage('negative')}
                    className="w-full min-h-[44px] py-2.5 px-4 rounded-2xl bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-500/30 text-emerald-200 font-bold text-xs sm:text-sm transition-all active:scale-98 cursor-pointer flex items-center justify-center gap-2"
                  >
                    <span>نه، پیشنهاداتی دارم 💡</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleDismiss}
                  className="text-[11px] font-medium text-stone-400 hover:text-stone-300 transition-colors pt-1 cursor-pointer"
                >
                  بعداً یادآوری کن
                </button>
              </div>
            )}

            {/* مرحله دوم (مسیر مثبت): ثبت ۵ ستاره در کافه‌بازار / مایکت */}
            {stage === 'positive' && (
              <div className="space-y-4 pt-1">
                <div className="flex items-center justify-center gap-1.5 text-emerald-400">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star
                      key={star}
                      className="w-5 h-5 fill-emerald-400 text-emerald-400 drop-shadow-[0_0_8px_rgba(16,185,129,0.45)]"
                    />
                  ))}
                </div>

                <p className="text-xs sm:text-sm font-bold text-stone-200 leading-relaxed px-1">
                  چقدر عالی! انرژی مثبت شما چراغ راه ماست. با ثبت ۵ ستاره در بازار/مایکت، به ما در توسعه‌ی «
                  <span data-keep-color="true" className="text-[#FF8C00] font-black">
                    یاد
                  </span>
                  » کمک می‌کنید.
                </p>

                <div className="space-y-2 pt-1">
                  <button
                    type="button"
                    onClick={() => handleRateInStore('auto')}
                    className="w-full min-h-[44px] py-2.5 px-4 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-stone-950 font-black text-xs sm:text-sm shadow-lg shadow-emerald-500/25 transition-all active:scale-98 cursor-pointer flex items-center justify-center gap-2"
                  >
                    <Star className="w-4 h-4 fill-stone-950 text-stone-950 shrink-0" />
                    <span>ثبت ۵ ستاره در کافه‌بازار / مایکت</span>
                    <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                  </button>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => handleRateInStore('bazaar')}
                      className="py-2 px-3 rounded-xl bg-stone-900/90 hover:bg-stone-800 border border-emerald-500/25 text-emerald-300 font-bold text-xs transition-all cursor-pointer"
                    >
                      کافه‌بازار
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRateInStore('myket')}
                      className="py-2 px-3 rounded-xl bg-stone-900/90 hover:bg-stone-800 border border-emerald-500/25 text-emerald-300 font-bold text-xs transition-all cursor-pointer"
                    >
                      مایکت
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* مرحله دوم (مسیر منفی): فرم نقد و پیشنهاد + ارسال به Formspree / ایمیل پشتیبانی */}
            {stage === 'negative' && (
              <form onSubmit={handleSubmitNegativeFeedback} className="space-y-3.5 pt-1 text-right">
                <p className="text-xs sm:text-sm font-bold text-stone-200 leading-relaxed text-center px-1">
                  مشتاق شنیدن صدای شما هستیم. لطفاً نقد یا پیشنهاد خود را برای ما بنویسید تا «
                  <span data-keep-color="true" className="text-[#FF8C00] font-black">
                    یاد
                  </span>
                  » را برایتان کاربردی‌تر کنیم.
                </p>

                <div className="space-y-2">
                  <textarea
                    value={feedbackText}
                    onChange={(e) => {
                      setFeedbackText(e.target.value);
                      if (errorMsg) setErrorMsg('');
                    }}
                    rows={3}
                    placeholder="نقد، پیشنهاد یا مشکل خود را اینجا بنویسید..."
                    className="w-full rounded-2xl bg-[#07110E] border border-emerald-500/35 focus:border-emerald-400 px-3.5 py-2.5 text-xs sm:text-sm text-stone-100 placeholder:text-stone-500 outline-none resize-none transition-colors"
                    autoFocus
                  />

                  <input
                    type="email"
                    dir="ltr"
                    value={userEmail}
                    onChange={(e) => setUserEmail(e.target.value)}
                    placeholder="Your Email (Optional)"
                    className="w-full rounded-xl bg-[#07110E] border border-stone-800 focus:border-emerald-500/50 px-3 py-2 text-xs text-stone-200 placeholder:text-stone-500 outline-none transition-colors text-left font-mono"
                  />

                  {errorMsg && (
                    <p className="text-[11px] font-bold text-rose-400 pr-1">{errorMsg}</p>
                  )}
                </div>

                <div className="flex flex-col gap-2 pt-0.5">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full min-h-[44px] py-2.5 px-4 rounded-2xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-stone-950 font-black text-xs sm:text-sm shadow-lg shadow-emerald-500/25 transition-all active:scale-98 cursor-pointer flex items-center justify-center gap-2"
                  >
                    <Send className="w-4 h-4 shrink-0" />
                    <span>{isSubmitting ? 'در حال ارسال...' : 'ارسال مستقیم به پشتیبانی (Formspree)'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleDirectEmailContact}
                    className="w-full py-2 px-3 rounded-xl bg-stone-900/80 hover:bg-stone-800 border border-stone-800 text-stone-300 hover:text-emerald-300 font-bold text-[11px] transition-all cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <Mail className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>ارسال از طریق ایمیل ({SUPPORT_EMAIL})</span>
                  </button>
                </div>
              </form>
            )}

            {/* پیام تأیید پس از ارسال موفق پیشنهاد */}
            {stage === 'submitted' && (
              <div className="space-y-3 py-3 text-center">
                <div className="mx-auto w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center text-emerald-400">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <h4 className="text-sm sm:text-base font-black text-emerald-300">
                  سپاس از همراهی شما با «<span data-keep-color="true" className="text-[#FF8C00]">یاد</span>»!
                </h4>
                <p className="text-xs text-stone-300 leading-relaxed">
                  پیام ارزشمند شما با موفقیت برای تیم فناوری نارون ارسال شد.
                </p>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

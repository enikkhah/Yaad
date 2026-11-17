import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Check,
  Crown,
  Gift,
  Lock,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Store,
  X,
} from 'lucide-react';
import {
  formatToman,
  getStoreDisplayName,
  LAUNCH_BATCH_1_MAX,
  LAUNCH_BATCH_2_MAX,
  PRO_PLANS,
  ProPlanConfig,
} from '../config/billingConfig';
import { SkuPriceDetail } from '../utils/billingProvider';
import {
  activateLaunchOfferGift,
  fetchStoreSkuPrices,
  getProFeatureLabel,
  ProEntitlementState,
  ProFeatureId,
  purchaseProSku,
  restoreProPurchases,
} from '../utils/proEntitlement';
import { toPersianDigits } from '../utils/jalali';

interface ProPaywallModalProps {
  isOpen: boolean;
  onClose: () => void;
  language: 'fa' | 'en';
  entitlement: ProEntitlementState;
  blockedFeature?: ProFeatureId | null;
  onEntitlementUpdated: (next: ProEntitlementState) => void;
}

export const ProPaywallModal: React.FC<ProPaywallModalProps> = ({
  isOpen,
  onClose,
  language,
  entitlement,
  blockedFeature = null,
  onEntitlementUpdated,
}) => {
  const isFa = language === 'fa';
  const [skuPrices, setSkuPrices] = useState<Record<string, SkuPriceDetail>>({});
  const [busySku, setBusySku] = useState<string | null>(null);
  const [isClaimingGift, setIsClaimingGift] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setFeedback(null);
      setBusySku(null);
      setIsClaimingGift(false);
      setIsRestoring(false);
      return;
    }

    if (entitlement.billingConfigured) {
      let mounted = true;
      fetchStoreSkuPrices()
        .then((list) => {
          if (!mounted || !Array.isArray(list)) return;
          const map: Record<string, SkuPriceDetail> = {};
          for (const item of list) {
            if (item?.sku) map[item.sku] = item;
          }
          setSkuPrices(map);
        })
        .catch(() => {});
      return () => {
        mounted = false;
      };
    }
  }, [isOpen, entitlement.billingConfigured]);

  const storeName = getStoreDisplayName(entitlement.store, isFa);
  const launchBatch = entitlement.launchOffer?.batch ?? null;
  const launchUserNumber = entitlement.launchOffer?.userNumber ?? null;
  const hasEligibleLaunchGift = launchBatch === 1 || launchBatch === 2;

  const handleClaimLaunchGift = async () => {
    if (isClaimingGift || busySku || isRestoring) return;
    setIsClaimingGift(true);
    setFeedback(null);
    try {
      const res = await activateLaunchOfferGift(language);
      onEntitlementUpdated(res.state);
      if (res.activated) {
        setFeedback({
          type: 'success',
          text:
            launchBatch === 1
              ? isFa
                ? `تبریک! هدیه ۱۰۰٪ رایگان دسته اول (نفر #${toPersianDigits(launchUserNumber || 1)} — اشتراک دائمی Pro) برای شما فعال شد.`
                : `Congratulations! Batch 1 100% Free Lifetime Pro (#${launchUserNumber || 1}) is now active.`
              : isFa
              ? `تبریک! هدیه ۱۰۰٪ رایگان دسته دوم (نفر #${toPersianDigits(launchUserNumber || 366)} — اشتراک ۱ ساله Pro) برای شما فعال شد.`
              : `Congratulations! Batch 2 100% Free 1-Year Pro (#${launchUserNumber || 366}) is now active.`,
        });
      } else {
        setFeedback({
          type: 'error',
          text:
            res.errorMessage ||
            (isFa ? 'فعال‌سازی هدیه لانچ انجام نشد.' : 'Could not activate launch gift.'),
        });
      }
    } finally {
      setIsClaimingGift(false);
    }
  };

  const handleBuy = async (plan: ProPlanConfig) => {
    // If this plan matches the user's 100%-free Launch Offer batch (Batch 1 -> Lifetime, Batch 2 -> 1Y),
    // activate the verified 100%-free launch gift directly without requiring store payment!
    if (plan.eligibleLaunchBatch && plan.eligibleLaunchBatch === launchBatch) {
      await handleClaimLaunchGift();
      return;
    }

    if (!entitlement.billingConfigured || busySku || isRestoring || isClaimingGift) return;
    setBusySku(plan.sku);
    setFeedback(null);
    try {
      const { result, state } = await purchaseProSku(plan.sku, [], language);
      onEntitlementUpdated(state);
      if (result.success) {
        setFeedback({
          type: 'success',
          text: result.alreadyOwned
            ? isFa
              ? 'این اشتراک قبلاً روی حساب شما فعال بوده و اکنون همگام‌سازی شد.'
              : 'Your previous purchase was already active and has been synced.'
            : isFa
            ? 'نسخه حرفه‌ای یاد با موفقیت فعال شد! سپاس از حمایت شما.'
            : 'YAAD Pro activated successfully! Thank you for your support.',
        });
      } else if (result.cancelled) {
        setFeedback({
          type: 'info',
          text: isFa ? 'پرداخت توسط شما لغو شد.' : 'Purchase cancelled.',
        });
      } else {
        setFeedback({
          type: 'error',
          text:
            result.errorMessage ||
            (isFa
              ? `اتصال به ${storeName} یا تکمیل خرید انجام نشد.`
              : `Could not complete purchase with ${storeName}.`),
        });
      }
    } finally {
      setBusySku(null);
    }
  };

  const handleRestore = async () => {
    if (!entitlement.billingConfigured || busySku || isRestoring || isClaimingGift) return;
    setIsRestoring(true);
    setFeedback(null);
    try {
      const res = await restoreProPurchases([], language);
      onEntitlementUpdated(res.state);
      if (res.restored) {
        setFeedback({
          type: 'success',
          text: isFa
            ? `خرید قبلی شما از ${storeName} با موفقیت بازیابی و فعال شد.`
            : `Your previous purchase from ${storeName} was restored.`,
        });
      } else if (res.offlineOrUnavailable) {
        setFeedback({
          type: 'error',
          text:
            res.errorMessage ||
            (isFa
              ? `ارتباط با ${storeName} برقرار نشد. مطمئن شوید اینترنت وصل است و برنامه ${storeName} نصب است.`
              : `Could not reach ${storeName}. Please check connection and store app.`),
        });
      } else {
        setFeedback({
          type: 'info',
          text: isFa
            ? `خریدی برای حساب فعلی شما در ${storeName} یافت نشد.`
            : `No active purchases found on this ${storeName} account.`,
        });
      }
    } finally {
      setIsRestoring(false);
    }
  };

  const renderPlanPrice = (plan: ProPlanConfig): string => {
    if (plan.eligibleLaunchBatch && plan.eligibleLaunchBatch === launchBatch) {
      return isFa ? 'رایگان (۱۰۰٪ تخفیف هدیه لانچ)' : 'FREE (100% Launch Gift)';
    }
    const storeDetail = skuPrices[plan.sku];
    if (storeDetail?.price && storeDetail.price.trim().length > 0) {
      return storeDetail.price;
    }
    return formatToman(plan.fallbackPriceToman, isFa);
  };

  const freeFeatures = isFa
    ? [
        'ساخت و مدیریت یادآورهای نامحدود',
        'زنگ و هشدار تمام‌صفحه (همیشه رایگان)',
        'مشاهده و بازیابی همه اطلاعات قبلی و سطل بازیافت',
      ]
    : [
        'Unlimited time-based reminders',
        'Full-screen alarm alerts (always free)',
        'View & restore all saved data and recycle bin',
      ];

  const proFeatures = isFa
    ? [
        'ساخت و ویرایش نامحدود مناسبت‌ها و مکان‌های GPS',
        'حصار مکانی (جئوفنس) و رادار ورود/خروج',
        'ایده‌ها با دست‌خط/نقاشی و پیوست عکس (یادآور، مکان، ایده)',
        'خروجی و وارد کردن فایل بک‌آپ (JSON) و همه تم‌های ویژه',
      ]
    : [
        'Create & edit unlimited occasions & GPS places',
        'Smart Geofence enter/exit alerts & radar',
        'Sketch/handwriting ideas & photo attachments',
        'JSON backup export/import & all premium themes',
      ];

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 40, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 40, opacity: 0, scale: 0.98 }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg bg-stone-900 border border-stone-800 rounded-3xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
          >
            {/* Header */}
            <div className="px-4 py-3.5 border-b border-stone-800 flex items-center justify-between bg-stone-900/95 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-400/40 text-amber-300 flex items-center justify-center shrink-0">
                  <Crown className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-black text-base text-white truncate">
                    {isFa ? 'نسخه حرفه‌ای یاد (YAAD Pro)' : 'YAAD Pro'}
                  </h3>
                  <p className="text-[11px] text-stone-400 truncate">
                    {entitlement.hasPaidPro
                      ? entitlement.reason === 'paid_lifetime'
                        ? isFa
                          ? 'اشتراک دائمی روی حساب شما فعال است'
                          : 'Lifetime Pro is active on your account'
                        : isFa
                        ? `اشتراک ۱ ساله فعال (${toPersianDigits(entitlement.paidRemainingDays ?? 0)} روز باقی‌مانده)`
                        : `1-Year Pro active (${entitlement.paidRemainingDays ?? 0} days left)`
                      : entitlement.trial.isTrialActive
                      ? isFa
                        ? `${toPersianDigits(entitlement.trial.remainingDays)} روز از دوره هدیه ۴۰ روزه باقی مانده`
                        : `${entitlement.trial.remainingDays} day(s) left in your 40-day free trial`
                      : isFa
                      ? 'دوره ۴۰ روزه هدیه به پایان رسیده است'
                      : 'Your 40-day free trial has ended'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-xl text-stone-400 hover:text-white hover:bg-stone-800 transition-colors cursor-pointer"
                aria-label={isFa ? 'بستن' : 'Close'}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {blockedFeature && !entitlement.hasProAccess && (
                <div className="p-3 rounded-2xl bg-amber-500/12 border border-amber-500/35 flex items-start gap-2.5">
                  <Lock className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
                  <div className="text-xs text-amber-100 leading-relaxed space-y-0.5">
                    <p className="font-bold">
                      {isFa
                        ? `«${getProFeatureLabel(blockedFeature, true)}» نیاز به نسخه Pro دارد.`
                        : `"${getProFeatureLabel(blockedFeature, false)}" requires YAAD Pro.`}
                    </p>
                    <p className="text-[11px] text-amber-200/80">
                      {isFa
                        ? 'همه اطلاعات، مناسبت‌ها، مکان‌ها و ایده‌های قبلی شما دست‌نخورده و قابل مشاهده باقی مانده‌اند.'
                        : 'All your previously saved items remain safe and viewable.'}
                    </p>
                  </div>
                </div>
              )}

              {/* 365-User Batch Launch Offer Banner */}
              {hasEligibleLaunchGift && launchUserNumber && (
                <div className="p-3.5 rounded-2xl bg-gradient-to-br from-emerald-950/75 via-stone-900 to-amber-950/65 border border-emerald-400/50 shadow-md space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 flex items-center justify-center shrink-0">
                        <Gift className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-xs sm:text-sm font-black text-emerald-300">
                          {launchBatch === 1
                            ? isFa
                              ? `جشنواره لانچ (دسته اول ۳۶۵ نفری • نفر #${toPersianDigits(launchUserNumber)})`
                              : `Launch Offer Batch 1 (User #${launchUserNumber} of ${LAUNCH_BATCH_1_MAX})`
                            : isFa
                            ? `جشنواره لانچ (دسته دوم ۳۶۵ نفری • نفر #${toPersianDigits(launchUserNumber)})`
                            : `Launch Offer Batch 2 (User #${launchUserNumber} of ${LAUNCH_BATCH_2_MAX})`}
                        </p>
                        <p className="text-[11px] text-stone-200 leading-relaxed mt-0.5">
                          {launchBatch === 1
                            ? isFa
                              ? 'شما جزو ۳۶۵ نصب اول یاد هستید! اشتراک دائمی Pro با ۱۰۰٪ تخفیف (کاملاً رایگان) به شما تعلق گرفته است.'
                              : 'You are among the first 365 users! Claim Lifetime Pro with a 100% discount (Free).'
                            : isFa
                            ? 'شما در دسته دوم ۳۶۵ نفری یاد (نفر ۳۶۶ تا ۷۳۰) هستید! اشتراک ۱ ساله Pro با ۱۰۰٪ تخفیف به شما تعلق گرفته است.'
                            : 'You are in the second 365-user batch (366–730)! Claim 1-Year Pro with a 100% discount.'}
                        </p>
                      </div>
                    </div>
                  </div>
                  {!entitlement.hasPaidPro && (
                    <button
                      type="button"
                      disabled={isClaimingGift || Boolean(busySku) || isRestoring}
                      onClick={handleClaimLaunchGift}
                      className="w-full min-h-[42px] px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-stone-950 font-black text-xs shadow-md active:scale-95 transition-all cursor-pointer disabled:opacity-60"
                    >
                      {isClaimingGift
                        ? isFa
                          ? 'در حال فعال‌سازی هدیه...'
                          : 'Activating gift...'
                        : launchBatch === 1
                        ? isFa
                          ? 'دریافت رایگان اشتراک دائمی (هدیه دسته اول)'
                          : 'Claim Free Lifetime Pro (Batch 1 Gift)'
                        : isFa
                        ? 'دریافت رایگان اشتراک ۱ ساله (هدیه دسته دوم)'
                        : 'Claim Free 1-Year Pro (Batch 2 Gift)'}
                    </button>
                  )}
                </div>
              )}

              {entitlement.trial.clockTampered && !entitlement.hasPaidPro && (
                <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-[11px] text-rose-200 leading-relaxed">
                  {isFa
                    ? 'تغییر ساعت دستگاه به عقب شناسایی شد؛ زمان دوره آزمایشی بر اساس آخرین زمان معتبر محاسبه می‌شود.'
                    : 'Device clock rollback detected; trial progress uses the latest monotonic timestamp.'}
                </div>
              )}

              {/* Comparison */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div className="p-3 rounded-2xl bg-stone-950/75 border border-stone-800 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-black text-emerald-300">
                    <ShieldCheck className="w-4 h-4 shrink-0" />
                    <span>{isFa ? 'همیشه رایگان' : 'Always Free'}</span>
                  </div>
                  <ul className="space-y-1.5 text-[11px] text-stone-300">
                    {freeFeatures.map((item) => (
                      <li key={item} className="flex items-start gap-1.5 leading-snug">
                        <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="p-3 rounded-2xl bg-indigo-950/35 border border-indigo-500/35 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-black text-amber-300">
                    <Sparkles className="w-4 h-4 shrink-0" />
                    <span>{isFa ? 'امکانات YAAD Pro' : 'YAAD Pro Features'}</span>
                  </div>
                  <ul className="space-y-1.5 text-[11px] text-stone-200">
                    {proFeatures.map((item) => (
                      <li key={item} className="flex items-start gap-1.5 leading-snug">
                        <Check className="w-3.5 h-3.5 text-amber-300 shrink-0 mt-0.5" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Plans */}
              {entitlement.billingConfigured || hasEligibleLaunchGift ? (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-xs text-stone-400 px-1">
                    <span className="font-bold text-stone-300">
                      {isFa ? 'انتخاب پلن ارتقا:' : 'Select Plan:'}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11px] text-indigo-300 font-bold">
                      <Store className="w-3.5 h-3.5" />
                      <span>{storeName}</span>
                    </span>
                  </div>

                  {PRO_PLANS.map((plan) => {
                    const isPlanGiftBatch =
                      Boolean(plan.eligibleLaunchBatch) && plan.eligibleLaunchBatch === launchBatch;
                    const isAlreadyOwned =
                      entitlement.activePurchase?.productId === plan.sku ||
                      entitlement.activePurchase?.productId === plan.batchDiscountSku ||
                      entitlement.reason === 'paid_lifetime';
                    const isBusy = busySku === plan.sku || (isPlanGiftBatch && isClaimingGift);
                    const canPurchaseThisPlan =
                      entitlement.billingConfigured || isPlanGiftBatch;

                    return (
                      <div
                        key={plan.sku}
                        className={`p-3.5 rounded-2xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                          isPlanGiftBatch
                            ? 'bg-gradient-to-br from-emerald-500/15 to-amber-500/12 border-emerald-400/55'
                            : plan.id === 'lifetime'
                            ? 'bg-gradient-to-br from-amber-500/12 to-indigo-500/12 border-amber-400/45'
                            : 'bg-stone-950/80 border-stone-800'
                        }`}
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-black text-white">
                              {isFa ? plan.titleFa : plan.titleEn}
                            </span>
                            {isPlanGiftBatch ? (
                              <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 text-[10px] font-black">
                                {isFa ? '۱۰۰٪ تخفیف دسته ۳۶۵ نفری' : '100% Off Batch Gift'}
                              </span>
                            ) : (
                              plan.badgeFa && (
                                <span className="px-2 py-0.5 rounded-md bg-amber-500/20 border border-amber-400/35 text-amber-300 text-[10px] font-black">
                                  {isFa ? plan.badgeFa : plan.badgeEn}
                                </span>
                              )
                            )}
                          </div>
                          <p className="text-[11px] text-stone-400 leading-relaxed">
                            {isFa ? plan.subtitleFa : plan.subtitleEn}
                          </p>
                          <p className="text-sm font-black text-emerald-300 pt-0.5">
                            {renderPlanPrice(plan)}
                          </p>
                        </div>

                        <button
                          type="button"
                          disabled={
                            Boolean(busySku) ||
                            isClaimingGift ||
                            isRestoring ||
                            isAlreadyOwned ||
                            !canPurchaseThisPlan
                          }
                          onClick={() => handleBuy(plan)}
                          className={`min-h-[44px] px-4 py-2 rounded-xl font-black text-xs transition-all shrink-0 flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
                            isAlreadyOwned
                              ? 'bg-emerald-600/25 border border-emerald-500/45 text-emerald-300'
                              : isPlanGiftBatch
                              ? 'bg-emerald-500 hover:bg-emerald-400 text-stone-950 shadow-md active:scale-95'
                              : plan.id === 'lifetime'
                              ? 'bg-amber-500 hover:bg-amber-400 text-stone-950 shadow-md active:scale-95'
                              : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-md active:scale-95'
                          }`}
                        >
                          {isBusy ? (
                            <span>{isFa ? 'در حال اتصال...' : 'Connecting...'}</span>
                          ) : isAlreadyOwned ? (
                            <>
                              <Check className="w-4 h-4" />
                              <span>{isFa ? 'فعال است' : 'Active'}</span>
                            </>
                          ) : isPlanGiftBatch ? (
                            <span>{isFa ? 'فعال‌سازی رایگان هدیه' : 'Claim Free Gift'}</span>
                          ) : (
                            <span>
                              {isFa ? `خرید از ${storeName}` : `Buy via ${storeName}`}
                            </span>
                          )}
                        </button>
                      </div>
                    );
                  })}

                  {entitlement.billingConfigured && (
                    <button
                      type="button"
                      disabled={Boolean(busySku) || isRestoring || isClaimingGift}
                      onClick={handleRestore}
                      className="w-full min-h-[42px] px-3 py-2 rounded-xl bg-stone-950 hover:bg-stone-800 border border-stone-800 text-stone-300 font-bold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-60"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isRestoring ? 'animate-spin' : ''}`} />
                      <span>
                        {isRestoring
                          ? isFa
                            ? `در حال بررسی سوابق ${storeName}...`
                            : `Checking ${storeName}...`
                          : isFa
                          ? 'بازیابی خریدهای قبلی'
                          : 'Restore Purchases'}
                      </span>
                    </button>
                  )}
                </div>
              ) : (
                <div className="p-3.5 rounded-2xl bg-stone-950/80 border border-stone-800 text-xs text-stone-300 leading-relaxed space-y-1">
                  <p className="font-bold text-white flex items-center gap-1.5">
                    <Store className="w-4 h-4 text-indigo-400 shrink-0" />
                    <span>
                      {entitlement.store === 'none'
                        ? isFa
                          ? 'پرداخت درون‌برنامه‌ای در نسخه وب غیرفعال است'
                          : 'In-app billing is unavailable in the Web build'
                        : isFa
                        ? `درگاه پرداخت ${storeName} در این بیلد پیکربندی نشده است`
                        : `${storeName} billing key is not configured in this build`}
                    </span>
                  </p>
                  <p className="text-[11px] text-stone-400">
                    {isFa
                      ? 'برای خرید و فعال‌سازی نسخه Pro، از نسخه رسمی منتشرشده در کافه‌بازار یا مایکت استفاده کنید.'
                      : 'Install the official signed release from Cafe Bazaar or Myket to unlock Pro.'}
                  </p>
                </div>
              )}

              {feedback && (
                <div
                  className={`p-3 rounded-xl text-xs font-bold leading-relaxed ${
                    feedback.type === 'success'
                      ? 'bg-emerald-500/15 border border-emerald-500/40 text-emerald-300'
                      : feedback.type === 'error'
                      ? 'bg-rose-500/15 border border-rose-500/40 text-rose-300'
                      : 'bg-indigo-500/15 border border-indigo-500/40 text-indigo-200'
                  }`}
                >
                  {feedback.text}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-4 py-3 border-t border-stone-800 bg-stone-900/95 flex justify-end shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[42px] px-5 py-2 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-200 font-bold text-xs transition-colors cursor-pointer"
              >
                {isFa ? 'بستن' : 'Close'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

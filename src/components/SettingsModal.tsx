import React, { useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AppSettings, AppTheme, PhoneAlarmSound, Reminder, IdeaNote, SavedLocation, Occasion } from '../types';
import { 
  X, 
  Palette, 
  LogOut,
  Bell,
  BarChart3,
  Type,
  Smartphone,
  Globe,
  Database,
  MapPin,
  Camera,
  Mic,
  ShieldCheck,
  Info,
  Volume2,
  Play,
  Square,
  Radio,
  ChevronDown,
  ChevronUp,
  Trash2,
  RotateCcw,
  Calendar,
  Lightbulb,
  ExternalLink,
  FolderOpen,
  Mail,
  Clock,
  Maximize2,
  Download,
  Upload,
  BatteryCharging,
  Crown,
  Gift,
  Check,
  RefreshCw,
  Unlink
} from 'lucide-react';
import { Share } from '@capacitor/share';
import { getT } from '../utils/i18n';
import { APP_VERSION } from '../utils/version';
import { toPersianDigits, formatJalaliFull } from '../utils/jalali';
import { openReviewDialogDirectly } from '../utils/reviewFlow';
import { ProBadge } from './ProBadge';
import {
  ProEntitlementState,
  ProFeatureId,
  recoverLaunchOfferGiftByCode,
} from '../utils/proEntitlement';
import { getBillingProvider, isPurchaseStateValid } from '../utils/billingProvider';
import { 
  setGeofenceTrackingEnabled
} from '../utils/geofenceManager';
import { 
  isNativeAndroidApp,
  requestNotificationPermission,
  requestMicrophonePermission,
  requestCameraPermission,
  requestLocationPermission,
  requestAllNativePermissions,
  checkAllPermissionsStatus,
  disablePermissionLocally,
  ToggleablePermissionType,
  hasBackgroundLocationPermission,
  hasExactAlarmPermission,
  hasFullScreenIntentPermission,
  openAndroidSettings,
  NativePermissionsStatus
} from '../utils/nativePermissions';
import {
  exportBackupToFile,
  importBackupFromFile,
  importBackupFromFolderFiles,
  getBackupFolderStatus,
  chooseAutoBackupFolder,
  reconnectDesktopBackupFolder,
  readBackupFromConnectedFolder,
  revokeLocalFolderPermission,
  performAutoBackup,
  getSnapshotItemCount,
  BackupFolderStatus,
  LAST_LOCAL_BACKUP_KEY,
} from '../utils/backupStorage';
import { 
  openGoogleCalendarAccount
} from '../utils/googleSync';
import { App as CapacitorApp } from '@capacitor/app';
import {
  PHONE_ALARM_SOUNDS,
  playPhoneAlarmSound,
  stopAlarmRinging,
  stopPreviewSound,
  unlockAudio,
  setGlobalVibration,
} from '../utils/audio';
import { syncNotificationSoundAndVolume, syncAllRemindersWithLocalNotifications } from '../utils/nativeLocalNotifications';
import { scrollAccordionHeaderIntoView } from '../utils/accordionScroll';
import { User } from 'firebase/auth';
import appIcon from '../assets/images/icon.png';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void;
  googleUser: User | null;
  googleToken: string | null;
  onGoogleSignIn: (options?: { openCalendar?: boolean }) => Promise<void>;
  onGoogleSignOut: () => Promise<void>;
  onOpenStats?: () => void;
  reminders?: Reminder[];
  ideas?: IdeaNote[];
  savedLocations?: SavedLocation[];
  occasions?: Occasion[];
  onRestoreData?: (data: { reminders?: Reminder[]; ideas?: IdeaNote[]; savedLocations?: SavedLocation[]; occasions?: Occasion[]; settings?: Partial<AppSettings> }, mode: 'replace' | 'merge') => void;
  isGeofenceActive?: boolean;
  onToggleGeofenceActive?: (active: boolean) => void;
  onRestoreItem?: (id: string, type: 'reminder' | 'location' | 'occasion' | 'idea') => void;
  onPermanentDeleteItem?: (id: string, type: 'reminder' | 'location' | 'occasion' | 'idea') => void;
  onEmptyRecycleBin?: () => void;
  proEntitlement?: ProEntitlementState;
  onOpenProPaywall?: (feature?: ProFeatureId) => void;
  onEntitlementUpdated?: (next: ProEntitlementState) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  googleUser,
  onGoogleSignIn,
  onGoogleSignOut,
  onOpenStats,
  reminders = [],
  ideas = [],
  savedLocations = [],
  occasions = [],
  onRestoreData,
  isGeofenceActive = true,
  onToggleGeofenceActive,
  onRestoreItem,
  onPermanentDeleteItem,
  onEmptyRecycleBin,
  proEntitlement,
  onOpenProPaywall,
  onEntitlementUpdated,
}) => {
  const hasProAccess = proEntitlement ? proEntitlement.hasProAccess : true;
  const currentLanguage = settings?.language || 'fa';
  const isFa = currentLanguage === 'fa';
  const t = getT(currentLanguage);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [activeInfoDialog, setActiveInfoDialog] = useState<'privacy' | 'about' | null>(null);

  const [playingSoundId, setPlayingSoundId] = useState<PhoneAlarmSound | null>(null);
  const soundTimeoutRef = useRef<number | null>(null);
  const [backupFeedback, setBackupFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isBackupBusy, setIsBackupBusy] = useState(false);
  const [folderStatus, setFolderStatus] = useState<BackupFolderStatus | null>(null);
  const [isFolderBusy, setIsFolderBusy] = useState(false);
  const [importedRecoveryCode, setImportedRecoveryCode] = useState<string | null>(null);
  const [isRecoveringFromBackup, setIsRecoveringFromBackup] = useState(false);
  const importBackupInputRef = useRef<HTMLInputElement | null>(null);
  const folderRestoreInputRef = useRef<HTMLInputElement | null>(null);

  // Gift Pro to a friend state (for verified paid Pro users only)
  const [verifiedGiftSku, setVerifiedGiftSku] = useState<'yaad_pro_lifetime' | 'yaad_pro_1y' | null>(null);
  const [giftToastMessage, setGiftToastMessage] = useState<string | null>(null);
  const giftToastTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!proEntitlement?.hasPaidPro) {
      setVerifiedGiftSku(null);
      return;
    }

    // 1. Resolve from cached verified activePurchase
    const cachedProductId = proEntitlement.activePurchase?.productId || '';
    if (cachedProductId === 'yaad_pro_lifetime' || cachedProductId.includes('lifetime') || proEntitlement.reason === 'paid_lifetime') {
      setVerifiedGiftSku('yaad_pro_lifetime');
    } else if (cachedProductId === 'yaad_pro_1y' || cachedProductId.includes('1y') || proEntitlement.reason === 'paid_1y') {
      setVerifiedGiftSku('yaad_pro_1y');
    }

    // 2. Also verify against live store purchases list when modal opens
    if (!isOpen) return;
    const provider = getBillingProvider(proEntitlement.store);
    if (!provider.isAvailable()) return;

    let active = true;
    provider
      .queryPurchases(['yaad_pro_lifetime', 'yaad_pro_1y'])
      .then((res) => {
        if (!active || res.offlineOrUnavailable || !Array.isArray(res.purchases)) return;
        const validPurchases = res.purchases.filter((p) => isPurchaseStateValid(p.purchaseState));
        if (validPurchases.some((p) => p.productId === 'yaad_pro_lifetime')) {
          setVerifiedGiftSku('yaad_pro_lifetime');
        } else if (validPurchases.some((p) => p.productId === 'yaad_pro_1y')) {
          setVerifiedGiftSku('yaad_pro_1y');
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [isOpen, proEntitlement]);

  useEffect(() => {
    return () => {
      if (giftToastTimeoutRef.current) {
        window.clearTimeout(giftToastTimeoutRef.current);
      }
    };
  }, []);

  const showGiftCopiedToast = (msg: string) => {
    setGiftToastMessage(msg);
    if (giftToastTimeoutRef.current) {
      window.clearTimeout(giftToastTimeoutRef.current);
    }
    giftToastTimeoutRef.current = window.setTimeout(() => {
      setGiftToastMessage(null);
    }, 4000);
  };

  const handleShareProGift = async () => {
    if (!proEntitlement?.hasPaidPro || !verifiedGiftSku) return;

    const isLifetime = verifiedGiftSku === 'yaad_pro_lifetime';
    const planLabel = isLifetime ? 'اشتراک دائمی' : 'اشتراک یک‌ساله';
    const giftCode = isLifetime ? 'YAAD-LIFE-GIFT' : 'YAAD-1Y-GIFT';

    const giftText = `سلام! من برای کارهام از اپلیکیشن «یاد» استفاده می‌کنم. چون ${planLabel} این برنامه رو دارم، یک کد هدیه بهم داده تا یکی از دوستام هم بتونه نسخه حرفه‌ایش رو کاملاً رایگان فعال کنه.
اگر به کارت میاد می‌تونی از لینک‌های زیر نصبش کنی و این کد رو داخل برنامه بزنی: ${giftCode}
لینک کافه‌بازار:
https://cafebazaar.ir/app/com.yaad.reminder
لینک مایکت:
https://myket.ir/app/com.yaad.reminder`;

    const copyFallback = async () => {
      try {
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(giftText);
        } else {
          const textArea = document.createElement('textarea');
          textArea.value = giftText;
          textArea.style.position = 'fixed';
          textArea.style.opacity = '0';
          document.body.appendChild(textArea);
          textArea.select();
          document.execCommand('copy');
          document.body.removeChild(textArea);
        }
        showGiftCopiedToast('متن هدیه کپی شد. حالا می‌تونید برای دوستتون بفرستید.');
      } catch {
        showGiftCopiedToast('متن هدیه کپی شد. حالا می‌تونید برای دوستتون بفرستید.');
      }
    };

    try {
      const canShareRes = await Share.canShare().catch(() => ({ value: false }));
      if (canShareRes?.value) {
        await Share.share({
          title: 'هدیه نسخه Pro به یک دوست',
          text: giftText,
          dialogTitle: 'هدیه نسخه Pro به یک دوست',
        });
        return;
      }
      await copyFallback();
    } catch (err: any) {
      const errMsg = String(err?.message || err || '').toLowerCase();
      if (errMsg.includes('cancel') || errMsg.includes('abort') || errMsg.includes('dismiss')) {
        return;
      }
      await copyFallback();
    }
  };

  // Recycle Bin state
  const [isConfirmingEmptyBin, setIsConfirmingEmptyBin] = useState<boolean>(false);

  // Native permissions state (for Android APK / PWA)
  const [nativePerms, setNativePerms] = useState<NativePermissionsStatus>({
    notifications: false,
    microphone: false,
    camera: false,
    location: false,
    backgroundLocation: false,
    exactAlarm: !isNativeAndroidApp(),
    fullScreenIntent: !isNativeAndroidApp(),
  });
  const [isRequestingAllPerms, setIsRequestingAllPerms] = useState(false);

  // 6 Collapsible groups state: ظاهر، صدا، دسترسی‌ها، همگام‌سازی، پشتیبان، سطل بازیافت
  const [openSections, setOpenSections] = useState<{
    appearance: boolean;
    sound: boolean;
    permissions: boolean;
    sync: boolean;
    backup: boolean;
    recycleBin: boolean;
  }>({
    appearance: true,
    sound: false,
    permissions: false,
    sync: false,
    backup: false,
    recycleBin: false,
  });

  const toggleSection = (section: keyof typeof openSections, targetEl?: HTMLElement | null) => {
    setOpenSections((prev) => {
      const willOpen = !prev[section];
      if (willOpen && targetEl) {
        scrollAccordionHeaderIntoView(targetEl, 38);
      }
      return {
        ...prev,
        [section]: willOpen,
      };
    });
  };

  const deletedReminders = (reminders || []).filter((r) => !!r.deletedAt);
  const deletedIdeas = (ideas || []).filter((i) => !!i.deletedAt);
  const deletedLocations = (savedLocations || []).filter((l) => !!l.deletedAt);
  const deletedOccasions = (occasions || []).filter((o) => !!o.deletedAt);

  const allDeletedItems = [
    ...deletedReminders.map((r) => ({ id: r.id, type: 'reminder' as const, title: r.title, deletedAt: r.deletedAt! })),
    ...deletedIdeas.map((i) => ({ id: i.id, type: 'idea' as const, title: i.title, deletedAt: i.deletedAt! })),
    ...deletedLocations.map((l) => ({ id: l.id, type: 'location' as const, title: l.title, deletedAt: l.deletedAt! })),
    ...deletedOccasions.map((o) => ({ id: o.id, type: 'occasion' as const, title: o.title, deletedAt: o.deletedAt! })),
  ].sort((a, b) => b.deletedAt - a.deletedAt);

  const [showBgLocationNotice, setShowBgLocationNotice] = useState(false);
  const [bgLocationNoticeDismissed, setBgLocationNoticeDismissed] = useState(false);
  const [revokedPermNotice, setRevokedPermNotice] = useState<ToggleablePermissionType | null>(null);

  useEffect(() => {
    if (isOpen) {
      let isMounted = true;
      const refreshPerms = () => {
        checkAllPermissionsStatus().then((updated) => {
          if (!isMounted) return;
          setNativePerms(updated);
          if (updated.location && updated.backgroundLocation) {
            setShowBgLocationNotice(false);
            setBgLocationNoticeDismissed(false);
          }
        });
      };
      getBackupFolderStatus().then((status) => {
        if (isMounted) setFolderStatus(status);
      }).catch(() => {});
      refreshPerms();
      const pollTimer = window.setInterval(refreshPerms, 1500);
      window.addEventListener('focus', refreshPerms);
      document.addEventListener('visibilitychange', refreshPerms);
      let appStateListener: { remove: () => Promise<void> } | null = null;
      try {
        CapacitorApp.addListener('appStateChange', ({ isActive }) => {
          if (isActive) refreshPerms();
        }).then((listener) => {
          appStateListener = listener;
        }).catch(() => {});
      } catch {}

      return () => {
        isMounted = false;
        window.clearInterval(pollTimer);
        window.removeEventListener('focus', refreshPerms);
        document.removeEventListener('visibilitychange', refreshPerms);
        if (appStateListener) {
          appStateListener.remove().catch(() => {});
        }
      };
    } else {
      stopAlarmRinging();
      setPlayingSoundId(null);
      if (soundTimeoutRef.current) clearTimeout(soundTimeoutRef.current);
    }
  }, [isOpen]);

  const handleRequestPerm = async (
    type: 'notifications' | 'microphone' | 'camera' | 'location' | 'exact_alarm' | 'full_screen_intent'
  ) => {
    if (type === 'exact_alarm') {
      openAndroidSettings('exact_alarm');
      const updated = await checkAllPermissionsStatus();
      setNativePerms({ ...updated, exactAlarm: hasExactAlarmPermission() });
      return;
    }
    if (type === 'full_screen_intent') {
      openAndroidSettings('full_screen_intent');
      const updated = await checkAllPermissionsStatus();
      setNativePerms({ ...updated, fullScreenIntent: hasFullScreenIntentPermission() });
      return;
    }

    const isCurrentlyOn = Boolean(nativePerms[type as keyof NativePermissionsStatus]);
    if (isCurrentlyOn) {
      await disablePermissionLocally(type as ToggleablePermissionType);
      setNativePerms((prev) => ({
        ...prev,
        [type]: false,
        ...(type === 'location' ? { backgroundLocation: false } : {}),
      }));
      if (type === 'location') {
        setShowBgLocationNotice(false);
        setGeofenceTrackingEnabled(false);
        onToggleGeofenceActive?.(false);
      }
      if (isNativeAndroidApp()) {
        setRevokedPermNotice(type as ToggleablePermissionType);
      }
      return;
    }

    setRevokedPermNotice(null);
    let granted = false;
    if (type === 'notifications') {
      granted = await requestNotificationPermission();
    } else if (type === 'microphone') {
      granted = await requestMicrophonePermission();
    } else if (type === 'camera') {
      granted = await requestCameraPermission();
    } else if (type === 'location') {
      granted = await requestLocationPermission();
    }
    const updated = await checkAllPermissionsStatus();
    const locGranted = Boolean(updated.location || (type === 'location' && granted));
    const bgLocGranted = locGranted ? hasBackgroundLocationPermission() : false;
    const merged: NativePermissionsStatus = {
      ...updated,
      [type]: updated[type as keyof NativePermissionsStatus] || granted,
      location: locGranted,
      backgroundLocation: bgLocGranted,
    };
    setNativePerms(merged);
    if (type === 'location') {
      if (!merged.location || !merged.backgroundLocation) {
        setShowBgLocationNotice(true);
        setBgLocationNoticeDismissed(false);
        if (isNativeAndroidApp()) {
          openAndroidSettings('background_location');
        }
        return;
      } else {
        setShowBgLocationNotice(false);
      }
    }
    if (!merged[type as keyof NativePermissionsStatus] && isNativeAndroidApp()) {
      openAndroidSettings(type);
    }
  };

  const handleRequestAllPerms = async () => {
    setIsRequestingAllPerms(true);
    const updated = await requestAllNativePermissions();
    setNativePerms(updated);
    if (isNativeAndroidApp() && (!updated.location || !updated.backgroundLocation)) {
      setShowBgLocationNotice(true);
      setBgLocationNoticeDismissed(false);
    } else {
      setShowBgLocationNotice(false);
    }
    setIsRequestingAllPerms(false);
  };

  useEffect(() => {
    return () => {
      stopPreviewSound();
      if (soundTimeoutRef.current) clearTimeout(soundTimeoutRef.current);
    };
  }, []);

  const handlePreviewSound = (soundId: PhoneAlarmSound) => {
    if (soundTimeoutRef.current) {
      clearTimeout(soundTimeoutRef.current);
      soundTimeoutRef.current = null;
    }

    if (playingSoundId === soundId) {
      stopPreviewSound();
      setPlayingSoundId(null);
    } else {
      unlockAudio();
      stopPreviewSound();
      setPlayingSoundId(soundId);
      const currentVol = settings?.alarmVolume !== undefined ? settings.alarmVolume : 0.85;
      playPhoneAlarmSound(soundId, currentVol);
      soundTimeoutRef.current = window.setTimeout(() => {
        setPlayingSoundId(null);
      }, 2200);
    }
  };

  const handleSelectSound = (soundId: PhoneAlarmSound) => {
    const updatedSettings = { ...settings, alarmSound: soundId };
    onUpdateSettings({ alarmSound: soundId });
    syncNotificationSoundAndVolume(soundId, settings.alarmVolume).catch(() => {});
    syncAllRemindersWithLocalNotifications(reminders, updatedSettings).catch(() => {});
  };

  const themes: { id: AppTheme; name: string; subtitle?: string; preview: string }[] = [
    { id: 'system', name: isFa ? 'خودکار (پیروی از گوشی)' : 'System (Auto)', preview: 'bg-gradient-to-tr from-[#181C20] via-[#14B8A6] to-[#F3F5F7] border-[#14B8A6]' },
    { id: 'dark-gold', name: isFa ? 'مشکی نیلی' : 'Obsidian Indigo', preview: 'bg-[#07070D] border-[#6366F1]' },
    { id: 'dark-slate', name: isFa ? 'آبی تیره' : 'Deep Ocean Blue', preview: 'bg-[#0B192E] border-[#0EA5E9]' },
    { id: 'light-clean', name: isFa ? 'روشن مدرن' : 'Light Clean', preview: 'bg-stone-100 border-stone-400' },
    { id: 'sketch-contrast', name: isFa ? 'رز صورتی و یاسی' : 'Velvet Rose & Lilac', preview: 'bg-gradient-to-tr from-[#1D1322] via-[#831843] to-[#F472B6] border-[#EC4899]' },
    { id: 'jade_warm_light', name: isFa ? 'سبز یشمی و سفید گرم' : 'Jade Green & Warm White', preview: 'bg-[#168779] border-[#DDE1DA]' },
    { id: 'midnight_blue_silver', name: isFa ? 'آبی نیمه‌شب و نقره‌ای' : 'Midnight Blue & Silver', preview: 'bg-[#101722] border-[#9CBCE0]' },
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
          className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/75"
          style={{ willChange: 'opacity' }}
        >
          <motion.div
            id="settings-modal-panel"
            initial={{ opacity: 0, y: 16, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.985 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            style={{ willChange: 'transform, opacity' }}
            className="w-full max-w-xl bg-stone-900 border border-stone-800 rounded-3xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
          >
        {/* Header */}
        <div className="px-2.5 sm:px-5 py-3.5 border-b border-stone-800 flex items-center justify-between bg-stone-900/90">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl overflow-hidden border border-[#FF8C00]/35 flex-shrink-0 bg-stone-950 shadow-sm">
              <img
                src={`${appIcon}${appIcon.includes('?') ? '&' : '?'}v=ff8c00`}
                alt="YAAD"
                className="w-full h-full object-contain rounded-[10px]"
                draggable={false}
              />
            </div>
            <h3 className="font-black text-base sm:text-lg text-white">
              {settings.language === 'en' ? 'YAAD Settings' : 'تنظیمات YAAD'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-stone-400 hover:text-white hover:bg-stone-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Settings Body */}
        <div className="flex-1 overflow-y-auto px-2.5 py-4 sm:p-5 space-y-3.5">

          {/* ========================================================= */}
          {/* YAAD PRO STATUS & PAYWALL CARD */}
          {/* ========================================================= */}
          {proEntitlement && onOpenProPaywall && (
            <div className="p-3 sm:p-3.5 rounded-2xl border border-amber-500/35 bg-gradient-to-br from-amber-500/10 via-stone-900/90 to-indigo-500/10 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-400/40 text-amber-300 flex items-center justify-center shrink-0">
                    <Crown className="w-4.5 h-4.5" />
                  </div>
                  <div className="min-w-0">
                    <span className="text-xs sm:text-sm font-black text-white block truncate">
                      {!proEntitlement.entitlementReady
                        ? isFa
                          ? 'نسخه یاد (در حال بررسی...)'
                          : 'YAAD Status (Checking...)'
                        : proEntitlement.hasPaidPro
                        ? isFa
                          ? 'نسخه حرفه‌ای یاد (فعال)'
                          : 'YAAD Pro (Active)'
                        : proEntitlement.trial.isTrialActive
                        ? isFa
                          ? `هدیه ۴۰ روزه Pro (${toPersianDigits(proEntitlement.trial.remainingDays)} روز مانده)`
                          : `40-Day Pro Trial (${proEntitlement.trial.remainingDays}d left)`
                        : isFa
                        ? 'نسخه رایگان یاد'
                        : 'YAAD Free Tier'}
                    </span>
                    <span className="text-[11px] text-stone-400 block truncate">
                      {!proEntitlement.entitlementReady
                        ? isFa
                          ? 'در حال بررسی وضعیت اشتراک...'
                          : 'Checking subscription status...'
                        : proEntitlement.hasPaidPro
                        ? proEntitlement.reason === 'paid_lifetime'
                          ? isFa
                            ? 'اشتراک دائمی بدون محدودیت زمانی'
                            : 'Lifetime access unlocked'
                          : isFa
                          ? `${toPersianDigits(proEntitlement.paidRemainingDays ?? 0)} روز از اشتراک ۱ ساله باقی مانده`
                          : `${proEntitlement.paidRemainingDays ?? 0} days left in 1-Year plan`
                        : proEntitlement.trial.isTrialActive
                        ? isFa
                          ? 'همه امکانات پیشرفته برای شما باز است'
                          : 'All Pro features are currently unlocked'
                        : isFa
                        ? 'یادآور، زنگ تمام‌صفحه و بک‌آپ JSON رایگان • ارتقا به Pro'
                        : 'Reminders, full-screen alarms & JSON backup free • Upgrade to Pro'}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenProPaywall()}
                  className="min-h-[40px] px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 font-black text-xs shrink-0 transition-all active:scale-95 cursor-pointer"
                >
                  {proEntitlement.hasPaidPro
                    ? isFa
                      ? 'مشاهده وضعیت'
                      : 'View Status'
                    : isFa
                    ? 'ارتقا به Pro'
                    : 'Upgrade'}
                </button>
              </div>

              {proEntitlement.trial.clockTampered && !proEntitlement.hasPaidPro && (
                <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/35 text-[11px] text-rose-200 leading-relaxed font-bold">
                  {isFa
                    ? '⚠️ ساعت دستگاه با زمان واقعی همخوان نیست (وضعیت: دست‌کاری یا عدم تطابق ساعت). لطفاً تاریخ و ساعت گوشی را روی حالت خودکار تنظیم کنید.'
                    : '⚠️ Device clock does not match real time (Status: Clock Tampered). Please set your phone date & time to automatic.'}
                </div>
              )}

              {/* دکمه هدیه نسخه Pro به یک دوست — فقط برای کاربران دارای اشتراک تاییدشده Pro */}
              {proEntitlement.hasPaidPro && verifiedGiftSku && (
                <div className="pt-2 border-t border-amber-500/20 space-y-2">
                  <button
                    type="button"
                    onClick={handleShareProGift}
                    className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500/20 via-amber-500/20 to-indigo-500/20 hover:from-emerald-500/30 hover:via-amber-500/30 hover:to-indigo-500/30 border border-amber-400/45 text-amber-200 font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-sm transition-all active:scale-95 cursor-pointer"
                  >
                    <span className="text-base leading-none" aria-hidden="true">🎁</span>
                    <Gift className="w-4 h-4 text-amber-300 shrink-0" />
                    <span>هدیه نسخه Pro به یک دوست</span>
                  </button>

                  {giftToastMessage && (
                    <div
                      role="status"
                      className="px-3 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-200 text-xs font-bold text-center animate-in fade-in"
                    >
                      {giftToastMessage}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ========================================================= */}
          {/* TOP LANGUAGE SWITCHER (کلید کشویی مینیمال در صدر صفحه تنظیمات) */}
          {/* ========================================================= */}
          <div className="p-2.5 sm:p-3 rounded-2xl border border-stone-800/80 bg-stone-900/90 flex items-center justify-between gap-3 shadow-xs">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
                <Globe className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <span className="text-xs sm:text-sm font-black text-white block truncate">
                  {isFa ? 'زبان برنامه' : 'Language'}
                </span>
                <span className="text-[10px] sm:text-[11px] text-stone-400 block truncate">
                  {isFa ? 'فارسی / English' : 'Persian / English'}
                </span>
              </div>
            </div>

            {/* کلید کشویی مینیمال (Minimal Sliding Toggle Switch) */}
            <div
              onClick={() => {
                const nextLang = isFa ? 'en' : 'fa';
                try {
                  localStorage.setItem('yaad_user_explicit_lang_choice', 'true');
                } catch {}
                onUpdateSettings({ language: nextLang });
              }}
              className="relative inline-flex items-center p-1 rounded-xl bg-stone-950 border border-stone-800 cursor-pointer select-none shrink-0"
              role="switch"
              aria-checked={!isFa}
            >
              {/* Sliding thumb indicator */}
              <div
                className={`absolute top-1 bottom-1 w-[calc(50%-4px)] rounded-lg bg-indigo-600 shadow-sm transition-all duration-200 ease-out pointer-events-none ${
                  isFa ? 'start-1' : 'start-[calc(50%+2px)]'
                }`}
              />

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  try {
                    localStorage.setItem('yaad_user_explicit_lang_choice', 'true');
                  } catch {}
                  onUpdateSettings({ language: 'fa' });
                }}
                className={`relative z-10 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors duration-150 cursor-pointer ${
                  isFa ? 'text-white font-black' : 'text-stone-400 hover:text-stone-200'
                }`}
              >
                فارسی
              </button>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  try {
                    localStorage.setItem('yaad_user_explicit_lang_choice', 'true');
                  } catch {}
                  onUpdateSettings({ language: 'en' });
                }}
                className={`relative z-10 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors duration-150 cursor-pointer ${
                  !isFa ? 'text-white font-black' : 'text-stone-400 hover:text-stone-200'
                }`}
              >
                English
              </button>
            </div>
          </div>
          
          {/* ========================================================= */}
          {/* 1. APPEARANCE & THEMES (ظاهر و پوسته‌ها) */}
          {/* ========================================================= */}
          <div className="rounded-2xl border border-stone-800 bg-stone-950/60 overflow-hidden transition-all shadow-sm">
            <button
              type="button"
              onClick={(e) => toggleSection('appearance', e.currentTarget)}
              className="w-full min-h-[48px] p-3.5 sm:p-4 bg-stone-900/60 hover:bg-stone-900 border-b border-stone-800/80 flex items-center justify-between gap-3 transition-colors cursor-pointer text-start"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
                  <Palette className="w-4.5 h-4.5" />
                </div>
                <div className="min-w-0">
                  <h4 className="text-xs sm:text-sm font-black text-white truncate">
                    {isFa ? '۱. ظاهر و تم برنامه' : '1. Appearance & Theme'}
                  </h4>
                  <p className="text-[11px] text-stone-400 truncate">
                    {isFa
                      ? `پوسته: ${themes.find((th) => th.id === settings.theme)?.name || 'پیش‌فرض'} • اندازه فونت`
                      : `Theme: ${settings.theme} • Font Size`}
                  </p>
                </div>
              </div>
              <ChevronDown className={`w-4 h-4 text-stone-400 transition-transform duration-200 shrink-0 ${openSections.appearance ? 'rotate-180 text-indigo-400' : ''}`} />
            </button>

            {openSections.appearance && (
              <div className="p-3 sm:p-4 space-y-4 animate-in fade-in">
                {/* Theme Selection Chips (Small & Minimal) */}
                <div className="space-y-3">
                  <span className="text-xs font-bold text-stone-300 block">
                    {isFa ? 'انتخاب قالب ظاهری:' : 'Select Theme:'}
                  </span>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
                    {themes.map((themeItem) => {
                      const isSelected = settings.theme === themeItem.id;
                      const isThemeLocked = !hasProAccess && themeItem.id !== 'midnight_blue_silver';
                      return (
                        <button
                          key={themeItem.id}
                          type="button"
                          onClick={() => {
                            if (isThemeLocked) {
                              onOpenProPaywall?.('themes');
                              return;
                            }
                            onUpdateSettings({ theme: themeItem.id });
                          }}
                          className={`h-8 px-2 rounded-xl border text-center transition-all duration-150 flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 ${
                            isSelected
                              ? 'border-indigo-400 bg-indigo-500/20 text-indigo-300 font-bold shadow-xs ring-1 ring-indigo-400/40'
                              : 'border-stone-800 bg-stone-950/70 text-stone-300 hover:border-stone-700 hover:bg-stone-900'
                          }`}
                        >
                          <span className={`w-2.5 h-2.5 rounded-full border shrink-0 ${themeItem.preview}`} />
                          <span className="text-[11px] font-medium truncate">{themeItem.name}</span>
                          <ProBadge locked={isThemeLocked} />
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 1.2 Font Size Slider */}
                <div className="space-y-2 pt-2 border-t border-stone-800/80">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-bold text-stone-300">
                      <Type className="w-3.5 h-3.5 text-indigo-400" />
                      <span>{isFa ? 'اندازه قلم' : 'Font Size'}</span>
                    </div>
                    <span className="font-mono text-xs text-indigo-300 font-black bg-stone-900 px-2 py-0.5 rounded-lg border border-indigo-500/30">
                      {isFa ? toPersianDigits(
                        typeof settings.fontSize === 'number'
                          ? settings.fontSize
                          : settings.fontSize === 'small'
                          ? 14
                          : settings.fontSize === 'large'
                          ? 18
                          : settings.fontSize === 'xlarge'
                          ? 21
                          : 16
                      ) : (
                        typeof settings.fontSize === 'number'
                          ? settings.fontSize
                          : settings.fontSize === 'small'
                          ? 14
                          : settings.fontSize === 'large'
                          ? 18
                          : settings.fontSize === 'xlarge'
                          ? 21
                          : 16
                      )}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-stone-400">{isFa ? 'الف' : 'A'}</span>
                    <input
                      type="range"
                      min="13"
                      max="23"
                      step="1"
                      value={
                        typeof settings.fontSize === 'number'
                          ? settings.fontSize
                          : settings.fontSize === 'small'
                          ? 14
                          : settings.fontSize === 'large'
                          ? 18
                          : settings.fontSize === 'xlarge'
                          ? 21
                          : 16
                      }
                      onChange={(e) => {
                        try {
                          localStorage.setItem('yaad_user_explicit_fontsize_choice', 'true');
                        } catch {}
                        onUpdateSettings({ fontSize: parseInt(e.target.value, 10) });
                      }}
                      className="w-full accent-teal-500 h-2 bg-stone-800 rounded-lg cursor-pointer"
                    />
                    <span className="text-base font-black text-white">{isFa ? 'الف' : 'A'}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ========================================================= */}
          {/* 2. SOUND & ALERTS (صدا و هشدارها) */}
          {/* ========================================================= */}
          <div className="rounded-2xl border border-stone-800 bg-stone-950/60 overflow-hidden transition-all shadow-sm">
            <button
              type="button"
              onClick={(e) => toggleSection('sound', e.currentTarget)}
              className="w-full min-h-[48px] p-3.5 sm:p-4 bg-stone-900/60 hover:bg-stone-900 border-b border-stone-800/80 flex items-center justify-between gap-3 transition-colors cursor-pointer text-start"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
                  <Volume2 className="w-4.5 h-4.5" />
                </div>
                <div className="min-w-0">
                  <h4 className="text-xs sm:text-sm font-black text-white truncate">
                    {isFa ? '۲. صدا و هشدارها' : '2. Sound & Alerts'}
                  </h4>
                  <p className="text-[11px] text-stone-400 truncate">
                    {isFa
                      ? 'ملودی آلارم • لرزش و ویبره (تنظیم بلندی صدا با ولوم اعلان گوشی)'
                      : 'Alarm Melody • Vibration (Controlled by phone notification volume)'}
                  </p>
                </div>
              </div>
              <ChevronDown className={`w-4 h-4 text-stone-400 transition-transform duration-200 shrink-0 ${openSections.sound ? 'rotate-180 text-indigo-400' : ''}`} />
            </button>

            {openSections.sound && (
              <div className="p-3 sm:p-4 space-y-4 animate-in fade-in">
                {/* 2.1.5 Vibration On/Off Sliding Toggle (کلید کشویی ویبره در بخش صدا و هشدارها) */}
                <div className="p-3.5 rounded-2xl bg-stone-950/60 border border-stone-800/80 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`p-2 rounded-xl border shrink-0 ${
                        settings.vibrationEnabled !== false
                          ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                          : 'bg-stone-900 border-stone-800 text-stone-500'
                      }`}
                    >
                      <Smartphone className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <span className="text-xs font-bold text-stone-200 block">
                        {isFa ? 'لرزش و ویبره هنگام هشدار (ویبره آلارم)' : 'Alarm Vibration'}
                      </span>
                      <span className="text-[11px] text-stone-400 block mt-0.5">
                        {settings.vibrationEnabled !== false
                          ? isFa
                            ? 'ویبره همزمان با زنگ هشدار و اعلان اختصاصی فعال است'
                            : 'Vibration is active during alarms and notifications'
                          : isFa
                          ? 'ویبره غیرفعال است (فقط پخش صدا)'
                          : 'Vibration is off (sound only)'}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.vibrationEnabled !== false}
                    onClick={() => {
                      const nextVal = settings.vibrationEnabled === false;
                      setGlobalVibration(nextVal);
                      onUpdateSettings({ vibrationEnabled: nextVal });
                      syncNotificationSoundAndVolume(
                        settings.alarmSound,
                        settings.alarmVolume,
                        nextVal
                      ).catch(() => {});
                      if (nextVal && typeof navigator !== 'undefined' && navigator.vibrate) {
                        try {
                          navigator.vibrate([120, 60, 120]);
                        } catch {}
                      }
                    }}
                    className={`inline-flex items-center gap-2 px-2.5 py-1.5 rounded-xl border transition-all cursor-pointer shrink-0 ${
                      settings.vibrationEnabled !== false
                        ? 'bg-emerald-500/20 border-emerald-400/80 text-white'
                        : 'bg-stone-950 border-stone-700 text-stone-300'
                    }`}
                  >
                    <span className="text-[11px] font-bold text-white">
                      {settings.vibrationEnabled !== false
                        ? isFa ? 'روشن' : 'ON'
                        : isFa ? 'خاموش' : 'OFF'}
                    </span>
                    <div
                      className={`relative w-11 h-6 rounded-full transition-colors border ${
                        settings.vibrationEnabled !== false
                          ? 'bg-emerald-500 border-emerald-300'
                          : 'bg-stone-700 border-stone-500'
                      }`}
                    >
                      <span
                        className={`absolute top-[2px] w-4.5 h-4.5 rounded-full bg-white shadow-md transition-all ${
                          settings.vibrationEnabled !== false ? 'start-[22px]' : 'start-[2px]'
                        }`}
                      />
                    </div>
                  </button>
                </div>

                {/* 2.2 Alarm Sound Selection */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-stone-200">
                      {isFa ? 'انتخاب ملودی و صدای زنگ:' : 'Select Alarm Tone:'}
                    </span>
                    <span className="text-[11px] text-stone-400">
                      {isFa ? 'برای شنیدن دکمه پخش را بزنید' : 'Play to test tone'}
                    </span>
                  </div>

                  <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                    {PHONE_ALARM_SOUNDS.map((soundItem) => {
                      const isSelected = (settings.alarmSound || 'digital_beep') === soundItem.id;
                      const isPlaying = playingSoundId === soundItem.id;

                      return (
                        <div
                          key={soundItem.id}
                          onClick={() => handleSelectSound(soundItem.id)}
                          className={`p-2.5 rounded-xl border transition-all flex items-center justify-between gap-3 cursor-pointer ${
                            isSelected
                              ? 'border-indigo-500 bg-indigo-500/10 ring-1 ring-indigo-500/40 shadow-sm'
                              : 'border-stone-800/90 bg-stone-950/60 hover:border-stone-700 hover:bg-stone-900/50'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${
                              isSelected ? 'border-indigo-500 bg-indigo-500' : 'border-stone-600 bg-transparent'
                            }`}>
                              {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                            </div>

                            <div className="min-w-0">
                              <p className={`text-xs font-bold truncate ${isSelected ? 'text-indigo-300' : 'text-stone-200'}`}>
                                {isFa ? soundItem.label : soundItem.labelEn}
                              </p>
                              <p className="text-[10px] text-stone-400 truncate">
                                {isFa ? soundItem.desc : soundItem.descEn}
                              </p>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSelectSound(soundItem.id);
                              handlePreviewSound(soundItem.id);
                            }}
                            className={`min-h-[40px] flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer active:scale-95 shrink-0 ${
                              isPlaying
                                ? 'bg-indigo-500 text-white font-black animate-pulse'
                                : isSelected
                                ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40'
                                : 'bg-stone-900 text-stone-300 border border-stone-700/80 hover:bg-stone-800'
                            }`}
                          >
                            {isPlaying ? (
                              <>
                                <Square className="w-3 h-3 fill-current" />
                                <span>{isFa ? 'توقف' : 'Stop'}</span>
                              </>
                            ) : (
                              <>
                                <Play className="w-3 h-3 fill-current text-indigo-400" />
                                <span>{isFa ? 'پخش' : 'Play'}</span>
                              </>
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 2.4 Battery Optimization Guide Card (Native Android — opens OS settings directly, no extra permission) */}
                {isNativeAndroidApp() && (
                  <div className="p-3.5 rounded-2xl bg-stone-900/75 border border-amber-500/35 space-y-2.5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <div className="p-2 rounded-xl bg-amber-500/15 border border-amber-500/35 text-amber-400 shrink-0">
                          <BatteryCharging className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <span className="text-xs font-bold text-stone-100 block">
                            {isFa ? 'راهنمای بهینه‌سازی باتری برای زنگ بموقع' : 'Battery Optimization Guide'}
                          </span>
                          <span className="text-[11px] text-stone-400 block mt-0.5 leading-relaxed">
                            {isFa
                              ? 'برای جلوگیری از بسته‌شدن خودکار آلارم‌ها در پس‌زمینه، «یاد» را در حالت بدون محدودیت (Unrestricted) قرار دهید.'
                              : 'Set YAAD to Unrestricted battery usage in Android settings so background alarms fire reliably.'}
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => openAndroidSettings('battery')}
                        className="min-h-[44px] px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-black text-xs shadow-sm active:scale-95 transition-all cursor-pointer shrink-0 flex items-center justify-center gap-1.5"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>{isFa ? 'تنظیمات باتری' : 'Battery Settings'}</span>
                      </button>
                    </div>

                    <div className="p-2.5 rounded-xl bg-stone-950/75 border border-stone-800/80 text-[10.5px] text-stone-300 space-y-1.5 leading-relaxed">
                      <p>
                        <strong className="text-amber-300">{isFa ? 'شیائومی (MIUI / HyperOS):' : 'Xiaomi:'}</strong>{' '}
                        {isFa
                          ? 'اطلاعات برنامه (App Info) ← Autostart (شروع خودکار) را روشن و Battery saver را روی No restrictions بگذارید.'
                          : 'App Info → Enable Autostart and set Battery saver to "No restrictions".'}
                      </p>
                      <p>
                        <strong className="text-sky-300">{isFa ? 'سامسونگ (One UI):' : 'Samsung:'}</strong>{' '}
                        {isFa
                          ? 'اطلاعات برنامه ← باتری (Battery) ← گزینه Unrestricted (بدون محدودیت) را انتخاب کنید و در Sleeping apps نگذارید.'
                          : 'App Info → Battery → Choose "Unrestricted" and exclude from Sleeping apps.'}
                      </p>
                      <p>
                        <strong className="text-emerald-300">{isFa ? 'هوآوی (EMUI):' : 'Huawei:'}</strong>{' '}
                        {isFa
                          ? 'تنظیمات ← باتری ← راه‌اندازی برنامه (App launch) ← «یاد» را روی مدیریت دستی (Manage manually) با ۳ تیک فعال بگذارید.'
                          : 'Settings → Battery → App launch → Set YAAD to "Manage manually" with all 3 toggles ON.'}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ========================================================= */}
          {/* 3. PERMISSIONS HUB (دسترسی‌ها - ردیف فشرده) */}
          {/* ========================================================= */}
          <div className="rounded-2xl border border-stone-800 bg-stone-950/60 overflow-hidden transition-all shadow-sm">
            <button
              type="button"
              onClick={(e) => toggleSection('permissions', e.currentTarget)}
              className="w-full min-h-[48px] p-3.5 sm:p-4 bg-stone-900/60 hover:bg-stone-900 border-b border-stone-800/80 flex items-center justify-between gap-3 transition-colors cursor-pointer text-start"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400 shrink-0">
                  <ShieldCheck className="w-4.5 h-4.5" />
                </div>
                <div className="min-w-0">
                  <h4 className="text-xs sm:text-sm font-black text-white truncate">
                    {isFa ? '۳. مدیریت دسترسی‌ها' : '3. App Permissions'}
                  </h4>
                  <p className="text-[11px] text-stone-400 truncate">
                    {(() => {
                      const hasNative = isNativeAndroidApp();
                      const totalCount = hasNative ? 6 : 4;
                      const grantedCount = [
                        nativePerms.notifications,
                        nativePerms.microphone,
                        nativePerms.camera,
                        nativePerms.location,
                        ...(hasNative
                          ? [Boolean(nativePerms.exactAlarm), Boolean(nativePerms.fullScreenIntent)]
                          : []),
                      ].filter(Boolean).length;
                      return isFa
                        ? `${toPersianDigits(grantedCount)} از ${toPersianDigits(totalCount)} دسترسی تایید شده است`
                        : `${grantedCount} of ${totalCount} permissions granted`;
                    })()}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <ChevronDown className={`w-4 h-4 text-stone-400 transition-transform duration-200 ${openSections.permissions ? 'rotate-180 text-sky-400' : ''}`} />
              </div>
            </button>

            {openSections.permissions && (
              <div className="p-3 sm:p-4 space-y-3 animate-in fade-in">
                {/* 3.1 وضعیت دسترسی‌ها توی یه ردیف فشرده (COMPACT PERMISSIONS ROW - قابل روشن و خاموش کردن) */}
                <div className={`grid gap-1.5 sm:gap-2 ${isNativeAndroidApp() ? 'grid-cols-3 sm:grid-cols-6' : 'grid-cols-4'}`}>
                  {/* 1. Notifications */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={nativePerms.notifications}
                    onClick={() => handleRequestPerm('notifications')}
                    style={
                      nativePerms.notifications
                        ? {
                            background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
                            borderColor: '#6ee7b7',
                            color: '#ffffff',
                          }
                        : undefined
                    }
                    className={`min-h-[70px] p-2 rounded-xl border flex flex-col items-center justify-center text-center transition-all cursor-pointer active:scale-95 ${
                      nativePerms.notifications
                        ? 'perm-card-granted shadow-md shadow-emerald-900/40'
                        : 'bg-stone-900/80 border-stone-800 text-stone-400 hover:border-indigo-500/50'
                    }`}
                    title={isFa ? 'روشن/خاموش کردن دسترسی اعلان‌ها' : 'Toggle Notifications permission'}
                  >
                    <Bell className={`w-4 h-4 mb-1 ${nativePerms.notifications ? 'text-white' : 'text-stone-400'}`} />
                    <span className={`text-[10px] sm:text-[11px] font-black truncate w-full block ${nativePerms.notifications ? 'text-white' : 'text-stone-200'}`}>
                      {isFa ? 'اعلان' : 'Alert'}
                    </span>
                    <div className="mt-1 flex items-center gap-1">
                      <div
                        dir="ltr"
                        className={`w-7 h-3.5 rounded-full p-0.5 flex items-center transition-colors ${
                          nativePerms.notifications ? 'bg-white/30 justify-end' : 'bg-stone-800 justify-start border border-stone-700'
                        }`}
                      >
                        <span className={`w-2.5 h-2.5 rounded-full shadow-sm ${nativePerms.notifications ? 'bg-white' : 'bg-stone-400'}`} />
                      </div>
                      <span className={`text-[8.5px] font-black ${nativePerms.notifications ? 'text-white' : 'text-stone-400'}`}>
                        {nativePerms.notifications ? (isFa ? 'روشن' : 'ON') : (isFa ? 'خاموش' : 'OFF')}
                      </span>
                    </div>
                  </button>

                  {/* 2. Microphone */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={nativePerms.microphone}
                    onClick={() => handleRequestPerm('microphone')}
                    style={
                      nativePerms.microphone
                        ? {
                            background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
                            borderColor: '#6ee7b7',
                            color: '#ffffff',
                          }
                        : undefined
                    }
                    className={`min-h-[70px] p-2 rounded-xl border flex flex-col items-center justify-center text-center transition-all cursor-pointer active:scale-95 ${
                      nativePerms.microphone
                        ? 'perm-card-granted shadow-md shadow-emerald-900/40'
                        : 'bg-stone-900/80 border-stone-800 text-stone-400 hover:border-indigo-500/50'
                    }`}
                    title={isFa ? 'روشن/خاموش کردن دسترسی میکروفون' : 'Toggle Microphone permission'}
                  >
                    <Mic className={`w-4 h-4 mb-1 ${nativePerms.microphone ? 'text-white' : 'text-stone-400'}`} />
                    <span className={`text-[10px] sm:text-[11px] font-black truncate w-full block ${nativePerms.microphone ? 'text-white' : 'text-stone-200'}`}>
                      {isFa ? 'میکروفون' : 'Mic'}
                    </span>
                    <div className="mt-1 flex items-center gap-1">
                      <div
                        dir="ltr"
                        className={`w-7 h-3.5 rounded-full p-0.5 flex items-center transition-colors ${
                          nativePerms.microphone ? 'bg-white/30 justify-end' : 'bg-stone-800 justify-start border border-stone-700'
                        }`}
                      >
                        <span className={`w-2.5 h-2.5 rounded-full shadow-sm ${nativePerms.microphone ? 'bg-white' : 'bg-stone-400'}`} />
                      </div>
                      <span className={`text-[8.5px] font-black ${nativePerms.microphone ? 'text-white' : 'text-stone-400'}`}>
                        {nativePerms.microphone ? (isFa ? 'روشن' : 'ON') : (isFa ? 'خاموش' : 'OFF')}
                      </span>
                    </div>
                  </button>

                  {/* 3. Camera */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={nativePerms.camera}
                    onClick={() => handleRequestPerm('camera')}
                    style={
                      nativePerms.camera
                        ? {
                            background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
                            borderColor: '#6ee7b7',
                            color: '#ffffff',
                          }
                        : undefined
                    }
                    className={`min-h-[70px] p-2 rounded-xl border flex flex-col items-center justify-center text-center transition-all cursor-pointer active:scale-95 ${
                      nativePerms.camera
                        ? 'perm-card-granted shadow-md shadow-emerald-900/40'
                        : 'bg-stone-900/80 border-stone-800 text-stone-400 hover:border-indigo-500/50'
                    }`}
                    title={isFa ? 'روشن/خاموش کردن دسترسی دوربین' : 'Toggle Camera permission'}
                  >
                    <Camera className={`w-4 h-4 mb-1 ${nativePerms.camera ? 'text-white' : 'text-stone-400'}`} />
                    <span className={`text-[10px] sm:text-[11px] font-black truncate w-full block ${nativePerms.camera ? 'text-white' : 'text-stone-200'}`}>
                      {isFa ? 'دوربین' : 'Camera'}
                    </span>
                    <div className="mt-1 flex items-center gap-1">
                      <div
                        dir="ltr"
                        className={`w-7 h-3.5 rounded-full p-0.5 flex items-center transition-colors ${
                          nativePerms.camera ? 'bg-white/30 justify-end' : 'bg-stone-800 justify-start border border-stone-700'
                        }`}
                      >
                        <span className={`w-2.5 h-2.5 rounded-full shadow-sm ${nativePerms.camera ? 'bg-white' : 'bg-stone-400'}`} />
                      </div>
                      <span className={`text-[8.5px] font-black ${nativePerms.camera ? 'text-white' : 'text-stone-400'}`}>
                        {nativePerms.camera ? (isFa ? 'روشن' : 'ON') : (isFa ? 'خاموش' : 'OFF')}
                      </span>
                    </div>
                  </button>

                  {/* 4. GPS / Location */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={nativePerms.location}
                    onClick={() => handleRequestPerm('location')}
                    style={
                      nativePerms.location && nativePerms.backgroundLocation !== false
                        ? {
                            background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
                            borderColor: '#6ee7b7',
                            color: '#ffffff',
                          }
                        : nativePerms.location && nativePerms.backgroundLocation === false
                        ? {
                            background: 'linear-gradient(135deg, #b45309 0%, #d97706 100%)',
                            borderColor: '#fcd34d',
                            color: '#ffffff',
                          }
                        : undefined
                    }
                    className={`min-h-[70px] p-2 rounded-xl border flex flex-col items-center justify-center text-center transition-all cursor-pointer active:scale-95 ${
                      nativePerms.location && nativePerms.backgroundLocation !== false
                        ? 'perm-card-granted shadow-md shadow-emerald-900/40'
                        : nativePerms.location && nativePerms.backgroundLocation === false
                        ? 'shadow-md shadow-amber-950/40'
                        : 'bg-stone-900/80 border-stone-800 text-stone-400 hover:border-indigo-500/50'
                    }`}
                    title={isFa ? 'روشن/خاموش کردن دسترسی موقعیت مکانی' : 'Toggle GPS Location permission'}
                  >
                    <MapPin className={`w-4 h-4 mb-1 ${nativePerms.location ? 'text-white' : 'text-stone-400'}`} />
                    <span className={`text-[10px] sm:text-[11px] font-black truncate w-full block ${nativePerms.location ? 'text-white' : 'text-stone-200'}`}>
                      {isFa ? 'موقعیت' : 'GPS'}
                    </span>
                    <div className="mt-1 flex items-center gap-1">
                      <div
                        dir="ltr"
                        className={`w-7 h-3.5 rounded-full p-0.5 flex items-center transition-colors ${
                          nativePerms.location ? 'bg-white/30 justify-end' : 'bg-stone-800 justify-start border border-stone-700'
                        }`}
                      >
                        <span className={`w-2.5 h-2.5 rounded-full shadow-sm ${nativePerms.location ? 'bg-white' : 'bg-stone-400'}`} />
                      </div>
                      <span className={`text-[8.5px] font-black leading-tight ${nativePerms.location ? 'text-white' : 'text-stone-400'}`}>
                        {nativePerms.location
                          ? nativePerms.backgroundLocation === false
                            ? (isFa ? 'استفاده' : 'InUse')
                            : (isFa ? 'روشن' : 'ON')
                          : (isFa ? 'خاموش' : 'OFF')}
                      </span>
                    </div>
                  </button>


                  {/* 5B. Exact Alarms (Android 12+) — Native Android */}
                  {isNativeAndroidApp() && (
                    <button
                      type="button"
                      role="switch"
                      aria-checked={Boolean(nativePerms.exactAlarm)}
                      onClick={() => handleRequestPerm('exact_alarm')}
                      style={
                        nativePerms.exactAlarm
                          ? {
                              background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
                              borderColor: '#6ee7b7',
                              color: '#ffffff',
                            }
                          : undefined
                      }
                      className={`min-h-[70px] p-2 rounded-xl border flex flex-col items-center justify-center text-center transition-all cursor-pointer active:scale-95 ${
                        nativePerms.exactAlarm
                          ? 'perm-card-granted shadow-md shadow-emerald-900/40'
                          : 'bg-stone-900/80 border-stone-800 text-stone-400 hover:border-indigo-500/50'
                      }`}
                      title={isFa ? 'تغییر وضعیت آلارم دقیق در تنظیمات اندروید' : 'Toggle Exact Alarms in Android Settings'}
                    >
                      <Clock className={`w-4 h-4 mb-1 ${nativePerms.exactAlarm ? 'text-white' : 'text-stone-400'}`} />
                      <span className={`text-[10px] sm:text-[11px] font-black truncate w-full block ${nativePerms.exactAlarm ? 'text-white' : 'text-stone-200'}`}>
                        {isFa ? 'آلارم دقیق' : 'Exact Alarm'}
                      </span>
                      <div className="mt-1 flex items-center gap-1">
                        <div
                          dir="ltr"
                          className={`w-7 h-3.5 rounded-full p-0.5 flex items-center transition-colors ${
                            nativePerms.exactAlarm ? 'bg-white/30 justify-end' : 'bg-stone-800 justify-start border border-stone-700'
                          }`}
                        >
                          <span className={`w-2.5 h-2.5 rounded-full shadow-sm ${nativePerms.exactAlarm ? 'bg-white' : 'bg-stone-400'}`} />
                        </div>
                        <span className={`text-[8.5px] font-black ${nativePerms.exactAlarm ? 'text-white' : 'text-amber-300'}`}>
                          {nativePerms.exactAlarm ? (isFa ? 'روشن' : 'ON') : (isFa ? 'خاموش' : 'OFF')}
                        </span>
                      </div>
                    </button>
                  )}

                  {/* 6. Full-Screen Intent (Android 14+) — Native Android */}
                  {isNativeAndroidApp() && (
                    <button
                      type="button"
                      role="switch"
                      aria-checked={Boolean(nativePerms.fullScreenIntent)}
                      onClick={() => handleRequestPerm('full_screen_intent')}
                      style={
                        nativePerms.fullScreenIntent
                          ? {
                              background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
                              borderColor: '#6ee7b7',
                              color: '#ffffff',
                            }
                          : undefined
                      }
                      className={`min-h-[70px] p-2 rounded-xl border flex flex-col items-center justify-center text-center transition-all cursor-pointer active:scale-95 ${
                        nativePerms.fullScreenIntent
                          ? 'perm-card-granted shadow-md shadow-emerald-900/40'
                          : 'bg-stone-900/80 border-stone-800 text-stone-400 hover:border-indigo-500/50'
                      }`}
                      title={isFa ? 'تغییر وضعیت اعلان تمام‌صفحه در تنظیمات اندروید' : 'Toggle Full-Screen Intent in Android Settings'}
                    >
                      <Maximize2 className={`w-4 h-4 mb-1 ${nativePerms.fullScreenIntent ? 'text-white' : 'text-stone-400'}`} />
                      <span className={`text-[10px] sm:text-[11px] font-black truncate w-full block ${nativePerms.fullScreenIntent ? 'text-white' : 'text-stone-200'}`}>
                        {isFa ? 'نمایش قفل' : 'Lock Alert'}
                      </span>
                      <div className="mt-1 flex items-center gap-1">
                        <div
                          dir="ltr"
                          className={`w-7 h-3.5 rounded-full p-0.5 flex items-center transition-colors ${
                            nativePerms.fullScreenIntent ? 'bg-white/30 justify-end' : 'bg-stone-800 justify-start border border-stone-700'
                          }`}
                        >
                          <span className={`w-2.5 h-2.5 rounded-full shadow-sm ${nativePerms.fullScreenIntent ? 'bg-white' : 'bg-stone-400'}`} />
                        </div>
                        <span className={`text-[8.5px] font-black ${nativePerms.fullScreenIntent ? 'text-white' : 'text-amber-300'}`}>
                          {nativePerms.fullScreenIntent ? (isFa ? 'روشن' : 'ON') : (isFa ? 'خاموش' : 'OFF')}
                        </span>
                      </div>
                    </button>
                  )}
                </div>

                {isNativeAndroidApp() && revokedPermNotice && (
                  <div
                    dir={isFa ? 'rtl' : 'ltr'}
                    className="p-2.5 rounded-xl bg-stone-900/90 border border-stone-700 text-[11px] text-stone-200 flex items-center justify-between gap-2 leading-relaxed"
                  >
                    <span>
                      {isFa
                        ? 'دسترسی در برنامه خاموش شد. برای لغو کامل از سطح سیستم‌عامل، تنظیمات اندروید را باز کنید:'
                        : 'Disabled inside the app. To also revoke at the OS level, open Android Settings:'}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => openAndroidSettings(revokedPermNotice === 'notifications' ? 'notifications' : 'app_details')}
                        className="px-2.5 py-1 rounded-lg bg-stone-800 hover:bg-stone-700 text-indigo-300 font-bold text-[10.5px] border border-stone-700 cursor-pointer flex items-center gap-1"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>{isFa ? 'تنظیمات سیستم' : 'OS Settings'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setRevokedPermNotice(null)}
                        className="p-1 rounded-lg hover:bg-stone-800 text-stone-400 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}


                {isNativeAndroidApp() && nativePerms.exactAlarm === false && (
                  <div
                    onClick={() => openAndroidSettings('exact_alarm')}
                    dir={isFa ? 'rtl' : 'ltr'}
                    className="p-3 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-200 text-xs flex items-center justify-between gap-2.5 cursor-pointer leading-relaxed"
                  >
                    <div className="space-y-1">
                      <p className="font-black text-amber-300">
                        {isFa
                          ? 'مجوز «آلارم دقیق» (Alarms & reminders) در اندروید ۱۲+ غیرفعال است'
                          : 'Exact Alarm permission (Android 12+) is disabled'}
                      </p>
                      <p className="text-[11px] text-stone-200">
                        {isFa
                          ? 'برای به صدا درآمدن سر وقت یادآورها، اینجا را لمس کنید و در صفحه تنظیمات اندروید گزینه Allow setting alarms and reminders را روشن کنید.'
                          : 'Tap here to open Android Settings and enable "Allow setting alarms and reminders".'}
                      </p>
                    </div>
                    <ExternalLink className="w-4 h-4 text-amber-300 shrink-0" />
                  </div>
                )}

                {isNativeAndroidApp() && nativePerms.fullScreenIntent === false && (
                  <div
                    onClick={() => openAndroidSettings('full_screen_intent')}
                    dir={isFa ? 'rtl' : 'ltr'}
                    className="p-3 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-200 text-xs flex items-center justify-between gap-2.5 cursor-pointer leading-relaxed"
                  >
                    <div className="space-y-1">
                      <p className="font-black text-amber-300">
                        {isFa
                          ? 'مجوز «اعلان تمام‌صفحه» (Android 14+) غیرفعال است'
                          : 'Full-Screen Intent permission (Android 14+) is disabled'}
                      </p>
                      <p className="text-[11px] text-stone-200">
                        {isFa
                          ? 'برای نمایش صفحه زنگ یادآور روی صفحه قفل گوشی، اینجا را لمس کرده و دسترسی Full-screen notifications را برای «یاد» فعال کنید.'
                          : 'Tap here to enable Full-screen notifications on the lock screen in Android Settings.'}
                      </p>
                    </div>
                    <ExternalLink className="w-4 h-4 text-amber-300 shrink-0" />
                  </div>
                )}

                {isNativeAndroidApp() &&
                  !bgLocationNoticeDismissed &&
                  (showBgLocationNotice || (nativePerms.location && nativePerms.backgroundLocation === false)) &&
                  !(nativePerms.location && nativePerms.backgroundLocation) && (
                    <div
                      onClick={() => openAndroidSettings('background_location')}
                      dir={isFa ? 'rtl' : 'ltr'}
                      className="p-3 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-300 text-xs flex items-start justify-between gap-2.5 cursor-pointer leading-relaxed"
                    >
                      <div className="space-y-1.5">
                        <p className="font-bold text-stone-100">
                          {nativePerms.location
                            ? isFa
                              ? 'مجوز مکان روی «فقط هنگام استفاده» است. برای اعلان فوری حصار مکانی بیرون از برنامه، آن را روی «همیشه مجاز» تنظیم کنید:'
                              : 'Location is currently set to "While using the app". For reliable out-of-app Geofence alerts, set it to "Allow all the time":'
                            : isFa
                              ? 'برای عملکرد دقیق رادار حصار مکانی، مجوز مکان را از مسیر زیر روی «همیشه مجاز» قرار دهید:'
                              : 'For reliable Geofence Radar alerts, please grant Location permission and set it to "Allow all the time":'}
                        </p>
                        <p className="font-black text-amber-300">
                          {isFa
                            ? 'تنظیمات برنامه ← مجوزها (Permissions) ← مکان (Location) ← همیشه مجاز (Allow all the time)'
                            : 'App Info → Permissions → Location → Allow all the time'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowBgLocationNotice(false);
                          setBgLocationNoticeDismissed(true);
                        }}
                        className="p-1 rounded-lg hover:bg-amber-500/20 text-amber-300 shrink-0 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                {/* 3.2 Request All Permissions at Once Button */}
                <button
                  type="button"
                  disabled={isRequestingAllPerms}
                  onClick={handleRequestAllPerms}
                  className="w-full min-h-[48px] py-2.5 px-3 rounded-xl bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white text-xs font-black transition-all shadow-md shadow-sky-950/40 active:scale-95 cursor-pointer flex items-center justify-center gap-2"
                >
                  <ShieldCheck className="w-4 h-4 shrink-0" />
                  <span>
                    {isRequestingAllPerms
                      ? (isFa ? 'در حال ثبت درخواست‌ها...' : 'Requesting...')
                      : (isFa ? 'درخواست یکجای تمامی دسترسی‌های لازم' : 'Grant All Required Permissions')}
                  </span>
                </button>
              </div>
            )}
          </div>

          {/* ========================================================= */}
          {/* 4. SYNC & CLOUD SERVICES (همگام‌سازی) */}
          {/* ========================================================= */}
          <div className="rounded-2xl border border-stone-800 bg-stone-950/60 overflow-hidden transition-all shadow-sm">
            <button
              type="button"
              onClick={(e) => toggleSection('sync', e.currentTarget)}
              className="w-full min-h-[48px] p-3.5 sm:p-4 bg-stone-900/60 hover:bg-stone-900 border-b border-stone-800/80 flex items-center justify-between gap-3 transition-colors cursor-pointer text-start"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400 shrink-0">
                  <Calendar className="w-4.5 h-4.5" />
                </div>
                <div className="min-w-0">
                  <h4 className="text-xs sm:text-sm font-black text-white truncate">
                    {isFa ? '۴. همگام‌سازی و سرویس‌ها' : '4. Sync & Services'}
                  </h4>
                  <p className="text-[11px] text-stone-400 truncate">
                    {isNativeAndroidApp()
                      ? (isFa ? 'نقشه و رادار حصار مکانی (Geofence)' : 'Maps & Geofence Radar')
                      : googleUser
                      ? (isFa ? `گوگل کلندر: ${googleUser.email}` : `Google Calendar: ${googleUser.email}`)
                      : (isFa ? 'اتصال به تقویم گوگل، نقشه و حصار مکانی' : 'Google Calendar, Maps & Geofence')}
                  </p>
                </div>
              </div>
              <ChevronDown className={`w-4 h-4 text-stone-400 transition-transform duration-200 shrink-0 ${openSections.sync ? 'rotate-180 text-sky-400' : ''}`} />
            </button>

            {openSections.sync && (
              <div className="p-3 sm:p-4 space-y-4 animate-in fade-in">
                {/* 4.1 Google Workspace Sync (Web/PWA only — completely hidden & disabled on native Android) */}
                {!isNativeAndroidApp() && (
                <div className="p-3.5 rounded-2xl bg-stone-900/70 border border-stone-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-bold text-stone-200">
                      <Calendar className="w-4 h-4 text-sky-400" />
                      <span>{isFa ? 'همگام‌سازی تقویم گوگل (Google Calendar)' : 'Google Calendar Sync'}</span>
                    </div>
                    {googleUser && (
                      <span
                        style={{ backgroundColor: 'rgba(16, 185, 129, 0.2)', borderColor: '#10b981', color: '#6ee7b7' }}
                        className="text-[10px] px-2.5 py-0.5 rounded-full border font-black"
                      >
                        {isFa ? 'متصل ✓' : 'Connected ✓'}
                      </span>
                    )}
                  </div>

                  <div className="p-3 rounded-xl bg-stone-950 border border-stone-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="truncate">
                      {googleUser ? (
                        <p className="text-xs font-bold text-white truncate">{googleUser.email}</p>
                      ) : (
                        <p className="text-xs text-stone-400">{isFa ? 'اتصال مستقیم به حساب Google Calendar' : 'Connect to Google Calendar account'}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {googleUser ? (
                        <>
                          <button
                            type="button"
                            onClick={() => openGoogleCalendarAccount()}
                            className="min-h-[40px] flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold cursor-pointer active:scale-95 shadow-sm"
                          >
                            <Calendar className="w-3.5 h-3.5 text-white" />
                            <span className="text-white">{isFa ? 'ورود به گوگل کلندر' : 'Open Calendar'}</span>
                            <ExternalLink className="w-3 h-3 text-white/80" />
                          </button>
                          <button
                            type="button"
                            onClick={onGoogleSignOut}
                            className="min-h-[40px] flex items-center gap-1 px-3 py-1.5 rounded-xl bg-rose-700 hover:bg-rose-600 text-white text-xs font-bold cursor-pointer active:scale-95 shadow-sm"
                          >
                            <LogOut className="w-3.5 h-3.5 text-white" />
                            <span className="text-white">{isFa ? 'خروج' : 'Sign Out'}</span>
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={async () => {
                            setIsSigningIn(true);
                            try {
                              await onGoogleSignIn();
                            } finally {
                              setIsSigningIn(false);
                            }
                          }}
                          disabled={isSigningIn}
                          className="min-h-[44px] flex items-center gap-2 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-md shadow-blue-600/30 disabled:opacity-50 cursor-pointer active:scale-95"
                        >
                          <Calendar className="w-4 h-4 text-white" />
                          <span className="text-white">
                            {isSigningIn
                              ? (settings.language === 'en' ? 'Connecting...' : 'در حال اتصال...')
                              : (settings.language === 'en' ? 'Sign in with Google' : 'ورود با گوگل')}
                          </span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                )}

                {/* 4.2 Geofence Radar */}
                <div className="p-3.5 rounded-2xl bg-stone-900/70 border border-stone-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-bold text-stone-200">
                      <Radio className={`w-4 h-4 ${isGeofenceActive ? 'text-emerald-400 animate-pulse' : 'text-stone-400'}`} />
                      <span>{isFa ? 'رادار پایش حصار مکانی (Geofence)' : 'Geofence Radar'}</span>
                    </div>
                    <span
                      style={
                        isGeofenceActive
                          ? { backgroundColor: '#059669', borderColor: '#6ee7b7', color: '#ffffff' }
                          : undefined
                      }
                      className={`text-[10px] px-2.5 py-0.5 rounded-full font-black border flex items-center gap-1.5 ${
                        isGeofenceActive
                          ? 'shadow-sm shadow-emerald-950/50'
                          : 'bg-stone-800 text-stone-400 border-stone-700'
                      }`}
                    >
                      {isGeofenceActive && (
                        <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
                      )}
                      <span>{isGeofenceActive ? (isFa ? 'پایش زنده فعال' : 'LIVE ACTIVE') : (isFa ? 'متوقف' : 'Paused')}</span>
                    </span>
                  </div>

                  {/* Interactive Geofence Monitoring Card with Rich Active Radar Graphics */}
                  <div
                    onClick={() => {
                      const next = !isGeofenceActive;
                      setGeofenceTrackingEnabled(next);
                      if (onToggleGeofenceActive) onToggleGeofenceActive(next);
                    }}
                    style={
                      isGeofenceActive
                        ? {
                            background: 'linear-gradient(135deg, rgba(6, 78, 59, 0.92) 0%, rgba(16, 185, 129, 0.35) 100%)',
                            borderColor: '#34d399',
                          }
                        : undefined
                    }
                    className={`flex items-center justify-between gap-3 p-3 rounded-2xl border transition-all duration-300 cursor-pointer select-none ${
                      isGeofenceActive
                        ? 'geofence-radar-active shadow-lg shadow-emerald-950/50'
                        : 'bg-stone-950 border-stone-800/80 hover:border-stone-700'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {/* Animated Radar Orb Graphic */}
                      <div
                        style={
                          isGeofenceActive
                            ? { backgroundColor: '#10b981', borderColor: '#a7f3d0', color: '#ffffff' }
                            : undefined
                        }
                        className={`relative w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border transition-all duration-300 ${
                          isGeofenceActive
                            ? 'shadow-md shadow-emerald-500/40'
                            : 'bg-stone-900 border-stone-800 text-stone-500'
                        }`}
                      >
                        {isGeofenceActive && (
                          <span
                            style={{ borderColor: 'rgba(110, 231, 183, 0.75)' }}
                            className="absolute inset-0 rounded-xl border-2 animate-ping pointer-events-none"
                          />
                        )}
                        <Radio className={`w-5 h-5 ${isGeofenceActive ? 'text-white animate-pulse' : 'text-stone-400'}`} />
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            style={isGeofenceActive ? { color: '#ffffff' } : undefined}
                            className="text-xs sm:text-sm font-black text-white block truncate"
                          >
                            {isFa ? 'پایش ورود/خروج حصارها' : 'Background Geofencing'}
                          </span>
                        </div>
                        <span
                          style={isGeofenceActive ? { color: '#d1fae5' } : undefined}
                          className="text-[11px] text-stone-400 block truncate"
                        >
                          {isGeofenceActive
                            ? (isFa ? 'رادار هوشمند موقعیت مکانی در حال پایش فعال است' : 'Smart GPS radar actively monitoring zones')
                            : (isFa ? 'پایش هوشمند GPS با مصرف بهینه باتری (غیرفعال)' : 'Low-battery GPS tracking (Paused)')}
                        </span>
                      </div>
                    </div>

                    {/* High-Visibility Switch */}
                    <div
                      role="switch"
                      aria-checked={isGeofenceActive}
                      style={{
                        backgroundColor: isGeofenceActive ? '#10b981' : '#292524',
                        borderColor: isGeofenceActive ? '#a7f3d0' : '#44403c',
                      }}
                      className="relative w-12 h-7 rounded-full border transition-all duration-200 shrink-0 flex items-center p-0.5 shadow-inner"
                    >
                      <span
                        style={{
                          backgroundColor: '#ffffff',
                          transform: isGeofenceActive
                            ? (isFa ? 'translateX(-20px)' : 'translateX(20px)')
                            : 'translateX(0px)',
                        }}
                        className="w-5 h-5 rounded-full shadow-md transition-transform duration-200 ease-out block"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-2.5 rounded-xl bg-stone-950 border border-stone-800 text-xs">
                    <span className="text-stone-400 text-[11px]">{isFa ? 'حصارهای فعال ثبت‌شده:' : 'Active Geofences:'}</span>
                    <span className="font-black text-emerald-400">
                      {isFa 
                        ? `${toPersianDigits(reminders.filter((r) => r.geofence && r.geofence.enabled && r.status !== 'completed').length)} مکان` 
                        : `${reminders.filter((r) => r.geofence && r.geofence.enabled && r.status !== 'completed').length} Places`}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ========================================================= */}
          {/* 5. BACKUP & SYSTEM (پشتیبان‌گیری و سیستم) */}
          {/* ========================================================= */}
          <div className="rounded-2xl border border-stone-800 bg-stone-950/60 overflow-hidden transition-all shadow-sm">
            <button
              type="button"
              onClick={(e) => toggleSection('backup', e.currentTarget)}
              className="w-full min-h-[48px] p-3.5 sm:p-4 bg-stone-900/60 hover:bg-stone-900 border-b border-stone-800/80 flex items-center justify-between gap-3 transition-colors cursor-pointer text-start"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                  <Database className="w-4.5 h-4.5" />
                </div>
                <div className="min-w-0">
                  <h4 className="text-xs sm:text-sm font-black text-white truncate">
                    {isFa ? '۵. پشتیبان‌گیری و اطلاعات' : '5. Backup & Data'}
                  </h4>
                  <p className="text-[11px] text-stone-400 truncate">
                    {isFa
                      ? 'پوشه پشتیبان خودکار • خروجی و ورود JSON'
                      : 'Auto-Backup Folder • JSON Export & Import'}
                  </p>
                </div>
              </div>
              <ChevronDown className={`w-4 h-4 text-stone-400 transition-transform duration-200 shrink-0 ${openSections.backup ? 'rotate-180 text-emerald-400' : ''}`} />
            </button>

            {openSections.backup && (
              <div className="p-3 sm:p-4 space-y-4 animate-in fade-in">
                {/* 5.1 Item Count Badges */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                  <div className="p-2 rounded-xl bg-stone-900/80 border border-stone-800">
                    <span className="text-[10px] text-stone-500 block">{isFa ? 'یادآورها' : 'Reminders'}</span>
                    <span className="font-bold text-indigo-400 text-sm">{isFa ? toPersianDigits(reminders.length) : reminders.length}</span>
                  </div>
                  <div className="p-2 rounded-xl bg-stone-900/80 border border-stone-800">
                    <span className="text-[10px] text-stone-500 block">{isFa ? 'مناسبت‌ها' : 'Occasions'}</span>
                    <span className="font-bold text-pink-400 text-sm">{isFa ? toPersianDigits(occasions.length) : occasions.length}</span>
                  </div>
                  <div className="p-2 rounded-xl bg-stone-900/80 border border-stone-800">
                    <span className="text-[10px] text-stone-500 block">{isFa ? 'ایده‌ها' : 'Ideas'}</span>
                    <span className="font-bold text-sky-400 text-sm">{isFa ? toPersianDigits(ideas.length) : ideas.length}</span>
                  </div>
                  <div className="p-2 rounded-xl bg-stone-900/80 border border-stone-800">
                    <span className="text-[10px] text-stone-500 block">{isFa ? 'مکان‌های GPS' : 'GPS Places'}</span>
                    <span className="font-bold text-emerald-400 text-sm">{isFa ? toPersianDigits(savedLocations.length) : savedLocations.length}</span>
                  </div>
                </div>

                {/* 5.1B Auto-Backup Folder Selection (Android SAF & Desktop Folder - No storage permissions) */}
                <div className="p-3.5 rounded-2xl bg-emerald-950/25 border border-emerald-500/35 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <FolderOpen className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span className="text-xs font-black text-emerald-200 truncate">
                        {isFa ? 'پوشه پشتیبان‌گیری خودکار (بدون نیاز به مجوز حافظه)' : 'Automatic Backup Folder (No Storage Permission)'}
                      </span>
                    </div>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-bold border shrink-0 flex items-center gap-1 ${
                        folderStatus?.connected
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                          : folderStatus?.needsReconnect
                          ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                          : 'bg-stone-800 text-stone-400 border-stone-700'
                      }`}
                    >
                      {folderStatus?.connected && <Check className="w-3 h-3" />}
                      <span>
                        {folderStatus?.connected
                          ? isFa
                            ? `متصل: ${folderStatus.folderName || 'YAAD'}`
                            : `Connected: ${folderStatus.folderName || 'YAAD'}`
                          : folderStatus?.needsReconnect
                          ? isFa
                            ? `نیاز به تایید: ${folderStatus.folderName || 'پوشه'}`
                            : `Reconnect: ${folderStatus.folderName || 'Folder'}`
                          : isFa
                          ? 'انتخاب نشده'
                          : 'Not Selected'}
                      </span>
                    </span>
                  </div>

                  <p className="text-[11px] text-stone-300 leading-relaxed">
                    {isNativeAndroidApp()
                      ? isFa
                        ? 'با انتخاب پوشه (از طریق مجوز رسمی SAF اندروید)، فایل yaad_backup.json در هر تغییر و در هر بار باز و بسته شدن برنامه به‌صورت خودکار در همان پوشه ذخیره می‌شود و پوشه پیش‌فرض داخلی YAAD نیز ثابت باقی می‌ماند.'
                        : 'Select any folder using Android SAF (no storage permissions). yaad_backup.json is automatically written on every change and on every app open/close, while the private default YAAD vault stays fixed.'
                      : folderStatus && !folderStatus.supported
                      ? isFa
                        ? 'پشتیبان خودکار داخلی همیشه در هر تغییر و باز/بسته شدن فعال است. انتخاب دائمی پوشه سیستم‌عامل در این مرورگر/پیش‌نمایش در دسترس نیست، اما از «بازیابی از پوشه» و خروجی/ورود JSON می‌توانید استفاده کنید.'
                        : 'Private auto-backup runs on every change and open/close. Persistent desktop folder selection is unavailable in this browser/preview frame, but "Restore from Folder" and JSON export/import work anytime.'
                      : isFa
                      ? 'یک پوشه روی کامپیوتر خود انتخاب کنید تا فایل yaad_backup.json در هر تغییر و هنگام باز و بسته شدن برنامه به‌صورت خودکار ذخیره و همگام‌سازی شود.'
                      : 'Choose a folder on your computer so yaad_backup.json is automatically saved and synced on every change and app open/close.'}
                  </p>

                  {(() => {
                    try {
                      const ts = parseInt(localStorage.getItem(LAST_LOCAL_BACKUP_KEY) || '0', 10);
                      if (!isNaN(ts) && ts > 0) {
                        return (
                          <div className="text-[10.5px] text-stone-400">
                            {isFa ? 'آخرین ذخیره خودکار: ' : 'Last auto-backup: '}
                            <span className="text-stone-200 font-bold">
                              {formatJalaliFull(ts, isFa ? 'fa' : 'en')}
                            </span>
                          </div>
                        );
                      }
                    } catch {}
                    return null;
                  })()}

                  {folderStatus?.needsReconnect && (
                    <button
                      type="button"
                      disabled={isFolderBusy}
                      onClick={async () => {
                        setIsFolderBusy(true);
                        setBackupFeedback(null);
                        try {
                          const res = await reconnectDesktopBackupFolder();
                          const nextStatus = await getBackupFolderStatus();
                          setFolderStatus(nextStatus);
                          if (!res.granted) {
                            setBackupFeedback({
                              type: 'error',
                              text: isFa ? 'دسترسی مجدد پوشه تایید نشد.' : 'Folder reconnection was not granted.',
                            });
                            return;
                          }
                          if (res.restoredSnapshot && getSnapshotItemCount(res.restoredSnapshot) > 0 && onRestoreData) {
                            onRestoreData(
                              {
                                reminders: res.restoredSnapshot.reminders || [],
                                ideas: res.restoredSnapshot.ideas || [],
                                savedLocations: res.restoredSnapshot.savedLocations || [],
                                occasions: res.restoredSnapshot.occasions || [],
                                settings: res.restoredSnapshot.settings,
                              },
                              'merge'
                            );
                          }
                          await performAutoBackup({ reminders, ideas, savedLocations, occasions, settings });
                          setBackupFeedback({
                            type: 'success',
                            text: isFa
                              ? `پوشه «${res.folderName || 'YAAD'}» مجدداً متصل و همگام‌سازی شد.`
                              : `Folder "${res.folderName || 'YAAD'}" reconnected and synced.`,
                          });
                        } finally {
                          setIsFolderBusy(false);
                        }
                      }}
                      className="w-full min-h-[42px] px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 font-black text-xs shadow-sm active:scale-95 transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-60"
                    >
                      <RefreshCw className={`w-4 h-4 shrink-0 ${isFolderBusy ? 'animate-spin' : ''}`} />
                      <span>
                        {isFa
                          ? `اتصال مجدد پوشه «${folderStatus.folderName || 'YAAD'}»`
                          : `Reconnect Folder "${folderStatus.folderName || 'YAAD'}"`}
                      </span>
                    </button>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {(!folderStatus || folderStatus.supported) && (
                      <button
                        type="button"
                        disabled={isFolderBusy}
                        onClick={async () => {
                          setIsFolderBusy(true);
                          setBackupFeedback(null);
                          try {
                            const res = await chooseAutoBackupFolder();
                            const nextStatus = await getBackupFolderStatus();
                            setFolderStatus(nextStatus);
                            if (res.cancelled) return;
                            if (!res.granted) {
                              setBackupFeedback({
                                type: 'error',
                                text:
                                  res.unsupportedReason === 'iframe' || res.unsupportedReason === 'browser'
                                    ? isFa
                                      ? 'این مرورگر از انتخاب مستقیم پوشه پشتیبانی نمی‌کند.'
                                      : 'Persistent folder picker is unavailable in this browser or frame.'
                                    : isFa
                                    ? 'انتخاب پوشه تکمیل نشد.'
                                    : 'Folder selection did not complete.',
                              });
                              return;
                            }

                            let restoredItems = 0;
                            if (res.restoredSnapshot && getSnapshotItemCount(res.restoredSnapshot) > 0 && onRestoreData) {
                              restoredItems = getSnapshotItemCount(res.restoredSnapshot);
                              onRestoreData(
                                {
                                  reminders: res.restoredSnapshot.reminders || [],
                                  ideas: res.restoredSnapshot.ideas || [],
                                  savedLocations: res.restoredSnapshot.savedLocations || [],
                                  occasions: res.restoredSnapshot.occasions || [],
                                  settings: res.restoredSnapshot.settings,
                                },
                                'merge'
                              );
                            } else {
                              await performAutoBackup({ reminders, ideas, savedLocations, occasions, settings });
                            }

                            setBackupFeedback({
                              type: 'success',
                              text:
                                restoredItems > 0
                                  ? isFa
                                    ? `پوشه «${res.folderName}» متصل شد و ${toPersianDigits(restoredItems)} مورد از نسخه پشتیبان داخل آن بازیابی گردید.`
                                    : `Folder "${res.folderName}" connected & restored ${restoredItems} item(s).`
                                  : isFa
                                  ? `پوشه «${res.folderName}» برای ذخیره خودکار yaad_backup.json متصل شد.`
                                  : `Folder "${res.folderName}" connected for automatic yaad_backup.json saves.`,
                            });
                          } finally {
                            setIsFolderBusy(false);
                          }
                        }}
                        className="min-h-[44px] px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs shadow-sm active:scale-95 transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-60"
                      >
                        <FolderOpen className="w-4 h-4 shrink-0" />
                        <span>
                          {folderStatus?.connected
                            ? isFa
                              ? 'تغییر پوشه پشتیبان'
                              : 'Change Backup Folder'
                            : isFa
                            ? 'انتخاب پوشه پشتیبان'
                            : 'Select Backup Folder'}
                        </span>
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={isFolderBusy}
                      onClick={async () => {
                        setBackupFeedback(null);
                        if (folderStatus?.connected) {
                          setIsFolderBusy(true);
                          try {
                            const readRes = await readBackupFromConnectedFolder();
                            if (readRes.snapshot && getSnapshotItemCount(readRes.snapshot) > 0 && onRestoreData) {
                              onRestoreData(
                                {
                                  reminders: readRes.snapshot.reminders || [],
                                  ideas: readRes.snapshot.ideas || [],
                                  savedLocations: readRes.snapshot.savedLocations || [],
                                  occasions: readRes.snapshot.occasions || [],
                                  settings: readRes.snapshot.settings,
                                },
                                'merge'
                              );
                              const count = getSnapshotItemCount(readRes.snapshot);
                              setBackupFeedback({
                                type: 'success',
                                text: isFa
                                  ? `${toPersianDigits(count)} مورد از پوشه «${readRes.folderName || 'YAAD'}» با موفقیت بازیابی شد.`
                                  : `Restored ${count} item(s) from folder "${readRes.folderName || 'YAAD'}".`,
                              });
                            } else {
                              setBackupFeedback({
                                type: 'error',
                                text: isFa
                                  ? `فایل yaad_backup.json با داده معتبر در پوشه «${readRes.folderName || 'انتخابی'}» یافت نشد.`
                                  : `No valid yaad_backup.json found in "${readRes.folderName || 'selected folder'}".`,
                              });
                            }
                          } finally {
                            setIsFolderBusy(false);
                          }
                          return;
                        }

                        if (folderStatus && !folderStatus.supported) {
                          folderRestoreInputRef.current?.click();
                          return;
                        }

                        setIsFolderBusy(true);
                        try {
                          const res = await chooseAutoBackupFolder();
                          const nextStatus = await getBackupFolderStatus();
                          setFolderStatus(nextStatus);
                          if (res.cancelled) return;
                          if (!res.granted) {
                            folderRestoreInputRef.current?.click();
                            return;
                          }
                          if (res.restoredSnapshot && getSnapshotItemCount(res.restoredSnapshot) > 0 && onRestoreData) {
                            const count = getSnapshotItemCount(res.restoredSnapshot);
                            onRestoreData(
                              {
                                reminders: res.restoredSnapshot.reminders || [],
                                ideas: res.restoredSnapshot.ideas || [],
                                savedLocations: res.restoredSnapshot.savedLocations || [],
                                occasions: res.restoredSnapshot.occasions || [],
                                settings: res.restoredSnapshot.settings,
                              },
                              'merge'
                            );
                            setBackupFeedback({
                              type: 'success',
                              text: isFa
                                ? `${toPersianDigits(count)} مورد از پوشه «${res.folderName}» بازیابی و ادغام شد.`
                                : `Restored and merged ${count} item(s) from "${res.folderName}".`,
                            });
                          } else {
                            setBackupFeedback({
                              type: 'error',
                              text: isFa
                                ? `فایل پشتیبان قبلی در پوشه «${res.folderName}» یافت نشد، اما پوشه برای ذخیره خودکار متصل گردید.`
                                : `No existing backup found in "${res.folderName}", and the folder is now connected for auto-backup.`,
                            });
                          }
                        } finally {
                          setIsFolderBusy(false);
                        }
                      }}
                      className="min-h-[44px] px-3.5 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-black text-xs shadow-sm active:scale-95 transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-60"
                    >
                      <Upload className="w-4 h-4 shrink-0" />
                      <span>{isFa ? 'بازیابی از پوشه' : 'Restore from Folder'}</span>
                    </button>

                    <input
                      ref={folderRestoreInputRef}
                      type="file"
                      {...({ webkitdirectory: '', directory: '' } as any)}
                      multiple
                      className="hidden"
                      onChange={async (e) => {
                        const files = e.target.files;
                        e.target.value = '';
                        if (!files || files.length === 0) return;
                        setIsFolderBusy(true);
                        setBackupFeedback(null);
                        try {
                          const snap = await importBackupFromFolderFiles(files);
                          if (snap && getSnapshotItemCount(snap) > 0 && onRestoreData) {
                            onRestoreData(
                              {
                                reminders: snap.reminders || [],
                                ideas: snap.ideas || [],
                                savedLocations: snap.savedLocations || [],
                                occasions: snap.occasions || [],
                                settings: snap.settings,
                              },
                              'merge'
                            );
                            setBackupFeedback({
                              type: 'success',
                              text: isFa
                                ? `${toPersianDigits(getSnapshotItemCount(snap))} مورد از پوشه انتخاب‌شده بازیابی گردید.`
                                : `Restored ${getSnapshotItemCount(snap)} item(s) from folder.`,
                            });
                          } else {
                            setBackupFeedback({
                              type: 'error',
                              text: isFa
                                ? 'فایل پشتیبان معتبر (yaad_backup.json) در این پوشه پیدا نشد.'
                                : 'No valid yaad_backup.json was found in that folder.',
                            });
                          }
                        } finally {
                          setIsFolderBusy(false);
                        }
                      }}
                    />
                  </div>

                  {(folderStatus?.connected || folderStatus?.needsReconnect) && (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        disabled={isFolderBusy}
                        onClick={async () => {
                          setIsFolderBusy(true);
                          try {
                            await revokeLocalFolderPermission();
                            const nextStatus = await getBackupFolderStatus();
                            setFolderStatus(nextStatus);
                            setBackupFeedback({
                              type: 'success',
                              text: isFa
                                ? 'اتصال پوشه پشتیبان قطع شد. پوشه پیش‌فرض داخلی همچنان فعال است.'
                                : 'Auto-backup folder disconnected. Private internal backup remains active.',
                            });
                          } finally {
                            setIsFolderBusy(false);
                          }
                        }}
                        className="px-2.5 py-1 rounded-lg bg-stone-800/80 hover:bg-stone-800 text-stone-400 hover:text-rose-300 text-[11px] font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Unlink className="w-3 h-3" />
                        <span>{isFa ? 'قطع اتصال پوشه' : 'Disconnect Folder'}</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* 5.2 Scoped-Storage Compliant Manual JSON Export & Import */}
                <div className="p-3.5 rounded-2xl bg-stone-900/75 border border-stone-800 space-y-3">
                  <div className="space-y-1">
                    <span className="text-xs font-bold text-stone-200 block">
                      {isFa ? 'خروجی و بازیابی دستی نسخه پشتیبان (JSON)' : 'Manual Backup Export & Import (JSON)'}
                    </span>
                    <p className="text-[11px] text-stone-400 leading-relaxed">
                      {isFa
                        ? 'علاوه بر پشتیبان خودکار در پوشه انتخابی و حافظه داخلی برنامه، می‌توانید هر زمان فایل JSON را به‌صورت دستی ذخیره یا وارد کنید.'
                        : 'In addition to automatic backups in your chosen folder and private app vault, you can export or import a JSON file anytime.'}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={isBackupBusy}
                      onClick={async () => {
                        setIsBackupBusy(true);
                        setBackupFeedback(null);
                        try {
                          const res = await exportBackupToFile(
                            { reminders, ideas, savedLocations, occasions, settings },
                            currentLanguage
                          );
                          if (res.ok) {
                            setBackupFeedback({
                              type: 'success',
                              text: isFa
                                ? `فایل پشتیبان (${res.fileName}) آماده و ذخیره/ارسال شد.`
                                : `Backup file (${res.fileName}) exported successfully.`,
                            });
                          } else {
                            setBackupFeedback({
                              type: 'error',
                              text: res.error || (isFa ? 'خروجی گرفتن انجام نشد.' : 'Export failed.'),
                            });
                          }
                        } finally {
                          setIsBackupBusy(false);
                        }
                      }}
                      className="min-h-[44px] px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs shadow-sm active:scale-95 transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-60"
                    >
                      <Download className="w-4 h-4 shrink-0" />
                      <span>{isFa ? 'خروجی گرفتن (JSON)' : 'Export Backup'}</span>
                    </button>

                    <button
                      type="button"
                      disabled={isBackupBusy}
                      onClick={() => {
                        importBackupInputRef.current?.click();
                      }}
                      className="min-h-[44px] px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-black text-xs shadow-sm active:scale-95 transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-60"
                    >
                      <Upload className="w-4 h-4 shrink-0" />
                      <span>{isFa ? 'وارد کردن بک‌آپ' : 'Import Backup'}</span>
                    </button>

                    <input
                      ref={importBackupInputRef}
                      type="file"
                      accept=".json,application/json"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (!file) return;
                        setIsBackupBusy(true);
                        setBackupFeedback(null);
                        setImportedRecoveryCode(null);
                        try {
                          const snap = await importBackupFromFile(file);
                          if (!snap) {
                            setBackupFeedback({
                              type: 'error',
                              text: isFa
                                ? 'فایل انتخاب‌شده معتبر نیست یا ساختار پشتیبان یاد را ندارد.'
                                : 'Invalid backup file format.',
                            });
                            return;
                          }
                          if (onRestoreData) {
                            onRestoreData(
                              {
                                reminders: snap.reminders || [],
                                ideas: snap.ideas || [],
                                savedLocations: snap.savedLocations || [],
                                occasions: snap.occasions || [],
                                settings: snap.settings,
                              },
                              'merge'
                            );
                          }
                          if (
                            snap.launchGiftRecoveryCode &&
                            typeof snap.launchGiftRecoveryCode === 'string' &&
                            !proEntitlement?.hasPaidPro
                          ) {
                            setImportedRecoveryCode(snap.launchGiftRecoveryCode.trim());
                          }
                          const restoredCount = getSnapshotItemCount(snap);
                          setBackupFeedback({
                            type: 'success',
                            text: isFa
                              ? `${toPersianDigits(restoredCount)} مورد با موفقیت از فایل پشتیبان بازیابی و ادغام شد.`
                              : `Successfully imported and merged ${restoredCount} item(s).`,
                          });
                        } finally {
                          setIsBackupBusy(false);
                        }
                      }}
                    />
                  </div>

                  {backupFeedback && (
                    <div
                      className={`p-2.5 rounded-xl text-[11px] font-bold ${
                        backupFeedback.type === 'success'
                          ? 'bg-emerald-500/15 border border-emerald-500/40 text-emerald-300'
                          : 'bg-rose-500/15 border border-rose-500/40 text-rose-300'
                      }`}
                    >
                      {backupFeedback.text}
                    </div>
                  )}

                  {importedRecoveryCode && !proEntitlement?.hasPaidPro && (
                    <div className="p-3 rounded-xl bg-amber-500/15 border border-amber-400/45 space-y-2 animate-in fade-in">
                      <p className="text-[11px] text-amber-200 font-bold leading-relaxed">
                        {isFa
                          ? `کد بازیابی هدیه جشنواره لانچ (${importedRecoveryCode}) در فایل پشتیبان یافت شد. آیا می‌خواهید هدیه نسخه Pro خود را اکنون فعال و بازیابی کنید؟`
                          : `Launch Offer recovery code (${importedRecoveryCode}) was found in this backup. Would you like to restore your Pro gift now?`}
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={isRecoveringFromBackup}
                          onClick={async () => {
                            setIsRecoveringFromBackup(true);
                            try {
                              const res = await recoverLaunchOfferGiftByCode(
                                importedRecoveryCode,
                                currentLanguage
                              );
                              onEntitlementUpdated?.(res.state);
                              if (res.recovered) {
                                setImportedRecoveryCode(null);
                                setBackupFeedback({
                                  type: 'success',
                                  text: isFa
                                    ? `هدیه جشنواره لانچ با موفقیت بازیابی شد! کد بازیابی جدید شما: ${res.recoveryCode || ''}`
                                    : `Launch gift restored! Your new recovery code: ${res.recoveryCode || ''}`,
                                });
                              } else {
                                setBackupFeedback({
                                  type: 'error',
                                  text:
                                    res.errorMessage ||
                                    (isFa
                                      ? 'بازیابی هدیه از کد داخل بک‌آپ انجام نشد.'
                                      : 'Could not recover gift from backup code.'),
                                });
                              }
                            } finally {
                              setIsRecoveringFromBackup(false);
                            }
                          }}
                          className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 font-black text-xs transition-all cursor-pointer disabled:opacity-60"
                        >
                          {isRecoveringFromBackup
                            ? isFa
                              ? 'در حال بازیابی هدیه...'
                              : 'Restoring Gift...'
                            : isFa
                            ? 'بازیابی هدیه لانچ'
                            : 'Restore Launch Gift'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setImportedRecoveryCode(null)}
                          className="min-h-[38px] px-3 py-1.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-300 font-bold text-xs transition-colors cursor-pointer"
                        >
                          {isFa ? 'بستن' : 'Dismiss'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Performance Statistics Modal Trigger */}
                {onOpenStats && (
                  <div className="pt-1">
                    <div className="flex items-center justify-between p-3 rounded-2xl bg-stone-900/80 border border-stone-800 hover:border-indigo-500/40 transition-all">
                      <div className="w-9 h-9 rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-400 flex items-center justify-center flex-shrink-0">
                        <BarChart3 className="w-5 h-5" />
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          onOpenStats();
                        }}
                        className="min-h-[44px] px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-sm active:scale-95 transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5"
                      >
                        <span>{settings.language === 'en' ? t.viewStats : 'مشاهده آمار'}</span>
                        <span className="text-indigo-200">←</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ========================================================= */}
          {/* 6. RECYCLE BIN (سطل بازیافت) */}
          {/* ========================================================= */}
          <div className="border border-stone-800 rounded-2xl overflow-hidden bg-stone-900/40">
            <button
              type="button"
              onClick={(e) => toggleSection('recycleBin', e.currentTarget)}
              className="w-full flex items-center justify-between p-3.5 sm:p-4 bg-stone-900/80 hover:bg-stone-800/80 transition-colors text-start cursor-pointer"
            >
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-rose-500/15 text-rose-400 border border-rose-500/30 flex items-center justify-center shrink-0">
                  <Trash2 className="w-4 h-4" />
                </div>
                <div className="text-start">
                  <span className="font-bold text-sm text-white block">
                    {isFa ? 'سطل بازیافت' : 'Recycle Bin'}
                  </span>
                  <span className="text-[11px] text-stone-400 block">
                    {allDeletedItems.length > 0
                      ? (isFa ? `${toPersianDigits(allDeletedItems.length)} مورد در سطل بازیافت` : `${allDeletedItems.length} items in bin`)
                      : (isFa ? 'خالی' : 'Empty')}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {allDeletedItems.length > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                    {isFa ? toPersianDigits(allDeletedItems.length) : allDeletedItems.length}
                  </span>
                )}
                {openSections.recycleBin ? (
                  <ChevronUp className="w-4 h-4 text-stone-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-stone-400" />
                )}
              </div>
            </button>

            {openSections.recycleBin && (
              <div className="p-3.5 sm:p-4 border-t border-stone-800/80 space-y-3.5 animate-in fade-in">
                {/* Header note & Empty Bin button */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 pb-2 border-b border-stone-800/80">
                  <span className="text-xs text-stone-400 leading-relaxed">
                    {isFa 
                      ? 'موارد حذف‌شده (یادآور، مکان، مناسبت، ایده) تا زمان خالی کردن در این بخش نگهداری می‌شوند.' 
                      : 'Deleted items are kept here until permanently emptied.'}
                  </span>

                  {allDeletedItems.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setIsConfirmingEmptyBin(true)}
                      className="min-h-[44px] px-3.5 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 text-xs font-bold border border-rose-500/30 transition-all flex items-center gap-1.5 cursor-pointer shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                      <span>{isFa ? 'خالی کردن سطل' : 'Empty Bin'}</span>
                    </button>
                  )}
                </div>

                {/* Empty Bin Confirmation Dialog */}
                {isConfirmingEmptyBin && (
                  <div className="p-3.5 rounded-2xl bg-rose-950/40 border border-rose-500/40 space-y-2.5 animate-in fade-in">
                    <p className="text-xs text-rose-200 font-bold leading-relaxed">
                      {isFa 
                        ? 'آیا از حذف دائمی تمام موارد موجود در سطل بازیافت اطمینان دارید؟ این عملیات قابل بازگشت نیست.'
                        : 'Are you sure you want to permanently delete all items in the Recycle Bin? This cannot be undone.'}
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          onEmptyRecycleBin?.();
                          setIsConfirmingEmptyBin(false);
                        }}
                        className="min-h-[44px] flex-1 py-2 px-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs transition-colors cursor-pointer"
                      >
                        {isFa ? 'بله، خالی کن' : 'Yes, Empty'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsConfirmingEmptyBin(false)}
                        className="min-h-[44px] py-2 px-3 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-300 text-xs font-bold transition-colors cursor-pointer"
                      >
                        {isFa ? 'انصراف' : 'Cancel'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Items List */}
                {allDeletedItems.length === 0 ? (
                  <div className="py-8 text-center text-xs text-stone-500 font-medium space-y-1">
                    <Trash2 className="w-6 h-6 mx-auto text-stone-600" />
                    <p>{isFa ? 'سطل بازیافت خالی است' : 'Recycle bin is empty'}</p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {allDeletedItems.map((item) => {
                      const getTypeIcon = () => {
                        switch (item.type) {
                          case 'reminder':
                            return <Bell className="w-3.5 h-3.5 text-indigo-400" />;
                          case 'location':
                            return <MapPin className="w-3.5 h-3.5 text-cyan-400" />;
                          case 'occasion':
                            return <Calendar className="w-3.5 h-3.5 text-rose-400" />;
                          case 'idea':
                            return <Lightbulb className="w-3.5 h-3.5 text-indigo-300" />;
                        }
                      };

                      const getTypeName = () => {
                        switch (item.type) {
                          case 'reminder':
                            return isFa ? 'یادآور' : 'Reminder';
                          case 'location':
                            return isFa ? 'مکان' : 'Location';
                          case 'occasion':
                            return isFa ? 'مناسبت' : 'Occasion';
                          case 'idea':
                            return isFa ? 'ایده' : 'Idea';
                        }
                      };

                      return (
                        <div
                          key={`${item.type}-${item.id}`}
                          className="p-3 rounded-xl bg-stone-900 border border-stone-800 flex items-center justify-between gap-3"
                        >
                          <div className="space-y-1 min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              {getTypeIcon()}
                              <span className="text-[11px] font-bold text-stone-400">
                                {getTypeName()}
                              </span>
                            </div>
                            <h4 className="text-xs font-bold text-white truncate">
                              {item.title}
                            </h4>
                            <span className="text-[10px] text-stone-500 block">
                              {isFa ? 'حذف در:' : 'Deleted:'} {formatJalaliFull(item.deletedAt, isFa ? 'fa' : 'en')}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {/* Restore Button */}
                            <button
                              type="button"
                              onClick={() => onRestoreItem?.(item.id, item.type)}
                              className="min-h-[44px] min-w-[44px] px-2.5 py-1.5 rounded-xl bg-emerald-600/15 hover:bg-emerald-600/25 text-emerald-300 border border-emerald-500/25 text-xs font-bold flex items-center gap-1 transition-all cursor-pointer"
                              title={isFa ? 'بازیابی' : 'Restore'}
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline">{isFa ? 'بازیابی' : 'Restore'}</span>
                            </button>

                            {/* Permanent Delete Button */}
                            <button
                              type="button"
                              onClick={() => onPermanentDeleteItem?.(item.id, item.type)}
                              className="min-h-[44px] min-w-[44px] p-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 text-xs font-bold flex items-center justify-center transition-all cursor-pointer"
                              title={isFa ? 'حذف دائمی' : 'Permanent Delete'}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ========================================================= */}
          {/* 7. MINIMAL APP INFO & LINKS (بعد از بخش سطل زباله) */}
          {/* ========================================================= */}
          <div className="pt-2">
            <div className="rounded-2xl border border-stone-800/90 bg-stone-950/70 p-3.5 sm:p-4 space-y-3">
              {/* Row 1: App Version */}
              <div className="flex items-center justify-between pb-2.5 border-b border-stone-800/80">
                <div className="flex items-center gap-2">
                  <img src={`${appIcon}${appIcon.includes('?') ? '&' : '?'}v=ff8c00`} alt="YAAD" className="w-5 h-5 rounded-md object-cover" />
                  <span className="text-xs font-bold text-stone-300">
                    {isFa ? 'ورژن اپ' : 'App Version'}
                  </span>
                </div>
                <span className="font-mono text-xs font-black text-indigo-400 bg-indigo-500/10 border border-indigo-500/25 px-2.5 py-0.5 rounded-lg" dir="ltr">
                  v{APP_VERSION}
                </span>
              </div>

              {/* Row 2: Minimal Links (Privacy, About, Support Email) */}
              <div className="grid grid-cols-3 gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setActiveInfoDialog(activeInfoDialog === 'privacy' ? null : 'privacy')}
                  className={`py-2 px-2.5 rounded-xl border font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    activeInfoDialog === 'privacy'
                      ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                      : 'bg-stone-900/80 hover:bg-stone-800 border-stone-800 text-stone-300 hover:text-white'
                  }`}
                >
                  <ShieldCheck className="w-4 h-4 text-emerald-400 drop-shadow-[0_0_6px_rgba(16,185,129,0.4)] shrink-0" />
                  <span className="truncate">{isFa ? 'حریم خصوصی' : 'Privacy'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveInfoDialog(activeInfoDialog === 'about' ? null : 'about')}
                  className={`py-2 px-2.5 rounded-xl border font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    activeInfoDialog === 'about'
                      ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300'
                      : 'bg-stone-900/80 hover:bg-stone-800 border-stone-800 text-stone-300 hover:text-white'
                  }`}
                >
                  <Info className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                  <span className="truncate">{isFa ? 'درباره‌ی' : 'About'}</span>
                </button>

                <a
                  href="mailto:info@narvanteam.ir?subject=YAAD%20App%20Support"
                  className="py-2 px-2.5 rounded-xl bg-stone-900/80 hover:bg-stone-800 border border-stone-800 text-stone-300 hover:text-indigo-300 font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                  title="info@narvanteam.ir"
                >
                  <Mail className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                  <span className="truncate">{isFa ? 'پشتیبانی' : 'Support'}</span>
                </a>
              </div>

              {/* Row 2.5: Direct User Feedback & Rating Dialog Trigger */}
              <button
                type="button"
                onClick={() => openReviewDialogDirectly()}
                className="w-full py-2 px-3 rounded-xl bg-emerald-500/12 hover:bg-emerald-500/20 border border-emerald-500/35 text-emerald-300 font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer"
              >
                <span>★</span>
                <span>
                  {isFa ? (
                    <>
                      ثبت بازخورد و امتیاز به{' '}
                      <span
                        data-keep-color="true"
                        style={{ color: '#FF8C00', fontWeight: 900 }}
                      >
                        یاد
                      </span>
                    </>
                  ) : (
                    'Rate & Send Feedback for YAAD'
                  )}
                </span>
              </button>

              {/* Expandable Minimal Info Content for Privacy or About */}
              {activeInfoDialog === 'privacy' && (
                <div className="p-3 rounded-xl bg-stone-900/90 border border-stone-800 text-[11px] text-stone-300 leading-relaxed space-y-2 animate-in fade-in">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-emerald-300">{isFa ? 'حریم خصوصی و امنیت داده‌ها' : 'Privacy Policy'}</span>
                    <button type="button" onClick={() => setActiveInfoDialog(null)} className="text-stone-400 hover:text-white">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <p>
                    {isFa
                      ? 'داده‌های شما به‌صورت محلی در فضای خصوصی دستگاه ذخیره می‌شوند و هیچ مجوز دسترسی گسترده به حافظه درخواست نمی‌شود؛ در صورت تمایل می‌توانید از طریق انتخاب پوشه رسمی اندروید (SAF) یا دسکتاپ، پوشه‌ای را برای پشتیبان خودکار JSON انتخاب کنید. خروجی گرفتن و بازیابی فایل پشتیبان (JSON) برای همه کاربران همیشه رایگان است. مختصات GPS فقط هنگام دریافت آدرس به OpenStreetMap Nominatim ارسال می‌شود، فرم بازخورد اختیاری است، پرداخت درون‌برنامه‌ای در محیط امن کافه‌بازار یا مایکت انجام می‌گیرد و برای هدیه جشنواره لانچ (۷۳۰ نفر اول) صرفاً یک شمارنده ناشناس (Firebase Anonymous Auth) و هش یک‌طرفه SHA-256 کد بازیابی بدون هیچ اطلاعات هویتی به کار می‌رود.'
                      : 'Your reminders, occasions, ideas, and places are stored privately on your device with zero broad storage permissions; optionally you may pick a folder via Android SAF or Desktop File System Access for automatic JSON backups. JSON backup export & import is free forever. Coordinates go to OpenStreetMap Nominatim only on address lookup, feedback submission is optional, store purchases run through Cafe Bazaar or Myket, and the 730-user Launch Offer uses anonymous Firebase Auth and a one-way SHA-256 recovery code hash without any personal data.'}
                  </p>
                  <p className="text-[10.5px] text-stone-400">
                    {isFa
                      ? 'توسعه‌دهنده: تیم فناوری نارون • narvanteam.ir'
                      : 'Developer: Narvan Technology Team • narvanteam.ir'}
                  </p>
                  <a
                    href="/privacy.html"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 font-bold text-[11px] transition-all"
                  >
                    <span>{isFa ? 'مطالعه کامل سیاست حریم خصوصی' : 'Read Full Privacy Policy'}</span>
                    <ExternalLink className="w-3 h-3 shrink-0" />
                  </a>
                </div>
              )}

              {activeInfoDialog === 'about' && (
                <div className="p-3 rounded-xl bg-stone-900/90 border border-stone-800 text-[11px] text-stone-300 leading-relaxed space-y-1.5 animate-in fade-in">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-indigo-300">{isFa ? 'درباره‌ی اپلیکیشن یاد (YAAD)' : 'About YAAD'}</span>
                    <button type="button" onClick={() => setActiveInfoDialog(null)} className="text-stone-400 hover:text-white">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <p>
                    {isFa
                      ? `دستیار هوشمند مدیریت زمان، یادآورهای گفتاری، مناسبت‌ها، ایده‌ها و حصار مکانی مکان‌محور (Geofence) • نسخه ${toPersianDigits(APP_VERSION)}`
                      : `Smart time management assistant for spoken reminders, occasions, ideas, and location-based Geofence alerts • Version ${APP_VERSION}`}
                  </p>
                  <p className="text-stone-400 font-bold">
                    {isFa ? 'توسعه‌دهنده: تیم فناوری نارون' : 'Developer: Narvan Technology Team'}
                  </p>
                </div>
              )}

              {/* Direct Support Email & Website Display */}
              <div className="pt-1 space-y-1.5 text-[11px] text-stone-400">
                <div className="flex items-center justify-between">
                  <span>{isFa ? 'توسعه‌دهنده:' : 'Developer:'}</span>
                  <a
                    href="https://narvanteam.ir"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-bold text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
                  >
                    <span>{isFa ? 'تیم فناوری نارون (narvanteam.ir)' : 'Narvan Technology Team (narvanteam.ir)'}</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <div className="flex items-center justify-between">
                  <span>{isFa ? 'ایمیل پشتیبانی:' : 'Support Email:'}</span>
                  <a
                    href="mailto:info@narvanteam.ir?subject=YAAD%20App%20Support"
                    className="font-mono text-indigo-400 hover:text-indigo-300 underline flex items-center gap-1"
                    dir="ltr"
                  >
                    <span>info@narvanteam.ir</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* Footer - Sticky above keyboard (دکمه تأیید همیشه پایین و ثابت، حداقل ۴۸ پیکسل) */}
        <div className="sticky bottom-0 z-20 shrink-0 px-3 sm:px-5 py-3 border-t border-stone-800 flex justify-end bg-stone-900 shadow-2xl">
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto min-h-[48px] px-8 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-black text-xs sm:text-sm shadow-md transition-all active:scale-95 cursor-pointer flex items-center justify-center gap-2"
          >
            {settings.language === 'en' ? t.confirm : 'تأیید'}
          </button>
        </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};


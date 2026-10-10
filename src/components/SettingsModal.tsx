import React, { useState, useEffect, useRef } from 'react';
import { AppSettings, AppTheme, PhoneAlarmSound, Reminder, IdeaNote, SavedLocation, Occasion } from '../types';
import { 
  X, 
  Palette, 
  Clock, 
  Cloud, 
  LogOut,
  Sliders,
  Bell,
  BarChart3,
  Sparkles,
  Type,
  Smartphone,
  CheckCircle2,
  Globe,
  Upload,
  Database,
  FileJson,
  MapPin,
  Camera,
  Mic,
  ShieldCheck,
  Check,
  AlertCircle,
  Flashlight,
  Download,
  Info,
  Volume2,
  Volume1,
  VolumeX,
  Play,
  Square,
  Music,
  Loader2
} from 'lucide-react';
import { getT } from '../utils/i18n';
import { APP_VERSION, APP_VERSION_INFO } from '../utils/version';
import { toPersianDigits } from '../utils/jalali';
import { 
  isNativeAndroidApp,
  requestNotificationPermission,
  requestMicrophonePermission,
  requestCameraPermission,
  requestLocationPermission,
  requestAllNativePermissions,
  checkAllPermissionsStatus,
  NativePermissionsStatus
} from '../utils/nativePermissions';
import { startFlashlightStrobe, stopFlashlightStrobe } from '../utils/torch';
import { PHONE_ALARM_SOUNDS, playPhoneAlarmSound, stopAlarmRinging, setGlobalVolume } from '../utils/audio';
import { syncNotificationSoundAndVolume } from '../utils/nativeLocalNotifications';
import { User } from 'firebase/auth';
import appIcon from '../assets/images/icon.png';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void;
  googleUser: User | null;
  googleToken: string | null;
  onGoogleSignIn: () => Promise<void>;
  onGoogleSignOut: () => Promise<void>;
  onOpenStats?: () => void;
  reminders?: Reminder[];
  ideas?: IdeaNote[];
  savedLocations?: SavedLocation[];
  occasions?: Occasion[];
  onRestoreData?: (data: { reminders?: Reminder[]; ideas?: IdeaNote[]; savedLocations?: SavedLocation[]; occasions?: Occasion[]; settings?: Partial<AppSettings> }, mode: 'replace' | 'merge') => void;
  onTestHeadsUpBanner?: (reminder: Reminder) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  googleUser,
  googleToken,
  onGoogleSignIn,
  onGoogleSignOut,
  onOpenStats,
  reminders = [],
  ideas = [],
  savedLocations = [],
  occasions = [],
  onRestoreData,
  onTestHeadsUpBanner,
}) => {
  const currentLanguage = settings?.language || 'fa';
  const isFa = currentLanguage === 'fa';
  const t = getT(currentLanguage);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [mapsKeyInput, setMapsKeyInput] = useState(settings?.googleMapsApiKey || '');
  const [keySavedMessage, setKeySavedMessage] = useState(false);

  // Backup & Restore state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [backupSuccessMessage, setBackupSuccessMessage] = useState<string | null>(null);
  const [backupErrorMessage, setBackupErrorMessage] = useState<string | null>(null);
  const [pendingRestoreData, setPendingRestoreData] = useState<{
    reminders?: Reminder[];
    ideas?: IdeaNote[];
    savedLocations?: SavedLocation[];
    occasions?: Occasion[];
    settings?: Partial<AppSettings>;
  } | null>(null);

  const [isTestingTorch, setIsTestingTorch] = useState<boolean>(false);
  const [playingSoundId, setPlayingSoundId] = useState<PhoneAlarmSound | null>(null);
  const soundTimeoutRef = useRef<number | null>(null);

  // Native permissions state (for Android APK / PWA)
  const [nativePerms, setNativePerms] = useState<NativePermissionsStatus>({
    notifications: false,
    microphone: false,
    camera: false,
    location: false,
  });
  const [isRequestingAllPerms, setIsRequestingAllPerms] = useState(false);

  useEffect(() => {
    if (isOpen) {
      checkAllPermissionsStatus().then(setNativePerms);
    } else {
      stopAlarmRinging();
      setPlayingSoundId(null);
      if (soundTimeoutRef.current) clearTimeout(soundTimeoutRef.current);
    }
  }, [isOpen]);

  const handleRequestPerm = async (type: 'notifications' | 'microphone' | 'camera' | 'location') => {
    if (type === 'notifications') {
      await requestNotificationPermission();
    } else if (type === 'microphone') {
      await requestMicrophonePermission();
    } else if (type === 'camera') {
      await requestCameraPermission();
    } else if (type === 'location') {
      await requestLocationPermission();
    }
    const updated = await checkAllPermissionsStatus();
    setNativePerms(updated);
  };

  const handleRequestAllPerms = async () => {
    setIsRequestingAllPerms(true);
    const updated = await requestAllNativePermissions();
    setNativePerms(updated);
    setIsRequestingAllPerms(false);
  };

  useEffect(() => {
    return () => {
      stopAlarmRinging();
      if (soundTimeoutRef.current) clearTimeout(soundTimeoutRef.current);
    };
  }, []);

  const handlePreviewSound = (soundId: PhoneAlarmSound) => {
    if (soundTimeoutRef.current) {
      clearTimeout(soundTimeoutRef.current);
      soundTimeoutRef.current = null;
    }

    if (playingSoundId === soundId) {
      stopAlarmRinging();
      setPlayingSoundId(null);
    } else {
      stopAlarmRinging();
      setPlayingSoundId(soundId);
      const currentVol = settings?.alarmVolume !== undefined ? settings.alarmVolume : 0.85;
      playPhoneAlarmSound(soundId, currentVol);
      soundTimeoutRef.current = window.setTimeout(() => {
        setPlayingSoundId(null);
      }, 1900);
    }
  };

  const handleSelectSound = (soundId: PhoneAlarmSound) => {
    onUpdateSettings({ alarmSound: soundId });
    syncNotificationSoundAndVolume(soundId, settings.alarmVolume).catch(() => {});
  };

  const handleVolumeChange = (newVolume: number) => {
    const clamped = Math.max(0.0, Math.min(1.0, newVolume));
    onUpdateSettings({ alarmVolume: clamped });
    setGlobalVolume(clamped);
    syncNotificationSoundAndVolume(settings.alarmSound || 'digital-beep', clamped).catch(() => {});
  };

  const handleTestTorch = async () => {
    setIsTestingTorch(true);
    try {
      const started = await startFlashlightStrobe();
      if (!started) {
        // If not started, try requesting permission
        console.warn('Torch could not start directly, check device permissions');
      }
      setTimeout(() => {
        stopFlashlightStrobe();
        setIsTestingTorch(false);
      }, 4000);
    } catch {
      stopFlashlightStrobe();
      setIsTestingTorch(false);
    }
  };

  const themes: { id: AppTheme; name: string; preview: string }[] = [
    { id: 'dark-gold', name: isFa ? 'مشکی طلایی' : 'Dark Gold', preview: 'bg-stone-950 border-amber-500' },
    { id: 'dark-slate', name: isFa ? 'آبی تیره' : 'Dark Slate', preview: 'bg-slate-950 border-sky-500' },
    { id: 'light-clean', name: isFa ? 'روشن مدرن' : 'Light Clean', preview: 'bg-stone-100 border-stone-400' },
    { id: 'sketch-contrast', name: isFa ? 'اسکچ خط‌چین' : 'Sketch High Contrast', preview: 'bg-black border-dashed border-white' },
  ];

  // Handle downloading JSON backup
  const handleDownloadBackup = () => {
    try {
      const backupPayload = {
        app: 'yad-reminder',
        version: 2,
        exportedAt: new Date().toISOString(),
        reminders: reminders || [],
        ideas: ideas || [],
        savedLocations: savedLocations || [],
        occasions: occasions || [],
        settings,
      };

      const dataStr = JSON.stringify(backupPayload, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const now = new Date();
      const dateTag = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      link.href = url;
      link.download = `yad-backup-${dateTag}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setBackupSuccessMessage(settings.language === 'en' ? 'Backup file downloaded successfully.' : 'فایل نسخه پشتیبان با موفقیت دانلود شد.');
      setBackupErrorMessage(null);
      setTimeout(() => setBackupSuccessMessage(null), 4000);
    } catch (err) {
      setBackupErrorMessage(settings.language === 'en' ? 'Error generating backup.' : 'خطا در تولید فایل پشتیبان.');
    }
  };

  // Handle uploading and parsing JSON backup
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const parsed = JSON.parse(text);

        // Basic verification
        if (!parsed || (typeof parsed !== 'object')) {
          throw new Error('فرمت فایل نامعتبر است.');
        }

        const validReminders = Array.isArray(parsed.reminders) ? parsed.reminders : [];
        const validIdeas = Array.isArray(parsed.ideas) ? parsed.ideas : [];
        const validLocations = Array.isArray(parsed.savedLocations) ? parsed.savedLocations : [];
        const validOccasions = Array.isArray(parsed.occasions) ? parsed.occasions : [];
        const validSettings = parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : undefined;

        if (
          validReminders.length === 0 &&
          validIdeas.length === 0 &&
          validLocations.length === 0 &&
          validOccasions.length === 0 &&
          !validSettings
        ) {
          throw new Error('در این فایل هیچ یادآور، مناسبت، ایده یا تنظیمی یافت نشد.');
        }

        setPendingRestoreData({
          reminders: validReminders,
          ideas: validIdeas,
          savedLocations: validLocations,
          occasions: validOccasions,
          settings: validSettings,
        });
        setBackupErrorMessage(null);
      } catch (err: any) {
        setBackupErrorMessage(err.message || 'خطا در خواندن فایل JSON. لطفاً از صحت فایل پشتیبان مطمئن شوید.');
        setPendingRestoreData(null);
      }
    };
    reader.onerror = () => {
      setBackupErrorMessage('خطا در بارگذاری فایل از حافظه.');
    };
    reader.readAsText(file);

    // Reset input
    if (e.target) {
      e.target.value = '';
    }
  };

  const handleConfirmRestore = (mode: 'replace' | 'merge') => {
    if (!pendingRestoreData || !onRestoreData) return;

    onRestoreData(pendingRestoreData, mode);
    setBackupSuccessMessage(
      mode === 'replace' 
        ? 'داده‌ها با موفقیت بازیابی و جایگزین شدند.' 
        : 'داده‌های فایل پشتیبان با موفقیت ادغام شدند.'
    );
    setPendingRestoreData(null);
    setTimeout(() => setBackupSuccessMessage(null), 4000);
  };

  const handleSaveMapsKey = () => {
    onUpdateSettings({ googleMapsApiKey: mapsKeyInput.trim() });
    setKeySavedMessage(true);
    setTimeout(() => setKeySavedMessage(false), 3000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div 
        id="settings-modal-panel"
        className="w-full max-w-xl bg-stone-900 border border-stone-800 rounded-3xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
      >
        {/* Header */}
        <div className="px-2.5 sm:px-5 py-3.5 border-b border-stone-800 flex items-center justify-between bg-stone-900/90">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl overflow-hidden border border-amber-500/30 flex-shrink-0 bg-stone-950 shadow-sm p-0.5">
              <img
                src={appIcon}
                alt="YAAD"
                className="w-full h-full object-cover rounded-[10px]"
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
        <div className="flex-1 overflow-y-auto px-2.5 py-4 sm:p-5 space-y-4 sm:space-y-5">
          
          {/* 0. APP LANGUAGE (فارسی / ENGLISH) */}
          <section className="space-y-3 p-3 sm:p-4 rounded-2xl bg-stone-950/70 border border-stone-800">
            <div className="flex items-center">
              <div className="flex items-center gap-2 text-sm sm:text-base font-bold text-stone-100">
                <Globe className="w-4 h-4 text-amber-400" />
                <span>زبان برنامه / App Language</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:gap-3">
              <button
                type="button"
                onClick={() => onUpdateSettings({ language: 'fa' })}
                className={`p-3 rounded-xl border text-center transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 text-white ${
                  (settings.language || 'fa') === 'fa'
                    ? 'border-amber-500 bg-amber-500/15 ring-1 ring-amber-500/30 shadow-md shadow-amber-500/10'
                    : 'border-stone-800 bg-stone-900/60 hover:text-white hover:bg-stone-900'
                }`}
              >
                <span className="font-bold text-xs sm:text-sm text-white">فارسی (Persian)</span>
                {(settings.language || 'fa') === 'fa' && <CheckCircle2 className="w-4 h-4 text-amber-400" />}
              </button>

              <button
                type="button"
                onClick={() => onUpdateSettings({ language: 'en' })}
                className={`p-3 rounded-xl border text-center transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 text-white ${
                  settings.language === 'en'
                    ? 'border-amber-500 bg-amber-500/15 ring-1 ring-amber-500/30 shadow-md shadow-amber-500/10'
                    : 'border-stone-800 bg-stone-900/60 hover:text-white hover:bg-stone-900'
                }`}
              >
                <span className="font-bold text-xs sm:text-sm text-white">English (انگلیسی)</span>
                {settings.language === 'en' && <CheckCircle2 className="w-4 h-4 text-amber-400" />}
              </button>
            </div>
          </section>

          {/* 2. FONT SIZE SLIDER */}
          <section className="space-y-3 p-3 sm:p-4 rounded-2xl bg-stone-950/70 border border-stone-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold text-stone-100">
                <Type className="w-4 h-4 text-amber-400" />
                <span>{isFa ? 'اندازه فونت' : 'Font Size'}</span>
              </div>
              <span className="font-mono text-xs text-amber-300 font-black bg-stone-900 px-2 py-0.5 rounded-lg border border-amber-500/30">
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
                onChange={(e) => onUpdateSettings({ fontSize: parseInt(e.target.value, 10) })}
                className="w-full accent-teal-500 h-2 bg-stone-800 rounded-lg cursor-pointer"
              />
              <span className="text-base font-black text-white">{isFa ? 'الف' : 'A'}</span>
            </div>
          </section>

          {/* 3. PERMISSIONS HUB (مدیریت دسترسی‌های میکروفون، دوربین و GPS برای تایپ صوتی و پیوست‌ها) */}
          <section className="space-y-3 pt-3 border-t border-stone-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm sm:text-base font-bold text-sky-400">
                <ShieldCheck className="w-4 h-4 text-sky-400" />
                <span>{isFa ? 'مدیریت دسترسی‌های برنامه (Permissions Hub)' : 'App Permissions Hub'}</span>
              </div>
              {isNativeAndroidApp() && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  Android APK
                </span>
              )}
            </div>

            <p className="text-[11px] text-stone-400 leading-relaxed">
              {isFa
                ? 'برای کارکرد صحیح اعلان یادآورها در پس‌زمینه و هنگام بسته بودن برنامه، تبدیل گفتار به متن (تایپ صوتی)، عکاسی و ثبت لوکیشن، دسترسی‌های زیر را فعال کنید:'
                : 'Grant permissions for out-of-app reminder notifications, voice typing, camera, and GPS location:'}
            </p>

            {/* Request All Permissions at Once */}
            <button
              type="button"
              disabled={isRequestingAllPerms}
              onClick={handleRequestAllPerms}
              className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white text-xs font-black transition-all shadow-md shadow-sky-950/40 active:scale-95 cursor-pointer flex items-center justify-center gap-2"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>
                {isRequestingAllPerms
                  ? (isFa ? 'در حال ثبت درخواست‌ها...' : 'Requesting permissions...')
                  : (isFa ? 'درخواست یکجای تمامی دسترسی‌های لازم اندروید' : 'Grant All Required Android Permissions')}
              </span>
            </button>

            {/* Individual Permissions Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              {/* 1. Notification (Local Notifications) */}
              <div className="p-3 rounded-xl bg-stone-950/70 border border-stone-800 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="p-1.5 rounded-lg bg-indigo-500/15 text-indigo-400">
                    <Bell className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-stone-200 truncate">
                      {isFa ? 'اعلان‌ها و آلارم اندروید' : 'Android Notifications'}
                    </p>
                    <span className={`text-[10px] font-bold ${nativePerms.notifications ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {nativePerms.notifications ? (isFa ? 'تایید شده ✓' : 'Granted ✓') : (isFa ? 'نیاز به تایید' : 'Not Granted')}
                    </span>
                  </div>
                </div>
                {!nativePerms.notifications && (
                  <button
                    type="button"
                    onClick={() => handleRequestPerm('notifications')}
                    className="px-2.5 py-1 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-300 hover:text-white text-[11px] font-bold cursor-pointer"
                  >
                    {isFa ? 'تایید' : 'Allow'}
                  </button>
                )}
              </div>

              {/* 2. Microphone & Voice Typing */}
              <div className="p-3 rounded-xl bg-stone-950/70 border border-stone-800 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="p-1.5 rounded-lg bg-amber-500/15 text-amber-400">
                    <Mic className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-stone-200 truncate">
                      {isFa ? 'میکروفون و تایپ صوتی' : 'Microphone (Voice)'}
                    </p>
                    <span className={`text-[10px] font-bold ${nativePerms.microphone ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {nativePerms.microphone ? (isFa ? 'تایید شده ✓' : 'Granted ✓') : (isFa ? 'نیاز به تایید' : 'Not Granted')}
                    </span>
                  </div>
                </div>
                {!nativePerms.microphone && (
                  <button
                    type="button"
                    onClick={() => handleRequestPerm('microphone')}
                    className="px-2.5 py-1 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-300 hover:text-white text-[11px] font-bold cursor-pointer"
                  >
                    {isFa ? 'تایید' : 'Allow'}
                  </button>
                )}
              </div>

              {/* 3. Camera */}
              <div className="p-3 rounded-xl bg-stone-950/70 border border-stone-800 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="p-1.5 rounded-lg bg-rose-500/15 text-rose-400">
                    <Camera className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-stone-200 truncate">
                      {isFa ? 'دوربین و عکس پیوست' : 'Camera Capture'}
                    </p>
                    <span className={`text-[10px] font-bold ${nativePerms.camera ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {nativePerms.camera ? (isFa ? 'تایید شده ✓' : 'Granted ✓') : (isFa ? 'نیاز به تایید' : 'Not Granted')}
                    </span>
                  </div>
                </div>
                {!nativePerms.camera && (
                  <button
                    type="button"
                    onClick={() => handleRequestPerm('camera')}
                    className="px-2.5 py-1 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-300 hover:text-white text-[11px] font-bold cursor-pointer"
                  >
                    {isFa ? 'تایید' : 'Allow'}
                  </button>
                )}
              </div>

              {/* 4. GPS / Geolocation */}
              <div className="p-3 rounded-xl bg-stone-950/70 border border-stone-800 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="p-1.5 rounded-lg bg-emerald-500/15 text-emerald-400">
                    <MapPin className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-stone-200 truncate">
                      {isFa ? 'موقعیت مکانی و GPS' : 'GPS Location'}
                    </p>
                    <span className={`text-[10px] font-bold ${nativePerms.location ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {nativePerms.location ? (isFa ? 'تایید شده ✓' : 'Granted ✓') : (isFa ? 'نیاز به تایید' : 'Not Granted')}
                    </span>
                  </div>
                </div>
                {!nativePerms.location && (
                  <button
                    type="button"
                    onClick={() => handleRequestPerm('location')}
                    className="px-2.5 py-1 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-300 hover:text-white text-[11px] font-bold cursor-pointer"
                  >
                    {isFa ? 'تایید' : 'Allow'}
                  </button>
                )}
              </div>
            </div>
          </section>

          {/* 3.5. ALARM SOUND TYPE & VOLUME CONFIGURATION */}
          <section className="space-y-4 pt-3 border-t border-stone-800">
            <div className="flex items-center">
              <div className="flex items-center gap-2 text-sm sm:text-base font-bold text-amber-300">
                <Volume2 className="w-4 h-4 text-amber-400" />
                <span>{isFa ? 'تنظیمات نوع صدای آلارم و ولوم' : 'Alarm Sound & Volume Settings'}</span>
              </div>
            </div>

            {/* A. Volume Slider and Presets */}
            <div className="p-3.5 sm:p-4 rounded-2xl bg-stone-950/80 border border-stone-800 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs sm:text-sm font-bold text-stone-200">
                  {((settings.alarmVolume ?? 0.85) <= 0.01) ? (
                    <VolumeX className="w-4 h-4 text-stone-500" />
                  ) : ((settings.alarmVolume ?? 0.85) < 0.5) ? (
                    <Volume1 className="w-4 h-4 text-amber-400" />
                  ) : (
                    <Volume2 className="w-4 h-4 text-amber-400" />
                  )}
                  <span>{isFa ? 'میزان بلندی صدا (ولوم)' : 'Alarm Volume'}</span>
                </div>
                <span className="font-mono text-xs font-black text-amber-300 bg-stone-900 px-2.5 py-0.5 rounded-lg border border-amber-500/30">
                  {isFa ? `${toPersianDigits(Math.round((settings.alarmVolume ?? 0.85) * 100))}٪` : `${Math.round((settings.alarmVolume ?? 0.85) * 100)}%`}
                </span>
              </div>

              {/* Slider */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => handleVolumeChange(0)}
                  title={isFa ? 'بی‌صدا' : 'Mute'}
                  className="p-1 rounded hover:bg-stone-800 transition-colors"
                >
                  <VolumeX 
                    className={`w-4 h-4 transition-colors ${
                      (settings.alarmVolume ?? 0.85) <= 0.01 ? 'text-amber-400' : 'text-stone-500 hover:text-stone-300'
                    }`} 
                  />
                </button>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={Math.round((settings.alarmVolume ?? 0.85) * 100)}
                  onChange={(e) => handleVolumeChange(parseInt(e.target.value, 10) / 100)}
                  className="w-full accent-amber-500 h-2.5 bg-stone-800 rounded-lg cursor-pointer"
                />
                <button
                  type="button"
                  onClick={() => handleVolumeChange(1.0)}
                  title={isFa ? 'حداکثر صدا' : 'Max Volume'}
                  className="p-1 rounded hover:bg-stone-800 transition-colors"
                >
                  <Volume2 
                    className={`w-4 h-4 transition-colors ${
                      (settings.alarmVolume ?? 0.85) >= 0.95 ? 'text-amber-400' : 'text-stone-500 hover:text-stone-300'
                    }`} 
                  />
                </button>
              </div>

              {/* Quick Volume Preset Chips */}
              <div className="flex items-center gap-1.5 flex-wrap pt-1">
                {[
                  { label: isFa ? 'بی‌صدا (۰٪)' : 'Mute (0%)', val: 0 },
                  { label: isFa ? 'آرام (۳۰٪)' : 'Low (30%)', val: 0.3 },
                  { label: isFa ? 'متوسط (۶۰٪)' : 'Medium (60%)', val: 0.6 },
                  { label: isFa ? 'بلند (۸۵٪)' : 'High (85%)', val: 0.85 },
                  { label: isFa ? 'حداکثر (۱۰۰٪)' : 'Max (100%)', val: 1.0 },
                ].map((chip) => {
                  const isActive = Math.abs((settings.alarmVolume ?? 0.85) - chip.val) < 0.05;
                  return (
                    <button
                      key={chip.val}
                      type="button"
                      onClick={() => handleVolumeChange(chip.val)}
                      className={`text-[11px] px-2.5 py-1 rounded-lg border font-bold transition-all cursor-pointer active:scale-95 ${
                        isActive
                          ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow-sm'
                          : 'bg-stone-900 border-stone-800 text-stone-400 hover:text-stone-200 hover:border-stone-700'
                      }`}
                    >
                      {chip.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* B. Alarm Sound Selection */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-stone-200">
                  {isFa ? 'انتخاب ملودی و نوع صدای آلارم:' : 'Select Alarm Tone:'}
                </span>
                <span className="text-[11px] text-stone-400">
                  {isFa ? 'برای شنیدن روی دکمه پخش کلیک کنید' : 'Click play to preview tone'}
                </span>
              </div>

              <div className="space-y-2">
                {PHONE_ALARM_SOUNDS.map((soundItem) => {
                  const isSelected = (settings.alarmSound || 'digital-beep') === soundItem.id;
                  const isPlaying = playingSoundId === soundItem.id;

                  return (
                    <div
                      key={soundItem.id}
                      onClick={() => handleSelectSound(soundItem.id)}
                      className={`p-3 rounded-2xl border transition-all flex items-center justify-between gap-3 cursor-pointer ${
                        isSelected
                          ? 'border-amber-500 bg-amber-500/10 ring-1 ring-amber-500/40 shadow-md shadow-amber-500/10'
                          : 'border-stone-800/90 bg-stone-950/60 hover:border-stone-700 hover:bg-stone-900/50'
                      }`}
                    >
                      {/* Radio & Title */}
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className={`w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0 transition-colors ${
                          isSelected ? 'border-amber-500 bg-amber-500' : 'border-stone-600 bg-transparent'
                        }`}>
                          {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-stone-950" />}
                        </div>

                        <div className="min-w-0">
                          <p className={`text-xs sm:text-sm font-bold truncate ${isSelected ? 'text-amber-300' : 'text-stone-200'}`}>
                            {soundItem.label}
                          </p>
                          <p className="text-[11px] text-stone-400 truncate">
                            {soundItem.desc}
                          </p>
                        </div>
                      </div>

                      {/* Interactive Preview Button */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectSound(soundItem.id);
                          handlePreviewSound(soundItem.id);
                        }}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer active:scale-95 flex-shrink-0 ${
                          isPlaying
                            ? 'bg-amber-500 text-stone-950 shadow-md shadow-amber-500/30 font-black animate-pulse'
                            : isSelected
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30'
                            : 'bg-stone-900 text-stone-300 border border-stone-700/80 hover:bg-stone-800 hover:text-white'
                        }`}
                        title={isPlaying ? (isFa ? 'توقف پخش' : 'Stop') : (isFa ? 'پخش نمونه صدا' : 'Play preview')}
                      >
                        {isPlaying ? (
                          <>
                            <Square className="w-3 h-3 fill-current" />
                            <span>{isFa ? 'توقف' : 'Stop'}</span>
                          </>
                        ) : (
                          <>
                            <Play className="w-3 h-3 fill-current text-amber-400" />
                            <span>{isFa ? 'پخش تست' : 'Preview'}</span>
                          </>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          {/* 4. THEME SELECTION */}
          <section className="space-y-2.5 pt-2 border-t border-stone-800">
            <div className="flex items-center gap-2 text-sm font-bold text-stone-200">
              <Palette className="w-4 h-4 text-amber-400" />
              <span>{isFa ? 'پوسته‌ها و قالب ظاهری' : 'Appearance Themes'}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {themes.map((themeItem) => {
                const isSelected = settings.theme === themeItem.id;
                return (
                  <button
                    key={themeItem.id}
                    type="button"
                    onClick={() => onUpdateSettings({ theme: themeItem.id })}
                    className={`p-3 rounded-xl border text-center transition-all flex flex-col items-center gap-2 cursor-pointer active:scale-95 ${
                      isSelected
                        ? 'border-amber-500 bg-amber-500/10 ring-1 ring-amber-500/30'
                        : 'border-stone-800 bg-stone-950/60 hover:border-stone-700'
                    }`}
                  >
                    <span className={`w-5 h-5 rounded-full border ${themeItem.preview}`} />
                    <span className="font-bold text-xs text-white">{themeItem.name}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* 5. TIMELINE STYLE (MODERN vs SKETCH) */}
          <section className="space-y-2.5 pt-2 border-t border-stone-800">
            <div className="flex items-center gap-2 text-sm font-bold text-stone-200">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span>{isFa ? 'سبک نمایش تایم‌لاین' : 'Timeline Display Style'}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onUpdateSettings({ timelineMode: 'modern' })}
                className={`p-3 rounded-xl border text-center cursor-pointer active:scale-95 transition-all ${
                  (settings.timelineMode || 'modern') === 'modern'
                    ? 'border-amber-500 bg-amber-500/15 text-white ring-1 ring-amber-500/30'
                    : 'border-stone-800 bg-stone-950/60 text-stone-400 hover:border-stone-700'
                }`}
              >
                <div className="font-black text-xs sm:text-sm text-amber-300">{isFa ? 'مدرن طلایی' : 'Modern Gold'}</div>
              </button>
              <button
                type="button"
                onClick={() => onUpdateSettings({ timelineMode: 'sketch' })}
                className={`p-3 rounded-xl border text-center cursor-pointer active:scale-95 transition-all ${
                  settings.timelineMode === 'sketch'
                    ? 'border-white bg-white/15 text-white ring-1 ring-white/40'
                    : 'border-stone-800 bg-stone-950/60 text-stone-400 hover:border-stone-700'
                }`}
              >
                <div className="font-black text-xs sm:text-sm text-white font-mono">{isFa ? 'اسکچ خط‌چین' : 'Sketch Border'}</div>
              </button>
            </div>
          </section>

          {/* 6. GOOGLE WORKSPACE SYNC */}
          <section className="space-y-2.5 pt-2 border-t border-stone-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold text-stone-200">
                <Cloud className="w-4 h-4 text-sky-400" />
                <span>{isFa ? 'همگام‌سازی گوگل (Calendar & Tasks)' : 'Google Workspace Sync (Calendar & Tasks)'}</span>
              </div>
              {googleUser && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-bold">
                  {isFa ? 'متصل' : 'Connected'}
                </span>
              )}
            </div>

            <div className="p-3 rounded-xl bg-stone-950 border border-stone-800 flex items-center justify-between gap-3">
              <div className="truncate">
                {googleUser ? (
                  <p className="text-xs font-semibold text-white truncate">{googleUser.email}</p>
                ) : (
                  <p className="text-xs text-stone-400">{isFa ? 'اتصال به تقویم و تسک‌های گوگل' : 'Connect to Google Calendar & Tasks'}</p>
                )}
              </div>

              {googleUser ? (
                <button
                  type="button"
                  onClick={onGoogleSignOut}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-700 hover:bg-rose-600 text-white text-xs font-bold cursor-pointer active:scale-95 shadow-sm"
                >
                  <LogOut className="w-3.5 h-3.5 text-white" />
                  <span className="text-white">{isFa ? 'خروج' : 'Sign Out'}</span>
                </button>
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
                  className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-md shadow-blue-600/30 disabled:opacity-50"
                >
                  <span>{isSigningIn ? (settings.language === 'en' ? 'Connecting...' : 'اتصال...') : (settings.language === 'en' ? 'Sign in with Google' : 'ورود با گوگل')}</span>
                </button>
              )}
            </div>
          </section>

          {/* 6. GENERAL PREFERENCES */}
          <section className="space-y-2 pt-2 border-t border-stone-800">
            <div className="flex items-center gap-2 text-sm font-bold text-stone-200">
              <Sliders className="w-4 h-4 text-amber-400" />
              <span>{settings.language === 'en' ? 'General Preferences' : 'سایر گزینه‌ها'}</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="flex items-center justify-between p-2.5 rounded-xl bg-stone-950 border border-stone-800 cursor-pointer self-start">
                <span className="text-xs font-bold text-white block">
                  {isFa ? 'فلاش چراغ دوربین پشت گوشی' : 'Camera LED Flashlight'}
                </span>
                <input
                  type="checkbox"
                  checked={settings.enableFlash}
                  onChange={(e) => onUpdateSettings({ enableFlash: e.target.checked })}
                  className="w-4 h-4 rounded accent-amber-500"
                />
              </label>

              <label className="flex items-center justify-between p-2.5 rounded-xl bg-stone-950 border border-stone-800 cursor-pointer self-start">
                <span className="text-xs font-bold text-white">{settings.language === 'en' ? t.autoMicInput : 'میکروفون خودکار فرم'}</span>
                <input
                  type="checkbox"
                  checked={settings.autoVoiceInput}
                  onChange={(e) => onUpdateSettings({ autoVoiceInput: e.target.checked })}
                  className="w-4 h-4 rounded accent-amber-500"
                />
              </label>
            </div>
          </section>

          {/* 7. PERFORMANCE STATISTICS (MOVED TO SETTINGS) */}
          {onOpenStats && (
            <section className="space-y-2 pt-2 border-t border-stone-800">
              <div className="flex items-center justify-between p-3.5 rounded-2xl bg-stone-950/80 border border-stone-800 hover:border-amber-500/40 transition-all">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center flex-shrink-0">
                    <BarChart3 className="w-5 h-5" />
                  </div>
                  <h5 className="text-xs sm:text-sm font-black text-white">{settings.language === 'en' ? t.statsTitle : 'آمار و گزارش عملکرد'}</h5>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenStats();
                  }}
                  className="px-3.5 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-black text-xs shadow-sm active:scale-95 transition-all cursor-pointer whitespace-nowrap"
                >
                  {settings.language === 'en' ? t.viewStats : 'مشاهده آمار'}
                </button>
              </div>
            </section>
          )}

          {/* 8. LOCAL BACKUP & RESTORE */}
          <section className="space-y-3 pt-3 border-t border-stone-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm sm:text-base font-bold text-stone-100">
                <Database className="w-4 h-4 text-emerald-400" />
                <span>{isFa ? 'پشتیبان‌گیری محلی (دانلود و بازیابی JSON)' : 'Local Backup & Restore (JSON)'}</span>
              </div>
              <span className="text-[11px] px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 font-medium">
                {isFa ? 'ذخیره آفلاین' : 'Offline Save'}
              </span>
            </div>

            <p className="text-xs text-stone-400 leading-relaxed">
              {isFa 
                ? 'شما می‌توانید تمام یادآورها، ایده‌ها، لوکیشن‌های ثبت‌شده و تنظیمات برنامه را به صورت فایل JSON در حافظه دستگاه خود ذخیره کرده یا از فایل قبلی بازیابی نمایید.'
                : 'Export all reminders, ideas, GPS places and settings to a JSON backup file or restore from a previously exported file.'}
            </p>

            {/* Current items badge counters */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
              <div className="p-2 rounded-xl bg-stone-950 border border-stone-800/80">
                <span className="text-[10px] text-stone-500 block">{isFa ? 'یادآورها' : 'Reminders'}</span>
                <span className="font-bold text-amber-400 text-sm">{isFa ? toPersianDigits(reminders.length) : reminders.length}</span>
              </div>
              <div className="p-2 rounded-xl bg-stone-950 border border-stone-800/80">
                <span className="text-[10px] text-stone-500 block">{isFa ? 'مناسبت‌ها' : 'Occasions'}</span>
                <span className="font-bold text-pink-400 text-sm">{isFa ? toPersianDigits(occasions.length) : occasions.length}</span>
              </div>
              <div className="p-2 rounded-xl bg-stone-950 border border-stone-800/80">
                <span className="text-[10px] text-stone-500 block">{isFa ? 'ایده‌ها' : 'Ideas'}</span>
                <span className="font-bold text-sky-400 text-sm">{isFa ? toPersianDigits(ideas.length) : ideas.length}</span>
              </div>
              <div className="p-2 rounded-xl bg-stone-950 border border-stone-800/80">
                <span className="text-[10px] text-stone-500 block">{isFa ? 'مکان‌های GPS' : 'GPS Places'}</span>
                <span className="font-bold text-emerald-400 text-sm">{isFa ? toPersianDigits(savedLocations.length) : savedLocations.length}</span>
              </div>
            </div>

            {/* Success / Error alerts */}
            {backupSuccessMessage && (
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2 animate-in fade-in">
                <Check className="w-4 h-4 flex-shrink-0 text-emerald-400" />
                <span>{backupSuccessMessage}</span>
              </div>
            )}

            {backupErrorMessage && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2 animate-in fade-in">
                <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-400" />
                <span>{backupErrorMessage}</span>
              </div>
            )}

            {/* Download & Upload Buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={handleDownloadBackup}
                className="flex items-center justify-center gap-2 p-3 rounded-xl bg-stone-950 hover:bg-stone-800 border border-stone-700/80 text-white font-bold text-xs shadow-sm hover:border-emerald-500/50 transition-all cursor-pointer active:scale-95"
              >
                <Download className="w-4 h-4 text-emerald-400" />
                <span>{isFa ? 'دانلود فایل پشتیبان (JSON)' : 'Download Backup (JSON)'}</span>
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center justify-center gap-2 p-3 rounded-xl bg-stone-950 hover:bg-stone-800 border border-stone-700/80 text-white font-bold text-xs shadow-sm hover:border-sky-500/50 transition-all cursor-pointer active:scale-95"
              >
                <Upload className="w-4 h-4 text-sky-400" />
                <span>{isFa ? 'بازیابی از فایل JSON' : 'Restore from JSON File'}</span>
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleFileChange}
                className="hidden"
              />
            </div>

            {/* Pending Restore Confirmation Box */}
            {pendingRestoreData && (
              <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 space-y-3 animate-in fade-in">
                <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
                  <FileJson className="w-4 h-4" />
                  <span>{isFa ? 'فایل پشتیبان با موفقیت شناسایی شد:' : 'Backup file successfully parsed:'}</span>
                </div>

                <div className="text-xs text-stone-300 space-y-1 pr-2">
                  <p>• {isFa ? 'تعداد یادآورها:' : 'Reminders count:'} <strong className="text-white">{isFa ? toPersianDigits(pendingRestoreData.reminders?.length || 0) : (pendingRestoreData.reminders?.length || 0)}</strong></p>
                  <p>• {isFa ? 'تعداد مناسبت‌ها:' : 'Occasions count:'} <strong className="text-white">{isFa ? toPersianDigits(pendingRestoreData.occasions?.length || 0) : (pendingRestoreData.occasions?.length || 0)}</strong></p>
                  <p>• {isFa ? 'تعداد ایده‌ها:' : 'Ideas count:'} <strong className="text-white">{isFa ? toPersianDigits(pendingRestoreData.ideas?.length || 0) : (pendingRestoreData.ideas?.length || 0)}</strong></p>
                  <p>• {isFa ? 'تعداد مکان‌های GPS:' : 'GPS Places count:'} <strong className="text-white">{isFa ? toPersianDigits(pendingRestoreData.savedLocations?.length || 0) : (pendingRestoreData.savedLocations?.length || 0)}</strong></p>
                  {pendingRestoreData.settings && <p>• {isFa ? 'حاوی تنظیمات اختصاصی سفارشی' : 'Contains custom settings'}</p>}
                </div>

                <p className="text-[11px] text-amber-200/80">
                  {isFa ? 'نحوه بازیابی را مشخص کنید:' : 'Choose how to restore your data:'}
                </p>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleConfirmRestore('replace')}
                    className="flex-1 py-2 px-3 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs transition-colors cursor-pointer active:scale-95"
                  >
                    {isFa ? 'جایگزینی داده‌ها (Overwrite)' : 'Overwrite Data'}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleConfirmRestore('merge')}
                    className="flex-1 py-2 px-3 rounded-xl bg-stone-800 hover:bg-stone-700 text-white font-bold text-xs transition-colors cursor-pointer active:scale-95 border border-stone-700"
                  >
                    {isFa ? 'افزودن و ادغام (Merge)' : 'Merge Data'}
                  </button>

                  <button
                    type="button"
                    onClick={() => setPendingRestoreData(null)}
                    className="py-2 px-3 rounded-xl bg-stone-900 hover:bg-stone-800 text-white font-bold text-xs cursor-pointer active:scale-95 border border-stone-800"
                  >
                    {isFa ? 'انصراف' : 'Cancel'}
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* 9. GOOGLE MAPS API SETTINGS */}
          <section className="space-y-3 pt-3 border-t border-stone-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm sm:text-base font-bold text-stone-100">
                <MapPin className="w-4 h-4 text-emerald-400" />
                <span>{settings.language === 'en' ? t.mapsServiceTitle : 'تنظیمات خدمات Google Maps'}</span>
              </div>
              <span className="text-[10px] text-stone-400">{settings.language === 'en' ? 'Optional' : 'اختیاری'}</span>
            </div>

            <p className="text-xs text-stone-400">
              {settings.language === 'en' ? t.mapsKeyLabel : 'کلید اختصاصی Google Maps (پیش‌فرض سرویس استاندارد فعال است):'}
            </p>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={mapsKeyInput}
                onChange={(e) => setMapsKeyInput(e.target.value)}
                placeholder="Google Maps API Key"
                className="flex-1 px-3.5 py-2.5 rounded-xl bg-stone-950 border border-stone-800 text-white placeholder-stone-600 text-xs font-mono focus:outline-none focus:border-emerald-500/70"
              />
              <button
                type="button"
                onClick={handleSaveMapsKey}
                className="px-3.5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1 active:scale-95 transition-all"
              >
                {keySavedMessage ? <Check className="w-4 h-4 text-white" /> : null}
                <span>{keySavedMessage ? (settings.language === 'en' ? t.saved : 'ذخیره شد') : (settings.language === 'en' ? t.save : 'ذخیره')}</span>
              </button>
            </div>
          </section>

          {/* 10. APP SPECIFICATIONS & VERSION (مشخصات اپلیکیشن) */}
          <section className="space-y-3 pt-3 border-t border-stone-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm sm:text-base font-bold text-stone-100">
                <Info className="w-4 h-4 text-amber-400" />
                <span>{isFa ? 'مشخصات و نسخه اپلیکیشن' : 'App Specifications & Version'}</span>
              </div>
              <span className="px-2.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 font-mono text-xs font-bold">
                v{APP_VERSION}
              </span>
            </div>

            <div className="p-3.5 rounded-2xl bg-stone-950 border border-stone-800 space-y-2.5 text-xs">
              <div className="flex items-center justify-between border-b border-stone-800/80 pb-2">
                <span className="text-stone-400">{isFa ? 'نام برنامه' : 'App Name'}</span>
                <div className="flex items-center gap-2">
                  <img src={appIcon} alt="YAAD" className="w-4.5 h-4.5 rounded-md object-cover" />
                  <span className="font-bold text-white">{APP_VERSION_INFO.name}</span>
                </div>
              </div>
              <div className="flex items-center justify-between border-b border-stone-800/80 pb-2">
                <span className="text-stone-400">{isFa ? 'نسخه فعلی' : 'Current Version'}</span>
                <span className="font-mono font-bold text-amber-400">{isFa ? `نسخه ${toPersianDigits(APP_VERSION)}` : `Version ${APP_VERSION}`}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-stone-400">{isFa ? 'نوع پلتفرم' : 'Platform Type'}</span>
                <span className="text-stone-200">{isFa ? 'اپلیکیشن تحت وب پیشرونده (PWA)' : 'Progressive Web App (PWA)'}</span>
              </div>
            </div>
          </section>

        </div>

        {/* Footer - Sticky above keyboard */}
        <div className="sticky bottom-0 z-20 shrink-0 px-3 sm:px-5 py-3 border-t border-stone-800 flex justify-end bg-stone-900/95 backdrop-blur shadow-2xl">
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 font-black text-xs sm:text-sm shadow-md transition-all active:scale-95 cursor-pointer"
          >
            {settings.language === 'en' ? t.confirm : 'تأیید'}
          </button>
        </div>
      </div>
    </div>
  );
};

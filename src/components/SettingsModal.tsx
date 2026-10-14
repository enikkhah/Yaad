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
  Loader2,
  Navigation,
  Crosshair,
  Radio,
  Compass,
  ChevronDown,
  ChevronUp,
  Sun,
  Moon
} from 'lucide-react';
import { getT } from '../utils/i18n';
import { APP_VERSION, APP_VERSION_INFO } from '../utils/version';
import { toPersianDigits } from '../utils/jalali';
import { 
  isGeofenceTrackingEnabled, 
  setGeofenceTrackingEnabled, 
  getLastKnownPosition,
  UserPosition
} from '../utils/geofenceManager';
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
  isGeofenceActive?: boolean;
  onToggleGeofenceActive?: (active: boolean) => void;
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
  isGeofenceActive = true,
  onToggleGeofenceActive,
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

  // 5 Collapsible groups state: ظاهر، صدا، دسترسی‌ها، همگام‌سازی، پشتیبان
  const [openSections, setOpenSections] = useState<{
    appearance: boolean;
    sound: boolean;
    permissions: boolean;
    sync: boolean;
    backup: boolean;
  }>({
    appearance: true,
    sound: false,
    permissions: false,
    sync: false,
    backup: false,
  });

  const toggleSection = (section: keyof typeof openSections) => {
    setOpenSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

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
    { id: 'system', name: isFa ? 'خودکار (پیروی از گوشی)' : 'System (Auto)', preview: 'bg-gradient-to-r from-stone-900 to-stone-200 border-amber-400' },
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
        <div className="flex-1 overflow-y-auto px-2.5 py-4 sm:p-5 space-y-3.5">
          
          {/* ========================================================= */}
          {/* 1. APPEARANCE & THEMES (ظاهر و پوسته‌ها) */}
          {/* ========================================================= */}
          <div className="rounded-2xl border border-stone-800 bg-stone-950/60 overflow-hidden transition-all shadow-sm">
            <button
              type="button"
              onClick={() => toggleSection('appearance')}
              className="w-full min-h-[48px] p-3.5 sm:p-4 bg-stone-900/60 hover:bg-stone-900 border-b border-stone-800/80 flex items-center justify-between gap-3 transition-colors cursor-pointer text-start"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                  <Palette className="w-4.5 h-4.5" />
                </div>
                <div className="min-w-0">
                  <h4 className="text-xs sm:text-sm font-black text-white truncate">
                    {isFa ? '۱. ظاهر و تم برنامه' : '1. Appearance & Theme'}
                  </h4>
                  <p className="text-[11px] text-stone-400 truncate">
                    {isFa
                      ? `پوسته: ${themes.find((th) => th.id === settings.theme)?.name || 'پیش‌فرض'} • اندازه فونت • زبان`
                      : `Theme: ${settings.theme} • Font Size • Language`}
                  </p>
                </div>
              </div>
              <ChevronDown className={`w-4 h-4 text-stone-400 transition-transform duration-200 shrink-0 ${openSections.appearance ? 'rotate-180 text-amber-400' : ''}`} />
            </button>

            {openSections.appearance && (
              <div className="p-3 sm:p-4 space-y-4 animate-in fade-in">
                {/* 1.1 Phone System Theme Toggle (انتقال‌یافته از هدر به داخل تنظیمات) */}
                <div className="p-3 sm:p-3.5 rounded-2xl bg-stone-900/90 border border-amber-500/30 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                      <Smartphone className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <h5 className="text-xs sm:text-sm font-bold text-white truncate">
                        {isFa ? 'هماهنگی خودکار با تم گوشی' : 'Follow Phone Theme'}
                      </h5>
                      <p className="text-[11px] text-stone-400 truncate">
                        {settings.theme === 'system'
                          ? (isFa ? 'فعال (تاریک/روشن خودکار متناسب با گوشی)' : 'Active (Matches phone dark/light)')
                          : (isFa ? 'پوسته دستی انتخاب شده است' : 'Custom theme selected')}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const nextTheme: AppTheme = settings.theme === 'system' ? 'dark-gold' : 'system';
                      onUpdateSettings({ theme: nextTheme });
                    }}
                    className={`min-h-[48px] px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer active:scale-95 flex items-center gap-1.5 shrink-0 ${
                      settings.theme === 'system'
                        ? 'bg-amber-500 text-stone-950 font-black shadow-md shadow-amber-500/20'
                        : 'bg-stone-800 hover:bg-stone-700 text-stone-200 border border-stone-700'
                    }`}
                  >
                    <Smartphone className="w-4 h-4" />
                    <span>{settings.theme === 'system' ? (isFa ? 'فعال ✓' : 'Active ✓') : (isFa ? 'فعال‌سازی' : 'Enable')}</span>
                  </button>
                </div>

                {/* 1.2 Theme Selection Cards */}
                <div className="space-y-2">
                  <span className="text-xs font-bold text-stone-300 block">
                    {isFa ? 'انتخاب قالب ظاهری:' : 'Select Theme:'}
                  </span>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                    {themes.map((themeItem) => {
                      const isSelected = settings.theme === themeItem.id;
                      return (
                        <button
                          key={themeItem.id}
                          type="button"
                          onClick={() => onUpdateSettings({ theme: themeItem.id })}
                          className={`min-h-[50px] p-2.5 rounded-2xl border text-center transition-all duration-200 flex flex-col items-center justify-center gap-1.5 cursor-pointer active:scale-95 ${
                            isSelected
                              ? 'border-amber-400 bg-amber-500/15 ring-2 ring-amber-400/30'
                              : 'border-stone-800 bg-stone-950/60 hover:border-stone-700'
                          }`}
                        >
                          <span className={`w-4 h-4 rounded-full border ${themeItem.preview}`} />
                          <span className="font-bold text-[11px] text-white truncate max-w-full">{themeItem.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 1.3 App Language */}
                <div className="space-y-2 pt-2 border-t border-stone-800/80">
                  <div className="flex items-center gap-2 text-xs font-bold text-stone-300">
                    <Globe className="w-3.5 h-3.5 text-amber-400" />
                    <span>{isFa ? 'زبان برنامه (App Language)' : 'Language'}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => onUpdateSettings({ language: 'fa' })}
                      className={`min-h-[48px] p-2.5 rounded-xl border text-center transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 text-white ${
                        (settings.language || 'fa') === 'fa'
                          ? 'border-amber-500 bg-amber-500/15 ring-1 ring-amber-500/30 font-bold'
                          : 'border-stone-800 bg-stone-900/60 hover:bg-stone-900'
                      }`}
                    >
                      <span className="text-xs font-bold">فارسی (Persian)</span>
                      {(settings.language || 'fa') === 'fa' && <CheckCircle2 className="w-4 h-4 text-amber-400" />}
                    </button>

                    <button
                      type="button"
                      onClick={() => onUpdateSettings({ language: 'en' })}
                      className={`min-h-[48px] p-2.5 rounded-xl border text-center transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 text-white ${
                        settings.language === 'en'
                          ? 'border-amber-500 bg-amber-500/15 ring-1 ring-amber-500/30 font-bold'
                          : 'border-stone-800 bg-stone-900/60 hover:bg-stone-900'
                      }`}
                    >
                      <span className="text-xs font-bold">English (انگلیسی)</span>
                      {settings.language === 'en' && <CheckCircle2 className="w-4 h-4 text-amber-400" />}
                    </button>
                  </div>
                </div>

                {/* 1.4 Font Size Slider */}
                <div className="space-y-2 pt-2 border-t border-stone-800/80">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-bold text-stone-300">
                      <Type className="w-3.5 h-3.5 text-amber-400" />
                      <span>{isFa ? 'اندازه قلم و فونت متن‌ها' : 'Font Size'}</span>
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
                </div>

                {/* 1.5 Timeline Style */}
                <div className="space-y-2 pt-2 border-t border-stone-800/80">
                  <div className="flex items-center gap-2 text-xs font-bold text-stone-300">
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    <span>{isFa ? 'سبک نمایش تایم‌لاین' : 'Timeline Style'}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => onUpdateSettings({ timelineMode: 'modern' })}
                      className={`min-h-[48px] p-2.5 rounded-xl border text-center cursor-pointer active:scale-95 transition-all ${
                        (settings.timelineMode || 'modern') === 'modern'
                          ? 'border-amber-500 bg-amber-500/15 text-white ring-1 ring-amber-500/30'
                          : 'border-stone-800 bg-stone-950/60 text-stone-400 hover:border-stone-700'
                      }`}
                    >
                      <div className="font-black text-xs text-amber-300">{isFa ? 'مدرن طلایی' : 'Modern Gold'}</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => onUpdateSettings({ timelineMode: 'sketch' })}
                      className={`min-h-[48px] p-2.5 rounded-xl border text-center cursor-pointer active:scale-95 transition-all ${
                        settings.timelineMode === 'sketch'
                          ? 'border-white bg-white/15 text-white ring-1 ring-white/40'
                          : 'border-stone-800 bg-stone-950/60 text-stone-400 hover:border-stone-700'
                      }`}
                    >
                      <div className="font-black text-xs text-white font-mono">{isFa ? 'اسکچ خط‌چین' : 'Sketch Border'}</div>
                    </button>
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
              onClick={() => toggleSection('sound')}
              className="w-full min-h-[48px] p-3.5 sm:p-4 bg-stone-900/60 hover:bg-stone-900 border-b border-stone-800/80 flex items-center justify-between gap-3 transition-colors cursor-pointer text-start"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                  <Volume2 className="w-4.5 h-4.5" />
                </div>
                <div className="min-w-0">
                  <h4 className="text-xs sm:text-sm font-black text-white truncate">
                    {isFa ? '۲. صدا و هشدارها' : '2. Sound & Alerts'}
                  </h4>
                  <p className="text-[11px] text-stone-400 truncate">
                    {isFa
                      ? `بلندی: ${toPersianDigits(Math.round((settings.alarmVolume ?? 0.85) * 100))}٪ • ملودی آلارم`
                      : `Volume: ${Math.round((settings.alarmVolume ?? 0.85) * 100)}% • Alarm Melody`}
                  </p>
                </div>
              </div>
              <ChevronDown className={`w-4 h-4 text-stone-400 transition-transform duration-200 shrink-0 ${openSections.sound ? 'rotate-180 text-amber-400' : ''}`} />
            </button>

            {openSections.sound && (
              <div className="p-3 sm:p-4 space-y-4 animate-in fade-in">
                {/* 2.1 Volume Slider and Presets */}
                <div className="p-3.5 rounded-2xl bg-stone-900/70 border border-stone-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-bold text-stone-200">
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
                      { label: isFa ? 'متوسط (۶۰٪)' : 'Med (60%)', val: 0.6 },
                      { label: isFa ? 'بلند (۸۵٪)' : 'High (85%)', val: 0.85 },
                      { label: isFa ? 'حداکثر (۱۰۰٪)' : 'Max (100%)', val: 1.0 },
                    ].map((chip) => {
                      const isActive = Math.abs((settings.alarmVolume ?? 0.85) - chip.val) < 0.05;
                      return (
                        <button
                          key={chip.val}
                          type="button"
                          onClick={() => handleVolumeChange(chip.val)}
                          className={`min-h-[36px] text-[11px] px-2.5 py-1 rounded-lg border font-bold transition-all cursor-pointer active:scale-95 ${
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
                      const isSelected = (settings.alarmSound || 'digital-beep') === soundItem.id;
                      const isPlaying = playingSoundId === soundItem.id;

                      return (
                        <div
                          key={soundItem.id}
                          onClick={() => handleSelectSound(soundItem.id)}
                          className={`p-2.5 rounded-xl border transition-all flex items-center justify-between gap-3 cursor-pointer ${
                            isSelected
                              ? 'border-amber-500 bg-amber-500/10 ring-1 ring-amber-500/40 shadow-sm'
                              : 'border-stone-800/90 bg-stone-950/60 hover:border-stone-700 hover:bg-stone-900/50'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${
                              isSelected ? 'border-amber-500 bg-amber-500' : 'border-stone-600 bg-transparent'
                            }`}>
                              {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-stone-950" />}
                            </div>

                            <div className="min-w-0">
                              <p className={`text-xs font-bold truncate ${isSelected ? 'text-amber-300' : 'text-stone-200'}`}>
                                {soundItem.label}
                              </p>
                              <p className="text-[10px] text-stone-400 truncate">
                                {soundItem.desc}
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
                                ? 'bg-amber-500 text-stone-950 font-black animate-pulse'
                                : isSelected
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
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
                                <Play className="w-3 h-3 fill-current text-amber-400" />
                                <span>{isFa ? 'پخش' : 'Play'}</span>
                              </>
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 2.3 Additional Alarm Preferences */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-stone-800/80">
                  <label className="min-h-[48px] flex items-center justify-between p-2.5 rounded-xl bg-stone-900/70 border border-stone-800 cursor-pointer">
                    <span className="text-xs font-bold text-white">
                      {isFa ? 'فلاش چراغ دوربین پشت گوشی' : 'Camera LED Flash'}
                    </span>
                    <input
                      type="checkbox"
                      checked={settings.enableFlash}
                      onChange={(e) => onUpdateSettings({ enableFlash: e.target.checked })}
                      className="w-4 h-4 rounded accent-amber-500"
                    />
                  </label>

                  <label className="min-h-[48px] flex items-center justify-between p-2.5 rounded-xl bg-stone-900/70 border border-stone-800 cursor-pointer">
                    <span className="text-xs font-bold text-white">
                      {settings.language === 'en' ? t.autoMicInput : 'میکروفون خودکار فرم'}
                    </span>
                    <input
                      type="checkbox"
                      checked={settings.autoVoiceInput}
                      onChange={(e) => onUpdateSettings({ autoVoiceInput: e.target.checked })}
                      className="w-4 h-4 rounded accent-amber-500"
                    />
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* ========================================================= */}
          {/* 3. PERMISSIONS HUB (دسترسی‌ها - ردیف فشرده) */}
          {/* ========================================================= */}
          <div className="rounded-2xl border border-stone-800 bg-stone-950/60 overflow-hidden transition-all shadow-sm">
            <button
              type="button"
              onClick={() => toggleSection('permissions')}
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
                    {isFa
                      ? `${toPersianDigits(Object.values(nativePerms).filter(Boolean).length)} از ۴ دسترسی تایید شده است`
                      : `${Object.values(nativePerms).filter(Boolean).length} of 4 permissions granted`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {isNativeAndroidApp() && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                    Android APK
                  </span>
                )}
                <ChevronDown className={`w-4 h-4 text-stone-400 transition-transform duration-200 ${openSections.permissions ? 'rotate-180 text-sky-400' : ''}`} />
              </div>
            </button>

            {openSections.permissions && (
              <div className="p-3 sm:p-4 space-y-3 animate-in fade-in">
                {/* 3.1 وضعیت دسترسی‌ها توی یه ردیف فشرده (COMPACT PERMISSIONS ROW) */}
                <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
                  {/* 1. Notifications */}
                  <div
                    onClick={() => !nativePerms.notifications && handleRequestPerm('notifications')}
                    className={`min-h-[56px] p-2 rounded-xl border flex flex-col items-center justify-center text-center transition-all ${
                      nativePerms.notifications
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                        : 'bg-stone-900/80 border-stone-800 text-stone-400 hover:border-amber-500/50 cursor-pointer active:scale-95'
                    }`}
                    title={isFa ? 'دسترسی اعلان‌ها' : 'Notifications'}
                  >
                    <div className="relative mb-1">
                      <Bell className={`w-4 h-4 ${nativePerms.notifications ? 'text-emerald-400' : 'text-stone-400'}`} />
                      <span className={`absolute -top-1 -end-1 w-2 h-2 rounded-full ${nativePerms.notifications ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
                    </div>
                    <span className="text-[10px] sm:text-[11px] font-bold text-stone-200 truncate w-full block">
                      {isFa ? 'اعلان' : 'Alert'}
                    </span>
                    <span className={`text-[9px] font-bold ${nativePerms.notifications ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {nativePerms.notifications ? 'تایید ✓' : (isFa ? 'تایید' : 'Allow')}
                    </span>
                  </div>

                  {/* 2. Microphone */}
                  <div
                    onClick={() => !nativePerms.microphone && handleRequestPerm('microphone')}
                    className={`min-h-[56px] p-2 rounded-xl border flex flex-col items-center justify-center text-center transition-all ${
                      nativePerms.microphone
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                        : 'bg-stone-900/80 border-stone-800 text-stone-400 hover:border-amber-500/50 cursor-pointer active:scale-95'
                    }`}
                    title={isFa ? 'دسترسی میکروفون و صوت' : 'Microphone'}
                  >
                    <div className="relative mb-1">
                      <Mic className={`w-4 h-4 ${nativePerms.microphone ? 'text-emerald-400' : 'text-stone-400'}`} />
                      <span className={`absolute -top-1 -end-1 w-2 h-2 rounded-full ${nativePerms.microphone ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
                    </div>
                    <span className="text-[10px] sm:text-[11px] font-bold text-stone-200 truncate w-full block">
                      {isFa ? 'میکروفون' : 'Mic'}
                    </span>
                    <span className={`text-[9px] font-bold ${nativePerms.microphone ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {nativePerms.microphone ? 'تایید ✓' : (isFa ? 'تایید' : 'Allow')}
                    </span>
                  </div>

                  {/* 3. Camera */}
                  <div
                    onClick={() => !nativePerms.camera && handleRequestPerm('camera')}
                    className={`min-h-[56px] p-2 rounded-xl border flex flex-col items-center justify-center text-center transition-all ${
                      nativePerms.camera
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                        : 'bg-stone-900/80 border-stone-800 text-stone-400 hover:border-amber-500/50 cursor-pointer active:scale-95'
                    }`}
                    title={isFa ? 'دسترسی دوربین' : 'Camera'}
                  >
                    <div className="relative mb-1">
                      <Camera className={`w-4 h-4 ${nativePerms.camera ? 'text-emerald-400' : 'text-stone-400'}`} />
                      <span className={`absolute -top-1 -end-1 w-2 h-2 rounded-full ${nativePerms.camera ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
                    </div>
                    <span className="text-[10px] sm:text-[11px] font-bold text-stone-200 truncate w-full block">
                      {isFa ? 'دوربین' : 'Camera'}
                    </span>
                    <span className={`text-[9px] font-bold ${nativePerms.camera ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {nativePerms.camera ? 'تایید ✓' : (isFa ? 'تایید' : 'Allow')}
                    </span>
                  </div>

                  {/* 4. GPS / Location */}
                  <div
                    onClick={() => !nativePerms.location && handleRequestPerm('location')}
                    className={`min-h-[56px] p-2 rounded-xl border flex flex-col items-center justify-center text-center transition-all ${
                      nativePerms.location
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                        : 'bg-stone-900/80 border-stone-800 text-stone-400 hover:border-amber-500/50 cursor-pointer active:scale-95'
                    }`}
                    title={isFa ? 'دسترسی موقعیت مکانی GPS' : 'GPS Location'}
                  >
                    <div className="relative mb-1">
                      <MapPin className={`w-4 h-4 ${nativePerms.location ? 'text-emerald-400' : 'text-stone-400'}`} />
                      <span className={`absolute -top-1 -end-1 w-2 h-2 rounded-full ${nativePerms.location ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
                    </div>
                    <span className="text-[10px] sm:text-[11px] font-bold text-stone-200 truncate w-full block">
                      {isFa ? 'موقعیت' : 'GPS'}
                    </span>
                    <span className={`text-[9px] font-bold ${nativePerms.location ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {nativePerms.location ? 'تایید ✓' : (isFa ? 'تایید' : 'Allow')}
                    </span>
                  </div>
                </div>

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
              onClick={() => toggleSection('sync')}
              className="w-full min-h-[48px] p-3.5 sm:p-4 bg-stone-900/60 hover:bg-stone-900 border-b border-stone-800/80 flex items-center justify-between gap-3 transition-colors cursor-pointer text-start"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400 shrink-0">
                  <Cloud className="w-4.5 h-4.5" />
                </div>
                <div className="min-w-0">
                  <h4 className="text-xs sm:text-sm font-black text-white truncate">
                    {isFa ? '۴. همگام‌سازی و سرویس‌ها' : '4. Sync & Services'}
                  </h4>
                  <p className="text-[11px] text-stone-400 truncate">
                    {googleUser
                      ? (isFa ? `گوگل: ${googleUser.email}` : `Google: ${googleUser.email}`)
                      : (isFa ? 'اتصال به تقویم گوگل، نقشه و حصار مکانی' : 'Google Calendar, Maps & Geofence')}
                  </p>
                </div>
              </div>
              <ChevronDown className={`w-4 h-4 text-stone-400 transition-transform duration-200 shrink-0 ${openSections.sync ? 'rotate-180 text-sky-400' : ''}`} />
            </button>

            {openSections.sync && (
              <div className="p-3 sm:p-4 space-y-4 animate-in fade-in">
                {/* 4.1 Google Workspace Sync */}
                <div className="p-3.5 rounded-2xl bg-stone-900/70 border border-stone-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-bold text-stone-200">
                      <Cloud className="w-4 h-4 text-sky-400" />
                      <span>{isFa ? 'همگام‌سازی تقویم گوگل (Google Calendar)' : 'Google Calendar Sync'}</span>
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
                        className="min-h-[40px] flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-700 hover:bg-rose-600 text-white text-xs font-bold cursor-pointer active:scale-95 shadow-sm"
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
                        className="min-h-[44px] flex items-center gap-2 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-md shadow-blue-600/30 disabled:opacity-50"
                      >
                        <span>{isSigningIn ? (settings.language === 'en' ? 'Connecting...' : 'اتصال...') : (settings.language === 'en' ? 'Sign in with Google' : 'ورود با گوگل')}</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* 4.2 Geofence Radar */}
                <div className="p-3.5 rounded-2xl bg-stone-900/70 border border-stone-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-bold text-stone-200">
                      <Radio className={`w-4 h-4 ${isGeofenceActive ? 'text-emerald-400 animate-pulse' : 'text-stone-400'}`} />
                      <span>{isFa ? 'رادار پایش حصار مکانی (Geofence)' : 'Geofence Radar'}</span>
                    </div>
                    <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold border ${
                      isGeofenceActive 
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' 
                        : 'bg-stone-800 text-stone-400 border-stone-700'
                    }`}>
                      {isGeofenceActive ? (isFa ? 'فعال' : 'Active') : (isFa ? 'متوقف' : 'Paused')}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-stone-950 border border-stone-800/80">
                    <div>
                      <span className="text-xs font-bold text-white block">
                        {isFa ? 'پایش ورود/خروج حصارها' : 'Background Geofencing'}
                      </span>
                      <span className="text-[11px] text-stone-400">
                        {isFa ? 'پایش هوشمند GPS با مصرف بهینه باتری' : 'Low-battery GPS tracking'}
                      </span>
                    </div>

                    <label className="relative inline-flex items-center cursor-pointer shrink-0">
                      <input
                        type="checkbox"
                        checked={isGeofenceActive}
                        onChange={(e) => {
                          const next = e.target.checked;
                          setGeofenceTrackingEnabled(next);
                          if (onToggleGeofenceActive) onToggleGeofenceActive(next);
                        }}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-stone-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                    </label>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <div className="flex items-center justify-between p-2 rounded-xl bg-stone-950 border border-stone-800">
                      <span className="text-stone-400 text-[11px]">{isFa ? 'حصارهای فعال:' : 'Active:'}</span>
                      <span className="font-bold text-emerald-400">
                        {isFa 
                          ? `${toPersianDigits(reminders.filter((r) => r.geofence && r.geofence.enabled && r.status !== 'completed').length)} مکان` 
                          : `${reminders.filter((r) => r.geofence && r.geofence.enabled && r.status !== 'completed').length} Places`}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={async () => {
                        const status = await requestLocationPermission();
                        if (status) {
                          alert(isFa ? 'مجوز موقعیت مکانی GPS فعال است.' : 'Location GPS permission is active.');
                        } else {
                          alert(isFa ? 'دسترسی GPS در مرورگر یا دستگاه شما مسدود است.' : 'Location permission is denied.');
                        }
                      }}
                      className="min-h-[40px] flex items-center justify-center gap-1.5 p-2 rounded-xl bg-stone-950 hover:bg-stone-800 border border-stone-800 text-stone-300 hover:text-white transition-colors cursor-pointer text-[11px] font-bold"
                    >
                      <Crosshair className="w-3.5 h-3.5 text-teal-400" />
                      <span>{isFa ? 'بررسی GPS' : 'Check GPS'}</span>
                    </button>
                  </div>
                </div>

                {/* 4.3 Google Maps API Settings */}
                <div className="p-3.5 rounded-2xl bg-stone-900/70 border border-stone-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-stone-200">
                      {settings.language === 'en' ? t.mapsServiceTitle : 'تنظیمات کلید Google Maps'}
                    </span>
                    <span className="text-[10px] text-stone-400">{settings.language === 'en' ? 'Optional' : 'اختیاری'}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={mapsKeyInput}
                      onChange={(e) => setMapsKeyInput(e.target.value)}
                      placeholder="Google Maps API Key"
                      className="flex-1 min-h-[44px] px-3 py-2 rounded-xl bg-stone-950 border border-stone-800 text-white placeholder-stone-600 text-xs font-mono focus:outline-none focus:border-emerald-500/70"
                    />
                    <button
                      type="button"
                      onClick={handleSaveMapsKey}
                      className="min-h-[44px] px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1 active:scale-95 transition-all cursor-pointer"
                    >
                      {keySavedMessage ? <Check className="w-4 h-4 text-white" /> : null}
                      <span>{keySavedMessage ? (settings.language === 'en' ? t.saved : 'ذخیره شد') : (settings.language === 'en' ? t.save : 'ذخیره')}</span>
                    </button>
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
              onClick={() => toggleSection('backup')}
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
                    {isFa ? 'دانلود و بازیابی فایل JSON • اطلاعات نسخه' : 'JSON Export/Import • Version Info'}
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
                    <span className="font-bold text-amber-400 text-sm">{isFa ? toPersianDigits(reminders.length) : reminders.length}</span>
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

                {/* Alerts */}
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

                {/* 5.2 Download & Upload Buttons (min 48px) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={handleDownloadBackup}
                    className="min-h-[48px] flex items-center justify-center gap-2 p-3 rounded-xl bg-stone-900 hover:bg-stone-800 border border-stone-700/80 text-white font-bold text-xs shadow-sm hover:border-emerald-500/50 transition-all cursor-pointer active:scale-95"
                  >
                    <Download className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>{isFa ? 'دانلود فایل پشتیبان (JSON)' : 'Download Backup (JSON)'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="min-h-[48px] flex items-center justify-center gap-2 p-3 rounded-xl bg-stone-900 hover:bg-stone-800 border border-stone-700/80 text-white font-bold text-xs shadow-sm hover:border-sky-500/50 transition-all cursor-pointer active:scale-95"
                  >
                    <Upload className="w-4 h-4 text-sky-400 shrink-0" />
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
                      <FileJson className="w-4 h-4 shrink-0" />
                      <span>{isFa ? 'فایل پشتیبان با موفقیت شناسایی شد:' : 'Backup file parsed:'}</span>
                    </div>

                    <div className="text-xs text-stone-300 space-y-1 pr-2">
                      <p>• {isFa ? 'تعداد یادآورها:' : 'Reminders:'} <strong className="text-white">{isFa ? toPersianDigits(pendingRestoreData.reminders?.length || 0) : (pendingRestoreData.reminders?.length || 0)}</strong></p>
                      <p>• {isFa ? 'تعداد مناسبت‌ها:' : 'Occasions:'} <strong className="text-white">{isFa ? toPersianDigits(pendingRestoreData.occasions?.length || 0) : (pendingRestoreData.occasions?.length || 0)}</strong></p>
                      <p>• {isFa ? 'تعداد ایده‌ها:' : 'Ideas:'} <strong className="text-white">{isFa ? toPersianDigits(pendingRestoreData.ideas?.length || 0) : (pendingRestoreData.ideas?.length || 0)}</strong></p>
                      <p>• {isFa ? 'تعداد مکان‌های GPS:' : 'GPS Places:'} <strong className="text-white">{isFa ? toPersianDigits(pendingRestoreData.savedLocations?.length || 0) : (pendingRestoreData.savedLocations?.length || 0)}</strong></p>
                    </div>

                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => handleConfirmRestore('replace')}
                        className="min-h-[44px] flex-1 py-2 px-3 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs transition-colors cursor-pointer active:scale-95"
                      >
                        {isFa ? 'جایگزینی داده‌ها (Overwrite)' : 'Overwrite Data'}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleConfirmRestore('merge')}
                        className="min-h-[44px] flex-1 py-2 px-3 rounded-xl bg-stone-800 hover:bg-stone-700 text-white font-bold text-xs transition-colors cursor-pointer active:scale-95 border border-stone-700"
                      >
                        {isFa ? 'افزودن و ادغام (Merge)' : 'Merge Data'}
                      </button>

                      <button
                        type="button"
                        onClick={() => setPendingRestoreData(null)}
                        className="min-h-[44px] py-2 px-3 rounded-xl bg-stone-900 hover:bg-stone-800 text-white font-bold text-xs cursor-pointer active:scale-95 border border-stone-800"
                      >
                        {isFa ? 'انصراف' : 'Cancel'}
                      </button>
                    </div>
                  </div>
                )}

                {/* 5.3 Performance Statistics Modal Trigger */}
                {onOpenStats && (
                  <div className="pt-2 border-t border-stone-800/80">
                    <div className="flex items-center justify-between p-3 rounded-2xl bg-stone-900/80 border border-stone-800 hover:border-amber-500/40 transition-all">
                      <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center flex-shrink-0">
                        <BarChart3 className="w-5 h-5" />
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onOpenStats();
                        }}
                        className="min-h-[44px] px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs shadow-sm active:scale-95 transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5"
                      >
                        <span>{settings.language === 'en' ? t.viewStats : 'مشاهده آمار'}</span>
                        <span className="text-amber-200">←</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* 5.4 App Specifications & Version */}
                <div className="p-3 rounded-2xl bg-stone-900/60 border border-stone-800/80 space-y-2 text-xs">
                  <div className="flex items-center justify-between border-b border-stone-800/60 pb-2">
                    <span className="text-stone-400">{isFa ? 'نام برنامه' : 'App Name'}</span>
                    <div className="flex items-center gap-2">
                      <img src={appIcon} alt="YAAD" className="w-4.5 h-4.5 rounded-md object-cover" />
                      <span className="font-bold text-white">{APP_VERSION_INFO.name}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between border-b border-stone-800/60 pb-2">
                    <span className="text-stone-400">{isFa ? 'نسخه فعلی' : 'Current Version'}</span>
                    <span className="font-mono font-bold text-amber-400">{isFa ? `نسخه ${toPersianDigits(APP_VERSION)}` : `Version ${APP_VERSION}`}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-stone-400">{isFa ? 'نوع پلتفرم' : 'Platform Type'}</span>
                    <span className="text-stone-200">{isFa ? 'اپلیکیشن تحت وب پیشرونده (PWA)' : 'Progressive Web App (PWA)'}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

        </div>

        {/* Footer - Sticky above keyboard (دکمه تأیید همیشه پایین و ثابت، حداقل ۴۸ پیکسل) */}
        <div className="sticky bottom-0 z-20 shrink-0 px-3 sm:px-5 py-3 border-t border-stone-800 flex justify-end bg-stone-900/95 backdrop-blur shadow-2xl">
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto min-h-[48px] px-8 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 font-black text-xs sm:text-sm shadow-md transition-all active:scale-95 cursor-pointer flex items-center justify-center gap-2"
          >
            {settings.language === 'en' ? t.confirm : 'تأیید'}
          </button>
        </div>
      </div>
    </div>
  );
};

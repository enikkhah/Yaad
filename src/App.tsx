import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Reminder, Category, Priority, ReminderStatus, IdeaNote, AppSettings, AppTheme, SavedLocation, Occasion } from './types';
import { getJalaliComponents, getGregorianComponents, formatJalaliFull, formatJalaliTime, toPersianDigits, normalizeSearchText, matchesReminderSearch, matchesIdeaSearch, matchesLocationSearch, matchesOccasionSearch } from './utils/jalali';
import { playRingTune, speakReminderText, playPhoneAlarmSound, setGlobalVolume, setGlobalVibration, stopAlarmRinging, unlockAudio } from './utils/audio';
import { VerticalTimelineView } from './components/VerticalTimelineView';
import { TimelineWidget } from './components/TimelineWidget';
import { ReminderForm } from './components/ReminderForm';
import { ReminderCard } from './components/ReminderCard';
import { AlarmModal } from './components/AlarmModal';
import { StatisticsModal } from './components/StatisticsModal';
import { SettingsModal } from './components/SettingsModal';
import { IdeaCaptureModal } from './components/IdeaCaptureModal';
import { IdeaCard } from './components/IdeaCard';
import { LocationCaptureModal } from './components/LocationCaptureModal';
import { SavedLocationCard } from './components/SavedLocationCard';
import { LocationReminderModal } from './components/LocationReminderModal';
import { OccasionsView } from './components/OccasionsView';
import { OccasionFormModal } from './components/OccasionFormModal';
import { AndroidPermissionModal } from './components/AndroidPermissionModal';
import { AndroidPermissionType, openAndroidSettings, requestNotificationPermission, requestLocationPermission } from './utils/nativePermissions';
import { OCCASIONS_STORAGE_KEY, createReminderFromOccasion } from './utils/occasionUtils';
import { performAutoBackup, retrieveLatestBackupWithPriority, requestPersistentStorage, requestLocalFolderPermission, AUTO_BACKUP_STORAGE_KEY, LAST_LOCAL_BACKUP_KEY } from './utils/backupStorage';
import { InstallModal } from './components/InstallModal';
import { SplashScreen } from './components/SplashScreen';
import { useFabVisibility } from './hooks/useFabVisibility';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { 
  initGoogleAuth, 
  signInWithGoogle, 
  signOutGoogle, 
  syncReminderToCalendar, 
  syncToGoogleTasks 
} from './utils/googleSync';
import { User } from 'firebase/auth';
import confetti from 'canvas-confetti';
import appIcon from './assets/images/icon.png';
import { getNextRecurrenceTimestamp } from './utils/recurrence';
import { 
  initNotificationChannel, 
  scheduleReminderNotification, 
  cancelReminderNotification, 
  rescheduleReminderNotification, 
  syncAllRemindersWithLocalNotifications, 
  syncNotificationSoundAndVolume,
  setupNotificationListeners,
  getNotificationId,
  fireImmediateLocalNotification,
  dismissDeliveredNotifications,
  triggerOutOfAppPersistentNotification,
  clearOutOfAppPersistentNotification
} from './utils/nativeLocalNotifications';
import { 
  evaluateGeofences, 
  evaluateSavedLocationGeofences,
  getAdaptivePollingInterval, 
  isGeofenceTrackingEnabled, 
  setGeofenceTrackingEnabled,
  saveLastKnownPosition, 
  getLastKnownPosition,
  UserPosition,
  GeofenceTriggerEvent,
  SavedLocationTriggerEvent
} from './utils/geofenceManager';
import { getT, formatSavedLocationTitle } from './utils/i18n';
import { APP_VERSION } from './utils/version';
import { 
  Plus, 
  BarChart3, 
  Calendar, 
  Clock, 
  Search, 
  Briefcase, 
  Heart, 
  Tag, 
  CheckCircle2, 
  Bell, 
  Filter, 
  MessageSquare, 
  Volume2, 
  Zap, 
  X,
  Sparkles,
  Settings as SettingsIcon,
  Lightbulb,
  Check,
  MapPin,
  Download,
  RotateCcw,
  Trash2,
  Cake,
  CalendarHeart,
  Radio,
  Navigation,
  Crosshair,
  Moon,
  Sun,
  Smartphone,
  ShieldCheck,
  Info,
  Mail,
  ExternalLink
} from 'lucide-react';

const REMINDERS_STORAGE_KEY = 'fa_reminder_app_data_v2';
const IDEAS_STORAGE_KEY = 'fa_ideas_app_data_v1';
const LOCATIONS_STORAGE_KEY = 'fa_locations_app_data_v1';
const SETTINGS_STORAGE_KEY = 'fa_settings_app_data_v1';
const DEFAULT_THEME_MIGRATION_KEY = 'yaad_default_theme_midnight_v1';
const DEFAULT_LANG_FA_MIGRATION_KEY = 'yaad_default_lang_fa_v3';
const USER_EXPLICIT_LANG_KEY = 'yaad_user_explicit_lang_choice';

export default function App() {
  // Theme and Settings state
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (!localStorage.getItem(DEFAULT_THEME_MIGRATION_KEY)) {
          localStorage.setItem(DEFAULT_THEME_MIGRATION_KEY, 'true');
          parsed.theme = 'midnight_blue_silver';
          localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(parsed));
        }
        if (
          !localStorage.getItem(DEFAULT_LANG_FA_MIGRATION_KEY) ||
          localStorage.getItem(USER_EXPLICIT_LANG_KEY) !== 'true'
        ) {
          localStorage.setItem(DEFAULT_LANG_FA_MIGRATION_KEY, 'true');
          parsed.language = 'fa';
          localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(parsed));
        }
        if (!parsed.language) {
          parsed.language = 'fa';
        }
        return parsed;
      }
    } catch {
      // Fallback
    }
    try {
      localStorage.setItem(DEFAULT_THEME_MIGRATION_KEY, 'true');
      localStorage.setItem(DEFAULT_LANG_FA_MIGRATION_KEY, 'true');
    } catch {
      // Ignore
    }
    return {
      language: 'fa',
      theme: 'midnight_blue_silver',
      timelineOrientation: 'vertical',
      timelineMode: 'modern',
      fontSize: 'normal',
      systemNotificationsEnabled: true,
      ttsVoiceRate: 0.95,
      defaultRingTune: 'work',
      alarmSound: 'digital_beep',
      alarmVolume: 0.85,
      vibrationEnabled: true,
      autoVoiceInput: false,
    };
  });

  // Dynamic Language & Direction (فارسی / انگلیسی)
  useEffect(() => {
    const root = document.documentElement;
    const isEn = settings.language === 'en';
    root.dir = isEn ? 'ltr' : 'rtl';
    root.lang = isEn ? 'en' : 'fa';
  }, [settings.language]);

  const t = getT(settings.language);
  const isEn = settings.language === 'en';
  const formatNumber = (val: number | string) => (settings.language === 'en' ? val.toString() : toPersianDigits(val));

  // Dynamic Global Font Sizing (سایز فونت با اسلایدر در کل برنامه)
  useEffect(() => {
    const root = document.documentElement;
    if (typeof settings.fontSize === 'number') {
      root.style.fontSize = `${settings.fontSize}px`;
    } else {
      switch (settings.fontSize) {
        case 'small':
          root.style.fontSize = '14px';
          break;
        case 'large':
          root.style.fontSize = '18px';
          break;
        case 'xlarge':
          root.style.fontSize = '21px';
          break;
        case 'normal':
        default:
          root.style.fontSize = '16px';
          break;
      }
    }
  }, [settings.fontSize]);

  // Reminders state: Default seed reminders are removed per user request
  const [reminders, setReminders] = useState<Reminder[]>(() => {
    try {
      const saved = localStorage.getItem(REMINDERS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const bootNow = Date.now();
          // Filter out any default seed reminders and only auto-acknowledge reminders older than the 15-min repeat window (25 * 15 mins)
          return parsed
            .filter((r: any) => r && !r.id?.startsWith('seed-'))
            .map((r: Reminder) =>
              r.dueTimestamp <= bootNow - 25 * 15 * 60000 ? { ...r, acknowledged: true } : r
            );
        }
      }
    } catch {
      // Fallback
    }

    return [];
  });

  // Keep audio volume in sync with settings, sync Android Notification Channels,
  // and reschedule all upcoming pending reminders with the correct sound on app startup and whenever alarmSound changes
  useEffect(() => {
    if (settings.alarmVolume !== undefined) {
      setGlobalVolume(settings.alarmVolume);
    }
    const vibEnabled = settings.vibrationEnabled !== false;
    setGlobalVibration(vibEnabled);
    syncNotificationSoundAndVolume(settings.alarmSound, settings.alarmVolume, vibEnabled)
      .then(() => {
        syncAllRemindersWithLocalNotifications(reminders, settings).catch(() => {});
      })
      .catch(() => {});
  }, [settings.alarmSound, settings.alarmVolume, settings.vibrationEnabled, reminders]);

  // Ideas & Thoughts state: Initialized to empty array, all mock data removed
  const [ideas, setIdeas] = useState<IdeaNote[]>(() => {
    try {
      const saved = localStorage.getItem(IDEAS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed.filter((i: any) => i && i.id !== 'idea-1' && !i.id?.startsWith('seed-'));
        }
      }
    } catch {
      // Fallback
    }
    return [];
  });

  // Locations state (ثبت موقعیت مکانی با GPS و گوگل‌مپ): Initialized to empty array
  const [savedLocations, setSavedLocations] = useState<SavedLocation[]>(() => {
    try {
      const saved = localStorage.getItem(LOCATIONS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed.filter((l: any) => l && !l.id?.startsWith('seed-') && !l.id?.startsWith('sample_'));
        }
      }
    } catch {
      // Fallback
    }
    return [];
  });

  // Persistent locations storage
  useEffect(() => {
    try {
      localStorage.setItem(LOCATIONS_STORAGE_KEY, JSON.stringify(savedLocations));
    } catch {
      // Ignore
    }
  }, [savedLocations]);

  // Occasions state (مناسبت‌ها: تولد، سالگردها و رویدادهای مهم): Initialized to empty array, all mock data removed
  const [occasions, setOccasions] = useState<Occasion[]>(() => {
    try {
      const saved = localStorage.getItem(OCCASIONS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed.filter(
            (o: any) =>
              o &&
              o.id !== 'sample_occ_1' &&
              o.id !== 'sample_occ_2' &&
              !o.id?.startsWith('sample_') &&
              !o.id?.startsWith('seed-')
          );
        }
      }
    } catch {
      // Fallback
    }
    return [];
  });

  // Persistent occasions storage
  useEffect(() => {
    try {
      localStorage.setItem(OCCASIONS_STORAGE_KEY, JSON.stringify(occasions));
    } catch {
      // Ignore
    }
  }, [occasions]);

  // Active (non-deleted) collections for display in all tabs, timelines, counters, and background alarms
  const activeReminders = useMemo(() => reminders.filter((r) => !r.deletedAt), [reminders]);
  const activeIdeas = useMemo(() => ideas.filter((i) => !i.deletedAt), [ideas]);
  const activeSavedLocations = useMemo(() => savedLocations.filter((l) => !l.deletedAt), [savedLocations]);
  const activeOccasions = useMemo(() => occasions.filter((o) => !o.deletedAt), [occasions]);

  // Auto-recall/restore from Google Drive (Priority 1 if enabled/available) or Local "YAAD REMIDER" Folder (Priority 2) upon app open or re-installation
  const [isVaultInitialized, setIsVaultInitialized] = useState(false);

  const applyRestoredBackupIfNeeded = useCallback(
    (backup: any, _source?: 'local_folder' | 'none' | null) => {
      if (!backup) return false;

      const curReminders = remindersRef.current;
      const curIdeas = ideasRef.current;
      const curLocations = savedLocationsRef.current;
      const curOccasions = occasionsRef.current;

      const isRemindersEmpty = curReminders.length === 0;
      const isIdeasEmpty = curIdeas.length === 0;
      const isLocationsEmpty = curLocations.length === 0;
      const isOccasionsEmpty = curOccasions.length === 0;

      let restoredAny = false;

      // Merge or restore reminders from backup if local state is empty or backup has additional items
      if (Array.isArray(backup.reminders) && backup.reminders.length > 0) {
        const restoreNow = Date.now();
        const cleanReminders = backup.reminders
          .filter((r: Reminder) => r?.id && !r.id.startsWith('seed-'))
          .map((r: Reminder) => {
            if (r.dueTimestamp <= restoreNow || r.deletedAt) {
              triggeredAlarmsRef.current.add(r.id);
              return r.dueTimestamp <= restoreNow ? { ...r, acknowledged: true } : r;
            }
            return r;
          });
        if (cleanReminders.length > 0) {
          if (isRemindersEmpty) {
            setReminders(cleanReminders);
            restoredAny = true;
          } else {
            const existingIds = new Set(curReminders.map((r) => r.id));
            const missing = cleanReminders.filter((r: Reminder) => !existingIds.has(r.id));
            if (missing.length > 0) {
              setReminders((prev) => [...missing, ...prev]);
              restoredAny = true;
            }
          }
        }
      }

      if (Array.isArray(backup.ideas) && backup.ideas.length > 0) {
        const cleanIdeas = backup.ideas.filter(
          (i: IdeaNote) => i?.id && i.id !== 'idea-1' && !i.id.startsWith('seed-')
        );
        if (cleanIdeas.length > 0) {
          if (isIdeasEmpty) {
            setIdeas(cleanIdeas);
            restoredAny = true;
          } else {
            const existingIds = new Set(curIdeas.map((i) => i.id));
            const missing = cleanIdeas.filter((i: IdeaNote) => !existingIds.has(i.id));
            if (missing.length > 0) {
              setIdeas((prev) => [...missing, ...prev]);
              restoredAny = true;
            }
          }
        }
      }

      if (Array.isArray(backup.savedLocations) && backup.savedLocations.length > 0) {
        const cleanLocations = backup.savedLocations.filter(
          (l: SavedLocation) =>
            l?.id && !l.id.startsWith('seed-') && !l.id.startsWith('sample_')
        );
        if (cleanLocations.length > 0) {
          if (isLocationsEmpty) {
            setSavedLocations(cleanLocations);
            restoredAny = true;
          } else {
            const existingIds = new Set(curLocations.map((l) => l.id));
            const missing = cleanLocations.filter(
              (l: SavedLocation) => !existingIds.has(l.id)
            );
            if (missing.length > 0) {
              setSavedLocations((prev) => [...missing, ...prev]);
              restoredAny = true;
            }
          }
        }
      }

      if (Array.isArray(backup.occasions) && backup.occasions.length > 0) {
        const cleanOccasions = backup.occasions.filter(
          (o: Occasion) =>
            o?.id &&
            o.id !== 'sample_occ_1' &&
            o.id !== 'sample_occ_2' &&
            !o.id.startsWith('sample_') &&
            !o.id.startsWith('seed-')
        );
        if (cleanOccasions.length > 0) {
          if (isOccasionsEmpty) {
            setOccasions(cleanOccasions);
            restoredAny = true;
          } else {
            const existingIds = new Set(curOccasions.map((o) => o.id));
            const missing = cleanOccasions.filter((o: Occasion) => !existingIds.has(o.id));
            if (missing.length > 0) {
              setOccasions((prev) => [...missing, ...prev]);
              restoredAny = true;
            }
          }
        }
      }

      if (backup.settings && isRemindersEmpty) {
        const userExplicitLang =
          typeof localStorage !== 'undefined' &&
          localStorage.getItem(USER_EXPLICIT_LANG_KEY) === 'true';
        setSettings((prev) => ({
          ...prev,
          ...backup.settings,
          // Keep Persian ('fa') as default after fresh install unless user explicitly changed language
          language: userExplicitLang ? backup.settings.language || 'fa' : 'fa',
        }));
      }

      if (restoredAny) {
        try {
          if (Array.isArray(backup.reminders) && backup.reminders.length > 0 && isRemindersEmpty) {
            const restoreNow = Date.now();
            const clean = backup.reminders
              .filter((r: any) => r?.id && !r.id.startsWith('seed-'))
              .map((r: Reminder) =>
                r.dueTimestamp <= restoreNow ? { ...r, acknowledged: true } : r
              );
            localStorage.setItem(REMINDERS_STORAGE_KEY, JSON.stringify(clean));
            syncAllRemindersWithLocalNotifications(clean, settingsRef.current).catch(() => {});
          }
          if (Array.isArray(backup.ideas) && backup.ideas.length > 0 && isIdeasEmpty) {
            const clean = backup.ideas.filter((i: any) => i?.id && i.id !== 'idea-1' && !i.id.startsWith('seed-'));
            localStorage.setItem(IDEAS_STORAGE_KEY, JSON.stringify(clean));
          }
          if (Array.isArray(backup.savedLocations) && backup.savedLocations.length > 0 && isLocationsEmpty) {
            const clean = backup.savedLocations.filter((l: any) => l?.id && !l.id.startsWith('seed-') && !l.id.startsWith('sample_'));
            localStorage.setItem(LOCATIONS_STORAGE_KEY, JSON.stringify(clean));
          }
          if (Array.isArray(backup.occasions) && backup.occasions.length > 0 && isOccasionsEmpty) {
            const clean = backup.occasions.filter((o: any) => o?.id && !o.id.startsWith('seed-') && !o.id.startsWith('sample_'));
            localStorage.setItem(OCCASIONS_STORAGE_KEY, JSON.stringify(clean));
          }
        } catch {
          // ignore
        }

        const srcText =
          settingsRef.current?.language === 'en'
            ? 'Restored automatically from local folder (YAAD).'
            : 'اطلاعات از پوشه محلی (YAAD) فراخوانی شد.';
        showSyncNotification(srcText);
      }

      return restoredAny;
    },
    []
  );

  useEffect(() => {
    let isMounted = true;
    const autoRestoreOnOpen = async () => {
      try {
        const { snapshot, source } = await retrieveLatestBackupWithPriority(
          undefined,
          settingsRef.current
        );
        if (snapshot && isMounted) {
          applyRestoredBackupIfNeeded(snapshot, source);
        }
      } catch (err) {
        console.warn('Auto restore vault check:', err);
      } finally {
        if (isMounted) {
          setIsVaultInitialized(true);
        }
      }
    };

    autoRestoreOnOpen();

    return () => {
      isMounted = false;
    };
  }, [applyRestoredBackupIfNeeded]);

  // Automatic backup to local "YAAD REMIDER" folder (and Google Drive if enabled by user) after every change
  useEffect(() => {
    if (isVaultInitialized) {
      // SAFETY: Never overwrite an existing backup on disk with empty state during initial mount / startup
      const totalItems = reminders.length + ideas.length + savedLocations.length + occasions.length;
      if (totalItems > 0) {
        performAutoBackup({
          reminders,
          ideas,
          savedLocations,
          occasions,
          settings,
        });
      }
    }
  }, [reminders, ideas, savedLocations, occasions, settings, isVaultInitialized]);

  // Main Active Tab: 'reminders', 'ideas', 'locations', or 'occasions'
  const [activeMainTab, setActiveMainTab] = useState<'reminders' | 'ideas' | 'locations' | 'occasions'>('reminders');

  // Google Auth & Sync state
  const [googleUser, setGoogleUser] = useState<User | null>(null);
  const [googleToken, setGoogleToken] = useState<string | null>(null);
  const [syncToast, setSyncToast] = useState<string | null>(null);

  // Modals state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingReminder, setEditingReminder] = useState<Reminder | null>(null);
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isIdeaModalOpen, setIsIdeaModalOpen] = useState(false);
  const [editingIdea, setEditingIdea] = useState<IdeaNote | null>(null);
  const [isLocationModalOpen, setIsLocationModalOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<SavedLocation | null>(null);
  const [isLocationReminderModalOpen, setIsLocationReminderModalOpen] = useState(false);
  const [targetLocationForReminder, setTargetLocationForReminder] = useState<SavedLocation | null>(null);
  const [isOccasionModalOpen, setIsOccasionModalOpen] = useState(false);
  const [editingOccasion, setEditingOccasion] = useState<Occasion | null>(null);
  const [locationSearchQuery, setLocationSearchQuery] = useState('');
  const [currentUserPosition, setCurrentUserPosition] = useState<UserPosition | null>(() => getLastKnownPosition());
  const [isGeofenceActive, setIsGeofenceActive] = useState<boolean>(() => isGeofenceTrackingEnabled());
  const [isCreateChoiceOpen, setIsCreateChoiceOpen] = useState(false);
  const [locationFilter, setLocationFilter] = useState<'all' | 'checkpoints'>('all');
  const [activeAlarmReminder, setActiveAlarmReminder] = useState<Reminder | null>(null);
  const [viewingImageUrl, setViewingImageUrl] = useState<string | null>(null);
  const [installPromptEvent, setInstallPromptEvent] = useState<any>(null);
  const [isAppInstalled, setIsAppInstalled] = useState<boolean>(false);
  const [isInstallModalOpen, setIsInstallModalOpen] = useState<boolean>(false);
  const [undoToast, setUndoToast] = useState<{
    reminder: Reminder;
    index: number;
    timer: NodeJS.Timeout;
  } | null>(null);

  // Automatically unlock browser audio context on first user interaction so alarms always sound loudly
  useEffect(() => {
    const unlockAudio = () => {
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          const ctx = new AudioContextClass();
          ctx.resume().catch(() => {});
        }
      } catch (e) {
        // ignore
      }
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
    };
    window.addEventListener('click', unlockAudio, { once: true });
    window.addEventListener('touchstart', unlockAudio, { once: true });
    return () => {
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
    };
  }, []);

  // 1. SYSTEM DARK MODE DETECTION (خودکار از تنظیم گوشی پیروی می‌کند)
  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return true;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      setSystemPrefersDark(e.matches);
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  // Compute effective dark mode state
  const isDarkMode = React.useMemo(() => {
    if (settings.theme === 'light-clean' || settings.theme === 'jade_warm_light') return false;
    if (
      settings.theme === 'dark-gold' ||
      settings.theme === 'dark-slate' ||
      settings.theme === 'sketch-contrast' ||
      settings.theme === 'midnight_blue_silver'
    ) {
      return true;
    }
    return systemPrefersDark;
  }, [settings.theme, systemPrefersDark]);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', settings.theme);
      if (isDarkMode) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }
  }, [isDarkMode, settings.theme]);

  // 2. HARDWARE & BROWSER BACK BUTTON HANDLER (بسته شدن پنجره‌ها با دکمه بازگشت گوشی، به جز آلارم فعال که نیازمند واکنش قطعی کاربر است)
  const isAnyModalCurrentlyOpen = Boolean(
    isFormOpen || isStatsOpen || isSettingsOpen || isIdeaModalOpen ||
    isLocationModalOpen || isLocationReminderModalOpen || isOccasionModalOpen ||
    isCreateChoiceOpen || viewingImageUrl || isInstallModalOpen
  );

  const closeTopModal = useCallback((): boolean => {
    // If an alarm is actively ringing on screen, block accidental Back/Escape dismissal until user clicks Done/Snooze/Dismiss!
    if (activeAlarmReminder) {
      return true;
    }
    if (viewingImageUrl) { setViewingImageUrl(null); return true; }
    if (isCreateChoiceOpen) { setIsCreateChoiceOpen(false); return true; }
    if (isInstallModalOpen) { setIsInstallModalOpen(false); return true; }
    if (isLocationReminderModalOpen) { setIsLocationReminderModalOpen(false); return true; }
    if (isLocationModalOpen) { setIsLocationModalOpen(false); setEditingLocation(null); return true; }
    if (isIdeaModalOpen) { setIsIdeaModalOpen(false); setEditingIdea(null); return true; }
    if (isOccasionModalOpen) { setIsOccasionModalOpen(false); setEditingOccasion(null); return true; }
    if (isFormOpen) { setIsFormOpen(false); setEditingReminder(null); return true; }
    if (isSettingsOpen) { setIsSettingsOpen(false); return true; }
    if (isStatsOpen) { setIsStatsOpen(false); return true; }
    return false;
  }, [
    viewingImageUrl, isCreateChoiceOpen, isInstallModalOpen,
    isLocationReminderModalOpen, isLocationModalOpen, isIdeaModalOpen,
    isOccasionModalOpen, isFormOpen, isSettingsOpen, isStatsOpen,
    activeAlarmReminder
  ]);

  const closeTopModalRef = useRef(closeTopModal);
  useEffect(() => {
    closeTopModalRef.current = closeTopModal;
  }, [closeTopModal]);

  useEffect(() => {
    // A. Android Capacitor Native Hardware Back Button
    let capacitorListener: { remove: () => void } | null = null;
    try {
      CapacitorApp.addListener('backButton', ({ canGoBack }) => {
        const handled = closeTopModalRef.current();
        if (handled) return;
        if (!canGoBack) {
          CapacitorApp.exitApp();
        } else {
          window.history.back();
        }
      }).then((handle) => {
        capacitorListener = handle;
      }).catch(() => {});
    } catch {
      // Non-Capacitor environment
    }

    // B. Cordova / Android WebView backbutton event
    const handleBackButtonEvent = (e: Event) => {
      const handled = closeTopModalRef.current();
      if (handled) {
        e.preventDefault();
      }
    };
    document.addEventListener('backbutton', handleBackButtonEvent);

    // C. Browser History popstate (Phone browser back button or PWA back gesture)
    const handlePopState = () => {
      closeTopModalRef.current();
    };
    window.addEventListener('popstate', handlePopState);

    // D. Keyboard Escape key (Desktop / Bluetooth keyboard)
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeTopModalRef.current();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      if (capacitorListener?.remove) {
        capacitorListener.remove();
      }
      document.removeEventListener('backbutton', handleBackButtonEvent);
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Push history state whenever any modal opens so hardware/browser back button can pop and close it
  const prevModalOpenRef = useRef(false);
  useEffect(() => {
    if (isAnyModalCurrentlyOpen && !prevModalOpenRef.current) {
      window.history.pushState({ yaadModal: true }, '');
    } else if (!isAnyModalCurrentlyOpen && prevModalOpenRef.current) {
      if (window.history.state?.yaadModal) {
        window.history.back();
      }
    }
    prevModalOpenRef.current = isAnyModalCurrentlyOpen;
  }, [isAnyModalCurrentlyOpen]);
  const isInitialNotificationLaunch = (() => {
    if (typeof window === 'undefined') return false;
    if ((window as any).__yaadOpenedFromNotification === true) return true;
    try {
      const params = new URLSearchParams(window.location.search);
      return Boolean(
        params.get('editReminderId') ||
          params.get('openTimelineReminderId') ||
          params.get('openTimeline') ||
          params.get('alarmId')
      );
    } catch {
      return false;
    }
  })();

  const openedFromNotificationEditRef = useRef<boolean>(isInitialNotificationLaunch);

  // App startup splash screen (fade in & fade out in <= 1.5s, then immediately open + menu unless opened from a notification or an alarm/edit modal is active)
  const [showSplash, setShowSplash] = useState<boolean>(() => !isInitialNotificationLaunch);
  const [appVisible, setAppVisible] = useState<boolean>(() => isInitialNotificationLaunch);
  const handleStartExitSplash = useCallback(() => {
    setAppVisible(true);
    setActiveAlarmReminder((currAlarm) => {
      const openedFromNotif =
        openedFromNotificationEditRef.current ||
        (typeof window !== 'undefined' && (window as any).__yaadOpenedFromNotification === true);
      if (!currAlarm && !openedFromNotif) {
        setIsCreateChoiceOpen(true);
      }
      return currAlarm;
    });
  }, []);
  const handleFinishSplash = useCallback(() => {
    setAppVisible(true);
    setShowSplash(false);
    setActiveAlarmReminder((currAlarm) => {
      const openedFromNotif =
        openedFromNotificationEditRef.current ||
        (typeof window !== 'undefined' && (window as any).__yaadOpenedFromNotification === true);
      if (!currAlarm && !openedFromNotif) {
        setIsCreateChoiceOpen(true);
      }
      return currAlarm;
    });
    // Request ONLY Notification permission on initial app entry/install (most important permission)
    requestNotificationPermission().catch(() => {});
  }, []);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isLogoMenuOpen, setIsLogoMenuOpen] = useState(false);
  const [logoMenuInfoSection, setLogoMenuInfoSection] = useState<'privacy' | 'about' | null>(null);
  const logoMenuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const fabMenuRef = useRef<HTMLDivElement>(null);
  const fabBtnRef = useRef<HTMLButtonElement>(null);
  const [categoryFilter, setCategoryFilter] = useState<'all' | Category | 'completed'>('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | Priority>('all');

  // Close logo menu when clicking outside
  useEffect(() => {
    if (!isLogoMenuOpen) return;
    const handlePointerDownOutsideLogo = (e: PointerEvent | MouseEvent) => {
      const target = e.target as Node | null;
      if (target && logoMenuRef.current && !logoMenuRef.current.contains(target)) {
        setIsLogoMenuOpen(false);
        setLogoMenuInfoSection(null);
      }
    };
    document.addEventListener('pointerdown', handlePointerDownOutsideLogo, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDownOutsideLogo, true);
    };
  }, [isLogoMenuOpen]);

  // Close + 4-option menu when clicking anywhere on the screen outside the 4-option menu
  useEffect(() => {
    if (!isCreateChoiceOpen) return;
    const handlePointerDownOutside = (e: PointerEvent | MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (fabMenuRef.current && fabMenuRef.current.contains(target)) {
        return;
      }
      if (fabBtnRef.current && fabBtnRef.current.contains(target)) {
        return;
      }
      setIsCreateChoiceOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDownOutside, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDownOutside, true);
    };
  }, [isCreateChoiceOpen]);

  // Android Permission Directing Modal
  const [androidPermissionModal, setAndroidPermissionModal] = useState<{
    isOpen: boolean;
    type: AndroidPermissionType;
    onRetry?: () => void;
  }>({
    isOpen: false,
    type: 'notifications',
  });

  // Live Time & Alarm Checker
  const [currentTime, setCurrentTime] = useState(Date.now());
  const triggeredAlarmsRef = useRef<Set<string>>(new Set());
  const remindersRef = useRef(reminders);
  useEffect(() => {
    remindersRef.current = reminders;
  }, [reminders]);

  const ideasRef = useRef(ideas);
  useEffect(() => {
    ideasRef.current = ideas;
  }, [ideas]);

  const savedLocationsRef = useRef(savedLocations);
  useEffect(() => {
    savedLocationsRef.current = savedLocations;
  }, [savedLocations]);

  const occasionsRef = useRef(occasions);
  useEffect(() => {
    occasionsRef.current = occasions;
  }, [occasions]);

  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  // Floating Action Button (+) intelligent visibility & scroll edge boundary management
  const {
    isFabHidden: isFabHiddenOnScroll,
    resetFabPosition,
    fabContainerStyle,
    fabContainerClassName,
  } = useFabVisibility({
    isMenuOpen: isCreateChoiceOpen,
    threshold: 6,
    settleDelay: 380,
    slideDistance: 40,
    baseRightOffset: 20,
  });

  // Automatic persistent backup & recall on every app open & close (Drive priority -> Local YAAD REMIDER fallback)
  useEffect(() => {
    requestPersistentStorage();

    const saveFullSnapshotOnClose = () => {
      performAutoBackup({
        reminders: remindersRef.current,
        ideas: ideasRef.current,
        savedLocations: savedLocationsRef.current,
        occasions: occasionsRef.current,
        settings: settingsRef.current,
      });
    };

    const recallOnAppOpen = async () => {
      try {
        const { snapshot, source } = await retrieveLatestBackupWithPriority(
          undefined,
          settingsRef.current
        );
        if (snapshot) {
          applyRestoredBackupIfNeeded(snapshot, source);
        }
      } catch {
        // ignore
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        saveFullSnapshotOnClose();
      } else if (document.visibilityState === 'visible') {
        recallOnAppOpen();
      }
    };

    window.addEventListener('beforeunload', saveFullSnapshotOnClose);
    window.addEventListener('pagehide', saveFullSnapshotOnClose);
    document.addEventListener('visibilitychange', handleVisibility);

    let appStateSub: any = null;
    try {
      CapacitorApp.addListener('appStateChange', (state) => {
        if (!state.isActive) {
          saveFullSnapshotOnClose();
        } else {
          recallOnAppOpen();
        }
      }).then((sub) => {
        appStateSub = sub;
      }).catch(() => {});
    } catch {
      // ignore
    }

    return () => {
      window.removeEventListener('beforeunload', saveFullSnapshotOnClose);
      window.removeEventListener('pagehide', saveFullSnapshotOnClose);
      document.removeEventListener('visibilitychange', handleVisibility);
      if (appStateSub && appStateSub.remove) {
        appStateSub.remove();
      }
    };
  }, [applyRestoredBackupIfNeeded]);

  const handleCompleteReminderRef = useRef<(id: string) => void>(() => {});
  const handlePostponeRef = useRef<(id: string, mins: number, explicitDueTimestamp?: number) => void>(() => {});
  const handleStopOrDismissReminderRef = useRef<(id: string) => void>(() => {});
  const handleNoReactionTimeoutRef = useRef<(id: string, nextDueTimestamp?: number) => void>(() => {});
  const ACTIONED_REMINDERS_KEY = 'yaad_actioned_reminders_map';
  const recentNotificationActionsRef = useRef<Map<string, number>>(new Map());

  // Restore actioned reminder timestamps from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(ACTIONED_REMINDERS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const map = new Map<string, number>();
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === 'number') {
            map.set(k, v);
          }
        }
        recentNotificationActionsRef.current = map;
      }
    } catch {
      // ignore
    }
  }, []);

  const recordNotificationAction = (id: string) => {
    const now = Date.now();
    recentNotificationActionsRef.current.set(id, now);
    try {
      const raw = localStorage.getItem(ACTIONED_REMINDERS_KEY);
      const map: Record<string, number> = raw ? JSON.parse(raw) : {};
      map[id] = now;
      const cutoff = now - 24 * 3600 * 1000;
      for (const k of Object.keys(map)) {
        if (map[k] < cutoff) delete map[k];
      }
      localStorage.setItem(ACTIONED_REMINDERS_KEY, JSON.stringify(map));
    } catch {
      // ignore
    }
  };

  // Setup Google Auth listener and background alarm listeners on mount
  useEffect(() => {
    const unsubscribe = initGoogleAuth(
      (user, token) => {
        setGoogleUser(user);
        setGoogleToken(token);
      },
      () => {
        setGoogleUser(null);
        setGoogleToken(null);
      }
    );

    // Register Service Worker for PWA offline caching only in web browser environment
    if (!Capacitor.isNativePlatform()) {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
      }
    } else {
      // In native Android APK, all assets are bundled locally; unregister SW and purge cache
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then((registrations) => {
          for (const reg of registrations) {
            reg.unregister().catch(() => {});
          }
        }).catch(() => {});
      }
      if ('caches' in window) {
        caches.keys().then((keys) => {
          keys.forEach((k) => caches.delete(k).catch(() => {}));
        }).catch(() => {});
      }
    }

    const openEditModalForReminderId = (targetId: string) => {
      if (!targetId) return;
      openedFromNotificationEditRef.current = true;
      if (typeof window !== 'undefined') {
        (window as any).__yaadOpenedFromNotification = true;
      }
      stopAlarmRinging();
      clearOutOfAppPersistentNotification(targetId);
      cancelReminderNotification(targetId).catch(() => {});
      dismissDeliveredNotifications(targetId).catch(() => {});
      triggeredAlarmsRef.current.add(targetId);
      recordNotificationAction(targetId);

      let found = remindersRef.current?.find((r) => r.id === targetId);
      if (!found) {
        try {
          const raw = localStorage.getItem(REMINDERS_STORAGE_KEY);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              found = parsed.find((r: Reminder) => r.id === targetId);
            }
          }
        } catch {
          // ignore
        }
      }

      if (found) {
        setShowSplash(false);
        setAppVisible(true);
        setIsCreateChoiceOpen(false);
        setActiveAlarmReminder(null);
        setActiveMainTab('reminders');
        setEditingReminder(found);
        setIsFormOpen(true);
      }
    };

    const openTimelineFromNotificationTap = (targetId?: string) => {
      openedFromNotificationEditRef.current = true;
      if (typeof window !== 'undefined') {
        (window as any).__yaadOpenedFromNotification = true;
      }
      stopAlarmRinging();

      if (targetId) {
        triggeredAlarmsRef.current.add(targetId);
        let found = remindersRef.current?.find((r) => r.id === targetId);
        if (!found) {
          try {
            const raw = localStorage.getItem(REMINDERS_STORAGE_KEY);
            if (raw) {
              const parsed = JSON.parse(raw);
              if (Array.isArray(parsed)) {
                found = parsed.find((r: Reminder) => r.id === targetId);
              }
            }
          } catch {
            // ignore
          }
        }
        if (
          found &&
          found.dueTimestamp <= Date.now() &&
          !found.acknowledged &&
          found.status !== 'completed'
        ) {
          handleNoReactionTimeoutRef.current(targetId);
        }
      }

      setShowSplash(false);
      setAppVisible(true);
      setIsCreateChoiceOpen(false);
      setActiveAlarmReminder(null);
      setIsFormOpen(false);
      setEditingReminder(null);
      setIsSettingsOpen(false);
      setIsStatsOpen(false);
      setIsIdeaModalOpen(false);
      setIsLocationModalOpen(false);
      setIsLocationReminderModalOpen(false);
      setIsOccasionModalOpen(false);
      setCategoryFilter('all');
      setActiveMainTab('reminders');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    // Listen for Service Worker notification actions (done, complete, snooze, edit, stop, dismiss, open)
    const handleSwMessage = (event: MessageEvent) => {
      if (event.data?.type === 'YAAD_NOTIFICATION_ACTION') {
        const { action, reminderId } = event.data;

        if (action === 'open') {
          openTimelineFromNotificationTap(reminderId);
          return;
        }

        if (!reminderId) return;

        // Immediately stop audio ringing and dismiss delivered notification banner for explicit action buttons
        stopAlarmRinging();
        clearOutOfAppPersistentNotification(reminderId);

        if (action === 'complete' || action === 'done') {
          handleCompleteReminderRef.current(reminderId);
        } else if (action === 'snooze') {
          handlePostponeRef.current(reminderId, 15);
        } else if (action === 'edit') {
          openEditModalForReminderId(reminderId);
        } else if (action === 'stop' || action === 'dismiss') {
          handleStopOrDismissReminderRef.current(reminderId);
        }
      }
    };
    navigator.serviceWorker?.addEventListener('message', handleSwMessage);

    // Initialize Android Notification Channel & request Notification permission on initial install/entry
    initNotificationChannel()
      .then(() => requestNotificationPermission())
      .catch(() => {});
    setupNotificationListeners(
      (id) => {
        handleCompleteReminderRef.current(id);
      },
      (id, mins, snoozedUntil) => {
        handlePostponeRef.current(id, mins, snoozedUntil);
      },
      (id) => {
        handleStopOrDismissReminderRef.current(id);
      },
      (id) => {
        openTimelineFromNotificationTap(id);
      },
      (id) => {
        openEditModalForReminderId(id);
      },
      (id, snoozedUntil) => {
        handleNoReactionTimeoutRef.current(id, snoozedUntil);
      }
    );

    // Listen for Chrome / Android PWA beforeinstallprompt event
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPromptEvent(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // When the app is installed or re-installed, ensure Persian default language and request Notification permission first
    const handleAppInstalled = () => {
      setIsAppInstalled(true);
      setInstallPromptEvent(null);
      if (localStorage.getItem(USER_EXPLICIT_LANG_KEY) !== 'true') {
        setSettings((prev) => ({ ...prev, language: 'fa' }));
      }
      requestNotificationPermission().catch(() => {});
    };

    window.addEventListener('appinstalled', handleAppInstalled);

    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;
    if (isStandalone) {
      setIsAppInstalled(true);
    }

    return () => {
      unsubscribe();
      navigator.serviceWorker?.removeEventListener('message', handleSwMessage);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, [applyRestoredBackupIfNeeded]);

  // Save to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(REMINDERS_STORAGE_KEY, JSON.stringify(reminders));
    } catch (err) {
      console.error('Failed to save reminders:', err);
    }
  }, [reminders]);

  useEffect(() => {
    try {
      localStorage.setItem(IDEAS_STORAGE_KEY, JSON.stringify(ideas));
    } catch (err) {
      console.error('Failed to save ideas:', err);
    }
  }, [ideas]);

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  }, [settings]);

  // Check URL params for alarmId or editReminderId when launched from notification click
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const params = new URLSearchParams(window.location.search);
      const queryEditId = params.get('editReminderId');
      if (queryEditId) {
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete('editReminderId');
        window.history.replaceState({}, '', cleanUrl.pathname + (cleanUrl.search ? cleanUrl.search : ''));

        const found = reminders.find((r) => r.id === queryEditId);
        if (found) {
          openedFromNotificationEditRef.current = true;
          stopAlarmRinging();
          clearOutOfAppPersistentNotification(found.id);
          setShowSplash(false);
          setAppVisible(true);
          setIsCreateChoiceOpen(false);
          setActiveAlarmReminder(null);
          setActiveMainTab('reminders');
          setEditingReminder(found);
          setIsFormOpen(true);
          return;
        }
      }

      const queryTimelineRemId = params.get('openTimelineReminderId') || params.get('alarmId');
      const queryOpenTimeline = params.get('openTimeline');
      if (queryTimelineRemId || queryOpenTimeline) {
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete('openTimelineReminderId');
        cleanUrl.searchParams.delete('openTimeline');
        cleanUrl.searchParams.delete('alarmId');
        window.history.replaceState({}, '', cleanUrl.pathname + (cleanUrl.search ? cleanUrl.search : ''));

        openedFromNotificationEditRef.current = true;
        (window as any).__yaadOpenedFromNotification = true;
        stopAlarmRinging();
        if (queryTimelineRemId) {
          triggeredAlarmsRef.current.add(queryTimelineRemId);
          const found = reminders.find((r) => r.id === queryTimelineRemId);
          if (
            found &&
            found.dueTimestamp <= Date.now() &&
            !found.acknowledged &&
            found.status !== 'completed'
          ) {
            handleNoReactionTimeoutRef.current(queryTimelineRemId);
          }
        }
        setShowSplash(false);
        setAppVisible(true);
        setIsCreateChoiceOpen(false);
        setActiveAlarmReminder(null);
        setCategoryFilter('all');
        setActiveMainTab('reminders');
      }
    } catch {
      // Ignore
    }
  }, [reminders]);

  // Robust live time & alarm triggers (with unthrottled Web Worker for background tabs)
  useEffect(() => {
    const checkAlarms = () => {
      const now = Date.now();
      setCurrentTime(now);

      reminders.forEach((r) => {
        // Check if this reminder was actioned recently (e.g. Done, Snooze, or Stop via notification)
        const lastActionTime = recentNotificationActionsRef.current.get(r.id) || r.lastActionAt || 0;
        const isRecentlyActioned = (now - lastActionTime) < 300000; // 5 min protection window

        // If reminder is deleted (in recycle bin), completed, cancelled, acknowledged, or actioned via notification, NEVER trigger in-app alarm!
        if (
          r.deletedAt ||
          r.status === 'completed' ||
          r.status === 'cancelled' ||
          r.acknowledged === true ||
          isRecentlyActioned
        ) {
          triggeredAlarmsRef.current.add(r.id);
          return;
        }

        // Trigger 1-minute alarm at dueTimestamp.
        // Once 1 minute (60,000 ms) passes without user reaction, immediately move the reminder's dueTimestamp
        // to +15 minutes in the future (> NOW) so it appears after NOW in the timeline and NEVER triggers AlarmModal when opening the app!
        const REPEAT_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
        const ONE_MINUTE_MS = 60 * 1000; // 1 minute active alarm window
        const elapsedMs = now - r.dueTimestamp;
        if (
          (r.status === 'pending' || r.status === 'postponed') &&
          elapsedMs >= 0
        ) {
          if (elapsedMs >= ONE_MINUTE_MS) {
            // 1 minute has elapsed without reaction: advance dueTimestamp forward in 15m increments to the future (> now)
            const completedCycles = Math.floor(elapsedMs / REPEAT_INTERVAL_MS);
            const cycleOffsetMs = elapsedMs - completedCycles * REPEAT_INTERVAL_MS;
            if (cycleOffsetMs < ONE_MINUTE_MS && completedCycles <= 25) {
              // Currently inside the 1-minute ringing window of a 15-minute repeat cycle
              const currentCycleStart = r.dueTimestamp + completedCycles * REPEAT_INTERVAL_MS;
              const cycleKey = `${r.id}_${currentCycleStart}_0`;
              if (
                !triggeredAlarmsRef.current.has(cycleKey) &&
                !triggeredAlarmsRef.current.has(r.id)
              ) {
                triggeredAlarmsRef.current.add(cycleKey);
                const updatedForCycle: Reminder = { ...r, dueTimestamp: currentCycleStart, status: 'postponed' };
                setActiveAlarmReminder(updatedForCycle);
                triggerOutOfAppPersistentNotification(updatedForCycle, settings).catch(() => {});
              }
            } else {
              // Outside the 1-minute window: move dueTimestamp to the next 15-minute mark after NOW in the timeline
              const nextFutureDue = r.dueTimestamp + (completedCycles + 1) * REPEAT_INTERVAL_MS;
              setActiveAlarmReminder((curr) => (curr?.id === r.id ? null : curr));
              setReminders((prev) => {
                const nextList = prev.map((item) =>
                  item.id === r.id
                    ? {
                        ...item,
                        dueTimestamp: nextFutureDue,
                        status: 'postponed' as ReminderStatus,
                        postponedAt: now,
                        acknowledged: false,
                      }
                    : item
                );
                try {
                  localStorage.setItem(REMINDERS_STORAGE_KEY, JSON.stringify(nextList));
                } catch {}
                return nextList;
              });
            }
            return;
          }

          const cycleKey = `${r.id}_${r.dueTimestamp}_0`;
          if (
            !triggeredAlarmsRef.current.has(cycleKey) &&
            !triggeredAlarmsRef.current.has(r.id)
          ) {
            triggeredAlarmsRef.current.add(cycleKey);
            setActiveAlarmReminder({ ...r });

            // Trigger out-of-app notification alongside in-app modal
            triggerOutOfAppPersistentNotification(
              r,
              settings
            ).catch(() => {});
          }
        }
      });
    };

    // Run immediately
    checkAlarms();

    const timer = setInterval(checkAlarms, 1000);

    // Visibility and focus listeners to trigger alarms immediately upon returning
    const handleVisibilityOrFocus = () => {
      checkAlarms();
    };
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);

    // Unthrottled Web Worker timer so background tabs / minimized windows trigger notifications immediately
    let worker: Worker | null = null;
    try {
      const blob = new Blob(
        ['setInterval(() => postMessage("tick"), 1000);'],
        { type: 'application/javascript' }
      );
      worker = new Worker(URL.createObjectURL(blob));
      worker.onmessage = () => {
        checkAlarms();
      };
    } catch {
      // Worker fallback
    }

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      if (worker) {
        worker.terminate();
      }
    };
  }, [reminders]);

  // Geofence Evaluation Engine: Monitors user coordinates and evaluates both location-based reminders and saved location geofences
  useEffect(() => {
    if (!isGeofenceActive) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;

    // Check if there are any active location reminders or saved location checkpoints
    const hasActiveReminderGeofences = reminders.some(
      (r) => (r.status === 'pending' || r.status === 'postponed') && r.geofence && r.geofence.enabled
    );
    const hasActiveLocationCheckpoints = savedLocations.some(
      (l) => l.geofence && l.geofence.enabled
    );
    if (!hasActiveReminderGeofences && !hasActiveLocationCheckpoints) return;

    let isMounted = true;
    let timerId: any = null;

    const runGeofenceCheck = async () => {
      // Never prompt for Location permission automatically in background/startup;
      // only poll GPS if geolocation permission has already been granted inside the app.
      if (navigator.permissions && navigator.permissions.query) {
        try {
          const permStatus = await navigator.permissions.query({ name: 'geolocation' as any });
          if (permStatus.state !== 'granted') {
            return;
          }
        } catch {
          // ignore
        }
      }
      if (!isMounted) return;

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (!isMounted) return;
          const userPos: UserPosition = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            timestamp: pos.timestamp || Date.now(),
          };

          setCurrentUserPosition(userPos);
          saveLastKnownPosition(userPos);

          // 1. Evaluate saved location geofences (حصارهای مکانی ثبت‌شده)
          if (hasActiveLocationCheckpoints) {
            evaluateSavedLocationGeofences(userPos, savedLocations, (event: SavedLocationTriggerEvent) => {
              const displayLocTitle = formatSavedLocationTitle(event.location.title, settings.language);
              const actionText = event.triggerType === 'enter' 
                ? (isEn ? 'Entered radius of' : 'ورود به محدوده') 
                : (isEn ? 'Exited radius of' : 'خروج از محدوده');
              const titleText = isEn 
                ? `📍 Geofence Alert: ${displayLocTitle}` 
                : `📍 اعلام حصار مکانی: ${displayLocTitle}`;
              const bodyText = event.location.geofence?.customMessage 
                ? event.location.geofence.customMessage 
                : `${actionText} ${displayLocTitle} (${isEn ? `Distance: ${Math.round(event.distance)}m` : `فاصله: ${toPersianDigits(Math.round(event.distance))} متر`})`;

              // Native push notification
              fireImmediateLocalNotification(titleText, bodyText, { locationId: event.location.id, geofence: true });
              // In-app alert banner
              showSyncNotification(`${titleText} — ${bodyText}`);

              // Audio alarm and speech
              if (event.location.geofence?.playAudio !== false) {
                playPhoneAlarmSound('radar');
                speakReminderText(bodyText, undefined, settings.ttsVoiceRate ?? 0.95, settings.language || 'fa');
              }

              // Update savedLocation state
              setSavedLocations((prev) =>
                prev.map((loc) =>
                  loc.id === event.location.id
                    ? {
                        ...loc,
                        geofence: loc.geofence
                          ? { ...loc.geofence, lastTriggeredAt: Date.now(), hasTriggered: true }
                          : undefined,
                      }
                    : loc
                )
              );
            });
          }

          // 2. Evaluate legacy reminder geofences if any exist
          if (hasActiveReminderGeofences) {
            evaluateGeofences(userPos, reminders, (event: GeofenceTriggerEvent) => {
              setActiveAlarmReminder(event.reminder);

              const actionText = event.triggerType === 'enter' ? 'رسیدن به محدوده' : 'خروج از محدوده';
              fireImmediateLocalNotification(
                `📍 هشدار مکان: ${event.reminder.title}`,
                `${actionText} ${event.reminder.geofence?.locationName || 'مکان ثبت‌شده'} (فاصله: ${event.distance} متر)`,
                { reminderId: event.reminder.id, geofence: true }
              );

              setReminders((prev) =>
                prev.map((item) =>
                  item.id === event.reminder.id
                    ? {
                        ...item,
                        geofence: item.geofence
                          ? { ...item.geofence, lastTriggeredAt: Date.now(), hasTriggered: true }
                          : undefined,
                      }
                    : item
                )
              );
            });
          }

          // Schedule next check with adaptive battery-saving interval
          const nextInterval = getAdaptivePollingInterval(userPos, reminders, savedLocations);
          timerId = setTimeout(runGeofenceCheck, nextInterval);
        },
        () => {
          // Graceful fallback: retry in 60s if GPS temporarily fails
          if (!isMounted) return;
          timerId = setTimeout(runGeofenceCheck, 60000);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
      );
    };

    // Initial check
    runGeofenceCheck();

    return () => {
      isMounted = false;
      if (timerId) clearTimeout(timerId);
    };
  }, [reminders, savedLocations, isGeofenceActive]);

  const handleToggleGeofenceService = (newState?: boolean) => {
    setIsGeofenceActive((prev) => {
      const nextVal = typeof newState === 'boolean' ? newState : !prev;
      setGeofenceTrackingEnabled(nextVal);
      if (nextVal) {
        requestLocationPermission().catch(() => {});
      }
      showSyncNotification(
        nextVal
          ? (isEn ? 'Geofence radar activated' : 'رادار پایش حصار مکانی فعال شد')
          : (isEn ? 'Geofence radar paused' : 'رادار پایش حصار مکانی متوقف شد')
      );
      return nextVal;
    });
  };

  const handleToggleLocationCheckpoint = (locationId: string) => {
    setSavedLocations((prev) =>
      prev.map((loc) => {
        if (loc.id !== locationId) return loc;
        if (!loc.geofence) return loc;
        const willBeActive = !loc.geofence.enabled;
        showSyncNotification(
          willBeActive
            ? (isEn ? `Geofence activated for ${loc.title}` : `حصار مکانی ${loc.title} فعال شد`)
            : (isEn ? `Geofence paused for ${loc.title}` : `حصار مکانی ${loc.title} متوقف شد`)
        );
        return {
          ...loc,
          geofence: { ...loc.geofence, enabled: willBeActive },
        };
      })
    );
  };

  const handleSimulateLocationCheckpointTrigger = (location: SavedLocation, type: 'enter' | 'exit') => {
    const displayLocTitle = formatSavedLocationTitle(location.title, settings.language);
    const actionText = type === 'enter' 
      ? (isEn ? 'Entered radius of' : 'ورود به محدوده') 
      : (isEn ? 'Exited radius of' : 'خروج از محدوده');
    const titleText = isEn 
      ? `📍 Geofence Alert: ${displayLocTitle}` 
      : `📍 اعلام حصار مکانی: ${displayLocTitle}`;
    const bodyText = location.geofence?.customMessage 
      ? location.geofence.customMessage 
      : `${actionText} ${displayLocTitle} (${isEn ? 'Simulation Test' : 'تست شبیه‌سازی'})`;

    fireImmediateLocalNotification(titleText, bodyText, { locationId: location.id, geofence: true });
    showSyncNotification(`${titleText} — ${bodyText}`);

    if (location.geofence?.playAudio !== false) {
      playPhoneAlarmSound('radar');
      speakReminderText(bodyText, undefined, settings.ttsVoiceRate ?? 0.95, settings.language || 'fa');
    }
  };

  const handleToggleReminderGeofence = (reminderId: string) => {
    setReminders((prev) =>
      prev.map((r) => {
        if (r.id !== reminderId) return r;
        if (!r.geofence) return r;
        const willBeEnabled = !r.geofence.enabled;
        return {
          ...r,
          geofence: {
            ...r.geofence,
            enabled: willBeEnabled,
          },
        };
      })
    );
    showSyncNotification(
      isEn ? 'Geofence status updated' : 'وضعیت حصار مکانی به‌روزرسانی شد'
    );
  };

  const handleSimulateGeofenceTrigger = (reminder: Reminder) => {
    setActiveAlarmReminder(reminder);
    const actionText = isEn ? 'Arrival simulated at' : 'شبیه‌سازی ورود به';
    fireImmediateLocalNotification(
      `📍 هشدار حصار مکانی: ${reminder.title}`,
      `${actionText} ${reminder.geofence?.locationName || 'مکان حصار مکانی'}`,
      { reminderId: reminder.id, geofence: true }
    );
    setReminders((prev) =>
      prev.map((item) =>
        item.id === reminder.id
          ? {
              ...item,
              geofence: item.geofence
                ? { ...item.geofence, lastTriggeredAt: Date.now(), hasTriggered: true }
                : undefined,
            }
          : item
      )
    );
  };

  const handleRefreshUserGps = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      showSyncNotification(isEn ? 'GPS not supported on device' : 'سخت‌افزار دستگاه از GPS پشتیبانی نمی‌کند');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const userPos: UserPosition = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp || Date.now(),
        };
        setCurrentUserPosition(userPos);
        saveLastKnownPosition(userPos);
        showSyncNotification(
          isEn 
            ? `GPS updated (±${Math.round(userPos.accuracy)}m)` 
            : `موقعیت GPS ثبت شد (دقت: ±${toPersianDigits(Math.round(userPos.accuracy))} متر)`
        );
      },
      (err) => {
        showSyncNotification(isEn ? 'Failed to get GPS' : 'خطا در دریافت مختصات GPS');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // Google sign in / out handlers
  const handleGoogleSignIn = async (options?: {
    openCalendar?: boolean;
  }) => {
    try {
      const result = await signInWithGoogle(options);
      setGoogleUser(result.user);
      setGoogleToken(result.accessToken);
      showSyncNotification(
        isEn
          ? 'Google Calendar connected.'
          : 'حساب تقویم گوگل (Google Calendar) متصل و باز شد.'
      );
    } catch (err: any) {
      showSyncNotification(
        (isEn ? 'Google connection error: ' : 'خطا در اتصال به حساب گوگل: ') + (err?.message || '')
      );
    }
  };

  const handleGoogleSignOut = async () => {
    try {
      await signOutGoogle();
      setGoogleUser(null);
      setGoogleToken(null);
      showSyncNotification('از حساب گوگل خارج شدید.');
    } catch (err: any) {
      console.error('Sign out error:', err);
    }
  };

  const showSyncNotification = (msg: string) => {
    setSyncToast(msg);
    setTimeout(() => setSyncToast(null), 3500);
  };

  // Handler: Save Reminder
  const handleSaveReminder = async (
    data: Omit<Reminder, 'id' | 'createdAt' | 'status' | 'postponeCount'>,
    syncGoogle?: boolean
  ) => {
    let calendarEventId: string | undefined = undefined;

    // Check native notification permission on Android/browser
    if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
      requestNotificationPermission().then((granted) => {
        if (!granted) {
          setAndroidPermissionModal({
            isOpen: true,
            type: 'notifications',
            onRetry: () => requestNotificationPermission(),
          });
        }
      });
    }

    // If geofence is enabled, ensure location permission is active and enable geofence tracking
    if (data.geofence?.enabled) {
      setIsGeofenceActive(true);
      setGeofenceTrackingEnabled(true);
      requestLocationPermission().then((locGranted) => {
        if (!locGranted) {
          setAndroidPermissionModal({
            isOpen: true,
            type: 'location',
            onRetry: () => requestLocationPermission(),
          });
        }
      });
    }

    // Optional Google Calendar sync
    if (syncGoogle && googleToken) {
      try {
        const dummyReminder: Reminder = {
          ...data,
          id: 'temp',
          createdAt: Date.now(),
          status: 'pending',
          postponeCount: 0,
        };
        calendarEventId = await syncReminderToCalendar(dummyReminder, googleToken);
        showSyncNotification('یادآور با Google Calendar همگام‌سازی شد.');
      } catch (err: any) {
        console.warn('Calendar sync error:', err);
        showSyncNotification('ذخیره محلی انجام شد (همگام‌سازی تقویم با خطا مواجه شد)');
      }
    }

    if (editingReminder) {
      triggeredAlarmsRef.current.delete(editingReminder.id);
      recentNotificationActionsRef.current.delete(editingReminder.id);
      const updatedReminder: Reminder = {
        ...editingReminder,
        ...data,
        status: data.dueTimestamp >= Date.now() ? 'pending' : editingReminder.status,
        acknowledged: false,
        lastActionAt: undefined,
        googleCalendarEventId: calendarEventId || editingReminder.googleCalendarEventId,
      };

      // Reschedule Android Local Notification
      rescheduleReminderNotification(editingReminder.id, updatedReminder, settings).catch(() => {});

      setReminders((prev) =>
        prev.map((r) =>
          r.id === editingReminder.id ? updatedReminder : r
        )
      );
      setEditingReminder(null);
    } else {
      const newId = 'rem_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      const newReminder: Reminder = {
        ...data,
        id: newId,
        notificationId: getNotificationId(newId),
        createdAt: Date.now(),
        status: 'pending',
        acknowledged: false,
        postponeCount: 0,
        googleCalendarEventId: calendarEventId,
      };

      // Schedule Android Local Notification
      scheduleReminderNotification(newReminder, settings).catch(() => {});

      setReminders((prev) => [newReminder, ...prev]);
    }
    setActiveMainTab('reminders');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Handler: Save / Edit Idea Note
  const handleSaveIdea = (newIdeaData: Omit<IdeaNote, 'id' | 'createdAt'>) => {
    if (editingIdea) {
      setIdeas((prev) =>
        prev.map((i) => (i.id === editingIdea.id ? { ...i, ...newIdeaData } : i))
      );
      setEditingIdea(null);
      showSyncNotification('ایده با موفقیت ویرایش شد.');
    } else {
      const newIdea: IdeaNote = {
        ...newIdeaData,
        id: 'idea_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        createdAt: Date.now(),
      };
      setIdeas((prev) => [newIdea, ...prev]);
      showSyncNotification('ایده با موفقیت ذخیره شد.');
    }
    setActiveMainTab('reminders');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteIdea = (id: string) => {
    setIdeas((prev) =>
      prev.map((i) => (i.id === id ? { ...i, deletedAt: Date.now() } : i))
    );
    showSyncNotification(settings.language === 'en' ? 'Idea moved to recycle bin.' : 'ایده به سطل بازیافت منتقل شد.');
  };

  // Handler: Save / Edit Location (ثبت لوکیشن با تکیه بر GPS و گوگل مپ)
  const handleSaveLocation = (
    newLocData: Omit<SavedLocation, 'id' | 'createdAt'>,
    alsoCreateReminder?: boolean
  ) => {
    if (newLocData.geofence?.enabled) {
      setIsGeofenceActive(true);
      setGeofenceTrackingEnabled(true);
      requestLocationPermission().catch(() => {});
    }
    if (editingLocation) {
      setSavedLocations((prev) =>
        prev.map((l) => (l.id === editingLocation.id ? { ...l, ...newLocData } : l))
      );
      setEditingLocation(null);
      showSyncNotification('موقعیت مکانی با موفقیت ویرایش شد.');
    } else {
      const newLocation: SavedLocation = {
        ...newLocData,
        id: 'loc_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        createdAt: Date.now(),
      };
      setSavedLocations((prev) => [newLocation, ...prev]);
      showSyncNotification('موقعیت مکانی با موفقیت ذخیره شد.');

      // If user checked "ثبت همزمان در لیست یادآورها"
      if (alsoCreateReminder) {
        const reminderPayload: Reminder = {
          id: 'rem_loc_' + Date.now(),
          title: `مراجعه به مکان: ${newLocData.title}`,
          description: `${newLocData.description ? newLocData.description + '\n' : ''}لینک گوگل مپ: ${newLocData.googleMapsUrl}`,
          category: 'work',
          priority: 'medium',
          dueTimestamp: Date.now() + 3600000 * 2, // 2 hours from now
          status: 'pending',
          createdAt: Date.now(),
          postponeCount: 0,
          ringTune: 'work',
          voiceReadAloud: false,
          imageUrl: newLocData.photoUrl,
        };
        setReminders((prev) => [reminderPayload, ...prev]);
      }
    }
    setActiveMainTab('reminders');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteLocation = (id: string) => {
    setSavedLocations((prev) =>
      prev.map((loc) => (loc.id === id ? { ...loc, deletedAt: Date.now() } : loc))
    );
    showSyncNotification(settings.language === 'en' ? 'Location moved to recycle bin.' : 'مکان به سطل بازیافت منتقل شد.');
  };

  // Handler: Save / Edit Occasion (مناسبت‌ها: تولد، سالگردها و رویدادهای مهم)
  const handleSaveOccasion = (
    newOccData: Omit<Occasion, 'id' | 'createdAt'>,
    alsoCreateReminder?: boolean
  ) => {
    if (editingOccasion) {
      setOccasions((prev) =>
        prev.map((o) => (o.id === editingOccasion.id ? { ...o, ...newOccData } : o))
      );
      setEditingOccasion(null);
      showSyncNotification('مناسبت با موفقیت ویرایش شد.');
    } else {
      const newOccasion: Occasion = {
        ...newOccData,
        id: 'occ_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        createdAt: Date.now(),
      };
      setOccasions((prev) => [newOccasion, ...prev]);
      showSyncNotification('مناسبت جدید با موفقیت ثبت شد.');

      // Automatically create a Reminder with alarm if requested
      if (alsoCreateReminder) {
        const reminderPayload = createReminderFromOccasion(newOccasion);
        handleSaveReminder(reminderPayload);
      }
    }
    setActiveMainTab('occasions');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteOccasion = (id: string) => {
    setOccasions((prev) =>
      prev.map((o) => (o.id === id ? { ...o, deletedAt: Date.now() } : o))
    );
    showSyncNotification(settings.language === 'en' ? 'Occasion moved to recycle bin.' : 'مناسبت به سطل بازیافت منتقل شد.');
  };

  const handleCreateReminderFromOccasion = (occasion: Occasion) => {
    const reminderPayload = createReminderFromOccasion(occasion);
    handleSaveReminder(reminderPayload);
    showSyncNotification(`آلارم یادآور برای مناسبت «${occasion.title}» تنظیم شد.`);
  };

  // Handler: Restore local backup data (پشتیبان‌گیری و بازیابی محلی)
  const handleRestoreData = (
    data: {
      reminders?: Reminder[];
      ideas?: IdeaNote[];
      savedLocations?: SavedLocation[];
      occasions?: Occasion[];
      settings?: Partial<AppSettings>;
    },
    mode: 'replace' | 'merge',
    shouldReload = false
  ) => {
    // 1. Sanitize incoming arrays (mark past-due restored reminders as acknowledged so they don't fire false alarms)
    const restoreNow = Date.now();
    const cleanReminders = (data.reminders || [])
      .filter((r) => r?.id && !r.id.startsWith('seed-'))
      .map((r) => {
        if (r.dueTimestamp <= restoreNow || r.deletedAt) {
          triggeredAlarmsRef.current.add(r.id);
          return r.dueTimestamp <= restoreNow ? { ...r, acknowledged: true } : r;
        }
        return r;
      });
    const cleanIdeas = (data.ideas || []).filter(
      (i) => i?.id && i.id !== 'idea-1' && !i.id.startsWith('seed-')
    );
    const cleanLocations = (data.savedLocations || []).filter(
      (l) => l?.id && !l.id.startsWith('seed-') && !l.id.startsWith('sample_')
    );
    const cleanOccasions = (data.occasions || []).filter(
      (o) =>
        o?.id &&
        o.id !== 'sample_occ_1' &&
        o.id !== 'sample_occ_2' &&
        !o.id.startsWith('sample_') &&
        !o.id.startsWith('seed-')
    );

    let finalReminders: Reminder[] = [];
    let finalIdeas: IdeaNote[] = [];
    let finalLocations: SavedLocation[] = [];
    let finalOccasions: Occasion[] = [];
    let finalSettings: AppSettings = settingsRef.current;

    if (mode === 'replace') {
      finalReminders = cleanReminders;
      finalIdeas = cleanIdeas;
      finalLocations = cleanLocations;
      finalOccasions = cleanOccasions;
      if (data.settings) {
        finalSettings = { ...settingsRef.current, ...data.settings };
      }
    } else {
      // Merge mode: keep unique IDs
      const curR = remindersRef.current;
      const curRIds = new Set(curR.map((r) => r.id));
      const newR = cleanReminders.filter((r) => !curRIds.has(r.id));
      finalReminders = [...newR, ...curR];

      const curI = ideasRef.current;
      const curIIds = new Set(curI.map((i) => i.id));
      const newI = cleanIdeas.filter((i) => !curIIds.has(i.id));
      finalIdeas = [...newI, ...curI];

      const curL = savedLocationsRef.current;
      const curLIds = new Set(curL.map((l: SavedLocation) => l.id));
      const newL = cleanLocations.filter((l: SavedLocation) => !curLIds.has(l.id));
      finalLocations = [...newL, ...curL];

      const curO = occasionsRef.current;
      const curOIds = new Set(curO.map((o) => o.id));
      const newO = cleanOccasions.filter((o) => !curOIds.has(o.id));
      finalOccasions = [...newO, ...curO];

      if (data.settings) {
        finalSettings = { ...settingsRef.current, ...data.settings };
      }
    }

    // 2. Persist directly and immediately into the exact localStorage keys
    try {
      localStorage.setItem(REMINDERS_STORAGE_KEY, JSON.stringify(finalReminders));
      localStorage.setItem(IDEAS_STORAGE_KEY, JSON.stringify(finalIdeas));
      localStorage.setItem(LOCATIONS_STORAGE_KEY, JSON.stringify(finalLocations));
      localStorage.setItem(OCCASIONS_STORAGE_KEY, JSON.stringify(finalOccasions));
      if (finalSettings) {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(finalSettings));
      }

      // Also update backup vault in localStorage
      const vaultPayload = {
        version: 3,
        updatedAt: Date.now(),
        folder: finalSettings?.localBackupFolderName || 'Yaad reminder',
        source: 'local_folder',
        reminders: finalReminders,
        ideas: finalIdeas,
        savedLocations: finalLocations,
        occasions: finalOccasions,
        settings: finalSettings,
      };
      localStorage.setItem(AUTO_BACKUP_STORAGE_KEY, JSON.stringify(vaultPayload));
      localStorage.setItem(LAST_LOCAL_BACKUP_KEY, String(Date.now()));
    } catch (err) {
      console.warn('[handleRestoreData] Error writing to localStorage:', err);
    }

    // 3. Update React states
    setReminders(finalReminders);
    setIdeas(finalIdeas);
    setSavedLocations(finalLocations);
    setOccasions(finalOccasions);
    setSettings(finalSettings);

    // 4. Re-schedule local notifications for all pending restored reminders
    syncAllRemindersWithLocalNotifications(finalReminders, finalSettings).catch(() => {});

    // 5. Success toast
    const totalCount =
      finalReminders.length + finalIdeas.length + finalLocations.length + finalOccasions.length;
    showSyncNotification(
      settingsRef.current?.language === 'en'
        ? `Data restored successfully (${totalCount} items).`
        : `داده‌ها با موفقیت بازیابی و در حافظه ذخیره شدند (${toPersianDigits(totalCount)} مورد).`
    );

    if (shouldReload) {
      setTimeout(() => {
        window.location.reload();
      }, 1200);
    }
  };

  // Handler: Complete reminder explicitly (called by Alarm Modal, notifications, and complete actions)
  // Guarantees stopping sound, closing modal, and prevents re-triggering
  const handleCompleteReminder = (id: string) => {
    stopAlarmRinging();
    setActiveAlarmReminder((curr) => (curr?.id === id ? null : curr));
    triggeredAlarmsRef.current.add(id);
    recordNotificationAction(id);

    // Clear continuous out-of-app & Android Local Notification for completed reminder
    clearOutOfAppPersistentNotification(id);
    cancelReminderNotification(id).catch(() => {});
    dismissDeliveredNotifications(id).catch(() => {});

    setReminders((prev) => {
      const updated = prev.map((r) => {
        if (r.id === id) {
          // If recurring reminder is being marked completed, advance to next recurrence (unless recurrenceCount reached 1)
          const hasRemainingRepeats = r.recurrenceCount === undefined || r.recurrenceCount > 1;
          if (r.recurrence && r.recurrence !== 'none' && hasRemainingRepeats) {
            const nextDue = getNextRecurrenceTimestamp(r, Date.now());
            if (nextDue) {
              const recurringUpdated: Reminder = {
                ...r,
                dueTimestamp: nextDue,
                recurrenceCount: r.recurrenceCount && r.recurrenceCount > 1 ? r.recurrenceCount - 1 : undefined,
                status: 'pending',
                completedAt: undefined,
                postponeCount: 0,
                acknowledged: false,
                lastActionAt: Date.now(),
              };
              // Schedule next recurrence in Android Local Notifications
              scheduleReminderNotification(recurringUpdated, settings).catch(() => {});

              if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
                confetti({
                  particleCount: 50,
                  spread: 60,
                  origin: { y: 0.8 },
                });
              }
              showSyncNotification(`✓ انجام شد! نوبت بعدی برای ${formatJalaliFull(nextDue)} زمان‌بندی شد.`);
              return recurringUpdated;
            }
          }

          // Non-recurring or completed custom dates
          if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
            confetti({
              particleCount: 50,
              spread: 60,
              origin: { y: 0.8 },
            });
          }
          return {
            ...r,
            status: 'completed' as ReminderStatus,
            completedAt: Date.now(),
            acknowledged: true,
            lastActionAt: Date.now(),
          };
        }
        return r;
      });

      try {
        localStorage.setItem(REMINDERS_STORAGE_KEY, JSON.stringify(updated));
      } catch (err) {
        console.error('Failed to sync completed reminder to localStorage:', err);
      }
      return updated;
    });
  };

  handleCompleteReminderRef.current = handleCompleteReminder;

  // Handler: Toggle complete from reminder card list checkbox
  const handleToggleComplete = (id: string) => {
    stopAlarmRinging();
    setActiveAlarmReminder((curr) => (curr?.id === id ? null : curr));

    setReminders((prev) => {
      const target = prev.find((r) => r.id === id);
      if (!target) return prev;
      if (target.status !== 'completed') {
        triggeredAlarmsRef.current.add(id);
        recordNotificationAction(id);
        // Clear continuous out-of-app & Android Local Notification
        clearOutOfAppPersistentNotification(id);
        cancelReminderNotification(id).catch(() => {});
        dismissDeliveredNotifications(id).catch(() => {});

        confetti({
          particleCount: 50,
          spread: 60,
          origin: { y: 0.8 },
        });

        const hasRemainingRepeats = target.recurrenceCount === undefined || target.recurrenceCount > 1;
        if (target.recurrence && target.recurrence !== 'none' && hasRemainingRepeats) {
          const nextDue = getNextRecurrenceTimestamp(target, Date.now());
          if (nextDue) {
            const recurringNext: Reminder = {
              ...target,
              dueTimestamp: nextDue,
              recurrenceCount: target.recurrenceCount && target.recurrenceCount > 1 ? target.recurrenceCount - 1 : undefined,
              status: 'pending',
              completedAt: undefined,
              postponeCount: 0,
              acknowledged: false,
              lastActionAt: Date.now(),
            };
            scheduleReminderNotification(recurringNext, settings).catch(() => {});

            showSyncNotification(`✓ انجام شد! نوبت بعدی برای ${formatJalaliFull(nextDue)} زمان‌بندی شد.`);
            const nextList = prev.map((r) => (r.id === id ? recurringNext : r));
            try {
              localStorage.setItem(REMINDERS_STORAGE_KEY, JSON.stringify(nextList));
            } catch {}
            return nextList;
          }
        }

        const nextList = prev.map((r) =>
          r.id === id
            ? {
                ...r,
                status: 'completed' as const,
                completedAt: Date.now(),
                acknowledged: true,
                lastActionAt: Date.now(),
              }
            : r
        );
        try {
          localStorage.setItem(REMINDERS_STORAGE_KEY, JSON.stringify(nextList));
        } catch {}
        return nextList;
      }

      // If user deliberately un-completes a completed reminder in the list
      triggeredAlarmsRef.current.delete(id);
      if (target.dueTimestamp > Date.now()) {
        scheduleReminderNotification({ ...target, status: 'pending', acknowledged: false }, settings).catch(() => {});
      }
      const nextList = prev.map((r) =>
        r.id === id
          ? {
              ...r,
              status: 'pending' as const,
              completedAt: undefined,
              acknowledged: false,
            }
          : r
      );
      try {
        localStorage.setItem(REMINDERS_STORAGE_KEY, JSON.stringify(nextList));
      } catch {}
      return nextList;
    });
  };

  // Handler: Postpone reminder
  const handlePostpone = (id: string, minutes: number, explicitDueTimestamp?: number) => {
    stopAlarmRinging();
    setActiveAlarmReminder((curr) => (curr?.id === id ? null : curr));
    recordNotificationAction(id);
    clearOutOfAppPersistentNotification(id);
    cancelReminderNotification(id).catch(() => {});
    dismissDeliveredNotifications(id).catch(() => {});

    setReminders((prev) => {
      const updated = prev.map((r) => {
        if (r.id === id) {
          const newDue =
            typeof explicitDueTimestamp === 'number' && explicitDueTimestamp > 0
              ? explicitDueTimestamp
              : Math.max(Date.now(), r.dueTimestamp) + minutes * 60000;
          triggeredAlarmsRef.current.delete(id);
          const postponedRem: Reminder = {
            ...r,
            dueTimestamp: newDue,
            status: 'postponed' as ReminderStatus,
            postponedAt: Date.now(),
            postponeCount: (r.postponeCount || 0) + 1,
            acknowledged: false,
            lastActionAt: Date.now(),
          };
          // Reschedule notification for the new postponed time if it is still in the future
          if (newDue > Date.now()) {
            rescheduleReminderNotification(id, postponedRem, settings).catch(() => {});
          }
          return postponedRem;
        }
        return r;
      });

      try {
        localStorage.setItem(REMINDERS_STORAGE_KEY, JSON.stringify(updated));
      } catch (err) {
        console.error('Failed to sync postponed reminder to localStorage:', err);
      }
      return updated;
    });
  };

  handlePostponeRef.current = handlePostpone;

  // Handler: Stop / Dismiss alarm explicitly (called by Alarm Modal onDismiss, notification Stop action)
  const handleStopOrDismissReminder = (id: string) => {
    stopAlarmRinging();
    setActiveAlarmReminder((curr) => (curr?.id === id ? null : curr));
    triggeredAlarmsRef.current.add(id);
    recordNotificationAction(id);

    // Cancel continuous out-of-app & Android Local Notification immediately
    clearOutOfAppPersistentNotification(id);
    cancelReminderNotification(id).catch(() => {});
    dismissDeliveredNotifications(id).catch(() => {});

    setReminders((prev) => {
      const updated = prev.map((r) => {
        if (r.id === id) {
          return {
            ...r,
            acknowledged: true,
            notifiedAt: Date.now(),
            lastActionAt: Date.now(),
          };
        }
        return r;
      });

      try {
        localStorage.setItem(REMINDERS_STORAGE_KEY, JSON.stringify(updated));
      } catch (err) {
        console.error('Failed to sync dismissed reminder to localStorage:', err);
      }
      return updated;
    });
  };

  handleStopOrDismissReminderRef.current = handleStopOrDismissReminder;

  // Handler: When 1-minute alarm finishes without user reaction:
  // 1. Silence current 1-minute ring & close in-app alarm modal
  // 2. Keep the dropdown shade notification pinned at the top (do NOT dismiss delivered notification)
  // 3. Move the reminder's dueTimestamp to +15 minutes in the future so it is positioned after NOW in the timeline
  //    and opening the app never triggers the in-app alarm modal until the next 15-minute due time arrives.
  const handleNoReactionTimeout = (id: string, explicitNextDueTimestamp?: number) => {
    stopAlarmRinging();
    setActiveAlarmReminder((curr) => (curr?.id === id ? null : curr));

    setReminders((prev) => {
      const now = Date.now();
      const updated = prev.map((r) => {
        if (r.id === id) {
          const nextDue =
            typeof explicitNextDueTimestamp === 'number' && explicitNextDueTimestamp > now
              ? explicitNextDueTimestamp
              : Math.max(now, r.dueTimestamp) + 15 * 60000;
          triggeredAlarmsRef.current.delete(id);
          return {
            ...r,
            dueTimestamp: nextDue,
            status: 'postponed' as ReminderStatus,
            postponedAt: now,
            acknowledged: false,
          };
        }
        return r;
      });

      try {
        localStorage.setItem(REMINDERS_STORAGE_KEY, JSON.stringify(updated));
      } catch (err) {
        console.error('Failed to sync 1m unanswered reminder to localStorage:', err);
      }
      return updated;
    });
  };

  handleNoReactionTimeoutRef.current = handleNoReactionTimeout;

  // Handler: Delete reminder (soft delete into Recycle Bin)
  const handleDelete = (id: string) => {
    stopAlarmRinging();
    setActiveAlarmReminder((curr) => (curr?.id === id ? null : curr));
    triggeredAlarmsRef.current.delete(id);

    // Cancel continuous out-of-app & Android Local Notification immediately
    clearOutOfAppPersistentNotification(id);
    cancelReminderNotification(id).catch(() => {});

    const targetIndex = reminders.findIndex((r) => r.id === id);
    const targetReminder = reminders[targetIndex];

    if (targetReminder) {
      if (undoToast?.timer) {
        clearTimeout(undoToast.timer);
      }

      const timer = setTimeout(() => {
        setUndoToast(null);
      }, 5000);

      setUndoToast({
        reminder: targetReminder,
        index: targetIndex >= 0 ? targetIndex : 0,
        timer,
      });
    }

    // Soft delete: keep in storage with deletedAt timestamp for Recycle Bin
    setReminders((prev) =>
      prev.map((r) => (r.id === id ? { ...r, deletedAt: Date.now() } : r))
    );
    showSyncNotification(settings.language === 'en' ? 'Reminder moved to recycle bin.' : 'یادآور به سطل بازیافت منتقل شد.');
  };

  const handleUndoDelete = () => {
    if (!undoToast) return;
    if (undoToast.timer) clearTimeout(undoToast.timer);

    const restored = undoToast.reminder;

    // Reschedule restored reminder if pending and in the future
    if (restored.status === 'pending' && restored.dueTimestamp > Date.now()) {
      scheduleReminderNotification(restored, settings).catch(() => {});
    }

    setReminders((prev) =>
      prev.map((r) => (r.id === restored.id ? { ...r, deletedAt: undefined } : r))
    );

    setUndoToast(null);
    showSyncNotification(settings.language === 'en' ? 'Reminder restored' : 'یادآور با موفقیت بازگردانده شد');
  };

  // Handler: Restore item from Recycle Bin
  const handleRestoreItem = (id: string, type: 'reminder' | 'location' | 'occasion' | 'idea') => {
    if (type === 'reminder') {
      setReminders((prev) =>
        prev.map((r) => {
          if (r.id === id) {
            const restored: Reminder = { ...r, deletedAt: undefined };
            if (restored.status === 'pending' && restored.dueTimestamp > Date.now()) {
              scheduleReminderNotification(restored, settings).catch(() => {});
            }
            return restored;
          }
          return r;
        })
      );
      showSyncNotification(settings.language === 'en' ? 'Reminder restored' : 'یادآور با موفقیت بازیابی شد');
    } else if (type === 'location') {
      setSavedLocations((prev) =>
        prev.map((l) => (l.id === id ? { ...l, deletedAt: undefined } : l))
      );
      showSyncNotification(settings.language === 'en' ? 'Location restored' : 'مکان با موفقیت بازیابی شد');
    } else if (type === 'occasion') {
      setOccasions((prev) =>
        prev.map((o) => (o.id === id ? { ...o, deletedAt: undefined } : o))
      );
      showSyncNotification(settings.language === 'en' ? 'Occasion restored' : 'مناسبت با موفقیت بازیابی شد');
    } else if (type === 'idea') {
      setIdeas((prev) =>
        prev.map((i) => (i.id === id ? { ...i, deletedAt: undefined } : i))
      );
      showSyncNotification(settings.language === 'en' ? 'Idea restored' : 'ایده با موفقیت بازیابی شد');
    }
  };

  // Handler: Permanent delete item from Recycle Bin
  const handlePermanentDeleteItem = (id: string, type: 'reminder' | 'location' | 'occasion' | 'idea') => {
    if (type === 'reminder') {
      cancelReminderNotification(id).catch(() => {});
      setReminders((prev) => prev.filter((r) => r.id !== id));
    } else if (type === 'location') {
      setSavedLocations((prev) => prev.filter((l) => l.id !== id));
    } else if (type === 'occasion') {
      setOccasions((prev) => prev.filter((o) => o.id !== id));
    } else if (type === 'idea') {
      setIdeas((prev) => prev.filter((i) => i.id !== id));
    }
    showSyncNotification(settings.language === 'en' ? 'Permanently deleted' : 'مورد به صورت دائمی حذف شد');
  };

  // Handler: Empty Recycle Bin
  const handleEmptyRecycleBin = () => {
    reminders.forEach((r) => {
      if (r.deletedAt) {
        cancelReminderNotification(r.id).catch(() => {});
      }
    });
    setReminders((prev) => prev.filter((r) => !r.deletedAt));
    setIdeas((prev) => prev.filter((i) => !i.deletedAt));
    setSavedLocations((prev) => prev.filter((l) => !l.deletedAt));
    setOccasions((prev) => prev.filter((o) => !o.deletedAt));
    showSyncNotification(settings.language === 'en' ? 'Recycle bin emptied' : 'سطل بازیافت خالی شد');
  };

  // Handler: Install PWA
  const handleInstallClick = async () => {
    if (installPromptEvent) {
      try {
        installPromptEvent.prompt();
        const choiceResult = await installPromptEvent.userChoice;
        if (choiceResult.outcome === 'accepted') {
          setIsAppInstalled(true);
          setInstallPromptEvent(null);
        }
      } catch (err) {
        setIsInstallModalOpen(true);
      }
    } else {
      setIsInstallModalOpen(true);
    }
  };

  // Filtered lists across ALL user-entered collections (Reminders, Ideas, Saved Locations, Occasions) supporting Persian & English
  const filteredReminders = activeReminders.filter((r) => {
    if (categoryFilter === 'completed') {
      if (r.status !== 'completed') return false;
    } else if (categoryFilter !== 'all') {
      if (r.category !== categoryFilter) return false;
    }

    if (priorityFilter !== 'all' && r.priority !== priorityFilter) {
      return false;
    }

    if (searchQuery.trim()) {
      return matchesReminderSearch(r, searchQuery);
    }

    return true;
  });

  const filteredGlobalIdeas = useMemo(
    () => (searchQuery.trim() ? activeIdeas.filter((i) => matchesIdeaSearch(i, searchQuery)) : activeIdeas),
    [activeIdeas, searchQuery]
  );

  const filteredGlobalLocations = useMemo(
    () => (searchQuery.trim() ? activeSavedLocations.filter((l) => matchesLocationSearch(l, searchQuery)) : activeSavedLocations),
    [activeSavedLocations, searchQuery]
  );

  const filteredGlobalOccasions = useMemo(
    () => (searchQuery.trim() ? activeOccasions.filter((o) => matchesOccasionSearch(o, searchQuery)) : activeOccasions),
    [activeOccasions, searchQuery]
  );

  const totalGlobalSearchMatches =
    filteredReminders.length +
    filteredGlobalIdeas.length +
    filteredGlobalLocations.length +
    filteredGlobalOccasions.length;

  // Automatically switch to the first tab with results if current tab has 0 matches during global search
  useEffect(() => {
    if (!searchQuery.trim() || totalGlobalSearchMatches === 0) return;
    if (activeMainTab === 'reminders' && filteredReminders.length > 0) return;
    if (activeMainTab === 'occasions' && filteredGlobalOccasions.length > 0) return;
    if (activeMainTab === 'locations' && filteredGlobalLocations.length > 0) return;
    if (activeMainTab === 'ideas' && filteredGlobalIdeas.length > 0) return;

    if (filteredReminders.length > 0) setActiveMainTab('reminders');
    else if (filteredGlobalOccasions.length > 0) setActiveMainTab('occasions');
    else if (filteredGlobalLocations.length > 0) setActiveMainTab('locations');
    else if (filteredGlobalIdeas.length > 0) setActiveMainTab('ideas');
  }, [
    searchQuery,
    totalGlobalSearchMatches,
    activeMainTab,
    filteredReminders.length,
    filteredGlobalOccasions.length,
    filteredGlobalLocations.length,
    filteredGlobalIdeas.length,
  ]);

  const sortedReminders = [...filteredReminders].sort((a, b) => {
    if (a.status === 'completed' && b.status !== 'completed') return 1;
    if (a.status !== 'completed' && b.status === 'completed') return -1;
    return a.dueTimestamp - b.dueTimestamp;
  });

  const upcomingReminder =
    reminders
      .filter((r) => (r.status === 'pending' || r.status === 'postponed') && r.dueTimestamp >= currentTime)
      .sort((a, b) => a.dueTimestamp - b.dueTimestamp)[0] || null;

  const upcomingCountdown = upcomingReminder
    ? (() => {
        const diffMs = Math.max(0, upcomingReminder.dueTimestamp - currentTime);
        const totalSecs = Math.floor(diffMs / 1000);
        return {
          hours: Math.floor(totalSecs / 3600),
          minutes: Math.floor((totalSecs % 3600) / 60),
          seconds: totalSecs % 60,
        };
      })()
    : null;

  const todayJalali = getJalaliComponents(currentTime);
  const todayGregorian = getGregorianComponents(currentTime);

  // Dynamic Theme CSS container styling
  const getThemeClass = (theme: AppTheme) => {
    if (theme === 'system') {
      return systemPrefersDark
        ? 'bg-[#14171A] text-[#F1F5F9] selection:bg-teal-500 selection:text-white'
        : 'bg-[#F3F5F7] text-[#1E293B] selection:bg-teal-600 selection:text-white';
    }
    switch (theme) {
      case 'dark-gold':
        return 'bg-[#07070D] text-[#F3F4F8] selection:bg-indigo-500 selection:text-white';
      case 'dark-slate':
        return 'bg-[#0A1628] text-[#EFF6FF] selection:bg-sky-500 selection:text-slate-950';
      case 'light-clean':
        return 'bg-stone-50 text-stone-900 selection:bg-indigo-600 selection:text-white';
      case 'sketch-contrast':
        return 'bg-black text-white selection:bg-white selection:text-black font-mono';
      case 'jade_warm_light':
        return 'bg-[#F7F6F0] text-[#202A29] selection:bg-[#168779] selection:text-white';
      case 'midnight_blue_silver':
        return 'bg-[#101722] text-[#F0F3F7] selection:bg-[#9CBCE0] selection:text-[#101722]';
      default:
        return 'bg-[#07070D] text-[#F3F4F8] selection:bg-indigo-500 selection:text-white';
    }
  };

  return (
    <>
      <div 
        data-theme={settings.theme}
        className={`min-h-screen flex flex-col transition-opacity duration-700 ease-out ${
          appVisible ? 'opacity-100' : 'opacity-0'
        } ${getThemeClass(settings.theme)}`}
      >
      {/* Toast Notification for Google Sync */}
      {syncToast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-2xl bg-indigo-500 text-white font-bold text-xs shadow-2xl flex items-center gap-2 animate-bounce">
          <Check className="w-4 h-4" />
          <span>{syncToast}</span>
        </div>
      )}

      {/* 5-SECOND UNDO TOAST NOTIFICATION */}
      {undoToast && (
        <div 
          className="fixed bottom-22 sm:bottom-10 left-1/2 -translate-x-1/2 z-50 px-4 py-3 rounded-2xl bg-stone-900/95 border-2 border-indigo-500/80 text-white shadow-2xl shadow-black/95 flex items-center gap-3.5 backdrop-blur-xl animate-in fade-in slide-in-from-bottom-4 duration-200"
          dir={isEn ? 'ltr' : 'rtl'}
        >
          <div className="flex items-center gap-2">
            <Trash2 className="w-4 h-4 text-red-400 shrink-0" />
            <span className="text-xs sm:text-sm font-bold truncate max-w-[170px] sm:max-w-xs">
              {isEn ? `Deleted "${undoToast.reminder.title}"` : `«${undoToast.reminder.title}» حذف شد`}
            </span>
          </div>

          <button
            type="button"
            onClick={handleUndoDelete}
            className="px-3.5 py-1.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-black text-xs flex items-center gap-1.5 transition-all shadow-md active:scale-95 cursor-pointer shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>{isEn ? 'Undo' : 'بازگردانی'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (undoToast.timer) clearTimeout(undoToast.timer);
              setUndoToast(null);
            }}
            className="p-1 rounded-lg text-stone-400 hover:text-white transition-colors cursor-pointer"
            title={isEn ? 'Dismiss' : 'بستن'}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Top Navigation Bar */}
      <header className={`sticky top-0 z-30 backdrop-blur-md border-b transition-colors duration-200 ${
        settings.theme === 'jade_warm_light'
          ? 'bg-[#F7F6F0]/95 border-[#DDE1DA] text-[#202A29] shadow-xs'
          : settings.theme === 'midnight_blue_silver'
          ? 'bg-[#101722]/95 border-[#39475A] text-[#F0F3F7]'
          : settings.theme === 'dark-slate'
          ? 'bg-[#11223D]/95 border-[#1E3A5F] text-[#EFF6FF]'
          : settings.theme === 'dark-gold'
          ? 'bg-[#101222]/95 border-[#22253E] text-[#F3F4F8]'
          : settings.theme === 'system'
          ? (isDarkMode ? 'bg-[#1C2126]/95 border-[#2B333C] text-[#F1F5F9]' : 'bg-white/95 border-[#DCE3EA] text-[#1E293B] shadow-sm')
          : isDarkMode 
          ? 'bg-stone-900/95 border-stone-800/90 text-stone-100' 
          : 'bg-white/95 border-stone-200 text-stone-900 shadow-sm'
      }`}>
        <div className="w-full px-2.5 sm:px-4 md:px-6 h-16 sm:h-18 flex items-center justify-between gap-2">
          {/* Main App Logo & Title (کادر لوگو هم‌اندازه کادر جستجو و تنظیمات، ثابت در تمام صفحات با منوی مینیمال اطلاعات و لینک‌ها) */}
          <div className="flex items-center gap-2.5 flex-shrink-0 relative" ref={logoMenuRef}>
            <button
              id="header-logo-menu-btn"
              type="button"
              onClick={() => {
                setIsLogoMenuOpen((prev) => {
                  const next = !prev;
                  if (!next) setLogoMenuInfoSection(null);
                  return next;
                });
              }}
              className={`min-h-[48px] min-w-[48px] w-12 h-12 rounded-2xl p-1 border flex items-center justify-center flex-shrink-0 group cursor-pointer active:scale-95 transition-all duration-200 shadow-md ${
                isLogoMenuOpen
                  ? 'bg-stone-900 border-indigo-500 ring-1 ring-indigo-400/50 shadow-indigo-500/20'
                  : 'bg-stone-950 border-stone-700/90 hover:border-amber-400/80 shadow-amber-500/10'
              }`}
              title={isEn ? 'App Info & Support' : 'اطلاعات برنامه و پشتیبانی'}
              aria-label={isEn ? 'App Info & Support' : 'اطلاعات برنامه و پشتیبانی'}
            >
              <img
                src={appIcon}
                alt="YAAD"
                className="w-full h-full object-cover rounded-xl transition-transform duration-200 group-hover:scale-105"
                draggable={false}
              />
            </button>

            {/* Minimal App Info, Privacy, About & Support Dropdown Menu */}
            {isLogoMenuOpen && (
              <div
                dir={isEn ? 'ltr' : 'rtl'}
                className={`absolute top-full mt-2 ${
                  isEn ? 'left-0' : 'right-0'
                } w-64 sm:w-72 rounded-2xl bg-stone-900/98 border border-stone-800 p-3 shadow-2xl backdrop-blur-xl z-50 space-y-2 animate-in fade-in zoom-in-95 duration-150`}
              >
                {/* 1. App Version */}
                <div className="flex items-center justify-between px-2.5 py-2 rounded-xl bg-stone-950/80 border border-stone-800/80">
                  <div className="flex items-center gap-2">
                    <img src={appIcon} alt="YAAD" className="w-5 h-5 rounded-md object-cover" />
                    <span className="text-xs font-bold text-stone-200">
                      {isEn ? 'App Version' : 'ورژن اپ'}
                    </span>
                  </div>
                  <span className="font-mono text-xs font-black text-indigo-400 bg-indigo-500/10 border border-indigo-500/25 px-2 py-0.5 rounded-lg" dir="ltr">
                    v{APP_VERSION}
                  </span>
                </div>

                {/* 2. Privacy Policy Link */}
                <button
                  type="button"
                  onClick={() => setLogoMenuInfoSection(logoMenuInfoSection === 'privacy' ? null : 'privacy')}
                  className={`w-full px-3 py-2 rounded-xl border text-xs font-bold flex items-center justify-between transition-all cursor-pointer ${
                    logoMenuInfoSection === 'privacy'
                      ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300'
                      : 'bg-stone-950/60 hover:bg-stone-800/90 border-stone-800/80 text-stone-300 hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400 drop-shadow-[0_0_6px_rgba(16,185,129,0.4)] shrink-0" />
                    <span>{isEn ? 'Privacy Policy' : 'حریم خصوصی'}</span>
                  </div>
                  <span className="text-[10px] text-stone-400">{logoMenuInfoSection === 'privacy' ? '▲' : '▼'}</span>
                </button>

                {logoMenuInfoSection === 'privacy' && (
                  <div className="p-2.5 rounded-xl bg-stone-950 border border-stone-800 text-[11px] text-stone-300 leading-relaxed space-y-2 animate-in fade-in">
                    <p>
                      {isEn
                        ? 'All reminders, occasions, ideas, and places are stored 100% locally on your device and in the root YAAD backup folder. Cloud backup is removed and no data leaves your device.'
                        : 'تمامی یادآورها، مناسبت‌ها، ایده‌ها و مکان‌های شما ۱۰۰٪ به‌صورت محلی در حافظه دستگاه و پوشه پشتیبان YAAD در ریشه حافظه ذخیره می‌شوند و به هیچ سرور یا فضای ابری ارسال نمی‌گردند.'}
                    </p>
                    <a
                      href="/privacy.html"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 font-bold text-[11px] flex items-center justify-center gap-1.5 transition-all"
                    >
                      <span>{isEn ? 'Read Full Privacy Policy' : 'مطالعه کامل سیاست حریم خصوصی'}</span>
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  </div>
                )}

                {/* 3. About Link */}
                <button
                  type="button"
                  onClick={() => setLogoMenuInfoSection(logoMenuInfoSection === 'about' ? null : 'about')}
                  className={`w-full px-3 py-2 rounded-xl border text-xs font-bold flex items-center justify-between transition-all cursor-pointer ${
                    logoMenuInfoSection === 'about'
                      ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300'
                      : 'bg-stone-950/60 hover:bg-stone-800/90 border-stone-800/80 text-stone-300 hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Info className="w-4 h-4 text-indigo-400 shrink-0" />
                    <span>{isEn ? 'About YAAD' : 'درباره‌ی'}</span>
                  </div>
                  <span className="text-[10px] text-stone-400">{logoMenuInfoSection === 'about' ? '▲' : '▼'}</span>
                </button>

                {logoMenuInfoSection === 'about' && (
                  <div className="p-2.5 rounded-xl bg-stone-950 border border-stone-800 text-[11px] text-stone-300 leading-relaxed animate-in fade-in">
                    {isEn
                      ? `Smart assistant for spoken reminders, occasions, ideas, and location Geofence alerts • Version ${APP_VERSION}`
                      : `دستیار هوشمند یادآورهای گفتاری، مناسبت‌ها، ایده‌ها و حصار مکانی مکان‌محور (Geofence) • نسخه ${toPersianDigits(APP_VERSION)}`}
                  </div>
                )}

                {/* 4. Support Email Link (mailto:YAADreminder@gmail.com) */}
                <a
                  href="mailto:YAADreminder@gmail.com?subject=YAAD%20App%20Support"
                  className="w-full px-3 py-2.5 rounded-xl bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/35 text-indigo-300 hover:text-white text-xs font-bold flex items-center justify-between gap-2 transition-all cursor-pointer"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Mail className="w-4 h-4 text-indigo-400 shrink-0" />
                    <div className="flex flex-col min-w-0">
                      <span>{isEn ? 'Support' : 'پشتیبانی'}</span>
                      <span className="text-[10px] font-mono text-stone-400 truncate" dir="ltr">
                        YAADreminder@gmail.com
                      </span>
                    </div>
                  </div>
                  <ExternalLink className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                </a>
              </div>
            )}

            <div className="flex flex-col">
              <div className="flex items-center gap-1.5">
                <span className="font-black text-sm sm:text-base tracking-tight text-indigo-400">
                  {isEn ? 'YAAD' : 'یاد'}
                </span>
              </div>
              <span className="text-[10px] sm:text-xs text-stone-400 font-medium">
                {isEn
                  ? `${todayGregorian.weekday}, ${todayGregorian.monthName} ${todayGregorian.day}, ${todayGregorian.year}`
                  : toPersianDigits(`${todayJalali.weekday} ${todayJalali.day} ${todayJalali.monthName} ${todayJalali.year}`)}
              </span>
            </div>
          </div>

          {/* Desktop/Tablet Navigation Pills (Hidden on mobile where bottom nav is active) */}
          <div className="hidden md:flex items-center bg-stone-800/80 p-1 rounded-2xl border border-stone-700/60 text-xs">
            <button
              type="button"
              onClick={() => setActiveMainTab('reminders')}
              className={`px-3 py-1.5 rounded-xl font-bold transition-all duration-200 whitespace-nowrap cursor-pointer ${
                activeMainTab === 'reminders'
                  ? 'bg-stone-900 border border-indigo-400/80 text-indigo-300 font-black shadow-sm'
                  : 'text-stone-300 hover:text-white'
              }`}
            >
              <span>{t.tabReminders}</span>
              <span className="opacity-80 text-xs font-mono mr-1 ml-1">
                ({settings.language === 'en' ? activeReminders.length : toPersianDigits(activeReminders.length)})
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveMainTab('occasions')}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-xl font-bold transition-all duration-200 whitespace-nowrap cursor-pointer ${
                activeMainTab === 'occasions'
                  ? 'bg-stone-900 border border-indigo-400/80 text-indigo-300 font-black shadow-sm'
                  : 'text-stone-300 hover:text-white'
              }`}
            >
              <Cake className={`w-3.5 h-3.5 shrink-0 ${activeMainTab === 'occasions' ? 'text-indigo-400' : 'text-stone-400'}`} />
              <span>{t.tabOccasions}</span>
              <span className="opacity-80 text-xs font-mono mr-1 ml-1">
                ({settings.language === 'en' ? activeOccasions.length : toPersianDigits(activeOccasions.length)})
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveMainTab('locations')}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-xl font-bold transition-all duration-200 whitespace-nowrap cursor-pointer ${
                activeMainTab === 'locations'
                  ? 'bg-stone-900 border border-indigo-400/80 text-indigo-300 font-black shadow-sm'
                  : 'text-stone-300 hover:text-white'
              }`}
            >
              <MapPin className={`w-3.5 h-3.5 shrink-0 ${activeMainTab === 'locations' ? 'text-indigo-400' : 'text-stone-400'}`} />
              <span>{t.tabLocations}</span>
              <span className="opacity-80 text-xs font-mono mr-1 ml-1">
                ({settings.language === 'en' ? activeSavedLocations.length : toPersianDigits(activeSavedLocations.length)})
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveMainTab('ideas')}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-xl font-bold transition-all duration-200 whitespace-nowrap cursor-pointer ${
                activeMainTab === 'ideas'
                  ? 'bg-stone-900 border border-indigo-400/80 text-indigo-300 font-black shadow-sm'
                  : 'text-stone-300 hover:text-white'
              }`}
            >
              <Lightbulb className={`w-3.5 h-3.5 shrink-0 ${activeMainTab === 'ideas' ? 'text-indigo-400' : 'text-stone-400'}`} />
              <span>{t.tabIdeas}</span>
              <span className="opacity-80 text-xs font-mono mr-1 ml-1">
                ({settings.language === 'en' ? activeIdeas.length : toPersianDigits(activeIdeas.length)})
              </span>
            </button>
          </div>

          {/* Header Action Buttons - Prominent Settings & Action */}
          <div className="flex items-center gap-2 flex-shrink-0">

            {/* Install App Button (Desktop / Supported Mobile) */}
            {!isAppInstalled && (
              <button
                type="button"
                onClick={handleInstallClick}
                className="hidden sm:flex min-h-[48px] items-center gap-1.5 px-3 py-2 rounded-2xl bg-indigo-500 hover:bg-indigo-400 text-white font-black text-xs sm:text-sm transition-all duration-200 active:scale-95 cursor-pointer shadow-md shadow-indigo-500/20 whitespace-nowrap"
                title={t.installApp}
              >
                <Download className="w-4 h-4 stroke-[2.5]" />
                <span>{t.installApp}</span>
              </button>
            )}

            {/* Search Button in Header - minimal magnifying glass beside Settings Button */}
            <button
              id="header-toggle-search-btn"
              type="button"
              onClick={() => {
                setIsSearchOpen((prev) => {
                  const next = !prev;
                  if (!next) {
                    setSearchQuery('');
                  } else {
                    setTimeout(() => searchInputRef.current?.focus(), 80);
                  }
                  return next;
                });
              }}
              className={`min-h-[48px] min-w-[48px] p-2.5 rounded-2xl border flex items-center justify-center cursor-pointer shadow-md active:scale-95 transition-all duration-200 ${
                isSearchOpen || searchQuery.trim()
                  ? 'bg-indigo-500/20 border-indigo-500 text-indigo-300 shadow-sm shadow-indigo-500/20'
                  : 'bg-stone-800/95 hover:bg-stone-700 text-stone-100 hover:text-white border-stone-700/90'
              }`}
              title={isEn ? 'Search Reminders' : 'جستجوی یادآورها'}
              aria-label={isEn ? 'Search' : 'جستجو'}
            >
              <Search className={`w-5 h-5 shrink-0 ${isSearchOpen || searchQuery.trim() ? 'text-indigo-400' : 'text-stone-300'}`} />
            </button>

            {/* Settings Button in Header - PROMINENT, ACCESSIBLE, MIN 48px TOUCH TARGET (فقط آیکون) */}
            <button
              id="header-open-settings-btn"
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              className="min-h-[48px] min-w-[48px] p-2.5 rounded-2xl bg-stone-800/95 hover:bg-stone-700 text-stone-100 hover:text-white border border-stone-700/90 flex items-center justify-center cursor-pointer shadow-md active:scale-95 transition-all duration-200"
              title={t.settings}
              aria-label={t.settings}
            >
              <SettingsIcon className="w-5 h-5 text-indigo-400 shrink-0" />
            </button>

            {/* Desktop Primary Action Button */}
            {activeMainTab === 'reminders' ? (
              <button
                id="header-create-reminder-btn"
                type="button"
                onClick={() => {
                  setEditingReminder(null);
                  setIsFormOpen(true);
                }}
                className="hidden lg:flex min-h-[48px] items-center gap-2 px-4 py-2 rounded-2xl bg-indigo-500 hover:bg-indigo-400 text-white text-xs sm:text-sm font-black shadow-lg shadow-indigo-500/25 transition-all duration-200 active:scale-95 cursor-pointer"
              >
                <Plus className="w-4 h-4 text-white stroke-[3]" />
                <span>{t.newReminder}</span>
              </button>
            ) : null}
          </div>
        </div>

        {/* Expandable Search Input Bar (جستجوی جامع دو زبانه در همه اطلاعات وارد شده توسط کاربر) */}
        {isSearchOpen && (
          <div className="w-full px-3 sm:px-6 py-2.5 bg-stone-900 border-t border-stone-800/90 animate-in slide-in-from-top-2 duration-150">
            <div className="max-w-2xl mx-auto space-y-2" dir={isEn ? 'ltr' : 'rtl'}>
              <div className="relative flex items-center">
                <Search className={`absolute ${isEn ? 'left-3.5' : 'right-3.5'} w-4 h-4 text-stone-400 pointer-events-none`} />
                <input
                  ref={searchInputRef}
                  type="text"
                  dir="auto"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                  }}
                  placeholder={
                    isEn
                      ? 'Search all reminders, ideas, notes, places & occasions (EN / FA)...'
                      : 'جستجو در همه اطلاعات: یادآورها، ایده‌ها، مکان‌ها، مناسبت‌ها، متن و تاریخ (فارسی و انگلیسی)...'
                  }
                  className={`w-full bg-stone-950 border border-stone-700 focus:border-indigo-500 rounded-2xl ${
                    isEn ? 'pl-10 pr-10' : 'pr-10 pl-10'
                  } py-2.5 text-xs sm:text-sm text-white placeholder-stone-500 focus:outline-none transition-all shadow-inner`}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      searchInputRef.current?.focus();
                    }}
                    className={`absolute ${isEn ? 'right-3' : 'left-3'} p-1 rounded-lg text-stone-400 hover:text-white hover:bg-stone-800 transition-colors cursor-pointer`}
                    title={isEn ? 'Clear' : 'پاک کردن'}
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Unified Search Feedback across all 4 user collections */}
              {searchQuery.trim() && (
                totalGlobalSearchMatches === 0 ? (
                  <div className="px-3.5 py-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-between gap-2 text-xs text-rose-300 animate-in fade-in duration-150">
                    <div className="flex items-center gap-2 font-bold">
                      <Search className="w-4 h-4 text-rose-400 shrink-0" />
                      <span>
                        {isEn
                          ? `No results found — "${searchQuery}" does not exist in Reminders, Ideas, Places, or Occasions`
                          : `موردی یافت نشد — «${searchQuery}» در یادآورها، ایده‌ها، مکان‌ها و مناسبت‌ها وجود ندارد`}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="px-3 py-2 rounded-xl bg-stone-950/90 border border-stone-800 space-y-1.5 animate-in fade-in duration-150">
                    <div className="flex items-center justify-between text-[11px] text-indigo-300 font-bold">
                      <span>
                        {isEn
                          ? `${totalGlobalSearchMatches} match(es) found across your data`
                          : `${toPersianDigits(totalGlobalSearchMatches)} مورد در اطلاعات شما یافت شد`}
                      </span>
                      <span className="text-stone-400 text-[10px]">
                        {isEn ? 'Tap any item to view or edit' : 'برای مشاهده یا ویرایش روی مورد کلیک کنید'}
                      </span>
                    </div>
                    <div className="max-h-52 overflow-y-auto space-y-1 pr-0.5">
                      {/* 1. Matching Reminders */}
                      {filteredReminders.map((rem) => (
                        <button
                          key={`search-rem-${rem.id}`}
                          type="button"
                          onClick={() => {
                            setActiveMainTab('reminders');
                            setEditingReminder(rem);
                            setIsFormOpen(true);
                          }}
                          className="w-full text-start p-2 rounded-lg bg-stone-900 hover:bg-stone-800 border border-stone-800/80 flex items-center justify-between gap-2 transition-colors cursor-pointer"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="px-1.5 py-0.5 rounded-md bg-indigo-500/15 text-indigo-300 text-[9px] font-bold shrink-0">
                                {isEn ? 'Reminder' : 'یادآور'}
                              </span>
                              <p className="text-xs font-bold text-white truncate">{rem.title}</p>
                            </div>
                            {rem.description && (
                              <p className="text-[10px] text-stone-400 truncate mt-0.5">{rem.description}</p>
                            )}
                          </div>
                          <span className="text-[10px] font-mono text-indigo-300 shrink-0">
                            {formatJalaliFull(rem.dueTimestamp, isEn ? 'en' : 'fa')}
                          </span>
                        </button>
                      ))}

                      {/* 2. Matching Occasions */}
                      {filteredGlobalOccasions.map((occ) => (
                        <button
                          key={`search-occ-${occ.id}`}
                          type="button"
                          onClick={() => {
                            setActiveMainTab('occasions');
                            setEditingOccasion(occ);
                            setIsOccasionModalOpen(true);
                          }}
                          className="w-full text-start p-2 rounded-lg bg-stone-900 hover:bg-stone-800 border border-stone-800/80 flex items-center justify-between gap-2 transition-colors cursor-pointer"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="px-1.5 py-0.5 rounded-md bg-pink-500/15 text-pink-300 text-[9px] font-bold shrink-0">
                                {isEn ? 'Occasion' : 'مناسبت'}
                              </span>
                              <p className="text-xs font-bold text-white truncate">{occ.title}</p>
                            </div>
                            {(occ.personName || occ.customNote) && (
                              <p className="text-[10px] text-stone-400 truncate mt-0.5">
                                {[occ.personName, occ.customNote].filter(Boolean).join(' • ')}
                              </p>
                            )}
                          </div>
                          <span className="text-[10px] font-mono text-indigo-300 shrink-0">
                            {isEn ? `${occ.solarMonth}/${occ.solarDay}` : toPersianDigits(`${occ.solarMonth}/${occ.solarDay}`)}
                          </span>
                        </button>
                      ))}

                      {/* 3. Matching Saved Locations */}
                      {filteredGlobalLocations.map((loc) => (
                        <button
                          key={`search-loc-${loc.id}`}
                          type="button"
                          onClick={() => {
                            setActiveMainTab('locations');
                            setEditingLocation(loc);
                            setIsLocationModalOpen(true);
                          }}
                          className="w-full text-start p-2 rounded-lg bg-stone-900 hover:bg-stone-800 border border-stone-800/80 flex items-center justify-between gap-2 transition-colors cursor-pointer"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 text-[9px] font-bold shrink-0">
                                {isEn ? 'Place' : 'مکان'}
                              </span>
                              <p className="text-xs font-bold text-white truncate">{formatSavedLocationTitle(loc.title, settings.language)}</p>
                            </div>
                            {(loc.address || loc.description) && (
                              <p className="text-[10px] text-stone-400 truncate mt-0.5">
                                {loc.address || loc.description}
                              </p>
                            )}
                          </div>
                          <span className="text-[10px] font-mono text-indigo-300 shrink-0">
                            {formatJalaliFull(loc.createdAt, isEn ? 'en' : 'fa')}
                          </span>
                        </button>
                      ))}

                      {/* 4. Matching Ideas & Notes */}
                      {filteredGlobalIdeas.map((idea) => (
                        <button
                          key={`search-idea-${idea.id}`}
                          type="button"
                          onClick={() => {
                            setActiveMainTab('ideas');
                            setEditingIdea(idea);
                            setIsIdeaModalOpen(true);
                          }}
                          className="w-full text-start p-2 rounded-lg bg-stone-900 hover:bg-stone-800 border border-stone-800/80 flex items-center justify-between gap-2 transition-colors cursor-pointer"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-300 text-[9px] font-bold shrink-0">
                                {isEn ? 'Idea' : 'ایده'}
                              </span>
                              <p className="text-xs font-bold text-white truncate">{idea.title}</p>
                            </div>
                            {idea.content && (
                              <p className="text-[10px] text-stone-400 truncate mt-0.5">{idea.content}</p>
                            )}
                          </div>
                          <span className="text-[10px] font-mono text-indigo-300 shrink-0">
                            {formatJalaliFull(idea.createdAt, isEn ? 'en' : 'fa')}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )
              )}
            </div>
          </div>
        )}
      </header>

      {/* Main Container - Maximum Width coverage across screen with ample padding for bottom nav and FAB */}
      <main className="flex-1 w-full px-3 sm:px-6 py-4 sm:py-6 space-y-6 pb-36 sm:pb-44">
        
        {/* VIEW 1: REMINDERS TAB - SINGLE VERTICAL TIMELINE */}
        {activeMainTab === 'reminders' && (
          <VerticalTimelineView
            reminders={reminders}
            categoryFilter={categoryFilter === 'completed' ? 'all' : categoryFilter}
            onSetCategoryFilter={(filter) => setCategoryFilter(filter)}
            onToggleComplete={handleToggleComplete}
            onPostpone={handlePostpone}
            onEdit={(rem) => {
              setEditingReminder(rem);
              setIsFormOpen(true);
            }}
            onDelete={handleDelete}
            onCreateNew={() => {
              setEditingReminder(null);
              setIsFormOpen(true);
            }}
            language={settings.language}
            searchQuery={searchQuery}
            onClearSearch={() => setSearchQuery('')}
          />
        )}

        {/* VIEW 2: IDEAS & THOUGHTS SECTION */}
        {activeMainTab === 'ideas' && (
          <section className="space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-stone-800">
              <h3 className="font-bold text-base sm:text-lg text-white flex items-center gap-2">
                <Lightbulb className="w-5 h-5 text-indigo-400" />
                <span>{isEn ? 'Organize Ideas & Notes' : 'ثبت و سازماندهی ایده و افکار'}</span>
              </h3>

              <button
                type="button"
                onClick={() => setIsIdeaModalOpen(true)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 !text-white font-bold text-xs shadow-md transition-all self-stretch sm:self-auto justify-center active:scale-95 cursor-pointer"
              >
                <Plus className="w-4 h-4 text-white stroke-[3]" />
                <span className="text-white font-black">
                  {isEn ? 'Capture New Idea' : 'ثبت فکر یا ایده جدید'}
                </span>
              </button>
            </div>

            {filteredGlobalIdeas.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {filteredGlobalIdeas.map((idea) => (
                  <IdeaCard
                    key={idea.id}
                    idea={idea}
                    onDelete={handleDeleteIdea}
                    onEdit={(item) => {
                      setEditingIdea(item);
                      setIsIdeaModalOpen(true);
                    }}
                    onViewImage={(url) => setViewingImageUrl(url)}
                    language={settings.language}
                  />
                ))}
              </div>
            ) : (
              <div className="py-12 px-4 text-center rounded-3xl border border-dashed border-stone-800/80 bg-stone-900/30 space-y-3.5 transition-all duration-200">
                <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 flex items-center justify-center mx-auto shadow-inner">
                  <Lightbulb className="w-7 h-7" />
                </div>
                <div className="space-y-1">
                  <h4 className="font-bold text-base text-white">
                    {searchQuery.trim()
                      ? (isEn ? 'No matching ideas found' : 'ایده‌ای با این عبارت یافت نشد')
                      : (isEn ? 'No ideas recorded yet!' : 'هنوز ایده‌ای ثبت نکرده‌اید!')}
                  </h4>
                  <p className="text-xs text-stone-400 max-w-sm mx-auto leading-relaxed">
                    {isEn 
                      ? 'Capture your thoughts quickly with text, voice memos, videos, or sketch canvas.' 
                      : 'هر فکری که به ذهنتان رسید، سریع با یادداشت متنی، ویس صوتی، ویدیو یا نقاشی ذخیره کنید.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsIdeaModalOpen(true)}
                  className="min-h-[48px] inline-flex items-center justify-center gap-2 px-6 py-3 rounded-2xl bg-indigo-500 hover:bg-indigo-400 text-white font-black text-xs sm:text-sm transition-all duration-200 shadow-lg shadow-indigo-500/25 active:scale-95 cursor-pointer mx-auto"
                >
                  <Plus className="w-4 h-4 text-white stroke-[3]" />
                  <span>{isEn ? 'Create New Idea' : 'ثبت اولین ایده'}</span>
                </button>
              </div>
            )}
          </section>
        )}

        {/* VIEW 3: LOCATIONS TAB (ثبت لوکیشن با تکیه بر GPS و گوگل مپ) */}
        {activeMainTab === 'locations' && (() => {
          const activeGeofencesCount = activeSavedLocations.filter((l) => l.geofence && l.geofence.enabled).length;
          const effectiveLocationQuery = locationSearchQuery.trim() || searchQuery.trim();
          const displayedLocations = activeSavedLocations.filter((loc) => {
            if (locationFilter === 'checkpoints' && (!loc.geofence || !loc.geofence.enabled)) {
              return false;
            }
            if (!effectiveLocationQuery) return true;
            return matchesLocationSearch(loc, effectiveLocationQuery);
          });

          return (
            <section className="space-y-4 animate-in fade-in">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-stone-800/80">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 flex items-center justify-center flex-shrink-0">
                    <MapPin className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-base sm:text-lg text-white flex items-center gap-2 flex-wrap">
                      <span>{isEn ? 'Saved Places with GPS & Google Maps' : 'مکان‌های ثبت‌شده با GPS و Google Maps'}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-stone-800 text-stone-300 border border-stone-700 font-mono">
                        {formatNumber(activeSavedLocations.length)}
                      </span>
                      {activeGeofencesCount > 0 && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
                          <span>{isEn ? `${activeGeofencesCount} Active Geofences` : `${toPersianDigits(activeGeofencesCount)} حصار مکانی فعال`}</span>
                        </span>
                      )}
                    </h3>
                    <p className="text-[11px] text-stone-400">
                      {isEn 
                        ? 'Satellite coordinates, Google Maps preview, camera photo and radius boundary alerts' 
                        : 'ذخیره خودکار مختصات ماهواره‌ای، پیش‌نمایش در گوگل‌مپ، عکاسی و هشدارهای حصار مکانی'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-stretch sm:self-auto">
                  <button
                    type="button"
                    onClick={() => setIsLocationModalOpen(true)}
                    className="flex-1 sm:flex-initial flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-black text-xs shadow-md shadow-indigo-500/20 transition-all justify-center cursor-pointer active:scale-95"
                  >
                    <Plus className="w-4 h-4 text-white stroke-[3]" />
                    <span className="text-white font-black">
                      {isEn ? 'Save New Location' : 'ثبت مکان جدید'}
                    </span>
                  </button>
                </div>
              </div>

              {/* Sub-Filters: All Places vs Active Geofences */}
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                <button
                  type="button"
                  onClick={() => setLocationFilter('all')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap active:scale-95 ${
                    locationFilter === 'all'
                      ? 'bg-indigo-500 text-white font-black shadow-sm'
                      : 'bg-stone-900 border border-stone-800 text-stone-300 hover:text-white'
                  }`}
                >
                  <span>{isEn ? 'All Places' : 'همه مکان‌ها'}</span>
                  <span className="ms-1 opacity-80 font-mono">({formatNumber(activeSavedLocations.length)})</span>
                </button>

                <button
                  type="button"
                  onClick={() => setLocationFilter('checkpoints')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap active:scale-95 flex items-center gap-1.5 ${
                    locationFilter === 'checkpoints'
                      ? 'bg-indigo-500 text-white font-black shadow-sm'
                      : 'bg-stone-900 border border-stone-800 text-stone-300 hover:text-white'
                  }`}
                >
                  <Radio className={`w-3.5 h-3.5 text-stone-400 ${isGeofenceActive && activeGeofencesCount > 0 ? 'animate-pulse' : ''}`} />
                  <span>{isEn ? 'Active Geofences' : 'دارای حصار مکانی فعال'}</span>
                  <span className="ms-0.5 opacity-80 font-mono">({formatNumber(activeGeofencesCount)})</span>
                </button>
              </div>

              {/* Location Search Bar & Geofence Active Indicator */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
                <div
                  dir={isEn ? 'ltr' : 'rtl'}
                  className="flex-1 flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-stone-900 border border-stone-800 focus-within:border-indigo-500 transition-colors"
                >
                  <Search className="w-4 h-4 text-indigo-400 shrink-0 stroke-[2.5]" />
                  <input
                    type="text"
                    dir={isEn ? 'ltr' : 'rtl'}
                    value={locationSearchQuery}
                    onChange={(e) => setLocationSearchQuery(e.target.value)}
                    placeholder={isEn ? 'Search places by name, address or notes...' : 'جست‌وجوی مکان بر اساس نام، آدرس یا توضیحات...'}
                    className="w-full bg-transparent border-0 text-white placeholder-stone-400 text-xs focus:outline-none min-w-0"
                  />
                  {locationSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setLocationSearchQuery('')}
                      className="p-1 text-stone-400 hover:text-white shrink-0 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Geofence Engine Status Toggle */}
                <button
                  type="button"
                  onClick={() => handleToggleGeofenceService()}
                  style={
                    isGeofenceActive
                      ? {
                          background: 'linear-gradient(135deg, rgba(6, 78, 59, 0.92) 0%, rgba(16, 185, 129, 0.35) 100%)',
                          borderColor: '#34d399',
                          color: '#ffffff',
                        }
                      : undefined
                  }
                  className={`flex items-center justify-between sm:justify-start gap-2.5 px-3.5 py-2 rounded-xl border text-xs transition-all cursor-pointer active:scale-95 ${
                    isGeofenceActive
                      ? 'geofence-radar-active shadow-md shadow-emerald-950/50'
                      : 'bg-stone-900 border-stone-800 text-stone-400 hover:border-stone-700'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-2.5 w-2.5">
                      {isGeofenceActive && (
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-300 opacity-75" />
                      )}
                      <span
                        style={{ backgroundColor: isGeofenceActive ? '#34d399' : '#78716c' }}
                        className="relative inline-flex rounded-full h-2.5 w-2.5"
                      />
                    </span>
                    <Radio className={`w-3.5 h-3.5 ${isGeofenceActive ? 'text-emerald-300 animate-pulse' : 'text-stone-400'}`} />
                    <span
                      style={isGeofenceActive ? { color: '#ffffff' } : undefined}
                      className="text-[11px] font-black"
                    >
                      {isEn ? 'Geofence Radar:' : 'پایش ورود/خروج حصارها:'}
                    </span>
                  </div>
                  <span
                    style={
                      isGeofenceActive
                        ? { backgroundColor: '#10b981', borderColor: '#a7f3d0', color: '#ffffff' }
                        : undefined
                    }
                    className={`text-[10px] px-2.5 py-0.5 rounded-lg font-black border transition-colors ${
                      isGeofenceActive
                        ? 'shadow-xs'
                        : 'bg-stone-800 text-stone-400 border-stone-700'
                    }`}
                  >
                    {isGeofenceActive ? (isEn ? 'ACTIVE ✓' : 'فعال ✓') : (isEn ? 'PAUSED' : 'غیرفعال')}
                  </span>
                </button>
              </div>

              {displayedLocations.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {displayedLocations.map((loc) => (
                      <SavedLocationCard
                        key={loc.id}
                        location={loc}
                        onDelete={handleDeleteLocation}
                        onEdit={(item) => {
                          setEditingLocation(item);
                          setIsLocationModalOpen(true);
                        }}
                        onCreateReminderFromLocation={(targetLoc) => {
                          setTargetLocationForReminder(targetLoc);
                          setIsLocationReminderModalOpen(true);
                        }}
                        onCreateIdeaFromLocation={(targetLoc) => {
                          setEditingIdea({
                            id: 'temp_idea',
                            title: `یادداشت درباره: ${targetLoc.title}`,
                            content: `${targetLoc.description ? targetLoc.description + '\n' : ''}مختصات: ${targetLoc.latitude}, ${targetLoc.longitude}\nنقشه: ${targetLoc.googleMapsUrl}`,
                            createdAt: Date.now(),
                            category: 'work',
                          });
                          setIsIdeaModalOpen(true);
                        }}
                        onViewPhoto={(url) => setViewingImageUrl(url)}
                        language={settings.language}
                        userPosition={currentUserPosition}
                        onToggleCheckpoint={handleToggleLocationCheckpoint}
                        onSimulateCheckpointTrigger={handleSimulateLocationCheckpointTrigger}
                        isGeofenceServiceActive={isGeofenceActive}
                      />
                    ))}
                </div>
              ) : (
              <div className="py-12 px-4 text-center rounded-3xl border border-dashed border-stone-800/80 bg-stone-900/30 space-y-3.5 transition-all duration-200">
                <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 flex items-center justify-center mx-auto shadow-inner">
                  <MapPin className="w-7 h-7" />
                </div>
                <div className="space-y-1">
                  <h4 className="font-bold text-base text-white">
                    {effectiveLocationQuery
                      ? (isEn ? 'No matching locations found' : 'مکانی با این مشخصات یافت نشد')
                      : (isEn ? 'No locations saved yet!' : 'هنوز مکانی ثبت نکرده‌اید!')}
                  </h4>
                  <p className="text-xs text-stone-400 max-w-sm mx-auto leading-relaxed">
                    {isEn 
                      ? 'Saving a location records exact GPS satellite coordinates, phone camera photos, notes, and directions on Google Maps.'
                      : 'مکان‌های مهم، محل پارک ماشین، منزل یا مقاصد کاری را با مختصات دقیق GPS و نقشه ثبت کنید.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsLocationModalOpen(true)}
                  className="min-h-[48px] inline-flex items-center justify-center gap-2 px-6 py-3 rounded-2xl bg-indigo-500 hover:bg-indigo-400 text-white font-black text-xs sm:text-sm transition-all duration-200 shadow-lg shadow-indigo-500/25 active:scale-95 cursor-pointer mx-auto"
                >
                  <Plus className="w-4 h-4 text-white stroke-[3]" />
                  <span>{isEn ? 'Save First Location' : 'ثبت اولین مکان'}</span>
                </button>
              </div>
            )}
          </section>
        );
        })()}

        {/* VIEW 4: OCCASIONS & MILESTONES (مناسبت‌ها: تولد، سالگردها و رویدادهای مهم) */}
        {activeMainTab === 'occasions' && (
          <OccasionsView
            occasions={activeOccasions}
            onAddNew={() => {
              setEditingOccasion(null);
              setIsOccasionModalOpen(true);
            }}
            onEdit={(occ) => {
              setEditingOccasion(occ);
              setIsOccasionModalOpen(true);
            }}
            onDelete={handleDeleteOccasion}
            onCreateReminder={handleCreateReminderFromOccasion}
            language={settings.language}
            globalSearchQuery={searchQuery}
          />
        )}

      </main>

      {/* FULL-SCREEN CLICKAWAY BACKDROP FOR (+) MENU (outside transformed FAB container so fixed inset-0 covers entire viewport) */}
      {isCreateChoiceOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[3px] animate-in fade-in duration-200"
          onClick={() => setIsCreateChoiceOpen(false)}
        />
      )}

      {/* FLOATING ACTION BUTTON (+) - POSITIONED DIRECTLY ABOVE BOTTOM NAVIGATION BAR */}
      <div 
        className={`${fabContainerClassName} ${isCreateChoiceOpen ? '!z-50' : ''}`}
        style={fabContainerStyle}
        dir="ltr"
      >
        {/* Relative container for FAB and choice popup */}
        <div className="relative">
          {/* Choice Menu Popup */}
          {isCreateChoiceOpen && (
            <div
              ref={fabMenuRef}
              onClick={(e) => e.stopPropagation()}
              className="absolute bottom-16 sm:bottom-20 right-0 origin-bottom-right z-50 bg-stone-900/98 border border-stone-800 rounded-2xl p-2 sm:p-2.5 shadow-2xl backdrop-blur-2xl w-56 sm:w-60 space-y-1 animate-fab-menu"
            >
              {/* Option 1: Reminder */}
              <button
                type="button"
                onClick={() => {
                  setIsCreateChoiceOpen(false);
                  setEditingReminder(null);
                  setIsFormOpen(true);
                }}
                className="w-full min-h-[48px] flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-stone-800 text-stone-200 hover:text-indigo-400 transition-all duration-200 cursor-pointer group active:scale-95 border border-transparent hover:border-stone-700/60 animate-fab-item-1"
              >
                <div className="w-9 h-9 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform duration-200">
                  <Bell className="w-4.5 h-4.5" />
                </div>
                <span className="text-sm font-bold text-stone-200 group-hover:text-indigo-300">
                  {isEn ? 'New Reminder' : 'ثبت یادآور'}
                </span>
              </button>

              {/* Option 2: Occasion */}
              <button
                type="button"
                onClick={() => {
                  setIsCreateChoiceOpen(false);
                  setEditingOccasion(null);
                  setIsOccasionModalOpen(true);
                }}
                className="w-full min-h-[48px] flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-stone-800 text-stone-200 hover:text-indigo-400 transition-all duration-200 cursor-pointer group active:scale-95 border border-transparent hover:border-stone-700/60 animate-fab-item-2"
              >
                <div className="w-9 h-9 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform duration-200">
                  <Cake className="w-4.5 h-4.5" />
                </div>
                <span className="text-sm font-bold text-stone-200 group-hover:text-indigo-300">
                  {isEn ? 'Add Occasion' : 'ثبت مناسبت'}
                </span>
              </button>

              {/* Option 3: Idea */}
              <button
                type="button"
                onClick={() => {
                  setIsCreateChoiceOpen(false);
                  setIsIdeaModalOpen(true);
                }}
                className="w-full min-h-[48px] flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-stone-800 text-stone-200 hover:text-indigo-400 transition-all duration-200 cursor-pointer group active:scale-95 border border-transparent hover:border-stone-700/60 animate-fab-item-3"
              >
                <div className="w-9 h-9 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform duration-200">
                  <Lightbulb className="w-4.5 h-4.5" />
                </div>
                <span className="text-sm font-bold text-stone-200 group-hover:text-indigo-300">
                  {isEn ? 'Capture Idea' : 'ثبت ایده'}
                </span>
              </button>

              {/* Option 4: Location */}
              <button
                type="button"
                onClick={() => {
                  setIsCreateChoiceOpen(false);
                  setIsLocationModalOpen(true);
                }}
                className="w-full min-h-[48px] flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-stone-800 text-stone-200 hover:text-indigo-400 transition-all duration-200 cursor-pointer group active:scale-95 border border-transparent hover:border-stone-700/60 animate-fab-item-4"
              >
                <div className="w-9 h-9 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform duration-200">
                  <MapPin className="w-4.5 h-4.5" />
                </div>
                <span className="text-sm font-bold text-stone-200 group-hover:text-indigo-300">
                  {isEn ? 'Save Place' : 'ثبت مکان'}
                </span>
              </button>
            </div>
          )}

          {/* Circular FAB */}
          <button
            ref={fabBtnRef}
            id="fab-create-btn"
            data-keep-color="true"
            type="button"
            style={{ width: '56px', height: '56px' }}
            onClick={() => {
              resetFabPosition();
              setIsCreateChoiceOpen(!isCreateChoiceOpen);
            }}
            className={`fab-add-btn rounded-full flex items-center justify-center shadow-lg hover:scale-105 active:scale-95 transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] border flex-shrink-0 cursor-pointer ${
              settings.theme === 'jade_warm_light'
                ? isCreateChoiceOpen
                  ? 'rotate-45 bg-[#168779] text-white border-[#168779] shadow-[#168779]/30'
                  : 'rotate-0 bg-[#168779] hover:bg-[#116e63] text-white border-[#168779]/40 shadow-[#168779]/25'
                : isCreateChoiceOpen 
                ? 'rotate-45 bg-amber-400 text-stone-950 border-amber-200 shadow-amber-500/30' 
                : 'rotate-0 bg-amber-500 hover:bg-amber-400 text-stone-950 border-amber-300/80 shadow-black/40'
            }`}
            title={isEn ? 'Add New' : 'ثبت جدید'}
            aria-label={isEn ? 'Add New' : 'ثبت جدید'}
          >
            <Plus style={{ width: '30px', height: '30px' }} className="w-7 h-7 stroke-[3] transition-transform duration-300" />
          </button>
        </div>
      </div>

      {/* FIXED BOTTOM NAVIGATION BAR (منوی پایین ثابت: آیکون‌ها خاکستری، تب فعال رنگ کهربایی، نشان تعداد خنثی) */}
      <nav 
        className={`fixed bottom-0 left-0 right-0 z-40 border-t backdrop-blur-xl transition-colors duration-200 pb-safe ${
          settings.theme === 'jade_warm_light'
            ? 'bg-[#FFFFFF]/95 border-[#DDE1DA] text-[#202A29] shadow-sm'
            : settings.theme === 'midnight_blue_silver'
            ? 'bg-[#101722]/95 border-[#39475A] text-[#F0F3F7] shadow-xl'
            : isDarkMode 
            ? 'bg-stone-950/95 border-stone-800/90 text-stone-200 shadow-xl' 
            : 'bg-white/95 border-stone-200 text-stone-800 shadow-md'
        }`}
      >
        <div className="max-w-md sm:max-w-xl mx-auto px-2 sm:px-4 h-16 sm:h-18 flex items-center justify-around gap-1">
          {/* Tab 1: Reminders (یادآورها) */}
          <button
            type="button"
            onClick={() => setActiveMainTab('reminders')}
            className={`min-h-[48px] flex-1 flex flex-col items-center justify-center gap-1 rounded-2xl transition-all duration-200 active:scale-95 cursor-pointer ${
              activeMainTab === 'reminders'
                ? 'text-indigo-400 font-black'
                : 'text-stone-400 hover:text-stone-200'
            }`}
          >
            <div className="relative">
              <Bell className={`w-5 h-5 ${activeMainTab === 'reminders' ? 'stroke-[2.4] text-indigo-400' : 'stroke-[1.8] text-stone-400'}`} />
              {activeReminders.length > 0 && (
                <span className="absolute -top-1 -end-2 min-w-4 h-4 px-1 rounded-full bg-stone-800 border border-stone-700 text-stone-300 text-[10px] font-bold flex items-center justify-center font-mono">
                  {formatNumber(activeReminders.length)}
                </span>
              )}
            </div>
            <span className="text-[11px] sm:text-xs font-bold">{t.tabReminders}</span>
          </button>

          {/* Tab 2: Occasions (مناسبت‌ها) */}
          <button
            type="button"
            onClick={() => setActiveMainTab('occasions')}
            className={`min-h-[48px] flex-1 flex flex-col items-center justify-center gap-1 rounded-2xl transition-all duration-200 active:scale-95 cursor-pointer ${
              activeMainTab === 'occasions'
                ? 'text-indigo-400 font-black'
                : 'text-stone-400 hover:text-stone-200'
            }`}
          >
            <div className="relative">
              <Cake className={`w-5 h-5 ${activeMainTab === 'occasions' ? 'stroke-[2.4] text-indigo-400' : 'stroke-[1.8] text-stone-400'}`} />
              {activeOccasions.length > 0 && (
                <span className="absolute -top-1 -end-2 min-w-4 h-4 px-1 rounded-full bg-stone-800 border border-stone-700 text-stone-300 text-[10px] font-bold flex items-center justify-center font-mono">
                  {formatNumber(activeOccasions.length)}
                </span>
              )}
            </div>
            <span className="text-[11px] sm:text-xs font-bold">{t.tabOccasions}</span>
          </button>

          {/* Tab 3: Locations (مکان‌ها) */}
          <button
            type="button"
            onClick={() => setActiveMainTab('locations')}
            className={`min-h-[48px] flex-1 flex flex-col items-center justify-center gap-1 rounded-2xl transition-all duration-200 active:scale-95 cursor-pointer ${
              activeMainTab === 'locations'
                ? 'text-indigo-400 font-black'
                : 'text-stone-400 hover:text-stone-200'
            }`}
          >
            <div className="relative">
              <MapPin className={`w-5 h-5 ${activeMainTab === 'locations' ? 'stroke-[2.4] text-indigo-400' : 'stroke-[1.8] text-stone-400'}`} />
              {activeSavedLocations.length > 0 && (
                <span className="absolute -top-1 -end-2 min-w-4 h-4 px-1 rounded-full bg-stone-800 border border-stone-700 text-stone-300 text-[10px] font-bold flex items-center justify-center font-mono">
                  {formatNumber(activeSavedLocations.length)}
                </span>
              )}
            </div>
            <span className="text-[11px] sm:text-xs font-bold">{t.tabLocations}</span>
          </button>

          {/* Tab 4: Ideas (ایده‌ها) */}
          <button
            type="button"
            onClick={() => setActiveMainTab('ideas')}
            className={`min-h-[48px] flex-1 flex flex-col items-center justify-center gap-1 rounded-2xl transition-all duration-200 active:scale-95 cursor-pointer ${
              activeMainTab === 'ideas'
                ? 'text-indigo-400 font-black'
                : 'text-stone-400 hover:text-stone-200'
            }`}
          >
            <div className="relative">
              <Lightbulb className={`w-5 h-5 ${activeMainTab === 'ideas' ? 'stroke-[2.4] text-indigo-400' : 'stroke-[1.8] text-stone-400'}`} />
              {activeIdeas.length > 0 && (
                <span className="absolute -top-1 -end-2 min-w-4 h-4 px-1 rounded-full bg-stone-800 border border-stone-700 text-stone-300 text-[10px] font-bold flex items-center justify-center font-mono">
                  {formatNumber(activeIdeas.length)}
                </span>
              )}
            </div>
            <span className="text-[11px] sm:text-xs font-bold">{t.tabIdeas}</span>
          </button>
        </div>
      </nav>

      {/* REMINDER CREATION & EDIT MODAL */}
      <ReminderForm
        isOpen={isFormOpen}
        onClose={() => {
          setIsFormOpen(false);
          setEditingReminder(null);
        }}
        onSave={handleSaveReminder}
        initialData={editingReminder}
        googleToken={googleToken}
        savedLocations={savedLocations}
        language={settings.language}
      />

      {/* IDEA CAPTURE MODAL */}
      <IdeaCaptureModal
        isOpen={isIdeaModalOpen}
        onClose={() => {
          setIsIdeaModalOpen(false);
          setEditingIdea(null);
        }}
        onSaveIdea={handleSaveIdea}
        googleToken={googleToken}
        editingIdea={editingIdea}
        language={settings.language}
      />

      {/* LOCATION CAPTURE MODAL */}
      <LocationCaptureModal
        isOpen={isLocationModalOpen}
        onClose={() => {
          setIsLocationModalOpen(false);
          setEditingLocation(null);
        }}
        onSave={handleSaveLocation}
        editingLocation={editingLocation}
        language={settings.language}
      />

      {/* GEOFENCE LOCATION-BASED REMINDER MODAL */}
      <LocationReminderModal
        isOpen={isLocationReminderModalOpen}
        onClose={() => {
          setIsLocationReminderModalOpen(false);
          setTargetLocationForReminder(null);
        }}
        onSave={(newRem) => {
          handleSaveReminder(newRem);
          showSyncNotification('یادآور ورود/خروج به محدوده مکانی فعال شد.');
        }}
        savedLocations={savedLocations}
        initialLocation={targetLocationForReminder}
        language={settings.language}
      />

      {/* OCCASION CREATION & EDIT MODAL (مناسبت جدید) */}
      <OccasionFormModal
        isOpen={isOccasionModalOpen}
        onClose={() => {
          setIsOccasionModalOpen(false);
          setEditingOccasion(null);
        }}
        onSave={handleSaveOccasion}
        editingOccasion={editingOccasion}
        language={settings.language}
      />

      {/* SETTINGS MODAL */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onUpdateSettings={(newS) => setSettings((prev) => ({ ...prev, ...newS }))}
        googleUser={googleUser}
        googleToken={googleToken}
        onGoogleSignIn={handleGoogleSignIn}
        onGoogleSignOut={handleGoogleSignOut}
        onOpenStats={() => setIsStatsOpen(true)}
        reminders={reminders}
        ideas={ideas}
        savedLocations={savedLocations}
        occasions={occasions}
        onRestoreData={handleRestoreData}
        onTestHeadsUpBanner={(testRem) => {
          setActiveAlarmReminder(testRem);
        }}
        isGeofenceActive={isGeofenceActive}
        onToggleGeofenceActive={handleToggleGeofenceService}
        onRestoreItem={handleRestoreItem}
        onPermanentDeleteItem={handlePermanentDeleteItem}
        onEmptyRecycleBin={handleEmptyRecycleBin}
      />

      {/* INSTALL MODAL */}
      <InstallModal
        isOpen={isInstallModalOpen}
        onClose={() => setIsInstallModalOpen(false)}
        deferredPrompt={installPromptEvent}
        onInstalled={() => {
          setIsAppInstalled(true);
          setInstallPromptEvent(null);
        }}
        onRestoreBackup={(snap) => handleRestoreData(snap, 'merge')}
        language={settings.language}
      />

      {/* STATISTICS MODAL */}
      <StatisticsModal
        isOpen={isStatsOpen}
        onClose={() => setIsStatsOpen(false)}
        reminders={activeReminders}
        language={settings.language}
      />

      {/* FULL-SCREEN MINIMAL IN-APP NOTIFICATION POPUP */}
      {activeAlarmReminder && (
        <AlarmModal
          reminder={activeAlarmReminder}
          settings={settings}
          onUpdateSettings={(newS) => setSettings((prev) => ({ ...prev, ...newS }))}
          onNoReactionTimeout={(id) => {
            handleNoReactionTimeout(id);
          }}
          onDismiss={() => {
            if (activeAlarmReminder) {
              handleNoReactionTimeout(activeAlarmReminder.id);
            }
            openedFromNotificationEditRef.current = true;
            setIsCreateChoiceOpen(false);
            setActiveAlarmReminder(null);
            setCategoryFilter('all');
            setActiveMainTab('reminders');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          onComplete={(id) => {
            handleCompleteReminder(id);
            setActiveAlarmReminder(null);
            setActiveMainTab('reminders');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          onPostpone={(id, mins) => {
            handlePostpone(id, mins);
            setActiveAlarmReminder(null);
          }}
          onEdit={(rem) => {
            handleStopOrDismissReminder(rem.id);
            setActiveAlarmReminder(null);
            setActiveMainTab('reminders');
            setEditingReminder(rem);
            setIsFormOpen(true);
          }}
        />
      )}

      {/* IMAGE VIEWER MODAL */}
      {viewingImageUrl && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md"
          onClick={() => setViewingImageUrl(null)}
        >
          <div className="relative max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl border border-stone-700 bg-black">
            <button
              onClick={() => setViewingImageUrl(null)}
              className="absolute top-3 left-3 p-2 rounded-full bg-black/60 text-white hover:bg-black"
            >
              <X className="w-5 h-5" />
            </button>
            <img
              src={viewingImageUrl}
              alt="Attachment"
              className="w-full h-full object-contain max-h-[85vh]"
            />
          </div>
        </div>
      )}

      {/* ANDROID SYSTEM PERMISSION & SECTION DIRECTING MODAL */}
      <AndroidPermissionModal
        isOpen={androidPermissionModal.isOpen}
        onClose={() => setAndroidPermissionModal((prev) => ({ ...prev, isOpen: false }))}
        permissionType={androidPermissionModal.type}
        onRetry={androidPermissionModal.onRetry}
        language={settings.language}
      />

      </div>
      
      {/* APP STARTUP SPLASH SCREEN (SMOOTHER ANIMATION IN <= 2.5 SECONDS WITH FADE-OUT INTO APP) */}
      {showSplash && (
        <SplashScreen 
          onStartExit={handleStartExitSplash} 
          onFinish={handleFinishSplash} 
          totalDurationMs={2400}
          fadeOutMs={500}
          language={settings.language}
        />
      )}
    </>
  );
}

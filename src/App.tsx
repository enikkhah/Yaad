import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Reminder, Category, Priority, IdeaNote, AppSettings, AppTheme, SavedLocation } from './types';
import { getJalaliComponents, formatJalaliFull, toPersianDigits } from './utils/jalali';
import { playRingTune, speakReminderText, playPhoneAlarmSound, setGlobalVolume, stopAlarmRinging, unlockAudio } from './utils/audio';
import { stopFlashlightStrobe } from './utils/torch';
import { TimelineWidget } from './components/TimelineWidget';
import { ReminderForm } from './components/ReminderForm';
import { ReminderCard } from './components/ReminderCard';
import { AlarmModal } from './components/AlarmModal';
import { HeadsUpNotificationBanner } from './components/HeadsUpNotificationBanner';
import { StatisticsModal } from './components/StatisticsModal';
import { SettingsModal } from './components/SettingsModal';
import { IdeaCaptureModal } from './components/IdeaCaptureModal';
import { IdeaCard } from './components/IdeaCard';
import { LocationCaptureModal } from './components/LocationCaptureModal';
import { SavedLocationCard } from './components/SavedLocationCard';
import { InstallModal } from './components/InstallModal';
import { SplashScreen } from './components/SplashScreen';
import { 
  initGoogleAuth, 
  signInWithGoogle, 
  signOutGoogle, 
  syncReminderToCalendar, 
  syncToGoogleTasks 
} from './utils/googleSync';
import { User } from 'firebase/auth';
import confetti from 'canvas-confetti';
import nikAppIcon from './assets/images/nik_reminder_icon_1790104279557.jpg';
import { getNextRecurrenceTimestamp } from './utils/recurrence';
import { 
  initNotificationChannel, 
  scheduleReminderNotification, 
  cancelReminderNotification, 
  rescheduleReminderNotification, 
  syncAllRemindersWithLocalNotifications, 
  setupNotificationListeners,
  getNotificationId
} from './utils/nativeLocalNotifications';
import { getT } from './utils/i18n';
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
  Cloud,
  Check,
  MapPin,
  Download,
  RotateCcw,
  Trash2
} from 'lucide-react';

const REMINDERS_STORAGE_KEY = 'fa_reminder_app_data_v2';
const IDEAS_STORAGE_KEY = 'fa_ideas_app_data_v1';
const LOCATIONS_STORAGE_KEY = 'fa_locations_app_data_v1';
const SETTINGS_STORAGE_KEY = 'fa_settings_app_data_v1';

export default function App() {
  // Theme and Settings state
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch {
      // Fallback
    }
    return {
      language: 'fa',
      theme: 'dark-gold',
      timelineOrientation: 'vertical',
      timelineMode: 'modern',
      fontSize: 'normal',
      systemNotificationsEnabled: true,
      ttsVoiceRate: 0.95,
      defaultRingTune: 'work',
      alarmSound: 'digital-beep',
      alarmVolume: 0.85,
      enableFlash: true,
      autoVoiceInput: false,
      googleMapsApiKey: 'Nikkhah',
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

  // Keep audio volume in sync with settings
  useEffect(() => {
    if (settings.alarmVolume !== undefined) {
      setGlobalVolume(settings.alarmVolume);
    }
  }, [settings.alarmVolume]);

  // Reminders state: Default seed reminders are removed per user request
  const [reminders, setReminders] = useState<Reminder[]>(() => {
    try {
      const saved = localStorage.getItem(REMINDERS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          // Filter out any default seed reminders so they are never loaded again
          return parsed.filter((r: any) => !r.id?.startsWith('seed-'));
        }
      }
    } catch {
      // Fallback
    }

    return [];
  });

  // Ideas & Thoughts state
  const [ideas, setIdeas] = useState<IdeaNote[]>(() => {
    try {
      const saved = localStorage.getItem(IDEAS_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch {
      // Fallback
    }
    return [
      {
        id: 'idea-1',
        title: 'طرح بهبود ساختار داشبورد یادآورها',
        content: 'امکان دسته‌بندی موضوعی افکار، استفاده از قلم رسم، تایپ صوتی بدون مکث و یکپارچگی سریع با تقویم',
        createdAt: Date.now() - 3600000 * 4,
        category: 'work',
      }
    ];
  });

  // Locations state (ثبت موقعیت مکانی با GPS و گوگل‌مپ)
  const [savedLocations, setSavedLocations] = useState<SavedLocation[]>(() => {
    try {
      const saved = localStorage.getItem(LOCATIONS_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
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

  // Main Active Tab: 'reminders', 'ideas', or 'locations'
  const [activeMainTab, setActiveMainTab] = useState<'reminders' | 'ideas' | 'locations'>('reminders');

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
  const [isCreateChoiceOpen, setIsCreateChoiceOpen] = useState(false);
  const [activeAlarmReminder, setActiveAlarmReminder] = useState<Reminder | null>(null);
  const [viewingImageUrl, setViewingImageUrl] = useState<string | null>(null);
  const [installPromptEvent, setInstallPromptEvent] = useState<any>(null);
  const [isAppInstalled, setIsAppInstalled] = useState<boolean>(false);
  const [isInstallModalOpen, setIsInstallModalOpen] = useState<boolean>(false);
  const [isAlarmDetailsOpen, setIsAlarmDetailsOpen] = useState<boolean>(false);
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
  // App startup splash screen (fade in & fade out in <= 2s)
  const [showSplash, setShowSplash] = useState<boolean>(true);
  const [appVisible, setAppVisible] = useState<boolean>(false);
  const handleStartExitSplash = useCallback(() => {
    setAppVisible(true);
  }, []);
  const handleFinishSplash = useCallback(() => {
    setAppVisible(true);
    setShowSplash(false);
  }, []);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | Category | 'completed'>('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | Priority>('all');

  // Live Time & Alarm Checker
  const [currentTime, setCurrentTime] = useState(Date.now());
  const triggeredAlarmsRef = useRef<Set<string>>(new Set());
  const remindersRef = useRef(reminders);
  useEffect(() => {
    remindersRef.current = reminders;
  }, [reminders]);

  const handleCompleteReminderRef = useRef<(id: string) => void>(() => {});
  const handlePostponeRef = useRef<(id: string, mins: number) => void>(() => {});

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

    // Register Service Worker for PWA offline caching
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    // Initialize Android Notification Channel & Listeners for native Local Notifications
    initNotificationChannel().catch(() => {});
    setupNotificationListeners(
      (id) => handleCompleteReminderRef.current(id),
      (id, mins) => handlePostponeRef.current(id, mins)
    );

    // Listen for Chrome / Android PWA beforeinstallprompt event
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPromptEvent(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // When the app is installed via Chrome's 3-dot menu ("Install app" / "نصب برنامه")
    const handleAppInstalled = () => {
      console.log('App was installed via browser menu!');
      setIsAppInstalled(true);
      setInstallPromptEvent(null);
    };

    window.addEventListener('appinstalled', handleAppInstalled);

    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;
    if (isStandalone) {
      setIsAppInstalled(true);
    }

    return () => {
      unsubscribe();
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

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

  // Check URL params for alarmId when launched from notification click
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const params = new URLSearchParams(window.location.search);
      const queryAlarmId = params.get('alarmId');
      if (queryAlarmId) {
        // Clear alarmId query from URL immediately so subsequent re-renders don't re-trigger it
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete('alarmId');
        window.history.replaceState({}, '', cleanUrl.pathname + (cleanUrl.search ? cleanUrl.search : ''));

        const found = reminders.find((r) => r.id === queryAlarmId);
        if (found) {
          setActiveAlarmReminder(found);
        }
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
        // Trigger if pending, due now or within past 24 hours, and not already triggered
        if (
          r.status === 'pending' &&
          r.dueTimestamp <= now &&
          now - r.dueTimestamp < 24 * 3600 * 1000 &&
          !triggeredAlarmsRef.current.has(r.id)
        ) {
          triggeredAlarmsRef.current.add(r.id);
          setActiveAlarmReminder(r);
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

  // Google sign in / out handlers
  const handleGoogleSignIn = async () => {
    try {
      const result = await signInWithGoogle();
      setGoogleUser(result.user);
      setGoogleToken(result.accessToken);
      showSyncNotification('با موفقیت به حساب گوگل متصل شدید.');
    } catch (err: any) {
      alert('خطا در ورود به حساب گوگل: ' + (err.message || ''));
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
      const updatedReminder: Reminder = {
        ...editingReminder,
        ...data,
        status: data.dueTimestamp >= Date.now() ? 'pending' : editingReminder.status,
        googleCalendarEventId: calendarEventId || editingReminder.googleCalendarEventId,
      };

      // Reschedule Android Local Notification
      rescheduleReminderNotification(editingReminder.id, updatedReminder).catch(() => {});

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
        postponeCount: 0,
        googleCalendarEventId: calendarEventId,
      };

      // Schedule Android Local Notification
      scheduleReminderNotification(newReminder).catch(() => {});

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
    setIdeas((prev) => prev.filter((i) => i.id !== id));
  };

  // Handler: Save / Edit Location (ثبت لوکیشن با تکیه بر GPS و گوگل مپ)
  const handleSaveLocation = (
    newLocData: Omit<SavedLocation, 'id' | 'createdAt'>,
    alsoCreateReminder?: boolean
  ) => {
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
          useFlash: true,
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
    setSavedLocations((prev) => prev.filter((loc) => loc.id !== id));
    showSyncNotification('مکان با موفقیت حذف شد.');
  };

  // Handler: Restore local backup data (پشتیبان‌گیری و بازیابی محلی)
  const handleRestoreData = (
    data: {
      reminders?: Reminder[];
      ideas?: IdeaNote[];
      savedLocations?: SavedLocation[];
      settings?: Partial<AppSettings>;
    },
    mode: 'replace' | 'merge'
  ) => {
    if (mode === 'replace') {
      if (data.reminders) setReminders(data.reminders);
      if (data.ideas) setIdeas(data.ideas);
      if (data.savedLocations) setSavedLocations(data.savedLocations);
      if (data.settings) setSettings((prev) => ({ ...prev, ...data.settings }));
    } else {
      // Merge mode
      if (data.reminders && data.reminders.length > 0) {
        setReminders((prev) => {
          const existingIds = new Set(prev.map((r) => r.id));
          const newItems = data.reminders!.filter((r) => !existingIds.has(r.id));
          return [...newItems, ...prev];
        });
      }
      if (data.ideas && data.ideas.length > 0) {
        setIdeas((prev) => {
          const existingIds = new Set(prev.map((i) => i.id));
          const newItems = data.ideas!.filter((i) => !existingIds.has(i.id));
          return [...newItems, ...prev];
        });
      }
      if (data.savedLocations && data.savedLocations.length > 0) {
        setSavedLocations((prev) => {
          const existingIds = new Set(prev.map((l) => l.id));
          const newItems = data.savedLocations!.filter((l) => !existingIds.has(l.id));
          return [...newItems, ...prev];
        });
      }
      if (data.settings) {
        setSettings((prev) => ({ ...prev, ...data.settings }));
      }
    }
    showSyncNotification('داده‌ها با موفقیت بازیابی شدند.');
  };

  // Handler: Complete reminder explicitly (called by Alarm Modal, notifications, and complete actions)
  // Guarantees stopping sound, strobe, closing modal, and prevents re-triggering
  const handleCompleteReminder = (id: string) => {
    stopAlarmRinging();
    stopFlashlightStrobe();
    setActiveAlarmReminder(null);
    triggeredAlarmsRef.current.add(id);

    // Cancel Android Local Notification for completed reminder
    cancelReminderNotification(id).catch(() => {});

    setReminders((prev) =>
      prev.map((r) => {
        if (r.id === id) {
          // If recurring reminder is being marked completed, advance to next recurrence
          if (r.recurrence && r.recurrence !== 'none') {
            const nextDue = getNextRecurrenceTimestamp(r, Date.now());
            if (nextDue) {
              const recurringUpdated: Reminder = {
                ...r,
                dueTimestamp: nextDue,
                status: 'pending',
                completedAt: undefined,
                postponeCount: 0,
              };
              // Schedule next recurrence in Android Local Notifications
              scheduleReminderNotification(recurringUpdated).catch(() => {});

              confetti({
                particleCount: 50,
                spread: 60,
                origin: { y: 0.8 },
              });
              showSyncNotification(`✓ انجام شد! نوبت بعدی برای ${formatJalaliFull(nextDue)} زمان‌بندی شد.`);
              return recurringUpdated;
            }
          }

          // Non-recurring or completed custom dates
          confetti({
            particleCount: 50,
            spread: 60,
            origin: { y: 0.8 },
          });
          return {
            ...r,
            status: 'completed',
            completedAt: Date.now(),
          };
        }
        return r;
      })
    );
  };

  handleCompleteReminderRef.current = handleCompleteReminder;

  // Handler: Toggle complete from reminder card list checkbox
  const handleToggleComplete = (id: string) => {
    stopAlarmRinging();
    stopFlashlightStrobe();
    setActiveAlarmReminder((curr) => (curr?.id === id ? null : curr));

    setReminders((prev) => {
      const target = prev.find((r) => r.id === id);
      if (!target) return prev;
      if (target.status !== 'completed') {
        triggeredAlarmsRef.current.add(id);
        // Cancel Android Local Notification
        cancelReminderNotification(id).catch(() => {});

        confetti({
          particleCount: 50,
          spread: 60,
          origin: { y: 0.8 },
        });

        if (target.recurrence && target.recurrence !== 'none') {
          const nextDue = getNextRecurrenceTimestamp(target, Date.now());
          if (nextDue) {
            const recurringNext: Reminder = {
              ...target,
              dueTimestamp: nextDue,
              status: 'pending',
              completedAt: undefined,
              postponeCount: 0,
            };
            scheduleReminderNotification(recurringNext).catch(() => {});

            showSyncNotification(`✓ انجام شد! نوبت بعدی برای ${formatJalaliFull(nextDue)} زمان‌بندی شد.`);
            return prev.map((r) => (r.id === id ? recurringNext : r));
          }
        }

        return prev.map((r) =>
          r.id === id
            ? {
                ...r,
                status: 'completed',
                completedAt: Date.now(),
              }
            : r
        );
      }

      // If user deliberately un-completes a completed reminder in the list
      triggeredAlarmsRef.current.delete(id);
      if (target.dueTimestamp > Date.now()) {
        scheduleReminderNotification({ ...target, status: 'pending' }).catch(() => {});
      }
      return prev.map((r) =>
        r.id === id
          ? {
              ...r,
              status: 'pending',
              completedAt: undefined,
            }
          : r
      );
    });
  };

  // Handler: Postpone reminder
  const handlePostpone = (id: string, minutes: number) => {
    stopAlarmRinging();
    stopFlashlightStrobe();
    setActiveAlarmReminder(null);
    setReminders((prev) =>
      prev.map((r) => {
        if (r.id === id) {
          const newDue = Math.max(Date.now(), r.dueTimestamp) + minutes * 60000;
          triggeredAlarmsRef.current.delete(id);
          const postponedRem: Reminder = {
            ...r,
            dueTimestamp: newDue,
            status: 'postponed',
            postponedAt: Date.now(),
            postponeCount: r.postponeCount + 1,
          };
          // Reschedule notification for the new postponed time
          rescheduleReminderNotification(id, postponedRem).catch(() => {});
          return postponedRem;
        }
        return r;
      })
    );
  };

  handlePostponeRef.current = handlePostpone;

  // Handler: Delete reminder with 5-second Undo capability
  const handleDelete = (id: string) => {
    stopAlarmRinging();
    stopFlashlightStrobe();
    setActiveAlarmReminder((curr) => (curr?.id === id ? null : curr));
    triggeredAlarmsRef.current.delete(id);

    // Cancel Android Local Notification immediately
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

    setReminders((prev) => prev.filter((r) => r.id !== id));
  };

  const handleUndoDelete = () => {
    if (!undoToast) return;
    if (undoToast.timer) clearTimeout(undoToast.timer);

    const restored = undoToast.reminder;
    const restoreIdx = undoToast.index;

    // Reschedule restored reminder if pending and in the future
    if (restored.status === 'pending' && restored.dueTimestamp > Date.now()) {
      scheduleReminderNotification(restored).catch(() => {});
    }

    setReminders((prev) => {
      const copy = [...prev];
      const validIndex = Math.min(Math.max(0, restoreIdx), copy.length);
      copy.splice(validIndex, 0, restored);
      return copy;
    });

    setUndoToast(null);
    showSyncNotification(settings.language === 'en' ? 'Reminder restored' : 'یادآور با موفقیت بازگردانده شد');
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

  // Filtered list
  const filteredReminders = reminders.filter((r) => {
    if (categoryFilter === 'completed') {
      if (r.status !== 'completed') return false;
    } else if (categoryFilter !== 'all') {
      if (r.category !== categoryFilter) return false;
    }

    if (priorityFilter !== 'all' && r.priority !== priorityFilter) {
      return false;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTitle = r.title.toLowerCase().includes(q);
      const matchDesc = r.description?.toLowerCase().includes(q);
      return matchTitle || matchDesc;
    }

    return true;
  });

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

  // Dynamic Theme CSS container styling
  const getThemeClass = (theme: AppTheme) => {
    switch (theme) {
      case 'dark-slate':
        return 'bg-slate-950 text-slate-100 selection:bg-sky-500 selection:text-slate-950';
      case 'light-clean':
        return 'bg-stone-50 text-stone-900 selection:bg-amber-500 selection:text-stone-950';
      case 'sketch-contrast':
        return 'bg-black text-white selection:bg-white selection:text-black font-mono';
      default:
        return 'bg-stone-950 text-stone-100 selection:bg-amber-500 selection:text-stone-950';
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
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-2xl bg-amber-500 text-stone-950 font-bold text-xs shadow-2xl flex items-center gap-2 animate-bounce">
          <Check className="w-4 h-4" />
          <span>{syncToast}</span>
        </div>
      )}

      {/* 5-SECOND UNDO TOAST NOTIFICATION */}
      {undoToast && (
        <div 
          className="fixed bottom-22 sm:bottom-10 left-1/2 -translate-x-1/2 z-50 px-4 py-3 rounded-2xl bg-stone-900/95 border-2 border-amber-500/80 text-white shadow-2xl shadow-black/95 flex items-center gap-3.5 backdrop-blur-xl animate-in fade-in slide-in-from-bottom-4 duration-200"
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
            className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 font-black text-xs flex items-center gap-1.5 transition-all shadow-md active:scale-95 cursor-pointer shrink-0"
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
      <header className={`sticky top-0 z-30 backdrop-blur-md border-b ${
        settings.theme === 'light-clean' 
          ? 'bg-white/90 border-stone-200 text-stone-900' 
          : 'bg-stone-900/90 border-stone-800 text-stone-100'
      }`}>
        <div className="w-full px-2 sm:px-4 md:px-6 h-15 sm:h-16 flex items-center justify-between gap-2.5">
          {/* Logo Icon Button (لمس آیکون برنامه برای بازگشت به صفحه اصلی - شکل زنگوله قبلی) */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={() => {
                setActiveMainTab('reminders');
                setEditingReminder(null);
                setIsFormOpen(false);
                setIsIdeaModalOpen(false);
                setIsLocationModalOpen(false);
                setIsSettingsOpen(false);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-amber-500/20 border border-amber-500/40 text-amber-400 flex items-center justify-center flex-shrink-0 group cursor-pointer active:scale-95 transition-all shadow-md shadow-amber-500/20 hover:bg-amber-500/30"
              title={settings.language === 'en' ? 'Go to Home' : 'بازگشت به صفحه اصلی'}
            >
              <Bell className="w-4.5 h-4.5 sm:w-5 sm:h-5 text-amber-400 transition-transform duration-300 group-hover:scale-110" />
            </button>
            {googleUser && (
              <span className="hidden md:flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20 font-bold">
                <Cloud className="w-3 h-3" />
                {settings.language === 'en' ? 'Google Synced' : 'همگام با گوگل'}
              </span>
            )}
          </div>

          {/* Navigation Action Buttons - Compact Tabs so Settings button is ALWAYS accessible */}
          <div className="flex items-center gap-1 sm:gap-2 min-w-0">
            {/* Main Section Switch: Reminders vs Ideas vs Locations (Compact Width) */}
            <div className="flex bg-stone-800/90 p-0.5 sm:p-1 rounded-xl border border-stone-700/60 text-[10px] sm:text-xs">
              <button
                type="button"
                onClick={() => setActiveMainTab('reminders')}
                className={`px-1.5 sm:px-2.5 py-1 sm:py-1.5 rounded-lg font-bold transition-all whitespace-nowrap ${
                  activeMainTab === 'reminders'
                    ? 'bg-stone-900 border border-amber-400/80 text-amber-300 font-black shadow-sm'
                    : 'text-stone-300 hover:text-white'
                }`}
              >
                <span>{t.tabReminders}</span>
                <span className="opacity-80 text-[9px] sm:text-xs mr-0.5 ml-0.5 font-mono">
                  ({settings.language === 'en' ? reminders.length : toPersianDigits(reminders.length)})
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveMainTab('ideas')}
                className={`flex items-center gap-0.5 sm:gap-1 px-1.5 sm:px-2.5 py-1 sm:py-1.5 rounded-lg font-bold transition-all whitespace-nowrap ${
                  activeMainTab === 'ideas'
                    ? 'bg-stone-900 border border-amber-400/80 text-amber-300 font-black shadow-sm'
                    : 'text-stone-300 hover:text-white'
                }`}
              >
                <Lightbulb className="w-3 h-3 text-amber-400 shrink-0" />
                <span>{t.tabIdeas}</span>
                <span className="opacity-80 text-[9px] sm:text-xs font-mono">
                  ({settings.language === 'en' ? ideas.length : toPersianDigits(ideas.length)})
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveMainTab('locations')}
                className={`flex items-center gap-0.5 sm:gap-1 px-1.5 sm:px-2.5 py-1 sm:py-1.5 rounded-lg font-bold transition-all whitespace-nowrap ${
                  activeMainTab === 'locations'
                    ? 'bg-stone-900 border border-amber-400/80 text-amber-300 font-black shadow-sm'
                    : 'text-stone-300 hover:text-white'
                }`}
              >
                <MapPin className="w-3 h-3 text-amber-400 shrink-0" />
                <span>{t.tabLocations}</span>
                <span className="opacity-80 text-[9px] sm:text-xs font-mono">
                  ({settings.language === 'en' ? savedLocations.length : toPersianDigits(savedLocations.length)})
                </span>
              </button>
            </div>

            {/* Install App Button (Compact / Icon on mobile) */}
            {!isAppInstalled && (
              <button
                type="button"
                onClick={handleInstallClick}
                className="hidden xs:flex items-center gap-1 px-2 sm:px-2.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 font-black text-xs transition-all active:scale-95 cursor-pointer shadow-md shadow-amber-500/20 whitespace-nowrap flex-shrink-0"
                title={t.installApp}
              >
                <Download className="w-3.5 h-3.5 stroke-[2.5]" />
                <span className="hidden sm:inline">{t.installApp}</span>
              </button>
            )}

            {/* Settings Button in Header - ALWAYS ACCESSIBLE & FLEX-SHRINK-0 */}
            <button
              id="header-open-settings-btn"
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              className="p-1.5 sm:px-3 sm:py-1.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-200 hover:text-white border border-stone-700 text-xs font-bold transition-all flex items-center gap-1.5 flex-shrink-0 cursor-pointer shadow-sm active:scale-95"
              title={t.settings}
            >
              <SettingsIcon className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="hidden sm:inline">{t.settings}</span>
            </button>

            {/* Primary Action Button (Desktop/Tablet) */}
            {activeMainTab === 'reminders' ? (
              <button
                id="header-create-reminder-btn"
                type="button"
                onClick={() => {
                  setEditingReminder(null);
                  setIsFormOpen(true);
                }}
                className="hidden md:flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 text-xs sm:text-sm font-black shadow-lg shadow-amber-500/25 transition-all active:scale-95 flex-shrink-0"
              >
                <Plus className="w-4 h-4 text-stone-950 stroke-[3]" />
                <span>{t.newReminder}</span>
              </button>
            ) : activeMainTab === 'ideas' ? (
              <button
                id="header-create-idea-btn"
                type="button"
                onClick={() => setIsIdeaModalOpen(true)}
                className="hidden md:flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-stone-950 text-xs sm:text-sm font-black shadow-lg shadow-sky-500/25 transition-all active:scale-95 flex-shrink-0"
              >
                <Plus className="w-4 h-4 text-stone-950 stroke-[3]" />
                <span>{t.addIdeaTitle}</span>
              </button>
            ) : (
              <button
                id="header-create-location-btn"
                type="button"
                onClick={() => setIsLocationModalOpen(true)}
                className="hidden md:flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-stone-950 text-xs sm:text-sm font-black shadow-lg shadow-emerald-500/25 transition-all active:scale-95 flex-shrink-0"
              >
                <Plus className="w-4 h-4 text-stone-950 stroke-[3]" />
                <span>{t.addLocationTitle}</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Container - Maximum Width coverage across screen */}
      <main className="flex-1 w-full px-2 sm:px-4 md:px-6 py-3.5 sm:py-5 space-y-4 sm:space-y-6">
        
        {/* VIEW 1: REMINDERS TAB */}
        {activeMainTab === 'reminders' && (
          <>
            {/* SECTION 1: PROMINENT TIMELINE CHART WIDGET (Vertical Auto-Expanding) */}
            <section aria-label={isEn ? 'Reminders Timeline Chart' : 'نمودار محور زمان یادآورها'}>
              <TimelineWidget
                reminders={reminders}
                onToggleComplete={handleToggleComplete}
                onPostpone={handlePostpone}
                onSelectReminder={(rem) => {
                  setEditingReminder(rem);
                  setIsFormOpen(true);
                }}
                timelineMode={settings.timelineMode}
                language={settings.language}
              />
            </section>

            {/* SECTION 2: SEARCH, QUICK FILTERS & CATEGORY BUTTONS */}
            <section className="space-y-4">
              <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
                {/* Category Tabs: کار، خانواده، سایر، انجام شده */}
                <div className="flex items-center gap-2 p-1.5 bg-stone-900 rounded-2xl border border-stone-800 overflow-x-auto text-xs sm:text-sm font-bold no-scrollbar">
                  <button
                    id="filter-cat-all"
                    type="button"
                    style={{ color: '#ffffff', borderColor: '#ffffff' }}
                    onClick={() => setCategoryFilter('all')}
                    className={`px-3.5 py-2.5 rounded-xl transition-all whitespace-nowrap active:scale-95 ${
                      categoryFilter === 'all'
                        ? 'bg-amber-500 text-stone-950 font-black shadow-sm'
                        : 'text-stone-300 hover:text-white'
                    }`}
                  >
                    {t.filterAll} ({formatNumber(reminders.length)})
                  </button>

                  <button
                    id="filter-cat-work"
                    type="button"
                    onClick={() => setCategoryFilter('work')}
                    className={`flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl transition-all whitespace-nowrap active:scale-95 ${
                      categoryFilter === 'work'
                        ? 'bg-cyan-500 text-stone-950 font-black shadow-sm'
                        : 'text-cyan-300/90 hover:text-white'
                    }`}
                  >
                    <Briefcase className="w-4 h-4" />
                    <span>{t.categoryWork} ({formatNumber(reminders.filter((r) => r.category === 'work').length)})</span>
                  </button>

                  <button
                    id="filter-cat-family"
                    type="button"
                    onClick={() => setCategoryFilter('family')}
                    className={`flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl transition-all whitespace-nowrap active:scale-95 ${
                      categoryFilter === 'family'
                        ? 'bg-rose-500 text-stone-950 font-black shadow-sm'
                        : 'text-rose-300/90 hover:text-white'
                    }`}
                  >
                    <Heart className="w-4 h-4" />
                    <span>{t.categoryFamily} ({formatNumber(reminders.filter((r) => r.category === 'family').length)})</span>
                  </button>

                  <button
                    id="filter-cat-other"
                    type="button"
                    onClick={() => setCategoryFilter('other')}
                    className={`flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl transition-all whitespace-nowrap active:scale-95 ${
                      categoryFilter === 'other'
                        ? 'bg-emerald-500 text-stone-950 font-black shadow-sm'
                        : 'text-emerald-300/90 hover:text-white'
                    }`}
                  >
                    <Tag className="w-4 h-4" />
                    <span>{t.categoryOther} ({formatNumber(reminders.filter((r) => r.category === 'other').length)})</span>
                  </button>

                  <button
                    id="filter-cat-completed"
                    type="button"
                    onClick={() => setCategoryFilter('completed')}
                    className={`flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl transition-all whitespace-nowrap active:scale-95 ${
                      categoryFilter === 'completed'
                        ? 'bg-stone-700 text-white font-black shadow-sm'
                        : 'text-stone-300 hover:text-white'
                    }`}
                  >
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>{t.done} ({formatNumber(reminders.filter((r) => r.status === 'completed').length)})</span>
                  </button>
                </div>

                {/* Search Input & Priority Filter */}
                <div className="flex items-center gap-2">
                  <div className="relative flex-1 sm:w-64">
                    <Search className="w-4 h-4 text-stone-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={t.searchPlaceholder}
                      className="w-full bg-stone-900 border border-stone-800 rounded-xl pr-10 pl-3.5 py-2.5 text-xs sm:text-sm text-white placeholder-stone-400 focus:outline-none focus:border-amber-500"
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery('')}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-white"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  <select
                    value={priorityFilter}
                    onChange={(e) => setPriorityFilter(e.target.value as any)}
                    className="bg-stone-900 border border-stone-800 rounded-xl px-3 py-2.5 text-xs sm:text-sm text-stone-200 focus:outline-none focus:border-amber-500 font-medium"
                  >
                    <option value="all">{isEn ? 'All Priorities' : 'همه اولویت‌ها'}</option>
                    <option value="high">{isEn ? 'High (Urgent)' : 'فقط فوری'}</option>
                    <option value="medium">{isEn ? 'Medium' : 'متوسط'}</option>
                    <option value="low">{isEn ? 'Normal' : 'عادی'}</option>
                  </select>
                </div>
              </div>
            </section>

            {/* SECTION 3: REMINDERS LIST */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-sm text-stone-300">
                  {isEn ? 'Reminders List' : 'فهرست یادآورها'} ({formatNumber(sortedReminders.length)})
                </h3>
              </div>

              {sortedReminders.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
                  {sortedReminders.map((reminder) => (
                    <ReminderCard
                      key={reminder.id}
                      reminder={reminder}
                      isNext={reminder.id === upcomingReminder?.id && reminder.status !== 'completed'}
                      countdown={reminder.id === upcomingReminder?.id ? upcomingCountdown : null}
                      onToggleComplete={handleToggleComplete}
                      onPostpone={handlePostpone}
                      onDelete={handleDelete}
                      onEdit={(r) => {
                        setEditingReminder(r);
                        setIsFormOpen(true);
                      }}
                      onViewImage={(url) => setViewingImageUrl(url)}
                      language={settings.language}
                    />
                  ))}
                </div>
              ) : (
                <div className="py-10 px-3 text-center rounded-2xl border border-dashed border-stone-800 bg-stone-900/40 space-y-3">
                  <div className="w-12 h-12 rounded-full bg-stone-800 text-stone-400 flex items-center justify-center mx-auto">
                    <Bell className="w-6 h-6" />
                  </div>
                  <h4 className="font-bold text-sm text-white">
                    {isEn ? 'No reminders found' : 'یادآوری یافت نشد'}
                  </h4>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingReminder(null);
                      setIsFormOpen(true);
                    }}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 !text-white text-xs font-bold transition-all shadow-md active:scale-95 cursor-pointer"
                  >
                    <Plus className="w-4 h-4 text-white stroke-[3]" />
                    <span className="text-white font-black">
                      {isEn ? 'Create New Reminder' : 'ثبت یادآور جدید'}
                    </span>
                  </button>
                </div>
              )}
            </section>
          </>
        )}

        {/* VIEW 2: IDEAS & THOUGHTS SECTION */}
        {activeMainTab === 'ideas' && (
          <section className="space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-stone-800">
              <h3 className="font-bold text-base sm:text-lg text-white flex items-center gap-2">
                <Lightbulb className="w-5 h-5 text-amber-400" />
                <span>{isEn ? 'Organize Ideas & Notes' : 'ثبت و سازماندهی ایده و افکار'}</span>
              </h3>

              <button
                type="button"
                onClick={() => setIsIdeaModalOpen(true)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 !text-white font-bold text-xs shadow-md transition-all self-stretch sm:self-auto justify-center active:scale-95 cursor-pointer"
              >
                <Plus className="w-4 h-4 text-white stroke-[3]" />
                <span className="text-white font-black">
                  {isEn ? 'Capture New Idea' : 'ثبت فکر یا ایده جدید'}
                </span>
              </button>
            </div>

            {ideas.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {ideas.map((idea) => (
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
              <div className="py-12 text-center rounded-2xl border border-dashed border-stone-800 bg-stone-900/40 space-y-3">
                <div className="w-12 h-12 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center justify-center mx-auto">
                  <Lightbulb className="w-6 h-6" />
                </div>
                <h4 className="font-bold text-sm text-white">
                  {isEn ? 'No ideas recorded yet' : 'هنوز ایده‌ای ثبت نشده است'}
                </h4>
                <button
                  type="button"
                  onClick={() => setIsIdeaModalOpen(true)}
                  className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 !text-white font-black text-xs shadow-md active:scale-95 cursor-pointer flex items-center gap-1.5 mx-auto"
                >
                  <Plus className="w-4 h-4 text-white stroke-[3]" />
                  <span className="text-white font-black">
                    {isEn ? 'Create New Idea' : 'ثبت ایده جدید'}
                  </span>
                </button>
              </div>
            )}
          </section>
        )}

        {/* VIEW 3: LOCATIONS TAB (ثبت لوکیشن با تکیه بر GPS و گوگل مپ) */}
        {activeMainTab === 'locations' && (
          <section className="space-y-4 animate-in fade-in">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-stone-800/80">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center flex-shrink-0">
                  <MapPin className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-base sm:text-lg text-white flex items-center gap-2">
                    <span>{isEn ? 'Saved Places with GPS & Google Maps' : 'مکان‌های ثبت‌شده با GPS و Google Maps'}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-mono">
                      {formatNumber(savedLocations.length)}
                    </span>
                  </h3>
                  <p className="text-[11px] text-stone-400">
                    {isEn ? 'Satellite coordinates, Google Maps preview, camera photo and notes' : 'ذخیره خودکار مختصات ماهواره‌ای، پیش‌نمایش در گوگل‌مپ، فیلد توضیحات و عکس زنده دوربین'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsLocationModalOpen(true)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 !text-white font-bold text-xs shadow-md shadow-emerald-500/20 transition-all self-stretch sm:self-auto justify-center cursor-pointer active:scale-95"
              >
                <Plus className="w-4 h-4 text-white stroke-[3]" />
                <span className="text-white font-black">
                  {isEn ? 'Save New Location' : 'ثبت لوکیشن جدید'}
                </span>
              </button>
            </div>

            {savedLocations.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {savedLocations.map((loc) => (
                  <SavedLocationCard
                    key={loc.id}
                    location={loc}
                    onDelete={handleDeleteLocation}
                    onEdit={(item) => {
                      setEditingLocation(item);
                      setIsLocationModalOpen(true);
                    }}
                    onViewPhoto={(url) => setViewingImageUrl(url)}
                    language={settings.language}
                  />
                ))}
              </div>
            ) : (
              <div className="py-12 text-center rounded-2xl border border-dashed border-stone-800 bg-stone-900/40 space-y-3">
                <div className="w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center mx-auto">
                  <MapPin className="w-6 h-6" />
                </div>
                <h4 className="font-bold text-sm text-white">
                  {isEn ? 'No locations saved yet' : 'هنوز مکانی ثبت نشده است'}
                </h4>
                <p className="text-xs text-stone-400 max-w-sm mx-auto leading-relaxed">
                  {isEn 
                    ? 'Saving a location records exact GPS satellite coordinates, phone camera photos, notes, and directions on Google Maps.'
                    : 'با ثبت لوکیشن، مختصات دقیق GPS به همراه عکس با دوربین گوشی، یادداشت‌ها و امکان مسیریابی در گوگل مپ ذخیره می‌شود.'}
                </p>
                <button
                  type="button"
                  onClick={() => setIsLocationModalOpen(true)}
                  className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 !text-white font-black text-xs shadow-md cursor-pointer active:scale-95 flex items-center gap-1.5 mx-auto"
                >
                  <Plus className="w-4 h-4 text-white stroke-[3]" />
                  <span className="text-white font-black">
                    {isEn ? 'Save First Location' : 'ثبت اولین موقعیت'}
                  </span>
                </button>
              </div>
            )}
          </section>
        )}

      </main>

      {/* FLOATING ACTION BUTTON (+) - POSITION ALWAYS FIXED ON THE RIGHT (NON-FLIPPING ACROSS LANGUAGES) */}
      <div 
        className="fixed bottom-5 sm:bottom-7 z-40 flex items-center pointer-events-auto transition-all duration-300" 
        style={{ right: '1.25rem', left: 'auto' }}
        dir="ltr"
      >
        {/* Relative container for FAB and choice popup */}
        <div className="relative">
          {/* Choice Menu Popup */}
          {isCreateChoiceOpen && (
            <>
              {/* Clickaway backdrop */}
              <div 
                className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" 
                onClick={() => setIsCreateChoiceOpen(false)}
              />

              {/* Popup Options: Fixed on the right side with zoom-out entrance effect */}
              <div className="absolute bottom-16 sm:bottom-20 right-0 origin-bottom-right z-50 bg-stone-900/95 border-2 border-teal-500/80 rounded-3xl p-3 sm:p-4 shadow-2xl shadow-black/95 backdrop-blur-2xl w-64 sm:w-72 space-y-2.5 animate-zoom-out">
                {/* Option 1: Reminder */}
                <button
                  type="button"
                  onClick={() => {
                    setIsCreateChoiceOpen(false);
                    setEditingReminder(null);
                    setIsFormOpen(true);
                  }}
                  className="w-full flex items-center gap-3.5 p-3 rounded-2xl hover:bg-amber-500/15 text-left rtl:text-right text-stone-100 hover:text-amber-300 transition-all cursor-pointer group active:scale-95 border border-amber-500/30 hover:border-amber-500/60 shadow-md"
                >
                  <div className="w-11 h-11 rounded-xl bg-amber-500/20 border border-amber-500/50 text-amber-400 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform shadow-inner">
                    <Bell className="w-5 h-5 stroke-[2.2]" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm sm:text-base font-black text-white">
                      {isEn ? 'New Reminder' : 'ثبت یادآور'}
                    </span>
                    <span className="text-[11px] text-stone-400 group-hover:text-amber-200">
                      {isEn ? 'With alarm, audio & recurrence' : 'با آلارم، صوت و تقویم شمسی'}
                    </span>
                  </div>
                </button>

                {/* Option 2: Idea */}
                <button
                  type="button"
                  onClick={() => {
                    setIsCreateChoiceOpen(false);
                    setIsIdeaModalOpen(true);
                  }}
                  className="w-full flex items-center gap-3.5 p-3 rounded-2xl hover:bg-sky-500/15 text-left rtl:text-right text-stone-100 hover:text-sky-300 transition-all cursor-pointer group active:scale-95 border border-sky-500/30 hover:border-sky-500/60 shadow-md"
                >
                  <div className="w-11 h-11 rounded-xl bg-sky-500/20 border border-sky-500/50 text-sky-400 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform shadow-inner">
                    <Lightbulb className="w-5 h-5 stroke-[2.2]" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm sm:text-base font-black text-white">
                      {isEn ? 'Capture Idea' : 'ثبت ایده'}
                    </span>
                    <span className="text-[11px] text-stone-400 group-hover:text-sky-200">
                      {isEn ? 'Text, voice memo, video & sketch' : 'متن، ویس، ویدیو و نقاشی'}
                    </span>
                  </div>
                </button>

                {/* Option 3: Location (GPS & Google Maps) */}
                <button
                  type="button"
                  onClick={() => {
                    setIsCreateChoiceOpen(false);
                    setIsLocationModalOpen(true);
                  }}
                  className="w-full flex items-center gap-3.5 p-3 rounded-2xl hover:bg-teal-500/15 text-left rtl:text-right text-stone-100 hover:text-teal-300 transition-all cursor-pointer group active:scale-95 border border-teal-500/30 hover:border-teal-500/60 shadow-md"
                >
                  <div className="w-11 h-11 rounded-xl bg-teal-500/20 border border-teal-500/50 text-teal-400 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform shadow-inner">
                    <MapPin className="w-5 h-5 stroke-[2.2]" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm sm:text-base font-black text-white">
                      {isEn ? 'Save GPS Location' : 'ثبت لوکیشن (GPS)'}
                    </span>
                    <span className="text-[11px] text-stone-400 group-hover:text-teal-200">
                      {isEn ? 'Coordinates, photo & maps' : 'مختصات، عکس دوربین و نقشه'}
                    </span>
                  </div>
                </button>
              </div>
            </>
          )}

          {/* Circular FAB */}
          <button
            id="fab-create-btn"
            data-keep-color="true"
            type="button"
            style={{ width: '60px', height: '60px' }}
            onClick={() => setIsCreateChoiceOpen(!isCreateChoiceOpen)}
            className={`fab-add-btn rounded-full !bg-gradient-to-r !from-amber-500 !to-amber-400 hover:!from-amber-400 hover:!to-amber-300 text-stone-950 flex items-center justify-center shadow-2xl shadow-amber-500/40 hover:scale-105 active:scale-95 transition-all !border-2 !border-amber-300 flex-shrink-0 cursor-pointer ${
              isCreateChoiceOpen ? 'rotate-45' : ''
            }`}
            title={isEn ? 'Add New (Reminder, Idea, Place)' : 'ثبت جدید (یادآور، ایده یا لوکیشن)'}
            aria-label={isEn ? 'Add New' : 'ثبت جدید'}
          >
            <Plus style={{ width: '35px', height: '35px' }} className="w-7 h-7 stroke-[3] transition-transform duration-200" />
          </button>
        </div>
      </div>

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
        googleMapsApiKey={settings.googleMapsApiKey}
        editingLocation={editingLocation}
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
        onRestoreData={handleRestoreData}
        onTestHeadsUpBanner={(testRem) => {
          setActiveAlarmReminder(testRem);
          setIsAlarmDetailsOpen(false);
        }}
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
        language={settings.language}
      />

      {/* STATISTICS MODAL */}
      <StatisticsModal
        isOpen={isStatsOpen}
        onClose={() => setIsStatsOpen(false)}
        reminders={reminders}
        language={settings.language}
      />

      {/* HEADS-UP NOTIFICATION BANNER (Top-of-screen alert over app - matching Android Reminder) */}
      {activeAlarmReminder && !isAlarmDetailsOpen && (
        <HeadsUpNotificationBanner
          reminder={activeAlarmReminder}
          settings={settings}
          language={settings.language}
          onComplete={(id) => {
            handleCompleteReminder(id);
            setActiveAlarmReminder(null);
            setIsAlarmDetailsOpen(false);
          }}
          onPostpone={(id, mins) => {
            handlePostpone(id, mins);
            setActiveAlarmReminder(null);
            setIsAlarmDetailsOpen(false);
          }}
          onDismiss={() => {
            stopAlarmRinging();
            stopFlashlightStrobe();
            setActiveAlarmReminder(null);
            setIsAlarmDetailsOpen(false);
          }}
          onOpenDetails={() => {
            setIsAlarmDetailsOpen(true);
          }}
        />
      )}

      {/* ACTIVE FULL ALARM MODAL (Opened if user clicks Details on the Heads-Up banner) */}
      {activeAlarmReminder && isAlarmDetailsOpen && (
        <AlarmModal
          reminder={activeAlarmReminder}
          settings={settings}
          onUpdateSettings={(newS) => setSettings((prev) => ({ ...prev, ...newS }))}
          onDismiss={() => {
            stopAlarmRinging();
            stopFlashlightStrobe();
            setActiveAlarmReminder(null);
            setIsAlarmDetailsOpen(false);
            setActiveMainTab('reminders');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          onComplete={(id) => {
            handleCompleteReminder(id);
            setActiveAlarmReminder(null);
            setIsAlarmDetailsOpen(false);
            setActiveMainTab('reminders');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          onPostpone={(id, mins) => {
            handlePostpone(id, mins);
            setActiveAlarmReminder(null);
            setIsAlarmDetailsOpen(false);
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

      </div>
      
      {/* APP STARTUP SPLASH SCREEN (FADE IN/OUT IN <= 2 SECONDS) */}
      {showSplash && (
        <SplashScreen 
          onStartExit={handleStartExitSplash} 
          onFinish={handleFinishSplash} 
          matteDelayMs={0}
          logoDisplayMs={1400}
          fadeOutMs={350}
          language={settings.language}
        />
      )}
    </>
  );
}

import React, { useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Category, Priority, Reminder, RecurrenceType, SavedLocation } from '../types';
import { 
  getJalaliComponents, 
  toPersianDigits, 
  jalaliToGregorian,
  getCurrentTimezoneMeta,
  isSelectedDateTimeInPast
} from '../utils/jalali';
import { 
  RECURRENCE_OPTIONS, 
  PERSIAN_WEEK_DAYS, 
  ENGLISH_WEEK_DAYS 
} from '../utils/recurrence';
import { JalaliMultiDatePicker } from './JalaliMultiDatePicker';
import { YaadCalendarPicker } from './YaadCalendarPicker';
import { CameraCaptureModal } from './CameraCaptureModal';
import { isNativeAndroidApp, openAndroidSettings } from '../utils/nativePermissions';
import { requestNotificationPermission } from '../utils/nativeLocalNotifications';
import { appendWithoutDuplicate, safeAbortSpeechRecognition } from '../utils/speechDeduplication';
import { 
  Mic, 
  Calendar, 
  Briefcase, 
  Heart, 
  Tag, 
  Camera, 
  Upload, 
  Zap, 
  X, 
  Plus,
  Trash2,
  Check,
  Repeat,
  AlertCircle,
  Smartphone,
  ChevronDown,
  Sliders
} from 'lucide-react';
import { WheelPicker } from './WheelPicker';
import { AppLanguage } from '../utils/i18n';
import { ValidationAlertModal } from './ValidationAlertModal';
import { scrollAccordionHeaderIntoView } from '../utils/accordionScroll';
import { ProBadge } from './ProBadge';

interface ReminderFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (reminder: Omit<Reminder, 'id' | 'createdAt' | 'status' | 'postponeCount'>, syncGoogle?: boolean) => void;
  initialData?: Reminder | null;
  googleToken?: string | null;
  savedLocations?: SavedLocation[];
  language?: AppLanguage;
  defaultEnableGeofence?: boolean;
  focusGeofenceRadius?: boolean;
  hasProAccess?: boolean;
  onRequirePro?: (feature: 'photo' | 'geofence') => void;
}


// Browser Web Speech recognition interface
interface IWindow extends Window {
  webkitSpeechRecognition?: any;
  SpeechRecognition?: any;
}

const HOUR_WHEEL_ITEMS = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: i.toString().padStart(2, '0'),
}));
const MINUTE_WHEEL_ITEMS = Array.from({ length: 60 }, (_, i) => ({
  value: i,
  label: i.toString().padStart(2, '0'),
}));

export const ReminderForm: React.FC<ReminderFormProps> = ({
  isOpen,
  onClose,
  onSave,
  initialData,
  googleToken,
  language = 'fa',
  hasProAccess = true,
  onRequirePro,
}) => {
  const isEn = language === 'en';
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<Category>('work');
  const [priority, setPriority] = useState<Priority>('medium');
  const [priorityLevel, setPriorityLevel] = useState<number>(3); // 1 to 10 numerical priority

  const handleSelectPriority = (level: number) => {
    const clamped = Math.max(1, Math.min(10, level));
    setPriorityLevel(clamped);
    if (clamped >= 4) {
      setPriority('high');
    } else if (clamped >= 2) {
      setPriority('medium');
    } else {
      setPriority('low');
    }
  };

  const [imageUrl, setImageUrl] = useState<string | undefined>(undefined);
  const [voiceReadAloud, setVoiceReadAloud] = useState(true);
  const [ringTune, setRingTune] = useState<string>('work');
  const [syncWithGoogle, setSyncWithGoogle] = useState(!!googleToken);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [showMoreOptions, setShowMoreOptions] = useState(false);

  // Calculate dynamic default time (+2 minutes from now)
  const getDynamicDefaultTime = () => {
    const t = Date.now() + 2 * 60 * 1000;
    const j = getJalaliComponents(t);
    const d = new Date(t);
    return {
      jalali: j,
      gregorian: {
        year: d.getFullYear(),
        month: d.getMonth() + 1,
        day: d.getDate(),
        hour: d.getHours(),
        minute: d.getMinutes(),
      },
    };
  };

  // Persian/Gregorian date picker states initialized to exactly 2 minutes after current time
  const [selectedYear, setSelectedYear] = useState(() => language === 'en' ? getDynamicDefaultTime().gregorian.year : getDynamicDefaultTime().jalali.year);
  const [selectedMonth, setSelectedMonth] = useState(() => language === 'en' ? getDynamicDefaultTime().gregorian.month : getDynamicDefaultTime().jalali.month);
  const [selectedDay, setSelectedDay] = useState(() => language === 'en' ? getDynamicDefaultTime().gregorian.day : getDynamicDefaultTime().jalali.day);
  const [selectedHour, setSelectedHour] = useState(() => language === 'en' ? getDynamicDefaultTime().gregorian.hour : getDynamicDefaultTime().jalali.hour);
  const [selectedMinute, setSelectedMinute] = useState(() => language === 'en' ? getDynamicDefaultTime().gregorian.minute : getDynamicDefaultTime().jalali.minute);

  // Recurrence states (ساعتی، روزانه، هفتگی، ماهیانه، انتخاب از تقویم)
  const [recurrence, setRecurrence] = useState<RecurrenceType>('none');
  const [recurrenceInterval, setRecurrenceInterval] = useState<number>(1);
  const [hourlyIntervalDraft, setHourlyIntervalDraft] = useState<string | null>(null);
  const [recurrenceCount, setRecurrenceCount] = useState<number | undefined>(undefined);
  const [recurrenceDaysOfWeek, setRecurrenceDaysOfWeek] = useState<number[]>([]);
  const [recurrenceCustomDates, setRecurrenceCustomDates] = useState<string[]>([]);
  const recurrenceCountInputRef = useRef<HTMLInputElement>(null);
  const hourlyIntervalInputRef = useRef<HTMLInputElement>(null);

  // Speech to text states & continuous listening refs
  const [isListening, setIsListening] = useState(false);
  const [voiceLang, setVoiceLang] = useState<'fa' | 'en'>(language === 'en' ? 'en' : 'fa');
  const [speechTranscript, setSpeechTranscript] = useState('');
  const recognitionRef = useRef<any>(null);
  const shouldKeepListeningRef = useRef<boolean>(false);
  const lastFinalTranscriptRef = useRef<string>('');
  const processedFinalIndicesRef = useRef<Set<number>>(new Set());
  const titleRef = useRef<string>('');
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const speechStartTimeRef = useRef<number>(0);
  const lastSpeechTimeRef = useRef<number>(0);
  const [voiceErrorMsg, setVoiceErrorMsg] = useState<string | null>(null);

  // Keep voiceLang synced with app language
  useEffect(() => {
    setVoiceLang(language === 'en' ? 'en' : 'fa');
  }, [language, isOpen]);

  // Keep titleRef synchronized with current title state to prevent stale closures
  useEffect(() => {
    titleRef.current = title;
  }, [title]);

  // Camera state
  const [isCameraOpen, setIsCameraOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [showValidationModal, setShowValidationModal] = useState(false);

  // Session tracking to ensure default time is only calculated once upon form opening,
  // and never reset while user is editing
  const initializedSessionRef = useRef<string | null>(null);
  const [pickerSessionKey, setPickerSessionKey] = useState<number>(0);

  // Sync state with initial data or defaults
  useEffect(() => {
    if (!isOpen) {
      initializedSessionRef.current = null;
      stopVoiceListening();
      return;
    }

    const sessionKey = initialData ? `edit_${initialData.id}_${initialData.dueTimestamp}` : 'new_reminder';
    if (initializedSessionRef.current === sessionKey) {
      return; // Already initialized for this open session, do not reset user manual edits!
    }
    initializedSessionRef.current = sessionKey;
    setPickerSessionKey((prev) => prev + 1);

    if (initialData) {
      // Editing existing reminder: preserve its scheduled date & time if it is in the future;
      // if it was already in the past, default to 2 minutes from now so user can easily reschedule
      const reminderTime =
        initialData.dueTimestamp && initialData.dueTimestamp > Date.now()
          ? initialData.dueTimestamp
          : Date.now() + 2 * 60 * 1000;
      if (isEn) {
        const d = new Date(reminderTime);
        setSelectedYear(d.getFullYear());
        setSelectedMonth(d.getMonth() + 1);
        setSelectedDay(d.getDate());
        setSelectedHour(d.getHours());
        setSelectedMinute(d.getMinutes());
      } else {
        const jalali = getJalaliComponents(reminderTime);
        setSelectedYear(jalali.year);
        setSelectedMonth(jalali.month);
        setSelectedDay(jalali.day);
        setSelectedHour(jalali.hour);
        setSelectedMinute(jalali.minute);
      }

      setTitle(initialData.title);
      setDescription(initialData.description || '');
      setCategory(initialData.category);
      setPriority(initialData.priority);
      const lvl = initialData.priorityLevel || (initialData.priority === 'high' ? 5 : initialData.priority === 'medium' ? 3 : 1);
      setPriorityLevel(lvl);
      setImageUrl(initialData.imageUrl);
      setVoiceReadAloud(initialData.voiceReadAloud);
      setRingTune(initialData.ringTune || initialData.category);
      setRecurrence(initialData.recurrence || 'none');
      setRecurrenceInterval(initialData.recurrenceInterval || 1);
      setRecurrenceCount(initialData.recurrenceCount);
      setRecurrenceDaysOfWeek(initialData.recurrenceDaysOfWeek || []);
      setRecurrenceCustomDates(initialData.recurrenceCustomDates || []);

      const hasExtraData = !!(
        initialData.description ||
        initialData.category !== 'work' ||
        initialData.priority !== 'medium' ||
        (initialData.recurrence && initialData.recurrence !== 'none') ||
        initialData.imageUrl
      );
      setShowMoreOptions(hasExtraData);
    } else {
      // Creating new reminder: default date & time is automatically set to current time + 2 minutes on each open
      const defaultTime = Date.now() + 2 * 60 * 1000;
      if (isEn) {
        const d = new Date(defaultTime);
        setSelectedYear(d.getFullYear());
        setSelectedMonth(d.getMonth() + 1);
        setSelectedDay(d.getDate());
        setSelectedHour(d.getHours());
        setSelectedMinute(d.getMinutes());
      } else {
        const nowJalali = getJalaliComponents(defaultTime);
        setSelectedYear(nowJalali.year);
        setSelectedMonth(nowJalali.month);
        setSelectedDay(nowJalali.day);
        setSelectedHour(nowJalali.hour);
        setSelectedMinute(nowJalali.minute);
      }

      setTitle('');
      setDescription('');
      setCategory('work');
      setPriority('medium');
      setPriorityLevel(3);
      setImageUrl(undefined);
      setVoiceReadAloud(true);
      setRingTune('work');
      setRecurrence('none');
      setRecurrenceInterval(1);
      setRecurrenceCount(undefined);
      setRecurrenceDaysOfWeek([]);
      setRecurrenceCustomDates([]);

      setShowMoreOptions(false);
    }

    return () => {
      stopVoiceListening();
    };
  }, [isOpen, initialData]);

  // Virtual keyboard tracking: keeps footer button pinned directly above virtual keyboard
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);

  useEffect(() => {
    if (!isOpen) {
      stopVoiceListening();
    }
    const handleForceStopMic = () => stopVoiceListening();
    window.addEventListener('yaad:stop-all-microphones', handleForceStopMic);
    return () => {
      window.removeEventListener('yaad:stop-all-microphones', handleForceStopMic);
      stopVoiceListening();
    };
  }, [isOpen]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return;
    const handleViewportChange = () => {
      if (window.visualViewport) {
        setViewportHeight(window.visualViewport.height);
      }
    };
    window.visualViewport.addEventListener('resize', handleViewportChange);
    window.visualViewport.addEventListener('scroll', handleViewportChange);
    handleViewportChange();
    return () => {
      window.visualViewport?.removeEventListener('resize', handleViewportChange);
      window.visualViewport?.removeEventListener('scroll', handleViewportChange);
    };
  }, []);

  // Sync ringtune default to category
  const handleCategoryChange = (newCat: Category) => {
    setCategory(newCat);
    setRingTune(newCat);
  };

  // Web Speech recognition setup:
  // روشن شدن، پشتیبانی از صوت فارسی یا انگلیسی، و خاموش شدن خودکار پس از ۵ ثانیه سکوت بدون لوپ یا قطع و وصل شدن
  const stopVoiceListening = () => {
    shouldKeepListeningRef.current = false;
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (recognitionRef.current) {
      safeAbortSpeechRecognition(recognitionRef.current);
      recognitionRef.current = null;
    }
    setIsListening(false);
    setSpeechTranscript('');
    lastFinalTranscriptRef.current = '';
    processedFinalIndicesRef.current.clear();
  };

  const startVoiceListening = async (forcedLang?: 'fa' | 'en') => {
    if (isNativeAndroidApp()) return;
    setVoiceErrorMsg(null);
    setSpeechTranscript('');
    lastFinalTranscriptRef.current = '';
    processedFinalIndicesRef.current.clear();

    const win = window as unknown as IWindow;
    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (!SpeechRec) {
      setVoiceErrorMsg(
        isEn
          ? 'Voice speech recognition not supported in this Android browser/WebView.'
          : 'تبدیل گفتار به متن در این مرورگر در دسترس نیست. لطفاً از کیبورد صوتی گوشی استفاده نمایید.'
      );
      setTimeout(() => setVoiceErrorMsg(null), 5000);
      return;
    }

    // Strip previous listeners and abort prior instance
    if (recognitionRef.current) {
      safeAbortSpeechRecognition(recognitionRef.current);
      recognitionRef.current = null;
    }
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    try {
      const activeLang = forcedLang || voiceLang;
      shouldKeepListeningRef.current = true;
      speechStartTimeRef.current = Date.now();
      lastSpeechTimeRef.current = 0;

      const resetSilenceTimer = (durationMs = 5000) => {
        if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = null;
        }
        silenceTimerRef.current = setTimeout(() => {
          stopVoiceListening();
        }, durationMs);
      };

      resetSilenceTimer(5000);

      const createAndRunRecognition = () => {
        if (!shouldKeepListeningRef.current) return;

        try {
          if (recognitionRef.current) {
            safeAbortSpeechRecognition(recognitionRef.current);
            recognitionRef.current = null;
          }

          const rec = new SpeechRec();
          rec.lang = activeLang === 'en' ? 'en-US' : 'fa-IR';
          rec.continuous = true;
          rec.interimResults = true;
          processedFinalIndicesRef.current.clear();

          rec.onstart = () => {
            setIsListening(true);
          };

          rec.onresult = (event: any) => {
            let interimText = '';

            for (let i = event.resultIndex; i < event.results.length; ++i) {
              const res = event.results[i];
              if (res.isFinal) {
                if (!processedFinalIndicesRef.current.has(i)) {
                  processedFinalIndicesRef.current.add(i);
                  const finalChunk = res[0]?.transcript?.trim();
                  if (finalChunk && finalChunk !== lastFinalTranscriptRef.current) {
                    lastFinalTranscriptRef.current = finalChunk;
                    lastSpeechTimeRef.current = Date.now();

                    const currentTitle = titleRef.current || '';
                    const updatedTitle = appendWithoutDuplicate(currentTitle, finalChunk);

                    if (updatedTitle !== currentTitle) {
                      titleRef.current = updatedTitle;
                      setTitle(updatedTitle);
                    }
                  }
                }
              } else {
                interimText += res[0]?.transcript || '';
              }
            }

            // Interim results are used ONLY for live feedback and never appended directly to title
            const cleanInterim = interimText.trim();
            setSpeechTranscript(cleanInterim);
            if (cleanInterim) {
              lastSpeechTimeRef.current = Date.now();
            }

            resetSilenceTimer(3500);
          };

          rec.onerror = (e: any) => {
            console.warn('Speech recognition error:', e.error);
            if (e.error === 'not-allowed') {
              setVoiceErrorMsg(
                isEn
                  ? 'Microphone access denied.'
                  : 'دسترسی به میکروفون داده نشده است. لطفاً در تنظیمات اندروید دسترسی را تایید کنید.'
              );
              setTimeout(() => setVoiceErrorMsg(null), 5000);
              stopVoiceListening();
              return;
            }
            if (e.error === 'service-not-allowed' || e.error === 'network') {
              setVoiceErrorMsg(
                isEn
                  ? 'Google Speech Service unavailable. Check internet or phone speech engine.'
                  : 'سرویس گفتار گوگل پاسخگو نیست. لطفاً اینترنت یا برنامه گفتار گوگل را بررسی کنید.'
              );
              setTimeout(() => setVoiceErrorMsg(null), 5000);
              stopVoiceListening();
              return;
            }
            stopVoiceListening();
          };

          rec.onend = () => {
            recognitionRef.current = null;
            stopVoiceListening();
          };

          recognitionRef.current = rec;
          rec.start();
        } catch (err) {
          console.warn('Failed to start speech recognition instance:', err);
          stopVoiceListening();
        }
      };

      createAndRunRecognition();
    } catch (err) {
      console.warn('Failed to initialize speech recognition:', err);
      stopVoiceListening();
    }
  };

  const toggleListening = () => {
    if (isNativeAndroidApp()) return;
    if (isListening) {
      stopVoiceListening();
    } else {
      startVoiceListening();
    }
  };

  // Quick Preset Presets
  const applyPreset = (minutesFromNow: number) => {
    const target = Date.now() + minutesFromNow * 60000;
    if (isEn) {
      const d = new Date(target);
      setSelectedYear(d.getFullYear());
      setSelectedMonth(d.getMonth() + 1);
      setSelectedDay(d.getDate());
      setSelectedHour(d.getHours());
      setSelectedMinute(d.getMinutes());
    } else {
      const j = getJalaliComponents(target);
      setSelectedYear(j.year);
      setSelectedMonth(j.month);
      setSelectedDay(j.day);
      setSelectedHour(j.hour);
      setSelectedMinute(j.minute);
    }
    setPickerSessionKey((prev) => prev + 1);
    if (validationError) setValidationError(null);
  };

  const setTomorrowMorning = () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    if (isEn) {
      setSelectedYear(tomorrow.getFullYear());
      setSelectedMonth(tomorrow.getMonth() + 1);
      setSelectedDay(tomorrow.getDate());
    } else {
      const j = getJalaliComponents(tomorrow.getTime());
      setSelectedYear(j.year);
      setSelectedMonth(j.month);
      setSelectedDay(j.day);
    }
    setSelectedHour(9);
    setSelectedMinute(0);
    setPickerSessionKey((prev) => prev + 1);
    if (validationError) setValidationError(null);
  };

  // Convert selected date and time to Unix Timestamp (Gregorian for EN, Jalali for FA)
  const calculateDueTimestamp = (): number => {
    if (isEn) {
      const date = new Date(selectedYear, selectedMonth - 1, selectedDay, selectedHour, selectedMinute, 0, 0);
      return date.getTime();
    }
    const [gy, gm, gd] = jalaliToGregorian(selectedYear, selectedMonth, selectedDay);
    const date = new Date(gy, gm - 1, gd, selectedHour, selectedMinute, 0, 0);
    return date.getTime();
  };

  const candidateDueTimestamp = calculateDueTimestamp();
  const isCandidateInPast = isSelectedDateTimeInPast(candidateDueTimestamp);

  // Handle file upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setImageUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setShowValidationModal(true);
      setTimeout(() => titleInputRef.current?.focus(), 30);
      return;
    }

    const dueTimestamp = calculateDueTimestamp();
    if (isSelectedDateTimeInPast(dueTimestamp)) {
      setValidationError(
        isEn
          ? 'Cannot save a reminder for a past date or time. Please select a future time.'
          : 'امکان ثبت یادآور برای تاریخ و ساعت گذشته وجود ندارد. لطفاً زمانی در آینده انتخاب کنید.'
      );
      return;
    }

    setValidationError(null);

    stopVoiceListening();

    // Request Android notification permission on first reminder need
    requestNotificationPermission().catch(() => {});

    const tzMeta = getCurrentTimezoneMeta(dueTimestamp);
    onSave(
      {
        title: title.trim(),
        description: description.trim() || undefined,
        category,
        priority,
        priorityLevel,
        dueTimestamp,
        scheduledTzOffsetMinutes: tzMeta.tzOffsetMinutes,
        scheduledTimeZone: tzMeta.timeZone,
        wallClockTime: {
          year: selectedYear,
          month: selectedMonth,
          day: selectedDay,
          hour: selectedHour,
          minute: selectedMinute,
          calendar: isEn ? 'gregorian' : 'jalali',
        },
        imageUrl,
        ringTune,
        voiceReadAloud,
        recurrence: recurrence !== 'none' ? recurrence : undefined,
        recurrenceInterval: recurrence === 'hourly' ? recurrenceInterval : undefined,
        recurrenceCount: recurrence !== 'none' && recurrenceCount && recurrenceCount > 0 ? recurrenceCount : undefined,
        recurrenceDaysOfWeek: recurrence === 'weekly' ? recurrenceDaysOfWeek : undefined,
        recurrenceCustomDates: recurrence === 'custom_dates' ? recurrenceCustomDates : undefined,
        geofence: initialData?.geofence,
        sourceApp: !isNativeAndroidApp() && isListening ? 'voice' : 'manual',
      },
      !isNativeAndroidApp() && syncWithGoogle
    );

    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
          className="fixed inset-0 z-50 flex flex-col justify-end sm:justify-center items-center p-0 sm:p-4 bg-black/75 overflow-hidden"
          style={{ height: viewportHeight ? `${viewportHeight}px` : '100dvh', willChange: 'opacity' }}
          dir={isEn ? 'ltr' : 'rtl'}
        >
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.985 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="bg-stone-900 border border-stone-800 rounded-t-3xl sm:rounded-3xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col"
            style={{ maxHeight: viewportHeight ? `${viewportHeight}px` : '92dvh', willChange: 'transform, opacity' }}
          >
          {/* Header */}
          <div className="px-2.5 sm:px-6 py-3.5 border-b border-stone-800 flex items-center justify-between bg-stone-950 sticky top-0 z-10 shrink-0">
            <div className="flex items-center gap-2.5 sm:gap-3">
              <div className="p-1.5 sm:p-2 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                <Plus className="w-4.5 h-4.5 sm:w-5 sm:h-5" />
              </div>
              <h2 className="text-base sm:text-lg font-bold text-white">
                {initialData 
                  ? (isEn ? 'Edit Reminder' : 'ویرایش یادآور') 
                  : (isEn ? 'Add New Reminder' : 'ثبت سریع یادآور')}
              </h2>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 sm:p-2 rounded-full text-stone-400 hover:text-white hover:bg-stone-800 cursor-pointer"
                title={isEn ? 'Close' : 'بستن'}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* Scrollable Form Body */}
            <div className="flex-1 overflow-y-auto px-2.5 py-4 sm:p-6 space-y-4 sm:space-y-6">
              {/* Required Field Validation Alert Banner */}
              {validationError && (
                <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs font-bold flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{validationError}</span>
                </div>
              )}

            {/* Title Input with Integrated Microphone Button — Distinct Primary Field */}
            <div className="p-3.5 sm:p-4 rounded-2xl bg-gradient-to-br from-indigo-950/55 via-stone-900/95 to-stone-950 border-2 border-indigo-500/55 shadow-lg shadow-indigo-500/10 space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-1.5">
                <label className="text-sm sm:text-base font-black text-white tracking-tight flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)] shrink-0" />
                  <span>{isEn ? 'Reminder Title' : 'عنوان یادآور'}</span>
                  <span className="text-amber-400 font-black text-base">*</span>
                </label>
                <div className="flex items-center gap-2">
                  {isListening && (
                    <div className="flex items-center gap-1.5 text-[11px] font-bold text-indigo-400">
                      <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping" />
                      {speechTranscript ? (
                        <span className="text-indigo-300 bg-indigo-500/15 px-2 py-0.5 rounded-md border border-indigo-500/30 font-medium max-w-[180px] sm:max-w-xs truncate">
                          «{speechTranscript}»
                        </span>
                      ) : (
                        <span>{isEn ? 'Waiting for voice (stops in 5s)...' : 'منتظر صوت (خاموشی بعد از ۵ ثانیه)...'}</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="relative flex items-center">
                <input
                  ref={titleInputRef}
                  type="text"
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    if (validationError) setValidationError(null);
                  }}
                  placeholder={isEn ? 'e.g. Project delivery, Doctor appointment, Buy groceries...' : 'مثال: تحویل پروژه، تماس با پزشک، خرید نان...'}
                  className={`w-full bg-stone-950 border-2 rounded-2xl ${
                    isNativeAndroidApp() ? 'px-4' : isEn ? 'pl-4 pr-14' : 'pr-4 pl-14'
                  } py-3.5 text-white placeholder-stone-400 focus:outline-none transition-all text-base sm:text-lg font-extrabold shadow-inner ${
                    isListening
                      ? 'border-amber-400 ring-2 ring-amber-400/30 shadow-lg shadow-amber-500/15'
                      : 'border-indigo-400/70 focus:border-amber-400 ring-2 ring-indigo-500/15 focus:ring-amber-400/25'
                  }`}
                />

                {/* Microphone Button Placed Directly Beside Title Input (Web/PWA only; hidden on Android WebView where Web SpeechRecognition does not work) */}
                {!isNativeAndroidApp() && (
                  <button
                    type="button"
                    onClick={toggleListening}
                    className={`absolute ${isEn ? 'right-2' : 'left-2'} top-1/2 -translate-y-1/2 w-10 h-10 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                      isListening
                        ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/50 scale-105 animate-pulse'
                        : 'bg-indigo-500/20 hover:bg-indigo-500/35 text-indigo-300 hover:text-white border border-indigo-400/40'
                    }`}
                    title={isListening ? (isEn ? 'Stop voice typing' : 'توقف تایپ صوتی') : (isEn ? 'Start voice typing' : 'شروع تایپ صوتی (تبدیل گفتار به متن)')}
                  >
                    <Mic className="w-5 h-5" />
                  </button>
                )}
              </div>

              {!isNativeAndroidApp() && voiceErrorMsg && (
                <div className="mt-2 p-2.5 rounded-xl bg-indigo-500/15 border border-indigo-500/40 text-indigo-300 text-xs flex items-center justify-between gap-2 animate-in fade-in">
                  <div className="flex items-center gap-2 min-w-0">
                    <AlertCircle className="w-4 h-4 shrink-0 text-indigo-400" />
                    <span className="truncate">{voiceErrorMsg}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => openAndroidSettings('microphone')}
                    className="shrink-0 px-2.5 py-1 rounded-lg bg-indigo-500 text-white font-black text-[11px] flex items-center gap-1 shadow-sm active:scale-95 cursor-pointer"
                  >
                    <Smartphone className="w-3 h-3" />
                    <span>{isEn ? 'Android Settings' : 'تنظیمات اندروید'}</span>
                  </button>
                </div>
              )}
            </div>

            {/* Persian Jalali Date & Time Picker */}
            <div className="p-4 rounded-2xl bg-stone-950/60 border border-stone-800 space-y-3">
              {/* Time: Roller Clock placed directly below Reminder Title section, with doubled height */}
              <div className="pb-2 border-b border-stone-800 space-y-2">
                <div 
                  dir="ltr"
                  className="grid grid-cols-2 gap-2 max-w-[210px] mx-auto px-1"
                >
                  {/* Left: Hour Picker */}
                  <WheelPicker
                    key={`hour-${pickerSessionKey}`}
                    selectedValue={selectedHour}
                    onChange={(val) => {
                      setSelectedHour(val);
                      if (validationError) setValidationError(null);
                    }}
                    min={0}
                    max={23}
                    itemHeight={58}
                    visibleCount={3}
                    items={HOUR_WHEEL_ITEMS}
                  />

                  {/* Right: Minute Picker */}
                  <WheelPicker
                    key={`minute-${pickerSessionKey}`}
                    selectedValue={selectedMinute}
                    onChange={(val) => {
                      setSelectedMinute(val);
                      if (validationError) setValidationError(null);
                    }}
                    min={0}
                    max={59}
                    itemHeight={58}
                    visibleCount={3}
                    items={MINUTE_WHEEL_ITEMS}
                  />
                </div>

                {/* Live Past-Time Warning & One-Tap Reset to Future */}
                {isCandidateInPast && (
                  <div className="p-2.5 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-200 text-xs flex items-center justify-between gap-2 animate-in fade-in">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                      <span className="font-bold truncate">
                        {isEn
                          ? 'Selected time is in the past'
                          : 'زمان انتخاب‌شده در گذشته است'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => applyPreset(2)}
                      className="shrink-0 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-black text-[11px] transition-all cursor-pointer active:scale-95"
                    >
                      {isEn ? 'Set to Now +2m' : 'تنظیم به زمان حال'}
                    </button>
                  </div>
                )}
              </div>

              {/* Quick Presets - Exactly 4 buttons */}
              <div className="grid grid-cols-4 gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => applyPreset(5)}
                  className="min-h-[40px] px-2 py-1.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-200 border border-stone-700 font-bold text-xs text-center transition-all cursor-pointer active:scale-95"
                >
                  {isEn ? '+5m' : '+۵ دقیقه'}
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset(15)}
                  className="min-h-[40px] px-2 py-1.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-200 border border-stone-700 font-bold text-xs text-center transition-all cursor-pointer active:scale-95"
                >
                  {isEn ? '+15m' : '+۱۵ دقیقه'}
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset(60)}
                  className="min-h-[40px] px-2 py-1.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-200 border border-stone-700 font-bold text-xs text-center transition-all cursor-pointer active:scale-95"
                >
                  {isEn ? '+1h' : '+۱ ساعت'}
                </button>
                <button
                  type="button"
                  onClick={setTomorrowMorning}
                  className="min-h-[40px] px-2 py-1.5 rounded-xl bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 border border-indigo-500/30 font-bold text-xs text-center transition-all cursor-pointer active:scale-95"
                >
                  {isEn ? 'Tomorrow' : 'فردا ۹ صبح'}
                </button>
              </div>

              {/* Screenshot-Modeled Unified Calendar Picker (Jalali in FA / Gregorian in EN) */}
              <YaadCalendarPicker
                year={selectedYear}
                month={selectedMonth}
                day={selectedDay}
                language={isEn ? 'en' : 'fa'}
                disablePast={true}
                yearMode="future"
                timeLabel={`${selectedHour.toString().padStart(2, '0')}:${selectedMinute.toString().padStart(2, '0')}`}
                onSelectDate={(y, m, d) => {
                  setSelectedYear(y);
                  setSelectedMonth(m);
                  setSelectedDay(d);
                  if (validationError) setValidationError(null);
                }}
              />
            </div>

            {/* Collapsible More Options Section (توضیحات، دسته و اولویت و سایر تنظیمات) */}
            <div className="pt-1">
              <button
                type="button"
                onClick={(e) => {
                  const willOpen = !showMoreOptions;
                  setShowMoreOptions(willOpen);
                  if (willOpen) {
                    scrollAccordionHeaderIntoView(e.currentTarget, 38);
                  }
                }}
                className="w-full min-h-[48px] py-2.5 px-4 rounded-2xl bg-stone-950/70 hover:bg-stone-900 border border-stone-800 hover:border-stone-700 text-stone-300 hover:text-white text-xs sm:text-sm font-bold flex items-center justify-between transition-all cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-indigo-400" />
                  <span>{isEn ? 'More Options' : 'تنظیمات بیشتر'}</span>
                </span>
                <ChevronDown className={`w-4 h-4 text-stone-400 transition-transform duration-200 ${showMoreOptions ? 'rotate-180 text-indigo-400' : ''}`} />
              </button>

              {showMoreOptions && (
                <div className="mt-3 space-y-4 sm:space-y-5 animate-in fade-in duration-200">
                  {/* Description / Notes */}
                  <div>
                    <label className="block text-xs font-semibold text-stone-300 mb-1.5">
                      {isEn ? 'Notes & Details (Optional)' : 'توضیحات و جزئیات (اختیاری)'}
                    </label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder={isEn ? 'Additional details, address, phone number or key notes...' : 'توضیحات تکمیلی، آدرس، شماره یا نکته مهم...'}
                      rows={2}
                      className="w-full bg-stone-950 border border-stone-700 rounded-xl px-4 py-2.5 text-white placeholder-stone-500 focus:outline-none focus:border-indigo-500 transition-colors text-xs resize-none"
                    />
                  </div>

                  {/* Category */}
                  <div>
                    <label className="block text-xs font-semibold text-stone-300 mb-2">
                      {isEn ? 'Reminder Category' : 'تقسیم‌بندی یادآور'}
                    </label>
                    <div className="grid grid-cols-3 gap-2.5">
                      {/* Work */}
                      <button
                        type="button"
                        onClick={() => handleCategoryChange('work')}
                        className={`p-3 rounded-2xl border flex flex-col items-center gap-1.5 transition-all text-center cursor-pointer ${
                          category === 'work'
                            ? 'bg-stone-900 border-indigo-500 text-indigo-300 shadow-sm'
                            : 'bg-stone-950/60 border-stone-800 text-stone-400 hover:border-stone-700'
                        }`}
                      >
                        <Briefcase className={`w-4.5 h-4.5 ${category === 'work' ? 'text-indigo-400' : 'text-stone-400'}`} />
                        <span className="text-xs font-bold">{isEn ? 'Work' : 'کار'}</span>
                      </button>

                      {/* Family */}
                      <button
                        type="button"
                        onClick={() => handleCategoryChange('family')}
                        className={`p-3 rounded-2xl border flex flex-col items-center gap-1.5 transition-all text-center cursor-pointer ${
                          category === 'family'
                            ? 'bg-stone-900 border-indigo-500 text-indigo-300 shadow-sm'
                            : 'bg-stone-950/60 border-stone-800 text-stone-400 hover:border-stone-700'
                        }`}
                      >
                        <Heart className={`w-4.5 h-4.5 ${category === 'family' ? 'text-indigo-400' : 'text-stone-400'}`} />
                        <span className="text-xs font-bold">{isEn ? 'Family' : 'خانواده'}</span>
                      </button>

                      {/* Other */}
                      <button
                        type="button"
                        onClick={() => handleCategoryChange('other')}
                        className={`p-3 rounded-2xl border flex flex-col items-center gap-1.5 transition-all text-center cursor-pointer ${
                          category === 'other'
                            ? 'bg-stone-900 border-indigo-500 text-indigo-300 shadow-sm'
                            : 'bg-stone-950/60 border-stone-800 text-stone-400 hover:border-stone-700'
                        }`}
                      >
                        <Tag className={`w-4.5 h-4.5 ${category === 'other' ? 'text-indigo-400' : 'text-stone-400'}`} />
                        <span className="text-xs font-bold">{isEn ? 'Other' : 'سایر'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Priority Selection (بدون اولویت عددی و بدون اعداد زیر دکمه‌ها) */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-stone-300 flex items-center gap-1.5">
                        <Zap className="w-3.5 h-3.5 text-amber-400" />
                        <span>{isEn ? 'Reminder Priority' : 'اولویت یادآوری'}</span>
                      </label>
                      <span className={`text-[11px] font-black px-2.5 py-0.5 rounded-lg border flex items-center gap-1 ${
                        priorityLevel >= 5
                          ? 'bg-red-500/15 border-red-500/40 text-red-300'
                          : priorityLevel >= 4
                          ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                          : priorityLevel >= 2
                          ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-300'
                          : 'bg-stone-800 border-stone-700 text-stone-300'
                      }`}>
                        <span>
                          {priorityLevel >= 5 ? (isEn ? 'Urgent' : 'فوری') : priorityLevel >= 4 ? (isEn ? 'High' : 'مهم') : priorityLevel >= 2 ? (isEn ? 'Medium' : 'متوسط') : (isEn ? 'Normal' : 'عادی')}
                        </span>
                      </span>
                    </div>

                    {/* Priority Buttons without numbers underneath */}
                    <div className="grid grid-cols-4 gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleSelectPriority(1)}
                        className={`py-2.5 px-1 rounded-xl border text-center transition-all cursor-pointer active:scale-95 flex items-center justify-center ${
                          priorityLevel === 1
                            ? 'bg-stone-800 border-stone-600 text-white font-bold ring-1 ring-stone-500/40 shadow-xs'
                            : 'bg-stone-950/60 border-stone-800 text-stone-400 hover:text-stone-200 hover:bg-stone-900'
                        }`}
                      >
                        <span className="text-xs font-bold">{isEn ? 'Normal' : 'عادی'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleSelectPriority(3)}
                        className={`py-2.5 px-1 rounded-xl border text-center transition-all cursor-pointer active:scale-95 flex items-center justify-center ${
                          priorityLevel === 3
                            ? 'bg-indigo-950/90 border-indigo-500 text-indigo-300 font-bold ring-1 ring-indigo-500/40 shadow-xs'
                            : 'bg-stone-950/60 border-stone-800 text-stone-400 hover:text-stone-200 hover:bg-stone-900'
                        }`}
                      >
                        <span className="text-xs font-bold">{isEn ? 'Medium' : 'متوسط'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleSelectPriority(4)}
                        className={`py-2.5 px-1 rounded-xl border text-center transition-all cursor-pointer active:scale-95 flex items-center justify-center ${
                          priorityLevel === 4
                            ? 'bg-amber-950/90 border-amber-500 text-amber-300 font-bold ring-1 ring-amber-500/40 shadow-xs'
                            : 'bg-stone-950/60 border-stone-800 text-stone-400 hover:text-stone-200 hover:bg-stone-900'
                        }`}
                      >
                        <span className="text-xs font-bold">{isEn ? 'High' : 'مهم'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleSelectPriority(5)}
                        className={`py-2.5 px-1 rounded-xl border text-center transition-all cursor-pointer active:scale-95 flex items-center justify-center ${
                          priorityLevel >= 5
                            ? 'bg-red-950/90 border-red-500 text-red-300 font-bold ring-1 ring-red-500/40 shadow-xs'
                            : 'bg-stone-950/60 border-stone-800 text-stone-400 hover:text-stone-200 hover:bg-stone-900'
                        }`}
                      >
                        <span className="text-xs font-bold">{isEn ? 'Urgent' : 'فوری'}</span>
                      </button>
                    </div>
                  </div>

            {/* Recurrence Selection Section (پیش‌فرض عدم تکرار بدون دکمه + دکمه تعیین تعداد تکرار با باز شدن صفحه کلید اعداد) */}
            <div className="p-2.5 sm:p-5 rounded-2xl bg-stone-950/80 border border-stone-800 space-y-3 sm:space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                    <Repeat className="w-4 h-4" />
                  </div>
                  <span className="text-xs font-semibold text-stone-300">
                    {isEn ? 'Recurrence' : 'تکرار یادآور'}
                  </span>
                </div>

                {recurrence !== 'none' ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs px-2.5 py-1 rounded-lg bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 font-bold flex items-center gap-1">
                      <Repeat className="w-3 h-3" />
                      <span>
                        {isEn 
                          ? (RECURRENCE_OPTIONS.find((o) => o.id === recurrence)?.labelEn || recurrence)
                          : (RECURRENCE_OPTIONS.find((o) => o.id === recurrence)?.label || recurrence)}
                        {recurrenceCount && recurrenceCount > 0
                          ? (isEn ? ` (${recurrenceCount}x)` : ` (${toPersianDigits(recurrenceCount)} بار)`)
                          : ''}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setRecurrence('none');
                        setRecurrenceCount(undefined);
                      }}
                      className="p-1 rounded-lg bg-stone-900 hover:bg-stone-800 text-stone-400 hover:text-white border border-stone-800 cursor-pointer"
                      title={isEn ? 'Clear recurrence' : 'لغو تکرار'}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <span className="text-[11px] text-stone-400 font-medium">
                    {isEn ? 'Default: No recurrence' : 'پیش‌فرض: عدم تکرار'}
                  </span>
                )}
              </div>

              {/* Recurrence Type Selector Pills (without 'none') + Repeat Count Button */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {RECURRENCE_OPTIONS.filter((opt) => opt.id !== 'none').map((opt) => {
                  const isSelected = recurrence === opt.id;
                  if (opt.id === 'hourly') {
                    return (
                      <div
                        key={opt.id}
                        onClick={() => {
                          if (isSelected) {
                            setRecurrence('none');
                          } else {
                            setRecurrence('hourly');
                            hourlyIntervalInputRef.current?.focus();
                          }
                        }}
                        className={`p-2 rounded-xl border transition-all flex items-center justify-between gap-1 cursor-pointer ${
                          isSelected
                            ? 'bg-indigo-500/15 border-indigo-500/80 text-white shadow-md shadow-indigo-500/15 ring-1 ring-indigo-400/50'
                            : 'bg-stone-900/70 border-stone-800 text-stone-300 hover:border-indigo-500/50 hover:bg-stone-900'
                        }`}
                      >
                        <div className="flex items-center gap-1 min-w-0">
                          <span className={`text-xs font-black whitespace-nowrap ${isSelected ? 'text-indigo-400' : 'text-stone-300'}`}>
                            {isEn ? 'Every' : 'هر'}
                          </span>
                          <input
                            ref={hourlyIntervalInputRef}
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9۰-۹]*"
                            dir="ltr"
                            value={isSelected ? (hourlyIntervalDraft ?? String(recurrenceInterval)) : (hourlyIntervalDraft ?? '')}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!isSelected) {
                                setRecurrence('hourly');
                              }
                            }}
                            onFocus={(e) => {
                              if (!isSelected) {
                                setRecurrence('hourly');
                              }
                              setHourlyIntervalDraft(String(recurrenceInterval));
                              setTimeout(() => e.target.select(), 0);
                            }}
                            onChange={(e) => {
                              const normalized = e.target.value
                                .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776))
                                .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632))
                                .replace(/\D/g, '');
                              setHourlyIntervalDraft(normalized);
                              if (!isSelected) {
                                setRecurrence('hourly');
                              }
                              if (normalized) {
                                const parsed = parseInt(normalized, 10);
                                if (!isNaN(parsed) && parsed >= 1) {
                                  setRecurrenceInterval(Math.min(720, parsed));
                                }
                              }
                            }}
                            onBlur={() => {
                              const parsed = hourlyIntervalDraft ? parseInt(hourlyIntervalDraft, 10) : NaN;
                              const finalVal = !isNaN(parsed) && parsed >= 1 ? Math.min(720, parsed) : (recurrenceInterval || 1);
                              setRecurrenceInterval(finalVal);
                              setHourlyIntervalDraft(null);
                            }}
                            placeholder="X"
                            aria-label={isEn ? 'Hours interval' : 'تعداد ساعت'}
                            className="w-10 sm:w-11 bg-stone-950/90 border border-stone-700 focus:border-indigo-400 rounded-lg px-1 py-1 text-center text-xs font-mono font-black text-white placeholder-stone-500 focus:outline-none"
                          />
                          <span className={`text-xs font-black whitespace-nowrap ${isSelected ? 'text-indigo-400' : 'text-stone-300'}`}>
                            {isEn ? 'hrs' : 'ساعت'}
                          </span>
                        </div>
                        {isSelected && <Check className="w-3.5 h-3.5 text-indigo-400 shrink-0" />}
                      </div>
                    );
                  }
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        if (isSelected) {
                          setRecurrence('none');
                        } else {
                          setRecurrence(opt.id);
                          if (opt.id === 'weekly' && recurrenceDaysOfWeek.length === 0) {
                            setRecurrenceDaysOfWeek([0]);
                          }
                        }
                      }}
                      className={`p-2.5 rounded-xl border text-start transition-all flex items-center justify-between cursor-pointer active:scale-95 ${
                        isSelected
                          ? 'bg-indigo-500/15 border-indigo-500/80 text-white shadow-md shadow-indigo-500/15 ring-1 ring-indigo-400/50'
                          : 'bg-stone-900/70 border-stone-800 text-stone-400 hover:text-stone-200 hover:bg-stone-900'
                      }`}
                    >
                      <span className={`text-xs font-black ${isSelected ? 'text-indigo-400' : 'text-stone-300'}`}>
                        {isEn ? opt.labelEn : opt.label}
                      </span>
                      {isSelected && <Check className="w-3.5 h-3.5 text-indigo-400" />}
                    </button>
                  );
                })}

                {/* Button for Setting Repeat Count (باز کردن صفحه کلید اعداد با کلیک) */}
                <div
                  onClick={() => {
                    if (recurrence === 'none') {
                      setRecurrence('daily');
                    }
                    recurrenceCountInputRef.current?.focus();
                  }}
                  className={`p-2 rounded-xl border transition-all flex items-center justify-between gap-1.5 cursor-pointer ${
                    recurrenceCount && recurrenceCount > 0
                      ? 'bg-indigo-500/15 border-indigo-500/80 text-white shadow-md shadow-indigo-500/15 ring-1 ring-indigo-400/50'
                      : 'bg-stone-900/70 border-stone-800 text-stone-300 hover:border-indigo-500/50 hover:bg-stone-900'
                  }`}
                >
                  <span className={`text-xs font-black whitespace-nowrap ${recurrenceCount && recurrenceCount > 0 ? 'text-indigo-400' : 'text-stone-300'}`}>
                    {isEn ? 'Repeat Count' : 'تعداد تکرار'}
                  </span>
                  <input
                    ref={recurrenceCountInputRef}
                    type="number"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    min={1}
                    max={999}
                    value={recurrenceCount ?? ''}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (recurrence === 'none') {
                        setRecurrence('daily');
                      }
                    }}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (!isNaN(val) && val > 0) {
                        setRecurrenceCount(val);
                        if (recurrence === 'none') {
                          setRecurrence('daily');
                        }
                      } else {
                        setRecurrenceCount(undefined);
                      }
                    }}
                    placeholder={isEn ? '∞' : 'عدد'}
                    className="w-13 bg-stone-950/90 border border-stone-700 focus:border-indigo-400 rounded-lg px-1.5 py-1 text-center text-xs font-mono font-black text-white placeholder-stone-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Sub-panels for each recurrence type */}
              {/* DAILY SUB-PANEL */}
              {recurrence === 'daily' && (
                <div className="p-2.5 rounded-xl bg-stone-900/80 border border-indigo-500/20 text-xs text-stone-300 animate-in fade-in">
                  <p className="font-bold text-indigo-300">
                    {isEn 
                      ? `Repeats every day at ${selectedHour.toString().padStart(2, '0')}:${selectedMinute.toString().padStart(2, '0')}`
                      : `تکرار هر روز ساعت ${selectedHour.toString().padStart(2, '0')}:${selectedMinute.toString().padStart(2, '0')}`}
                  </p>
                </div>
              )}

              {/* 3. WEEKLY SUB-PANEL */}
              {recurrence === 'weekly' && (
                <div className="p-3.5 rounded-xl bg-stone-900/80 border border-stone-800 space-y-3 animate-in fade-in">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-stone-300 font-bold">
                      {isEn ? 'Select Days of Week:' : 'انتخاب روزهای تکرار در هفته:'}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setRecurrenceDaysOfWeek([0, 1, 2, 3, 4, 5, 6])}
                        className="text-[10px] text-stone-400 hover:text-indigo-400 underline px-1"
                      >
                        {isEn ? 'All Days' : 'همه روزها'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setRecurrenceDaysOfWeek([0, 1, 2, 3, 4])}
                        className="text-[10px] text-stone-400 hover:text-indigo-400 underline px-1"
                      >
                        {isEn ? 'Work Days' : 'روزهای کاری'}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-7 gap-1 sm:gap-2">
                    {(isEn ? ENGLISH_WEEK_DAYS : PERSIAN_WEEK_DAYS).map((w) => {
                      const isSel = recurrenceDaysOfWeek.includes(w.index);
                      return (
                        <button
                          key={w.index}
                          type="button"
                          onClick={() => {
                            if (isSel) {
                              setRecurrenceDaysOfWeek(recurrenceDaysOfWeek.filter((d) => d !== w.index));
                            } else {
                              setRecurrenceDaysOfWeek([...recurrenceDaysOfWeek, w.index].sort());
                            }
                          }}
                          className={`py-2 rounded-xl text-center flex flex-col items-center justify-center transition-all cursor-pointer active:scale-95 ${
                            isSel
                              ? 'bg-indigo-500 text-white font-black shadow-md shadow-indigo-500/20'
                              : 'bg-stone-950 text-stone-400 hover:text-stone-200 border border-stone-800'
                          }`}
                        >
                          <span className="text-xs sm:text-sm font-bold">{w.short}</span>
                          <span className="text-[9px] mt-0.5 opacity-80 hidden xs:inline">{w.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 4. MONTHLY SUB-PANEL */}
              {recurrence === 'monthly' && (
                <div className="p-2.5 rounded-xl bg-stone-900/80 border border-indigo-500/20 text-xs text-stone-300 animate-in fade-in">
                  <p className="font-bold text-indigo-300">
                    {isEn 
                      ? `Repeats monthly on day ${selectedDay} at ${selectedHour.toString().padStart(2, '0')}:${selectedMinute.toString().padStart(2, '0')}`
                      : `تکرار هر ماه در روز ${selectedDay} ساعت ${selectedHour.toString().padStart(2, '0')}:${selectedMinute.toString().padStart(2, '0')}`}
                  </p>
                </div>
              )}

              {/* 5. CUSTOM DATES FROM CALENDAR SUB-PANEL */}
              {recurrence === 'custom_dates' && (
                <div className="space-y-2 animate-in fade-in">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-stone-200 font-bold">
                      {isEn ? 'Selected calendar dates:' : 'انتخاب روزهای مشخص از تقویم شمسی:'}
                    </span>
                    <span className="text-indigo-400 font-bold text-[11px]">
                      {recurrenceCustomDates.length > 0
                        ? (isEn ? `${recurrenceCustomDates.length} days selected` : `${toPersianDigits(recurrenceCustomDates.length)} روز انتخاب شد`)
                        : (isEn ? 'Click dates on calendar' : 'روی روزهای تقویم کلیک کنید')}
                    </span>
                  </div>

                  <JalaliMultiDatePicker
                    selectedDates={recurrenceCustomDates}
                    onChange={setRecurrenceCustomDates}
                    baseYear={selectedYear}
                    baseMonth={selectedMonth}
                    language={language}
                  />
                </div>
              )}
            </div>

            {/* Photo Capture & Upload */}
            <div>
              <label className="block text-xs font-semibold text-stone-300 mb-2">
                {isEn ? 'Photo Attachment & Upload' : 'عکسبرداری و آپلود تصویر'}
              </label>
              
              {imageUrl ? (
                <div className="relative rounded-2xl overflow-hidden border border-stone-700 group max-w-sm">
                  <img src={imageUrl} alt="پیوست یادآور" className="w-full h-36 object-cover" />
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                    <button
                      type="button"
                      onClick={() => setImageUrl(undefined)}
                      className="p-2 rounded-full bg-red-600 text-white hover:bg-red-500"
                      title={isEn ? 'Remove photo' : 'حذف عکس'}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (!hasProAccess) {
                        onRequirePro?.('photo');
                        return;
                      }
                      setIsCameraOpen(true);
                    }}
                    className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-stone-950 border border-stone-800 hover:border-indigo-500/50 text-stone-300 text-xs font-medium transition-colors cursor-pointer"
                  >
                    <Camera className="w-4 h-4 text-indigo-400" />
                    <span>{isEn ? 'Take Photo' : 'گرفتن عکس با دوربین'}</span>
                    <ProBadge locked={!hasProAccess} />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (!hasProAccess) {
                        onRequirePro?.('photo');
                        return;
                      }
                      fileInputRef.current?.click();
                    }}
                    className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-stone-950 border border-stone-800 hover:border-indigo-500/50 text-stone-300 text-xs font-medium transition-colors cursor-pointer"
                  >
                    <Upload className="w-4 h-4 text-cyan-400" />
                    <span>{isEn ? 'Upload File' : 'آپلود فایل عکس'}</span>
                    <ProBadge locked={!hasProAccess} />
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </div>
              )}
            </div>

            {/* Google Sync Option (Web/PWA only) */}
            {!isNativeAndroidApp() && googleToken && (
              <div className="pt-2 border-t border-stone-800">
                <label className="flex items-center justify-between p-3 rounded-xl bg-stone-950/60 border border-stone-800/80 cursor-pointer hover:border-sky-500/50">
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 rounded-lg bg-sky-500/10 text-sky-400">
                      <Calendar className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-white">
                      {isEn ? 'Sync with Google Calendar' : 'همگام‌سازی با Google Calendar'}
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={syncWithGoogle}
                    onChange={(e) => setSyncWithGoogle(e.target.checked)}
                    className="w-4 h-4 accent-indigo-500 rounded cursor-pointer"
                  />
                </label>
              </div>
            )}

                </div>
              )}
            </div>
            </div>

            {/* Sticky Submit Footer - Always positioned right above virtual keyboard with min 48px buttons */}
            <div className="sticky bottom-0 z-30 shrink-0 bg-stone-900 border-t border-stone-800 p-3 sm:p-4 flex items-center justify-end gap-3 shadow-2xl">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[48px] px-5 py-2.5 rounded-xl bg-stone-800 hover:bg-stone-700 active:scale-95 text-stone-300 hover:text-white text-xs sm:text-sm font-semibold transition-colors cursor-pointer flex items-center justify-center border border-stone-700/60"
              >
                {isEn ? 'Cancel' : 'انصراف'}
              </button>
              <button
                type="submit"
                className="btn-brand-submit min-h-[48px] px-6 py-2.5 rounded-xl text-xs sm:text-sm font-black transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95 bg-[#FF8C00] hover:bg-[#FF9E1F] text-white shadow-lg shadow-[#FF8C00]/25"
              >
                <Check className="w-4 h-4 stroke-[3] text-white" />
                <span className="text-white font-black">
                  {initialData ? (isEn ? 'Save Changes' : 'ذخیره تغییرات') : (isEn ? 'Save Reminder' : 'ثبت نهایی یادآور')}
                </span>
              </button>
            </div>
          </form>
          </motion.div>

          {/* Pop-up alert for missing required fields per user request */}
          <ValidationAlertModal
            isOpen={showValidationModal}
            onClose={() => {
              setShowValidationModal(false);
              setTimeout(() => titleInputRef.current?.focus(), 50);
            }}
            title={isEn ? "Required Field Missing" : "تکمیل فیلد اجباری"}
            fieldName={isEn ? "Reminder Title" : "عنوان یادآور"}
            language={language}
          />

          {/* Camera Capture Modal */}
          <CameraCaptureModal
            isOpen={isCameraOpen}
            onClose={() => setIsCameraOpen(false)}
            onCapture={(img) => setImageUrl(img)}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
};


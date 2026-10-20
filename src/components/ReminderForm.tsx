import React, { useState, useEffect, useRef } from 'react';
import { Category, Priority, Reminder, RecurrenceType, SavedLocation, LocationGeofenceConfig, GeofenceTriggerType } from '../types';
import { 
  getJalaliComponents, 
  PERSIAN_MONTHS, 
  toPersianDigits, 
  jalaliToGregorian,
  GREGORIAN_MONTHS,
  getDaysInGregorianMonth,
  getDaysInJalaliMonth
} from '../utils/jalali';
import { 
  RECURRENCE_OPTIONS, 
  PERSIAN_WEEK_DAYS, 
  ENGLISH_WEEK_DAYS,
  HOURLY_INTERVALS 
} from '../utils/recurrence';
import { JalaliMultiDatePicker } from './JalaliMultiDatePicker';
import { parseSmsOrText } from '../utils/smsParser';
import { CameraCaptureModal } from './CameraCaptureModal';
import { requestMicrophonePermission, requestLocationPermission, openAndroidSettings } from '../utils/nativePermissions';
import { requestNotificationPermission } from '../utils/nativeLocalNotifications';
import { appendWithoutDuplicate, safeAbortSpeechRecognition } from '../utils/speechDeduplication';
import { 
  Mic, 
  MicOff, 
  Calendar, 
  Clock, 
  Briefcase, 
  Heart, 
  Tag, 
  Camera, 
  Upload, 
  Sparkles, 
  MessageSquare, 
  Volume2, 
  Zap, 
  X, 
  Plus,
  Trash2,
  Check,
  Cloud,
  Repeat,
  ShieldCheck,
  FileText,
  AlertCircle,
  Smartphone,
  MapPin,
  Navigation,
  Crosshair,
  Radio,
  Compass,
  ChevronDown,
  Sliders
} from 'lucide-react';
import { WheelPicker } from './WheelPicker';
import { AppLanguage, getT, formatSavedLocationTitle } from '../utils/i18n';
import { ValidationAlertModal } from './ValidationAlertModal';
import { scrollAccordionHeaderIntoView } from '../utils/accordionScroll';

interface ReminderFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (reminder: Omit<Reminder, 'id' | 'createdAt' | 'status' | 'postponeCount'>, syncGoogle?: boolean) => void;
  initialData?: Reminder | null;
  googleToken?: string | null;
  savedLocations?: SavedLocation[];
  language?: AppLanguage;
  defaultEnableGeofence?: boolean;
}


// Browser Web Speech recognition interface
interface IWindow extends Window {
  webkitSpeechRecognition?: any;
  SpeechRecognition?: any;
}

const JALALI_YEARS_GRID = Array.from({ length: 1425 - 1404 + 1 }, (_, i) => 1404 + i);
const GREGORIAN_YEARS_GRID = Array.from({ length: 2046 - 2025 + 1 }, (_, i) => 2025 + i);

export const ReminderForm: React.FC<ReminderFormProps> = ({
  isOpen,
  onClose,
  onSave,
  initialData,
  googleToken,
  savedLocations = [],
  language = 'fa',
  defaultEnableGeofence = false,
}) => {
  const t = getT(language);
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

  // Geofence / Location Checkpoint states (چک‌پوینت هشدار مکان‌محور)
  const [enableGeofence, setEnableGeofence] = useState(false);
  const [geofenceLocationName, setGeofenceLocationName] = useState('');
  const [geofenceLat, setGeofenceLat] = useState<number>(35.6892);
  const [geofenceLng, setGeofenceLng] = useState<number>(51.3890);
  const [geofenceRadius, setGeofenceRadius] = useState<number>(200);
  const [geofenceTriggerOn, setGeofenceTriggerOn] = useState<GeofenceTriggerType>('enter');
  const [geofenceSavedLocId, setGeofenceSavedLocId] = useState<string>('');
  const [isDetectingGps, setIsDetectingGps] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);

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

  // Date Grid/Table Tab state ('day' | 'month' | 'year' | null) - closed by default until clicked
  const [dateActiveTab, setDateActiveTab] = useState<'day' | 'month' | 'year' | null>(null);
  const [customYearInput, setCustomYearInput] = useState<string>('');

  // Recurrence states (ساعتی، روزانه، هفتگی، ماهیانه، انتخاب از تقویم)
  const [recurrence, setRecurrence] = useState<RecurrenceType>('none');
  const [recurrenceInterval, setRecurrenceInterval] = useState<number>(1);
  const [recurrenceCount, setRecurrenceCount] = useState<number | undefined>(undefined);
  const [recurrenceDaysOfWeek, setRecurrenceDaysOfWeek] = useState<number[]>([]);
  const [recurrenceCustomDates, setRecurrenceCustomDates] = useState<string[]>([]);
  const recurrenceCountInputRef = useRef<HTMLInputElement>(null);

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

  // Camera & SMS states
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isSmsImportOpen, setIsSmsImportOpen] = useState(false);
  const [smsRawText, setSmsRawText] = useState('');
  const [smsPermissionStatus, setSmsPermissionStatus] = useState<'idle' | 'listening' | 'granted' | 'denied'>('idle');
  const [smsStatusMsg, setSmsStatusMsg] = useState<string>('');
  const smsAbortControllerRef = useRef<AbortController | null>(null);
  const smsFileInputRef = useRef<HTMLInputElement>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [showValidationModal, setShowValidationModal] = useState(false);

  // Session tracking to ensure default time is only calculated once upon form opening,
  // and never reset while user is editing
  const initializedSessionRef = useRef<string | null>(null);

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

    if (initialData) {
      // Editing existing reminder: preserve the previously saved date and time exactly
      const reminderTime = initialData.dueTimestamp;
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
      setDateActiveTab(null);
      setCustomYearInput(initialData.dueTimestamp && getJalaliComponents(initialData.dueTimestamp).year > 1425 ? String(getJalaliComponents(initialData.dueTimestamp).year) : '');

      if (initialData.geofence) {
        setEnableGeofence(initialData.geofence.enabled !== false);
        setGeofenceLocationName(initialData.geofence.locationName || '');
        setGeofenceLat(initialData.geofence.latitude);
        setGeofenceLng(initialData.geofence.longitude);
        setGeofenceRadius(initialData.geofence.radius || 200);
        setGeofenceTriggerOn(initialData.geofence.triggerOn || 'enter');
        setGeofenceSavedLocId(initialData.geofence.savedLocationId || '');
      } else {
        setEnableGeofence(defaultEnableGeofence);
        setGeofenceLocationName('');
        setGeofenceSavedLocId('');
        setGeofenceRadius(200);
        setGeofenceTriggerOn('enter');
      }

      const hasExtraData = !!(
        initialData.description ||
        initialData.category !== 'work' ||
        initialData.priority !== 'medium' ||
        (initialData.recurrence && initialData.recurrence !== 'none') ||
        initialData.imageUrl ||
        initialData.geofence?.enabled
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

      setDateActiveTab(null);
      setCustomYearInput('');
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

      setEnableGeofence(defaultEnableGeofence);
      setGeofenceLocationName('');
      setGeofenceSavedLocId('');
      setGeofenceRadius(200);
      setGeofenceTriggerOn('enter');
      setShowMoreOptions(false);
    }

    return () => {
      stopVoiceListening();
    };
  }, [isOpen, initialData, defaultEnableGeofence]);

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
      setIsListening(true);

      const resetSilenceTimer = (durationMs = 5000) => {
        if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = null;
        }
        silenceTimerRef.current = setTimeout(() => {
          stopVoiceListening();
        }, durationMs);
      };

      // Start initial 5-second silence timer: if no voice arrives within 5 seconds, turn off
      resetSilenceTimer(5000);

      const createAndRunRecognition = () => {
        if (!shouldKeepListeningRef.current) return;

        // Check if 5 seconds have passed without voice
        const now = Date.now();
        const refTime = lastSpeechTimeRef.current || speechStartTimeRef.current;
        if (now - refTime >= 4900) {
          stopVoiceListening();
          return;
        }

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

                      const parsed = parseSmsOrText(updatedTitle);
                      if (parsed.suggestedTimestamp) {
                        const j = getJalaliComponents(parsed.suggestedTimestamp);
                        setSelectedHour(j.hour);
                        setSelectedMinute(j.minute);
                        setSelectedDay(j.day);
                        setSelectedMonth(j.month);
                        setSelectedYear(j.year);
                      }
                      if (parsed.category) {
                        setCategory(parsed.category);
                        setRingTune(parsed.category);
                      }
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

            resetSilenceTimer(5000);
          };

          rec.onerror = (e: any) => {
            console.warn('Speech recognition error:', e.error);
            if (e.error === 'no-speech') {
              const now = Date.now();
              const refTime = lastSpeechTimeRef.current || speechStartTimeRef.current;
              if (now - refTime >= 4800) {
                stopVoiceListening();
              }
              return;
            }
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
            if (!shouldKeepListeningRef.current) {
              setIsListening(false);
              setSpeechTranscript('');
              return;
            }

            const now = Date.now();
            const refTime = lastSpeechTimeRef.current || speechStartTimeRef.current;
            if (now - refTime >= 4800) {
              stopVoiceListening();
              return;
            }

            // Safe pause before reconnecting to let the OS mic pipeline clear
            setTimeout(() => {
              if (shouldKeepListeningRef.current) {
                createAndRunRecognition();
              }
            }, 150);
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
  };

  const setTonight = () => {
    const now = new Date();
    now.setHours(20, 0, 0, 0);
    if (now.getTime() <= Date.now()) {
      now.setDate(now.getDate() + 1);
    }
    if (isEn) {
      setSelectedYear(now.getFullYear());
      setSelectedMonth(now.getMonth() + 1);
      setSelectedDay(now.getDate());
    } else {
      const j = getJalaliComponents(now.getTime());
      setSelectedYear(j.year);
      setSelectedMonth(j.month);
      setSelectedDay(j.day);
    }
    setSelectedHour(20);
    setSelectedMinute(0);
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

  // Handle SMS / External Text Import
  const handleSmsImport = () => {
    if (!smsRawText.trim()) return;
    const parsed = parseSmsOrText(smsRawText);
    setTitle(parsed.title);
    if (parsed.description) {
      setDescription(parsed.description);
    }
    setCategory(parsed.category);
    setRingTune(parsed.category);
    setPriority(parsed.priority);
    setPriorityLevel(parsed.priority === 'high' ? 5 : parsed.priority === 'medium' ? 3 : 1);

    if (parsed.suggestedTimestamp) {
      const j = getJalaliComponents(parsed.suggestedTimestamp);
      setSelectedYear(j.year);
      setSelectedMonth(j.month);
      setSelectedDay(j.day);
      setSelectedHour(j.hour);
      setSelectedMinute(j.minute);
    }

    if (smsAbortControllerRef.current) {
      smsAbortControllerRef.current.abort();
    }
    setIsSmsImportOpen(false);
    setSmsRawText('');
    setSmsPermissionStatus('idle');
    setSmsStatusMsg('');
  };

  // Direct Native SMS Permission & WebOTP Receiver
  const requestDirectSmsPermission = async () => {
    // 1. Check if WebOTP API is available in browser (Chrome Android / PWA)
    if ('credentials' in navigator && (window as any).OTPCredential) {
      try {
        if (smsAbortControllerRef.current) {
          smsAbortControllerRef.current.abort();
        }
        const ac = new AbortController();
        smsAbortControllerRef.current = ac;
        setSmsPermissionStatus('listening');
        setSmsStatusMsg('در حال اتصال و دریافت خودکار پیامک از سیستم...');

        const content: any = await (navigator.credentials as any).get({
          otp: { transport: ['sms'] },
          signal: ac.signal,
        });

        if (content && (content.code || content.message)) {
          const raw = content.message || content.code || '';
          setSmsRawText(raw);
          setSmsPermissionStatus('granted');
          setSmsStatusMsg('پیامک با موفقیت از سیستم دریافت و مشخصات استخراج شد!');
        }
      } catch (err: any) {
        if (err.name === 'AbortError') return;
        console.warn('WebOTP direct SMS error:', err);
        setSmsPermissionStatus('idle');
        setSmsStatusMsg('دریافت مستقیم پیامک انجام نشد. از گزینه کلیپ‌بورد یا فایل استفاده فرمایید.');
      }
    } else {
      // 2. Clipboard SMS reading with permission query
      try {
        setSmsStatusMsg('در حال خواندن مستقیم متن پیامک از کلیپ‌بورد...');
        const text = await navigator.clipboard.readText();
        if (text && text.trim()) {
          setSmsRawText(text);
          setSmsPermissionStatus('granted');
          setSmsStatusMsg('متن پیامک با موفقیت از سیستم خوانده شد.');
        } else {
          setSmsStatusMsg('کلیپ‌بورد خالی است. متن پیامک را کپی کنید.');
        }
      } catch (err) {
        setSmsPermissionStatus('denied');
        setSmsStatusMsg('دسترسی به کلیپ‌بورد محدود است. متن را در کادر زیر وارد کنید.');
      }
    }
  };

  const readFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setSmsRawText(text);
        setSmsPermissionStatus('granted');
        setSmsStatusMsg('متن پیامک با موفقیت از کلیپ‌بورد خوانده شد.');
      }
    } catch {
      setSmsStatusMsg('دسترسی به کلیپ‌بورد توسط مرورگر محدود شده است.');
    }
  };

  const handleSmsFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text) {
        setSmsRawText(text);
        setSmsPermissionStatus('granted');
        setSmsStatusMsg('فایل پیامک با موفقیت خوانده شد.');
      }
    };
    reader.readAsText(file);
  };

  const handleGetQuickGps = async () => {
    setGpsError(null);
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGpsError(isEn ? 'Geolocation is not supported.' : 'موقعیت مکانی در این دستگاه پشتیبانی نمی‌شود.');
      return;
    }
    const hasPerm = await requestLocationPermission();
    if (!hasPerm) {
      setGpsError(isEn ? 'Location permission denied. Enable in Android Settings.' : 'دسترسی مکان داده نشد. لطفاً در تنظیمات اندروید فعال کنید.');
      return;
    }
    setIsDetectingGps(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeofenceLat(parseFloat(pos.coords.latitude.toFixed(6)));
        setGeofenceLng(parseFloat(pos.coords.longitude.toFixed(6)));
        if (!geofenceLocationName) {
          setGeofenceLocationName(isEn ? 'Current GPS Location' : 'موقعیت فعلی من');
        }
        setIsDetectingGps(false);
      },
      (err) => {
        setIsDetectingGps(false);
        setGpsError(
          isEn 
            ? 'GPS request failed or disabled in Android.' 
            : 'خطا در دریافت موقعیت. لطفاً GPS دستگاه را روشن فرمایید.'
        );
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleSelectSavedLocation = (locId: string) => {
    setGeofenceSavedLocId(locId);
    const found = savedLocations?.find((l) => l.id === locId);
    if (found) {
      setGeofenceLocationName(formatSavedLocationTitle(found.title, language));
      setGeofenceLat(found.latitude);
      setGeofenceLng(found.longitude);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setShowValidationModal(true);
      setTimeout(() => titleInputRef.current?.focus(), 30);
      return;
    }
    setValidationError(null);

    stopVoiceListening();

    // Request Android notification permission on first reminder need
    requestNotificationPermission().catch(() => {});

    const dueTimestamp = calculateDueTimestamp();
    onSave(
      {
        title: title.trim(),
        description: description.trim() || undefined,
        category,
        priority,
        priorityLevel,
        dueTimestamp,
        imageUrl,
        ringTune,
        voiceReadAloud,
        recurrence: recurrence !== 'none' ? recurrence : undefined,
        recurrenceInterval: recurrence === 'hourly' ? recurrenceInterval : undefined,
        recurrenceCount: recurrence !== 'none' && recurrenceCount && recurrenceCount > 0 ? recurrenceCount : undefined,
        recurrenceDaysOfWeek: recurrence === 'weekly' ? recurrenceDaysOfWeek : undefined,
        recurrenceCustomDates: recurrence === 'custom_dates' ? recurrenceCustomDates : undefined,
        geofence: enableGeofence
          ? {
              enabled: true,
              locationName: geofenceLocationName.trim() || title.trim() || (isEn ? 'Geofence Place' : 'حصار مکانی'),
              latitude: Number(geofenceLat),
              longitude: Number(geofenceLng),
              radius: Number(geofenceRadius) || 200,
              triggerOn: geofenceTriggerOn,
              savedLocationId: geofenceSavedLocId || undefined,
            }
          : (initialData?.geofence ? { ...initialData.geofence, enabled: false } : undefined),
        sourceApp: isListening ? 'voice' : 'manual',
      },
      syncWithGoogle
    );

    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      <div 
        className="fixed inset-0 z-50 flex flex-col justify-end sm:justify-center items-center p-0 sm:p-4 bg-black/80 backdrop-blur-sm overflow-hidden"
        style={{ height: viewportHeight ? `${viewportHeight}px` : '100dvh' }}
        dir={isEn ? 'ltr' : 'rtl'}
      >
        <div 
          className="bg-stone-900 border border-stone-800 rounded-t-3xl sm:rounded-3xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col transition-all duration-150"
          style={{ maxHeight: viewportHeight ? `${viewportHeight}px` : '92dvh' }}
        >
          {/* Header */}
          <div className="px-2.5 sm:px-6 py-3.5 border-b border-stone-800 flex items-center justify-between bg-stone-950/60 sticky top-0 z-10 backdrop-blur shrink-0">
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
                onClick={() => setIsSmsImportOpen(true)}
                className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs rounded-xl bg-cyan-950/60 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-900/50 transition-colors cursor-pointer"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>{isEn ? 'Import from SMS' : 'ورود از پیامک'}</span>
              </button>

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

            {/* Title Input with Integrated Microphone Button */}
            <div>
              <div className="flex items-center justify-between mb-1.5 flex-wrap gap-1">
                <label className="text-xs font-bold text-stone-200 flex items-center gap-1">
                  <span>{isEn ? 'Reminder Title' : 'عنوان یادآور'}</span>
                  <span className="text-indigo-400 font-black">*</span>
                </label>
                <div className="flex items-center gap-2">
                  {/* Language switch button for voice typing */}
                  <button
                    type="button"
                    onClick={() => {
                      const next = voiceLang === 'fa' ? 'en' : 'fa';
                      setVoiceLang(next);
                      if (isListening) {
                        stopVoiceListening();
                        setTimeout(() => startVoiceListening(next), 100);
                      }
                    }}
                    className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border transition-all cursor-pointer ${
                      voiceLang === 'fa'
                        ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30 hover:bg-indigo-500/25'
                        : 'bg-sky-500/15 text-sky-300 border-sky-500/30 hover:bg-sky-500/25'
                    }`}
                    title={isEn ? 'Toggle voice typing language (FA / EN)' : 'تغییر زبان گفتار بین فارسی و انگلیسی'}
                  >
                    {voiceLang === 'fa' ? 'زبان صوت: فارسی' : 'Voice: English'}
                  </button>

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
                  className={`w-full bg-stone-950 border rounded-2xl ${isEn ? 'pl-4 pr-14' : 'pr-4 pl-14'} py-3.5 text-white placeholder-stone-500 focus:outline-none transition-all text-sm sm:text-base font-medium ${
                    isListening
                      ? 'border-indigo-400 ring-2 ring-indigo-400/20 shadow-lg shadow-indigo-500/10'
                      : 'border-stone-700 focus:border-indigo-500'
                  }`}
                />

                {/* Microphone Button Placed Directly Beside Title Input */}
                <button
                  type="button"
                  onClick={toggleListening}
                  className={`absolute ${isEn ? 'right-2' : 'left-2'} top-1/2 -translate-y-1/2 w-10 h-10 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                    isListening
                      ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/50 scale-105 animate-pulse'
                      : 'bg-stone-800/80 hover:bg-stone-700 text-stone-300 hover:text-indigo-400 border border-stone-700'
                  }`}
                  title={isListening ? (isEn ? 'Stop voice typing' : 'توقف تایپ صوتی') : (isEn ? 'Start voice typing' : 'شروع تایپ صوتی (تبدیل گفتار به متن)')}
                >
                  <Mic className="w-5 h-5" />
                </button>
              </div>

              {voiceErrorMsg && (
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
              <div className="pb-2 border-b border-stone-800">
                <div 
                  dir="ltr"
                  className="grid grid-cols-2 gap-2 max-w-[210px] mx-auto px-1"
                >
                  {/* Left: Hour Picker */}
                  <WheelPicker
                    selectedValue={selectedHour}
                    onChange={(val) => setSelectedHour(val)}
                    min={0}
                    max={23}
                    itemHeight={58}
                    visibleCount={3}
                    items={Array.from({ length: 24 }, (_, i) => ({
                      value: i,
                      label: i.toString().padStart(2, '0'),
                    }))}
                  />

                  {/* Right: Minute Picker */}
                  <WheelPicker
                    selectedValue={selectedMinute}
                    onChange={(val) => setSelectedMinute(val)}
                    min={0}
                    max={59}
                    itemHeight={58}
                    visibleCount={3}
                    items={Array.from({ length: 60 }, (_, i) => ({
                      value: i,
                      label: i.toString().padStart(2, '0'),
                    }))}
                  />
                </div>
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

              {/* Day / Month / Year Table Grids (تا روی دکمه‌های روز ماه سال کلیک نشده جدول‌ها باز نشود) */}
              <div className="space-y-2 pt-1">
                {/* 3 Segmented Header Buttons to Toggle Grids */}
                <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-stone-950/80 border border-stone-800 text-xs">
                  <button
                    type="button"
                    onClick={() => setDateActiveTab(dateActiveTab === 'day' ? null : 'day')}
                    className={`flex-1 py-1.5 px-2 rounded-xl text-center font-black transition-all cursor-pointer flex flex-col items-center justify-center ${
                      dateActiveTab === 'day'
                        ? 'bg-indigo-600 text-white shadow-md'
                        : 'text-stone-300 hover:text-white hover:bg-stone-900'
                    }`}
                  >
                    <span className="text-[10px] opacity-75">{isEn ? 'Day' : 'روز'}</span>
                    <span className="text-sm font-black">{isEn ? selectedDay : toPersianDigits(selectedDay)}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDateActiveTab(dateActiveTab === 'month' ? null : 'month')}
                    className={`flex-1 py-1.5 px-2 rounded-xl text-center font-black transition-all cursor-pointer flex flex-col items-center justify-center ${
                      dateActiveTab === 'month'
                        ? 'bg-indigo-600 text-white shadow-md'
                        : 'text-stone-300 hover:text-white hover:bg-stone-900'
                    }`}
                  >
                    <span className="text-[10px] opacity-75">{isEn ? 'Month' : 'ماه'}</span>
                    <span className="text-sm font-black truncate max-w-full">
                      {isEn ? GREGORIAN_MONTHS[selectedMonth - 1] : PERSIAN_MONTHS[selectedMonth - 1]}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDateActiveTab(dateActiveTab === 'year' ? null : 'year')}
                    className={`flex-1 py-1.5 px-2 rounded-xl text-center font-black transition-all cursor-pointer flex flex-col items-center justify-center ${
                      dateActiveTab === 'year'
                        ? 'bg-indigo-600 text-white shadow-md'
                        : 'text-stone-300 hover:text-white hover:bg-stone-900'
                    }`}
                  >
                    <span className="text-[10px] opacity-75">{isEn ? 'Year' : 'سال'}</span>
                    <span className="text-sm font-black">{isEn ? selectedYear : toPersianDigits(selectedYear)}</span>
                  </button>
                </div>

                {/* Active Table/Grid Content (Only rendered when user clicks Day, Month, or Year button) */}
                {dateActiveTab === 'day' && (
                  <div className="p-2 sm:p-2.5 rounded-2xl bg-stone-950/70 border border-stone-800 animate-in fade-in">
                    <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
                      {Array.from(
                        { length: isEn ? getDaysInGregorianMonth(selectedYear, selectedMonth) : getDaysInJalaliMonth(selectedYear, selectedMonth) },
                        (_, i) => i + 1
                      ).map((d) => {
                        const isSelected = selectedDay === d;
                        return (
                          <button
                            key={d}
                            type="button"
                            onClick={() => {
                              setSelectedDay(d);
                              setDateActiveTab(null);
                            }}
                            className={`min-h-[34px] sm:min-h-[38px] rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center transition-all cursor-pointer active:scale-95 ${
                              isSelected
                                ? 'bg-indigo-600 text-white font-black shadow-md ring-2 ring-indigo-400'
                                : 'bg-stone-900/80 hover:bg-stone-800 text-stone-300 hover:text-white border border-stone-800/80'
                            }`}
                          >
                            {isEn ? d : toPersianDigits(d)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {dateActiveTab === 'month' && (
                  <div className="p-2 sm:p-2.5 rounded-2xl bg-stone-950/70 border border-stone-800 animate-in fade-in">
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                      {(isEn ? GREGORIAN_MONTHS : PERSIAN_MONTHS).map((mName, idx) => {
                        const monthNum = idx + 1;
                        const isSelected = selectedMonth === monthNum;
                        return (
                          <button
                            key={mName}
                            type="button"
                            onClick={() => {
                              setSelectedMonth(monthNum);
                              const maxD = isEn ? getDaysInGregorianMonth(selectedYear, monthNum) : getDaysInJalaliMonth(selectedYear, monthNum);
                              if (selectedDay > maxD) {
                                setSelectedDay(maxD);
                              }
                              setDateActiveTab(null);
                            }}
                            className={`py-2 px-1 rounded-xl text-xs font-bold transition-all text-center cursor-pointer active:scale-95 ${
                              isSelected
                                ? 'bg-indigo-600 text-white font-black shadow-md ring-2 ring-indigo-400'
                                : 'bg-stone-900/80 hover:bg-stone-800 text-stone-300 hover:text-white border border-stone-800/80'
                            }`}
                          >
                            <span>{mName}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {dateActiveTab === 'year' && (
                  <div className="p-2.5 rounded-2xl bg-stone-950/70 border border-stone-800 space-y-3 animate-in fade-in">
                    {/* Years up to 1425 in Table/Grid (سال تا ۱۴۲۵ به صورت جدول) */}
                    <div className="grid grid-cols-4 sm:grid-cols-5 gap-1.5 max-h-48 overflow-y-auto no-scrollbar p-0.5">
                      {(isEn ? GREGORIAN_YEARS_GRID : JALALI_YEARS_GRID).map((yr) => {
                        const isSelected = selectedYear === yr;
                        return (
                          <button
                            key={yr}
                            type="button"
                            onClick={() => {
                              setSelectedYear(yr);
                              setCustomYearInput('');
                              setDateActiveTab(null);
                            }}
                            className={`py-1.5 px-1 rounded-xl text-xs font-mono font-bold transition-all text-center cursor-pointer active:scale-95 ${
                              isSelected
                                ? 'bg-indigo-600 text-white font-black shadow-md ring-2 ring-indigo-400'
                                : 'bg-stone-900/80 hover:bg-stone-800 text-stone-300 hover:text-white border border-stone-800/80'
                            }`}
                          >
                            {isEn ? yr : toPersianDigits(yr)}
                          </button>
                        );
                      })}
                    </div>

                    {/* Typing for Years Higher than 1425 (سال بالاتر به صورت تایپی) */}
                    <div className="pt-2 border-t border-stone-800/80 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-bold text-stone-300">
                          {isEn ? 'Years higher than 2046 (Type):' : 'سال‌های بالاتر از ۱۴۲۵ (به صورت تایپی):'}
                        </span>
                        {selectedYear > (isEn ? 2046 : 1425) && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30">
                            {isEn ? `Selected: ${selectedYear}` : `انتخاب‌شده: ${toPersianDigits(selectedYear)}`}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={isEn ? 2047 : 1426}
                          max={isEn ? 2200 : 1600}
                          value={customYearInput}
                          onChange={(e) => {
                            setCustomYearInput(e.target.value);
                            const val = parseInt(e.target.value, 10);
                            if (!isNaN(val) && val > (isEn ? 2046 : 1425)) {
                              setSelectedYear(val);
                            }
                          }}
                          placeholder={isEn ? 'e.g. 2050' : 'مثلاً: ۱۴۲۶، ۱۴۳۰...'}
                          className="flex-1 bg-stone-900 border border-stone-700 rounded-xl px-3 py-2 text-xs text-white placeholder-stone-500 focus:outline-none focus:border-indigo-500 font-mono"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const val = parseInt(customYearInput, 10);
                            if (!isNaN(val) && val > (isEn ? 2046 : 1425)) {
                              setSelectedYear(val);
                              setDateActiveTab(null);
                            }
                          }}
                          disabled={!customYearInput || parseInt(customYearInput, 10) <= (isEn ? 2046 : 1425)}
                          className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-bold text-xs cursor-pointer active:scale-95 transition-all"
                        >
                          {isEn ? 'Apply' : 'ثبت'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
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
                      className={`p-2.5 rounded-xl border text-right transition-all flex items-center justify-between cursor-pointer active:scale-95 ${
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
              {/* 1. HOURLY SUB-PANEL */}
              {recurrence === 'hourly' && (
                <div className="p-3 rounded-xl bg-stone-900/80 border border-stone-800 space-y-2 animate-in fade-in">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-stone-300 font-bold">
                      {isEn ? 'Hourly Interval:' : 'بازه تکرار ساعتی:'}
                    </span>
                    <span className="text-indigo-400 font-extrabold font-mono">
                      {isEn ? `Every ${recurrenceInterval} hours` : `هر ${toPersianDigits(recurrenceInterval)} ساعت`}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5">
                    {HOURLY_INTERVALS.map((hours) => {
                      const isSel = recurrenceInterval === hours;
                      return (
                        <button
                          key={hours}
                          type="button"
                          onClick={() => setRecurrenceInterval(hours)}
                          className={`py-1.5 px-2 rounded-lg text-xs font-bold font-mono transition-all text-center cursor-pointer ${
                            isSel
                              ? 'bg-indigo-500 text-white font-black shadow'
                              : 'bg-stone-950 text-stone-400 hover:text-white border border-stone-800'
                          }`}
                        >
                          {isEn ? `${hours}h` : `${toPersianDigits(hours)}س`}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 2. DAILY SUB-PANEL */}
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
                    onClick={() => setIsCameraOpen(true)}
                    className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-stone-950 border border-stone-800 hover:border-indigo-500/50 text-stone-300 text-xs font-medium transition-colors"
                  >
                    <Camera className="w-4 h-4 text-indigo-400" />
                    <span>{isEn ? 'Take Photo' : 'گرفتن عکس با دوربین'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-stone-950 border border-stone-800 hover:border-indigo-500/50 text-stone-300 text-xs font-medium transition-colors"
                  >
                    <Upload className="w-4 h-4 text-cyan-400" />
                    <span>{isEn ? 'Upload File' : 'آپلود فایل عکس'}</span>
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

            {/* Google Sync Option */}
            {googleToken && (
              <div className="pt-2 border-t border-stone-800">
                <label className="flex items-center justify-between p-3 rounded-xl bg-stone-950/60 border border-stone-800/80 cursor-pointer hover:border-sky-500/50">
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 rounded-lg bg-sky-500/10 text-sky-400">
                      <Cloud className="w-4 h-4" />
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

            {/* GEOFENCE LOCATION CHECKPOINT (حصار مکانی / Geofence) */}
            <div className={`rounded-2xl border-2 p-3.5 sm:p-5 space-y-3.5 shadow-md transition-all ${
              enableGeofence
                ? 'bg-emerald-500/12 border-emerald-400/75 shadow-emerald-500/10'
                : 'bg-indigo-500/12 border-indigo-400/50 shadow-indigo-500/10'
            }`}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-white/15 border border-white/30 text-white flex items-center justify-center shrink-0">
                    <MapPin className="w-4.5 h-4.5 text-white" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span style={{ color: '#FFFFFF' }} className="text-sm sm:text-base font-black !text-white">
                        {isEn ? 'Geofence' : 'حصار مکانی'}
                      </span>
                    </div>
                    <p className="text-[11px] text-stone-200">
                      {isEn
                        ? 'Trigger alarm & spoken alert upon arrival or departure from this coordinate'
                        : 'پخش آلارم، صوت و اعلان اختصاصی هنگام ورود یا خروج از محدوده مکانی'}
                    </p>
                  </div>
                </div>

                {/* High-Visibility Sliding Toggle Switch (کلید کشویی واضح فعال‌سازی) */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={enableGeofence}
                  onClick={(e) => {
                    const willEnable = !enableGeofence;
                    setEnableGeofence(willEnable);
                    if (willEnable) {
                      scrollAccordionHeaderIntoView(e.currentTarget.closest('.rounded-2xl') as HTMLElement, 38);
                    }
                  }}
                  className="flex items-center gap-2 shrink-0 cursor-pointer group focus:outline-none"
                  title={enableGeofence ? (isEn ? 'Disable Geofence' : 'غیرفعال کردن حصار مکانی') : (isEn ? 'Enable Geofence' : 'فعال کردن حصار مکانی')}
                >
                  <span className={`text-xs font-black transition-colors ${
                    enableGeofence ? 'text-emerald-300' : 'text-stone-200 group-hover:text-white'
                  }`}>
                    {enableGeofence ? (isEn ? 'ON' : 'فعال') : (isEn ? 'OFF' : 'غیرفعال')}
                  </span>
                  <div
                    dir="ltr"
                    className={`w-14 h-8 rounded-full border-2 p-1 flex items-center transition-all duration-200 shadow-inner ${
                      enableGeofence
                        ? 'bg-emerald-500 border-emerald-200 justify-end shadow-[0_0_14px_rgba(16,185,129,0.55)]'
                        : 'bg-stone-700 border-stone-400 justify-start hover:border-white'
                    }`}
                  >
                    <span
                      style={{ backgroundColor: '#FFFFFF' }}
                      className="w-5.5 h-5.5 rounded-full !bg-white shadow-md transition-all duration-200"
                    />
                  </div>
                </button>
              </div>

              {enableGeofence && (
                <div className="space-y-3 pt-3 border-t border-emerald-500/20 animate-in fade-in">
                  {/* 1. Pick from Saved Locations if available */}
                  {savedLocations && savedLocations.length > 0 && (
                    <div>
                      <label className="block text-[11px] font-bold text-stone-300 mb-1">
                        {isEn ? 'Select from Saved Places:' : 'انتخاب از مکان‌های ثبت‌شده:'}
                      </label>
                      <select
                        value={geofenceSavedLocId}
                        onChange={(e) => handleSelectSavedLocation(e.target.value)}
                        className="w-full bg-stone-900 border border-stone-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 font-bold"
                      >
                        <option value="">{isEn ? '-- Custom GPS / Coordinates --' : '-- انتخاب دستی یا GPS جدید --'}</option>
                        {savedLocations.map((loc) => (
                          <option key={loc.id} value={loc.id}>
                            📍 {formatSavedLocationTitle(loc.title, language)} {loc.address ? `(${loc.address.slice(0, 28)}...)` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* 2. Checkpoint Name & Quick GPS Capture */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-bold text-stone-300 mb-1">
                        {isEn ? 'Location Name:' : 'نام یا عنوان مکان حصار:'}
                      </label>
                      <input
                        type="text"
                        value={geofenceLocationName}
                        onChange={(e) => setGeofenceLocationName(e.target.value)}
                        placeholder={isEn ? 'e.g. Home, Office, Supermarket...' : 'مثلاً: شرکت، منزل، داروخانه، فروشگاه...'}
                        className="w-full bg-stone-950 border border-stone-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-stone-300 mb-1">
                        {isEn ? 'Current GPS:' : 'موقعیت فعلی:'}
                      </label>
                      <button
                        type="button"
                        onClick={handleGetQuickGps}
                        disabled={isDetectingGps}
                        className="w-full py-2 px-3 rounded-xl bg-emerald-600/30 hover:bg-emerald-600/50 border border-emerald-500/50 text-emerald-300 text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                      >
                        <Crosshair className={`w-3.5 h-3.5 ${isDetectingGps ? 'animate-spin' : ''}`} />
                        <span>{isDetectingGps ? (isEn ? 'Getting GPS...' : 'دریافت GPS...') : (isEn ? 'Get GPS' : 'ثبت با GPS فعلی')}</span>
                      </button>
                    </div>
                  </div>

                  {gpsError && (
                    <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs animate-in fade-in">
                      <span className="truncate">{gpsError}</span>
                      <button
                        type="button"
                        onClick={() => openAndroidSettings('location')}
                        className="shrink-0 px-2 py-1 rounded-lg bg-indigo-500 text-white font-black text-[10px] flex items-center gap-1 shadow-sm active:scale-95 cursor-pointer"
                      >
                        <Smartphone className="w-2.5 h-2.5" />
                        <span>{isEn ? 'Android Settings' : 'تنظیمات اندروید'}</span>
                      </button>
                    </div>
                  )}

                  {/* 3. Coordinates Preview (Latitude / Longitude) */}
                  <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                    <div>
                      <label className="block text-[10px] text-stone-400 font-sans mb-0.5">{isEn ? 'Latitude:' : 'عرض جغرافیایی (Lat):'}</label>
                      <input
                        type="number"
                        step="any"
                        value={geofenceLat}
                        onChange={(e) => setGeofenceLat(parseFloat(e.target.value) || 0)}
                        className="w-full bg-stone-950 border border-stone-800 rounded-xl px-2.5 py-1.5 text-xs text-stone-200 focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-stone-400 font-sans mb-0.5">{isEn ? 'Longitude:' : 'طول جغرافیایی (Lng):'}</label>
                      <input
                        type="number"
                        step="any"
                        value={geofenceLng}
                        onChange={(e) => setGeofenceLng(parseFloat(e.target.value) || 0)}
                        className="w-full bg-stone-950 border border-stone-800 rounded-xl px-2.5 py-1.5 text-xs text-stone-200 focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                  </div>

                  {/* 4. Trigger Condition (ورود، خروج، هر دو) */}
                  <div>
                    <label className="block text-[11px] font-bold text-stone-300 mb-1.5">
                      {isEn ? 'Alert Condition (Trigger):' : 'شرط فعال‌سازی هشدار:'}
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { id: 'enter', labelFa: 'هنگام ورود (رسیدن)', labelEn: 'On Arrival' },
                        { id: 'exit', labelFa: 'هنگام خروج (ترک کردن)', labelEn: 'On Departure' },
                        { id: 'both', labelFa: 'هر دو (ورود و خروج)', labelEn: 'Both' },
                      ].map((item) => {
                        const isSelected = geofenceTriggerOn === item.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => setGeofenceTriggerOn(item.id as any)}
                            className={`py-2 px-2 rounded-xl text-[11px] font-bold border transition-all flex flex-col items-center gap-1 cursor-pointer ${
                              isSelected
                                ? 'bg-emerald-500/25 border-emerald-500 text-white shadow-sm ring-1 ring-emerald-400/50'
                                : 'bg-stone-950/80 border-stone-800 text-stone-400 hover:text-stone-200'
                            }`}
                          >
                            <span>{isEn ? item.labelEn : item.labelFa}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* 5. Radius Selector */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-[11px] font-bold text-stone-300">
                        {isEn ? 'Trigger Radius:' : 'شعاع محدوده حصار مکانی:'}
                      </label>
                      <span className="text-xs font-mono font-bold text-indigo-400">
                        {toPersianDigits(geofenceRadius)} {isEn ? 'meters' : 'متر'}
                      </span>
                    </div>
                    <div className="grid grid-cols-5 gap-1.5">
                      {[50, 100, 200, 500, 1000].map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setGeofenceRadius(r)}
                          className={`py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                            geofenceRadius === r
                              ? 'bg-indigo-500 text-white font-black border-indigo-400'
                              : 'bg-stone-900 border-stone-800 text-stone-300 hover:border-stone-700'
                          }`}
                        >
                          {isEn ? `${r}m` : `${toPersianDigits(r)}متر`}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
                </div>
              )}
            </div>
            </div>

            {/* Sticky Submit Footer - Always positioned right above virtual keyboard with min 48px buttons */}
            <div className="sticky bottom-0 z-30 shrink-0 bg-stone-900/95 backdrop-blur-md border-t border-stone-800 p-3 sm:p-4 flex items-center justify-end gap-3 shadow-2xl">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[48px] px-5 py-2.5 rounded-xl bg-stone-800 hover:bg-stone-700 active:scale-95 text-stone-300 hover:text-white text-xs sm:text-sm font-semibold transition-colors cursor-pointer flex items-center justify-center border border-stone-700/60"
              >
                {isEn ? 'Cancel' : 'انصراف'}
              </button>
              <button
                type="submit"
                className={`min-h-[48px] px-6 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95 ${
                  !title.trim()
                    ? 'bg-indigo-500/20 border border-indigo-500/40 text-indigo-300'
                    : 'bg-indigo-500 hover:bg-indigo-400 text-white font-black shadow-lg shadow-indigo-500/20'
                }`}
              >
                <Check className={`w-4 h-4 stroke-[3] ${!title.trim() ? 'text-indigo-300' : 'text-white'}`} />
                <span className={!title.trim() ? 'text-indigo-300 font-bold' : 'text-white font-black'}>
                  {initialData ? (isEn ? 'Save Changes' : 'ذخیره تغییرات') : (isEn ? 'Save Reminder' : 'ثبت نهایی یادآور')}
                </span>
              </button>
            </div>
          </form>
        </div>
      </div>

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

      {/* SMS Import Modal with Direct Permission & WebOTP */}
      {isSmsImportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
          <div className="bg-stone-900 border border-cyan-500/40 rounded-3xl w-full max-w-lg p-5 sm:p-6 shadow-2xl space-y-4 my-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-stone-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  <MessageSquare className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm sm:text-base text-white">
                    دسترسی مستقیم و استخراج از پیامک‌ها
                  </h3>
                  <p className="text-[11px] text-stone-400">
                    دریافت هوشمند مشخصات یادآور از پیامک‌های بانکی، پزشکی و کاری
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  if (smsAbortControllerRef.current) {
                    smsAbortControllerRef.current.abort();
                  }
                  setIsSmsImportOpen(false);
                }}
                className="p-1.5 rounded-full text-stone-400 hover:text-white hover:bg-stone-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Direct SMS Permission Actions */}
            <div className="space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {/* 1. Direct Native SMS Permission (WebOTP API) */}
                <button
                  type="button"
                  onClick={requestDirectSmsPermission}
                  className={`p-3 rounded-2xl border text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
                    smsPermissionStatus === 'granted'
                      ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-300'
                      : 'bg-cyan-950/70 border-cyan-500/40 text-cyan-300 hover:bg-cyan-900/50'
                  }`}
                >
                  <ShieldCheck className="w-4 h-4 text-cyan-400" />
                  <span>
                    {smsPermissionStatus === 'granted'
                      ? '✓ پیامک با موفقیت دریافت شد'
                      : 'دریافت مستقیم پیامک از گوشی (WebOTP)'}
                  </span>
                </button>

                {/* 2. Direct Clipboard Read */}
                <button
                  type="button"
                  onClick={readFromClipboard}
                  className="p-3 rounded-2xl bg-stone-950 border border-stone-800 hover:border-stone-700 text-stone-300 hover:text-white text-xs font-bold transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  <span>خواندن از کلیپ‌بورد پیامک</span>
                </button>
              </div>

              {/* 3. File backup upload (optional) */}
              <div className="flex items-center justify-between px-1 text-xs">
                <button
                  type="button"
                  onClick={() => smsFileInputRef.current?.click()}
                  className="text-[11px] text-stone-400 hover:text-cyan-400 flex items-center gap-1 cursor-pointer transition-colors"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>بارگذاری از فایل پیامک (XML / TXT)</span>
                </button>
                <input
                  ref={smsFileInputRef}
                  type="file"
                  accept=".txt,.xml,.json"
                  onChange={handleSmsFileUpload}
                  className="hidden"
                />
              </div>

              {/* Status message */}
              {smsStatusMsg && (
                <div className={`p-2.5 rounded-xl text-xs font-medium border ${
                  smsPermissionStatus === 'granted'
                    ? 'bg-emerald-950/50 text-emerald-300 border-emerald-500/30'
                    : smsPermissionStatus === 'listening'
                    ? 'bg-indigo-950/50 text-indigo-300 border-indigo-500/30'
                    : 'bg-stone-950 text-stone-300 border-stone-800'
                }`}>
                  {smsStatusMsg}
                </div>
              )}
            </div>

            {/* Raw SMS Textarea */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-stone-300 flex items-center justify-between">
                <span>متن پیامک:</span>
                <span className="text-[11px] text-stone-400">می‌توانید متن را مستقیماً ویرایش کنید</span>
              </label>
              <textarea
                value={smsRawText}
                onChange={(e) => setSmsRawText(e.target.value)}
                placeholder="مثال: یادآوری نوبت دندانپزشکی فردا ساعت ۱۷:۰۰ در کلینیک..."
                rows={3}
                className="w-full bg-stone-950 border border-stone-700 focus:border-cyan-500 rounded-2xl p-3 text-xs text-white placeholder-stone-500 focus:outline-none transition-colors"
              />
            </div>

            {/* Quick Sample SMS for instant test */}
            <div className="space-y-1">
              <span className="text-[11px] text-stone-400">نمونه‌های آزمایشی پیامک:</span>
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => setSmsRawText('یادآوری نوبت دندانپزشکی فردا ساعت ۱۷:۰۰ در کلینیک دکتر علوی')}
                  className="text-[11px] px-2.5 py-1 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-300 border border-stone-700 cursor-pointer"
                >
                  نوبت پزشک (فردا ۱۷:۰۰)
                </button>
                <button
                  type="button"
                  onClick={() => setSmsRawText('مشتری گرامی، زمان پرداخت قسط وام شما پس‌فردا ساعت ۱۰:۰۰ می‌باشد')}
                  className="text-[11px] px-2.5 py-1 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-300 border border-stone-700 cursor-pointer"
                >
                  قسط بانکی (پس‌فردا ۱۰:۰۰)
                </button>
                <button
                  type="button"
                  onClick={() => setSmsRawText('جلسه کاری با مدیر پروژه امشب ساعت ۲۰:۰۰ در سالن اجتماعات شرکت')}
                  className="text-[11px] px-2.5 py-1 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-300 border border-stone-700 cursor-pointer"
                >
                  جلسه کاری (امشب ۲۰:۰۰)
                </button>
              </div>
            </div>

            {/* Extracted Preview Badge */}
            {smsRawText.trim() && (() => {
              const preview = parseSmsOrText(smsRawText);
              return (
                <div className="p-3 rounded-2xl bg-stone-950 border border-indigo-500/25 space-y-1.5 text-xs">
                  <div className="font-bold text-indigo-400 flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>اطلاعات استخراج‌شده هوشمند:</span>
                  </div>
                  <div className="text-white font-medium">عنوان: {preview.title}</div>
                  <div className="flex items-center gap-2 text-[11px] text-stone-400">
                    <span>دسته‌بندی: {preview.category === 'work' ? 'کار' : preview.category === 'family' ? 'خانواده' : 'سایر'}</span>
                    <span>•</span>
                    <span>اولویت: {preview.priority === 'high' ? 'فوری' : preview.priority === 'medium' ? 'متوسط' : 'عادی'}</span>
                  </div>
                </div>
              );
            })()}

            {/* Footer Buttons */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-stone-800">
              <button
                type="button"
                onClick={() => {
                  if (smsAbortControllerRef.current) {
                    smsAbortControllerRef.current.abort();
                  }
                  setIsSmsImportOpen(false);
                }}
                className="px-4 py-2 rounded-xl bg-stone-800 text-stone-300 text-xs font-medium hover:bg-stone-700 cursor-pointer"
              >
                انصراف
              </button>
              <button
                type="button"
                onClick={handleSmsImport}
                disabled={!smsRawText.trim()}
                className="px-5 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 text-white font-black text-xs shadow-lg shadow-indigo-500/25 active:scale-95 transition-all cursor-pointer"
              >
                تأیید و درج در یادآور
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

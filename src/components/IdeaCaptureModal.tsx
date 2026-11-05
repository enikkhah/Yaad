import React, { useState, useRef, useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { IdeaNote, Category, Priority, RecurrenceType, Reminder } from '../types';
import { 
  Lightbulb, 
  Mic, 
  MicOff, 
  Video, 
  PenTool, 
  Trash2, 
  X, 
  Square, 
  Check, 
  Sparkles, 
  FileText,
  Clock,
  RotateCcw,
  AlertCircle,
  Camera,
  SwitchCamera,
  Briefcase,
  Heart,
  Tag,
  Bell,
  ChevronDown,
  Repeat,
  Zap
} from 'lucide-react';
import { 
  getJalaliComponents,
  PERSIAN_MONTHS,
  toPersianDigits,
  jalaliToGregorian,
  GREGORIAN_MONTHS,
  getDaysInGregorianMonth,
  getDaysInJalaliMonth,
  getJalaliWeekdayIndex,
  getGregorianMondayWeekdayIndex,
  JALALI_WEEKDAYS_HEADER,
  GREGORIAN_WEEKDAYS_MONDAY_FIRST,
  getCalendarDayHolidayInfo,
  getMonthOfficialHolidays
} from '../utils/jalali';
import { 
  RECURRENCE_OPTIONS, 
  PERSIAN_WEEK_DAYS, 
  ENGLISH_WEEK_DAYS,
  HOURLY_INTERVALS 
} from '../utils/recurrence';
import { JalaliMultiDatePicker } from './JalaliMultiDatePicker';
import { WheelPicker } from './WheelPicker';
import { scrollAccordionHeaderIntoView } from '../utils/accordionScroll';
import { requestNotificationPermission } from '../utils/nativeLocalNotifications';
import { syncToGoogleTasks } from '../utils/googleSync';
import { ValidationAlertModal } from './ValidationAlertModal';
import { AppLanguage } from '../utils/i18n';
import {
  openAndroidSettings,
  ensureNativeAndroidCameraPermission,
  markPermissionGranted,
} from '../utils/nativePermissions';
import { appendWithoutDuplicate, safeAbortSpeechRecognition } from '../utils/speechDeduplication';

const JALALI_YEARS_GRID = Array.from({ length: 1425 - 1404 + 1 }, (_, i) => 1404 + i);
const GREGORIAN_YEARS_GRID = Array.from({ length: 2046 - 2025 + 1 }, (_, i) => 2025 + i);
const HOUR_WHEEL_ITEMS = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: i.toString().padStart(2, '0'),
}));
const MINUTE_WHEEL_ITEMS = Array.from({ length: 60 }, (_, i) => ({
  value: i,
  label: i.toString().padStart(2, '0'),
}));

interface IdeaCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveIdea: (
    idea: Omit<IdeaNote, 'id' | 'createdAt'>,
    reminderData?: Omit<Reminder, 'id' | 'createdAt' | 'status' | 'postponeCount'> | null
  ) => void;
  onUpdateIdea?: (id: string, idea: Partial<IdeaNote>) => void;
  editingIdea?: IdeaNote | null;
  googleToken: string | null;
  language?: AppLanguage;
  defaultOpenReminderMenu?: boolean;
}

export const IdeaCaptureModal: React.FC<IdeaCaptureModalProps> = ({
  isOpen,
  onClose,
  onSaveIdea,
  onUpdateIdea,
  editingIdea,
  googleToken,
  language = 'fa',
  defaultOpenReminderMenu = false,
}) => {
  const isEn = language === 'en';
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState<Category>('work');
  const [activeTab, setActiveTab] = useState<'text' | 'voice' | 'photo' | 'video' | 'sketch'>('text');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [showValidationModal, setShowValidationModal] = useState(false);

  // Virtual keyboard tracking: keeps footer button pinned directly above virtual keyboard
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);

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

  // Voice typing (Speech-to-text) state for body content
  const [isVoiceTyping, setIsVoiceTyping] = useState(false);
  const [contentInterimTranscript, setContentInterimTranscript] = useState('');
  const speechRecognitionRef = useRef<any>(null);
  const shouldKeepContentListeningRef = useRef<boolean>(false);
  const lastFinalContentTranscriptRef = useRef<string>('');
  const processedFinalContentIndicesRef = useRef<Set<number>>(new Set());
  const contentRef = useRef<string>('');
  const contentSilenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const contentSpeechStartTimeRef = useRef<number>(0);
  const contentLastSpeechTimeRef = useRef<number>(0);

  // Voice typing for title
  const [isTitleVoiceTyping, setIsTitleVoiceTyping] = useState(false);
  const [titleInterimTranscript, setTitleInterimTranscript] = useState('');
  const [voiceLang, setVoiceLang] = useState<'fa' | 'en'>(language === 'en' ? 'en' : 'fa');
  const [voiceErrorMsg, setVoiceErrorMsg] = useState<string | null>(null);
  const titleSpeechRecognitionRef = useRef<any>(null);
  const shouldKeepTitleListeningRef = useRef<boolean>(false);
  const lastFinalTitleTranscriptRef = useRef<string>('');
  const processedFinalTitleIndicesRef = useRef<Set<number>>(new Set());
  const titleRef = useRef<string>('');
  const titleSilenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const titleSpeechStartTimeRef = useRef<number>(0);
  const titleLastSpeechTimeRef = useRef<number>(0);

  // Keep voiceLang synced with app language
  useEffect(() => {
    setVoiceLang(language === 'en' ? 'en' : 'fa');
  }, [language, isOpen]);

  // Keep titleRef and contentRef synced to prevent stale closures
  useEffect(() => {
    titleRef.current = title;
  }, [title]);

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  // Audio recording state
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [audioBlobUrl, setAudioBlobUrl] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Video recording state (supports both rear 'environment' and front 'user' camera)
  const [isRecordingVideo, setIsRecordingVideo] = useState(false);
  const [isVideoPreviewActive, setIsVideoPreviewActive] = useState(false);
  const [videoFacingMode, setVideoFacingMode] = useState<'environment' | 'user'>('environment');
  const [videoBlobUrl, setVideoBlobUrl] = useState<string | null>(null);
  const videoMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const videoChunksRef = useRef<Blob[]>([]);
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const videoAudioStreamRef = useRef<MediaStream | null>(null);

  // Rear-camera-only photo capture state
  const [isPhotoCameraActive, setIsPhotoCameraActive] = useState(false);
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const photoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const photoStreamRef = useRef<MediaStream | null>(null);
  const [cameraErrorMsg, setCameraErrorMsg] = useState<string | null>(null);

  // Drawing Canvas state with Samsung S Pen & Stylus Support
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [penColor, setPenColor] = useState('#818CF8');
  const [penSize, setPenSize] = useState(3);
  const [drawingDataUrl, setDrawingDataUrl] = useState<string | null>(null);
  const [isStylusActive, setIsStylusActive] = useState(false);
  const [currentPressure, setCurrentPressure] = useState<number>(0.5);
  const [penMode, setPenMode] = useState<'pen' | 'highlighter' | 'eraser'>('pen');
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  // Google sync checkbox
  const [syncWithGoogle, setSyncWithGoogle] = useState(!!googleToken);

  // Bottom Expandable Reminder Menu State (منوی بازشو تنظیم یادآور با فرمت اپ در پایین صفحه)
  const [showReminderMenu, setShowReminderMenu] = useState(false);
  const [enableReminder, setEnableReminder] = useState(false);
  const [pickerSessionKey, setPickerSessionKey] = useState<number>(0);

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

  const [selectedYear, setSelectedYear] = useState(() => language === 'en' ? getDynamicDefaultTime().gregorian.year : getDynamicDefaultTime().jalali.year);
  const [selectedMonth, setSelectedMonth] = useState(() => language === 'en' ? getDynamicDefaultTime().gregorian.month : getDynamicDefaultTime().jalali.month);
  const [selectedDay, setSelectedDay] = useState(() => language === 'en' ? getDynamicDefaultTime().gregorian.day : getDynamicDefaultTime().jalali.day);
  const [selectedHour, setSelectedHour] = useState(() => language === 'en' ? getDynamicDefaultTime().gregorian.hour : getDynamicDefaultTime().jalali.hour);
  const [selectedMinute, setSelectedMinute] = useState(() => language === 'en' ? getDynamicDefaultTime().gregorian.minute : getDynamicDefaultTime().jalali.minute);
  const [dateActiveTab, setDateActiveTab] = useState<'day' | 'month' | 'year' | null>(null);
  const [customYearInput, setCustomYearInput] = useState<string>('');

  const [priority, setPriority] = useState<Priority>('medium');
  const [priorityLevel, setPriorityLevel] = useState<number>(3);
  const [recurrence, setRecurrence] = useState<RecurrenceType>('none');
  const [recurrenceInterval, setRecurrenceInterval] = useState<number>(1);
  const [recurrenceCount, setRecurrenceCount] = useState<number | undefined>(undefined);
  const [recurrenceDaysOfWeek, setRecurrenceDaysOfWeek] = useState<number[]>([]);
  const [recurrenceCustomDates, setRecurrenceCustomDates] = useState<string[]>([]);
  const recurrenceCountInputRef = useRef<HTMLInputElement>(null);
  const reminderAccordionBtnRef = useRef<HTMLButtonElement>(null);

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

  const applyPreset = (minutesFromNow: number) => {
    setEnableReminder(true);
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

  const setTomorrowMorning = () => {
    setEnableReminder(true);
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

  const calculateDueTimestamp = (): number => {
    if (isEn) {
      const date = new Date(selectedYear, selectedMonth - 1, selectedDay, selectedHour, selectedMinute, 0, 0);
      return date.getTime();
    }
    const [gy, gm, gd] = jalaliToGregorian(selectedYear, selectedMonth, selectedDay);
    const date = new Date(gy, gm - 1, gd, selectedHour, selectedMinute, 0, 0);
    return date.getTime();
  };

  // Reset or initialize on open
  useEffect(() => {
    if (isOpen) {
      setPickerSessionKey((prev) => prev + 1);
      setDateActiveTab(null);
      setCustomYearInput('');

      if (editingIdea) {
        setTitle(editingIdea.title || '');
        setContent(editingIdea.content || '');
        setCategory(editingIdea.category || 'work');
        setAudioBlobUrl(editingIdea.audioRecordUrl || null);
        setVideoBlobUrl(editingIdea.videoRecordUrl || null);
        setPhotoDataUrl(editingIdea.photoDataUrl || null);
        setDrawingDataUrl(editingIdea.drawingDataUrl || null);

        const hasExistingReminder = !!editingIdea.reminderDueTimestamp;
        const targetTime =
          hasExistingReminder && editingIdea.reminderDueTimestamp! > Date.now()
            ? editingIdea.reminderDueTimestamp!
            : Date.now() + 2 * 60 * 1000;

        if (isEn) {
          const d = new Date(targetTime);
          setSelectedYear(d.getFullYear());
          setSelectedMonth(d.getMonth() + 1);
          setSelectedDay(d.getDate());
          setSelectedHour(d.getHours());
          setSelectedMinute(d.getMinutes());
        } else {
          const j = getJalaliComponents(targetTime);
          setSelectedYear(j.year);
          setSelectedMonth(j.month);
          setSelectedDay(j.day);
          setSelectedHour(j.hour);
          setSelectedMinute(j.minute);
        }

        setEnableReminder(hasExistingReminder || defaultOpenReminderMenu);
        setShowReminderMenu(hasExistingReminder || defaultOpenReminderMenu);
        setPriority(editingIdea.reminderPriority || 'medium');
        setPriorityLevel(editingIdea.reminderPriorityLevel || 3);
        setRecurrence(editingIdea.reminderRecurrence || 'none');
        setRecurrenceInterval(editingIdea.reminderRecurrenceInterval || 1);
        setRecurrenceCount(editingIdea.reminderRecurrenceCount);
        setRecurrenceDaysOfWeek(editingIdea.reminderRecurrenceDaysOfWeek || []);
        setRecurrenceCustomDates(editingIdea.reminderRecurrenceCustomDates || []);
      } else {
        setTitle('');
        setContent('');
        setCategory('work');
        setAudioBlobUrl(null);
        setVideoBlobUrl(null);
        setPhotoDataUrl(null);
        setDrawingDataUrl(null);

        const defaultTime = Date.now() + 2 * 60 * 1000;
        if (isEn) {
          const d = new Date(defaultTime);
          setSelectedYear(d.getFullYear());
          setSelectedMonth(d.getMonth() + 1);
          setSelectedDay(d.getDate());
          setSelectedHour(d.getHours());
          setSelectedMinute(d.getMinutes());
        } else {
          const j = getJalaliComponents(defaultTime);
          setSelectedYear(j.year);
          setSelectedMonth(j.month);
          setSelectedDay(j.day);
          setSelectedHour(j.hour);
          setSelectedMinute(j.minute);
        }

        setEnableReminder(defaultOpenReminderMenu);
        setShowReminderMenu(defaultOpenReminderMenu);
        setPriority('medium');
        setPriorityLevel(3);
        setRecurrence('none');
        setRecurrenceInterval(1);
        setRecurrenceCount(undefined);
        setRecurrenceDaysOfWeek([]);
        setRecurrenceCustomDates([]);
      }
      setIsVoiceTyping(false);
      setIsRecordingAudio(false);
      setIsRecordingVideo(false);
      setIsVideoPreviewActive(false);
      setIsPhotoCameraActive(false);
      setCameraErrorMsg(null);
      setValidationError(null);

      if (defaultOpenReminderMenu) {
        setTimeout(() => {
          if (reminderAccordionBtnRef.current) {
            scrollAccordionHeaderIntoView(reminderAccordionBtnRef.current, 38);
          }
        }, 180);
      }
    }
  }, [isOpen, editingIdea, defaultOpenReminderMenu]);

  // Clean up streams & speech on close or when alarm fires
  useEffect(() => {
    const cleanupAllMedia = () => {
      if (videoMediaRecorderRef.current) {
        videoMediaRecorderRef.current.onstop = null;
        try {
          if (videoMediaRecorderRef.current.state !== 'inactive') {
            videoMediaRecorderRef.current.stop();
          }
        } catch {
          // ignore
        }
        videoMediaRecorderRef.current = null;
      }
      if (videoAudioStreamRef.current) {
        videoAudioStreamRef.current.getTracks().forEach((t) => t.stop());
        videoAudioStreamRef.current = null;
      }
      if (videoStreamRef.current) {
        videoStreamRef.current.getTracks().forEach((t) => t.stop());
        videoStreamRef.current = null;
      }
      if (photoStreamRef.current) {
        photoStreamRef.current.getTracks().forEach((t) => t.stop());
        photoStreamRef.current = null;
      }
      setIsRecordingVideo(false);
      setIsVideoPreviewActive(false);
      setIsPhotoCameraActive(false);
      shouldKeepContentListeningRef.current = false;
      shouldKeepTitleListeningRef.current = false;
      if (contentSilenceTimerRef.current) clearTimeout(contentSilenceTimerRef.current);
      if (titleSilenceTimerRef.current) clearTimeout(titleSilenceTimerRef.current);
      setIsVoiceTyping(false);
      setIsTitleVoiceTyping(false);
      setTitleInterimTranscript('');
      setContentInterimTranscript('');
      lastFinalTitleTranscriptRef.current = '';
      lastFinalContentTranscriptRef.current = '';
      processedFinalTitleIndicesRef.current.clear();
      processedFinalContentIndicesRef.current.clear();
      if (speechRecognitionRef.current) {
        safeAbortSpeechRecognition(speechRecognitionRef.current);
        speechRecognitionRef.current = null;
      }
      if (titleSpeechRecognitionRef.current) {
        safeAbortSpeechRecognition(titleSpeechRecognitionRef.current);
        titleSpeechRecognitionRef.current = null;
      }
      if (mediaRecorderRef.current && isRecordingAudio) {
        mediaRecorderRef.current.stop();
      }
    };

    if (!isOpen) {
      cleanupAllMedia();
    }

    window.addEventListener('yaad:stop-all-microphones', cleanupAllMedia);
    return () => {
      window.removeEventListener('yaad:stop-all-microphones', cleanupAllMedia);
    };
  }, [isOpen, isRecordingAudio]);

  // 0. VOICE TYPING FOR TITLE (تبدیل گفتار به متن برای عنوان ایده)
  const toggleTitleVoiceTyping = async (forcedLang?: 'fa' | 'en') => {
    setVoiceErrorMsg(null);
    if (isTitleVoiceTyping) {
      shouldKeepTitleListeningRef.current = false;
      if (titleSilenceTimerRef.current) {
        clearTimeout(titleSilenceTimerRef.current);
        titleSilenceTimerRef.current = null;
      }
      safeAbortSpeechRecognition(titleSpeechRecognitionRef.current);
      titleSpeechRecognitionRef.current = null;
      setIsTitleVoiceTyping(false);
      setTitleInterimTranscript('');
      lastFinalTitleTranscriptRef.current = '';
      processedFinalTitleIndicesRef.current.clear();
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setVoiceErrorMsg(isEn ? 'Speech recognition not supported on this device.' : 'تبدیل گفتار به متن در این دستگاه در دسترس نیست.');
      setTimeout(() => setVoiceErrorMsg(null), 4000);
      return;
    }

    // Clean up any existing title recognition instance
    safeAbortSpeechRecognition(titleSpeechRecognitionRef.current);
    titleSpeechRecognitionRef.current = null;
    setTitleInterimTranscript('');
    lastFinalTitleTranscriptRef.current = '';
    processedFinalTitleIndicesRef.current.clear();

    try {
      const activeLang = forcedLang || voiceLang;
      shouldKeepTitleListeningRef.current = true;
      titleSpeechStartTimeRef.current = Date.now();
      titleLastSpeechTimeRef.current = 0;

      const resetTitleSilenceTimer = (durationMs = 5000) => {
        if (titleSilenceTimerRef.current) {
          clearTimeout(titleSilenceTimerRef.current);
          titleSilenceTimerRef.current = null;
        }
        titleSilenceTimerRef.current = setTimeout(() => {
          shouldKeepTitleListeningRef.current = false;
          safeAbortSpeechRecognition(titleSpeechRecognitionRef.current);
          titleSpeechRecognitionRef.current = null;
          setIsTitleVoiceTyping(false);
          setTitleInterimTranscript('');
        }, durationMs);
      };

      resetTitleSilenceTimer(5000);

      const createAndRunTitleRec = () => {
        if (!shouldKeepTitleListeningRef.current) return;

        try {
          if (titleSpeechRecognitionRef.current) {
            safeAbortSpeechRecognition(titleSpeechRecognitionRef.current);
            titleSpeechRecognitionRef.current = null;
          }

          const recognition = new SpeechRecognition();
          recognition.lang = activeLang === 'en' ? 'en-US' : 'fa-IR';
          recognition.continuous = true;
          recognition.interimResults = true;
          processedFinalTitleIndicesRef.current.clear();

          recognition.onstart = () => {
            setIsTitleVoiceTyping(true);
          };

          recognition.onresult = (event: any) => {
            let interimText = '';

            for (let i = event.resultIndex; i < event.results.length; ++i) {
              const res = event.results[i];
              if (res.isFinal) {
                if (!processedFinalTitleIndicesRef.current.has(i)) {
                  processedFinalTitleIndicesRef.current.add(i);
                  const finalChunk = res[0]?.transcript?.trim();
                  if (finalChunk && finalChunk !== lastFinalTitleTranscriptRef.current) {
                    lastFinalTitleTranscriptRef.current = finalChunk;
                    titleLastSpeechTimeRef.current = Date.now();

                    const currentTitle = titleRef.current || '';
                    const updated = appendWithoutDuplicate(currentTitle, finalChunk);
                    if (updated !== currentTitle) {
                      titleRef.current = updated;
                      setTitle(updated);
                    }
                  }
                }
              } else {
                interimText += res[0]?.transcript || '';
              }
            }

            const cleanInterim = interimText.trim();
            setTitleInterimTranscript(cleanInterim);
            if (cleanInterim) {
              titleLastSpeechTimeRef.current = Date.now();
            }

            resetTitleSilenceTimer(3500);
          };

          recognition.onerror = () => {
            shouldKeepTitleListeningRef.current = false;
            safeAbortSpeechRecognition(titleSpeechRecognitionRef.current);
            titleSpeechRecognitionRef.current = null;
            setIsTitleVoiceTyping(false);
            setTitleInterimTranscript('');
          };

          recognition.onend = () => {
            shouldKeepTitleListeningRef.current = false;
            titleSpeechRecognitionRef.current = null;
            setIsTitleVoiceTyping(false);
            setTitleInterimTranscript('');
          };

          titleSpeechRecognitionRef.current = recognition;
          recognition.start();
        } catch (e) {
          console.warn('Title speech recognition failed', e);
          setIsTitleVoiceTyping(false);
        }
      };

      createAndRunTitleRec();
    } catch (e) {
      console.warn('Title speech recognition failed', e);
      setIsTitleVoiceTyping(false);
    }
  };

  // 1. VOICE TYPING (Speech-to-text for Persian / English)
  const toggleVoiceTyping = async (forcedLang?: 'fa' | 'en') => {
    setVoiceErrorMsg(null);
    if (isVoiceTyping) {
      shouldKeepContentListeningRef.current = false;
      if (contentSilenceTimerRef.current) {
        clearTimeout(contentSilenceTimerRef.current);
        contentSilenceTimerRef.current = null;
      }
      safeAbortSpeechRecognition(speechRecognitionRef.current);
      speechRecognitionRef.current = null;
      setIsVoiceTyping(false);
      setContentInterimTranscript('');
      lastFinalContentTranscriptRef.current = '';
      processedFinalContentIndicesRef.current.clear();
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setVoiceErrorMsg(isEn ? 'Speech recognition not supported on this device.' : 'تبدیل گفتار به متن در این دستگاه در دسترس نیست.');
      setTimeout(() => setVoiceErrorMsg(null), 4000);
      return;
    }

    // Clean up any existing content recognition instance
    safeAbortSpeechRecognition(speechRecognitionRef.current);
    speechRecognitionRef.current = null;
    setContentInterimTranscript('');
    lastFinalContentTranscriptRef.current = '';
    processedFinalContentIndicesRef.current.clear();

    try {
      const activeLang = forcedLang || voiceLang;
      shouldKeepContentListeningRef.current = true;
      contentSpeechStartTimeRef.current = Date.now();
      contentLastSpeechTimeRef.current = 0;

      const resetContentSilenceTimer = (durationMs = 5000) => {
        if (contentSilenceTimerRef.current) {
          clearTimeout(contentSilenceTimerRef.current);
          contentSilenceTimerRef.current = null;
        }
        contentSilenceTimerRef.current = setTimeout(() => {
          shouldKeepContentListeningRef.current = false;
          safeAbortSpeechRecognition(speechRecognitionRef.current);
          speechRecognitionRef.current = null;
          setIsVoiceTyping(false);
          setContentInterimTranscript('');
        }, durationMs);
      };

      resetContentSilenceTimer(5000);

      const createAndRunContentRec = () => {
        if (!shouldKeepContentListeningRef.current) return;

        try {
          if (speechRecognitionRef.current) {
            safeAbortSpeechRecognition(speechRecognitionRef.current);
            speechRecognitionRef.current = null;
          }

          const recognition = new SpeechRecognition();
          recognition.lang = activeLang === 'en' ? 'en-US' : 'fa-IR';
          recognition.continuous = true;
          recognition.interimResults = true;
          processedFinalContentIndicesRef.current.clear();

          recognition.onstart = () => {
            setIsVoiceTyping(true);
          };

          recognition.onresult = (event: any) => {
            let interimText = '';

            for (let i = event.resultIndex; i < event.results.length; ++i) {
              const res = event.results[i];
              if (res.isFinal) {
                if (!processedFinalContentIndicesRef.current.has(i)) {
                  processedFinalContentIndicesRef.current.add(i);
                  const finalChunk = res[0]?.transcript?.trim();
                  if (finalChunk && finalChunk !== lastFinalContentTranscriptRef.current) {
                    lastFinalContentTranscriptRef.current = finalChunk;
                    contentLastSpeechTimeRef.current = Date.now();

                    const currentContent = contentRef.current || '';
                    const updated = appendWithoutDuplicate(currentContent, finalChunk);
                    if (updated !== currentContent) {
                      contentRef.current = updated;
                      setContent(updated);
                    }
                  }
                }
              } else {
                interimText += res[0]?.transcript || '';
              }
            }

            const cleanInterim = interimText.trim();
            setContentInterimTranscript(cleanInterim);
            if (cleanInterim) {
              contentLastSpeechTimeRef.current = Date.now();
            }

            resetContentSilenceTimer(3500);
          };

          recognition.onerror = () => {
            shouldKeepContentListeningRef.current = false;
            safeAbortSpeechRecognition(speechRecognitionRef.current);
            speechRecognitionRef.current = null;
            setIsVoiceTyping(false);
            setContentInterimTranscript('');
          };

          recognition.onend = () => {
            shouldKeepContentListeningRef.current = false;
            speechRecognitionRef.current = null;
            setIsVoiceTyping(false);
            setContentInterimTranscript('');
          };

          speechRecognitionRef.current = recognition;
          recognition.start();
        } catch (e) {
          console.warn('Speech recognition start failed', e);
          setIsVoiceTyping(false);
        }
      };

      createAndRunContentRec();
    } catch (e) {
      console.warn('Speech recognition start failed', e);
      setIsVoiceTyping(false);
    }
  };

  // 2. AUDIO MEMO RECORDING
  const startAudioRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const url = URL.createObjectURL(audioBlob);
        setAudioBlobUrl(url);
        stream.getTracks().forEach((track) => track.stop());
      };

      recorder.start();
      setIsRecordingAudio(true);
    } catch (err) {
      console.warn('Microphone recording access denied:', err);
      openAndroidSettings('microphone');
    }
  };

  const stopAudioRecording = () => {
    if (mediaRecorderRef.current && isRecordingAudio) {
      mediaRecorderRef.current.stop();
      setIsRecordingAudio(false);
    }
  };

  // 3. CAMERA STREAM HELPERS, VIDEO RECORDING & REAR-CAMERA PHOTO CAPTURE
  const attachStreamToVideo = (el: HTMLVideoElement | null, stream: MediaStream | null) => {
    if (!el || !stream) return;
    try {
      el.muted = true;
      el.defaultMuted = true;
      el.playsInline = true;
      el.setAttribute('playsinline', 'true');
      el.setAttribute('webkit-playsinline', 'true');
      if (el.srcObject !== stream) {
        el.srcObject = stream;
      }
      const playPromise = el.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {});
      }
      requestAnimationFrame(() => {
        if (el.srcObject === stream && el.paused) {
          el.play().catch(() => {});
        }
      });
    } catch {
      // ignore play race condition
    }
  };

  const setVideoPreviewElement = (node: HTMLVideoElement | null) => {
    videoPreviewRef.current = node;
    if (node && videoStreamRef.current) {
      attachStreamToVideo(node, videoStreamRef.current);
    }
  };

  const setPhotoPreviewElement = (node: HTMLVideoElement | null) => {
    photoPreviewRef.current = node;
    if (node && photoStreamRef.current) {
      attachStreamToVideo(node, photoStreamRef.current);
    }
  };

  const openCameraVideoStream = async (facing: 'environment' | 'user'): Promise<MediaStream> => {
    await ensureNativeAndroidCameraPermission(false);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Camera not supported');
    }

    const candidates: MediaStreamConstraints[] = [
      {
        video: {
          facingMode: { exact: facing },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      },
      {
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      },
      {
        video: { facingMode: facing },
        audio: false,
      },
      {
        video: true,
        audio: false,
      },
    ];

    for (const constraints of candidates) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (stream) {
          markPermissionGranted('camera');
          return stream;
        }
      } catch {
        // try next fallback constraint
      }
    }

    throw new Error('Unable to access camera stream');
  };

  const stopVideoPreviewStream = () => {
    if (videoAudioStreamRef.current) {
      videoAudioStreamRef.current.getTracks().forEach((t) => t.stop());
      videoAudioStreamRef.current = null;
    }
    if (videoStreamRef.current) {
      videoStreamRef.current.getTracks().forEach((t) => t.stop());
      videoStreamRef.current = null;
    }
    if (videoPreviewRef.current) {
      videoPreviewRef.current.srcObject = null;
    }
    setIsVideoPreviewActive(false);
  };

  const startVideoLivePreview = async (
    overrideFacing?: 'environment' | 'user',
    silent = false
  ): Promise<MediaStream | null> => {
    const targetFacing = overrideFacing || videoFacingMode;
    setCameraErrorMsg(null);
    try {
      if (videoStreamRef.current) {
        videoStreamRef.current.getTracks().forEach((t) => t.stop());
        videoStreamRef.current = null;
      }
      const stream = await openCameraVideoStream(targetFacing);
      videoStreamRef.current = stream;
      setIsVideoPreviewActive(true);
      if (videoPreviewRef.current) {
        attachStreamToVideo(videoPreviewRef.current, stream);
      }
      return stream;
    } catch (err) {
      console.warn('Video live preview error:', err);
      setIsVideoPreviewActive(false);
      setCameraErrorMsg(
        isEn
          ? 'Camera access could not be started. Please check camera permission.'
          : 'دسترسی به پیش‌نمایش زنده دوربین ممکن نشد. لطفاً مجوز دوربین را بررسی کنید.'
      );
      if (!silent) {
        openAndroidSettings('camera');
      }
      return null;
    }
  };

  // Ensure live video preview element always attaches to the active stream after render
  useEffect(() => {
    if ((isRecordingVideo || isVideoPreviewActive) && videoPreviewRef.current && videoStreamRef.current) {
      attachStreamToVideo(videoPreviewRef.current, videoStreamRef.current);
    }
  }, [isRecordingVideo, isVideoPreviewActive, activeTab, videoFacingMode]);

  // Ensure rear-camera photo preview element attaches to the active photo stream after render
  useEffect(() => {
    if (isPhotoCameraActive && photoPreviewRef.current && photoStreamRef.current) {
      attachStreamToVideo(photoPreviewRef.current, photoStreamRef.current);
    }
  }, [isPhotoCameraActive, activeTab]);

  // Auto-start live camera preview when switching into Photo or Video tabs, and stop unused streams when leaving
  useEffect(() => {
    if (!isOpen) return;

    if (activeTab !== 'video' && !isRecordingVideo && videoStreamRef.current) {
      stopVideoPreviewStream();
    }
    if (activeTab !== 'photo' && photoStreamRef.current) {
      photoStreamRef.current.getTracks().forEach((t) => t.stop());
      photoStreamRef.current = null;
      if (photoPreviewRef.current) {
        photoPreviewRef.current.srcObject = null;
      }
      setIsPhotoCameraActive(false);
    }

    if (activeTab === 'photo' && !photoDataUrl && !photoStreamRef.current) {
      startRearPhotoCamera(true);
    } else if (activeTab === 'video' && !videoBlobUrl && !videoStreamRef.current && !isRecordingVideo) {
      startVideoLivePreview(videoFacingMode, true);
    }
  }, [isOpen, activeTab]);

  const startVideoRecording = async (overrideFacing?: 'environment' | 'user') => {
    const targetFacing = overrideFacing || videoFacingMode;
    setCameraErrorMsg(null);
    try {
      setVideoBlobUrl(null);

      // Reuse active live preview stream if already running for the same camera, otherwise open it now
      let videoStream = videoStreamRef.current;
      const hasLiveVideoTrack =
        videoStream &&
        videoStream.getVideoTracks().some((t) => t.readyState === 'live') &&
        (!overrideFacing || overrideFacing === videoFacingMode);

      if (!hasLiveVideoTrack || !videoStream) {
        if (videoStream) {
          videoStream.getTracks().forEach((t) => t.stop());
          videoStreamRef.current = null;
        }
        videoStream = await openCameraVideoStream(targetFacing);
        videoStreamRef.current = videoStream;
      }

      setIsVideoPreviewActive(true);
      setIsRecordingVideo(true);

      if (videoPreviewRef.current) {
        attachStreamToVideo(videoPreviewRef.current, videoStream);
      }

      // Optionally acquire microphone audio stream separately so camera live preview never fails or flickers
      if (videoAudioStreamRef.current) {
        videoAudioStreamRef.current.getTracks().forEach((t) => t.stop());
        videoAudioStreamRef.current = null;
      }
      let audioStream: MediaStream | null = null;
      try {
        await ensureNativeAndroidCameraPermission(true);
        audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        videoAudioStreamRef.current = audioStream;
      } catch (audioErr) {
        console.warn('Video recording proceeding without audio track:', audioErr);
      }

      const combinedTracks: MediaStreamTrack[] = [
        ...videoStream.getVideoTracks(),
        ...(audioStream ? audioStream.getAudioTracks() : []),
      ];
      const recordingStream = new MediaStream(combinedTracks);

      const mimeCandidates = [
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8',
        'video/webm',
        'video/mp4',
      ];
      let selectedMime = '';
      if (typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function') {
        for (const candidate of mimeCandidates) {
          if (MediaRecorder.isTypeSupported(candidate)) {
            selectedMime = candidate;
            break;
          }
        }
      }

      videoChunksRef.current = [];
      let recorder: MediaRecorder;
      try {
        recorder = selectedMime
          ? new MediaRecorder(recordingStream, { mimeType: selectedMime })
          : new MediaRecorder(recordingStream);
      } catch {
        // Fallback to video-only stream if combining audio track was rejected by MediaRecorder
        recorder = new MediaRecorder(videoStream);
      }

      videoMediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) videoChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const finalMime = recorder.mimeType || selectedMime || 'video/webm';
        const videoBlob = new Blob(videoChunksRef.current, { type: finalMime });
        const url = URL.createObjectURL(videoBlob);
        setVideoBlobUrl(url);

        if (videoAudioStreamRef.current) {
          videoAudioStreamRef.current.getTracks().forEach((t) => t.stop());
          videoAudioStreamRef.current = null;
        }
        if (videoStreamRef.current) {
          videoStreamRef.current.getTracks().forEach((t) => t.stop());
          videoStreamRef.current = null;
        }
        if (videoPreviewRef.current) {
          videoPreviewRef.current.srcObject = null;
        }
        setIsVideoPreviewActive(false);
        setIsRecordingVideo(false);
      };

      recorder.start(250);
    } catch (err) {
      console.warn('Video recording access denied:', err);
      setIsRecordingVideo(false);
      setCameraErrorMsg(
        isEn
          ? 'Could not start video recording. Please check camera permission.'
          : 'شروع فیلم‌برداری ممکن نشد. لطفاً دسترسی دوربین را بررسی کنید.'
      );
      openAndroidSettings('camera');
    }
  };

  const stopVideoRecording = () => {
    if (videoMediaRecorderRef.current && isRecordingVideo) {
      try {
        if (videoMediaRecorderRef.current.state !== 'inactive') {
          videoMediaRecorderRef.current.stop();
        }
      } catch {
        // ignore
      }
      setIsRecordingVideo(false);
      setIsVideoPreviewActive(false);
    }
  };

  const toggleVideoCameraFacing = async () => {
    const nextFacing: 'environment' | 'user' = videoFacingMode === 'environment' ? 'user' : 'environment';
    setVideoFacingMode(nextFacing);
    if (isRecordingVideo) {
      // Restart video recording smoothly with the newly selected camera
      if (videoMediaRecorderRef.current) {
        videoMediaRecorderRef.current.onstop = null;
        try {
          if (videoMediaRecorderRef.current.state !== 'inactive') {
            videoMediaRecorderRef.current.stop();
          }
        } catch {
          // ignore
        }
      }
      await startVideoRecording(nextFacing);
    } else {
      setVideoBlobUrl(null);
      await startVideoLivePreview(nextFacing, true);
    }
  };

  // 3B. PHOTO CAPTURE (Strictly Rear Camera Only - 'environment')
  const startRearPhotoCamera = async (silent = false) => {
    setCameraErrorMsg(null);
    try {
      if (photoStreamRef.current) {
        photoStreamRef.current.getTracks().forEach((t) => t.stop());
        photoStreamRef.current = null;
      }
      const stream = await openCameraVideoStream('environment');
      photoStreamRef.current = stream;
      setPhotoDataUrl(null);
      setIsPhotoCameraActive(true);
      if (photoPreviewRef.current) {
        attachStreamToVideo(photoPreviewRef.current, stream);
      }
    } catch (err) {
      console.warn('Rear camera photo access denied:', err);
      setIsPhotoCameraActive(false);
      setCameraErrorMsg(
        isEn
          ? 'Rear camera preview could not be started. Please check camera permission.'
          : 'دسترسی به پیش‌نمایش دوربین پشتی ممکن نشد. لطفاً مجوز دوربین را بررسی کنید.'
      );
      if (!silent) {
        openAndroidSettings('camera');
      }
    }
  };

  const stopRearPhotoCamera = () => {
    if (photoStreamRef.current) {
      photoStreamRef.current.getTracks().forEach((t) => t.stop());
      photoStreamRef.current = null;
    }
    if (photoPreviewRef.current) {
      photoPreviewRef.current.srcObject = null;
    }
    setIsPhotoCameraActive(false);
  };

  const capturePhotoFromRearCamera = () => {
    const videoEl = photoPreviewRef.current;
    if (!videoEl) return;
    const width = videoEl.videoWidth || videoEl.clientWidth || 1280;
    const height = videoEl.videoHeight || videoEl.clientHeight || 720;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const ctx = tempCanvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(videoEl, 0, 0, tempCanvas.width, tempCanvas.height);
    const dataUrl = tempCanvas.toDataURL('image/jpeg', 0.88);
    setPhotoDataUrl(dataUrl);
    stopRearPhotoCamera();
  };

  // 4. DRAWING CANVAS LOGIC WITH SAMSUNG S PEN / STYLUS SUPPORT
  const initCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#1c1917'; // stone-900 background
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };

  useEffect(() => {
    if (activeTab === 'sketch' && canvasRef.current) {
      initCanvas();
    }
  }, [activeTab]);

  // Handle Samsung S Pen & Stylus Pointer Events
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Palm Rejection: If stylus/pen is present or touched, reject touch inputs from palm/fingers
    const isPen = e.pointerType === 'pen';
    setIsStylusActive(isPen);

    // If Samsung S Pen eraser button is held (buttons === 32 or button === 5)
    const isEraserButton = e.buttons === 32 || (e as any).button === 5;
    const currentMode = isEraserButton ? 'eraser' : penMode;

    const canvas = canvasRef.current;
    if (!canvas) return;

    // Capture pointer for smooth drawing outside canvas boundaries
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Ignore
    }

    setIsDrawing(true);
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    lastPointRef.current = { x, y };

    const pressure = e.pressure && e.pressure > 0 ? e.pressure : 0.5;
    setCurrentPressure(pressure);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.beginPath();
    ctx.moveTo(x, y);

    if (currentMode === 'eraser') {
      ctx.strokeStyle = '#1c1917'; // Canvas background color
      ctx.lineWidth = penSize * 5;
    } else if (currentMode === 'highlighter') {
      ctx.strokeStyle = penColor + '66'; // Translucent highlighter
      ctx.lineWidth = penSize * 4;
    } else {
      // Natural S Pen pressure-sensitive line width
      const dynamicWidth = isPen ? Math.max(1, penSize * pressure * 2.2) : penSize;
      ctx.strokeStyle = penColor;
      ctx.lineWidth = dynamicWidth;
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineTo(x + 0.1, y + 0.1);
    ctx.stroke();
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const isPen = e.pointerType === 'pen';
    setIsStylusActive(isPen);

    const isEraserButton = e.buttons === 32 || (e as any).button === 5;
    const currentMode = isEraserButton ? 'eraser' : penMode;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    const pressure = e.pressure && e.pressure > 0 ? e.pressure : 0.5;
    setCurrentPressure(pressure);

    ctx.beginPath();
    if (lastPointRef.current) {
      ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
    } else {
      ctx.moveTo(x, y);
    }

    if (currentMode === 'eraser') {
      ctx.strokeStyle = '#1c1917';
      ctx.lineWidth = penSize * 5;
    } else if (currentMode === 'highlighter') {
      ctx.strokeStyle = penColor + '66';
      ctx.lineWidth = penSize * 4;
    } else {
      // Pressure-sensitive line width with smooth scaling
      const dynamicWidth = isPen ? Math.max(1, penSize * pressure * 2.2) : penSize;
      ctx.strokeStyle = penColor;
      ctx.lineWidth = dynamicWidth;
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineTo(x, y);
    ctx.stroke();

    lastPointRef.current = { x, y };
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    setIsDrawing(false);
    lastPointRef.current = null;

    const canvas = canvasRef.current;
    if (canvas) {
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore
      }
      setDrawingDataUrl(canvas.toDataURL('image/png'));
    }
  };

  const clearCanvas = () => {
    initCanvas();
    setDrawingDataUrl(null);
  };

  // Submit idea (and optional Reminder)
  const handleSave = async () => {
    if (!title.trim()) {
      setShowValidationModal(true);
      return;
    }

    setValidationError(null);
    const finalTitle = title.trim();

    let reminderPayload: Omit<Reminder, 'id' | 'createdAt' | 'status' | 'postponeCount'> | null = null;
    let dueTs: number | undefined = undefined;

    if (enableReminder) {
      requestNotificationPermission().catch(() => {});
      dueTs = calculateDueTimestamp();
      reminderPayload = {
        title: isEn ? `💡 Idea: ${finalTitle}` : `💡 ایده: ${finalTitle}`,
        description: content.trim() || undefined,
        category,
        priority,
        priorityLevel,
        dueTimestamp: dueTs,
        imageUrl: photoDataUrl || drawingDataUrl || undefined,
        ringTune: category,
        voiceReadAloud: true,
        recurrence: recurrence !== 'none' ? recurrence : undefined,
        recurrenceInterval: recurrence === 'hourly' ? recurrenceInterval : undefined,
        recurrenceCount: recurrence !== 'none' && recurrenceCount && recurrenceCount > 0 ? recurrenceCount : undefined,
        recurrenceDaysOfWeek: recurrence === 'weekly' ? recurrenceDaysOfWeek : undefined,
        recurrenceCustomDates: recurrence === 'custom_dates' ? recurrenceCustomDates : undefined,
        sourceApp: 'manual',
      };
    }

    const ideaPayload: Omit<IdeaNote, 'id' | 'createdAt'> = {
      title: finalTitle,
      content: content.trim(),
      category,
      audioRecordUrl: audioBlobUrl || undefined,
      videoRecordUrl: videoBlobUrl || undefined,
      photoDataUrl: photoDataUrl || undefined,
      drawingDataUrl: drawingDataUrl || undefined,
      googleSynced: syncWithGoogle && !!googleToken,
      linkedReminderId: enableReminder ? editingIdea?.linkedReminderId : undefined,
      reminderDueTimestamp: enableReminder ? dueTs : undefined,
      reminderPriority: enableReminder ? priority : undefined,
      reminderPriorityLevel: enableReminder ? priorityLevel : undefined,
      reminderRecurrence: enableReminder ? recurrence : undefined,
      reminderRecurrenceInterval: enableReminder && recurrence === 'hourly' ? recurrenceInterval : undefined,
      reminderRecurrenceCount: enableReminder && recurrence !== 'none' ? recurrenceCount : undefined,
      reminderRecurrenceDaysOfWeek: enableReminder && recurrence === 'weekly' ? recurrenceDaysOfWeek : undefined,
      reminderRecurrenceCustomDates: enableReminder && recurrence === 'custom_dates' ? recurrenceCustomDates : undefined,
    };

    if (editingIdea && onUpdateIdea) {
      onUpdateIdea(editingIdea.id, ideaPayload);
    }
    onSaveIdea(ideaPayload, reminderPayload);

    // Sync with Google Tasks if enabled
    if (syncWithGoogle && googleToken) {
      try {
        await syncToGoogleTasks({ title: `[ایده] ${finalTitle}`, description: content }, googleToken);
      } catch (err) {
        console.warn('Google tasks sync failed for idea:', err);
      }
    }

    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          className="fixed inset-0 z-50 flex flex-col justify-end sm:justify-center items-center p-0 sm:p-4 bg-black/80 backdrop-blur-sm overflow-hidden"
          style={{ height: viewportHeight ? `${viewportHeight}px` : '100dvh' }}
        >
          <motion.div
            id="idea-capture-modal-panel"
            initial={{ y: '100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            className="w-full max-w-2xl bg-stone-900 border border-stone-800 rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden"
            style={{ maxHeight: viewportHeight ? `${viewportHeight}px` : '92dvh' }}
            dir={isEn ? 'ltr' : 'rtl'}
          >
        {/* Header */}
        <div className="px-2.5 sm:px-5 py-3.5 border-b border-stone-800 flex items-center justify-between bg-stone-900/90">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <div className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
              <Lightbulb className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-base sm:text-lg text-white">
              {editingIdea 
                ? (isEn ? 'Edit Idea' : 'ویرایش ایده') 
                : (isEn ? 'Capture Idea & Thoughts' : 'ثبت ایده و افکار لحظه‌ای')}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-stone-400 hover:text-white hover:bg-stone-800 transition-colors cursor-pointer"
            title={isEn ? 'Close' : 'بستن'}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content body */}
        <div className="flex-1 overflow-y-auto px-2.5 py-4 sm:p-5 space-y-4">
          {/* Required Field Validation Alert Banner */}
          {validationError && (
            <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs font-bold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{validationError}</span>
            </div>
          )}

          {/* Primary Title Field — Distinct & First */}
          <div className="p-3.5 sm:p-4 rounded-2xl bg-gradient-to-br from-indigo-950/55 via-stone-900/95 to-stone-950 border-2 border-indigo-500/55 shadow-lg shadow-indigo-500/10 space-y-2.5">
            <div className="flex items-center justify-between flex-wrap gap-1.5">
              <label className="text-sm sm:text-base font-black text-white tracking-tight flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)] shrink-0" />
                <span>{isEn ? 'Idea Title' : 'عنوان ایده یا فکر'}</span>
                <span className="text-amber-400 font-black text-base">*</span>
              </label>
              {isTitleVoiceTyping && (
                <span className="text-[11px] font-bold text-indigo-300">
                  {titleInterimTranscript ? `«${titleInterimTranscript}»` : (isEn ? 'Listening (stops in 5s)...' : 'منتظر صوت (توقف با ۵ ثانیه سکوت)...')}
                </span>
              )}
            </div>
            <div className="relative flex items-center">
              <input
                type="text"
                placeholder={isEn ? 'e.g. Marketing campaign, Redesign idea...' : 'مثلاً: ایده راه‌اندازی کمپین بازاریابی، طراحی مجدد...'}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className={`w-full ${isEn ? 'pr-13 pl-4' : 'pl-13 pr-4'} py-3.5 rounded-2xl bg-stone-950 border-2 border-indigo-400/70 focus:border-amber-400 ring-2 ring-indigo-500/15 focus:ring-amber-400/25 text-white placeholder-stone-400 text-base sm:text-lg font-extrabold outline-none transition-all shadow-inner`}
              />
              <button
                type="button"
                onClick={() => toggleTitleVoiceTyping()}
                className={`absolute ${isEn ? 'right-2' : 'left-2'} w-10 h-10 rounded-xl flex items-center justify-center transition-all cursor-pointer ` + (isTitleVoiceTyping ? 'bg-rose-500 text-white animate-pulse shadow-md shadow-rose-500/30' : 'bg-indigo-500/20 hover:bg-indigo-500/35 text-indigo-300 hover:text-white border border-indigo-400/40')}
                title={isTitleVoiceTyping ? (isEn ? 'Stop voice typing' : 'توقف ضبط گفتار عنوان') : (isEn ? 'Voice input' : 'تایپ صوتی عنوان ایده')}
              >
                {isTitleVoiceTyping ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>
            </div>
            {voiceErrorMsg && (
              <div className="p-2 rounded-xl bg-indigo-500/15 border border-indigo-500/40 text-indigo-300 text-xs flex items-center gap-1.5 animate-in fade-in">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 text-indigo-400" />
                <span>{voiceErrorMsg}</span>
              </div>
            )}
          </div>

          {/* Category Tabs (similar to Occasion Types) */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-stone-300 block">
              {isEn ? 'Idea Category' : 'دسته‌بندی ایده'}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {([
                {
                  id: 'work' as Category,
                  labelFa: 'کاری',
                  labelEn: 'Work',
                  icon: Briefcase,
                  activeClass: 'bg-sky-500/20 border-sky-500 text-sky-300 shadow-sm shadow-sky-500/20',
                },
                {
                  id: 'family' as Category,
                  labelFa: 'خانواده',
                  labelEn: 'Family',
                  icon: Heart,
                  activeClass: 'bg-rose-500/20 border-rose-500 text-rose-300 shadow-sm shadow-rose-500/20',
                },
                {
                  id: 'other' as Category,
                  labelFa: 'شخصی / سایر',
                  labelEn: 'Personal / Other',
                  icon: Tag,
                  activeClass: 'bg-indigo-500/20 border-indigo-500 text-indigo-300 shadow-sm shadow-indigo-500/20',
                },
              ]).map((cat) => {
                const IconComp = cat.icon;
                const isSelected = category === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setCategory(cat.id)}
                    className={`flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                      isSelected
                        ? cat.activeClass
                        : 'bg-stone-950 border-stone-800 text-stone-400 hover:text-stone-200 hover:border-stone-700'
                    }`}
                  >
                    <IconComp className="w-4 h-4 shrink-0" />
                    <span className="truncate">{isEn ? cat.labelEn : cat.labelFa}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Mode Switch Tabs - Only icons with header "امکانات ورود" */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-stone-300 block">
              {isEn ? 'Input options' : 'امکانات ورود'}
            </label>
            <div className="flex bg-stone-950 p-1 rounded-xl border border-stone-800">
              <button
                type="button"
                onClick={() => setActiveTab('text')}
                className={`flex-1 flex items-center justify-center py-2.5 rounded-lg transition-all cursor-pointer ${
                  activeTab === 'text' ? 'bg-indigo-500 text-white' : 'text-stone-400 hover:text-white hover:bg-stone-900'
                }`}
                title={isEn ? 'Text & Voice' : 'متن و تایپ صوتی'}
                aria-label={isEn ? 'Text & Voice' : 'متن و تایپ صوتی'}
              >
                <FileText className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('voice')}
                className={`flex-1 flex items-center justify-center py-2.5 rounded-lg transition-all cursor-pointer ${
                  activeTab === 'voice' ? 'bg-indigo-500 text-white' : 'text-stone-400 hover:text-white hover:bg-stone-900'
                }`}
                title={isEn ? 'Voice Memo' : 'ضبط صدا'}
                aria-label={isEn ? 'Voice Memo' : 'ضبط صدا'}
              >
                <Mic className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('photo')}
                className={`flex-1 flex items-center justify-center py-2.5 rounded-lg transition-all cursor-pointer ${
                  activeTab === 'photo' ? 'bg-indigo-500 text-white' : 'text-stone-400 hover:text-white hover:bg-stone-900'
                }`}
                title={isEn ? 'Take Photo (Rear Camera)' : 'عکس‌برداری (دوربین پشتی)'}
                aria-label={isEn ? 'Take Photo (Rear Camera)' : 'عکس‌برداری (دوربین پشتی)'}
              >
                <Camera className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('video')}
                className={`flex-1 flex items-center justify-center py-2.5 rounded-lg transition-all cursor-pointer ${
                  activeTab === 'video' ? 'bg-indigo-500 text-white' : 'text-stone-400 hover:text-white hover:bg-stone-900'
                }`}
                title={isEn ? 'Video' : 'ضبط ویدیو'}
                aria-label={isEn ? 'Video' : 'ضبط ویدیو'}
              >
                <Video className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('sketch')}
                className={`flex-1 flex items-center justify-center py-2.5 rounded-lg transition-all cursor-pointer ${
                  activeTab === 'sketch' ? 'bg-indigo-500 text-white' : 'text-stone-400 hover:text-white hover:bg-stone-900'
                }`}
                title={isEn ? 'Sketch' : 'رسم با قلم'}
                aria-label={isEn ? 'Sketch' : 'رسم با قلم'}
              >
                <PenTool className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* TAB 1: TEXT & VOICE TYPING */}
          {activeTab === 'text' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-stone-400">
                  {isEn ? 'Idea & notes description:' : 'توضیحات ایده و افکار:'}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleVoiceTyping()}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                      isVoiceTyping
                        ? 'bg-rose-500 text-white animate-pulse'
                        : 'bg-stone-800 hover:bg-stone-700 text-stone-300'
                    }`}
                  >
                    {isVoiceTyping ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5 text-indigo-400" />}
                    <span>
                      {isVoiceTyping ? (
                        contentInterimTranscript ? (
                          <span className="text-indigo-200 font-medium">«{contentInterimTranscript}»</span>
                        ) : (
                          isEn ? 'Waiting (stops in 5s)' : 'منتظر صوت (خاموشی در ۵ ثانیه)'
                        )
                      ) : (
                        isEn ? 'Voice Typing' : 'شروع تایپ صوتی'
                      )}
                    </span>
                  </button>
                </div>
              </div>
              <textarea
                rows={5}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={isEn ? 'Write your thoughts, goals, or details here, or tap voice typing...' : 'افکار، اهداف یا جزئیات ایده‌تان را اینجا بنویسید یا دکمه تایپ صوتی را لمس کنید...'}
                className="w-full px-3.5 py-2.5 rounded-xl bg-stone-950 border border-stone-800 text-stone-100 text-sm focus:border-indigo-500 outline-none leading-relaxed"
              />
            </div>
          )}

          {/* TAB 2: AUDIO RECORDING */}
          {activeTab === 'voice' && (
            <div className="p-4 rounded-xl bg-stone-950 border border-stone-800 flex flex-col items-center justify-center text-center space-y-4">
              <p className="text-xs text-stone-400">
                ایده صوتی خود را ضبط کنید تا بعداً با لمس دکمه پخش به آن گوش دهید:
              </p>

              {!isRecordingAudio ? (
                <button
                  type="button"
                  onClick={startAudioRecording}
                  className="flex items-center gap-2 px-5 py-3 rounded-full bg-rose-600 hover:bg-rose-500 text-white font-bold text-sm shadow-lg shadow-rose-600/30 transition-all hover:scale-105"
                >
                  <Mic className="w-5 h-5" />
                  <span>شروع ضبط صوت</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopAudioRecording}
                  className="flex items-center gap-2 px-5 py-3 rounded-full bg-indigo-500 hover:bg-indigo-400 text-white font-black text-sm animate-pulse shadow-lg"
                >
                  <Square className="w-4 h-4 fill-white" />
                  <span>توقف و ذخیره صدا</span>
                </button>
              )}

              {audioBlobUrl && (
                <div className="w-full pt-2 flex flex-col items-center gap-2 border-t border-stone-800">
                  <span className="text-xs text-emerald-400 flex items-center gap-1">
                    <Check className="w-4 h-4" /> فایل صوتی با موفقیت ضبط شد
                  </span>
                  <audio controls src={audioBlobUrl} className="w-full max-w-md h-10 rounded-lg" />
                </div>
              )}
            </div>
          )}

          {/* TAB 2B: REAR-CAMERA-ONLY PHOTO CAPTURE */}
          {activeTab === 'photo' && (
            <div className="p-4 rounded-xl bg-stone-950 border border-stone-800 flex flex-col items-center justify-center space-y-3">
              <div className="w-full flex items-center justify-between text-xs text-stone-400 px-1">
                <span className="flex items-center gap-1.5 font-bold text-indigo-300">
                  <Camera className="w-4 h-4" />
                  <span>{isEn ? 'Photo Capture (Rear Camera Only)' : 'عکس‌برداری ایده (فقط با دوربین پشتی)'}</span>
                </span>
                {photoDataUrl && !isPhotoCameraActive && (
                  <button
                    type="button"
                    onClick={() => {
                      setPhotoDataUrl(null);
                      startRearPhotoCamera(true);
                    }}
                    className="flex items-center gap-1 text-rose-400 hover:text-rose-300 text-[11px] font-bold cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{isEn ? 'Delete Photo' : 'حذف عکس'}</span>
                  </button>
                )}
              </div>

              <div className="w-full max-w-sm aspect-video bg-black rounded-xl overflow-hidden border border-stone-800 relative flex items-center justify-center">
                <video
                  ref={setPhotoPreviewElement}
                  autoPlay
                  muted
                  playsInline
                  onLoadedMetadata={(e) => {
                    e.currentTarget.play().catch(() => {});
                  }}
                  onCanPlay={(e) => {
                    e.currentTarget.play().catch(() => {});
                  }}
                  className={`w-full h-full object-cover transition-opacity duration-150 ${
                    isPhotoCameraActive
                      ? 'opacity-100 relative z-10'
                      : 'opacity-0 pointer-events-none absolute inset-0'
                  }`}
                />

                {!isPhotoCameraActive && photoDataUrl && (
                  <img
                    src={photoDataUrl}
                    alt={isEn ? 'Captured idea photo' : 'عکس ثبت‌شده ایده'}
                    className="w-full h-full object-cover relative z-10"
                  />
                )}

                {!isPhotoCameraActive && !photoDataUrl && (
                  <div className="flex flex-col items-center text-stone-400 text-xs gap-2 p-4 text-center relative z-10">
                    <Camera className="w-8 h-8 text-indigo-400" />
                    <span>
                      {cameraErrorMsg ||
                        (isEn ? 'Rear camera preview' : 'پیش‌نمایش زنده دوربین پشتی جهت عکس‌برداری')}
                    </span>
                  </div>
                )}

                {isPhotoCameraActive && (
                  <div className="absolute top-2 right-2 z-20 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/65 border border-white/15 text-white text-[10px] font-bold">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span>{isEn ? 'Live Rear Camera' : 'پیش‌نمایش زنده دوربین پشتی'}</span>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-center gap-2.5 flex-wrap">
                {!isPhotoCameraActive ? (
                  <button
                    type="button"
                    onClick={() => startRearPhotoCamera(false)}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-bold text-xs shadow-md transition-all cursor-pointer"
                  >
                    <Camera className="w-4 h-4" />
                    <span>
                      {photoDataUrl
                        ? (isEn ? 'Retake Photo (Rear Camera)' : 'ثبت مجدد عکس با دوربین پشتی')
                        : (isEn ? 'Open Rear Camera' : 'باز کردن دوربین پشتی')}
                    </span>
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={capturePhotoFromRearCamera}
                      className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-stone-950 font-black text-xs shadow-lg shadow-emerald-500/25 transition-all cursor-pointer"
                    >
                      <Camera className="w-4 h-4" />
                      <span>{isEn ? 'Take Photo' : 'ثبت عکس'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={stopRearPhotoCamera}
                      className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-300 font-bold text-xs transition-all cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                      <span>{isEn ? 'Close Camera' : 'بستن دوربین'}</span>
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: VIDEO RECORDING (Live Viewfinder + Rear / Selfie Camera Switch) */}
          {activeTab === 'video' && (
            <div className="p-4 rounded-xl bg-stone-950 border border-stone-800 flex flex-col items-center justify-center space-y-3">
              {/* Camera Selection Header */}
              <div className="w-full max-w-sm flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-stone-300 flex items-center gap-1.5">
                  <Video className="w-4 h-4 text-indigo-400" />
                  <span>
                    {videoFacingMode === 'environment'
                      ? (isEn ? 'Rear Camera' : 'دوربین پشتی')
                      : (isEn ? 'Front Selfie Camera' : 'دوربین سلفی (جلو)')}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={toggleVideoCameraFacing}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-900 hover:bg-stone-800 border border-stone-700 text-indigo-300 text-xs font-bold transition-all cursor-pointer"
                  title={isEn ? 'Switch between rear and selfie camera' : 'تغییر بین دوربین پشتی و دوربین سلفی'}
                >
                  <SwitchCamera className="w-4 h-4" />
                  <span>
                    {videoFacingMode === 'environment'
                      ? (isEn ? 'Switch to Selfie' : 'تغییر به دوربین سلفی')
                      : (isEn ? 'Switch to Rear Camera' : 'تغییر به دوربین پشتی')}
                  </span>
                </button>
              </div>

              <div className="w-full max-w-sm aspect-video bg-black rounded-xl overflow-hidden border border-stone-800 relative flex items-center justify-center">
                {/* Keep live video element rendered without display:none so WebView always decodes live frames */}
                <video
                  ref={setVideoPreviewElement}
                  autoPlay
                  muted
                  playsInline
                  onLoadedMetadata={(e) => {
                    e.currentTarget.play().catch(() => {});
                  }}
                  onCanPlay={(e) => {
                    e.currentTarget.play().catch(() => {});
                  }}
                  className={`w-full h-full object-cover transition-opacity duration-150 ${
                    isRecordingVideo || isVideoPreviewActive
                      ? 'opacity-100 relative z-10'
                      : 'opacity-0 pointer-events-none absolute inset-0'
                  } ${videoFacingMode === 'user' ? 'scale-x-[-1]' : ''}`}
                />

                {!isRecordingVideo && !isVideoPreviewActive && videoBlobUrl && (
                  <video src={videoBlobUrl} controls playsInline className="w-full h-full object-cover relative z-10" />
                )}

                {!isRecordingVideo && !isVideoPreviewActive && !videoBlobUrl && (
                  <div className="flex flex-col items-center text-stone-400 text-xs gap-2 p-4 text-center relative z-10">
                    <Video className="w-8 h-8 text-indigo-400" />
                    <span>
                      {cameraErrorMsg ||
                        (isEn ? 'Live Video Preview' : 'پیش‌نمایش زنده ویدیو هنگام فیلم‌برداری')}
                    </span>
                  </div>
                )}

                {isRecordingVideo ? (
                  <div className="absolute top-2 right-2 z-20 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-600/90 text-white text-[10px] font-bold animate-pulse shadow-md">
                    <span className="w-2 h-2 rounded-full bg-white" />
                    <span>{isEn ? 'Recording Live' : 'در حال ضبط زنده'}</span>
                  </div>
                ) : (
                  isVideoPreviewActive && (
                    <div className="absolute top-2 right-2 z-20 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/65 border border-white/15 text-white text-[10px] font-bold">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span>{isEn ? 'Live Viewfinder Ready' : 'پیش‌نمایش زنده آماده ضبط'}</span>
                    </div>
                  )
                )}
              </div>

              <div className="flex items-center justify-center gap-2.5 flex-wrap">
                {!isRecordingVideo ? (
                  <>
                    {!isVideoPreviewActive && (
                      <button
                        type="button"
                        onClick={() => {
                          setVideoBlobUrl(null);
                          startVideoLivePreview(videoFacingMode, false);
                        }}
                        className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-200 font-bold text-xs transition-all cursor-pointer"
                      >
                        <Camera className="w-4 h-4 text-indigo-400" />
                        <span>{isEn ? 'Open Live Preview' : 'باز کردن پیش‌نمایش زنده'}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => startVideoRecording()}
                      className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-bold text-xs shadow-md transition-all cursor-pointer"
                    >
                      <Video className="w-4 h-4" />
                      <span>
                        {videoBlobUrl
                          ? (isEn ? 'Record New Video' : 'ضبط مجدد ویدیو')
                          : (isEn ? 'Start Video Recording' : 'شروع ضبط ویدیویی ایده')}
                      </span>
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={stopVideoRecording}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs shadow-md transition-all cursor-pointer"
                  >
                    <Square className="w-4 h-4 fill-white" />
                    <span>{isEn ? 'Stop Video Recording' : 'توقف و ذخیره ویدیو'}</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: DRAWING / SKETCH CANVAS WITH SAMSUNG S PEN SUPPORT */}
          {activeTab === 'sketch' && (
            <div className="space-y-3">
              {/* Samsung S Pen / Stylus Status Banner */}
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-stone-900 border border-stone-800 text-xs">
                <div className="flex items-center gap-2">
                  <div className={`p-1.5 rounded-lg flex items-center justify-center transition-colors ${
                    isStylusActive 
                      ? 'bg-sky-500/20 text-sky-400 border border-sky-500/40 shadow-sm' 
                      : 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'
                  }`}>
                    <PenTool className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5 font-bold text-white">
                      <span>سیستم قلم هوشمند S Pen سامسونگ</span>
                      {isStylusActive ? (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-500 text-stone-950 font-black animate-pulse">
                          S Pen فعال
                        </span>
                      ) : (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-stone-800 text-stone-400 font-medium">
                          پشتیبانی از قلم و لمس
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-stone-400 block">
                      پشتیبانی از حساسیت فشار قلم (Pressure Sensitivity)، رد کف دست (Palm Rejection) و دکمه پاک‌کن
                    </span>
                  </div>
                </div>

                {/* S Pen Pressure Meter */}
                {isStylusActive && (
                  <div className="hidden sm:flex flex-col items-end gap-1">
                    <span className="text-[10px] text-stone-400">میزان فشار S Pen:</span>
                    <div className="w-20 h-1.5 bg-stone-800 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-sky-400 transition-all duration-75"
                        style={{ width: `${Math.round(currentPressure * 100)}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Mode & Tools Selector (Pen, Highlighter, Eraser) */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-1.5 bg-stone-900 p-1 rounded-xl border border-stone-800 text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() => setPenMode('pen')}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-lg transition-all ${
                      penMode === 'pen'
                        ? 'bg-indigo-500 text-white font-bold shadow-sm'
                        : 'text-stone-400 hover:text-white'
                    }`}
                  >
                    <PenTool className="w-3.5 h-3.5" />
                    <span>قلم S Pen</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPenMode('highlighter')}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-lg transition-all ${
                      penMode === 'highlighter'
                        ? 'bg-indigo-500 text-white font-bold shadow-sm'
                        : 'text-stone-400 hover:text-white'
                    }`}
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>ماژیک هایلایت</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPenMode('eraser')}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-lg transition-all ${
                      penMode === 'eraser'
                        ? 'bg-indigo-500 text-white font-bold shadow-sm'
                        : 'text-stone-400 hover:text-white'
                    }`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>پاک‌کن</span>
                  </button>
                </div>

                {/* Color Palette (disabled in eraser mode) */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-stone-400">رنگ:</span>
                  {['#818CF8', '#38bdf8', '#34d399', '#f87171', '#a855f7', '#ffffff'].map((c) => (
                    <button
                      key={c}
                      type="button"
                      disabled={penMode === 'eraser'}
                      onClick={() => setPenColor(c)}
                      className={`w-6 h-6 rounded-full border-2 transition-transform ${
                        penColor === c && penMode !== 'eraser' ? 'scale-110 border-white' : 'border-transparent'
                      } ${penMode === 'eraser' ? 'opacity-40 cursor-not-allowed' : ''}`}
                      style={{ backgroundColor: c }}
                      title="انتخاب رنگ"
                    />
                  ))}
                </div>

                {/* Pen Size & Clear */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-stone-400">ضخامت:</span>
                  <input
                    type="range"
                    min="1"
                    max="16"
                    value={penSize}
                    onChange={(e) => setPenSize(Number(e.target.value))}
                    className="w-20 accent-indigo-500 cursor-pointer"
                  />
                  <button
                    type="button"
                    onClick={clearCanvas}
                    className="p-1.5 rounded-lg bg-stone-800 text-stone-400 hover:text-red-400 hover:bg-stone-700 text-xs transition-colors"
                    title="پاک کردن صفحه"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* S Pen Optimized HTML5 Canvas with Pointer Events */}
              <div className="relative border-2 border-stone-800 hover:border-stone-700 rounded-2xl overflow-hidden bg-stone-950 flex justify-center shadow-inner">
                <canvas
                  ref={canvasRef}
                  width={680}
                  height={320}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  onPointerLeave={handlePointerUp}
                  style={{ touchAction: 'none' }}
                  className="w-full h-64 cursor-crosshair touch-none select-none"
                />
              </div>
            </div>
          )}

          {/* Bottom Expandable Menu: Set Reminder with App Format (منوی بازشو تنظیم یادآور در پایین صفحه با فرمت موجود در اپ) */}
          <div className="pt-1.5">
            <button
              ref={reminderAccordionBtnRef}
              type="button"
              onClick={(e) => {
                const willOpen = !showReminderMenu;
                setShowReminderMenu(willOpen);
                if (willOpen) {
                  if (!enableReminder) {
                    setEnableReminder(true);
                  }
                  scrollAccordionHeaderIntoView(e.currentTarget, 38);
                }
              }}
              style={{ color: '#FFFFFF' }}
              className={`w-full min-h-[56px] sm:min-h-[62px] py-3 sm:py-3.5 px-4 sm:px-5 rounded-2xl border-2 text-sm sm:text-base font-black flex items-center justify-between transition-all cursor-pointer shadow-md !text-white ${
                showReminderMenu || enableReminder
                  ? 'bg-indigo-500/20 border-indigo-400/85 shadow-indigo-500/15 ring-2 ring-indigo-400/25'
                  : 'bg-indigo-500/12 hover:bg-indigo-500/20 border-indigo-400/55 hover:border-indigo-400/80 shadow-indigo-500/10'
              }`}
            >
              <span className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/25 border border-indigo-300/45 text-white flex items-center justify-center shrink-0 shadow-sm">
                  <Bell className={`w-5 h-5 ${enableReminder ? 'animate-pulse text-amber-300' : 'text-indigo-200'}`} />
                </div>
                <div className="text-start min-w-0">
                  <span style={{ color: '#FFFFFF' }} className="tracking-wide text-sm sm:text-base font-black !text-white block truncate">
                    {isEn ? 'Set Reminder for Idea' : 'تنظیم یادآور برای این ایده'}
                  </span>
                  <span className="text-[11px] text-indigo-200/90 font-medium block truncate">
                    {enableReminder
                      ? (isEn
                          ? `${GREGORIAN_MONTHS[selectedMonth - 1]} ${selectedDay}, ${selectedYear} • ${selectedHour.toString().padStart(2, '0')}:${selectedMinute.toString().padStart(2, '0')}`
                          : `${toPersianDigits(selectedDay)} ${PERSIAN_MONTHS[selectedMonth - 1]} ${toPersianDigits(selectedYear)} • ساعت ${toPersianDigits(selectedHour.toString().padStart(2, '0'))}:${toPersianDigits(selectedMinute.toString().padStart(2, '0'))}`)
                      : (isEn ? 'Tap to open clock, calendar & recurrence' : 'برای انتخاب ساعت، تاریخ و تکرار لمس کنید')}
                  </span>
                </div>
                {enableReminder && (
                  <span style={{ color: '#FFFFFF' }} className="text-[11px] px-2.5 py-0.5 rounded-full bg-indigo-500/40 !text-white border border-indigo-300/50 font-bold shrink-0">
                    {isEn ? 'Active' : 'فعال'}
                  </span>
                )}
              </span>
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center border shrink-0 transition-all ${
                showReminderMenu
                  ? 'bg-indigo-500/30 border-indigo-300/50 text-white rotate-180'
                  : 'bg-white/10 border-white/25 text-white'
              }`}>
                <ChevronDown className="w-4.5 h-4.5 transition-transform duration-200" />
              </div>
            </button>

            <AnimatePresence initial={false}>
              {showReminderMenu && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.24, ease: [0.32, 0.72, 0, 1] }}
                  className="overflow-hidden"
                >
                  <div className="mt-3 p-3.5 sm:p-4 rounded-2xl bg-stone-950/85 border-2 border-indigo-500/45 space-y-4 shadow-inner">
                    {/* Active Switch Row */}
                    <div className="flex items-center justify-between gap-3 pb-3 border-b border-stone-800">
                      <div className="flex items-center gap-2 min-w-0">
                        <Clock className="w-4 h-4 text-indigo-400 shrink-0" />
                        <span className="text-xs sm:text-sm font-black text-white">
                          {isEn ? 'Activate Alarm & Timeline Reminder' : 'فعال‌سازی آلارم و ثبت در خط زمانی یادآورها'}
                        </span>
                      </div>

                      <button
                        type="button"
                        role="switch"
                        aria-checked={enableReminder}
                        onClick={() => setEnableReminder(!enableReminder)}
                        className="flex items-center gap-2 shrink-0 cursor-pointer group focus:outline-none"
                      >
                        <span className={`text-xs font-black transition-colors ${
                          enableReminder ? 'text-indigo-300' : 'text-stone-400 group-hover:text-white'
                        }`}>
                          {enableReminder ? (isEn ? 'ON' : 'فعال') : (isEn ? 'OFF' : 'غیرفعال')}
                        </span>
                        <div
                          dir="ltr"
                          className={`w-13 h-7 rounded-full border-2 p-0.5 flex items-center transition-all duration-200 shadow-inner ${
                            enableReminder
                              ? 'bg-indigo-500 border-indigo-200 justify-end shadow-[0_0_12px_rgba(99,102,241,0.5)]'
                              : 'bg-stone-700 border-stone-400 justify-start hover:border-white'
                          }`}
                        >
                          <span
                            style={{ backgroundColor: '#FFFFFF' }}
                            className="w-5 h-5 rounded-full !bg-white shadow-md transition-all duration-200"
                          />
                        </div>
                      </button>
                    </div>

                    {/* Persian Jalali / Gregorian Date & Time Picker (Identical Format to ReminderForm) */}
                    <div className={`space-y-3 transition-opacity ${enableReminder ? 'opacity-100' : 'opacity-60'}`}>
                      {/* Time: Roller Clock */}
                      <div className="pb-2 border-b border-stone-800">
                        <div
                          dir="ltr"
                          className="grid grid-cols-2 gap-2 max-w-[210px] mx-auto px-1"
                        >
                          <WheelPicker
                            key={`idea-hour-${pickerSessionKey}`}
                            selectedValue={selectedHour}
                            onChange={(val) => {
                              setSelectedHour(val);
                              setEnableReminder(true);
                            }}
                            min={0}
                            max={23}
                            itemHeight={58}
                            visibleCount={3}
                            items={HOUR_WHEEL_ITEMS}
                          />

                          <WheelPicker
                            key={`idea-minute-${pickerSessionKey}`}
                            selectedValue={selectedMinute}
                            onChange={(val) => {
                              setSelectedMinute(val);
                              setEnableReminder(true);
                            }}
                            min={0}
                            max={59}
                            itemHeight={58}
                            visibleCount={3}
                            items={MINUTE_WHEEL_ITEMS}
                          />
                        </div>
                      </div>

                      {/* Quick Presets - 4 Buttons */}
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

                      {/* Day / Month / Year 3 Separated Independent Boxes */}
                      <div className="space-y-2.5 pt-1">
                        <div className="grid grid-cols-3 gap-2.5 text-xs">
                          <button
                            type="button"
                            onClick={() => setDateActiveTab(dateActiveTab === 'day' ? null : 'day')}
                            className={`py-2.5 px-2 rounded-2xl border-2 text-center font-black transition-all cursor-pointer flex flex-col items-center justify-center gap-0.5 shadow-sm ${
                              dateActiveTab === 'day'
                                ? 'bg-indigo-600 border-indigo-400 text-white shadow-lg shadow-indigo-600/25 ring-2 ring-indigo-400/30'
                                : 'bg-stone-950 border-stone-700/90 text-stone-200 hover:text-white hover:border-indigo-500/60 hover:bg-stone-900'
                            }`}
                          >
                            <span className={`text-[10px] font-bold ${dateActiveTab === 'day' ? 'text-indigo-100' : 'text-stone-400'}`}>{isEn ? 'Day' : 'روز'}</span>
                            <span className="text-sm sm:text-base font-black">{isEn ? selectedDay : toPersianDigits(selectedDay)}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setDateActiveTab(dateActiveTab === 'month' ? null : 'month')}
                            className={`py-2.5 px-2 rounded-2xl border-2 text-center font-black transition-all cursor-pointer flex flex-col items-center justify-center gap-0.5 shadow-sm ${
                              dateActiveTab === 'month'
                                ? 'bg-indigo-600 border-indigo-400 text-white shadow-lg shadow-indigo-600/25 ring-2 ring-indigo-400/30'
                                : 'bg-stone-950 border-stone-700/90 text-stone-200 hover:text-white hover:border-indigo-500/60 hover:bg-stone-900'
                            }`}
                          >
                            <span className={`text-[10px] font-bold ${dateActiveTab === 'month' ? 'text-indigo-100' : 'text-stone-400'}`}>{isEn ? 'Month' : 'ماه'}</span>
                            <span className="text-sm sm:text-base font-black truncate max-w-full">
                              {isEn ? GREGORIAN_MONTHS[selectedMonth - 1] : PERSIAN_MONTHS[selectedMonth - 1]}
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setDateActiveTab(dateActiveTab === 'year' ? null : 'year')}
                            className={`py-2.5 px-2 rounded-2xl border-2 text-center font-black transition-all cursor-pointer flex flex-col items-center justify-center gap-0.5 shadow-sm ${
                              dateActiveTab === 'year'
                                ? 'bg-indigo-600 border-indigo-400 text-white shadow-lg shadow-indigo-600/25 ring-2 ring-indigo-400/30'
                                : 'bg-stone-950 border-stone-700/90 text-stone-200 hover:text-white hover:border-indigo-500/60 hover:bg-stone-900'
                            }`}
                          >
                            <span className={`text-[10px] font-bold ${dateActiveTab === 'year' ? 'text-indigo-100' : 'text-stone-400'}`}>{isEn ? 'Year' : 'سال'}</span>
                            <span className="text-sm sm:text-base font-black">{isEn ? selectedYear : toPersianDigits(selectedYear)}</span>
                          </button>
                        </div>

                        {/* Day Grid */}
                        {dateActiveTab === 'day' && (() => {
                          const totalDays = isEn
                            ? getDaysInGregorianMonth(selectedYear, selectedMonth)
                            : getDaysInJalaliMonth(selectedYear, selectedMonth);
                          const startWeekday = isEn
                            ? getGregorianMondayWeekdayIndex(selectedYear, selectedMonth, 1)
                            : getJalaliWeekdayIndex(selectedYear, selectedMonth, 1);
                          const monthHolidays = getMonthOfficialHolidays(selectedYear, selectedMonth, language);
                          const selectedDayHoliday = getCalendarDayHolidayInfo(selectedYear, selectedMonth, selectedDay, language);

                          return (
                            <div className="p-2.5 sm:p-3 rounded-2xl bg-stone-950/90 border border-stone-800 space-y-2.5 animate-in fade-in">
                              <div className="grid grid-cols-7 gap-1 sm:gap-1.5 text-center border-b border-stone-800 pb-2">
                                {(isEn ? GREGORIAN_WEEKDAYS_MONDAY_FIRST : JALALI_WEEKDAYS_HEADER).map((w) => (
                                  <div
                                    key={w.index}
                                    className={`py-1 rounded-lg text-[10px] sm:text-xs font-extrabold ${
                                      w.isWeekend
                                        ? 'text-rose-400 bg-rose-500/10 border border-rose-500/25'
                                        : 'text-stone-300 bg-stone-900/70 border border-stone-800/70'
                                    }`}
                                    title={w.full}
                                  >
                                    {w.label}
                                  </div>
                                ))}
                              </div>

                              <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
                                {Array.from({ length: startWeekday }).map((_, idx) => (
                                  <div key={`empty-${idx}`} className="min-h-[34px] sm:min-h-[38px] rounded-xl bg-stone-900/20 border border-stone-900/40" />
                                ))}

                                {Array.from({ length: totalDays }, (_, i) => i + 1).map((d) => {
                                  const isSelected = selectedDay === d;
                                  const holidayInfo = getCalendarDayHolidayInfo(selectedYear, selectedMonth, d, language);

                                  return (
                                    <button
                                      key={d}
                                      type="button"
                                      onClick={() => {
                                        setSelectedDay(d);
                                        setEnableReminder(true);
                                        setDateActiveTab(null);
                                      }}
                                      className={`min-h-[34px] sm:min-h-[38px] rounded-xl text-xs sm:text-sm font-bold flex flex-col items-center justify-center transition-all cursor-pointer active:scale-95 relative border ${
                                        isSelected
                                          ? 'bg-indigo-600 border-indigo-400 text-white font-black shadow-md ring-2 ring-indigo-400'
                                          : holidayInfo.isOfficialHoliday
                                          ? 'bg-rose-500/20 border-rose-500/50 text-rose-300 hover:bg-rose-500/30 font-black'
                                          : holidayInfo.isWeekend
                                          ? 'bg-rose-500/10 border-rose-500/30 text-rose-400 hover:bg-rose-500/20'
                                          : 'bg-stone-900/80 hover:bg-stone-800 text-stone-300 hover:text-white border-stone-800/80'
                                      }`}
                                    >
                                      <span>{isEn ? d : toPersianDigits(d)}</span>
                                      {holidayInfo.isOfficialHoliday && !isSelected && (
                                        <span className="w-1 h-1 rounded-full bg-rose-400 mt-0.5" />
                                      )}
                                    </button>
                                  );
                                })}
                              </div>

                              {(selectedDayHoliday.occasionTitle || monthHolidays.length > 0) && (
                                <div className="pt-1.5 border-t border-stone-800/80 space-y-1">
                                  {selectedDayHoliday.occasionTitle && (
                                    <div className="text-[11px] text-rose-300 font-black">
                                      {isEn ? `Selected: ${selectedDayHoliday.occasionTitle}` : `مناسبت روز انتخابی: ${selectedDayHoliday.occasionTitle}`}
                                    </div>
                                  )}
                                  {monthHolidays.length > 0 && (
                                    <div className="p-2 rounded-xl bg-rose-500/10 border border-rose-500/25 text-[11px] text-rose-200 leading-relaxed">
                                      <span className="font-black text-rose-300">
                                        {isEn ? 'Official Holidays this month: ' : 'تعطیلات مناسبتی این ماه: '}
                                      </span>
                                      <span>
                                        {monthHolidays
                                          .map((h) =>
                                            isEn
                                              ? `${GREGORIAN_MONTHS[selectedMonth - 1]} ${h.day} (${h.title})`
                                              : `${toPersianDigits(h.day)} ${PERSIAN_MONTHS[selectedMonth - 1]} (${h.title})`
                                          )
                                          .join(isEn ? ' • ' : ' ، ')}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        {/* Month Grid */}
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
                                      setEnableReminder(true);
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

                        {/* Year Grid */}
                        {dateActiveTab === 'year' && (
                          <div className="p-2.5 rounded-2xl bg-stone-950/70 border border-stone-800 space-y-3 animate-in fade-in">
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
                                      setEnableReminder(true);
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

                            <div className="pt-2 border-t border-stone-800/80 space-y-1.5">
                              <span className="text-[11px] font-bold text-stone-300 block">
                                {isEn ? 'Years higher than 2046 (Type):' : 'سال‌های بالاتر از ۱۴۲۵ (به صورت تایپی):'}
                              </span>
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
                                      setEnableReminder(true);
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
                                      setEnableReminder(true);
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

                      {/* Priority Selection (همان فرمت اپ) */}
                      <div className="pt-2 border-t border-stone-800 space-y-2">
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

                        <div className="grid grid-cols-4 gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              handleSelectPriority(1);
                              setEnableReminder(true);
                            }}
                            className={`py-2 px-1 rounded-xl border text-center transition-all cursor-pointer active:scale-95 flex items-center justify-center ${
                              priorityLevel === 1
                                ? 'bg-stone-800 border-stone-600 text-white font-bold ring-1 ring-stone-500/40'
                                : 'bg-stone-900/60 border-stone-800 text-stone-400 hover:text-stone-200'
                            }`}
                          >
                            <span className="text-xs font-bold">{isEn ? 'Normal' : 'عادی'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              handleSelectPriority(3);
                              setEnableReminder(true);
                            }}
                            className={`py-2 px-1 rounded-xl border text-center transition-all cursor-pointer active:scale-95 flex items-center justify-center ${
                              priorityLevel === 3
                                ? 'bg-indigo-950/90 border-indigo-500 text-indigo-300 font-bold ring-1 ring-indigo-500/40'
                                : 'bg-stone-900/60 border-stone-800 text-stone-400 hover:text-stone-200'
                            }`}
                          >
                            <span className="text-xs font-bold">{isEn ? 'Medium' : 'متوسط'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              handleSelectPriority(4);
                              setEnableReminder(true);
                            }}
                            className={`py-2 px-1 rounded-xl border text-center transition-all cursor-pointer active:scale-95 flex items-center justify-center ${
                              priorityLevel === 4
                                ? 'bg-amber-950/90 border-amber-500 text-amber-300 font-bold ring-1 ring-amber-500/40'
                                : 'bg-stone-900/60 border-stone-800 text-stone-400 hover:text-stone-200'
                            }`}
                          >
                            <span className="text-xs font-bold">{isEn ? 'High' : 'مهم'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              handleSelectPriority(5);
                              setEnableReminder(true);
                            }}
                            className={`py-2 px-1 rounded-xl border text-center transition-all cursor-pointer active:scale-95 flex items-center justify-center ${
                              priorityLevel >= 5
                                ? 'bg-red-950/90 border-red-500 text-red-300 font-bold ring-1 ring-red-500/40'
                                : 'bg-stone-900/60 border-stone-800 text-stone-400 hover:text-stone-200'
                            }`}
                          >
                            <span className="text-xs font-bold">{isEn ? 'Urgent' : 'فوری'}</span>
                          </button>
                        </div>
                      </div>

                      {/* Recurrence Selection Section (همان فرمت اپ) */}
                      <div className="p-2.5 sm:p-3.5 rounded-2xl bg-stone-900/60 border border-stone-800 space-y-3">
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

                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {RECURRENCE_OPTIONS.filter((opt) => opt.id !== 'none').map((opt) => {
                            const isSelected = recurrence === opt.id;
                            return (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={() => {
                                  setEnableReminder(true);
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
                                    : 'bg-stone-950/70 border-stone-800 text-stone-400 hover:text-stone-200 hover:bg-stone-900'
                                }`}
                              >
                                <span className={`text-xs font-black ${isSelected ? 'text-indigo-400' : 'text-stone-300'}`}>
                                  {isEn ? opt.labelEn : opt.label}
                                </span>
                                {isSelected && <Check className="w-3.5 h-3.5 text-indigo-400" />}
                              </button>
                            );
                          })}

                          <div
                            onClick={() => {
                              setEnableReminder(true);
                              if (recurrence === 'none') {
                                setRecurrence('daily');
                              }
                              recurrenceCountInputRef.current?.focus();
                            }}
                            className={`p-2 rounded-xl border transition-all flex items-center justify-between gap-1.5 cursor-pointer ${
                              recurrenceCount && recurrenceCount > 0
                                ? 'bg-indigo-500/15 border-indigo-500/80 text-white shadow-md shadow-indigo-500/15 ring-1 ring-indigo-400/50'
                                : 'bg-stone-950/70 border-stone-800 text-stone-300 hover:border-indigo-500/50 hover:bg-stone-900'
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
                                setEnableReminder(true);
                                if (recurrence === 'none') {
                                  setRecurrence('daily');
                                }
                              }}
                              onChange={(e) => {
                                const val = parseInt(e.target.value, 10);
                                if (!isNaN(val) && val > 0) {
                                  setRecurrenceCount(val);
                                  setEnableReminder(true);
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

                        {recurrence === 'hourly' && (
                          <div className="p-3 rounded-xl bg-stone-950/80 border border-stone-800 space-y-2 animate-in fade-in">
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
                                        : 'bg-stone-900 text-stone-400 hover:text-white border border-stone-800'
                                    }`}
                                  >
                                    {isEn ? `${hours}h` : `${toPersianDigits(hours)}س`}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {recurrence === 'weekly' && (
                          <div className="p-3 rounded-xl bg-stone-950/80 border border-stone-800 space-y-2.5 animate-in fade-in">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-stone-300 font-bold">
                                {isEn ? 'Select Days of Week:' : 'انتخاب روزهای تکرار در هفته:'}
                              </span>
                            </div>
                            <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
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
                                        : 'bg-stone-900 text-stone-400 hover:text-stone-200 border border-stone-800'
                                    }`}
                                  >
                                    <span className="text-xs font-bold">{w.short}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {recurrence === 'custom_dates' && (
                          <div className="space-y-2 animate-in fade-in">
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
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Google Sync Option */}
          {googleToken && (
            <label className="flex items-center gap-2 pt-2 text-xs text-stone-300 cursor-pointer">
              <input
                type="checkbox"
                checked={syncWithGoogle}
                onChange={(e) => setSyncWithGoogle(e.target.checked)}
                className="rounded accent-indigo-500 w-4 h-4 cursor-pointer"
              />
              <span className="flex items-center gap-1.5">
                <Check className="w-4 h-4 text-sky-400" />
                {isEn ? 'Sync & Save to Google Tasks' : 'همگام‌سازی و ذخیره در Google Tasks'}
              </span>
            </label>
          )}
        </div>

        {/* Sticky Footer - Pinned directly above keyboard with min 48px buttons */}
        <div className="sticky bottom-0 z-20 shrink-0 px-3 sm:px-4 py-3 border-t border-stone-800 flex items-center justify-between bg-stone-900 shadow-2xl">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[48px] px-5 py-2.5 rounded-xl bg-stone-800 hover:bg-stone-700 active:scale-95 text-stone-300 hover:text-white text-xs sm:text-sm font-semibold transition-colors cursor-pointer flex items-center justify-center border border-stone-700/60"
          >
            {isEn ? 'Cancel' : 'انصراف'}
          </button>
          <button
            id="save-idea-submit-btn"
            type="button"
            onClick={handleSave}
            className="btn-brand-submit min-h-[48px] flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl text-xs sm:text-sm font-black shadow-lg shadow-[#FF8C00]/25 transition-all active:scale-95 cursor-pointer bg-[#FF8C00] hover:bg-[#FF9E1F] text-white"
          >
            <Check className="w-4 h-4 stroke-[3] text-white" />
            <span className="text-white font-black">
              {editingIdea 
                ? (isEn ? 'Save Changes' : 'ذخیره تغییرات') 
                : (isEn ? 'Save Idea' : 'ثبت ایده')}
            </span>
          </button>
        </div>
          </motion.div>

          {/* Pop-up alert for missing required fields per user request */}
          <ValidationAlertModal
            isOpen={showValidationModal}
            onClose={() => setShowValidationModal(false)}
            title={isEn ? 'Required Field Missing' : 'تکمیل فیلد اجباری'}
            fieldName={isEn ? 'Idea Title' : 'عنوان ایده'}
            language={language}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
};


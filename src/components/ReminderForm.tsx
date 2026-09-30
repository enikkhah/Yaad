import React, { useState, useEffect, useRef } from 'react';
import { Category, Priority, Reminder, RecurrenceType } from '../types';
import { 
  getJalaliComponents, 
  PERSIAN_MONTHS, 
  toPersianDigits, 
  jalaliToGregorian 
} from '../utils/jalali';
import { 
  RECURRENCE_OPTIONS, 
  PERSIAN_WEEK_DAYS, 
  HOURLY_INTERVALS 
} from '../utils/recurrence';
import { JalaliMultiDatePicker } from './JalaliMultiDatePicker';
import { parseSmsOrText } from '../utils/smsParser';
import { CameraCaptureModal } from './CameraCaptureModal';
import { requestSystemNotificationPermission } from '../utils/systemNotification';
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
  AlertCircle
} from 'lucide-react';
import { WheelPicker } from './WheelPicker';
import { AppLanguage, getT } from '../utils/i18n';
import { ValidationAlertModal } from './ValidationAlertModal';

interface ReminderFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (reminder: Omit<Reminder, 'id' | 'createdAt' | 'status' | 'postponeCount'>, syncGoogle?: boolean) => void;
  initialData?: Reminder | null;
  googleToken?: string | null;
  language?: AppLanguage;
}


// Browser Web Speech recognition interface
interface IWindow extends Window {
  webkitSpeechRecognition?: any;
  SpeechRecognition?: any;
}

export const ReminderForm: React.FC<ReminderFormProps> = ({
  isOpen,
  onClose,
  onSave,
  initialData,
  googleToken,
  language = 'fa',
}) => {
  const t = getT(language);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<Category>('work');
  const [priority, setPriority] = useState<Priority>('medium');
  const [imageUrl, setImageUrl] = useState<string | undefined>(undefined);
  const [useFlash, setUseFlash] = useState(true);
  const [voiceReadAloud, setVoiceReadAloud] = useState(true);
  const [ringTune, setRingTune] = useState<string>('work');
  const [syncWithGoogle, setSyncWithGoogle] = useState(!!googleToken);
  const [validationError, setValidationError] = useState<string | null>(null);


  // Persian date picker states
  const [selectedYear, setSelectedYear] = useState(1405);
  const [selectedMonth, setSelectedMonth] = useState(1);
  const [selectedDay, setSelectedDay] = useState(1);
  const [selectedHour, setSelectedHour] = useState(12);
  const [selectedMinute, setSelectedMinute] = useState(0);

  // Recurrence states (ساعتی، روزانه، هفتگی، ماهیانه، انتخاب از تقویم)
  const [recurrence, setRecurrence] = useState<RecurrenceType>('none');
  const [recurrenceInterval, setRecurrenceInterval] = useState<number>(1);
  const [recurrenceDaysOfWeek, setRecurrenceDaysOfWeek] = useState<number[]>([]);
  const [recurrenceCustomDates, setRecurrenceCustomDates] = useState<string[]>([]);

  // Speech to text states
  const [isListening, setIsListening] = useState(false);
  const [speechTranscript, setSpeechTranscript] = useState('');
  const recognitionRef = useRef<any>(null);

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

  // Sync state with initial data or defaults
  useEffect(() => {
    if (!isOpen) return;

    // Per user requirement: یادآورهای قبلی برای ادیت به تاریخ و ساعت زمان حال در دیفالت بیاید و بعد قابل تنظیم باشد
    // Initialize date and time to the upcoming moment (2 minutes ahead for new reminders to avoid past timestamps)
    const defaultTime = initialData ? Date.now() : Date.now() + 2 * 60000;
    const nowJalali = getJalaliComponents(defaultTime);
    setSelectedYear(nowJalali.year);
    setSelectedMonth(nowJalali.month);
    setSelectedDay(nowJalali.day);
    setSelectedHour(nowJalali.hour);
    setSelectedMinute(nowJalali.minute);

    if (initialData) {
      setTitle(initialData.title);
      setDescription(initialData.description || '');
      setCategory(initialData.category);
      setPriority(initialData.priority);
      setImageUrl(initialData.imageUrl);
      setUseFlash(initialData.useFlash);
      setVoiceReadAloud(initialData.voiceReadAloud);
      setRingTune(initialData.ringTune || initialData.category);
      // Load recurrence in edit mode (ایش موضوع در ادیت هم باشد)
      setRecurrence(initialData.recurrence || 'none');
      setRecurrenceInterval(initialData.recurrenceInterval || 1);
      setRecurrenceDaysOfWeek(initialData.recurrenceDaysOfWeek || []);
      setRecurrenceCustomDates(initialData.recurrenceCustomDates || []);
    } else {
      setTitle('');
      setDescription('');
      setCategory('work');
      setPriority('medium');
      setImageUrl(undefined);
      setUseFlash(true);
      setVoiceReadAloud(true);
      setRingTune('work');
      setRecurrence('none');
      setRecurrenceInterval(1);
      setRecurrenceDaysOfWeek([]);
      setRecurrenceCustomDates([]);
      // Voice input is disabled by default per user request, accessible via mic button next to title
    }

    return () => {
      stopVoiceListening();
    };
  }, [isOpen, initialData]);

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

  // Sync ringtune default to category
  const handleCategoryChange = (newCat: Category) => {
    setCategory(newCat);
    setRingTune(newCat);
  };

  // Web Speech recognition setup
  const startVoiceListening = () => {
    const win = window as unknown as IWindow;
    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (!SpeechRec) {
      console.warn('Speech recognition is not supported in this browser.');
      return;
    }

    try {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }

      const rec = new SpeechRec();
      rec.lang = 'fa-IR';
      rec.continuous = true;
      rec.interimResults = true;

      rec.onstart = () => {
        setIsListening(true);
      };

      rec.onresult = (event: any) => {
        let fullTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          fullTranscript += event.results[i][0].transcript;
        }
        setSpeechTranscript(fullTranscript);

        // Smartly fill title or parse speech
        if (fullTranscript.trim()) {
          const parsed = parseSmsOrText(fullTranscript);
          setTitle(parsed.title || fullTranscript.trim());
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
      };

      rec.onerror = (e: any) => {
        console.warn('Speech recognition error:', e.error);
        setIsListening(false);
      };

      rec.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = rec;
      rec.start();
    } catch (err) {
      console.warn('Failed to start speech recognition:', err);
      setIsListening(false);
    }
  };

  const stopVoiceListening = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Ignore
      }
      recognitionRef.current = null;
    }
    setIsListening(false);
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
    const j = getJalaliComponents(target);
    setSelectedYear(j.year);
    setSelectedMonth(j.month);
    setSelectedDay(j.day);
    setSelectedHour(j.hour);
    setSelectedMinute(j.minute);
  };

  const setTonight = () => {
    const now = new Date();
    now.setHours(20, 0, 0, 0);
    if (now.getTime() <= Date.now()) {
      now.setDate(now.getDate() + 1);
    }
    const j = getJalaliComponents(now.getTime());
    setSelectedYear(j.year);
    setSelectedMonth(j.month);
    setSelectedDay(j.day);
    setSelectedHour(20);
    setSelectedMinute(0);
  };

  const setTomorrowMorning = () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    const j = getJalaliComponents(tomorrow.getTime());
    setSelectedYear(j.year);
    setSelectedMonth(j.month);
    setSelectedDay(j.day);
    setSelectedHour(9);
    setSelectedMinute(0);
  };

  // Convert selected Persian date and time to Unix Timestamp
  const calculateDueTimestamp = (): number => {
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setShowValidationModal(true);
      return;
    }
    setValidationError(null);

    stopVoiceListening();

    // Proactively request notification permission on user submit gesture so system notifications work
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      requestSystemNotificationPermission().catch(() => {});
    }

    const dueTimestamp = calculateDueTimestamp();
    onSave(
      {
        title: title.trim(),
        description: description.trim() || undefined,
        category,
        priority,
        dueTimestamp,
        imageUrl,
        useFlash,
        ringTune,
        voiceReadAloud,
        recurrence: recurrence !== 'none' ? recurrence : undefined,
        recurrenceInterval: recurrence === 'hourly' ? recurrenceInterval : undefined,
        recurrenceDaysOfWeek: recurrence === 'weekly' ? recurrenceDaysOfWeek : undefined,
        recurrenceCustomDates: recurrence === 'custom_dates' ? recurrenceCustomDates : undefined,
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
      >
        <div 
          className="bg-stone-900 border border-stone-800 rounded-t-3xl sm:rounded-3xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col transition-all duration-150"
          style={{ maxHeight: viewportHeight ? `${viewportHeight}px` : '92dvh' }}
        >
          {/* Header */}
          <div className="px-2.5 sm:px-6 py-3.5 border-b border-stone-800 flex items-center justify-between bg-stone-950/60 sticky top-0 z-10 backdrop-blur shrink-0">
            <div className="flex items-center gap-2.5 sm:gap-3">
              <div className="p-1.5 sm:p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <Plus className="w-4.5 h-4.5 sm:w-5 sm:h-5" />
              </div>
              <h2 className="text-base sm:text-lg font-bold text-white">
                {initialData ? 'ویرایش یادآور' : 'ثبت سریع یادآور'}
              </h2>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsSmsImportOpen(true)}
                className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs rounded-xl bg-cyan-950/60 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-900/50 transition-colors"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>ورود از پیامک</span>
              </button>

              <button
                type="button"
                onClick={onClose}
                className="p-1.5 sm:p-2 rounded-full text-stone-400 hover:text-white hover:bg-stone-800"
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
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold text-stone-200 flex items-center gap-1">
                  <span>عنوان یادآور</span>
                  <span className="text-amber-400 font-black">*</span>
                </label>
                {isListening && (
                  <span className="text-[11px] font-bold text-amber-400 animate-pulse flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                    <span>درحال شنیدن صدای شما... (برای توقف کلیک کنید)</span>
                  </span>
                )}
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
                  placeholder="مثال: تحویل پروژه، تماس با پزشک، خرید نان..."
                  className={`w-full bg-stone-950 border rounded-2xl pr-4 pl-14 py-3.5 text-white placeholder-stone-500 focus:outline-none transition-all text-sm sm:text-base font-medium ${
                    isListening
                      ? 'border-amber-400 ring-2 ring-amber-400/20 shadow-lg shadow-amber-500/10'
                      : 'border-stone-700 focus:border-amber-500'
                  }`}
                />

                {/* Microphone Button Placed Directly Beside Title Input */}
                <button
                  type="button"
                  onClick={toggleListening}
                  className={`absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                    isListening
                      ? 'bg-amber-500 text-stone-950 shadow-lg shadow-amber-500/50 scale-105 animate-pulse'
                      : 'bg-stone-800/80 hover:bg-stone-700 text-stone-300 hover:text-amber-400 border border-stone-700'
                  }`}
                  title={isListening ? 'توقف تایپ صوتی' : 'شروع تایپ صوتی (تبدیل گفتار به متن)'}
                >
                  <Mic className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Description / Notes */}
            <div>
              <label className="block text-xs font-semibold text-stone-300 mb-1.5">
                توضیحات و جزئیات (اختیاری)
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="توضیحات تکمیلی، آدرس، شماره یا نکته مهم..."
                rows={2}
                className="w-full bg-stone-950 border border-stone-700 rounded-xl px-4 py-2.5 text-white placeholder-stone-500 focus:outline-none focus:border-amber-500 transition-colors text-xs resize-none"
              />
            </div>

            {/* Category: کار، خانواده، سایر with 3 Ring Tunes */}
            <div>
              <label className="block text-xs font-semibold text-stone-300 mb-2">
                تقسیم‌بندی یادآور
              </label>
              <div className="grid grid-cols-3 gap-2.5">
                {/* Work */}
                <button
                  type="button"
                  onClick={() => handleCategoryChange('work')}
                  className={`p-3 rounded-2xl border flex flex-col items-center gap-1.5 transition-all text-center ${
                    category === 'work'
                      ? 'bg-cyan-950/80 border-cyan-400 text-cyan-200 shadow-md shadow-cyan-950/50'
                      : 'bg-stone-950/60 border-stone-800 text-stone-400 hover:border-stone-700'
                  }`}
                >
                  <Briefcase className="w-5 h-5 text-cyan-400" />
                  <span className="text-xs font-bold">کار</span>
                </button>

                {/* Family */}
                <button
                  type="button"
                  onClick={() => handleCategoryChange('family')}
                  className={`p-3 rounded-2xl border flex flex-col items-center gap-1.5 transition-all text-center ${
                    category === 'family'
                      ? 'bg-rose-950/80 border-rose-400 text-rose-200 shadow-md shadow-rose-950/50'
                      : 'bg-stone-950/60 border-stone-800 text-stone-400 hover:border-stone-700'
                  }`}
                >
                  <Heart className="w-5 h-5 text-rose-400" />
                  <span className="text-xs font-bold">خانواده</span>
                </button>

                {/* Other */}
                <button
                  type="button"
                  onClick={() => handleCategoryChange('other')}
                  className={`p-3 rounded-2xl border flex flex-col items-center gap-1.5 transition-all text-center ${
                    category === 'other'
                      ? 'bg-emerald-950/80 border-emerald-400 text-emerald-200 shadow-md shadow-emerald-950/50'
                      : 'bg-stone-950/60 border-stone-800 text-stone-400 hover:border-stone-700'
                  }`}
                >
                  <Tag className="w-5 h-5 text-emerald-400" />
                  <span className="text-xs font-bold">سایر</span>
                </button>
              </div>

            </div>

            {/* Priorities: ۳ اولویت (بالا، متوسط، پایین) */}
            <div>
              <label className="block text-xs font-semibold text-stone-300 mb-2">
                اولویت یادآوری
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setPriority('high')}
                  className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all ${
                    priority === 'high'
                      ? 'bg-red-950/80 border-red-500 text-red-300 shadow-sm'
                      : 'bg-stone-950/50 border-stone-800 text-stone-400'
                  }`}
                >
                  بالا (فوری)
                </button>
                <button
                  type="button"
                  onClick={() => setPriority('medium')}
                  className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all ${
                    priority === 'medium'
                      ? 'bg-amber-950/80 border-amber-500 text-amber-300 shadow-sm'
                      : 'bg-stone-950/50 border-stone-800 text-stone-400'
                  }`}
                >
                  متوسط
                </button>
                <button
                  type="button"
                  onClick={() => setPriority('low')}
                  className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all ${
                    priority === 'low'
                      ? 'bg-blue-950/80 border-blue-500 text-blue-300 shadow-sm'
                      : 'bg-stone-950/50 border-stone-800 text-stone-400'
                  }`}
                >
                  پایین (عادی)
                </button>
              </div>
            </div>

            {/* Persian Jalali Date & Time Picker */}
            <div className="p-4 rounded-2xl bg-stone-950/60 border border-stone-800 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-amber-400">
                  <Calendar className="w-4 h-4" />
                  <span>تقویم و زمان فارسی (شمسی)</span>
                </div>
              </div>

              {/* Quick Presets */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => applyPreset(1)}
                  className="text-[11px] px-2.5 py-1 rounded-lg bg-teal-500/20 hover:bg-teal-500/30 text-teal-300 border border-teal-500/40 font-bold"
                  title="تست سریع آلارم برای ۱ دقیقه بعد"
                >
                  +۱ دقیقه (تست)
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset(5)}
                  className="text-[11px] px-2.5 py-1 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-300 border border-stone-700 font-bold"
                >
                  +۵ دقیقه
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset(10)}
                  className="text-[11px] px-2.5 py-1 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-300 border border-stone-700"
                >
                  +۱۰ دقیقه
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset(30)}
                  className="text-[11px] px-2.5 py-1 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-300 border border-stone-700"
                >
                  +۳۰ دقیقه
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset(60)}
                  className="text-[11px] px-2.5 py-1 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-300 border border-stone-700"
                >
                  +۱ ساعت
                </button>
                <button
                  type="button"
                  onClick={setTonight}
                  className="text-[11px] px-2.5 py-1 rounded-lg bg-stone-800 hover:bg-stone-700 text-amber-400 border border-stone-700"
                >
                  امشب ساعت ۲۰:۰۰
                </button>
                <button
                  type="button"
                  onClick={setTomorrowMorning}
                  className="text-[11px] px-2.5 py-1 rounded-lg bg-stone-800 hover:bg-stone-700 text-cyan-400 border border-stone-700"
                >
                  فردا ساعت ۹:۰۰
                </button>
              </div>

              {/* Selectors for Jalali Day / Month / Year */}
              <div className="grid grid-cols-3 gap-2 pt-1">
                {/* Day */}
                <div>
                  <label className="block text-[11px] text-stone-400 mb-1">روز</label>
                  <select
                    value={selectedDay}
                    onChange={(e) => setSelectedDay(parseInt(e.target.value, 10))}
                    className="w-full bg-stone-900 border border-stone-700 rounded-xl px-2 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                  >
                    {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                      <option key={d} value={d}>
                        {toPersianDigits(d)}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Month */}
                <div>
                  <label className="block text-[11px] text-stone-400 mb-1">ماه شمسی</label>
                  <select
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(parseInt(e.target.value, 10))}
                    className="w-full bg-stone-900 border border-stone-700 rounded-xl px-2 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                  >
                    {PERSIAN_MONTHS.map((m, idx) => (
                      <option key={m} value={idx + 1}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Year */}
                <div>
                  <label className="block text-[11px] text-stone-400 mb-1">سال</label>
                  <select
                    value={selectedYear}
                    onChange={(e) => setSelectedYear(parseInt(e.target.value, 10))}
                    className="w-full bg-stone-900 border border-stone-700 rounded-xl px-2 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                  >
                    {[1404, 1405, 1406, 1407].map((y) => (
                      <option key={y} value={y}>
                        {toPersianDigits(y)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Time: Clean minimal setting, Hour on Left, Minute on Right, with at least 1cm margin from sides */}
              <div className="pt-3 border-t border-stone-800">
                <div 
                  dir="ltr"
                  className="grid grid-cols-2 gap-3 sm:gap-4 max-w-[260px] sm:max-w-[280px] mx-auto px-2"
                >
                  {/* Left: Hour Picker */}
                  <WheelPicker
                    label={language === 'en' ? 'Hour' : 'ساعت'}
                    selectedValue={selectedHour}
                    onChange={(val) => setSelectedHour(val)}
                    min={0}
                    max={23}
                    itemHeight={80}
                    items={Array.from({ length: 24 }, (_, i) => ({
                      value: i,
                      label: i.toString().padStart(2, '0'),
                    }))}
                  />

                  {/* Right: Minute Picker */}
                  <WheelPicker
                    label={language === 'en' ? 'Minute' : 'دقیقه'}
                    selectedValue={selectedMinute}
                    onChange={(val) => setSelectedMinute(val)}
                    min={0}
                    max={59}
                    itemHeight={80}
                    items={Array.from({ length: 60 }, (_, i) => ({
                      value: i,
                      label: i.toString().padStart(2, '0'),
                    }))}
                  />
                </div>
              </div>
            </div>

            {/* Recurrence Selection Section */}
            <div className="p-2.5 sm:p-5 rounded-2xl bg-stone-950/80 border border-stone-800 space-y-3 sm:space-y-4">
              <div className="flex items-center justify-between">
                <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  <Repeat className="w-4 h-4" />
                </div>

                {recurrence !== 'none' && (
                  <span className="text-xs px-2.5 py-1 rounded-lg bg-amber-500/15 text-amber-300 border border-amber-500/30 font-bold flex items-center gap-1">
                    <Repeat className="w-3 h-3" />
                    <span>{RECURRENCE_OPTIONS.find((o) => o.id === recurrence)?.label}</span>
                  </span>
                )}
              </div>

              {/* Recurrence Type Selector Pills */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {RECURRENCE_OPTIONS.map((opt) => {
                  const isSelected = recurrence === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        setRecurrence(opt.id);
                        if (opt.id === 'weekly' && recurrenceDaysOfWeek.length === 0) {
                          // Default to current selected day's weekday
                          setRecurrenceDaysOfWeek([0]); // Saturday default or first day
                        }
                      }}
                      className={`p-2.5 rounded-xl border text-right transition-all flex items-center justify-between cursor-pointer active:scale-95 ${
                        isSelected
                          ? 'bg-amber-500/15 border-amber-500/80 text-white shadow-md shadow-amber-500/15 ring-1 ring-amber-400/50'
                          : 'bg-stone-900/70 border-stone-800 text-stone-400 hover:text-stone-200 hover:bg-stone-900'
                      }`}
                    >
                      <span className={`text-xs font-black ${isSelected ? 'text-amber-400' : 'text-stone-300'}`}>
                        {opt.label}
                      </span>
                      {isSelected && <Check className="w-3.5 h-3.5 text-amber-400" />}
                    </button>
                  );
                })}
              </div>

              {/* Sub-panels for each recurrence type */}
              {/* 1. HOURLY SUB-PANEL */}
              {recurrence === 'hourly' && (
                <div className="p-3 rounded-xl bg-stone-900/80 border border-stone-800 space-y-2 animate-in fade-in">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-stone-300 font-bold">بازه تکرار ساعتی:</span>
                    <span className="text-amber-400 font-extrabold font-mono">
                      هر {toPersianDigits(recurrenceInterval)} ساعت
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
                              ? 'bg-amber-500 text-stone-950 font-black shadow'
                              : 'bg-stone-950 text-stone-400 hover:text-white border border-stone-800'
                          }`}
                        >
                          {toPersianDigits(hours)}س
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 2. DAILY SUB-PANEL */}
              {recurrence === 'daily' && (
                <div className="p-2.5 rounded-xl bg-stone-900/80 border border-amber-500/20 text-xs text-stone-300 animate-in fade-in">
                  <p className="font-bold text-amber-300">
                    تکرار هر روز ساعت {selectedHour.toString().padStart(2, '0')}:{selectedMinute.toString().padStart(2, '0')}
                  </p>
                </div>
              )}

              {/* 3. WEEKLY SUB-PANEL */}
              {recurrence === 'weekly' && (
                <div className="p-3.5 rounded-xl bg-stone-900/80 border border-stone-800 space-y-3 animate-in fade-in">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-stone-300 font-bold">انتخاب روزهای تکرار در هفته:</span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setRecurrenceDaysOfWeek([0, 1, 2, 3, 4, 5, 6])}
                        className="text-[10px] text-stone-400 hover:text-amber-400 underline px-1"
                      >
                        همه روزها
                      </button>
                      <button
                        type="button"
                        onClick={() => setRecurrenceDaysOfWeek([0, 1, 2, 3, 4])}
                        className="text-[10px] text-stone-400 hover:text-amber-400 underline px-1"
                      >
                        روزهای کاری
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-7 gap-1 sm:gap-2">
                    {PERSIAN_WEEK_DAYS.map((w) => {
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
                              ? 'bg-amber-500 text-stone-950 font-black shadow-md shadow-amber-500/20'
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
                <div className="p-2.5 rounded-xl bg-stone-900/80 border border-amber-500/20 text-xs text-stone-300 animate-in fade-in">
                  <p className="font-bold text-amber-300">
                    تکرار هر ماه در روز {selectedDay} ساعت {selectedHour.toString().padStart(2, '0')}:{selectedMinute.toString().padStart(2, '0')}
                  </p>
                </div>
              )}

              {/* 5. CUSTOM DATES FROM CALENDAR SUB-PANEL */}
              {recurrence === 'custom_dates' && (
                <div className="space-y-2 animate-in fade-in">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-stone-200 font-bold">
                      انتخاب روزهای مشخص از تقویم شمسی:
                    </span>
                    <span className="text-amber-400 font-bold text-[11px]">
                      {recurrenceCustomDates.length > 0
                        ? `${toPersianDigits(recurrenceCustomDates.length)} روز انتخاب شد`
                        : 'روی روزهای تقویم کلیک کنید'}
                    </span>
                  </div>

                  <JalaliMultiDatePicker
                    selectedDates={recurrenceCustomDates}
                    onChange={setRecurrenceCustomDates}
                    baseYear={selectedYear}
                    baseMonth={selectedMonth}
                  />
                </div>
              )}
            </div>

            {/* Photo Capture & Upload */}
            <div>
              <label className="block text-xs font-semibold text-stone-300 mb-2">
                عکسبرداری و آپلود تصویر
              </label>
              
              {imageUrl ? (
                <div className="relative rounded-2xl overflow-hidden border border-stone-700 group max-w-sm">
                  <img src={imageUrl} alt="پیوست یادآور" className="w-full h-36 object-cover" />
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                    <button
                      type="button"
                      onClick={() => setImageUrl(undefined)}
                      className="p-2 rounded-full bg-red-600 text-white hover:bg-red-500"
                      title="حذف عکس"
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
                    className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-stone-950 border border-stone-800 hover:border-amber-500/50 text-stone-300 text-xs font-medium transition-colors"
                  >
                    <Camera className="w-4 h-4 text-amber-400" />
                    <span>گرفتن عکس با دوربین</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-stone-950 border border-stone-800 hover:border-amber-500/50 text-stone-300 text-xs font-medium transition-colors"
                  >
                    <Upload className="w-4 h-4 text-cyan-400" />
                    <span>آپلود فایل عکس</span>
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

            {/* Alarm Features: Flash LED & Voice Read Aloud */}
            <div className="space-y-2.5 pt-2 border-t border-stone-800">
              {/* Flash LED toggle */}
              <label className="flex items-center justify-between p-3 rounded-xl bg-stone-950/60 border border-stone-800/80 cursor-pointer hover:border-stone-700">
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400">
                    <Zap className="w-4 h-4" />
                  </div>
                  <span className="text-xs font-bold text-white">
                    استفاده از فلاش LED هنگام آلارم
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={useFlash}
                  onChange={(e) => setUseFlash(e.target.checked)}
                  className="w-4 h-4 accent-amber-500 rounded cursor-pointer"
                />
              </label>

              {/* Google Sync Option */}
              {googleToken && (
                <label className="flex items-center justify-between p-3 rounded-xl bg-stone-950/60 border border-stone-800/80 cursor-pointer hover:border-sky-500/50">
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 rounded-lg bg-sky-500/10 text-sky-400">
                      <Cloud className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-white">
                      همگام‌سازی با Google Calendar
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={syncWithGoogle}
                    onChange={(e) => setSyncWithGoogle(e.target.checked)}
                    className="w-4 h-4 accent-amber-500 rounded cursor-pointer"
                  />
                </label>
              )}
            </div>

            </div>

            {/* Sticky Submit Footer - Always positioned right above virtual keyboard */}
            <div className="sticky bottom-0 z-30 shrink-0 bg-stone-900/95 backdrop-blur-md border-t border-stone-800 p-3 sm:p-4 flex items-center justify-end gap-3 shadow-2xl">
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-300 text-xs font-medium transition-colors"
              >
                انصراف
              </button>
              <button
                type="submit"
                className={`px-6 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center gap-1.5 cursor-pointer active:scale-95 ${
                  !title.trim()
                    ? 'bg-amber-500/20 border border-amber-500/40 text-amber-300'
                    : 'bg-amber-500 hover:bg-amber-400 text-stone-950 font-black shadow-lg shadow-amber-500/20'
                }`}
              >
                <Check className={`w-4 h-4 stroke-[3] ${!title.trim() ? 'text-amber-300' : 'text-stone-950'}`} />
                <span className={!title.trim() ? 'text-amber-300 font-bold' : 'text-stone-950 font-black'}>
                  {initialData ? 'ذخیره تغییرات' : 'ثبت نهایی یادآور'}
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
        title="تکمیل فیلد اجباری"
        fieldName="عنوان یادآور"
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
                    ? 'bg-amber-950/50 text-amber-300 border-amber-500/30'
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
                <div className="p-3 rounded-2xl bg-stone-950 border border-cyan-500/25 space-y-1.5 text-xs">
                  <div className="font-bold text-cyan-400 flex items-center gap-1">
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
                className="px-5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-stone-950 font-black text-xs shadow-lg shadow-cyan-500/25 active:scale-95 transition-all cursor-pointer"
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

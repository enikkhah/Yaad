export type Category = 'work' | 'family' | 'other';
export type Priority = 'high' | 'medium' | 'low';
export type ReminderStatus = 'pending' | 'completed' | 'postponed' | 'cancelled';
export type AppTheme = 'system' | 'dark-gold' | 'dark-slate' | 'light-clean' | 'sketch-contrast' | 'jade_warm_light' | 'midnight_blue_silver';

export type PhoneAlarmSound =
  | 'digital_beep'
  | 'radar'
  | 'marimba'
  | 'morning_chime'
  | 'urgent_bell'
  | 'beep'
  | 'zen-bowl'
  | 'soft-harp'
  | 'ocean-drop'
  | 'wind-chimes'
  | 'warm-pad'
  | 'calm-piano'
  | 'digital-beep'
  | 'morning-chime'
  | 'urgent-bell';

export type RecurrenceType = 'none' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom_dates';

export interface IdeaNote {
  id: string;
  title: string;
  content: string;
  createdAt: number;
  category: Category;
  tags?: string[];
  audioRecordUrl?: string;     // Recorded voice memo blob/data URL
  videoRecordUrl?: string;     // Recorded video memo blob/data URL
  photoDataUrl?: string;       // Captured photo from rear camera (data URL)
  drawingDataUrl?: string;     // Hand-drawn sketch canvas data URL
  googleSynced?: boolean;
  deletedAt?: number;          // Recycle Bin deletion timestamp
}

export interface AppSettings {
  language?: 'fa' | 'en';
  theme: AppTheme;
  timelineOrientation: 'vertical' | 'horizontal';
  timelineMode?: 'modern' | 'sketch';
  fontSize?: 'small' | 'normal' | 'large' | 'xlarge' | number; // Number for slider (e.g. 13 to 24px) or legacy string
  systemNotificationsEnabled?: boolean;
  ttsVoiceRate: number; // 0.8 - 1.2
  defaultRingTune: Category;
  alarmSound: PhoneAlarmSound;
  alarmVolume: number; // 0.0 - 1.0
  vibrationEnabled?: boolean;
  autoVoiceInput: boolean;
  googleMapsApiKey?: string;
  localBackupFolderName?: string;
}

export type GeofenceTriggerType = 'enter' | 'exit' | 'both';

export interface LocationGeofenceConfig {
  enabled: boolean;
  latitude: number;
  longitude: number;
  radius: number; // radius in meters (e.g. 100, 250, 500, 1000)
  locationName: string;
  triggerOn: GeofenceTriggerType; // 'enter' | 'exit' | 'both'
  savedLocationId?: string;
  address?: string;
  lastTriggeredAt?: number;
  hasTriggered?: boolean;
}

export interface LocationCheckpointConfig {
  enabled: boolean;
  radius: number; // radius in meters (50, 100, 200, 500, 1000)
  triggerOn: GeofenceTriggerType; // 'enter' | 'exit' | 'both'
  customMessage?: string;
  playAudio?: boolean;
  lastTriggeredAt?: number;
  hasTriggered?: boolean;
}

export interface SavedLocation {
  id: string;
  title: string;
  description?: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  address?: string;
  photoUrl?: string;
  createdAt: number;
  googleMapsUrl: string;
  // Associated note/idea or reminder linking
  linkedIdeaId?: string;
  linkedReminderId?: string;
  // Geofence (حصار مکانی و محدوده شعاع)
  geofence?: LocationCheckpointConfig;
  deletedAt?: number;          // Recycle Bin deletion timestamp
}

export interface Reminder {
  id: string;
  notificationId?: number; // Stable 32-bit integer ID for Android Local Notifications
  title: string;
  description?: string;
  category: Category;
  priority: Priority;
  priorityLevel?: number; // 1 to 5, 1 to 10 numerical priority score
  dueTimestamp: number; // Unix timestamp (ms)
  status: ReminderStatus;
  createdAt: number;
  completedAt?: number;
  postponedAt?: number;
  postponeCount: number;
  cancelledAt?: number;
  acknowledged?: boolean;
  notifiedAt?: number;
  lastActionAt?: number;
  imageUrl?: string;
  sourceApp?: 'manual' | 'voice' | 'other';
  ringTune: Category | string; // Ring tune or category sound
  voiceReadAloud: boolean;
  recurrence?: RecurrenceType;
  recurrenceInterval?: number; // e.g. every 1, 2, 3 hours
  recurrenceCount?: number; // Total number of times to repeat (تعداد دفعات تکرار)
  recurrenceDaysOfWeek?: number[]; // [0..6] (0=شنبه, 1=یکشنبه, ..., 6=جمعه)
  recurrenceCustomDates?: string[]; // array of Jalali date strings "1404/01/25"
  googleCalendarEventId?: string;
  googleTaskId?: string;
  // Geofencing and location-based reminder fields
  geofence?: LocationGeofenceConfig;
  featureType?: 'reminder' | 'medication' | 'in_progress' | 'occasion' | 'geofence';
  deletedAt?: number;          // Recycle Bin deletion timestamp
}

export interface StatsData {
  total: number;
  completed: number;
  postponed: number;
  cancelled: number;
  pending: number;
  byCategory: {
    work: number;
    family: number;
    other: number;
  };
  byPriority: {
    high: number;
    medium: number;
    low: number;
  };
}

export type StatsTimeframe = 'weekly' | 'monthly' | 'yearly';

export type OccasionType = 
  | 'birthday'       // تولد
  | 'wedding'        // سالگرد ازدواج
  | 'dating'         // سالگرد آشنایی
  | 'memorial'       // سالگرد فوت
  | 'family'         // مناسبت خانوادگی
  | 'work'           // مناسبت کاری
  | 'custom';        // سایر مناسبت‌های دلخواه

export interface Occasion {
  id: string;
  title: string;                 // عنوان مناسبت (مثلاً تولد علی)
  personName?: string;          // نام شخص مرتبط (اختیاری)
  type: OccasionType;           // نوع مناسبت
  solarYear?: number;           // سال شروع/رویداد شمسی (اختیاری، مثلاً ۱۳۷۰ برای محاسبه سن/سالگرد)
  solarMonth: number;           // ماه شمسی (۱ تا ۱۲)
  solarDay: number;             // روز شمسی (۱ تا ۳۱)
  notifyDaysBefore: number;     // هشدار چند روز قبل (۰ = همان روز، ۱ = ۱ روز قبل، ۲، ۳، ۷)
  notifyTime: string;           // ساعت اعلان پیش‌فرض (مثلاً "09:00")
  customNote?: string;          // یادداشت، هدیه یا توضیح
  ringTune?: string;            // صدای زنگ اختصاصی
  color?: string;               // تم رنگی
  createdAt: number;
  deletedAt?: number;           // Recycle Bin deletion timestamp
}

export type RecycleBinItemType = 'reminder' | 'location' | 'occasion' | 'idea';

export interface RecycleBinItem {
  id: string;
  type: RecycleBinItemType;
  title: string;
  deletedAt: number;
  originalItem: Reminder | SavedLocation | Occasion | IdeaNote;
}

export interface InProgressItem {
  id: string;
  title: string;                      // عنوان کار یا فرآیند در جریان
  categoryLabel?: string;             // دسته‌بندی یا برچسب عمومی (کاری، شخصی، پروژه، آموزشی و...)
  currentProgress: number;            // میزان پیشرفت فعلی
  totalProgress?: number;             // پیشرفت کل / هدف نهایی (اختیاری)
  unit: string;                       // واحد اندازه‌گیری (مرحله، صفحه، قسمت، دقیقه، ساعت، جلسه، درصد، واحد و...)
  stepSize: number;                   // گام افزایش/کاهش سریع با دکمه + و - (پیش‌فرض ۱)
  notes?: string;                     // یادداشت آخرین وضعیت یا نقطه توقف
  inactivityDays: number;             // تعداد روز عدم فعالیت برای ارسال یادآور هوشمند (پیش‌فرض ۱ روز)
  notifyTime?: string;                // ساعت اعلان یادآور کار در جریان (مثلاً "10:00")
  inactivityReminderEnabled: boolean; // فعال بودن یادآور هوشمند عدم فعالیت
  lastUpdatedAt: number;              // زمان آخرین آپدیت پیشرفت (timestamp)
  createdAt: number;                  // زمان ایجاد
  completed?: boolean;                // وضعیت تکمیل نهایی
  deletedAt?: number;
}

export type MedicationInstruction =
  | 'after_food'     // بعد از غذا
  | 'before_food'    // قبل از غذا
  | 'with_food'      // همراه با غذا
  | 'empty_stomach'  // ناشتا / معده خالی
  | 'anytime';       // در هر زمان (آزاد)

export type MedicationScheduleType = 'interval_hours' | 'custom_times';

export type MedicationDoseStatus = 'taken' | 'missed';

export interface MedicationDoseLog {
  id: string;
  dateKey: string;              // کلید تاریخ روز به فرمت YYYY-MM-DD
  scheduledTime: string;        // ساعت نوبت برنامه‌ریزی‌شده به فرمت "HH:mm"
  status: MedicationDoseStatus; // وضعیت: مصرف‌شده ('taken') یا فراموش‌شده ('missed')
  actionTimestamp: number;      // زمان دقیق ثبت وضعیت (Unix ms)
}

export interface MedicationItem {
  id: string;
  name: string;                        // نام دارو (مثلاً آموکسی‌سیلین ۵۰۰ یا شربت دیفن‌هیدرامین)
  categoryLabel?: string;              // دسته‌بندی تشخیص داده‌شده با منطق فازی
  dosageAmount: number;                // دوز مصرفی در هر نوبت (مثلاً ۱ یا ۵)
  dosageUnit: string;                  // واحد دوز (قرص، کپسول، سی‌سی، پاف، قطره، واحد و...)
  instruction: MedicationInstruction;  // دستور مصرف (قبل/بعد از غذا و...)
  scheduleType: MedicationScheduleType;// نوع زمان‌بندی (هر X ساعت یا ساعت‌های مشخص)
  intervalHours?: number;              // بازه تکرار ساعتی (مثلاً ۶، ۸، ۱۲، ۲۴)
  scheduledTimes: string[];            // آرایه ساعت‌های مصرف در شبانه‌روز ["08:00", "16:00", "00:00"]
  startDate: number;                   // تاریخ شروع دوره درمان (Unix ms)
  durationDays?: number;               // طول دوره درمان به روز (اختیاری؛ undefined یعنی نامحدود)
  stockCount?: number;                 // موجودی فعلی دارو (اختیاری)
  initialStockCount?: number;          // موجودی اولیه دارو
  soundId?: PhoneAlarmSound;           // صدای اختصاصی نوتیفیکیشن از پوشه raw
  notes?: string;                      // یادداشت تکمیلی (اختیاری)
  history: MedicationDoseLog[];        // آرایه تاریخچه لاگ مصرف دارو
  active: boolean;                     // فعال بودن یادآور دارو
  createdAt: number;
  updatedAt?: number;
  deletedAt?: number;
}



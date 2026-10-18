export type Category = 'work' | 'family' | 'other';
export type Priority = 'high' | 'medium' | 'low';
export type ReminderStatus = 'pending' | 'completed' | 'postponed' | 'cancelled';
export type AppTheme = 'system' | 'dark-gold' | 'dark-slate' | 'light-clean' | 'sketch-contrast' | 'jade_warm_light' | 'midnight_blue_silver';

export type PhoneAlarmSound =
  | 'digital-beep'
  | 'radar'
  | 'marimba'
  | 'morning-chime'
  | 'zen-bowl'
  | 'soft-harp'
  | 'ocean-drop'
  | 'wind-chimes'
  | 'warm-pad'
  | 'calm-piano'
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
  drawingDataUrl?: string;     // Hand-drawn sketch canvas data URL
  googleSynced?: boolean;
  deletedAt?: number;          // Recycle Bin deletion timestamp
}

export type CloudBackupProvider = 'custom_cloud_folder' | 'webdav_url' | 'google_drive';

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
  autoVoiceInput: boolean;
  googleMapsApiKey?: string;
  cloudBackupEnabled?: boolean;
  cloudBackupProvider?: CloudBackupProvider;
  cloudBackupFolderName?: string;
  cloudSpaceLabel?: string;
  cloudCustomUrl?: string;
  cloudCustomAuth?: string;
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
  dueTimestamp: number; // Unix timestamp (ms)
  status: ReminderStatus;
  createdAt: number;
  completedAt?: number;
  postponedAt?: number;
  postponeCount: number;
  cancelledAt?: number;
  imageUrl?: string;
  sourceApp?: 'sms' | 'manual' | 'voice' | 'other';
  ringTune: Category | string; // Ring tune or category sound
  voiceReadAloud: boolean;
  recurrence?: RecurrenceType;
  recurrenceInterval?: number; // e.g. every 1, 2, 3 hours
  recurrenceDaysOfWeek?: number[]; // [0..6] (0=شنبه, 1=یکشنبه, ..., 6=جمعه)
  recurrenceCustomDates?: string[]; // array of Jalali date strings "1404/01/25"
  googleCalendarEventId?: string;
  googleTaskId?: string;
  // Geofencing and location-based reminder fields
  geofence?: LocationGeofenceConfig;
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

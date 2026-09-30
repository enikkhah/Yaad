export type Category = 'work' | 'family' | 'other';
export type Priority = 'high' | 'medium' | 'low';
export type ReminderStatus = 'pending' | 'completed' | 'postponed' | 'cancelled';
export type AppTheme = 'dark-gold' | 'dark-slate' | 'light-clean' | 'sketch-contrast';

export type PhoneAlarmSound = 'digital-beep' | 'radar' | 'marimba' | 'morning-chime' | 'urgent-bell';
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
  enableFlash: boolean;
  autoVoiceInput: boolean;
  googleMapsApiKey?: string;
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
}

export interface Reminder {
  id: string;
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
  useFlash: boolean;
  ringTune: Category | string; // Ring tune or category sound
  voiceReadAloud: boolean;
  recurrence?: RecurrenceType;
  recurrenceInterval?: number; // e.g. every 1, 2, 3 hours
  recurrenceDaysOfWeek?: number[]; // [0..6] (0=شنبه, 1=یکشنبه, ..., 6=جمعه)
  recurrenceCustomDates?: string[]; // array of Jalali date strings "1404/01/25"
  googleCalendarEventId?: string;
  googleTaskId?: string;
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


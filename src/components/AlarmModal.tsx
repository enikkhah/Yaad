import React, { useEffect, useState } from 'react';
import { Reminder, AppSettings, PhoneAlarmSound, AppTheme } from '../types';
import { formatJalaliFull, formatJalaliTime, toPersianDigits } from '../utils/jalali';
import { getRecurrenceLabel } from '../utils/recurrence';
import { startAlarmRinging, stopAlarmRinging, resolveAlarmSound, speakReminderText } from '../utils/audio';
import {
  triggerOutOfAppPersistentNotification,
  clearOutOfAppPersistentNotification,
  isAppCurrentlyInForeground,
  dismissDeliveredNotifications,
} from '../utils/nativeLocalNotifications';
import {
  CheckCircle2,
  Clock,
  Briefcase,
  Heart,
  Tag,
  Repeat,
  Edit2,
  X,
} from 'lucide-react';
import appIcon from '../assets/images/icon.png';

interface AlarmModalProps {
  reminder: Reminder | null;
  settings?: AppSettings;
  onUpdateSettings?: (newSettings: Partial<AppSettings>) => void;
  onDismiss: () => void;
  onNoReactionTimeout?: (id: string) => void;
  onComplete: (id: string) => void;
  onPostpone: (id: string, minutes: number) => void;
  onEdit?: (reminder: Reminder) => void;
}

interface CardThemePalette {
  cardBg: string;
  cardBorder: string;
  titleText: string;
  bodyText: string;
  mutedText: string;
  accentText: string;
  accentBg: string;
  doneBtn: string;
  secondaryBtn: string;
  editBtn: string;
  progressFill: string;
  featureLabelFa: string;
  featureLabelEn: string;
}

function resolveFeatureType(reminder: Reminder): 'medication' | 'in_progress' | 'occasion' | 'geofence' | 'reminder' {
  if (reminder.featureType) return reminder.featureType;
  const id = (reminder.id || '').toLowerCase();
  const title = (reminder.title || '').toLowerCase();
  if (id.startsWith('med_') || title.includes('💊') || title.includes('زمان مصرف دارو')) {
    return 'medication';
  }
  if (id.startsWith('inprog_') || title.includes('⏳') || title.includes('کار در جریان')) {
    return 'in_progress';
  }
  if (id.startsWith('occ_') || title.includes('🎂') || title.includes('مناسبت') || title.includes('سالگرد') || title.includes('تولد')) {
    return 'occasion';
  }
  if (reminder.geofence?.enabled || id.startsWith('geo_') || title.includes('📍') || title.includes('حصار مکانی')) {
    return 'geofence';
  }
  return 'reminder';
}

function getAlarmCardPalette(reminder: Reminder, _theme: AppTheme = 'dark-gold'): CardThemePalette {
  const fType = resolveFeatureType(reminder);
  switch (fType) {
    case 'medication':
      // یادآور دارو — پس‌زمینه هایلایت سبز کم‌رنگ (Soft Light Green Highlight)
      return {
        cardBg: '!bg-[#E6F7EE]',
        cardBorder: '!border-[#10B981]',
        titleText: '!text-[#064E3B]',
        bodyText: '!text-[#065F46]',
        mutedText: '!text-[#047857]',
        accentText: '!text-[#059669]',
        accentBg: '!bg-[#D1FAE5] !border-[#10B981]/50',
        doneBtn: '!bg-[#059669] hover:!bg-[#047857] !text-white',
        secondaryBtn: '!bg-[#D1FAE5] hover:!bg-[#A7F3D0] !text-[#064E3B] !border-[#6EE7B7]',
        editBtn: '!bg-[#ECFDF5] hover:!bg-[#D1FAE5] !text-[#047857] !border-[#10B981]',
        progressFill: '!bg-[#10B981]',
        featureLabelFa: '💊 یادآور تخصصی دارو',
        featureLabelEn: '💊 Medication Reminder',
      };
    case 'in_progress':
      // کار در جریان — پس‌زمینه هایلایت کهربایی ملایم (Soft Warm Amber Highlight)
      return {
        cardBg: '!bg-[#FEF3C7]',
        cardBorder: '!border-[#F59E0B]',
        titleText: '!text-[#78350F]',
        bodyText: '!text-[#92400E]',
        mutedText: '!text-[#B45309]',
        accentText: '!text-[#D97706]',
        accentBg: '!bg-[#FDE68A] !border-[#F59E0B]/50',
        doneBtn: '!bg-[#D97706] hover:!bg-[#B45309] !text-white',
        secondaryBtn: '!bg-[#FDE68A] hover:!bg-[#FCD34D] !text-[#78350F] !border-[#FBBF24]',
        editBtn: '!bg-[#FFFBEB] hover:!bg-[#FEF3C7] !text-[#B45309] !border-[#F59E0B]',
        progressFill: '!bg-[#F59E0B]',
        featureLabelFa: '⏳ یادآور کار در جریان',
        featureLabelEn: '⏳ In-Progress Follow-up',
      };
    case 'occasion':
      // مناسبت‌ها — پس‌زمینه هایلایت صورتی-رز ملایم (Soft Rose Highlight)
      return {
        cardBg: '!bg-[#FCE7F3]',
        cardBorder: '!border-[#EC4899]',
        titleText: '!text-[#831843]',
        bodyText: '!text-[#9D174D]',
        mutedText: '!text-[#BE185D]',
        accentText: '!text-[#DB2777]',
        accentBg: '!bg-[#FBCFE8] !border-[#EC4899]/50',
        doneBtn: '!bg-[#DB2777] hover:!bg-[#BE185D] !text-white',
        secondaryBtn: '!bg-[#FBCFE8] hover:!bg-[#F9A8D4] !text-[#831843] !border-[#F472B6]',
        editBtn: '!bg-[#FDF2F8] hover:!bg-[#FCE7F3] !text-[#BE185D] !border-[#EC4899]',
        progressFill: '!bg-[#EC4899]',
        featureLabelFa: '🎂 یادآور مناسبت',
        featureLabelEn: '🎂 Occasion Reminder',
      };
    case 'geofence':
      // حصار مکانی و مکان‌ها — پس‌زمینه هایلایت فیروزه‌ای-آبی ملایم (Soft Sky-Cyan Highlight)
      return {
        cardBg: '!bg-[#E0F2FE]',
        cardBorder: '!border-[#06B6D4]',
        titleText: '!text-[#0C4A6E]',
        bodyText: '!text-[#155E75]',
        mutedText: '!text-[#0369A1]',
        accentText: '!text-[#0284C7]',
        accentBg: '!bg-[#BAE6FD] !border-[#06B6D4]/50',
        doneBtn: '!bg-[#0284C7] hover:!bg-[#0369A1] !text-white',
        secondaryBtn: '!bg-[#BAE6FD] hover:!bg-[#7DD3FC] !text-[#0C4A6E] !border-[#38BDF8]',
        editBtn: '!bg-[#F0F9FF] hover:!bg-[#E0F2FE] !text-[#0369A1] !border-[#06B6D4]',
        progressFill: '!bg-[#06B6D4]',
        featureLabelFa: '📍 اعلان حصار مکانی',
        featureLabelEn: '📍 Geofence Alert',
      };
    case 'reminder':
    default:
      // یادآورهای زمانی — پس‌زمینه هایلایت یاسی-نیلی ملایم (Soft Indigo Highlight)
      return {
        cardBg: '!bg-[#EEF2FF]',
        cardBorder: '!border-[#6366F1]',
        titleText: '!text-[#1E1B4B]',
        bodyText: '!text-[#312E81]',
        mutedText: '!text-[#4338CA]',
        accentText: '!text-[#4F46E5]',
        accentBg: '!bg-[#E0E7FF] !border-[#6366F1]/50',
        doneBtn: '!bg-[#4F46E5] hover:!bg-[#4338CA] !text-white',
        secondaryBtn: '!bg-[#E0E7FF] hover:!bg-[#C7D2FE] !text-[#1E1B4B] !border-[#A5B4FC]',
        editBtn: '!bg-[#F5F7FF] hover:!bg-[#EEF2FF] !text-[#4338CA] !border-[#6366F1]',
        progressFill: '!bg-[#6366F1]',
        featureLabelFa: '⏰ یادآور هوشمند یاد',
        featureLabelEn: '⏰ YAAD Reminder',
      };
  }
}

export const AlarmModal: React.FC<AlarmModalProps> = ({
  reminder,
  settings,
  onDismiss,
  onNoReactionTimeout,
  onComplete,
  onPostpone,
  onEdit,
}) => {
  const isEn = settings?.language === 'en';
  const [secondsLeft, setSecondsLeft] = useState<number>(60);

  useEffect(() => {
    if (!reminder?.id) {
      stopAlarmRinging();
      return;
    }

    setSecondsLeft(60);

    try {
      window.dispatchEvent(new CustomEvent('yaad:stop-all-microphones'));
    } catch {
      // ignore
    }

    // Trigger persistent out-of-app notification ONLY when outside the app;
    // when inside the app, ensure no status-bar notification overlaps the in-app modal.
    if (!isAppCurrentlyInForeground()) {
      triggerOutOfAppPersistentNotification(reminder, settings).catch(() => {});
    } else {
      dismissDeliveredNotifications(reminder.id).catch(() => {});
    }

    // Ring alarm for 1 minute (60 seconds)
    const sound: PhoneAlarmSound = resolveAlarmSound(reminder.ringTune, settings?.alarmSound);
    const vol = settings?.alarmVolume !== undefined ? settings.alarmVolume : 0.85;
    const vib = settings?.vibrationEnabled !== false;
    startAlarmRinging(reminder.category, sound, vol, vib);

    let ttsTimer: any = null;
    if (reminder.voiceReadAloud) {
      ttsTimer = setTimeout(() => {
        speakReminderText(
          reminder.title,
          reminder.category,
          settings?.ttsVoiceRate ?? 0.95,
          settings?.language || 'fa'
        );
      }, 600);
    }

    // 60-second countdown timer: stops 1-minute alarm and closes the popup card; repeats in 15 minutes if no user reaction
    const intervalId = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          window.clearInterval(intervalId);
          stopAlarmRinging();
          if (onNoReactionTimeout && reminder?.id) {
            onNoReactionTimeout(reminder.id);
          } else {
            onDismiss();
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
      if (ttsTimer) clearTimeout(ttsTimer);
      stopAlarmRinging();
    };
  }, [
    reminder?.id,
    reminder?.ringTune,
    settings?.alarmSound,
    settings?.alarmVolume,
    settings?.vibrationEnabled,
    settings?.language,
    settings?.ttsVoiceRate,
  ]);

  if (!reminder) return null;

  const palette = getAlarmCardPalette(reminder, settings?.theme);

  const getCategoryIcon = () => {
    switch (reminder.category) {
      case 'work':
        return <Briefcase className="w-3.5 h-3.5" />;
      case 'family':
        return <Heart className="w-3.5 h-3.5" />;
      default:
        return <Tag className="w-3.5 h-3.5" />;
    }
  };

  const handleComplete = () => {
    stopAlarmRinging();
    clearOutOfAppPersistentNotification(reminder.id).catch(() => {});
    onComplete(reminder.id);
  };

  const handlePostpone = (minutes: number) => {
    stopAlarmRinging();
    clearOutOfAppPersistentNotification(reminder.id).catch(() => {});
    onPostpone(reminder.id, minutes);
  };

  const handleEdit = () => {
    stopAlarmRinging();
    clearOutOfAppPersistentNotification(reminder.id).catch(() => {});
    if (onEdit) {
      onEdit(reminder);
    }
  };

  const handleDismiss = () => {
    stopAlarmRinging();
    onDismiss();
  };

  const timeFormatted = formatJalaliTime(reminder.dueTimestamp, isEn ? 'en' : 'fa');
  const dateFormatted = formatJalaliFull(reminder.dueTimestamp, isEn ? 'en' : 'fa');
  const formattedCountdown = isEn
    ? `00:${String(secondsLeft).padStart(2, '0')}`
    : `۰۰:${toPersianDigits(String(secondsLeft).padStart(2, '0'))}`;

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/65 backdrop-blur-xs flex items-start sm:items-center justify-center p-3.5 sm:p-6 pt-6 select-none animate-in fade-in duration-200"
      dir={isEn ? 'ltr' : 'rtl'}
    >
      <div
        onClick={handleDismiss}
        className={`w-full max-w-md rounded-3xl border-2 ${palette.cardBg} ${palette.cardBorder} shadow-2xl overflow-hidden transition-all cursor-pointer`}
      >
        {/* Minimal 1-Minute Progress Bar */}
        <div className="w-full h-1 bg-black/20 overflow-hidden">
          <div
            className={`h-full transition-all duration-1000 ease-linear ${palette.progressFill}`}
            style={{ width: `${Math.max(0, (secondsLeft / 60) * 100)}%` }}
          />
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          {/* Header Row */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div
                className={`relative w-8 h-8 rounded-xl border flex items-center justify-center shrink-0 overflow-hidden p-0.5 ${palette.accentBg} ${palette.accentText}`}
              >
                <span className="animate-ping absolute inline-flex h-full w-full rounded-xl opacity-20 bg-current" />
                <img
                  src={`${appIcon}${appIcon.includes('?') ? '&' : '?'}v=f7941e`}
                  alt="YAAD"
                  className="relative z-10 w-full h-full object-cover rounded-[9px]"
                  draggable={false}
                />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-xs font-bold">
                  <span className={palette.accentText}>
                    {isEn ? 'YAAD Reminder' : 'یادآور هوشمند یاد'}
                  </span>
                  <span className={palette.mutedText}>·</span>
                  <span className={`inline-flex items-center gap-1 ${palette.mutedText}`}>
                    {getCategoryIcon()}
                    <span>
                      {reminder.category === 'work'
                        ? isEn
                          ? 'Work'
                          : 'کاری'
                        : reminder.category === 'family'
                        ? isEn
                          ? 'Family'
                          : 'خانوادگی'
                        : isEn
                        ? 'Other'
                        : 'سایر'}
                    </span>
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <span className={`font-mono text-xs font-bold ${palette.mutedText}`}>
                {formattedCountdown}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDismiss();
                }}
                className={`p-1.5 rounded-xl transition-colors cursor-pointer ${palette.mutedText} hover:opacity-100`}
                title={isEn ? 'Close Card' : 'بستن کارت'}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Main Reminder Content */}
          <div className="space-y-1.5 py-1">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className={`text-lg sm:text-xl font-black leading-snug ${palette.titleText}`}>
                {reminder.title}
              </h2>
              <span className={`font-mono text-base sm:text-lg font-black shrink-0 ${palette.accentText}`}>
                {timeFormatted}
              </span>
            </div>

            <div className={`text-xs ${palette.mutedText} flex items-center gap-2 flex-wrap`}>
              <span>{dateFormatted}</span>
              {reminder.recurrence && reminder.recurrence !== 'none' && (
                <>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1">
                    <Repeat className="w-3 h-3" />
                    <span>{getRecurrenceLabel(reminder, isEn ? 'en' : 'fa')}</span>
                  </span>
                </>
              )}
            </div>

            {reminder.description && (
              <p className={`text-xs sm:text-sm leading-relaxed pt-1 ${palette.bodyText}`}>
                {reminder.description}
              </p>
            )}
          </div>

          {/* 3 Minimal Theme-Matched Action Buttons */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="grid grid-cols-3 gap-2 pt-1"
          >
            {/* 1. Done */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleComplete();
              }}
              className={`min-h-[44px] py-2.5 px-3 rounded-xl font-black text-xs sm:text-sm transition-all cursor-pointer active:scale-95 flex items-center justify-center gap-1.5 shadow-sm ${palette.doneBtn}`}
            >
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span className="truncate">{isEn ? 'Done' : 'انجام شد'}</span>
            </button>

            {/* 2. Snooze (+15m) */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handlePostpone(15);
              }}
              className={`min-h-[44px] py-2.5 px-3 rounded-xl font-bold text-xs sm:text-sm border transition-all cursor-pointer active:scale-95 flex items-center justify-center gap-1.5 ${palette.secondaryBtn}`}
            >
              <Clock className="w-4 h-4 shrink-0" />
              <span className="truncate">{isEn ? 'Snooze 15m' : 'تعویق ۱۵ دقیقه'}</span>
            </button>

            {/* 3. Edit Reminder (Opens Edit Form) */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleEdit();
              }}
              className={`min-h-[44px] py-2.5 px-3 rounded-xl font-bold text-xs sm:text-sm border transition-all cursor-pointer active:scale-95 flex items-center justify-center gap-1.5 ${palette.editBtn}`}
            >
              <Edit2 className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{isEn ? 'Edit' : 'ویرایش'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

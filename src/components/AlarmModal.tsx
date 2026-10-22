import React, { useEffect, useState } from 'react';
import { Reminder, AppSettings, PhoneAlarmSound, AppTheme } from '../types';
import { formatJalaliFull, formatJalaliTime, toPersianDigits } from '../utils/jalali';
import { getRecurrenceLabel } from '../utils/recurrence';
import { startAlarmRinging, stopAlarmRinging, resolveAlarmSound, speakReminderText } from '../utils/audio';
import {
  triggerOutOfAppPersistentNotification,
  clearOutOfAppPersistentNotification,
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
}

function getAlarmCardPalette(theme: AppTheme = 'dark-gold'): CardThemePalette {
  switch (theme) {
    case 'dark-slate':
      return {
        cardBg: 'bg-[#11223D]',
        cardBorder: 'border-[#0EA5E9]/70',
        titleText: 'text-[#EFF6FF]',
        bodyText: 'text-[#BAE6FD]',
        mutedText: 'text-[#7DD3FC]/80',
        accentText: 'text-[#38BDF8]',
        accentBg: 'bg-[#0EA5E9]/15 border-[#0EA5E9]/40',
        doneBtn: 'bg-[#0284C7] hover:bg-[#0369A1] text-white',
        secondaryBtn: 'bg-[#193154] hover:bg-[#22406B] text-[#EFF6FF] border-[#274875]',
        editBtn: 'bg-[#0E1F38] hover:bg-[#162D4F] text-[#38BDF8] border-[#0EA5E9]/60',
        progressFill: 'bg-[#38BDF8]',
      };
    case 'system': {
      const isLight =
        typeof document !== 'undefined' && !document.documentElement.classList.contains('dark');
      if (isLight) {
        return {
          cardBg: 'bg-white',
          cardBorder: 'border-[#0D9488]/60',
          titleText: 'text-[#0F172A]',
          bodyText: 'text-[#334155]',
          mutedText: 'text-[#64748B]',
          accentText: 'text-[#0D9488]',
          accentBg: 'bg-[#0D9488]/10 border-[#0D9488]/30',
          doneBtn: 'bg-[#0D9488] hover:bg-[#0F766E] text-white',
          secondaryBtn: 'bg-[#F1F5F9] hover:bg-[#E2E8F0] text-[#0F172A] border-[#CBD5E1]',
          editBtn: 'bg-[#F0FDFA] hover:bg-[#CCFBF1] text-[#0F766E] border-[#0D9488]/50',
          progressFill: 'bg-[#0D9488]',
        };
      }
      return {
        cardBg: 'bg-[#1C2126]',
        cardBorder: 'border-[#14B8A6]/70',
        titleText: 'text-[#F1F5F9]',
        bodyText: 'text-[#CBD5E1]',
        mutedText: 'text-[#94A3B8]',
        accentText: 'text-[#2DD4BF]',
        accentBg: 'bg-[#14B8A6]/15 border-[#14B8A6]/40',
        doneBtn: 'bg-[#0D9488] hover:bg-[#0F766E] text-white',
        secondaryBtn: 'bg-[#252C33] hover:bg-[#2F3841] text-[#F1F5F9] border-[#333D47]',
        editBtn: 'bg-[#191E23] hover:bg-[#232A31] text-[#2DD4BF] border-[#14B8A6]/60',
        progressFill: 'bg-[#2DD4BF]',
      };
    }
    case 'light-clean':
      return {
        cardBg: 'bg-white',
        cardBorder: 'border-teal-600/60',
        titleText: 'text-stone-900',
        bodyText: 'text-stone-700',
        mutedText: 'text-stone-500',
        accentText: 'text-teal-700',
        accentBg: 'bg-teal-50 border-teal-600/30',
        doneBtn: 'bg-teal-600 hover:bg-teal-700 text-white',
        secondaryBtn: 'bg-stone-100 hover:bg-stone-200 text-stone-900 border-stone-300',
        editBtn: 'bg-teal-50 hover:bg-teal-100 text-teal-800 border-teal-600/50',
        progressFill: 'bg-teal-600',
      };
    case 'jade_warm_light':
      return {
        cardBg: 'bg-[#F7F6F0]',
        cardBorder: 'border-[#168779]/60',
        titleText: 'text-[#202A29]',
        bodyText: 'text-[#3D4B49]',
        mutedText: 'text-[#5C6B68]',
        accentText: 'text-[#168779]',
        accentBg: 'bg-[#DDEFEA] border-[#168779]/30',
        doneBtn: 'bg-[#168779] hover:bg-[#116E63] text-white',
        secondaryBtn: 'bg-[#EFEFE8] hover:bg-[#E2E5DC] text-[#202A29] border-[#DDE1DA]',
        editBtn: 'bg-[#DDEFEA] hover:bg-[#CBE5DF] text-[#168779] border-[#168779]/50',
        progressFill: 'bg-[#168779]',
      };
    case 'midnight_blue_silver':
      return {
        cardBg: 'bg-[#202B3A]',
        cardBorder: 'border-[#9CBCE0]/70',
        titleText: 'text-[#F0F3F7]',
        bodyText: 'text-[#C5D9EE]',
        mutedText: 'text-[#9CBCE0]/80',
        accentText: 'text-[#9CBCE0]',
        accentBg: 'bg-[#293648] border-[#9CBCE0]/40',
        doneBtn: 'bg-[#9CBCE0] hover:bg-[#C5D9EE] text-[#101722]',
        secondaryBtn: 'bg-[#172130] hover:bg-[#293648] text-[#F0F3F7] border-[#39475A]',
        editBtn: 'bg-[#293648] hover:bg-[#34445B] text-[#C5D9EE] border-[#9CBCE0]/60',
        progressFill: 'bg-[#9CBCE0]',
      };
    case 'sketch-contrast':
      return {
        cardBg: 'bg-zinc-950',
        cardBorder: 'border-teal-400 border-dashed',
        titleText: 'text-white',
        bodyText: 'text-zinc-300',
        mutedText: 'text-zinc-400',
        accentText: 'text-teal-400',
        accentBg: 'bg-zinc-900 border-teal-400/50 border-dashed',
        doneBtn: 'bg-teal-600 hover:bg-teal-500 text-white border border-teal-300',
        secondaryBtn: 'bg-zinc-900 hover:bg-zinc-800 text-teal-300 border-dashed border-teal-500/60',
        editBtn: 'bg-zinc-900 hover:bg-zinc-800 text-white border-dashed border-white/70',
        progressFill: 'bg-teal-400',
      };
    case 'dark-gold':
    default:
      return {
        cardBg: 'bg-[#101222]',
        cardBorder: 'border-[#6366F1]/75',
        titleText: 'text-[#F3F4F8]',
        bodyText: 'text-[#C7CBF0]',
        mutedText: 'text-[#8A90BD]',
        accentText: 'text-[#818CF8]',
        accentBg: 'bg-[#6366F1]/15 border-[#6366F1]/40',
        doneBtn: 'bg-[#4F46E5] hover:bg-[#4338CA] text-white',
        secondaryBtn: 'bg-[#191C33] hover:bg-[#222646] text-[#F3F4F8] border-[#282C4A]',
        editBtn: 'bg-[#191C33] hover:bg-[#222646] text-[#818CF8] border-[#6366F1]/65',
        progressFill: 'bg-[#6366F1]',
      };
  }
}

export const AlarmModal: React.FC<AlarmModalProps> = ({
  reminder,
  settings,
  onDismiss,
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

    // Trigger single persistent out-of-app notification
    triggerOutOfAppPersistentNotification(reminder, settings).catch(() => {});

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

    // 60-second countdown timer: stops alarm and closes the popup card after 1 minute
    const intervalId = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          window.clearInterval(intervalId);
          stopAlarmRinging();
          onDismiss();
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

  const palette = getAlarmCardPalette(settings?.theme);

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
        className={`w-full max-w-md rounded-3xl border-2 ${palette.cardBg} ${palette.cardBorder} shadow-2xl overflow-hidden transition-all`}
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
                  src={appIcon}
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
                onClick={handleDismiss}
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
          <div className="grid grid-cols-3 gap-2 pt-1">
            {/* 1. Done */}
            <button
              type="button"
              onClick={handleComplete}
              className={`min-h-[44px] py-2.5 px-3 rounded-xl font-black text-xs sm:text-sm transition-all cursor-pointer active:scale-95 flex items-center justify-center gap-1.5 shadow-sm ${palette.doneBtn}`}
            >
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span className="truncate">{isEn ? 'Done' : 'انجام شد'}</span>
            </button>

            {/* 2. Snooze (+15m) */}
            <button
              type="button"
              onClick={() => handlePostpone(15)}
              className={`min-h-[44px] py-2.5 px-3 rounded-xl font-bold text-xs sm:text-sm border transition-all cursor-pointer active:scale-95 flex items-center justify-center gap-1.5 ${palette.secondaryBtn}`}
            >
              <Clock className="w-4 h-4 shrink-0" />
              <span className="truncate">{isEn ? 'Snooze' : 'تعویق'}</span>
            </button>

            {/* 3. Edit Reminder (Opens Edit Form) */}
            <button
              type="button"
              onClick={handleEdit}
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

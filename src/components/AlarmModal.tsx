import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Reminder, AppSettings, AppTheme } from '../types';
import { formatJalaliFull } from '../utils/jalali';
import { getRecurrenceLabel } from '../utils/recurrence';
import { stopAlarmRinging, speakReminderText } from '../utils/audio';
import {
  triggerOutOfAppPersistentNotification,
  clearOutOfAppPersistentNotification,
  isAppCurrentlyInForeground,
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
  MapPin,
  Navigation,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { openGoogleMapsDirections } from '../utils/geofenceManager';
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
}

function getAlarmCardPalette(theme: AppTheme = 'dark-gold'): CardThemePalette {
  switch (theme) {
    case 'dark-slate':
      return {
        cardBg: 'bg-[#11223D]',
        cardBorder: 'border-[#FF8C00]/80',
        titleText: 'text-[#EFF6FF]',
        bodyText: 'text-[#BAE6FD]',
        mutedText: 'text-[#7DD3FC]/80',
        accentText: 'text-[#FF8C00]',
        accentBg: 'bg-[#FF8C00]/15 border-[#FF8C00]/45',
        doneBtn: 'btn-brand-submit bg-[#FF8C00] hover:bg-[#FF9E1F] text-white',
        secondaryBtn: 'bg-[#193154] hover:bg-[#22406B] text-[#EFF6FF] border-[#274875]',
        editBtn: 'bg-[#0E1F38] hover:bg-[#162D4F] text-[#38BDF8] border-[#0EA5E9]/60',
        progressFill: 'bg-[#FF8C00]',
      };
    case 'system': {
      const isLight =
        typeof document !== 'undefined' && !document.documentElement.classList.contains('dark');
      if (isLight) {
        return {
          cardBg: 'bg-white',
          cardBorder: 'border-[#FF8C00]/75',
          titleText: 'text-[#0F172A]',
          bodyText: 'text-[#334155]',
          mutedText: 'text-[#64748B]',
          accentText: 'text-[#FF8C00]',
          accentBg: 'bg-[#FF8C00]/10 border-[#FF8C00]/35',
          doneBtn: 'btn-brand-submit bg-[#FF8C00] hover:bg-[#FF9E1F] text-white',
          secondaryBtn: 'bg-[#F1F5F9] hover:bg-[#E2E8F0] text-[#0F172A] border-[#CBD5E1]',
          editBtn: 'bg-[#F0FDFA] hover:bg-[#CCFBF1] text-[#0F766E] border-[#0D9488]/50',
          progressFill: 'bg-[#FF8C00]',
        };
      }
      return {
        cardBg: 'bg-[#1C2126]',
        cardBorder: 'border-[#FF8C00]/80',
        titleText: 'text-[#F1F5F9]',
        bodyText: 'text-[#CBD5E1]',
        mutedText: 'text-[#94A3B8]',
        accentText: 'text-[#FF8C00]',
        accentBg: 'bg-[#FF8C00]/15 border-[#FF8C00]/45',
        doneBtn: 'btn-brand-submit bg-[#FF8C00] hover:bg-[#FF9E1F] text-white',
        secondaryBtn: 'bg-[#252C33] hover:bg-[#2F3841] text-[#F1F5F9] border-[#333D47]',
        editBtn: 'bg-[#191E23] hover:bg-[#232A31] text-[#2DD4BF] border-[#14B8A6]/60',
        progressFill: 'bg-[#FF8C00]',
      };
    }
    case 'light-clean':
      return {
        cardBg: 'bg-white',
        cardBorder: 'border-[#FF8C00]/75',
        titleText: 'text-stone-900',
        bodyText: 'text-stone-700',
        mutedText: 'text-stone-500',
        accentText: 'text-[#FF8C00]',
        accentBg: 'bg-[#FF8C00]/10 border-[#FF8C00]/35',
        doneBtn: 'btn-brand-submit bg-[#FF8C00] hover:bg-[#FF9E1F] text-white',
        secondaryBtn: 'bg-stone-100 hover:bg-stone-200 text-stone-900 border-stone-300',
        editBtn: 'bg-teal-50 hover:bg-teal-100 text-teal-800 border-teal-600/50',
        progressFill: 'bg-[#FF8C00]',
      };
    case 'jade_warm_light':
      return {
        cardBg: 'bg-[#F7F6F0]',
        cardBorder: 'border-[#FF8C00]/75',
        titleText: 'text-[#202A29]',
        bodyText: 'text-[#3D4B49]',
        mutedText: 'text-[#5C6B68]',
        accentText: 'text-[#FF8C00]',
        accentBg: 'bg-[#FF8C00]/10 border-[#FF8C00]/35',
        doneBtn: 'btn-brand-submit bg-[#FF8C00] hover:bg-[#FF9E1F] text-white',
        secondaryBtn: 'bg-[#EFEFE8] hover:bg-[#E2E5DC] text-[#202A29] border-[#DDE1DA]',
        editBtn: 'bg-[#DDEFEA] hover:bg-[#CBE5DF] text-[#168779] border-[#168779]/50',
        progressFill: 'bg-[#FF8C00]',
      };
    case 'midnight_blue_silver':
      return {
        cardBg: 'bg-[#202B3A]',
        cardBorder: 'border-[#FF8C00]/80',
        titleText: 'text-[#F0F3F7]',
        bodyText: 'text-[#C5D9EE]',
        mutedText: 'text-[#9CBCE0]/80',
        accentText: 'text-[#FF8C00]',
        accentBg: 'bg-[#293648] border-[#FF8C00]/45',
        doneBtn: 'btn-brand-submit bg-[#FF8C00] hover:bg-[#FF9E1F] text-white',
        secondaryBtn: 'bg-[#172130] hover:bg-[#293648] text-[#F0F3F7] border-[#39475A]',
        editBtn: 'bg-[#293648] hover:bg-[#34445B] text-[#C5D9EE] border-[#9CBCE0]/60',
        progressFill: 'bg-[#FF8C00]',
      };
    case 'sketch-contrast':
      return {
        cardBg: 'bg-zinc-950',
        cardBorder: 'border-[#FF8C00] border-dashed',
        titleText: 'text-white',
        bodyText: 'text-zinc-300',
        mutedText: 'text-zinc-400',
        accentText: 'text-[#FF8C00]',
        accentBg: 'bg-zinc-900 border-[#FF8C00]/50 border-dashed',
        doneBtn: 'btn-brand-submit bg-[#FF8C00] hover:bg-[#FF9E1F] text-white border border-[#FF8C00]',
        secondaryBtn: 'bg-zinc-900 hover:bg-zinc-800 text-teal-300 border-dashed border-teal-500/60',
        editBtn: 'bg-zinc-900 hover:bg-zinc-800 text-white border-dashed border-white/70',
        progressFill: 'bg-[#FF8C00]',
      };
    case 'dark-gold':
    default:
      return {
        cardBg: 'bg-[#101222]',
        cardBorder: 'border-[#FF8C00]/80',
        titleText: 'text-[#F3F4F8]',
        bodyText: 'text-[#C7CBF0]',
        mutedText: 'text-[#8A90BD]',
        accentText: 'text-[#FF8C00]',
        accentBg: 'bg-[#FF8C00]/15 border-[#FF8C00]/45',
        doneBtn: 'btn-brand-submit bg-[#FF8C00] hover:bg-[#FF9E1F] text-white',
        secondaryBtn: 'bg-[#191C33] hover:bg-[#222646] text-[#F3F4F8] border-[#282C4A]',
        editBtn: 'bg-[#191C33] hover:bg-[#222646] text-[#818CF8] border-[#6366F1]/65',
        progressFill: 'bg-[#FF8C00]',
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
  const [isAudioMuted, setIsAudioMuted] = useState<boolean>(false);

  useEffect(() => {
    if (!reminder?.id) {
      return;
    }

    setSecondsLeft(60);
    setIsAudioMuted(false);

    try {
      window.dispatchEvent(new CustomEvent('yaad:stop-all-microphones'));
    } catch {
      // ignore
    }

    // Visual in-app alarm modal only: out-of-app notification handles the alarm audio so two sounds never play with a lag
    if (!isAppCurrentlyInForeground()) {
      triggerOutOfAppPersistentNotification(reminder, settings).catch(() => {});
    }

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

    // 60-second audio countdown timer: mutes the 1-minute alarm sound and schedules the +15m repeat,
    // while keeping this Full-Screen Alert Modal open on screen until the user explicitly reacts!
    const intervalId = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          window.clearInterval(intervalId);
          stopAlarmRinging();
          setIsAudioMuted(true);
          if (onNoReactionTimeout && reminder?.id) {
            onNoReactionTimeout(reminder.id);
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
      if (ttsTimer) clearTimeout(ttsTimer);
    };
  }, [
    reminder?.id,
    reminder?.dueTimestamp,
    reminder?.ringTune,
    settings?.alarmSound,
    settings?.alarmVolume,
    settings?.vibrationEnabled,
    settings?.language,
    settings?.ttsVoiceRate,
  ]);

  const isGeofenceAlarm = Boolean(reminder?.geofence?.enabled);
  const basePalette = getAlarmCardPalette(settings?.theme);
  const palette: CardThemePalette = isGeofenceAlarm
    ? {
        cardBg: 'bg-[#04231F]',
        cardBorder: 'border-emerald-400/90 shadow-emerald-950/80',
        titleText: 'text-emerald-50',
        bodyText: 'text-emerald-200/90',
        mutedText: 'text-teal-300/80',
        accentText: 'text-emerald-400',
        accentBg: 'bg-emerald-500/20 border-emerald-400/60',
        doneBtn: 'bg-emerald-500 hover:bg-emerald-400 text-stone-950 font-black',
        secondaryBtn: 'bg-[#083832] hover:bg-[#0D4A42] text-emerald-100 border-emerald-500/40',
        editBtn: 'bg-[#062E29] hover:bg-[#0A4039] text-cyan-300 border-cyan-400/50',
        progressFill: 'bg-emerald-400',
      }
    : basePalette;

  const getCategoryIcon = () => {
    switch (reminder?.category) {
      case 'work':
        return <Briefcase className="w-3.5 h-3.5" />;
      case 'family':
        return <Heart className="w-3.5 h-3.5" />;
      default:
        return <Tag className="w-3.5 h-3.5" />;
    }
  };

  const handleMuteAudio = () => {
    stopAlarmRinging();
    setIsAudioMuted(true);
  };

  const handleComplete = () => {
    if (!reminder) return;
    stopAlarmRinging();
    clearOutOfAppPersistentNotification(reminder.id).catch(() => {});
    onComplete(reminder.id);
  };

  const handlePostpone = (minutes: number) => {
    if (!reminder) return;
    stopAlarmRinging();
    clearOutOfAppPersistentNotification(reminder.id).catch(() => {});
    onPostpone(reminder.id, minutes);
  };

  const handleEdit = () => {
    if (!reminder) return;
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

  const dateFormatted = reminder ? formatJalaliFull(reminder.dueTimestamp, isEn ? 'en' : 'fa') : '';

  return (
    <AnimatePresence>
      {reminder && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 select-none"
          dir={isEn ? 'ltr' : 'rtl'}
        >
          <motion.div
            initial={{ scale: 0.92, y: 24, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.92, y: 24, opacity: 0 }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
            onClick={(e) => e.stopPropagation()}
            className={`w-full max-w-md rounded-3xl border-2 ${palette.cardBg} ${palette.cardBorder} shadow-2xl overflow-hidden transition-colors`}
          >
            {/* 1-Minute Audio Ringing Progress Bar */}
            <div className="w-full h-1.5 bg-black/30 overflow-hidden">
              <div
                className={`h-full transition-all duration-1000 ease-linear ${palette.progressFill}`}
                style={{ width: `${Math.max(0, (secondsLeft / 60) * 100)}%` }}
              />
            </div>

            <div className="p-5 sm:p-6 space-y-5">
              {/* Top Row: Close Button & Mute Audio Pill */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`inline-flex items-center gap-1.5 text-xs font-extrabold ${palette.accentText}`}>
                    {isGeofenceAlarm
                      ? isEn
                        ? '📡 YAAD Geofence Radar'
                        : '📡 رادار حصار مکانی یاد'
                      : isEn
                      ? '🔔 YAAD Full-Screen Reminder'
                      : '🔔 یادآور هوشمند یاد'}
                  </span>
                  <span className={palette.mutedText}>·</span>
                  <span className={`inline-flex items-center gap-1 text-xs font-bold ${palette.mutedText}`}>
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

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleMuteAudio();
                    }}
                    disabled={isAudioMuted}
                    className={`px-2.5 py-1.5 rounded-xl border text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                      isAudioMuted
                        ? 'border-stone-600/40 bg-stone-800/40 text-stone-400 cursor-default'
                        : 'border-rose-500/50 bg-rose-500/15 hover:bg-rose-500/25 text-rose-200 active:scale-95'
                    }`}
                  >
                    {isAudioMuted ? (
                      <>
                        <VolumeX className="w-3.5 h-3.5" />
                        <span>{isEn ? 'Muted' : 'بی‌صدا شد'}</span>
                      </>
                    ) : (
                      <>
                        <Volume2 className="w-3.5 h-3.5 animate-pulse" />
                        <span>{isEn ? 'Mute' : 'قطع صدا'}</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDismiss();
                    }}
                    className={`p-1.5 rounded-xl transition-colors cursor-pointer ${palette.mutedText} hover:opacity-100`}
                    title={isEn ? 'Dismiss' : 'بستن'}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Centered Pulsing App Emblem */}
              <div className="flex flex-col items-center justify-center pt-1 pb-1">
                {isGeofenceAlarm ? (
                  <div className="relative w-20 h-20 rounded-3xl border-2 border-emerald-400/80 bg-[#073831] flex items-center justify-center shrink-0 overflow-visible shadow-xl shadow-emerald-950/90">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-3xl opacity-30 bg-emerald-400" />
                    <img
                      src={appIcon}
                      alt="YAAD"
                      className="relative z-10 w-16 h-16 object-contain rounded-2xl"
                      draggable={false}
                    />
                    <motion.div
                      animate={{
                        scale: [1, 1.28, 0.95, 1.22, 1],
                        y: [0, -2, 0, -1.5, 0],
                      }}
                      transition={{
                        duration: 1.25,
                        repeat: Infinity,
                        ease: 'easeInOut',
                      }}
                      className="absolute -top-2 -right-2 z-20 w-7 h-7 rounded-full bg-emerald-500 border-2 border-white flex items-center justify-center shadow-[0_0_12px_rgba(16,185,129,0.95)]"
                    >
                      <MapPin className="w-4 h-4 text-stone-950 fill-stone-950" />
                    </motion.div>
                  </div>
                ) : (
                  <div
                    className={`relative w-20 h-20 rounded-3xl border-2 flex items-center justify-center shrink-0 overflow-visible shadow-xl ${palette.accentBg} ${palette.accentText}`}
                  >
                    {!isAudioMuted && (
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-3xl opacity-25 bg-current" />
                    )}
                    <img
                      src={appIcon}
                      alt="YAAD"
                      className="relative z-10 w-16 h-16 object-contain rounded-2xl"
                      draggable={false}
                    />
                  </div>
                )}
              </div>

              {/* Main Reminder Content */}
              <div className="space-y-2.5 text-center">
                <div
                  className={`px-4 py-3.5 rounded-2xl border ${
                    isGeofenceAlarm
                      ? 'border-emerald-400/50 bg-emerald-500/15'
                      : 'border-[#FF8C00]/45 bg-[#FF8C00]/12'
                  }`}
                >
                  <h2 className={`text-xl sm:text-2xl font-black tracking-tight leading-snug ${palette.titleText}`}>
                    {reminder.title}
                  </h2>
                </div>

                <div className={`text-xs sm:text-sm font-bold ${palette.mutedText} flex items-center justify-center gap-2 flex-wrap`}>
                  <span>{dateFormatted}</span>
                  {reminder.recurrence && reminder.recurrence !== 'none' && (
                    <>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1">
                        <Repeat className="w-3.5 h-3.5" />
                        <span>{getRecurrenceLabel(reminder, isEn ? 'en' : 'fa')}</span>
                      </span>
                    </>
                  )}
                </div>

                {reminder.description && (
                  <p className={`text-xs sm:text-sm font-medium leading-relaxed pt-1 ${palette.bodyText}`}>
                    {reminder.description}
                  </p>
                )}

                {typeof reminder.geofence?.latitude === 'number' &&
                  typeof reminder.geofence?.longitude === 'number' && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openGoogleMapsDirections(
                          reminder.geofence!.latitude,
                          reminder.geofence!.longitude,
                          reminder.geofence?.locationName || reminder.title
                        );
                      }}
                      className="w-full mt-2 min-h-[42px] py-2.5 px-3 rounded-xl font-bold text-xs sm:text-sm border border-sky-400/50 bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 transition-all cursor-pointer active:scale-95 flex items-center justify-center gap-1.5"
                    >
                      <Navigation className="w-4 h-4 shrink-0" />
                      <span>{isEn ? 'Directions in Google Maps' : 'مسیریابی در گوگل‌مپ'}</span>
                    </button>
                  )}
              </div>

              {/* Primary + Secondary Action Buttons */}
              <div
                onClick={(e) => e.stopPropagation()}
                className="space-y-2.5 pt-1"
              >
                {/* 1. Primary Full-Width Done Button */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleComplete();
                  }}
                  className={`w-full min-h-[50px] py-3 px-4 rounded-2xl font-black text-sm sm:text-base transition-all cursor-pointer active:scale-95 flex items-center justify-center gap-2 shadow-lg ${palette.doneBtn}`}
                >
                  <CheckCircle2 className="w-5 h-5 shrink-0" />
                  <span className="truncate">{isEn ? 'Done' : 'انجام شد'}</span>
                </button>

                <div className="grid grid-cols-2 gap-2.5">
                  {/* 2. Snooze (+15m) */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePostpone(15);
                    }}
                    className={`min-h-[46px] py-2.5 px-3 rounded-2xl font-bold text-xs sm:text-sm border transition-all cursor-pointer active:scale-95 flex items-center justify-center gap-1.5 ${palette.secondaryBtn}`}
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
                    className={`min-h-[46px] py-2.5 px-3 rounded-2xl font-bold text-xs sm:text-sm border transition-all cursor-pointer active:scale-95 flex items-center justify-center gap-1.5 ${palette.editBtn}`}
                  >
                    <Edit2 className="w-4 h-4 shrink-0" />
                    <span className="truncate">{isEn ? 'Edit' : 'ویرایش'}</span>
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};



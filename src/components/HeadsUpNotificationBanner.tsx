import React, { useState, useEffect } from 'react';
import { Reminder, AppSettings, PhoneAlarmSound } from '../types';
import { formatJalaliTime } from '../utils/jalali';
import { startAlarmRinging, stopAlarmRinging } from '../utils/audio';
import { startFlashlightStrobe, stopFlashlightStrobe } from '../utils/torch';
import { 
  Bell, 
  CheckCircle2, 
  Clock, 
  ChevronDown, 
  ChevronUp, 
  X, 
  Maximize2 
} from 'lucide-react';
import { AppLanguage } from '../utils/i18n';

interface HeadsUpNotificationBannerProps {
  reminder: Reminder | null;
  settings?: AppSettings;
  language?: AppLanguage;
  onComplete: (id: string) => void;
  onPostpone: (id: string, minutes: number) => void;
  onDismiss: () => void;
  onOpenDetails?: (reminder: Reminder) => void;
}

export const HeadsUpNotificationBanner: React.FC<HeadsUpNotificationBannerProps> = ({
  reminder,
  settings,
  language = 'fa',
  onComplete,
  onPostpone,
  onDismiss,
  onOpenDetails,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const isEn = language === 'en';

  useEffect(() => {
    if (!reminder) {
      stopAlarmRinging();
      stopFlashlightStrobe();
      return;
    }

    // Play alarm audio sound & vibration
    const sound: PhoneAlarmSound = (reminder.ringTune as PhoneAlarmSound) || settings?.alarmSound || 'digital-beep';
    const vol = settings?.alarmVolume !== undefined ? settings.alarmVolume : 0.85;
    startAlarmRinging(reminder.category, sound, vol);

    // Strobe camera flash if enabled
    if (reminder.useFlash || settings?.enableFlash) {
      startFlashlightStrobe().catch(() => {});
    }

    return () => {
      stopAlarmRinging();
      stopFlashlightStrobe();
    };
  }, [reminder]);

  if (!reminder) return null;

  const handleComplete = (e: React.MouseEvent) => {
    e.stopPropagation();
    stopAlarmRinging();
    stopFlashlightStrobe();
    onComplete(reminder.id);
  };

  const handlePostpone = (e: React.MouseEvent, minutes: number = 15) => {
    e.stopPropagation();
    stopAlarmRinging();
    stopFlashlightStrobe();
    onPostpone(reminder.id, minutes);
  };

  const handleDismiss = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    stopAlarmRinging();
    stopFlashlightStrobe();
    onDismiss();
  };

  const handleCardClick = () => {
    if (onOpenDetails) {
      stopAlarmRinging();
      stopFlashlightStrobe();
      onOpenDetails(reminder);
    } else {
      setIsExpanded((prev) => !prev);
    }
  };

  // Format header time text: "Today, 23:45" / "امروز، ۲۳:۴۵" matching Samsung Reminder screenshot
  const timeFormatted = formatJalaliTime(reminder.dueTimestamp, language);
  const timeLabel = isEn ? `Today, ${timeFormatted}` : `امروز، ${timeFormatted}`;

  return (
    <div 
      className="fixed top-2.5 sm:top-4 inset-x-2.5 sm:inset-x-4 md:inset-x-6 max-w-xl mx-auto z-50 pointer-events-auto transition-all duration-300 animate-in fade-in slide-in-from-top-4"
      dir={isEn ? 'ltr' : 'rtl'}
    >
      <div 
        onClick={handleCardClick}
        className="w-full bg-[#18181b]/95 hover:bg-[#1f1f23] text-white border-2 border-indigo-500/80 rounded-3xl sm:rounded-full shadow-[0_10px_35px_rgba(0,0,0,0.85)] shadow-indigo-950/50 backdrop-blur-2xl transition-all duration-200 cursor-pointer overflow-hidden p-2 sm:px-3 sm:py-2"
      >
        {/* Main Sleek Pill Row (مطابق تصویر ارسالی کاربر) */}
        <div className="flex items-center justify-between gap-2.5">
          {/* Left: Purple Circular Badge with White Bell (آیکون بنفش با زنگوله سفید) */}
          <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center shrink-0 shadow-lg shadow-indigo-600/40 ring-2 ring-indigo-400/50 animate-pulse">
            <Bell className="w-5 h-5 fill-white stroke-[2.2]" />
          </div>

          {/* Center: App Name & Title */}
          <div className="min-w-0 flex-1 px-1">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-[10px] font-black uppercase tracking-wider text-indigo-400 font-sans">
                {isEn ? 'Reminder' : 'یادآور • Reminder'}
              </span>
            </div>
            <h4 className="font-extrabold text-sm sm:text-base text-white truncate leading-snug">
              {reminder.title}
            </h4>
            {reminder.description && (
              <p className="text-[11px] text-stone-300/80 truncate mt-0.5">
                {reminder.description}
              </p>
            )}
          </div>

          {/* Right: "Today, 23:45" / "امروز، ۲۳:۴۵" + Expand Chevron */}
          <div className="flex items-center gap-1.5 shrink-0 text-stone-300">
            <span className="font-mono text-xs sm:text-sm font-semibold tracking-tight text-stone-200 bg-stone-900/90 px-2 py-1 rounded-xl border border-stone-700/60">
              {timeLabel}
            </span>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsExpanded((prev) => !prev);
              }}
              className="p-1 rounded-full text-stone-400 hover:text-white hover:bg-stone-800 transition-colors cursor-pointer"
              title={isExpanded ? (isEn ? 'Collapse' : 'بستن منو') : (isEn ? 'Expand options' : 'نمایش گزینه‌ها')}
            >
              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Quick Actions Direct Row (بدون نیاز به کلیک اضافه - نوتیف کرکره‌ای در دسترس فوری) */}
        <div 
          onClick={(e) => e.stopPropagation()}
          className="mt-2 pt-2 border-t border-stone-800/80 flex items-center justify-between gap-1.5 px-0.5 text-xs animate-in fade-in"
        >
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            {/* Complete */}
            <button
              type="button"
              onClick={handleComplete}
              className="flex-1 py-1.5 px-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black transition-all flex items-center justify-center gap-1.5 shadow-md shadow-emerald-950/40 active:scale-95 cursor-pointer text-xs"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{isEn ? 'Done' : 'تیک / انجام شد'}</span>
            </button>

            {/* Snooze 15m */}
            <button
              type="button"
              onClick={(e) => handlePostpone(e, 15)}
              className="py-1.5 px-2.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-amber-300 font-bold border border-amber-500/30 transition-all flex items-center justify-center gap-1 active:scale-95 cursor-pointer text-xs shrink-0"
            >
              <Clock className="w-3.5 h-3.5" />
              <span>{isEn ? '+15m' : '+۱۵د'}</span>
            </button>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {onOpenDetails && (
              <button
                type="button"
                onClick={() => {
                  stopAlarmRinging();
                  stopFlashlightStrobe();
                  onOpenDetails(reminder);
                }}
                className="p-1.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-200 transition-all active:scale-95 cursor-pointer"
                title={isEn ? 'Open Full View' : 'جزئیات یادآور'}
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Dismiss */}
            <button
              type="button"
              onClick={handleDismiss}
              className="p-1.5 rounded-xl text-stone-400 hover:text-white hover:bg-stone-800 transition-colors cursor-pointer"
              title={isEn ? 'Close' : 'بستن'}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

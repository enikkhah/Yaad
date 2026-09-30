import React, { useState, useEffect } from 'react';
import { Reminder, AppTheme } from '../types';
import { toPersianDigits, formatJalaliTime } from '../utils/jalali';
import { playRingTune, speakReminderText } from '../utils/audio';
import { getRecurrenceLabel } from '../utils/recurrence';
import { getThemeStyles } from '../utils/themeStyles';
import { AppLanguage } from '../utils/i18n';
import { 
  Bell, 
  CheckCircle2, 
  Clock, 
  Volume2, 
  X,
  Repeat
} from 'lucide-react';

interface FloatingNotificationProps {
  upcomingReminder: Reminder | null;
  theme?: AppTheme;
  language?: AppLanguage;
  onToggleComplete: (id: string) => void;
  onPostpone: (id: string, minutes: number) => void;
  onSelectReminder?: (reminder: Reminder) => void;
}

export const FloatingNotification: React.FC<FloatingNotificationProps> = ({
  upcomingReminder,
  theme,
  language = 'fa',
  onToggleComplete,
  onPostpone,
  onSelectReminder,
}) => {
  const [isDismissed, setIsDismissed] = useState(false);

  const [nowTime, setNowTime] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!upcomingReminder || isDismissed) return null;

  const diffMs = Math.max(0, upcomingReminder.dueTimestamp - nowTime);
  const diffSecs = Math.floor(diffMs / 1000);
  const hours = Math.floor(diffSecs / 3600);
  const mins = Math.floor((diffSecs % 3600) / 60);
  const secs = diffSecs % 60;
  const timeFormatted = `${hours > 0 ? toPersianDigits(hours) + ':' : ''}${toPersianDigits(mins.toString().padStart(2, '0'))}:${toPersianDigits(secs.toString().padStart(2, '0'))}`;
  const themeStyles = getThemeStyles(theme);

  const handleSpeak = (e: React.MouseEvent) => {
    e.stopPropagation();
    playRingTune(upcomingReminder.category);
    speakReminderText(
      upcomingReminder.title,
      upcomingReminder.category === 'work' ? 'کاری' : upcomingReminder.category === 'family' ? 'خانوادگی' : 'سایر'
    );
  };

  return (
    <div 
      className="fixed bottom-2.5 inset-x-2.5 sm:inset-x-4 md:inset-x-8 z-30 pointer-events-auto transition-all duration-300 animate-in fade-in slide-in-from-bottom-3"
      dir={language === 'en' ? 'ltr' : 'rtl'}
    >
      <div 
        onClick={() => onSelectReminder?.(upcomingReminder)}
        className="w-full flex items-center justify-between gap-2.5 sm:gap-4 p-2.5 sm:px-4 sm:py-3 rounded-2xl bg-stone-900/95 hover:bg-stone-900 border-2 border-teal-500/60 hover:border-teal-400/80 shadow-2xl shadow-teal-950/70 backdrop-blur-xl text-stone-100 cursor-pointer group"
      >
        {/* Right side: "بعدی" Label + Title */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
          <div className="flex items-center gap-1 sm:gap-1.5 px-2.5 py-1 rounded-xl bg-teal-600 text-white font-black text-xs sm:text-sm flex-shrink-0 shadow-md shadow-teal-600/30">
            <Bell className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white fill-white" />
            <span>{language === 'en' ? 'Next:' : 'بعدی:'}</span>
          </div>

          <div className="min-w-0 flex-1 flex items-center gap-2">
            <span className="font-extrabold text-xs sm:text-sm md:text-base text-white truncate group-hover:text-teal-300 transition-colors">
              {upcomingReminder.title}
            </span>

            {/* Time badge */}
            <span className="hidden xs:inline-flex items-center gap-1 font-mono text-[11px] sm:text-xs font-bold text-teal-300 bg-stone-950/80 px-2 py-0.5 rounded-lg border border-teal-500/30 whitespace-nowrap">
              <Clock className="w-3 h-3 text-teal-400" />
              {formatJalaliTime(upcomingReminder.dueTimestamp)}
            </span>

            {/* Countdown Badge */}
            <span className="hidden sm:inline-flex items-center gap-1 font-mono text-[11px] text-teal-200 bg-teal-500/20 px-2 py-0.5 rounded-lg font-bold border border-teal-500/30 whitespace-nowrap">
              <Clock className="w-3 h-3 text-teal-400" />
              <span>{diffSecs <= 0 ? (language === 'en' ? 'Now' : 'اکنون') : `${timeFormatted} دیگر`}</span>
            </span>

            {/* Recurrence Badge if recurring */}
            {upcomingReminder.recurrence && upcomingReminder.recurrence !== 'none' && (
              <span className="hidden lg:inline-flex items-center gap-1 text-[11px] text-indigo-300 bg-indigo-500/20 px-2 py-0.5 rounded-lg font-bold border border-indigo-500/30 whitespace-nowrap">
                <Repeat className="w-3 h-3 text-indigo-400" />
                <span>{getRecurrenceLabel(upcomingReminder)}</span>
              </span>
            )}
          </div>
        </div>

        {/* Left side: Quick action buttons */}
        <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          {/* Complete Button */}
          <button
            type="button"
            onClick={() => onToggleComplete(upcomingReminder.id)}
            className="p-1.5 sm:px-2.5 sm:py-1.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white border border-teal-400/40 text-xs font-bold transition-all flex items-center gap-1 active:scale-95"
            title={language === 'en' ? 'Done' : 'انجام شد (خاتمه)'}
          >
            <CheckCircle2 className="w-4 h-4 text-white" />
            <span className="hidden md:inline">{language === 'en' ? 'Done' : 'انجام'}</span>
          </button>

          {/* Postpone Button */}
          <button
            type="button"
            onClick={() => onPostpone(upcomingReminder.id, 15)}
            className="px-2 sm:px-2.5 py-1.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-teal-200 hover:text-white border border-teal-500/30 text-xs font-bold transition-all active:scale-95"
            title={language === 'en' ? '+15m Snooze' : 'تعویق ۱۵ دقیقه'}
          >
            {language === 'en' ? '+15m' : '+۱۵د'}
          </button>

          {/* Speak Button */}
          <button
            type="button"
            onClick={handleSpeak}
            className="p-1.5 sm:p-2 rounded-xl bg-stone-800 hover:bg-stone-700 text-teal-400 hover:text-teal-300 transition-colors border border-teal-500/25"
            title={language === 'en' ? 'Read Aloud' : 'قرائت صوتی'}
          >
            <Volume2 className="w-4 h-4" />
          </button>

          {/* Dismiss Button */}
          <button
            type="button"
            onClick={() => setIsDismissed(true)}
            className="p-1.5 sm:p-2 rounded-xl text-stone-400 hover:text-white hover:bg-stone-800 transition-colors"
            title={language === 'en' ? 'Close' : 'بستن'}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

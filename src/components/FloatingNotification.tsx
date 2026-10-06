import React, { useState, useEffect } from 'react';
import { Reminder, AppTheme } from '../types';
import { formatJalaliTime } from '../utils/jalali';
import { playRingTune, speakReminderText } from '../utils/audio';
import { getRecurrenceLabel } from '../utils/recurrence';
import { getThemeStyles } from '../utils/themeStyles';
import { AppLanguage } from '../utils/i18n';
import { NeonClock } from './NeonClock';
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
  const isEn = language === 'en';

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
      dir={isEn ? 'ltr' : 'rtl'}
    >
      <div 
        onClick={() => onSelectReminder?.(upcomingReminder)}
        className="w-full flex items-center justify-between gap-2 sm:gap-3 p-2 sm:px-4 sm:py-2.5 rounded-2xl bg-stone-900/95 hover:bg-stone-900 border-2 border-teal-500/70 hover:border-teal-400 shadow-2xl shadow-teal-950/80 backdrop-blur-xl text-stone-100 cursor-pointer group"
      >
        {/* Leading: "بعدی" / "Next:" Label + Title + Countdown Clock */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
          <div className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 rounded-xl bg-teal-600 text-white font-black text-xs sm:text-sm flex-shrink-0 shadow-md shadow-teal-600/30">
            <Bell className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white fill-white" />
            <span>{isEn ? 'Next:' : 'بعدی:'}</span>
          </div>

          <div className="min-w-0 flex-1 flex items-center gap-2">
            <span className="font-extrabold text-xs sm:text-sm md:text-base text-white truncate group-hover:text-teal-300 transition-colors">
              {upcomingReminder.title}
            </span>

            {/* Time badge */}
            <span className="hidden xs:inline-flex items-center gap-1 font-mono text-[11px] sm:text-xs font-bold text-teal-300 bg-stone-950/80 px-2 py-0.5 rounded-lg border border-teal-500/30 whitespace-nowrap">
              <Clock className="w-3 h-3 text-teal-400" />
              {formatJalaliTime(upcomingReminder.dueTimestamp, language)}
            </span>

            {/* Recurrence Badge if recurring */}
            {upcomingReminder.recurrence && upcomingReminder.recurrence !== 'none' && (
              <span className="hidden xl:inline-flex items-center gap-1 text-[11px] text-indigo-300 bg-indigo-500/20 px-2 py-0.5 rounded-lg font-bold border border-indigo-500/30 whitespace-nowrap">
                <Repeat className="w-3 h-3 text-indigo-400" />
                <span>{getRecurrenceLabel(upcomingReminder, language)}</span>
              </span>
            )}
          </div>

          {/* Neon Countdown Clock - Same size (xs) and format as current time clock, with colorful border */}
          <div className="self-center flex items-center shrink-0 px-2 py-0.5 rounded-xl border border-cyan-400/60 bg-stone-950/90 shadow-[0_0_12px_rgba(6,182,212,0.3)]">
            <NeonClock
              hours={hours}
              minutes={mins}
              seconds={secs}
              size="xs"
              color="cyan"
            />
          </div>
        </div>

        {/* Trailing: Quick action buttons */}
        <div className="flex items-center gap-1 sm:gap-1.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          {/* Complete Button */}
          <button
            type="button"
            onClick={() => onToggleComplete(upcomingReminder.id)}
            className="p-1.5 sm:px-2.5 sm:py-1.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white border border-teal-400/40 text-xs font-bold transition-all flex items-center gap-1 active:scale-95 cursor-pointer shadow-sm"
            title={isEn ? 'Done (Complete)' : 'انجام شد (خاتمه)'}
          >
            <CheckCircle2 className="w-4 h-4 text-white" />
            <span className="hidden md:inline">{isEn ? 'Done' : 'انجام'}</span>
          </button>

          {/* Postpone Button */}
          <button
            type="button"
            onClick={() => onPostpone(upcomingReminder.id, 15)}
            className="px-2 sm:px-2.5 py-1.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-teal-200 hover:text-white border border-teal-500/30 text-xs font-bold transition-all active:scale-95 cursor-pointer"
            title={isEn ? '+15m Snooze' : 'تعویق ۱۵ دقیقه'}
          >
            {isEn ? '+15m' : '+۱۵د'}
          </button>

          {/* Speak Button */}
          <button
            type="button"
            onClick={handleSpeak}
            className="p-1.5 sm:p-2 rounded-xl bg-stone-800 hover:bg-stone-700 text-teal-400 hover:text-teal-300 transition-colors border border-teal-500/25 cursor-pointer"
            title={isEn ? 'Read Aloud' : 'قرائت صوتی'}
          >
            <Volume2 className="w-4 h-4" />
          </button>

          {/* Dismiss Button */}
          <button
            type="button"
            onClick={() => setIsDismissed(true)}
            className="p-1.5 sm:p-2 rounded-xl text-stone-400 hover:text-white hover:bg-stone-800 transition-colors cursor-pointer"
            title={isEn ? 'Close' : 'بستن'}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

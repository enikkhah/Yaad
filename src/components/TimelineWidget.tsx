import React, { useState, useEffect } from 'react';
import { Reminder } from '../types';
import { toPersianDigits, formatJalaliTime } from '../utils/jalali';
import { NeonClock } from './NeonClock';
import { AppLanguage } from '../utils/i18n';
import { 
  Clock, 
  CheckCircle2, 
  Briefcase, 
  Heart, 
  Tag, 
  Repeat 
} from 'lucide-react';

interface TimelineWidgetProps {
  reminders: Reminder[];
  onToggleComplete: (id: string) => void;
  onPostpone: (id: string, minutes: number) => void;
  onSelectReminder: (reminder: Reminder) => void;
  timelineMode?: 'modern' | 'sketch';
  language?: AppLanguage;
  countdown?: { hours: number; minutes: number; seconds: number } | null;
}

export const TimelineWidget: React.FC<TimelineWidgetProps> = ({
  reminders,
  onToggleComplete,
  onPostpone,
  onSelectReminder,
  timelineMode = 'modern',
  language = 'fa',
  countdown = null,
}) => {
  const isEn = language === 'en';
  const [currentTime, setCurrentTime] = useState<Date>(new Date());
  const [activeFilter, setActiveFilter] = useState<'range' | 'today' | 'all'>('range');

  // Live clock for current time display
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const nowMs = currentTime.getTime();
  const windowStartMs = nowMs - 6 * 3600 * 1000;
  const windowEndMs = nowMs + 12 * 3600 * 1000;

  // Filter reminders based on active view
  const filteredReminders = reminders.filter((r) => {
    if (activeFilter === 'range') {
      return r.dueTimestamp >= windowStartMs && r.dueTimestamp <= windowEndMs;
    }
    if (activeFilter === 'today') {
      const d = new Date(r.dueTimestamp);
      return (
        d.getDate() === currentTime.getDate() &&
        d.getMonth() === currentTime.getMonth() &&
        d.getFullYear() === currentTime.getFullYear()
      );
    }
    return true;
  }).sort((a, b) => a.dueTimestamp - b.dueTimestamp);

  // Split into Past (بالا) and Future (پایین)
  const pastReminders = filteredReminders.filter((r) => r.dueTimestamp < nowMs);
  const futureReminders = filteredReminders.filter((r) => r.dueTimestamp >= nowMs);

  const getCategoryStyles = (category: Reminder['category']) => {
    switch (category) {
      case 'work':
        return {
          dot: 'bg-cyan-400 shadow-cyan-500/50',
          label: isEn ? 'Work' : 'کار',
          icon: <Briefcase className="w-3.5 h-3.5 text-cyan-400" />,
        };
      case 'family':
        return {
          dot: 'bg-rose-400 shadow-rose-500/50',
          label: isEn ? 'Family' : 'خانواده',
          icon: <Heart className="w-3.5 h-3.5 text-rose-400" />,
        };
      default:
        return {
          dot: 'bg-emerald-400 shadow-emerald-500/50',
          label: isEn ? 'Other' : 'سایر',
          icon: <Tag className="w-3.5 h-3.5 text-emerald-400" />,
        };
    }
  };

  const getPriorityBadge = (p: Reminder['priority']) => {
    switch (p) {
      case 'high':
        return (
          <span className="text-[10px] sm:text-[11px] px-1.5 py-0.5 rounded-md bg-red-500/20 text-red-300 border border-red-500/30 font-bold shrink-0">
            {isEn ? 'High' : 'فوری'}
          </span>
        );
      case 'medium':
        return (
          <span className="text-[10px] sm:text-[11px] px-1.5 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold shrink-0">
            {isEn ? 'Medium' : 'متوسط'}
          </span>
        );
      default:
        return (
          <span className="text-[10px] sm:text-[11px] px-1.5 py-0.5 rounded-md bg-blue-500/20 text-blue-300 border border-blue-500/30 font-bold shrink-0">
            {isEn ? 'Normal' : 'عادی'}
          </span>
        );
    }
  };

  // Find the absolute next pending reminder across all reminders
  const nextPendingReminder = reminders
    .filter((r) => (r.status === 'pending' || r.status === 'postponed') && r.dueTimestamp >= nowMs)
    .sort((a, b) => a.dueTimestamp - b.dueTimestamp)[0] || null;

  // Ensure next pending reminder is present in futureReminders list even if outside range filter
  let displayFutureReminders = [...futureReminders];
  if (nextPendingReminder && !displayFutureReminders.some((r) => r.id === nextPendingReminder.id)) {
    displayFutureReminders = [nextPendingReminder, ...displayFutureReminders].sort((a, b) => a.dueTimestamp - b.dueTimestamp);
  }

  return (
    <div 
      id="timeline-widget-root" 
      dir={isEn ? 'ltr' : 'rtl'}
      className={`w-full max-w-full overflow-hidden rounded-2xl p-3 sm:p-4 md:p-5 transition-all duration-300 border ${
        timelineMode === 'sketch'
          ? 'bg-black text-white border-dashed border-stone-600 font-mono shadow-2xl'
          : 'bg-gradient-to-b from-stone-900/95 via-stone-900/90 to-stone-950 text-stone-100 border-stone-800/90 shadow-xl'
      }`}
    >
      {/* Header section - Clean: Just Icon + Title, and subtle filters */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 pb-3 mb-3 sm:mb-4 border-b border-stone-800">
        <div className="flex items-center gap-2">
          <div className="p-1.5 sm:p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
            <Clock className="w-4 h-4 sm:w-5 sm:h-5 text-amber-400" />
          </div>
          <h3 className="font-black text-sm sm:text-base text-white tracking-wide">
            {isEn ? 'Timeline' : 'تایم‌لاین'}
          </h3>
        </div>

        {/* Time range filters */}
        <div className="flex items-center gap-1 self-stretch sm:self-auto justify-end">
          <div className="flex bg-stone-800/80 p-0.5 sm:p-1 rounded-xl border border-stone-700/60 text-[11px] sm:text-xs font-bold">
            <button
              id="timeline-filter-range"
              type="button"
              onClick={() => setActiveFilter('range')}
              className={`px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg transition-all cursor-pointer ${
                activeFilter === 'range'
                  ? 'bg-stone-900 border border-amber-400/80 text-amber-300 font-black shadow-sm'
                  : 'text-stone-400 hover:text-white'
              }`}
            >
              {isEn ? 'Recent & Next' : 'بازه فعلی'}
            </button>
            <button
              id="timeline-filter-today"
              type="button"
              onClick={() => setActiveFilter('today')}
              className={`px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg transition-all cursor-pointer ${
                activeFilter === 'today'
                  ? 'bg-stone-900 border border-amber-400/80 text-amber-300 font-black shadow-sm'
                  : 'text-stone-400 hover:text-white'
              }`}
            >
              {isEn ? 'Today' : 'امروز'}
            </button>
            <button
              id="timeline-filter-all"
              type="button"
              onClick={() => setActiveFilter('all')}
              className={`px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg transition-all cursor-pointer ${
                activeFilter === 'all'
                  ? 'bg-stone-900 border border-amber-400/80 text-amber-300 font-black shadow-sm'
                  : 'text-stone-400 hover:text-white'
              }`}
            >
              {isEn ? `All (${reminders.length})` : `همه (${toPersianDigits(reminders.length)})`}
            </button>
          </div>
        </div>
      </div>

      {/* VERTICAL TIMELINE - Contained without horizontal overflow */}
      <div className="relative py-1 w-full overflow-hidden">
        <div className="relative w-full">
          {/* Vertical Axis Line - Safely positioned within container boundaries */}
          <div 
            className={`absolute top-2 bottom-2 ${isEn ? 'left-2.5 sm:left-3' : 'right-2.5 sm:right-3'} w-0.5 rounded-full ${
              timelineMode === 'sketch' 
                ? 'bg-white border-l border-dashed border-white' 
                : 'bg-stone-800'
            }`} 
          />

          {/* SECTION 1: PAST REMINDERS */}
          <div className={`space-y-2.5 mb-4 ${isEn ? 'pl-6 sm:pl-7' : 'pr-6 sm:pr-7'} transition-all duration-300`}>
            {pastReminders.length === 0 ? (
              <div className="py-2 text-stone-500 text-xs font-medium">
                {isEn ? 'No reminders in past 6 hours' : 'بدون یادآور در ۶ ساعت قبل'}
              </div>
            ) : (
              pastReminders.map((r) => {
                const cat = getCategoryStyles(r.category);
                const isCompleted = r.status === 'completed';
                return (
                  <div
                    key={r.id}
                    onClick={() => onSelectReminder(r)}
                    className={`group relative p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl border transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                      isCompleted
                        ? 'bg-stone-900/40 border-stone-800/80 opacity-60 hover:opacity-90'
                        : 'bg-stone-900/80 border-stone-800 hover:border-amber-500/40 shadow-sm'
                    }`}
                  >
                    {/* Connected Timeline Dot */}
                    <div 
                      className={`absolute ${isEn ? '-left-5 sm:-left-5.5' : '-right-5 sm:-right-5.5'} top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-stone-950 flex items-center justify-center ${
                        isCompleted ? 'bg-emerald-500' : cat.dot
                      }`}
                    >
                      <div className="w-1 h-1 rounded-full bg-white" />
                    </div>

                    <div className="flex items-center gap-2.5 flex-1 min-w-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleComplete(r.id);
                        }}
                        className={`p-1 rounded-lg transition-all active:scale-95 cursor-pointer shrink-0 ${
                          isCompleted ? 'text-emerald-400 bg-emerald-500/20' : 'text-stone-400 hover:text-white bg-stone-800'
                        }`}
                      >
                        <CheckCircle2 className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
                      </button>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-xs sm:text-sm text-stone-200 truncate group-hover:text-amber-300 transition-colors">
                            {r.title}
                          </span>
                          {getPriorityBadge(r.priority)}
                          {r.recurrence && r.recurrence !== 'none' && (
                            <span title={isEn ? 'Recurring Reminder' : 'یادآور تکرارشونده'} className="flex items-center">
                              <Repeat className="w-3 h-3 text-indigo-400 flex-shrink-0" />
                            </span>
                          )}
                        </div>
                        {r.description && (
                          <p className="text-[11px] sm:text-xs text-stone-400 truncate mt-0.5">
                            {r.description}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-stone-300 self-end sm:self-center shrink-0">
                      <span className="flex items-center gap-1 font-mono bg-stone-800/90 px-2 py-0.5 rounded-md text-stone-300 text-[11px] sm:text-xs border border-stone-700/60">
                        <Clock className="w-3 h-3 text-amber-400" />
                        {formatJalaliTime(r.dueTimestamp, language)}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* CENTER: THE "NOW" DIVIDER - PRESERVED MAIN CLOCK AND CURRENT TIME INDICATOR */}
          <div className="relative my-3 sm:my-4 py-2 border-y border-dashed border-amber-500/40 bg-amber-500/5 rounded-xl px-2.5 sm:px-3 flex items-center justify-between gap-2 shadow-sm">
            {/* Glowing Pulse Point for Current Time */}
            <div className={`absolute ${isEn ? 'left-2.5 sm:left-3 -translate-x-1/2' : 'right-2.5 sm:right-3 translate-x-1/2'} w-3 h-3 rounded-full bg-amber-400 flex items-center justify-center shadow-lg shadow-amber-500/50 z-10`}>
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
              <span className="w-1 h-1 rounded-full bg-stone-950" />
            </div>

            {/* "اکنون" / "Now" badge */}
            <div className={`flex items-center ${isEn ? 'pl-4 sm:pl-5' : 'pr-4 sm:pr-5'}`}>
              <span className="px-2.5 py-0.5 rounded-lg bg-amber-500 text-stone-950 font-black text-xs tracking-wide shadow-sm">
                {isEn ? 'Now' : 'اکنون'}
              </span>
            </div>

            {/* Live Neon Clock displaying actual current time */}
            <div className="self-center flex items-center">
              <NeonClock
                hours={currentTime.getHours()}
                minutes={currentTime.getMinutes()}
                seconds={currentTime.getSeconds()}
                size="xs"
                color="amber"
              />
            </div>
          </div>

          {/* SECTION 2: FUTURE REMINDERS */}
          <div className={`space-y-2.5 mt-4 ${isEn ? 'pl-6 sm:pl-7' : 'pr-6 sm:pr-7'} transition-all duration-300`}>
            {displayFutureReminders.length === 0 ? (
              <div className="py-2 text-stone-500 text-xs font-medium">
                {isEn ? 'No reminders in next 12 hours' : 'بدون یادآور در ۱۲ ساعت آینده'}
              </div>
            ) : (
              displayFutureReminders.map((r) => {
                const cat = getCategoryStyles(r.category);
                const isCompleted = r.status === 'completed';
                const isNext = r.id === nextPendingReminder?.id && !isCompleted;

                return (
                  <div
                    key={r.id}
                    onClick={() => onSelectReminder(r)}
                    className={`group relative p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl border transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                      isNext
                        ? 'bg-stone-900/95 border border-emerald-500/60 shadow-md shadow-emerald-950/30'
                        : isCompleted
                        ? 'bg-stone-900/40 border-stone-800/80 opacity-60'
                        : 'bg-stone-900/80 border-stone-800 hover:border-amber-400/50 shadow-sm'
                    }`}
                  >
                    {/* Connected Timeline Dot */}
                    <div 
                      className={`absolute ${isEn ? '-left-5 sm:-left-5.5' : '-right-5 sm:-right-5.5'} top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-stone-950 flex items-center justify-center ${
                        isNext ? 'bg-emerald-400 shadow-md shadow-emerald-500/50' : isCompleted ? 'bg-emerald-500' : cat.dot
                      }`}
                    >
                      <div className="w-1 h-1 rounded-full bg-white" />
                    </div>

                    <div className="flex items-center gap-2.5 flex-1 min-w-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleComplete(r.id);
                        }}
                        className={`p-1 rounded-lg transition-all active:scale-95 cursor-pointer shrink-0 ${
                          isCompleted ? 'text-emerald-400 bg-emerald-500/20' : 'text-stone-400 hover:text-white bg-stone-800'
                        }`}
                      >
                        <CheckCircle2 className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
                      </button>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                          {/* Next Reminder Indicator */}
                          {isNext && (
                            <span className="px-1.5 py-0.5 rounded-md bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-black text-[10px] sm:text-[11px] shrink-0">
                              {isEn ? 'Next' : 'بعدی'}
                            </span>
                          )}
                          <span className={`font-bold text-xs sm:text-sm truncate transition-colors ${isNext ? 'text-white' : 'text-stone-200 group-hover:text-amber-300'}`}>
                            {r.title}
                          </span>
                          {getPriorityBadge(r.priority)}
                          {r.recurrence && r.recurrence !== 'none' && (
                            <span title={isEn ? 'Recurring Reminder' : 'یادآور تکرارشونده'} className="flex items-center">
                              <Repeat className="w-3 h-3 text-indigo-400 flex-shrink-0" />
                            </span>
                          )}
                        </div>
                        {r.description && (
                          <p className="text-[11px] sm:text-xs text-stone-400 truncate mt-0.5">
                            {r.description}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Time & Quick Snooze and Live Countdown for Next Reminder */}
                    <div className="flex items-center gap-1.5 sm:gap-2 text-xs text-stone-300 self-end sm:self-center shrink-0 flex-wrap justify-end">
                      {/* Integrated Live Countdown Clock inside next reminder card in Timeline */}
                      {isNext && countdown && (
                        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg border border-emerald-500/40 bg-stone-950/95 shadow-sm">
                          <span className="text-[10px] font-bold text-emerald-400">
                            {isEn ? 'Left:' : 'مانده:'}
                          </span>
                          <NeonClock
                            hours={countdown.hours}
                            minutes={countdown.minutes}
                            seconds={countdown.seconds}
                            size="xs"
                            color="green"
                          />
                        </div>
                      )}

                      <span className={`flex items-center gap-1 font-mono px-2 py-0.5 rounded-md text-[11px] sm:text-xs border ${
                        isNext 
                          ? 'bg-stone-950 text-amber-300 border-amber-500/40 font-bold' 
                          : 'bg-stone-800 text-stone-300 border-stone-700/60'
                      }`}>
                        <Clock className="w-3 h-3 text-amber-400" />
                        {formatJalaliTime(r.dueTimestamp, language)}
                      </span>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onPostpone(r.id, 15);
                        }}
                        className="px-2 py-0.5 rounded-md bg-stone-800 hover:bg-stone-700 text-stone-300 hover:text-white font-bold text-[11px] sm:text-xs border border-stone-700/80 active:scale-95 cursor-pointer transition-colors"
                        title={isEn ? 'Snooze 15 minutes' : 'تعویق ۱۵ دقیقه'}
                      >
                        {isEn ? '+15m' : '+۱۵د'}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

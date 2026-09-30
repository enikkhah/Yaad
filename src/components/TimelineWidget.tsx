import React, { useState, useEffect } from 'react';
import { Reminder } from '../types';
import { toPersianDigits, formatJalaliTime, getJalaliComponents } from '../utils/jalali';
import { NeonClock } from './NeonClock';
import { 
  Clock, 
  Hourglass, 
  Calendar,
  CheckCircle2, 
  Volume2, 
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
}

export const TimelineWidget: React.FC<TimelineWidgetProps> = ({
  reminders,
  onToggleComplete,
  onPostpone,
  onSelectReminder,
  timelineMode = 'modern',
}) => {
  const [currentTime, setCurrentTime] = useState<Date>(new Date());
  const [activeFilter, setActiveFilter] = useState<'range' | 'today' | 'all'>('range');

  // Live clock
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const nowMs = currentTime.getTime();
  const windowStartMs = nowMs - 6 * 3600 * 1000;
  const windowEndMs = nowMs + 12 * 3600 * 1000;

  // Filter reminders
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
          bg: 'bg-cyan-950/80 border-cyan-500/50 text-cyan-200',
          dot: 'bg-cyan-400 shadow-cyan-500/50',
          label: 'کار',
          icon: <Briefcase className="w-3.5 h-3.5 text-cyan-400" />,
        };
      case 'family':
        return {
          bg: 'bg-rose-950/80 border-rose-500/50 text-rose-200',
          dot: 'bg-rose-400 shadow-rose-500/50',
          label: 'خانواده',
          icon: <Heart className="w-3.5 h-3.5 text-rose-400" />,
        };
      default:
        return {
          bg: 'bg-emerald-950/80 border-emerald-500/50 text-emerald-200',
          dot: 'bg-emerald-400 shadow-emerald-500/50',
          label: 'سایر',
          icon: <Tag className="w-3.5 h-3.5 text-emerald-400" />,
        };
    }
  };

  const getPriorityBadge = (p: Reminder['priority']) => {
    switch (p) {
      case 'high':
        return <span className="text-[11px] px-2 py-0.5 rounded-md bg-red-500/20 text-red-300 border border-red-500/40 font-bold">فوری</span>;
      case 'medium':
        return <span className="text-[11px] px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold">متوسط</span>;
      default:
        return <span className="text-[11px] px-2 py-0.5 rounded-md bg-blue-500/20 text-blue-300 border border-blue-500/40 font-bold">عادی</span>;
    }
  };

  const todayJalali = getJalaliComponents(nowMs);

  // Helper to calculate countdown string for an upcoming reminder
  const getCountdownInfo = (dueTimestamp: number) => {
    const diffMs = dueTimestamp - nowMs;
    if (diffMs <= 0) return { isDue: true, text: 'زمان فرا رسیده', hours: 0, minutes: 0, seconds: 0 };
    const totalSecs = Math.floor(diffMs / 1000);
    const hours = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;

    return {
      isDue: false,
      hours,
      minutes: mins,
      seconds: secs,
      text: (hours > 0 ? `${toPersianDigits(hours)} ساعت و ` : '') + `${toPersianDigits(mins)} دقیقه و ${toPersianDigits(secs)} ثانیه تا زمان یادآوری`,
      short: `${toPersianDigits(hours.toString().padStart(2, '0'))}:${toPersianDigits(mins.toString().padStart(2, '0'))}:${toPersianDigits(secs.toString().padStart(2, '0'))}`,
    };
  };

  const nextPendingReminder = futureReminders.find((item) => item.status === 'pending');
  const nextCountdown = nextPendingReminder ? getCountdownInfo(nextPendingReminder.dueTimestamp) : null;

  return (
    <div 
      id="timeline-widget-root" 
      className={`w-full rounded-2xl p-3 sm:p-5 md:p-6 transition-all duration-300 border ${
        timelineMode === 'sketch'
          ? 'bg-black text-white border-dashed border-stone-600 font-mono shadow-2xl'
          : 'bg-gradient-to-b from-stone-900/95 via-stone-900/90 to-stone-950 text-stone-100 border-stone-800/90 shadow-xl'
      }`}
    >
      {/* Header section - Clean: Just Icon + Title, and subtle filters */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 mb-4 border-b border-stone-800">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
            <Clock className="w-5 h-5 animate-pulse" />
          </div>
          <h3 className="font-black text-base sm:text-lg text-white tracking-wide">
            تایم‌لاین
          </h3>
        </div>

        {/* Subtle time range filters */}
        <div className="flex items-center gap-1.5 self-stretch sm:self-auto justify-end">
          <div className="flex bg-stone-800/80 p-1 rounded-xl border border-stone-700/60 text-xs font-bold">
            <button
              id="timeline-filter-range"
              type="button"
              onClick={() => setActiveFilter('range')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                activeFilter === 'range'
                  ? 'bg-stone-900 border border-yellow-400/80 text-yellow-300 font-black shadow-sm'
                  : 'text-stone-400 hover:text-white'
              }`}
            >
              بازه فعلی
            </button>
            <button
              id="timeline-filter-today"
              type="button"
              onClick={() => setActiveFilter('today')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                activeFilter === 'today'
                  ? 'bg-stone-900 border border-yellow-400/80 text-yellow-300 font-black shadow-sm'
                  : 'text-stone-400 hover:text-white'
              }`}
            >
              امروز
            </button>
            <button
              id="timeline-filter-all"
              type="button"
              onClick={() => setActiveFilter('all')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                activeFilter === 'all'
                  ? 'bg-stone-900 border border-yellow-400/80 text-yellow-300 font-black shadow-sm'
                  : 'text-stone-400 hover:text-white'
              }`}
            >
              همه ({toPersianDigits(reminders.length)})
            </button>
          </div>
        </div>
      </div>

      {/* VERTICAL TIMELINE - Maximum horizontal coverage with line right-aligned */}
      <div className="relative py-2 px-0.5 sm:px-1 transition-all duration-300">
        <div className="relative">
          {/* Vertical Axis Line (Shifted close to the right edge per user request) */}
          <div 
            className={`absolute top-2 bottom-2 right-2 sm:right-2.5 w-1 -translate-x-1/2 rounded-full ${
              timelineMode === 'sketch' 
                ? 'bg-white border-l border-r border-dashed border-white' 
                : 'bg-stone-800'
            }`} 
          />

          {/* SECTION 1: PAST REMINDERS */}
          <div className="space-y-3 mb-5 pr-5 sm:pr-6 transition-all duration-300">
            {pastReminders.length === 0 ? (
              <div className="py-2 text-stone-400 text-xs font-medium">
                بدون یادآور در ۶ ساعت قبل
              </div>
            ) : (
              pastReminders.map((r) => {
                const cat = getCategoryStyles(r.category);
                const isCompleted = r.status === 'completed';
                return (
                  <div
                    key={r.id}
                    onClick={() => onSelectReminder(r)}
                    className={`group relative p-3 sm:p-4 rounded-2xl border transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 ${
                      isCompleted
                        ? 'bg-stone-900/40 border-stone-800/80 opacity-60 hover:opacity-90'
                        : 'bg-stone-900/90 border-stone-700/60 hover:border-amber-500/50 shadow-sm'
                    }`}
                  >
                    {/* Connected Timeline Dot */}
                    <div 
                      className={`absolute -right-3.5 sm:-right-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full border-2 border-stone-950 flex items-center justify-center ${
                        isCompleted ? 'bg-emerald-500' : cat.dot
                      }`}
                    >
                      <div className="w-1.5 h-1.5 rounded-full bg-white" />
                    </div>

                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleComplete(r.id);
                        }}
                        className={`p-1.5 rounded-xl transition-all active:scale-95 ${
                          isCompleted ? 'text-emerald-400 bg-emerald-500/20' : 'text-stone-400 hover:text-white bg-stone-800'
                        }`}
                      >
                        <CheckCircle2 className="w-5 h-5" />
                      </button>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm sm:text-base text-stone-100 truncate group-hover:text-amber-300 transition-colors">
                            {r.title}
                          </span>
                          {getPriorityBadge(r.priority)}
                          {r.recurrence && r.recurrence !== 'none' && (
                            <span title="یادآور تکرارشونده" className="flex items-center">
                              <Repeat className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
                            </span>
                          )}
                        </div>
                        {r.description && (
                          <p className="text-xs sm:text-sm text-stone-300/80 truncate mt-0.5">
                            {r.description}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-xs sm:text-sm text-stone-300 self-end sm:self-center">
                      <span className="flex items-center gap-1.5 font-mono bg-stone-800 px-2.5 py-1 rounded-lg text-stone-200 font-semibold border border-stone-700/60">
                        <Clock className="w-3.5 h-3.5 text-amber-400" />
                        {formatJalaliTime(r.dueTimestamp)}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* CENTER: THE "NOW" DIVIDER - ONLY "اکنون" (WITHOUT DATE/CALENDAR) & SMALLER CLOCK (xs) */}
          <div className="relative my-4 py-2 sm:py-2.5 border-y-2 border-dashed border-amber-500/50 bg-amber-500/10 rounded-2xl px-3 sm:px-4 flex items-center justify-between gap-3 shadow-lg">
            {/* Glowing Pulse Point (Shifted closer to the right edge) */}
            <div className="absolute right-2 sm:right-2.5 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-amber-400 flex items-center justify-center shadow-lg shadow-amber-500/60 z-10">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-80" />
              <span className="w-1.5 h-1.5 rounded-full bg-stone-950" />
            </div>

            {/* Single "اکنون" badge without date/calendar */}
            <div className="flex items-center pr-5 sm:pr-6">
              <span className="px-3 py-1 rounded-xl bg-amber-500 text-stone-950 font-black text-xs sm:text-sm tracking-wide shadow-md">
                اکنون
              </span>
            </div>

            {/* Live Neon Sign Light Clock - Smaller size (xs) per user request */}
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

          {/* COUNTDOWN ROW: SOLE NEXT REMINDER FIELD WITH GREEN COUNTDOWN PER USER REQUEST */}
          {nextPendingReminder && nextCountdown && !nextCountdown.isDue && (
            <div className="relative my-4 py-2 sm:py-2.5 border-y-2 border-dashed border-emerald-500/50 bg-emerald-500/10 rounded-2xl px-3 sm:px-4 flex items-center justify-between gap-3 shadow-lg">
              {/* Glowing Pulse Point in Green */}
              <div className="absolute right-2 sm:right-2.5 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-emerald-400 flex items-center justify-center shadow-lg shadow-emerald-500/60 z-10">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-80" />
                <span className="w-1.5 h-1.5 rounded-full bg-stone-950" />
              </div>

              {/* Upcoming Reminder title & time without the removed text */}
              <div className="flex items-center gap-2 pr-5 sm:pr-6 min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs sm:text-sm font-bold text-emerald-200 bg-stone-950/90 border border-emerald-500/40 px-3 py-1.5 rounded-xl shadow-sm max-w-xs sm:max-w-md truncate">
                  <Clock className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="truncate">{nextPendingReminder.title}</span>
                  <span className="text-emerald-400/90 font-mono text-xs shrink-0">({formatJalaliTime(nextPendingReminder.dueTimestamp)})</span>
                </div>
              </div>

              {/* Live Neon Countdown Clock in GREEN - Same size (xs) as current time clock */}
              <div className="self-center flex items-center shrink-0">
                <NeonClock
                  hours={nextCountdown.hours}
                  minutes={nextCountdown.minutes}
                  seconds={nextCountdown.seconds}
                  size="xs"
                  color="green"
                />
              </div>
            </div>
          )}

          {/* SECTION 2: FUTURE REMINDERS (پایین - اتساع پویا متناسب با تعداد) */}
          <div className="space-y-3 mt-5 pr-5 sm:pr-6 transition-all duration-300">
            {futureReminders.length === 0 ? (
              <div className="py-2 text-stone-400 text-xs font-medium">
                بدون یادآور در ۱۲ ساعت آینده
              </div>
            ) : (
              futureReminders.map((r) => {
                const cat = getCategoryStyles(r.category);
                const isCompleted = r.status === 'completed';
                return (
                  <div
                    key={r.id}
                    onClick={() => onSelectReminder(r)}
                    className={`group relative p-3 sm:p-4 rounded-2xl border transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 ${
                      isCompleted
                        ? 'bg-stone-900/40 border-stone-800/80 opacity-60'
                        : 'bg-stone-900/90 border-stone-700/80 hover:border-amber-400 shadow-sm'
                    }`}
                  >
                    {/* Connected Timeline Dot */}
                    <div 
                      className={`absolute -right-3.5 sm:-right-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full border-2 border-stone-950 flex items-center justify-center ${
                        isCompleted ? 'bg-emerald-500' : cat.dot
                      }`}
                    >
                      <div className="w-1.5 h-1.5 rounded-full bg-white" />
                    </div>

                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleComplete(r.id);
                        }}
                        className={`p-1.5 rounded-xl transition-all active:scale-95 ${
                          isCompleted ? 'text-emerald-400 bg-emerald-500/20' : 'text-stone-400 hover:text-white bg-stone-800'
                        }`}
                      >
                        <CheckCircle2 className="w-5 h-5" />
                      </button>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm sm:text-base text-stone-100 truncate group-hover:text-amber-300 transition-colors">
                            {r.title}
                          </span>
                          {getPriorityBadge(r.priority)}
                          {r.recurrence && r.recurrence !== 'none' && (
                            <span title="یادآور تکرارشونده" className="flex items-center">
                              <Repeat className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
                            </span>
                          )}
                        </div>
                        {r.description && (
                          <p className="text-xs sm:text-sm text-stone-300/80 truncate mt-0.5">
                            {r.description}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-xs sm:text-sm text-stone-300 self-end sm:self-center flex-wrap justify-end">
                      <span className="flex items-center gap-1.5 font-mono bg-stone-800 px-2.5 py-1 rounded-lg text-amber-300 font-bold border border-stone-700">
                        <Clock className="w-3.5 h-3.5 text-amber-400" />
                        {formatJalaliTime(r.dueTimestamp)}
                      </span>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onPostpone(r.id, 15);
                        }}
                        className="px-2.5 py-1 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 font-bold border border-stone-700 active:scale-95"
                        title="تعویق ۱۵ دقیقه"
                      >
                        +۱۵د
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

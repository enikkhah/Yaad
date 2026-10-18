import React, { useState, useEffect } from 'react';
import { Reminder } from '../types';
import { formatJalaliFull, getPersianRelativeTime } from '../utils/jalali';
import { NeonClock } from './NeonClock';
import { AppLanguage } from '../utils/i18n';
import { 
  Clock, 
  Briefcase, 
  Heart, 
  Tag, 
  Bell,
  CheckCircle2
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
  const [nowMs, setNowMs] = useState<number>(Date.now());

  // Update clock every second
  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Find the absolute next pending reminder across all reminders
  const nextPendingReminder = reminders
    .filter((r) => (r.status === 'pending' || r.status === 'postponed') && r.dueTimestamp >= nowMs)
    .sort((a, b) => a.dueTimestamp - b.dueTimestamp)[0] || null;

  // Compute countdown if not provided
  const liveCountdown = countdown || (nextPendingReminder ? (() => {
    const diffMs = Math.max(0, nextPendingReminder.dueTimestamp - nowMs);
    const totalSecs = Math.floor(diffMs / 1000);
    return {
      hours: Math.floor(totalSecs / 3600),
      minutes: Math.floor((totalSecs % 3600) / 60),
      seconds: totalSecs % 60,
    };
  })() : null);

  // Render category icon
  const renderCategoryIcon = (category: Reminder['category']) => {
    const iconClass = "w-4 h-4 text-stone-400 shrink-0";
    switch (category) {
      case 'work':
        return (
          <span title={isEn ? 'Work' : 'کار'} className="flex items-center">
            <Briefcase className={iconClass} />
          </span>
        );
      case 'family':
        return (
          <span title={isEn ? 'Family' : 'خانواده'} className="flex items-center">
            <Heart className={iconClass} />
          </span>
        );
      default:
        return (
          <span title={isEn ? 'Other' : 'سایر'} className="flex items-center">
            <Tag className={iconClass} />
          </span>
        );
    }
  };

  // Render priority dot
  const renderPriorityDot = (priority: Reminder['priority']) => {
    if (priority === 'high') {
      return (
        <span 
          className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-sm shrink-0" 
          title={isEn ? 'Urgent' : 'فوری'} 
        />
      );
    }
    if (priority === 'medium') {
      return (
        <span 
          className="w-2.5 h-2.5 rounded-full bg-stone-500/70 shrink-0" 
          title={isEn ? 'Medium' : 'متوسط'} 
        />
      );
    }
    return (
      <span 
        className="w-2.5 h-2.5 rounded-full bg-stone-700/60 shrink-0" 
        title={isEn ? 'Normal' : 'عادی'} 
      />
    );
  };

  if (!nextPendingReminder) {
    return (
      <div 
        dir={isEn ? 'ltr' : 'rtl'}
        className="w-full rounded-2xl p-4 sm:p-5 bg-stone-900 border border-stone-800 text-stone-300 flex items-center justify-between gap-3 shadow-sm"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-stone-800 border border-stone-700 text-stone-400 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h4 className="text-base font-bold text-white">
              {isEn ? 'No upcoming reminders' : 'یادآوری در پیش رو ندارید'}
            </h4>
            <p className="text-sm text-stone-400 mt-0.5">
              {isEn ? 'All active tasks are up to date.' : 'تمام یادآورهای فعال به روز و مرتب هستند.'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div 
      dir={isEn ? 'ltr' : 'rtl'}
      className="w-full rounded-2xl p-4 sm:p-5 bg-stone-900 border border-stone-800 shadow-md transition-all duration-200"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Next Reminder Info */}
        <div 
          className="flex-1 min-w-0 cursor-pointer"
          onClick={() => onSelectReminder(nextPendingReminder)}
        >
          {/* Badge & Metadata */}
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-400 text-sm font-bold">
              <Bell className="w-4 h-4" />
              <span>{isEn ? 'Next Reminder' : 'یادآور بعدی'}</span>
            </span>

            <div className="flex items-center gap-1.5">
              {renderCategoryIcon(nextPendingReminder.category)}
              {renderPriorityDot(nextPendingReminder.priority)}
            </div>
          </div>

          {/* Title - Prominent subject */}
          <h3 className="text-lg sm:text-xl font-black text-white hover:text-indigo-400 transition-colors line-clamp-1 tracking-tight">
            {nextPendingReminder.title}
          </h3>

          {/* Scheduled Time - Smaller font to contrast with subject */}
          <div className="flex items-center gap-1.5 mt-1.5 text-xs text-stone-400 flex-wrap font-medium">
            <Clock className="w-3.5 h-3.5 text-indigo-500/80 shrink-0" />
            <span className="text-stone-300">
              {formatJalaliFull(nextPendingReminder.dueTimestamp, language)}
            </span>
            <span className="text-stone-600">•</span>
            <span className="text-indigo-400 font-bold">
              {getPersianRelativeTime(nextPendingReminder.dueTimestamp, language)}
            </span>
          </div>
        </div>

        {/* Big Live Countdown Timer (Compact and neat) */}
        {liveCountdown && (
          <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2 shrink-0 pt-3 sm:pt-0 border-t sm:border-t-0 border-stone-800">
            <span className="text-sm font-medium text-stone-400">
              {isEn ? 'Time Left:' : 'زمان باقی‌مانده:'}
            </span>
            <NeonClock
              hours={liveCountdown.hours}
              minutes={liveCountdown.minutes}
              seconds={liveCountdown.seconds}
              size="sm"
              color="indigo"
            />
          </div>
        )}
      </div>
    </div>
  );
};

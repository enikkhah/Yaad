import React, { useState } from 'react';
import { Reminder } from '../types';
import { formatJalaliFull, getPersianRelativeTime } from '../utils/jalali';
import { getRecurrenceLabel } from '../utils/recurrence';
import { AppLanguage } from '../utils/i18n';
import { NeonClock } from './NeonClock';
import { 
  CheckCircle2, 
  Clock, 
  Trash2, 
  Image as ImageIcon, 
  Briefcase, 
  Heart, 
  Tag, 
  RotateCcw,
  Zap,
  Edit2,
  Repeat,
  Loader2,
  X
} from 'lucide-react';

interface ReminderCardProps {
  reminder: Reminder;
  language?: AppLanguage;
  isNext?: boolean;
  countdown?: { hours: number; minutes: number; seconds: number } | null;
  onToggleComplete: (id: string) => void;
  onPostpone: (id: string, minutes: number) => void;
  onDelete: (id: string) => void;
  onEdit: (reminder: Reminder) => void;
  onViewImage: (url: string) => void;
}

export const ReminderCard: React.FC<ReminderCardProps> = ({
  reminder,
  language = 'fa',
  isNext = false,
  countdown = null,
  onToggleComplete,
  onPostpone,
  onDelete,
  onEdit,
  onViewImage,
}) => {
  const isEn = language === 'en';
  const [imgLoaded, setImgLoaded] = React.useState(false);
  const isCompleted = reminder.status === 'completed';
  const isCancelled = reminder.status === 'cancelled';
  const isPostponed = reminder.status === 'postponed';
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [swipeOffset, setSwipeOffset] = useState<number>(0);

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStartX(e.touches[0].clientX);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartX === null) return;
    const diff = e.touches[0].clientX - touchStartX;
    if (Math.abs(diff) < 130) {
      setSwipeOffset(diff);
    }
  };

  const handleTouchEnd = () => {
    if (Math.abs(swipeOffset) > 80) {
      onDelete(reminder.id);
    }
    setTouchStartX(null);
    setSwipeOffset(0);
  };

  const getCategoryMeta = (cat: Reminder['category']) => {
    switch (cat) {
      case 'work':
        return {
          label: isEn ? 'Work' : 'کار',
          border: 'border-cyan-500/30 hover:border-cyan-500/60',
          bg: 'bg-stone-900/90',
          badgeBg: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20',
          icon: <Briefcase className="w-3.5 h-3.5 text-cyan-400" />,
        };
      case 'family':
        return {
          label: isEn ? 'Family' : 'خانواده',
          border: 'border-rose-500/30 hover:border-rose-500/60',
          bg: 'bg-stone-900/90',
          badgeBg: 'bg-rose-500/10 text-rose-300 border-rose-500/20',
          icon: <Heart className="w-3.5 h-3.5 text-rose-400" />,
        };
      default:
        return {
          label: isEn ? 'Other' : 'سایر',
          border: 'border-teal-500/30 hover:border-teal-500/60',
          bg: 'bg-stone-900/90',
          badgeBg: 'bg-teal-500/10 text-teal-300 border-teal-500/20',
          icon: <Tag className="w-3.5 h-3.5 text-teal-400" />,
        };
    }
  };

  const getPriorityMeta = (p: Reminder['priority']) => {
    switch (p) {
      case 'high':
        return {
          label: isEn ? 'High' : 'فوری',
          className: 'bg-red-500/10 text-red-400 border-red-500/20',
        };
      case 'medium':
        return {
          label: isEn ? 'Medium' : 'متوسط',
          className: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
        };
      default:
        return {
          label: isEn ? 'Normal' : 'عادی',
          className: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
        };
    }
  };

  const catMeta = getCategoryMeta(reminder.category);
  const priMeta = getPriorityMeta(reminder.priority);
  const relativeTime = getPersianRelativeTime(reminder.dueTimestamp, language);

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{
        transform: swipeOffset !== 0 ? `translateX(${swipeOffset}px)` : undefined,
        transition: swipeOffset === 0 ? 'transform 0.2s ease-out' : 'none',
      }}
      className={`rounded-2xl p-4 sm:p-5 border transition-all duration-200 relative group animate-in fade-in slide-in-from-bottom-2.5 duration-300 ${
        Math.abs(swipeOffset) > 40 ? 'border-red-500/80 bg-red-950/20' : ''
      } ${
        isCompleted
          ? 'bg-stone-900/40 border-stone-800/80 opacity-75'
          : isNext
          ? 'bg-stone-900/95 border-2 border-emerald-500/80 shadow-xl shadow-emerald-950/40 ring-1 ring-emerald-500/30'
          : `${catMeta.bg} ${catMeta.border} shadow-lg shadow-black/20`
      }`}
      dir={isEn ? 'ltr' : 'rtl'}
    >
      {/* Small 'x' Quick Delete Button inside card without opening menu */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(reminder.id);
        }}
        className="absolute top-2.5 end-2.5 p-1.5 rounded-full text-stone-500 hover:text-red-400 hover:bg-red-500/15 transition-all opacity-80 sm:opacity-0 group-hover:opacity-100 cursor-pointer z-10"
        title={isEn ? 'Quick delete' : 'حذف سریع'}
        aria-label={isEn ? 'Quick delete' : 'حذف سریع'}
      >
        <X className="w-3.5 h-3.5" />
      </button>

      <div className="flex items-start justify-between gap-3">
        {/* Checkbox and Title */}
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <button
            type="button"
            onClick={() => onToggleComplete(reminder.id)}
            className={`mt-0.5 p-2 rounded-xl transition-all active:scale-95 cursor-pointer ${
              isCompleted
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                : isNext
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50 hover:bg-emerald-500/30'
                : 'bg-stone-800 text-stone-300 hover:text-white border border-stone-700 hover:border-amber-500/40'
            }`}
            title={isCompleted ? (isEn ? 'Completed' : 'انجام شده') : (isEn ? 'Mark as completed' : 'علامت به عنوان انجام شده')}
          >
            <CheckCircle2 className="w-5 h-5 sm:w-6 sm:h-6" />
          </button>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              {/* Next Reminder Badge */}
              {isNext && !isCompleted && (
                <span className="text-xs px-2.5 py-0.5 rounded-lg bg-emerald-500 text-stone-950 font-black flex items-center gap-1 shadow-sm">
                  <span className="w-1.5 h-1.5 rounded-full bg-stone-950 animate-ping" />
                  <span>{isEn ? 'Next Reminder' : 'یادآور بعدی'}</span>
                </span>
              )}

              {/* Category Badge */}
              <span className={`text-xs px-2.5 py-0.5 rounded-lg border flex items-center gap-1 font-bold ${catMeta.badgeBg}`}>
                {catMeta.icon}
                <span>{catMeta.label}</span>
              </span>

              {/* Priority Badge */}
              <span className={`text-xs px-2.5 py-0.5 rounded-lg border font-semibold ${priMeta.className}`}>
                {priMeta.label}
              </span>

              {/* Recurrence Badge */}
              {reminder.recurrence && reminder.recurrence !== 'none' && (
                <span className="text-xs px-2.5 py-0.5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 font-bold flex items-center gap-1">
                  <Repeat className="w-3 h-3 text-indigo-400" />
                  <span>{getRecurrenceLabel(reminder, language)}</span>
                </span>
              )}

              {/* Postponed indicator */}
              {isPostponed && (
                <span className="text-xs px-2 py-0.5 rounded-md bg-stone-800 text-amber-300 border border-amber-500/20">
                  {isEn ? `Postponed (${reminder.postponeCount}x)` : `به تعویق افتاده (${reminder.postponeCount} بار)`}
                </span>
              )}

              {/* Flash / voice badges */}
              {reminder.useFlash && (
                <span title={isEn ? 'LED Flash active' : 'فلش ال‌ای‌دی روشن'} className="p-1 rounded bg-amber-500/10 text-amber-400 text-xs">
                  <Zap className="w-3 h-3" />
                </span>
              )}
            </div>

            {/* Title */}
            <h3
              className={`text-base sm:text-lg font-bold leading-snug transition-colors ${
                isCompleted
                  ? 'line-through text-stone-500 font-medium'
                  : isNext
                  ? 'text-white font-extrabold group-hover:text-emerald-300'
                  : 'text-stone-100 group-hover:text-amber-400'
              }`}
            >
              {reminder.title}
            </h3>

            {/* Description */}
            {reminder.description && (
              <p className="text-sm text-stone-300/90 mt-1.5 line-clamp-2 leading-relaxed">
                {reminder.description}
              </p>
            )}

            {/* Integrated Live Countdown Clock directly inside next reminder card */}
            {isNext && !isCompleted && countdown && (
              <div className="flex items-center gap-2 mt-2.5 px-2.5 py-1 rounded-xl border border-emerald-400/60 bg-stone-950/90 shadow-[0_0_12px_rgba(16,185,129,0.3)] w-fit shrink-0">
                <span className="text-[11px] font-bold text-emerald-400">
                  {isEn ? 'Remaining:' : 'زمان مانده:'}
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

            {/* Time Display */}
            <div className="flex items-center gap-2 mt-2.5 text-xs sm:text-sm text-stone-300 flex-wrap">
              <Clock className="w-4 h-4 text-amber-500 flex-shrink-0" />
              <span className="font-medium text-stone-200">{formatJalaliFull(reminder.dueTimestamp, language)}</span>
              <span className="text-stone-600">•</span>
              <span className={`font-bold ${reminder.dueTimestamp < Date.now() && !isCompleted ? 'text-red-400 font-extrabold' : 'text-amber-400'}`}>
                {relativeTime}
              </span>
            </div>
          </div>
        </div>

        {/* Thumbnail Image if exists - Optimized Lazy Loading */}
        {reminder.imageUrl && (
          <button
            type="button"
            onClick={() => onViewImage(reminder.imageUrl!)}
            className="w-16 h-16 sm:w-18 sm:h-18 rounded-2xl overflow-hidden border border-stone-700 relative shrink-0 hover:scale-105 transition-transform bg-stone-950 cursor-pointer"
            title={isEn ? 'View attached photo' : 'مشاهده تصویر پیوست'}
          >
            {!imgLoaded && (
              <div className="absolute inset-0 flex items-center justify-center text-stone-500">
                <Loader2 className="w-4 h-4 animate-spin text-teal-400" />
              </div>
            )}
            <img 
              src={reminder.imageUrl} 
              alt="attachment" 
              loading="lazy"
              decoding="async"
              onLoad={() => setImgLoaded(true)}
              className={`w-full h-full object-cover transition-opacity duration-300 ${
                imgLoaded ? 'opacity-100' : 'opacity-0'
              }`} 
            />
            <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
              <ImageIcon className="w-5 h-5 text-white drop-shadow" />
            </div>
          </button>
        )}
      </div>

      {/* Action footer */}
      <div className="flex items-center justify-between mt-3.5 pt-3 border-t border-stone-800 text-xs sm:text-sm flex-wrap gap-2">
        <div className="flex items-center gap-2">
          {!isCompleted && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => onPostpone(reminder.id, 10)}
                className="px-2.5 py-1.5 rounded-xl bg-stone-800/90 hover:bg-stone-700 text-stone-200 font-bold border border-stone-700/60 active:scale-95 cursor-pointer"
                title={isEn ? '+10 minutes snooze' : '۱۰ دقیقه به تعویق انداختن'}
              >
                {isEn ? '+10 min' : '+۱۰ دقیقه'}
              </button>
              <button
                type="button"
                onClick={() => onPostpone(reminder.id, 60)}
                className="px-2.5 py-1.5 rounded-xl bg-stone-800/90 hover:bg-stone-700 text-stone-200 font-bold border border-stone-700/60 active:scale-95 cursor-pointer"
                title={isEn ? '+1 hour snooze' : '۱ ساعت به تعویق انداختن'}
              >
                {isEn ? '+1 hour' : '+۱ ساعت'}
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {/* Edit Button */}
          <button
            type="button"
            onClick={() => onEdit(reminder)}
            className="p-1.5 sm:p-2 rounded-xl text-stone-400 hover:text-amber-400 hover:bg-stone-800 transition-colors cursor-pointer"
            title={isEn ? 'Edit reminder' : 'ویرایش یادآور'}
          >
            <Edit2 className="w-4 h-4" />
          </button>

          {/* Delete Button */}
          <button
            type="button"
            onClick={() => onDelete(reminder.id)}
            className="p-1.5 sm:p-2 rounded-xl text-stone-400 hover:text-red-400 hover:bg-stone-800 transition-colors cursor-pointer"
            title={isEn ? 'Delete reminder' : 'حذف یادآور'}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

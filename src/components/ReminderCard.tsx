import React from 'react';
import { Reminder } from '../types';
import { formatJalaliFull, getPersianRelativeTime } from '../utils/jalali';
import { playRingTune } from '../utils/audio';
import { getRecurrenceLabel } from '../utils/recurrence';
import { 
  CheckCircle2, 
  Clock, 
  Volume2, 
  Trash2, 
  Image as ImageIcon, 
  Briefcase, 
  Heart, 
  Tag, 
  RotateCcw,
  Zap,
  Edit2,
  Repeat,
  Loader2
} from 'lucide-react';

interface ReminderCardProps {
  reminder: Reminder;
  onToggleComplete: (id: string) => void;
  onPostpone: (id: string, minutes: number) => void;
  onDelete: (id: string) => void;
  onEdit: (reminder: Reminder) => void;
  onViewImage: (url: string) => void;
}

export const ReminderCard: React.FC<ReminderCardProps> = ({
  reminder,
  onToggleComplete,
  onPostpone,
  onDelete,
  onEdit,
  onViewImage,
}) => {
  const [imgLoaded, setImgLoaded] = React.useState(false);
  const isCompleted = reminder.status === 'completed';
  const isCancelled = reminder.status === 'cancelled';
  const isPostponed = reminder.status === 'postponed';

  const getCategoryMeta = (cat: Reminder['category']) => {
    switch (cat) {
      case 'work':
        return {
          label: 'کار',
          border: 'border-cyan-500/30 hover:border-cyan-500/60',
          bg: 'bg-stone-900/90',
          badgeBg: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20',
          icon: <Briefcase className="w-3.5 h-3.5 text-cyan-400" />,
        };
      case 'family':
        return {
          label: 'خانواده',
          border: 'border-rose-500/30 hover:border-rose-500/60',
          bg: 'bg-stone-900/90',
          badgeBg: 'bg-rose-500/10 text-rose-300 border-rose-500/20',
          icon: <Heart className="w-3.5 h-3.5 text-rose-400" />,
        };
      default:
        return {
          label: 'سایر',
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
          label: 'فوری',
          className: 'bg-red-500/10 text-red-400 border-red-500/20',
        };
      case 'medium':
        return {
          label: 'متوسط',
          className: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
        };
      default:
        return {
          label: 'عادی',
          className: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
        };
    }
  };

  const catMeta = getCategoryMeta(reminder.category);
  const priMeta = getPriorityMeta(reminder.priority);
  const relativeTime = getPersianRelativeTime(reminder.dueTimestamp);

  const handlePlayTone = (e: React.MouseEvent) => {
    e.stopPropagation();
    playRingTune(reminder.category);
  };

  return (
    <div
      className={`rounded-2xl p-4 sm:p-5 border transition-all duration-200 relative group ${
        isCompleted
          ? 'bg-stone-900/40 border-stone-800/80 opacity-75'
          : `${catMeta.bg} ${catMeta.border} shadow-lg shadow-black/20`
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        {/* Checkbox and Title */}
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <button
            type="button"
            onClick={() => onToggleComplete(reminder.id)}
            className={`mt-0.5 p-2 rounded-xl transition-all active:scale-95 ${
              isCompleted
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                : 'bg-stone-800 text-stone-300 hover:text-white border border-stone-700 hover:border-amber-500/40'
            }`}
            title={isCompleted ? 'انجام شده' : 'علامت به عنوان انجام شده'}
          >
            <CheckCircle2 className="w-5 h-5 sm:w-6 sm:h-6" />
          </button>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
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
                  <span>{getRecurrenceLabel(reminder)}</span>
                </span>
              )}

              {/* Postponed indicator */}
              {isPostponed && (
                <span className="text-xs px-2 py-0.5 rounded-md bg-stone-800 text-amber-300 border border-amber-500/20">
                  به تعویق افتاده ({reminder.postponeCount} بار)
                </span>
              )}

              {/* Flash / voice badges */}
              {reminder.useFlash && (
                <span title="فلش ال‌ای‌دی روشن" className="p-1 rounded bg-amber-500/10 text-amber-400 text-xs">
                  <Zap className="w-3 h-3" />
                </span>
              )}
            </div>

            {/* Title */}
            <h3
              className={`text-base sm:text-lg font-bold leading-snug transition-colors ${
                isCompleted
                  ? 'line-through text-stone-500 font-medium'
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

            {/* Time Display */}
            <div className="flex items-center gap-2 mt-2.5 text-xs sm:text-sm text-stone-300 flex-wrap">
              <Clock className="w-4 h-4 text-amber-500 flex-shrink-0" />
              <span className="font-medium text-stone-200">{formatJalaliFull(reminder.dueTimestamp)}</span>
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
            className="w-16 h-16 sm:w-18 sm:h-18 rounded-2xl overflow-hidden border border-stone-700 relative shrink-0 hover:scale-105 transition-transform bg-stone-950"
            title="مشاهده تصویر پیوست"
          >
            {!imgLoaded && (
              <div className="absolute inset-0 flex items-center justify-center text-stone-500">
                <Loader2 className="w-4 h-4 animate-spin text-teal-400" />
              </div>
            )}
            <img 
              src={reminder.imageUrl} 
              alt="پیوست" 
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
          <button
            type="button"
            onClick={handlePlayTone}
            className="px-2.5 py-1.5 rounded-xl bg-stone-800/90 hover:bg-stone-700 text-stone-200 hover:text-amber-400 transition-colors flex items-center gap-1.5 font-medium border border-stone-700/60"
            title="شنیدن زنگ یادآور"
          >
            <Volume2 className="w-4 h-4 text-amber-400" />
            <span>پخش زنگ</span>
          </button>

          {!isCompleted && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => onPostpone(reminder.id, 10)}
                className="px-2.5 py-1.5 rounded-xl bg-stone-800/90 hover:bg-stone-700 text-stone-200 font-bold border border-stone-700/60 active:scale-95"
                title="۱۰ دقیقه به تعویق انداختن"
              >
                +۱۰ دقیقه
              </button>
              <button
                type="button"
                onClick={() => onPostpone(reminder.id, 60)}
                className="px-2.5 py-1.5 rounded-xl bg-stone-800/90 hover:bg-stone-700 text-stone-200 font-bold border border-stone-700/60 active:scale-95"
                title="۱ ساعت به تعویق انداختن"
              >
                +۱ ساعت
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {/* Edit Button */}
          <button
            type="button"
            onClick={() => onEdit(reminder)}
            className="p-1.5 sm:p-2 rounded-xl text-stone-400 hover:text-amber-400 hover:bg-stone-800 transition-colors"
            title="ویرایش یادآور"
          >
            <Edit2 className="w-4 h-4" />
          </button>

          {/* Delete Button */}
          <button
            type="button"
            onClick={() => onDelete(reminder.id)}
            className="p-1.5 sm:p-2 rounded-xl text-stone-400 hover:text-red-400 hover:bg-stone-800 transition-colors"
            title="حذف یادآور"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

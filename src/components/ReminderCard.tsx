import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import { Reminder } from '../types';
import { formatJalaliFull, getPersianRelativeTime, toPersianDigits } from '../utils/jalali';
import { AppLanguage } from '../utils/i18n';
import { 
  Check, 
  Clock, 
  MoreVertical, 
  Trash2, 
  Edit2, 
  Briefcase, 
  Heart, 
  Tag, 
  RotateCcw,
  Image as ImageIcon,
  Navigation
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
  onToggleGeofence?: (id: string) => void;
  onSimulateGeofenceTrigger?: (reminder: Reminder) => void;
  userPosition?: { latitude: number; longitude: number } | null;
  isGeofenceServiceActive?: boolean;
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
  onToggleGeofence,
  onSimulateGeofenceTrigger,
  userPosition = null,
  isGeofenceServiceActive = true,
}) => {
  const isEn = language === 'en';
  const isCompleted = reminder.status === 'completed';
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [isEmeraldGlow, setIsEmeraldGlow] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  const fadeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      if (fadeTimerRef.current) window.clearTimeout(fadeTimerRef.current);
    };
  }, []);

  const handleAnimatedToggle = () => {
    if (isCompleted) {
      onToggleComplete(reminder.id);
      return;
    }
    if (isCompleting) return;
    setIsCompleting(true);
    setIsEmeraldGlow(true);
    timerRef.current = window.setTimeout(() => {
      onToggleComplete(reminder.id);
      setIsCompleting(false);
      fadeTimerRef.current = window.setTimeout(() => {
        setIsEmeraldGlow(false);
      }, 220);
    }, 150);
  };

  // Close menu when clicking outside
  useEffect(() => {
    if (!isMenuOpen) return;
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isMenuOpen]);

  // Category Icon (small gray icon)
  const renderCategoryIcon = () => {
    const iconClass = "w-4 h-4 text-stone-400 shrink-0";
    switch (reminder.category) {
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

  // Priority / Category hollow circle color
  const circleBorderColor =
    reminder.priority === 'high'
      ? 'border-red-500 text-red-400 hover:bg-red-500/15 ring-2 ring-red-500/20'
      : reminder.category === 'work'
      ? 'border-cyan-400 text-cyan-400 hover:bg-cyan-400/15'
      : reminder.category === 'family'
      ? 'border-rose-400 text-rose-400 hover:bg-rose-400/15'
      : 'border-indigo-400 text-indigo-400 hover:bg-indigo-400/15';

  const completedCircleColor =
    reminder.priority === 'high'
      ? 'border-red-500 bg-red-500/20 text-red-400'
      : reminder.category === 'work'
      ? 'border-cyan-400 bg-cyan-400/20 text-cyan-300'
      : reminder.category === 'family'
      ? 'border-rose-400 bg-rose-400/20 text-rose-300'
      : 'border-indigo-400 bg-indigo-400/20 text-indigo-300';

  const relativeTime = getPersianRelativeTime(reminder.dueTimestamp, language);
  const formattedTime = formatJalaliFull(reminder.dueTimestamp, language);
  const isOverdue = reminder.dueTimestamp < Date.now() && !isCompleted;

  return (
    <motion.div
      layout="position"
      transition={{
        layout: { type: 'spring', stiffness: 520, damping: 36, mass: 0.7 },
      }}
      className={`rounded-2xl p-4 sm:p-5 border transition-colors duration-300 relative ${
        isCompleting || isEmeraldGlow
          ? 'bg-emerald-950/70 border-emerald-400/90 text-emerald-50 shadow-lg shadow-emerald-500/20 ring-1 ring-emerald-400/40'
          : isCompleted
          ? 'border-stone-800/80 bg-stone-900/60 opacity-70'
          : isNext
          ? 'bg-stone-900 border-stone-700 shadow-sm'
          : 'bg-stone-900 border-stone-800 hover:border-stone-700 shadow-sm'
      }`}
      dir={isEn ? 'ltr' : 'rtl'}
    >
      <div className="flex items-start justify-between gap-3.5 sm:gap-4">
        {/* Toggle completion button (Larger Hollow Colored Circle with Checkmark) */}
        <button
          type="button"
          onClick={handleAnimatedToggle}
          className={`mt-0.5 w-6.5 h-6.5 rounded-full border-[2.5px] flex items-center justify-center transition-all duration-300 cursor-pointer shrink-0 active:scale-90 group ${
            isCompleting
              ? 'border-emerald-400 bg-emerald-500 text-stone-950 scale-110 shadow-sm shadow-emerald-500/40'
              : isCompleted
              ? completedCircleColor
              : `bg-transparent ${circleBorderColor}`
          }`}
          title={isCompleted ? (isEn ? 'Completed' : 'انجام شده') : (isEn ? 'Mark as completed' : 'علامت به عنوان انجام شده')}
          aria-label={isCompleted ? (isEn ? 'Completed' : 'انجام شده') : (isEn ? 'Mark as completed' : 'علامت به عنوان انجام شده')}
        >
          <Check
            className={`w-3.5 h-3.5 stroke-[3] transition-all duration-200 ${
              isCompleted || isCompleting ? 'opacity-100 scale-100' : 'opacity-0 scale-50 group-hover:opacity-60 group-hover:scale-90'
            }`}
          />
        </button>

        {/* Card Main Body: Category Icon, Title, Time */}
        <div className="flex-1 min-w-0">
          {/* Metadata Row: Category icon & Priority badge */}
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            {renderCategoryIcon()}
            {reminder.priorityLevel && reminder.priorityLevel > 1 ? (
              <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded-md border flex items-center gap-0.5 ${
                reminder.priorityLevel >= 5
                  ? 'bg-red-500/15 border-red-500/40 text-red-300'
                  : reminder.priorityLevel >= 4
                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                  : reminder.priorityLevel >= 2
                  ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-300'
                  : 'bg-stone-800 border-stone-700 text-stone-400'
              }`}>
                <span>
                  {reminder.priorityLevel >= 5
                    ? (isEn ? 'Urgent' : 'فوری')
                    : reminder.priorityLevel >= 4
                    ? (isEn ? 'High' : 'مهم')
                    : (isEn ? 'Medium' : 'متوسط')}
                </span>
              </span>
            ) : reminder.priority === 'high' ? (
              <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-md border bg-red-500/15 border-red-500/40 text-red-300">
                {isEn ? 'Urgent' : 'فوری'}
              </span>
            ) : null}
          </div>

          {/* Title - Prominent and bold subject */}
          <h4
            className={`font-black text-base sm:text-lg leading-snug tracking-tight transition-colors duration-500 line-clamp-2 ${
              isCompleting
                ? 'line-through text-emerald-200 font-medium'
                : isCompleted
                ? 'line-through text-stone-500 font-medium'
                : 'text-stone-100 hover:text-indigo-400'
            }`}
          >
            {reminder.title}
          </h4>

          {/* Time Display - Smaller font to contrast with prominent subject */}
          <div className="flex items-center gap-1.5 mt-2 text-xs text-stone-400 flex-wrap font-medium">
            <Clock className="w-3.5 h-3.5 text-indigo-500/80 shrink-0" />
            <span className="text-stone-300">{formattedTime}</span>
            <span className="text-stone-600">•</span>
            <span className={`font-bold ${isOverdue ? 'text-red-400' : 'text-indigo-400/90'}`}>
              {relativeTime}
            </span>
          </div>
        </div>

        {/* Three-dot menu button */}
        <div className="relative shrink-0" ref={menuRef}>
          <button
            type="button"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="p-2 rounded-xl text-stone-400 hover:text-white hover:bg-stone-800 transition-colors cursor-pointer"
            title={isEn ? 'Actions menu' : 'منوی عملیات'}
            aria-label={isEn ? 'Actions menu' : 'منوی عملیات'}
          >
            <MoreVertical className="w-5 h-5" />
          </button>

          {/* Dropdown Menu */}
          {isMenuOpen && (
            <div 
              className={`absolute top-full ${isEn ? 'right-0' : 'left-0'} mt-1.5 w-48 bg-stone-900 border border-stone-700/80 rounded-2xl p-1.5 shadow-2xl z-50 space-y-1 animate-in fade-in zoom-in-95 duration-150`}
            >
              {/* +10 minutes */}
              {!isCompleted && (
                <button
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(false);
                    onPostpone(reminder.id, 10);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium text-stone-200 hover:text-indigo-400 hover:bg-stone-800 transition-colors text-start cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4 text-stone-400" />
                  <span>{isEn ? '+10 minutes' : '+۱۰ دقیقه'}</span>
                </button>
              )}

              {/* +1 hour */}
              {!isCompleted && (
                <button
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(false);
                    onPostpone(reminder.id, 60);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium text-stone-200 hover:text-indigo-400 hover:bg-stone-800 transition-colors text-start cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4 text-stone-400" />
                  <span>{isEn ? '+1 hour' : '+۱ ساعت'}</span>
                </button>
              )}

              {/* Edit */}
              <button
                type="button"
                onClick={() => {
                  setIsMenuOpen(false);
                  onEdit(reminder);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium text-stone-200 hover:text-indigo-400 hover:bg-stone-800 transition-colors text-start cursor-pointer"
              >
                <Edit2 className="w-4 h-4 text-stone-400" />
                <span>{isEn ? 'Edit' : 'ویرایش'}</span>
              </button>

              {/* View Image if exists */}
              {reminder.imageUrl && (
                <button
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(false);
                    onViewImage(reminder.imageUrl!);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium text-stone-200 hover:text-indigo-400 hover:bg-stone-800 transition-colors text-start cursor-pointer"
                >
                  <ImageIcon className="w-4 h-4 text-stone-400" />
                  <span>{isEn ? 'View Photo' : 'مشاهده تصویر'}</span>
                </button>
              )}

              {/* Directions if geofence exists */}
              {reminder.geofence && (
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${reminder.geofence.latitude},${reminder.geofence.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setIsMenuOpen(false)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium text-stone-200 hover:text-indigo-400 hover:bg-stone-800 transition-colors text-start cursor-pointer"
                >
                  <Navigation className="w-4 h-4 text-stone-400" />
                  <span>{isEn ? 'Directions' : 'مسیریابی'}</span>
                </a>
              )}

              {/* Delete */}
              <button
                type="button"
                onClick={() => {
                  setIsMenuOpen(false);
                  onDelete(reminder.id);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium text-red-400 hover:bg-red-500/15 transition-colors text-start cursor-pointer"
              >
                <Trash2 className="w-4 h-4 text-red-400" />
                <span>{isEn ? 'Delete' : 'حذف'}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};

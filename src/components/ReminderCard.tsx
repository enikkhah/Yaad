import React, { useState, useRef, useEffect } from 'react';
import { Reminder } from '../types';
import { formatJalaliFull, getPersianRelativeTime } from '../utils/jalali';
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
  const menuRef = useRef<HTMLDivElement>(null);

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

  // Priority Dot: red only for urgent/high priority
  const renderPriorityDot = () => {
    if (reminder.priority === 'high') {
      return (
        <span 
          className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-sm shrink-0" 
          title={isEn ? 'Urgent' : 'فوری'}
        />
      );
    }
    if (reminder.priority === 'medium') {
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

  const relativeTime = getPersianRelativeTime(reminder.dueTimestamp, language);
  const formattedTime = formatJalaliFull(reminder.dueTimestamp, language);
  const isOverdue = reminder.dueTimestamp < Date.now() && !isCompleted;

  return (
    <div
      className={`rounded-2xl p-4 sm:p-5 border transition-all duration-200 relative bg-stone-900 ${
        isCompleted
          ? 'border-stone-800/80 bg-stone-900/60 opacity-70'
          : isNext
          ? 'border-stone-700 shadow-sm'
          : 'border-stone-800 hover:border-stone-700 shadow-sm'
      }`}
      dir={isEn ? 'ltr' : 'rtl'}
    >
      <div className="flex items-start justify-between gap-3.5 sm:gap-4">
        {/* Toggle completion button */}
        <button
          type="button"
          onClick={() => onToggleComplete(reminder.id)}
          className={`mt-0.5 w-6 h-6 rounded-lg border flex items-center justify-center transition-all cursor-pointer shrink-0 active:scale-95 ${
            isCompleted
              ? 'bg-emerald-600 border-emerald-500 text-white'
              : 'border-stone-700 bg-stone-800/90 text-transparent hover:border-stone-500 hover:text-stone-400'
          }`}
          title={isCompleted ? (isEn ? 'Completed' : 'انجام شده') : (isEn ? 'Mark as completed' : 'علامت به عنوان انجام شده')}
          aria-label={isCompleted ? (isEn ? 'Completed' : 'انجام شده') : (isEn ? 'Mark as completed' : 'علامت به عنوان انجام شده')}
        >
          <Check className="w-4 h-4 stroke-[2.8]" />
        </button>

        {/* Card Main Body: Category Icon, Priority Dot, Title, Time */}
        <div className="flex-1 min-w-0">
          {/* Metadata Row: Category icon and Priority dot */}
          <div className="flex items-center gap-2 mb-1.5">
            {renderCategoryIcon()}
            {renderPriorityDot()}
          </div>

          {/* Title - Prominent and bold subject */}
          <h4
            className={`font-black text-base sm:text-lg leading-snug tracking-tight transition-colors line-clamp-2 ${
              isCompleted
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
    </div>
  );
};

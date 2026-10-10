import React from 'react';
import { 
  Cake, 
  HeartHandshake, 
  Sparkles, 
  Flame, 
  Users, 
  Briefcase, 
  CalendarHeart,
  Pencil, 
  Trash2, 
  BellRing, 
  Clock, 
  Calendar,
  Gift,
  User,
  PartyPopper
} from 'lucide-react';
import { Occasion } from '../types';
import { 
  getOccasionTypeMeta, 
  calculateNextOccasionOccurrence, 
  getOccasionAnniversaryLabel 
} from '../utils/occasionUtils';
import { toPersianDigits, PERSIAN_MONTHS } from '../utils/jalali';
import { AppLanguage } from '../utils/i18n';

interface OccasionCardProps {
  occasion: Occasion;
  onEdit: (occasion: Occasion) => void;
  onDelete: (id: string) => void;
  onCreateReminder?: (occasion: Occasion) => void;
  language?: AppLanguage;
}

export const OccasionCard: React.FC<OccasionCardProps> = ({
  occasion,
  onEdit,
  onDelete,
  onCreateReminder,
  language = 'fa',
}) => {
  const isEn = language === 'en';
  const meta = getOccasionTypeMeta(occasion.type);
  const { 
    daysRemaining, 
    yearsPassed, 
    isToday, 
    formattedTargetDate 
  } = calculateNextOccasionOccurrence(occasion);

  const anniversaryLabel = getOccasionAnniversaryLabel(occasion, yearsPassed, language);

  const renderIcon = () => {
    switch (meta.iconName) {
      case 'Cake':
        return <Cake className="w-5 h-5 text-rose-400" />;
      case 'HeartHandshake':
        return <HeartHandshake className="w-5 h-5 text-pink-400" />;
      case 'Sparkles':
        return <Sparkles className="w-5 h-5 text-purple-400" />;
      case 'Flame':
        return <Flame className="w-5 h-5 text-stone-300" />;
      case 'Users':
        return <Users className="w-5 h-5 text-emerald-400" />;
      case 'Briefcase':
        return <Briefcase className="w-5 h-5 text-sky-400" />;
      case 'CalendarHeart':
      default:
        return <CalendarHeart className="w-5 h-5 text-amber-400" />;
    }
  };

  return (
    <div 
      className={`rounded-2xl border transition-all duration-200 flex flex-col justify-between overflow-hidden shadow-lg ${
        isToday
          ? 'bg-gradient-to-br from-pink-950/70 via-stone-900 to-rose-950/70 border-pink-500/80 ring-2 ring-pink-500/30'
          : 'bg-stone-900/90 border-stone-800/90 hover:border-stone-700/80 hover:bg-stone-900'
      } p-3.5 sm:p-4 gap-3 text-right rtl:text-right ltr:text-left`}
      dir={isEn ? 'ltr' : 'rtl'}
    >
      {/* Top Header: Badge, Title & Actions */}
      <div>
        <div className="flex items-start justify-between gap-2 mb-2">
          {/* Type Badge & Icon */}
          <div className="flex items-center gap-2">
            <div className={`w-9 h-9 rounded-xl ${meta.badgeBg} ${meta.borderCol} border flex items-center justify-center shrink-0`}>
              {renderIcon()}
            </div>
            <div>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${meta.badgeBg} ${meta.badgeText} ${meta.borderCol}`}>
                {isEn ? meta.labelEn : meta.labelFa}
              </span>
              {isToday && (
                <span className="ms-1.5 inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-rose-500 text-white animate-pulse">
                  <PartyPopper className="w-3 h-3" />
                  {isEn ? 'TODAY!' : 'امروز!'}
                </span>
              )}
            </div>
          </div>

          {/* Edit & Delete Buttons */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => onEdit(occasion)}
              className="p-1.5 rounded-lg text-stone-400 hover:text-white hover:bg-stone-800 transition-colors cursor-pointer"
              title={isEn ? 'Edit' : 'ویرایش'}
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm(isEn ? `Delete occasion "${occasion.title}"?` : `آیا مناسبت «${occasion.title}» حذف شود؟`)) {
                  onDelete(occasion.id);
                }
              }}
              className="p-1.5 rounded-lg text-stone-400 hover:text-red-400 hover:bg-stone-800 transition-colors cursor-pointer"
              title={isEn ? 'Delete' : 'حذف'}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Title & Person */}
        <h4 className="font-black text-sm sm:text-base text-white leading-snug">
          {anniversaryLabel}
        </h4>

        {occasion.personName && occasion.title !== occasion.personName && (
          <div className="flex items-center gap-1 text-xs text-stone-400 mt-0.5">
            <User className="w-3 h-3 text-stone-500" />
            <span>{occasion.personName}</span>
          </div>
        )}
      </div>

      {/* Middle: Days Counter & Date info */}
      <div className="bg-stone-950/60 p-2.5 rounded-xl border border-stone-800/80 flex items-center justify-between gap-2 text-xs">
        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5 text-stone-300 font-bold">
            <Calendar className="w-3.5 h-3.5 text-pink-400" />
            <span>{formattedTargetDate}</span>
          </div>
          <div className="flex items-center gap-1 text-[11px] text-stone-400">
            <Clock className="w-3 h-3 text-stone-500" />
            <span>{isEn ? `Notify at ${occasion.notifyTime || '09:00'}` : `ساعت هشدار: ${toPersianDigits(occasion.notifyTime || '09:00')}`}</span>
          </div>
        </div>

        {/* Countdown Badge */}
        <div className="text-center px-2.5 py-1 rounded-xl bg-stone-900 border border-stone-700/80">
          {isToday ? (
            <span className="text-xs font-black text-rose-400">
              {isEn ? 'Today' : 'امروز'}
            </span>
          ) : daysRemaining === 1 ? (
            <span className="text-xs font-black text-amber-400">
              {isEn ? 'Tomorrow' : 'فردا'}
            </span>
          ) : (
            <div className="leading-tight">
              <span className="text-sm font-black text-white">
                {isEn ? daysRemaining : toPersianDigits(daysRemaining)}
              </span>
              <span className="block text-[10px] text-stone-400">
                {isEn ? 'days left' : 'روز مانده'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Note / Gift Idea if present */}
      {occasion.customNote && (
        <div className="text-[11px] text-stone-300 bg-stone-950/40 p-2 rounded-xl border border-stone-800/40 flex items-start gap-1.5 line-clamp-2">
          <Gift className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
          <span className="leading-relaxed">{occasion.customNote}</span>
        </div>
      )}

      {/* Footer: Quick Action to create/trigger Reminder */}
      {onCreateReminder && (
        <div className="pt-2 border-t border-stone-800/60 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => onCreateReminder(occasion)}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-xl bg-pink-500/15 hover:bg-pink-500/25 text-pink-300 hover:text-pink-200 border border-pink-500/30 text-xs font-bold transition-all active:scale-95 cursor-pointer"
          >
            <BellRing className="w-3.5 h-3.5 text-pink-400" />
            <span>{isEn ? 'Set Alarm Reminder' : 'تنظیم یادآور و آلارم در تقویم'}</span>
          </button>
        </div>
      )}
    </div>
  );
};

import React, { useState, useEffect, useRef } from 'react';
import { Reminder, Category } from '../types';
import { 
  formatJalaliTime, 
  getDayHeaderLabel, 
  getDateKey, 
  formatJalaliFull,
  getJalaliComponents,
  toPersianDigits,
  normalizeSearchText
} from '../utils/jalali';
import { 
  Filter, 
  Check, 
  CheckCircle2, 
  Clock, 
  Edit3, 
  Trash2, 
  X, 
  Plus, 
  Briefcase, 
  Heart, 
  Tag, 
  RotateCcw,
  Sparkles,
  Search
} from 'lucide-react';

interface VerticalTimelineViewProps {
  reminders: Reminder[];
  categoryFilter: 'all' | 'work' | 'family' | 'other';
  onSetCategoryFilter: (filter: 'all' | 'work' | 'family' | 'other') => void;
  onToggleComplete: (id: string) => void;
  onPostpone: (id: string, minutes: number) => void;
  onEdit: (reminder: Reminder) => void;
  onDelete: (id: string) => void;
  onCreateNew: () => void;
  language?: 'fa' | 'en';
  searchQuery?: string;
  onClearSearch?: () => void;
}

export const VerticalTimelineView: React.FC<VerticalTimelineViewProps> = ({
  reminders,
  categoryFilter,
  onSetCategoryFilter,
  onToggleComplete,
  onPostpone,
  onEdit,
  onDelete,
  onCreateNew,
  language = 'fa',
  searchQuery = '',
  onClearSearch,
}) => {
  const isEn = language === 'en';
  const [nowMs, setNowMs] = useState<number>(Date.now());
  const [selectedReminder, setSelectedReminder] = useState<Reminder | null>(null);
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState<boolean>(false);
  const [showPostponePicker, setShowPostponePicker] = useState<boolean>(false);

  const nowMarkerRef = useRef<HTMLDivElement>(null);
  const hasAutoScrolledRef = useRef<boolean>(false);

  // Live clock: update current time every second for live 'NOW' line and next reminder countdown
  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Filter out any deleted reminders (سطل بازیافت)
  const nonDeleted = reminders.filter((r) => !r.deletedAt);

  // Enhanced search filter across title, description/notes, location, category, priority, and date/time
  const searchFiltered = searchQuery.trim()
    ? nonDeleted.filter((r) => {
        const qNorm = normalizeSearchText(searchQuery);
        if (!qNorm) return true;
        const catFa = r.category === 'work' ? 'کار کاری' : r.category === 'family' ? 'خانواده خانوادگی' : 'سایر عمومی';
        const prioFa = r.priority === 'high' ? 'فوری بالا' : r.priority === 'medium' ? 'متوسط' : 'عادی پایین';
        const fullDateFa = formatJalaliFull(r.dueTimestamp, 'fa');
        const fullDateEn = formatJalaliFull(r.dueTimestamp, 'en');
        const haystack = normalizeSearchText(
          `${r.title} ${r.description || ''} ${r.geofence?.locationName || ''} ${r.geofence?.address || ''} ${catFa} ${r.category} ${prioFa} ${r.priority} ${fullDateFa} ${fullDateEn}`
        );
        const tokens = qNorm.split(' ').filter(Boolean);
        return tokens.every((tok) => haystack.includes(tok));
      })
    : nonDeleted;

  // Apply category filter
  const filteredReminders = categoryFilter === 'all'
    ? searchFiltered
    : searchFiltered.filter((r) => r.category === categoryFilter);

  // Sort chronologically ascending (oldest to newest)
  const sortedReminders = [...filteredReminders].sort((a, b) => a.dueTimestamp - b.dueTimestamp);

  // Find next reminder: earliest uncompleted reminder occurring at or after nowMs
  const nextReminder = sortedReminders.find(
    (r) => r.dueTimestamp >= nowMs && r.status !== 'completed'
  );

  // Countdown formatter for next reminder
  const formatNextCountdown = (dueMs: number, currentMs: number, isEnglish: boolean): string => {
    const diff = dueMs - currentMs;
    if (diff <= 0) {
      return isEnglish ? '00:00:00' : '۰۰:۰۰:۰۰';
    }
    const totalSecs = Math.floor(diff / 1000);
    const days = Math.floor(totalSecs / 86400);
    const hours = Math.floor((totalSecs % 86400) / 3600);
    const minutes = Math.floor((totalSecs % 3600) / 60);
    const seconds = totalSecs % 60;

    const hh = hours.toString().padStart(2, '0');
    const mm = minutes.toString().padStart(2, '0');
    const ss = seconds.toString().padStart(2, '0');

    if (days > 0) {
      if (isEnglish) {
        return `${days}d ${hh}:${mm}:${ss}`;
      }
      return `${toPersianDigits(days)} روز و ${toPersianDigits(hh)}:${toPersianDigits(mm)}:${toPersianDigits(ss)}`;
    }

    if (isEnglish) {
      return `${hh}:${mm}:${ss}`;
    }
    return `${toPersianDigits(hh)}:${toPersianDigits(mm)}:${toPersianDigits(ss)}`;
  };

  // Auto-scroll to 'NOW' marker once mounted and whenever filter changes
  useEffect(() => {
    const scrollToNow = () => {
      if (nowMarkerRef.current) {
        nowMarkerRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        hasAutoScrolledRef.current = true;
      }
    };
    const t1 = setTimeout(scrollToNow, 100);
    const t2 = setTimeout(scrollToNow, 300);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [categoryFilter]);

  // Handle Escape key to close action sheet or filter sheet
  useEffect(() => {
    if (!selectedReminder && !isFilterSheetOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedReminder(null);
        setIsFilterSheetOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedReminder, isFilterSheetOpen]);

  // Live time string for 'NOW' badge
  const liveTimeString = formatJalaliTime(nowMs, isEn ? 'en' : 'fa');

  // Find index where past ends and future begins
  const nowIndex = sortedReminders.findIndex((r) => r.dueTimestamp >= nowMs);

  const getCategoryLabel = (cat: Category) => {
    switch (cat) {
      case 'work':
        return isEn ? 'Work' : 'کاری';
      case 'family':
        return isEn ? 'Family' : 'خانوادگی';
      default:
        return isEn ? 'Other' : 'سایر';
    }
  };

  const getPriorityLabel = (p: Reminder['priority']) => {
    switch (p) {
      case 'high':
        return isEn ? 'Urgent' : 'فوری';
      case 'medium':
        return isEn ? 'Medium' : 'متوسط';
      default:
        return isEn ? 'Normal' : 'عادی';
    }
  };

  return (
    <div className="space-y-6 pb-28 select-none" dir={isEn ? 'ltr' : 'rtl'}>
      {/* 1. MINIMAL HEADER WITH CATEGORY FILTER BUTTON */}
      <div className="flex items-center justify-between pb-3 border-b border-stone-800/80">
        <div className="flex items-center gap-3">
          <h2 className="text-xl sm:text-2xl font-black text-white">
            {isEn ? 'Reminders' : 'یادآورها'}
          </h2>

          {/* Filter button next to title */}
          <button
            type="button"
            onClick={() => setIsFilterSheetOpen(true)}
            className={`min-h-[44px] px-3.5 py-2 rounded-xl border flex items-center gap-2 text-xs font-bold transition-all cursor-pointer ${
              categoryFilter !== 'all'
                ? 'bg-indigo-500/20 border-indigo-500 text-indigo-300 shadow-sm shadow-indigo-500/20'
                : 'bg-stone-900 border-stone-800 text-stone-300 hover:text-white hover:border-stone-700'
            }`}
            title={isEn ? 'Filter by category' : 'فیلتر دسته‌بندی'}
          >
            <Filter className={`w-3.5 h-3.5 ${categoryFilter !== 'all' ? 'text-indigo-400' : 'text-stone-400'}`} />
            <span>
              {categoryFilter === 'all'
                ? (isEn ? 'All Categories' : 'همه دسته‌ها')
                : categoryFilter === 'work'
                ? (isEn ? 'Work' : 'کاری')
                : categoryFilter === 'family'
                ? (isEn ? 'Family' : 'خانوادگی')
                : (isEn ? 'Other' : 'سایر')}
            </span>
          </button>
        </div>

        {/* Count Indicator */}
        <span className="text-xs font-semibold text-stone-400 bg-stone-900 px-3 py-1.5 rounded-xl border border-stone-800/80">
          {sortedReminders.length} {isEn ? 'items' : 'یادآور'}
        </span>
      </div>

      {/* 2. SINGLE VERTICAL TIMELINE */}
      <div className="relative space-y-4 max-w-3xl mx-auto">
        {sortedReminders.length === 0 ? (
          <div className="space-y-6">
            {/* The 'NOW' Line even when empty */}
            <div ref={nowMarkerRef} className="relative py-4 flex items-center justify-center">
              <div className="absolute inset-x-0 h-0.5 bg-gradient-to-r from-transparent via-indigo-500/70 to-transparent" />
              <div className="relative z-10 px-4 py-1.5 rounded-full bg-indigo-500 text-white font-black text-xs shadow-lg shadow-indigo-500/20 flex items-center gap-2 border border-indigo-400">
                <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                <span>{isEn ? 'NOW' : 'اکنون'}</span>
                <span className="font-mono">{liveTimeString}</span>
              </div>
            </div>

            {/* Empty State Card */}
            <div className="py-14 px-5 text-center rounded-2xl border border-dashed border-stone-800 bg-stone-900/30 space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-stone-800/80 border border-stone-700/60 text-stone-400 flex items-center justify-center mx-auto">
                {searchQuery.trim() ? <Search className="w-6 h-6 text-indigo-400" /> : <Clock className="w-6 h-6" />}
              </div>
              <div className="space-y-1.5">
                <h4 className="font-black text-base sm:text-lg text-white">
                  {searchQuery.trim()
                    ? (isEn ? 'Reminder not found' : 'یادآور یافت نشد')
                    : categoryFilter === 'all'
                    ? (isEn ? 'No reminders in timeline' : 'هیچ یادآوری در خط زمانی ثبت نشده است')
                    : (isEn ? 'No reminders in this category' : 'هیچ یادآوری در این دسته‌بندی یافت نشد')}
                </h4>
                <p className="text-xs sm:text-sm text-stone-400 max-w-md mx-auto">
                  {searchQuery.trim()
                    ? (isEn
                        ? `No reminder, note, or location matched "${searchQuery}".`
                        : `هیچ یادآوری با عنوان، متن، توضیحات یا مکان منطبق با «${searchQuery}» یافت نشد.`)
                    : isEn
                    ? 'Tap the button below or the + button to create a new reminder.'
                    : 'برای شروع، دکمه ثبت یادآور جدید یا دکمه + پایین صفحه را لمس کنید.'}
                </p>
              </div>
              {searchQuery.trim() && onClearSearch ? (
                <button
                  type="button"
                  onClick={onClearSearch}
                  className="min-h-[44px] px-5 py-2 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-200 hover:text-white font-bold text-xs transition-all cursor-pointer inline-flex items-center gap-2"
                >
                  <X className="w-4 h-4" />
                  <span>{isEn ? 'Clear Search' : 'پاک کردن جستجو'}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onCreateNew}
                  className="min-h-[48px] px-6 py-2.5 rounded-2xl bg-indigo-500 hover:bg-indigo-400 text-white font-black text-xs sm:text-sm transition-all shadow-md active:scale-95 cursor-pointer inline-flex items-center gap-2"
                >
                  <Plus className="w-4 h-4 stroke-[3]" />
                  <span>{isEn ? 'New Reminder' : 'ثبت یادآور جدید'}</span>
                </button>
              )}
            </div>
          </div>
        ) : (
          (() => {
            // Group reminders with day headers and the 'NOW' line inserted at the exact transition point
            let lastDateKey: string | null = null;
            const elements: React.ReactNode[] = [];
            let nowLineRendered = false;

            const renderNowLine = () => (
              <div 
                key="now-indicator-line" 
                ref={nowMarkerRef} 
                className="relative py-4 my-2 flex items-center justify-center"
              >
                {/* Horizontal line across the container */}
                <div className="absolute inset-x-0 h-0.5 bg-gradient-to-r from-transparent via-indigo-500/80 to-transparent" />
                {/* Centered Small Badge with Live Clock */}
                <div className="relative z-10 px-4 py-1.5 rounded-full bg-indigo-500 text-white font-black text-xs shadow-lg shadow-indigo-500/25 flex items-center gap-2 border border-indigo-300">
                  <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                  <span>{isEn ? 'NOW' : 'اکنون'}</span>
                  <span className="font-mono">{liveTimeString}</span>
                </div>
              </div>
            );

            // If all reminders are in the future, render NOW line first
            if (nowIndex === 0) {
              elements.push(renderNowLine());
              nowLineRendered = true;
            }

            sortedReminders.forEach((reminder, index) => {
              // Check if we reached the NOW transition boundary
              if (!nowLineRendered && index === nowIndex) {
                elements.push(renderNowLine());
                nowLineRendered = true;
              }

              // Day Header Check: only show small day header when day changes
              const dateKey = getDateKey(reminder.dueTimestamp);
              if (dateKey !== lastDateKey) {
                lastDateKey = dateKey;
                const dayLabel = getDayHeaderLabel(reminder.dueTimestamp, isEn ? 'en' : 'fa');
                elements.push(
                  <div key={`day-header-${dateKey}-${index}`} className="pt-3 pb-1">
                    <span className="inline-block text-[11px] sm:text-xs font-bold text-stone-400 px-3 py-1 rounded-lg bg-stone-900/80 border border-stone-800/80">
                      {dayLabel}
                    </span>
                  </div>
                );
              }

              const isPast = reminder.dueTimestamp < nowMs;
              const isCompleted = reminder.status === 'completed';
              const isOverdueUncompleted = isPast && !isCompleted;
              const isNext = reminder.id === nextReminder?.id;

              // Card minimal styling according to rules:
              // - انجام شده: کمرنگ با خط خورده
              // - گذشته و انجام نشده: رنگ هشدار ملایم
              // - گذشته: بالای خط اکنون (کمرنگ‌تر)
              // - آینده: پایین خط اکنون
              // - یادآوری بعدی: بیرون زدگی هلالی متصل به کارت با شمارش معکوس سبز
              let cardStyle = '';
              if (isCompleted) {
                cardStyle = 'bg-stone-900/40 border-stone-800/50 text-stone-500 opacity-60';
              } else if (isOverdueUncompleted) {
                cardStyle = 'bg-rose-950/20 border-rose-500/30 text-rose-100 hover:border-rose-500/50 shadow-sm';
              } else if (isNext) {
                cardStyle = 'relative bg-stone-900 border-emerald-500/80 text-stone-100 hover:border-emerald-400 shadow-xl shadow-emerald-500/15 ring-1 ring-emerald-500/35 pt-5 sm:pt-6 mt-3.5';
              } else if (isPast) {
                cardStyle = 'bg-stone-900/60 border-stone-800/60 text-stone-300 opacity-75';
              } else {
                cardStyle = 'bg-stone-900 border-stone-800 text-stone-100 hover:border-stone-700 shadow-sm';
              }

              // Priority / Category dot color
              const dotColor =
                reminder.priority === 'high'
                  ? 'bg-red-500 ring-2 ring-red-500/30'
                  : reminder.category === 'work'
                  ? 'bg-cyan-400'
                  : reminder.category === 'family'
                  ? 'bg-rose-400'
                  : 'bg-indigo-400';

              elements.push(
                <div
                  key={reminder.id}
                  onClick={() => {
                    setShowPostponePicker(false);
                    setSelectedReminder(reminder);
                  }}
                  className={`w-full p-4 sm:p-5 rounded-2xl border transition-all duration-150 cursor-pointer flex items-center justify-between gap-3 active:scale-[0.99] ${cardStyle}`}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setShowPostponePicker(false);
                      setSelectedReminder(reminder);
                    }
                  }}
                >
                  {/* کادر شمارش معکوس برای یادآوری بعدی (Countdown Badge without crescent wings) */}
                  {isNext && (
                    <div className="absolute -top-3.5 inset-x-0 flex items-center justify-center z-10 pointer-events-none">
                      <div className="px-3 sm:px-4 py-1 rounded-full bg-emerald-500 text-stone-950 font-black text-xs shadow-lg shadow-emerald-500/35 flex items-center gap-2 border border-emerald-300 pointer-events-auto">
                        <span className="w-2 h-2 rounded-full bg-stone-950 animate-pulse shrink-0" />
                        <span className="tracking-wide uppercase text-[10px] sm:text-[11px]">
                          {isEn ? 'NEXT' : 'یادآوری بعدی'}
                        </span>
                        <span className="font-mono font-extrabold text-xs sm:text-sm">
                          {formatNextCountdown(reminder.dueTimestamp, nowMs, isEn)}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Title, Optional Description Snippet & Small Dot */}
                  <div className="flex flex-col gap-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span 
                        className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`}
                        title={`${getCategoryLabel(reminder.category)} • ${getPriorityLabel(reminder.priority)}`}
                      />
                      <span className={`text-sm sm:text-base font-bold truncate ${isCompleted ? 'line-through text-stone-500' : ''}`}>
                        {reminder.title}
                      </span>
                    </div>
                    {reminder.description && (
                      <p className="text-[11px] sm:text-xs text-stone-400 truncate ps-4.5">
                        {reminder.description}
                      </p>
                    )}
                  </div>

                  {/* Time & Date (with Year) */}
                  <div className="shrink-0 text-end flex flex-col items-end gap-0.5">
                    <div className="text-xs sm:text-sm font-mono text-stone-300 font-bold flex items-center gap-1.5">
                      {isCompleted && (
                        <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      )}
                      <span>{formatJalaliTime(reminder.dueTimestamp, isEn ? 'en' : 'fa')}</span>
                    </div>
                    <span className="text-[10px] sm:text-[11px] text-stone-400">
                      {isEn
                        ? new Date(reminder.dueTimestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                        : getJalaliComponents(reminder.dueTimestamp).dateString}
                    </span>
                  </div>
                </div>
              );
            });

            // If NOW line was not inserted (all reminders are in the past), render at the bottom
            if (!nowLineRendered) {
              elements.push(renderNowLine());
            }

            return elements;
          })()
        )}
      </div>

      {/* 3. CARD ACTION BOTTOM SHEET (با لمس کارت: انجام شد، تعویق، ویرایش، حذف) */}
      {selectedReminder && (
        <div 
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end justify-center animate-in fade-in duration-150"
          onClick={() => {
            setSelectedReminder(null);
            setShowPostponePicker(false);
          }}
        >
          <div
            className="w-full max-w-lg bg-stone-900 border-t border-stone-800 rounded-t-3xl p-5 sm:p-6 space-y-4 shadow-2xl animate-in slide-in-from-bottom duration-200"
            onClick={(e) => e.stopPropagation()}
            dir={isEn ? 'ltr' : 'rtl'}
          >
            {/* Grab Handle */}
            <div className="w-12 h-1.5 bg-stone-700/80 rounded-full mx-auto" />

            {/* Header: Title & Time */}
            <div className="flex items-start justify-between gap-3 pt-1">
              <div className="space-y-1 min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`w-2.5 h-2.5 rounded-full ${
                    selectedReminder.priority === 'high' ? 'bg-red-500' : 'bg-indigo-400'
                  }`} />
                  <span className="text-xs text-stone-400 font-medium">
                    {getCategoryLabel(selectedReminder.category)} • {getPriorityLabel(selectedReminder.priority)}
                  </span>
                </div>
                <h3 className={`text-base sm:text-lg font-bold text-white break-words ${
                  selectedReminder.status === 'completed' ? 'line-through text-stone-400' : ''
                }`}>
                  {selectedReminder.title}
                </h3>
                <p className="text-xs text-stone-400">
                  {formatJalaliFull(selectedReminder.dueTimestamp, isEn ? 'en' : 'fa')}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setSelectedReminder(null)}
                className="min-h-[40px] p-2 text-stone-400 hover:text-white rounded-xl hover:bg-stone-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Quick Postpone options if toggled */}
            {showPostponePicker ? (
              <div className="space-y-2 p-3 bg-stone-950/60 rounded-2xl border border-stone-800 animate-in fade-in duration-150">
                <span className="text-xs font-bold text-stone-300 block mb-2">
                  {isEn ? 'Choose postponement duration:' : 'مدت زمان تعویق را انتخاب کنید:'}
                </span>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: isEn ? '+15 Minutes' : '۱۵ دقیقه', mins: 15 },
                    { label: isEn ? '+30 Minutes' : '۳۰ دقیقه', mins: 30 },
                    { label: isEn ? '+1 Hour' : '۱ ساعت', mins: 60 },
                    { label: isEn ? '+24 Hours (Tomorrow)' : 'فردا (۲۴ ساعت)', mins: 1440 },
                  ].map((opt) => (
                    <button
                      key={opt.mins}
                      type="button"
                      onClick={() => {
                        onPostpone(selectedReminder.id, opt.mins);
                        setSelectedReminder(null);
                        setShowPostponePicker(false);
                      }}
                      className="min-h-[48px] py-2.5 px-3 rounded-xl bg-stone-900 hover:bg-stone-800 text-stone-200 hover:text-white text-xs font-bold border border-stone-800 transition-all cursor-pointer text-center"
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Action Buttons (حداقل ۴۸ پیکسل) */}
            <div className="space-y-2 pt-2">
              {/* 1. انجام شد / انجام نشده */}
              <button
                type="button"
                onClick={() => {
                  onToggleComplete(selectedReminder.id);
                  setSelectedReminder(null);
                }}
                className={`min-h-[48px] w-full px-4 py-3 rounded-2xl font-black text-sm flex items-center justify-center gap-2.5 transition-all cursor-pointer ${
                  selectedReminder.status === 'completed'
                    ? 'bg-stone-800 hover:bg-stone-700 text-stone-200'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20'
                }`}
              >
                <CheckCircle2 className="w-5 h-5" />
                <span>
                  {selectedReminder.status === 'completed'
                    ? (isEn ? 'Mark as Incomplete' : 'تغییر به انجام‌نشده')
                    : (isEn ? 'Mark as Completed' : 'انجام شد')}
                </span>
              </button>

              {/* 2. تعویق (Snooze) */}
              <button
                type="button"
                onClick={() => setShowPostponePicker(!showPostponePicker)}
                className="min-h-[48px] w-full px-4 py-3 rounded-2xl bg-stone-800/90 hover:bg-stone-700/90 text-stone-200 font-bold text-sm flex items-center justify-center gap-2.5 transition-all cursor-pointer"
              >
                <Clock className="w-5 h-5 text-indigo-400" />
                <span>{isEn ? 'Snooze / Postpone' : 'تعویق زمان'}</span>
              </button>

              {/* 3. ویرایش */}
              <button
                type="button"
                onClick={() => {
                  const rem = selectedReminder;
                  setSelectedReminder(null);
                  onEdit(rem);
                }}
                className="min-h-[48px] w-full px-4 py-3 rounded-2xl bg-stone-800/90 hover:bg-stone-700/90 text-stone-200 font-bold text-sm flex items-center justify-center gap-2.5 transition-all cursor-pointer"
              >
                <Edit3 className="w-5 h-5 text-sky-400" />
                <span>{isEn ? 'Edit Reminder' : 'ویرایش یادآور'}</span>
              </button>

              {/* 4. حذف (انتقال به سطل بازیافت) */}
              <button
                type="button"
                onClick={() => {
                  const remId = selectedReminder.id;
                  setSelectedReminder(null);
                  onDelete(remId);
                }}
                className="min-h-[48px] w-full px-4 py-3 rounded-2xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 font-bold text-sm flex items-center justify-center gap-2.5 border border-rose-500/25 transition-all cursor-pointer"
              >
                <Trash2 className="w-5 h-5 text-rose-400" />
                <span>{isEn ? 'Move to Recycle Bin' : 'انتقال به سطل بازیافت'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. CATEGORY FILTER BOTTOM SHEET */}
      {isFilterSheetOpen && (
        <div 
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end justify-center animate-in fade-in duration-150"
          onClick={() => setIsFilterSheetOpen(false)}
        >
          <div
            className="w-full max-w-md bg-stone-900 border-t border-stone-800 rounded-t-3xl p-5 sm:p-6 space-y-4 shadow-2xl animate-in slide-in-from-bottom duration-200"
            onClick={(e) => e.stopPropagation()}
            dir={isEn ? 'ltr' : 'rtl'}
          >
            <div className="w-12 h-1.5 bg-stone-700/80 rounded-full mx-auto" />

            <div className="flex items-center justify-between pb-2 border-b border-stone-800">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Filter className="w-4 h-4 text-indigo-400" />
                <span>{isEn ? 'Filter by Category' : 'انتخاب دسته‌بندی'}</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsFilterSheetOpen(false)}
                className="p-1.5 text-stone-400 hover:text-white rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2">
              {[
                { id: 'all', label: isEn ? 'All Categories' : 'همه دسته‌ها', icon: Sparkles, count: nonDeleted.length },
                { id: 'work', label: isEn ? 'Work' : 'کاری', icon: Briefcase, count: nonDeleted.filter((r) => r.category === 'work').length },
                { id: 'family', label: isEn ? 'Family' : 'خانوادگی', icon: Heart, count: nonDeleted.filter((r) => r.category === 'family').length },
                { id: 'other', label: isEn ? 'Other' : 'سایر', icon: Tag, count: nonDeleted.filter((r) => r.category === 'other').length },
              ].map((cat) => {
                const Icon = cat.icon;
                const isSelected = categoryFilter === cat.id;

                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => {
                      onSetCategoryFilter(cat.id as any);
                      setIsFilterSheetOpen(false);
                    }}
                    className={`min-h-[48px] w-full px-4 py-3 rounded-2xl flex items-center justify-between transition-all cursor-pointer border ${
                      isSelected
                        ? 'bg-indigo-500/15 border-indigo-500 text-white font-bold'
                        : 'bg-stone-900 border-stone-800 text-stone-300 hover:text-white hover:bg-stone-800/60'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Icon className={`w-4 h-4 ${isSelected ? 'text-indigo-400' : 'text-stone-400'}`} />
                      <span className="text-sm">{cat.label}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-xs text-stone-400 font-mono">
                        ({cat.count})
                      </span>
                      {isSelected && <Check className="w-4 h-4 text-indigo-400" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

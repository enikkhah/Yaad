import React, { useState, useEffect, useRef } from 'react';
import { motion, LayoutGroup } from 'motion/react';
import { Reminder, Category } from '../types';
import { 
  formatJalaliTime, 
  getDayHeaderLabel, 
  getDateKey, 
  formatJalaliFull,
  getJalaliComponents,
  toPersianDigits,
  matchesReminderSearch
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
  const [completingIds, setCompletingIds] = useState<Record<string, boolean>>({});
  const [justSettledIds, setJustSettledIds] = useState<Record<string, boolean>>({});

  const nowMarkerRef = useRef<HTMLDivElement>(null);
  const hasAutoScrolledRef = useRef<boolean>(false);
  const completionTimersRef = useRef<Record<string, number>>({});

  useEffect(() => {
    return () => {
      Object.values(completionTimersRef.current).forEach((timerId) => window.clearTimeout(timerId));
    };
  }, []);

  const triggerAnimatedToggleComplete = (reminder: Reminder) => {
    const id = reminder.id;
    // If already completed, toggle back immediately so layout animates it back to active section
    if (reminder.status === 'completed') {
      onToggleComplete(id);
      return;
    }
    if (completingIds[id]) return;

    // Stage 1: In-place color morph to emerald completion state
    setCompletingIds((prev) => ({ ...prev, [id]: true }));

    // Stage 2: Commit completion so layout smoothly glides card to its destination list position
    completionTimersRef.current[id] = window.setTimeout(() => {
      onToggleComplete(id);
      setCompletingIds((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setJustSettledIds((prev) => ({ ...prev, [id]: true }));

      completionTimersRef.current[`${id}_settle`] = window.setTimeout(() => {
        setJustSettledIds((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }, 850);
    }, 340);
  };

  // Live clock: update current time every second for live 'NOW' line and next reminder countdown
  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Filter out any deleted reminders (سطل بازیافت)
  const nonDeleted = reminders.filter((r) => !r.deletedAt);

  // Enhanced bilingual search filter across all user-entered reminder fields
  const searchFiltered = searchQuery.trim()
    ? nonDeleted.filter((r) => matchesReminderSearch(r, searchQuery))
    : nonDeleted;

  // Apply category filter
  const filteredReminders = categoryFilter === 'all'
    ? searchFiltered
    : searchFiltered.filter((r) => r.category === categoryFilter);

  // Group into 3 logical timeline sections so completed items settle into the completed zone above NOW:
  // 0: Completed reminders (above NOW)
  // 1: Overdue uncompleted reminders (right above NOW)
  // 2: Upcoming uncompleted reminders (below NOW)
  const getTimelineZone = (r: Reminder): number => {
    if (r.status === 'completed') return 0;
    if (r.dueTimestamp < nowMs) return 1;
    return 2;
  };

  const sortedReminders = [...filteredReminders].sort((a, b) => {
    const zoneA = getTimelineZone(a);
    const zoneB = getTimelineZone(b);
    if (zoneA !== zoneB) return zoneA - zoneB;
    return a.dueTimestamp - b.dueTimestamp;
  });

  // Find next reminder: earliest uncompleted reminder occurring at or after nowMs
  const nextReminder = sortedReminders.find(
    (r) => r.dueTimestamp >= nowMs && r.status !== 'completed' && !completingIds[r.id]
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

  // Find index where past/completed ends and upcoming uncompleted begins
  const nowIndex = sortedReminders.findIndex(
    (r) => r.status !== 'completed' && r.dueTimestamp >= nowMs
  );

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
          {isEn ? sortedReminders.length : toPersianDigits(sortedReminders.length)} {isEn ? 'items' : 'یادآور'}
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
          <LayoutGroup id="vertical-timeline-group">
            {(() => {
              // Group reminders with day headers and the 'NOW' line inserted at the exact transition point
              let lastGroupDateKey: string | null = null;
              const elements: React.ReactNode[] = [];
              let nowLineRendered = false;

              const renderNowLine = () => (
                <motion.div
                  layout="position"
                  transition={{ layout: { type: 'spring', stiffness: 320, damping: 28 } }}
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
                </motion.div>
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

                // Day Header Check: show small day header when zone or day changes
                const zone = getTimelineZone(reminder);
                const dateKey = getDateKey(reminder.dueTimestamp);
                const groupDateKey = `${zone}-${dateKey}`;
                if (groupDateKey !== lastGroupDateKey) {
                  lastGroupDateKey = groupDateKey;
                  const dayLabel = getDayHeaderLabel(reminder.dueTimestamp, isEn ? 'en' : 'fa');
                  elements.push(
                    <motion.div
                      layout="position"
                      transition={{ layout: { type: 'spring', stiffness: 320, damping: 28 } }}
                      key={`day-header-${groupDateKey}`}
                      className="pt-3 pb-1 flex items-center gap-2"
                    >
                      <span className="inline-block text-[11px] sm:text-xs font-bold text-stone-400 px-3 py-1 rounded-lg bg-stone-900/80 border border-stone-800/80">
                        {dayLabel}
                      </span>
                      {zone === 0 && (
                        <span className="inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-bold text-emerald-400/90 px-2.5 py-0.5 rounded-lg bg-emerald-950/40 border border-emerald-500/25">
                          <Check className="w-3 h-3 stroke-[2.5]" />
                          <span>{isEn ? 'Completed' : 'انجام شده'}</span>
                        </span>
                      )}
                    </motion.div>
                  );
                }

                const isPast = reminder.dueTimestamp < nowMs;
                const isCompleted = reminder.status === 'completed';
                const isCompleting = Boolean(completingIds[reminder.id]);
                const isRecentlySettled =
                  Boolean(justSettledIds[reminder.id]) ||
                  Boolean(reminder.completedAt && nowMs - reminder.completedAt < 1400) ||
                  Boolean(reminder.lastActionAt && nowMs - reminder.lastActionAt < 1400);
                const isOverdueUncompleted = isPast && !isCompleted && !isCompleting;
                const isNext = reminder.id === nextReminder?.id && !isCompleting;

                // Card minimal styling with smooth 2-stage completion color transition:
                // - در حال انجام شدن (Stage 1): سبز زمردی شاداب با درخشش ملایم
                // - تازه جاگیری شده در لیست انجام‌شده‌ها (Stage 2): گذار نرم از سبز به خاکستری آرام
                // - انجام شده نهایی: کمرنگ با خط خورده
                // - گذشته و انجام نشده: رنگ هشدار ملایم
                // - یادآوری بعدی: کادر سبز با شمارش معکوس
                let cardStyle = '';
                if (isCompleting) {
                  cardStyle =
                    'bg-emerald-950/65 border-emerald-400/90 text-emerald-50 shadow-lg shadow-emerald-500/20 ring-1 ring-emerald-400/40 scale-[1.01]';
                } else if (isCompleted && isRecentlySettled) {
                  cardStyle =
                    'bg-emerald-950/25 border-emerald-500/40 text-stone-300 opacity-85 shadow-sm shadow-emerald-500/10';
                } else if (isCompleted) {
                  cardStyle = 'bg-stone-900/40 border-stone-800/50 text-stone-500 opacity-60';
                } else if (isOverdueUncompleted) {
                  cardStyle = 'bg-rose-950/20 border-rose-500/30 text-rose-100 hover:border-rose-500/50 shadow-sm';
                } else if (isNext) {
                  cardStyle =
                    'relative bg-stone-900 border-emerald-500/80 text-stone-100 hover:border-emerald-400 shadow-xl shadow-emerald-500/15 ring-1 ring-emerald-500/35 pt-5 sm:pt-6 mt-3.5';
                } else if (isPast) {
                  cardStyle = 'bg-stone-900/60 border-stone-800/60 text-stone-300 opacity-75';
                } else if (isRecentlySettled) {
                  // Recurring reminder that just advanced to its next future occurrence
                  cardStyle =
                    'bg-emerald-950/30 border-emerald-500/50 text-stone-100 shadow-md shadow-emerald-500/10';
                } else {
                  cardStyle = 'bg-stone-900 border-stone-800 text-stone-100 hover:border-stone-700 shadow-sm';
                }

                // Priority / Category hollow circle color coding
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

                elements.push(
                  <motion.div
                    layout
                    transition={{
                      layout: { type: 'spring', stiffness: 320, damping: 28 },
                    }}
                    key={reminder.id}
                    onClick={() => {
                      setShowPostponePicker(false);
                      setSelectedReminder(reminder);
                    }}
                    className={`w-full p-4 sm:p-5 rounded-2xl border transition-colors duration-500 cursor-pointer flex items-center justify-between gap-3 active:scale-[0.99] ${cardStyle}`}
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

                    {/* Title, Optional Description Snippet & Larger Hollow Colored Circle with Checkmark Completion */}
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          triggerAnimatedToggleComplete(reminder);
                        }}
                        className={`w-6 h-6 sm:w-6.5 sm:h-6.5 rounded-full border-[2.5px] flex items-center justify-center shrink-0 transition-all duration-300 cursor-pointer active:scale-90 group ${
                          isCompleting
                            ? 'border-emerald-400 bg-emerald-500 text-stone-950 scale-110 shadow-sm shadow-emerald-500/40'
                            : isCompleted && isRecentlySettled
                            ? 'border-emerald-400 bg-emerald-500/30 text-emerald-300'
                            : isCompleted
                            ? completedCircleColor
                            : `bg-transparent ${circleBorderColor}`
                        }`}
                        title={
                          isCompleted
                            ? (isEn ? 'Completed (Click to undo)' : 'انجام شده (برای بازگردانی ضربه بزنید)')
                            : `${isEn ? 'Mark as completed' : 'انجام شد'} • ${getCategoryLabel(reminder.category)} (${getPriorityLabel(reminder.priority)})`
                        }
                        aria-label={isCompleted ? (isEn ? 'Completed' : 'انجام شده') : (isEn ? 'Mark as completed' : 'انجام شد')}
                      >
                        <Check
                          className={`w-3.5 h-3.5 stroke-[3] transition-all duration-200 ${
                            isCompleted || isCompleting
                              ? 'opacity-100 scale-100'
                              : 'opacity-0 scale-50 group-hover:opacity-60 group-hover:scale-90'
                          }`}
                        />
                      </button>

                      <div className="flex flex-col gap-1 min-w-0 flex-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`text-sm sm:text-base font-bold truncate transition-colors duration-500 ${
                              isCompleting
                                ? 'line-through text-emerald-200'
                                : isCompleted
                                ? 'line-through text-stone-500'
                                : ''
                            }`}
                          >
                            {reminder.title}
                          </span>
                        </div>
                        {reminder.description && (
                          <p
                            className={`text-[11px] sm:text-xs truncate transition-colors duration-500 ${
                              isCompleting ? 'text-emerald-300/80' : 'text-stone-400'
                            }`}
                          >
                            {reminder.description}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Time & Date (with Year) */}
                    <div className="shrink-0 text-end flex flex-col items-end gap-0.5">
                      <div className="text-xs sm:text-sm font-mono text-stone-300 font-bold flex items-center gap-1.5">
                        {(isCompleted || isCompleting) && (
                          <Check
                            className={`w-3.5 h-3.5 shrink-0 transition-transform duration-300 ${
                              isCompleting ? 'text-emerald-300 scale-125' : 'text-emerald-400'
                            }`}
                          />
                        )}
                        <span className={isCompleting ? 'text-emerald-200' : ''}>
                          {formatJalaliTime(reminder.dueTimestamp, isEn ? 'en' : 'fa')}
                        </span>
                      </div>
                      <span className={`text-[10px] sm:text-[11px] ${isCompleting ? 'text-emerald-300/80' : 'text-stone-400'}`}>
                        {isEn
                          ? new Date(reminder.dueTimestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                          : getJalaliComponents(reminder.dueTimestamp).dateString}
                      </span>
                    </div>
                  </motion.div>
                );
              });

              // If NOW line was not inserted (all reminders are in the past/completed), render at the bottom
              if (!nowLineRendered) {
                elements.push(renderNowLine());
              }

              return elements;
            })()}
          </LayoutGroup>
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
                  <span className={`w-4 h-4 rounded-full border-2 bg-transparent ${
                    selectedReminder.priority === 'high'
                      ? 'border-red-500'
                      : selectedReminder.category === 'work'
                      ? 'border-cyan-400'
                      : selectedReminder.category === 'family'
                      ? 'border-rose-400'
                      : 'border-indigo-400'
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
                  const targetReminder = selectedReminder;
                  setSelectedReminder(null);
                  triggerAnimatedToggleComplete(targetReminder);
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
                        ({isEn ? cat.count : toPersianDigits(cat.count)})
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

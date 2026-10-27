import React, { useState, useEffect, useRef } from 'react';
import { motion, LayoutGroup } from 'motion/react';
import { Reminder, Category, InProgressItem, MedicationItem } from '../types';
import { InProgressPanel } from './InProgressPanel';
import { MedicationPanel } from './MedicationPanel';
import { isInProgressItemOverdue } from '../utils/inProgressNotifications';
import { isMedicationActiveOnDate, isMedicationLowStock } from '../utils/medicationNotifications';
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
  Search,
  Layers,
  Bell,
  Pill
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
  inProgressItems?: InProgressItem[];
  onSaveInProgressItem?: (
    itemData: Omit<InProgressItem, 'id' | 'createdAt' | 'lastUpdatedAt'>,
    editingId?: string
  ) => void;
  onUpdateInProgressProgress?: (id: string, newProgress: number, customNote?: string) => void;
  onToggleInProgressComplete?: (id: string) => void;
  onDeleteInProgressItem?: (id: string) => void;
  medications?: MedicationItem[];
  onSaveMedication?: (
    medData: Omit<MedicationItem, 'id' | 'createdAt' | 'updatedAt' | 'history'>,
    editingId?: string
  ) => void;
  onLogMedicationDose?: (
    medicationId: string,
    dateKey: string,
    scheduledTime: string,
    status: 'taken' | 'missed' | 'reset'
  ) => void;
  onDeleteMedication?: (id: string) => void;
  onRefillMedicationStock?: (id: string, addedAmount: number) => void;
  activeSubPage?: 'timeline' | 'in_progress' | 'medication';
  onChangeSubPage?: (page: 'timeline' | 'in_progress' | 'medication') => void;
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
  inProgressItems = [],
  onSaveInProgressItem,
  onUpdateInProgressProgress,
  onToggleInProgressComplete,
  onDeleteInProgressItem,
  medications = [],
  onSaveMedication,
  onLogMedicationDose,
  onDeleteMedication,
  onRefillMedicationStock,
  activeSubPage: controlledSubPage,
  onChangeSubPage,
}) => {
  const isEn = language === 'en';
  const [internalSubPage, setInternalSubPage] = useState<'timeline' | 'in_progress' | 'medication'>('timeline');
  const [subPageVisitTick, setSubPageVisitTick] = useState<number>(0);
  const activeSubPage = controlledSubPage ?? internalSubPage;
  const setActiveSubPage = (page: 'timeline' | 'in_progress' | 'medication') => {
    setInternalSubPage(page);
    onChangeSubPage?.(page);
    setSubPageVisitTick((prev) => prev + 1);
  };
  const [nowMs, setNowMs] = useState<number>(Date.now());
  const [selectedReminder, setSelectedReminder] = useState<Reminder | null>(null);
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState<boolean>(false);
  const [showPostponePicker, setShowPostponePicker] = useState<boolean>(false);
  const [completingIds, setCompletingIds] = useState<Record<string, boolean>>({});
  const [justSettledIds, setJustSettledIds] = useState<Record<string, boolean>>({});
  const [emeraldFadeIds, setEmeraldFadeIds] = useState<Record<string, boolean>>({});

  const nowMarkerRef = useRef<HTMLDivElement>(null);
  const hasAutoScrolledRef = useRef<boolean>(false);
  const completionTimersRef = useRef<Record<string, number>>({});
  const seenExternalActionRef = useRef<Record<string, number>>({});

  useEffect(() => {
    return () => {
      Object.values(completionTimersRef.current).forEach((timerId) => window.clearTimeout(timerId));
    };
  }, []);

  // Detect completions triggered externally (e.g., from AlarmModal or notification) and run fast settle highlight
  useEffect(() => {
    const now = Date.now();
    reminders.forEach((r) => {
      const actionTs = r.completedAt || r.lastActionAt || 0;
      if (
        actionTs > 0 &&
        now - actionTs < 1200 &&
        seenExternalActionRef.current[r.id] !== actionTs &&
        !completingIds[r.id] &&
        !justSettledIds[r.id]
      ) {
        seenExternalActionRef.current[r.id] = actionTs;
        setJustSettledIds((prev) => ({ ...prev, [r.id]: true }));
        setEmeraldFadeIds((prev) => ({ ...prev, [r.id]: true }));

        completionTimersRef.current[`${r.id}_ext_fade`] = window.setTimeout(() => {
          setEmeraldFadeIds((prev) => {
            const next = { ...prev };
            delete next[r.id];
            return next;
          });
        }, 220);

        completionTimersRef.current[`${r.id}_ext_settle`] = window.setTimeout(() => {
          setJustSettledIds((prev) => {
            const next = { ...prev };
            delete next[r.id];
            return next;
          });
        }, 550);
      }
    });
  }, [reminders, completingIds, justSettledIds]);

  const triggerAnimatedToggleComplete = (reminder: Reminder) => {
    const id = reminder.id;
    // If already completed, toggle back immediately so layout animates it back across NOW to its active position
    if (reminder.status === 'completed') {
      seenExternalActionRef.current[id] = Date.now();
      setJustSettledIds((prev) => ({ ...prev, [id]: true }));
      onToggleComplete(id);
      completionTimersRef.current[`${id}_uncomplete`] = window.setTimeout(() => {
        setJustSettledIds((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }, 450);
      return;
    }
    if (completingIds[id]) return;

    // Stage 1 (0–150ms): Quick in-place color morph to emerald completion state
    setCompletingIds((prev) => ({ ...prev, [id]: true }));

    // Stage 2: Fast, smooth glide to destination across NOW line + color settle
    completionTimersRef.current[id] = window.setTimeout(() => {
      seenExternalActionRef.current[id] = Date.now();
      onToggleComplete(id);
      setCompletingIds((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setJustSettledIds((prev) => ({ ...prev, [id]: true }));
      setEmeraldFadeIds((prev) => ({ ...prev, [id]: true }));

      completionTimersRef.current[`${id}_fade`] = window.setTimeout(() => {
        setEmeraldFadeIds((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }, 200);

      completionTimersRef.current[`${id}_settle`] = window.setTimeout(() => {
        setJustSettledIds((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }, 550);
    }, 150);
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

  // Auto-scroll 'NOW' marker (`اکنون`) to the center of the screen every time the Reminders page is opened
  const centerNowMarker = (behavior: ScrollBehavior = 'smooth') => {
    if (nowMarkerRef.current) {
      nowMarkerRef.current.scrollIntoView({ behavior, block: 'center' });
      hasAutoScrolledRef.current = true;
    }
  };

  useEffect(() => {
    if (activeSubPage === 'timeline') {
      const t1 = window.setTimeout(() => centerNowMarker('smooth'), 60);
      const t2 = window.setTimeout(() => centerNowMarker('smooth'), 240);
      const t3 = window.setTimeout(() => centerNowMarker('smooth'), 480);
      return () => {
        window.clearTimeout(t1);
        window.clearTimeout(t2);
        window.clearTimeout(t3);
      };
    }

    // On every visit to 'in_progress' or 'medication', bring the top registration section into user view
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const s1 = window.setTimeout(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 60);
    const s2 = window.setTimeout(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 180);
    return () => {
      window.clearTimeout(s1);
      window.clearTimeout(s2);
    };
  }, [activeSubPage, categoryFilter, subPageVisitTick]);

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

  const activeInProgressCount = inProgressItems.filter((i) => !i.deletedAt && !i.completed).length;
  const overdueInProgressCount = inProgressItems.filter((i) => isInProgressItemOverdue(i, nowMs)).length;
  const activeMedicationCount = medications.filter(
    (m) => !m.deletedAt && isMedicationActiveOnDate(m, new Date(nowMs))
  ).length;
  const lowStockMedicationCount = medications.filter(
    (m) => !m.deletedAt && isMedicationLowStock(m)
  ).length;

  return (
    <div className="space-y-5 pb-28 select-none" dir={isEn ? 'ltr' : 'rtl'}>
      {/* TOP SUB-PAGE SWITCHER: FROZEN (STICKY) AT TOP OF PAGE ON SCROLL */}
      <div className="sticky top-16 sm:top-18 z-25 -mt-4 sm:-mt-6 -mx-3 sm:-mx-6 px-3 sm:px-6 py-2.5 bg-stone-950/95 backdrop-blur-md border-b border-stone-800/80 shadow-md transition-colors duration-200">
        <div className="grid grid-cols-3 gap-1.5 sm:gap-2 p-1.5 rounded-2xl bg-stone-900 border border-stone-800 max-w-3xl mx-auto">
          <button
            type="button"
            onClick={() => {
              setActiveSubPage('timeline');
              window.setTimeout(() => centerNowMarker('smooth'), 80);
            }}
            className={`min-h-[44px] px-2 sm:px-3 py-2 rounded-xl text-[11px] sm:text-sm font-black flex items-center justify-center gap-1.5 sm:gap-2 transition-all cursor-pointer ${
              activeSubPage === 'timeline'
                ? 'bg-indigo-500 text-white shadow-sm'
                : 'text-stone-300 hover:text-white'
            }`}
          >
            <Bell
              className={`w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0 ${
                activeSubPage === 'timeline' ? 'text-amber-300' : 'text-indigo-400'
              }`}
            />
            <span className="truncate">{isEn ? 'Reminders' : 'یادآورهای زمانی'}</span>
            <span
              className={`px-1.5 py-0.5 rounded-md text-[10px] font-mono shrink-0 ${
                activeSubPage === 'timeline'
                  ? 'bg-white/20 text-white'
                  : 'bg-stone-800 text-stone-300'
              }`}
            >
              {isEn ? sortedReminders.length : toPersianDigits(sortedReminders.length)}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveSubPage('in_progress');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className={`min-h-[44px] px-2 sm:px-3 py-2 rounded-xl text-[11px] sm:text-sm font-black flex items-center justify-center gap-1.5 sm:gap-2 transition-all cursor-pointer ${
              activeSubPage === 'in_progress'
                ? 'bg-indigo-500 text-white shadow-sm'
                : 'text-stone-300 hover:text-white'
            }`}
          >
            <Layers
              className={`w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0 ${
                activeSubPage === 'in_progress' ? 'text-amber-300' : 'text-amber-400'
              }`}
            />
            <span className="truncate">{isEn ? 'In-Progress' : 'کار در جریان'}</span>
            {activeInProgressCount > 0 && (
              <span
                className={`px-1.5 py-0.5 rounded-md text-[10px] font-mono shrink-0 ${
                  overdueInProgressCount > 0 && activeSubPage !== 'in_progress'
                    ? 'bg-amber-500/20 border border-amber-500/40 text-amber-300'
                    : activeSubPage === 'in_progress'
                    ? 'bg-white/20 text-white'
                    : 'bg-stone-800 text-stone-300'
                }`}
              >
                {isEn ? activeInProgressCount : toPersianDigits(activeInProgressCount)}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveSubPage('medication');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className={`min-h-[44px] px-2 sm:px-3 py-2 rounded-xl text-[11px] sm:text-sm font-black flex items-center justify-center gap-1.5 sm:gap-2 transition-all cursor-pointer ${
              activeSubPage === 'medication'
                ? 'bg-indigo-500 text-white shadow-sm'
                : 'text-stone-300 hover:text-white'
            }`}
          >
            <Pill
              className={`w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0 ${
                activeSubPage === 'medication' ? 'text-emerald-300' : 'text-emerald-400'
              }`}
            />
            <span className="truncate">{isEn ? 'Medication' : 'یادآور دارو'}</span>
            {activeMedicationCount > 0 && (
              <span
                className={`px-1.5 py-0.5 rounded-md text-[10px] font-mono shrink-0 ${
                  lowStockMedicationCount > 0 && activeSubPage !== 'medication'
                    ? 'bg-amber-500/20 border border-amber-500/40 text-amber-300'
                    : activeSubPage === 'medication'
                    ? 'bg-white/20 text-white'
                    : 'bg-stone-800 text-stone-300'
                }`}
              >
                {isEn ? activeMedicationCount : toPersianDigits(activeMedicationCount)}
              </span>
            )}
          </button>
        </div>
      </div>

      {activeSubPage === 'medication' &&
      onSaveMedication &&
      onLogMedicationDose &&
      onDeleteMedication &&
      onRefillMedicationStock ? (
        <div className="max-w-3xl mx-auto">
          <MedicationPanel
            medications={medications}
            onSaveMedication={onSaveMedication}
            onLogDose={onLogMedicationDose}
            onDeleteMedication={onDeleteMedication}
            onRefillStock={onRefillMedicationStock}
            language={language}
            mode="page"
            searchQuery={searchQuery}
            initialOpenForm={false}
            visitTrigger={subPageVisitTick}
          />
        </div>
      ) : activeSubPage === 'in_progress' &&
      onSaveInProgressItem &&
      onUpdateInProgressProgress &&
      onToggleInProgressComplete &&
      onDeleteInProgressItem ? (
        <div className="max-w-3xl mx-auto">
          <InProgressPanel
            items={inProgressItems}
            onSaveItem={onSaveInProgressItem}
            onUpdateProgress={onUpdateInProgressProgress}
            onToggleComplete={onToggleInProgressComplete}
            onDeleteItem={onDeleteInProgressItem}
            language={language}
            mode="page"
            searchQuery={searchQuery}
            initialOpenForm={false}
            visitTrigger={subPageVisitTick}
          />
        </div>
      ) : (
        <>
      {/* 1. MINIMAL HEADER WITH CATEGORY FILTER & BRAND SUBMIT BUTTON */}
      <div className="flex items-center justify-between gap-2 pb-3 border-b border-stone-800/80 max-w-3xl mx-auto flex-wrap">
        <div className="flex items-center gap-2.5">
          <h2 className="text-lg sm:text-2xl font-black text-white">
            {isEn ? 'Reminders' : 'یادآورها'}
          </h2>

          {/* Filter button next to title */}
          <button
            type="button"
            onClick={() => setIsFilterSheetOpen(true)}
            className={`min-h-[40px] px-3 py-1.5 rounded-xl border flex items-center gap-1.5 text-xs font-bold transition-all cursor-pointer ${
              categoryFilter !== 'all'
                ? 'bg-indigo-500/20 border-indigo-500 text-indigo-200 shadow-sm shadow-indigo-500/20'
                : 'bg-stone-900 border-stone-800 text-stone-200 hover:text-white hover:border-stone-700'
            }`}
            title={isEn ? 'Filter by category' : 'فیلتر دسته‌بندی'}
          >
            <Filter className={`w-3.5 h-3.5 ${categoryFilter !== 'all' ? 'text-amber-400' : 'text-amber-400'}`} />
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

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCreateNew}
            className="btn-brand-submit min-h-[38px] px-3.5 py-1.5 rounded-xl font-black text-xs flex items-center gap-1.5 transition-all cursor-pointer active:scale-95"
          >
            <Plus className="w-4 h-4 stroke-[3]" />
            <span>{isEn ? 'Add Reminder' : 'ثبت یادآور جدید'}</span>
          </button>
        </div>
      </div>

      {/* 2. SINGLE VERTICAL TIMELINE (with vertical padding so NOW sits in the middle of the viewport) */}
      <div className="relative space-y-4 max-w-3xl mx-auto py-[14vh]">
        {sortedReminders.length === 0 ? (
          <div className="space-y-6">
            {/* The 'NOW' Line centered in viewport */}
            <div ref={nowMarkerRef} className="relative py-4 flex items-center justify-center scroll-mt-[42vh]">
              <div className="absolute inset-x-0 h-0.5 bg-gradient-to-r from-transparent via-indigo-500/70 to-transparent" />
              <div className="relative z-10 px-4 py-1.5 rounded-full bg-indigo-500 text-white font-black text-xs shadow-lg shadow-indigo-500/20 flex items-center gap-2 border border-indigo-400">
                <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                <span>{isEn ? 'NOW' : 'اکنون'}</span>
                <span className="font-mono">{liveTimeString}</span>
              </div>
            </div>

            {/* Empty State Card */}
            <div className="py-10 px-5 text-center rounded-2xl border border-dashed border-stone-800 bg-stone-900/30 space-y-4">
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
                  className="btn-brand-submit min-h-[48px] px-6 py-2.5 rounded-2xl font-black text-xs sm:text-sm transition-all active:scale-95 cursor-pointer inline-flex items-center gap-2"
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
              const fastLayoutSpring = {
                layout: { type: 'spring' as const, stiffness: 520, damping: 36, mass: 0.7 },
              };

              const renderNowLine = () => (
                <motion.div
                  layout="position"
                  transition={fastLayoutSpring}
                  key="now-indicator-line"
                  ref={nowMarkerRef}
                  className="relative py-4 my-2 flex items-center justify-center z-20 scroll-mt-[42vh]"
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
                      transition={fastLayoutSpring}
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
                const isSettling = Boolean(justSettledIds[reminder.id]);
                const isEmeraldGlow = isCompleting || Boolean(emeraldFadeIds[reminder.id]);
                const isOverdueUncompleted = isPast && !isCompleted && !isCompleting;
                const isNext = reminder.id === nextReminder?.id && !isCompleting;

                // Card minimal styling with fast completion color transition & smooth timeline placement:
                let cardStyle = '';
                if (isEmeraldGlow) {
                  cardStyle =
                    'bg-emerald-950/70 border-emerald-400/90 text-emerald-50 shadow-lg shadow-emerald-500/20 ring-1 ring-emerald-400/40';
                } else if (isCompleted && isSettling) {
                  cardStyle =
                    'bg-stone-900/55 border-emerald-500/35 text-stone-400 opacity-75';
                } else if (isCompleted) {
                  cardStyle = 'bg-stone-900/40 border-stone-800/50 text-stone-500 opacity-60';
                } else if (isOverdueUncompleted) {
                  cardStyle = 'bg-rose-950/20 border-rose-500/30 text-rose-100 hover:border-rose-500/50 shadow-sm';
                } else if (isNext) {
                  cardStyle =
                    'relative bg-stone-900 border-emerald-500/80 text-stone-100 hover:border-emerald-400 shadow-xl shadow-emerald-500/15 ring-1 ring-emerald-500/35 pt-5 sm:pt-6 mt-3.5';
                } else if (isPast) {
                  cardStyle = 'bg-stone-900/60 border-stone-800/60 text-stone-300 opacity-75';
                } else if (isSettling) {
                  cardStyle =
                    'bg-stone-900 border-indigo-500/50 text-stone-100 shadow-md shadow-indigo-500/10';
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
                    layout="position"
                    transition={fastLayoutSpring}
                    key={reminder.id}
                    onClick={() => {
                      setShowPostponePicker(false);
                      setSelectedReminder(reminder);
                    }}
                    className={`w-full p-4 sm:p-5 rounded-2xl border transition-colors duration-300 cursor-pointer flex items-center justify-between gap-3 ${
                      isSettling || isCompleting ? 'relative z-30' : 'relative z-10'
                    } ${cardStyle}`}
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
                        className={`w-6 h-6 sm:w-6.5 sm:h-6.5 rounded-full border-[2.5px] flex items-center justify-center shrink-0 transition-colors duration-200 cursor-pointer active:scale-90 group ${
                          isEmeraldGlow
                            ? 'border-emerald-400 bg-emerald-500 text-stone-950 shadow-sm shadow-emerald-500/40'
                            : isCompleted && isSettling
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
                          className={`w-3.5 h-3.5 stroke-[3] transition-opacity duration-150 ${
                            isCompleted || isCompleting || isSettling
                              ? 'opacity-100'
                              : 'opacity-0 group-hover:opacity-60'
                          }`}
                        />
                      </button>

                      <div className="flex flex-col gap-1 min-w-0 flex-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`text-sm sm:text-base font-bold truncate transition-colors duration-300 ${
                              isEmeraldGlow
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
                            className={`text-[11px] sm:text-xs truncate transition-colors duration-300 ${
                              isEmeraldGlow ? 'text-emerald-300/80' : 'text-stone-400'
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
                            className={`w-3.5 h-3.5 shrink-0 transition-colors duration-300 ${
                              isEmeraldGlow ? 'text-emerald-300' : 'text-emerald-400'
                            }`}
                          />
                        )}
                        <span className={`transition-colors duration-300 ${isEmeraldGlow ? 'text-emerald-200' : ''}`}>
                          {formatJalaliTime(reminder.dueTimestamp, isEn ? 'en' : 'fa')}
                        </span>
                      </div>
                      <span className={`text-[10px] sm:text-[11px] transition-colors duration-300 ${isEmeraldGlow ? 'text-emerald-300/80' : 'text-stone-400'}`}>
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
        </>
      )}
    </div>
  );
};

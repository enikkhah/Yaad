import React, { useState, useEffect, useMemo, useRef } from 'react';
import { InProgressItem } from '../types';
import { formatJalaliFull, toPersianDigits } from '../utils/jalali';
import {
  formatRelativeLastUpdate,
  getInactiveDaysCount,
  isInProgressItemOverdue,
} from '../utils/inProgressNotifications';
import { inferInProgressFromTitle } from '../utils/inProgressFuzzy';
import { ValidationAlertModal } from './ValidationAlertModal';
import {
  Plus,
  Minus,
  Check,
  CheckCircle2,
  Clock,
  Edit3,
  Trash2,
  Bell,
  BellOff,
  RotateCcw,
  Layers,
  AlertTriangle,
  SlidersHorizontal,
  ChevronUp,
  Sparkles,
  X,
} from 'lucide-react';

interface InProgressPanelProps {
  items: InProgressItem[];
  onSaveItem: (
    itemData: Omit<InProgressItem, 'id' | 'createdAt' | 'lastUpdatedAt'>,
    editingId?: string
  ) => void;
  onUpdateProgress: (id: string, newProgress: number, customNote?: string) => void;
  onToggleComplete: (id: string) => void;
  onDeleteItem: (id: string) => void;
  language?: 'fa' | 'en';
  mode?: 'modal-tab' | 'page';
  searchQuery?: string;
  initialOpenForm?: boolean;
}

export const InProgressPanel: React.FC<InProgressPanelProps> = ({
  items,
  onSaveItem,
  onUpdateProgress,
  onToggleComplete,
  onDeleteItem,
  language = 'fa',
  mode = 'page',
  searchQuery = '',
  initialOpenForm = false,
}) => {
  const isEn = language === 'en';
  const formatNum = (val: number | string) =>
    isEn ? val.toString() : toPersianDigits(val);

  const [nowMs, setNowMs] = useState<number>(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  // Form visibility & state
  const [isFormExpanded, setIsFormExpanded] = useState<boolean>(
    mode === 'modal-tab' || initialOpenForm || items.length === 0
  );
  const [editingItem, setEditingItem] = useState<InProgressItem | null>(null);

  const [title, setTitle] = useState('');
  const [currentProgressInput, setCurrentProgressInput] = useState('');
  const [totalProgressInput, setTotalProgressInput] = useState('');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [validationAlertField, setValidationAlertField] = useState<string | null>(null);
  const [missingTarget, setMissingTarget] = useState<'title' | 'progress' | null>(null);

  const titleInputRef = useRef<HTMLInputElement>(null);
  const currentProgressInputRef = useRef<HTMLInputElement>(null);

  // Real-time Fuzzy Logic inference from title
  const fuzzyInfo = useMemo(
    () => inferInProgressFromTitle(title, isEn),
    [title, isEn]
  );

  // Inline custom progress editor on cards
  const [directEditId, setDirectEditId] = useState<string | null>(null);
  const [directProgressValue, setDirectProgressValue] = useState<string>('');
  const [directNoteValue, setDirectNoteValue] = useState<string>('');

  const resetForm = () => {
    setEditingItem(null);
    setTitle('');
    setCurrentProgressInput('');
    setTotalProgressInput('');
    setNotes('');
    setFormError(null);
  };

  const handleStartEdit = (item: InProgressItem) => {
    setEditingItem(item);
    setTitle(item.title);
    setCurrentProgressInput(String(item.currentProgress));
    setTotalProgressInput(item.totalProgress !== undefined ? String(item.totalProgress) : '');
    setNotes(item.notes || '');
    setFormError(null);
    setIsFormExpanded(true);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setMissingTarget('title');
      setValidationAlertField(isEn ? 'Task Title' : 'عنوان کار در جریان');
      setTimeout(() => titleInputRef.current?.focus(), 30);
      return;
    }

    const cleanProgress = currentProgressInput.trim();
    if (!cleanProgress || isNaN(Number(cleanProgress))) {
      setMissingTarget('progress');
      setValidationAlertField(fuzzyInfo.currentInputLabel);
      setTimeout(() => currentProgressInputRef.current?.focus(), 30);
      return;
    }

    const parsedCurrent = Math.max(0, Number(cleanProgress));
    const rawTotal =
      totalProgressInput.trim() !== '' && Number(totalProgressInput) > 0
        ? Number(totalProgressInput)
        : fuzzyInfo.id === 'project_work'
        ? 100
        : undefined;

    const isNowCompleted =
      rawTotal !== undefined && rawTotal > 0 && parsedCurrent >= rawTotal;

    onSaveItem(
      {
        title: cleanTitle,
        categoryLabel: fuzzyInfo.categoryLabel,
        currentProgress: rawTotal ? Math.min(parsedCurrent, rawTotal) : parsedCurrent,
        totalProgress: rawTotal,
        unit: fuzzyInfo.unit,
        stepSize: fuzzyInfo.stepSize,
        notes: notes.trim() || undefined,
        inactivityDays: fuzzyInfo.inactivityDays,
        inactivityReminderEnabled: true,
        completed: isNowCompleted,
      },
      editingItem?.id
    );

    resetForm();
    if (mode === 'page') {
      setIsFormExpanded(false);
    }
  };

  // Filter items
  const activeItems = items.filter((item) => !item.deletedAt);
  const searchedItems = searchQuery.trim()
    ? activeItems.filter((item) => {
        const q = searchQuery.trim().toLowerCase();
        return (
          item.title.toLowerCase().includes(q) ||
          (item.categoryLabel && item.categoryLabel.toLowerCase().includes(q)) ||
          (item.notes && item.notes.toLowerCase().includes(q)) ||
          item.unit.toLowerCase().includes(q)
        );
      })
    : activeItems;

  const overdueCount = searchedItems.filter((i) => isInProgressItemOverdue(i, nowMs)).length;

  const displayedItems = [...searchedItems].sort((a, b) => {
    const aDone = a.completed ? 1 : 0;
    const bDone = b.completed ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    const aOverdue = isInProgressItemOverdue(a, nowMs) ? 1 : 0;
    const bOverdue = isInProgressItemOverdue(b, nowMs) ? 1 : 0;
    if (aOverdue !== bOverdue) return bOverdue - aOverdue;
    return b.lastUpdatedAt - a.lastUpdatedAt;
  });

  return (
    <div className="space-y-5" dir={isEn ? 'ltr' : 'rtl'}>
      {/* Pop-up alert for missing required fields */}
      <ValidationAlertModal
        isOpen={!!validationAlertField}
        onClose={() => {
          const target = missingTarget;
          setValidationAlertField(null);
          setMissingTarget(null);
          setTimeout(() => {
            if (target === 'title') {
              titleInputRef.current?.focus();
            } else if (target === 'progress') {
              currentProgressInputRef.current?.focus();
            }
          }, 50);
        }}
        title={isEn ? 'Required Field Missing' : 'تکمیل فیلد اجباری'}
        fieldName={validationAlertField || (isEn ? 'Required Field' : 'فیلد اجباری')}
        language={language}
      />

      {/* TOP BAR & MINIMAL FUZZY-POWERED FORM */}
      <div className="rounded-2xl bg-stone-900 border border-stone-800 p-3.5 sm:p-4 shadow-sm space-y-3.5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-400 flex items-center justify-center shrink-0">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-black text-white flex items-center gap-2">
                <span>
                  {isEn ? 'In-Progress Task' : 'کار در جریان'}
                </span>
                {overdueCount > 0 && (
                  <span className="px-2 py-0.5 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-300 text-[10px] font-bold">
                    {formatNum(overdueCount)}{' '}
                    {isEn ? 'needs attention' : 'نیازمند پیگیری'}
                  </span>
                )}
              </h3>
              <p className="text-[11px] text-stone-400">
                {isEn
                  ? 'Smart auto-detection of unit and tags from your task title'
                  : 'تشخیص هوشمند نوع ورودی، واحد و برچسب بر اساس عنوان کار'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              if (editingItem) {
                resetForm();
              } else {
                setIsFormExpanded((prev) => !prev);
              }
            }}
            className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-black text-xs flex items-center gap-1.5 shadow-sm transition-all cursor-pointer active:scale-95"
          >
            {isFormExpanded ? (
              <>
                <ChevronUp className="w-4 h-4" />
                <span>{isEn ? 'Hide' : 'بستن فرم'}</span>
              </>
            ) : (
              <>
                <Plus className="w-4 h-4 stroke-[2.8]" />
                <span>{isEn ? 'New Item' : 'ثبت کار جدید'}</span>
              </>
            )}
          </button>
        </div>

        {/* MINIMAL FUZZY-LOGIC FORM */}
        {isFormExpanded && (
          <form
            onSubmit={handleFormSubmit}
            className="pt-3 border-t border-stone-800 space-y-3.5 animate-in fade-in duration-150"
          >
            {formError && (
              <div className="p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs font-bold flex items-center justify-between gap-2">
                <span>{formError}</span>
                <button
                  type="button"
                  onClick={() => setFormError(null)}
                  className="p-1 text-rose-300 hover:text-white cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* 1. Prominent Mandatory Title Input Box + Live Fuzzy Auto-Detection Badge */}
            <div className="p-3.5 sm:p-4 rounded-2xl bg-gradient-to-br from-indigo-950/55 via-stone-900/95 to-stone-950 border-2 border-indigo-500/55 shadow-lg shadow-indigo-500/10 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <label className="text-sm sm:text-base font-black text-white tracking-tight flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#F7941E] shadow-[0_0_8px_rgba(247,148,30,0.85)] shrink-0" />
                  <span>{isEn ? 'Task Title' : 'عنوان کار در جریان'}</span>
                  <span className="text-[#F7941E] font-black text-base">*</span>
                </label>

                {title.trim().length > 0 && (
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-[11px] font-bold animate-in fade-in duration-150">
                    <Sparkles className="w-3 h-3 text-indigo-400 shrink-0" />
                    <span>{fuzzyInfo.categoryLabel}</span>
                    <span className="opacity-50">•</span>
                    <span>
                      {isEn ? `Unit: ${fuzzyInfo.unit}` : `واحد: ${fuzzyInfo.unit}`}
                    </span>
                  </div>
                )}
              </div>

              <input
                ref={titleInputRef}
                type="text"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (formError) setFormError(null);
                }}
                placeholder={
                  isEn
                    ? 'e.g. Podcast ChannelB, Atomic Habits Book, Breaking Bad Series, Design Project...'
                    : 'مثال: پادکست چنل‌بی، کتاب عادت‌های اتمی، سریال، دوره زبان، پروژه طراحی...'
                }
                className="w-full bg-stone-950 border-2 border-indigo-400/70 focus:border-[#F7941E] ring-2 ring-indigo-500/15 focus:ring-[#F7941E]/25 rounded-2xl px-4 py-3.5 text-white placeholder-stone-400 focus:outline-none transition-all text-base sm:text-lg font-extrabold shadow-inner"
              />
            </div>

            {/* 2. Contextual Progress Inputs (Step / Current Progress is Mandatory) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-3 rounded-2xl bg-stone-950/70 border-2 border-indigo-500/45 space-y-1.5">
                <label className="text-xs sm:text-sm font-black text-white flex items-center gap-1.5 transition-all">
                  <span className="w-2 h-2 rounded-full bg-[#F7941E] shadow-[0_0_6px_rgba(247,148,30,0.85)] shrink-0" />
                  <span>{fuzzyInfo.currentInputLabel}</span>
                  <span className="text-[#F7941E] font-black text-sm">*</span>
                </label>
                <div className="relative flex items-center">
                  <input
                    ref={currentProgressInputRef}
                    type="number"
                    min="0"
                    step="any"
                    dir="ltr"
                    value={currentProgressInput}
                    onChange={(e) => {
                      setCurrentProgressInput(e.target.value);
                      if (formError) setFormError(null);
                    }}
                    placeholder={fuzzyInfo.currentPlaceholder}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-stone-950 border-2 border-indigo-400/60 focus:border-[#F7941E] text-white placeholder-stone-400 text-center font-mono text-sm sm:text-base font-black focus:outline-none transition-colors shadow-inner"
                  />
                  <span className="absolute end-3 text-[11px] font-bold text-indigo-300 pointer-events-none">
                    {fuzzyInfo.unit}
                  </span>
                </div>
              </div>

              <div className="p-3 rounded-2xl bg-stone-950/40 border border-stone-800 space-y-1.5">
                <label className="text-xs sm:text-sm font-bold text-stone-300 block transition-all">
                  {fuzzyInfo.totalInputLabel}
                </label>
                <div className="relative flex items-center">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    dir="ltr"
                    value={totalProgressInput}
                    onChange={(e) => setTotalProgressInput(e.target.value)}
                    placeholder={fuzzyInfo.totalPlaceholder}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-stone-950 border border-stone-800 focus:border-indigo-500 text-white placeholder-stone-500 text-center font-mono text-sm sm:text-base font-black focus:outline-none transition-colors"
                  />
                  <span className="absolute end-3 text-[11px] font-bold text-stone-400 pointer-events-none">
                    {fuzzyInfo.unit}
                  </span>
                </div>
              </div>
            </div>

            {/* 3. Optional Note + Submit Button in a single clean row */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 pt-0.5">
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={
                  isEn
                    ? 'Short note (optional)...'
                    : 'توضیح کوتاه یا نشانه توقف (اختیاری)...'
                }
                className="flex-1 px-3.5 py-2.5 rounded-xl bg-stone-950 border border-stone-800 focus:border-indigo-500 text-white placeholder-stone-400 text-xs focus:outline-none transition-colors"
              />

              <div className="flex items-center justify-end gap-2 shrink-0">
                {editingItem && (
                  <button
                    type="button"
                    onClick={resetForm}
                    className="min-h-[40px] px-3.5 py-2 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-300 text-xs font-bold transition-colors cursor-pointer"
                  >
                    {isEn ? 'Cancel' : 'انصراف'}
                  </button>
                )}
                <button
                  type="submit"
                  className="min-h-[44px] flex-1 sm:flex-initial px-5 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-black text-xs sm:text-sm flex items-center justify-center gap-1.5 shadow-md shadow-indigo-500/20 transition-all cursor-pointer active:scale-95"
                >
                  <Check className="w-4 h-4 stroke-[3]" />
                  <span>
                    {editingItem
                      ? isEn
                        ? 'Save'
                        : 'ذخیره تغییرات'
                      : isEn
                      ? 'Add Item'
                      : 'ثبت کار در جریان'}
                  </span>
                </button>
              </div>
            </div>
          </form>
        )}
      </div>

      {/* IN-PROGRESS CARDS GRID */}
      {displayedItems.length === 0 ? (
        <div className="py-10 px-4 text-center rounded-3xl border border-dashed border-stone-800 bg-stone-900/40 space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/25 text-indigo-400 flex items-center justify-center mx-auto">
            <Layers className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h4 className="text-sm sm:text-base font-bold text-white">
              {isEn ? 'No ongoing items yet' : 'هنوز کار در جریانی ثبت نشده است'}
            </h4>
            <p className="text-xs text-stone-400 max-w-md mx-auto leading-relaxed">
              {isEn
                ? 'Add any multi-step task, project, reading, course, or ongoing work above to track your exact progress and get smart inactivity reminders.'
                : 'هر کار چندمرحله‌ای، پروژه، دوره، مطالعه یا فرآیند نیمه‌تمامی را ثبت کنید تا همیشه بدانید تا کجا پیش رفته‌اید و در صورت توقف، یادآور هوشمند دریافت کنید.'}
            </p>
          </div>
          {!isFormExpanded && (
            <button
              type="button"
              onClick={() => setIsFormExpanded(true)}
              className="min-h-[42px] inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-black text-xs shadow-md transition-all cursor-pointer active:scale-95"
            >
              <Plus className="w-4 h-4 stroke-[3]" />
              <span>{isEn ? 'Add First Ongoing Item' : 'ثبت اولین کار در جریان'}</span>
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {displayedItems.map((item) => {
            const hasTotal = item.totalProgress !== undefined && item.totalProgress > 0;
            const percentage = hasTotal
              ? Math.min(100, Math.round((item.currentProgress / item.totalProgress!) * 100))
              : null;
            const isOverdue = isInProgressItemOverdue(item, nowMs);
            const inactiveDays = getInactiveDaysCount(item, nowMs);
            const step = item.stepSize || 1;
            const isDirectEditing = directEditId === item.id;

            return (
              <div
                key={item.id}
                className={`rounded-2xl bg-stone-900 border p-4 space-y-3.5 transition-all shadow-sm ${
                  item.completed
                    ? 'border-emerald-500/40 opacity-85'
                    : isOverdue
                    ? 'border-amber-500/60 shadow-amber-500/5'
                    : 'border-stone-800 hover:border-stone-700'
                }`}
              >
                {/* Card Header: Title, Category Badge & Quick Actions */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {item.categoryLabel && (
                        <span className="px-2 py-0.5 rounded-md bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-[10px] font-bold">
                          {item.categoryLabel}
                        </span>
                      )}
                      {item.completed && (
                        <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[10px] font-bold flex items-center gap-1">
                          <Check className="w-3 h-3 stroke-[3]" />
                          <span>{isEn ? 'Completed' : 'تکمیل شده'}</span>
                        </span>
                      )}
                      {isOverdue && !item.completed && (
                        <span className="px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/40 text-amber-300 text-[10px] font-bold flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          <span>
                            {isEn
                              ? `${inactiveDays}d inactive`
                              : `${formatNum(inactiveDays)} روز بدون آپدیت`}
                          </span>
                        </span>
                      )}
                    </div>
                    <h4
                      className={`text-sm sm:text-base font-black text-white leading-snug break-words ${
                        item.completed ? 'line-through opacity-75' : ''
                      }`}
                    >
                      {item.title}
                    </h4>
                  </div>

                  {/* Edit / Complete / Delete Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => onToggleComplete(item.id)}
                      title={
                        item.completed
                          ? isEn
                            ? 'Mark as Ongoing'
                            : 'بازگردانی به در جریان'
                          : isEn
                          ? 'Mark Completed'
                          : 'علامت‌گذاری به عنوان تکمیل‌شده'
                      }
                      className={`p-2 rounded-xl border transition-colors cursor-pointer ${
                        item.completed
                          ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                          : 'bg-stone-950 border-stone-800 text-stone-400 hover:text-emerald-400 hover:border-stone-700'
                      }`}
                    >
                      {item.completed ? (
                        <RotateCcw className="w-4 h-4" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleStartEdit(item)}
                      title={isEn ? 'Edit' : 'ویرایش'}
                      className="p-2 rounded-xl bg-stone-950 border border-stone-800 text-stone-400 hover:text-white hover:border-stone-700 transition-colors cursor-pointer"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() => onDeleteItem(item.id)}
                      title={isEn ? 'Delete' : 'حذف'}
                      className="p-2 rounded-xl bg-stone-950 border border-stone-800 text-stone-400 hover:text-rose-400 hover:border-stone-700 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Progress Bar & Numeric Status */}
                <div className="space-y-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-lg sm:text-xl font-black font-mono text-indigo-400">
                        {formatNum(item.currentProgress)}
                      </span>
                      {hasTotal && (
                        <span className="text-xs sm:text-sm font-bold text-stone-400 font-mono">
                          / {formatNum(item.totalProgress!)}
                        </span>
                      )}
                      <span className="text-xs font-bold text-stone-300 ms-1">{item.unit}</span>
                    </div>

                    {percentage !== null ? (
                      <span className="text-xs font-black font-mono px-2 py-0.5 rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-indigo-300">
                        {formatNum(percentage)}%
                      </span>
                    ) : (
                      <span className="text-[11px] font-semibold text-stone-400">
                        {isEn ? 'Open-ended progress' : 'فرآیند باز / پیوسته'}
                      </span>
                    )}
                  </div>

                  {/* Theme-Adaptive Progress Bar */}
                  <div className="w-full h-3 rounded-full bg-stone-950 border border-stone-800 overflow-hidden p-0.5">
                    <div
                      className="h-full rounded-full bg-indigo-500 transition-all duration-300"
                      style={{
                        width:
                          percentage !== null
                            ? `${Math.max(4, percentage)}%`
                            : item.currentProgress > 0
                            ? '100%'
                            : '6%',
                      }}
                    />
                  </div>
                </div>

                {/* Optional Notes / Checkpoint Description */}
                {item.notes && (
                  <p className="text-xs text-stone-300 bg-stone-950/70 border border-stone-800/80 rounded-xl px-3 py-2 leading-relaxed">
                    {item.notes}
                  </p>
                )}

                {/* Quick Update Controls (- / + buttons and direct input toggle) */}
                {!item.completed && (
                  <div className="space-y-2 pt-1">
                    <div className="flex items-center gap-2">
                      {/* Decrement Button (-) */}
                      <button
                        type="button"
                        disabled={item.currentProgress <= 0}
                        onClick={() =>
                          onUpdateProgress(
                            item.id,
                            Math.max(0, Number((item.currentProgress - step).toFixed(2)))
                          )
                        }
                        className="min-h-[42px] px-3.5 py-2 rounded-xl bg-stone-950 hover:bg-stone-800 disabled:opacity-40 border border-stone-800 text-stone-200 font-mono text-xs font-black flex items-center justify-center gap-1 transition-all cursor-pointer active:scale-95"
                        title={isEn ? `Decrease by ${step}` : `کاهش به اندازه ${formatNum(step)}`}
                      >
                        <Minus className="w-4 h-4" />
                        <span>{formatNum(step)}</span>
                      </button>

                      {/* Primary Quick Increment Button (+) */}
                      <button
                        type="button"
                        onClick={() => {
                          const nextVal = Number((item.currentProgress + step).toFixed(2));
                          onUpdateProgress(
                            item.id,
                            hasTotal ? Math.min(item.totalProgress!, nextVal) : nextVal
                          );
                        }}
                        className="min-h-[42px] flex-1 px-4 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-black text-xs sm:text-sm flex items-center justify-center gap-1.5 shadow-sm shadow-indigo-500/20 transition-all cursor-pointer active:scale-95"
                      >
                        <Plus className="w-4 h-4 stroke-[3]" />
                        <span>
                          {isEn
                            ? `Quick Update (+${step} ${item.unit})`
                            : `بروزرسانی سریع (+${formatNum(step)} ${item.unit})`}
                        </span>
                      </button>

                      {/* Direct Number Jump Toggle */}
                      <button
                        type="button"
                        onClick={() => {
                          if (isDirectEditing) {
                            setDirectEditId(null);
                          } else {
                            setDirectEditId(item.id);
                            setDirectProgressValue(String(item.currentProgress));
                            setDirectNoteValue(item.notes || '');
                          }
                        }}
                        className={`min-h-[42px] px-3 py-2 rounded-xl border text-xs font-bold flex items-center gap-1 transition-all cursor-pointer ${
                          isDirectEditing
                            ? 'bg-indigo-500/20 border-indigo-500 text-indigo-300'
                            : 'bg-stone-950 border-stone-800 text-stone-300 hover:border-stone-700'
                        }`}
                        title={isEn ? 'Set exact progress value' : 'ثبت عدد دقیق پیشرفت'}
                      >
                        <SlidersHorizontal className="w-4 h-4" />
                        <span className="hidden sm:inline">
                          {isEn ? 'Exact' : 'عدد دقیق'}
                        </span>
                      </button>
                    </div>

                    {/* Inline Direct Progress & Checkpoint Note Editor */}
                    {isDirectEditing && (
                      <div className="p-3 rounded-xl bg-stone-950 border border-stone-800 space-y-2.5 animate-in fade-in duration-150">
                        <div className="flex items-center gap-2">
                          <label className="text-[11px] font-bold text-stone-300 shrink-0">
                            {isEn ? `New value (${item.unit}):` : `مقدار جدید (${item.unit}):`}
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            dir="ltr"
                            value={directProgressValue}
                            onChange={(e) => setDirectProgressValue(e.target.value)}
                            className="w-28 px-2.5 py-1.5 rounded-lg bg-stone-900 border border-stone-700 text-white font-mono text-sm font-black text-center focus:outline-none focus:border-indigo-500"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const val = Math.max(0, Number(directProgressValue) || 0);
                              onUpdateProgress(
                                item.id,
                                hasTotal ? Math.min(item.totalProgress!, val) : val,
                                directNoteValue.trim()
                              );
                              setDirectEditId(null);
                            }}
                            className="px-3.5 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white text-xs font-black cursor-pointer"
                          >
                            {isEn ? 'Apply' : 'ثبت آپدیت'}
                          </button>
                        </div>
                        <input
                          type="text"
                          value={directNoteValue}
                          onChange={(e) => setDirectNoteValue(e.target.value)}
                          placeholder={
                            isEn
                              ? 'Update checkpoint note (optional)...'
                              : 'بروزرسانی یادداشت آخرین وضعیت (اختیاری)...'
                          }
                          className="w-full px-2.5 py-1.5 rounded-lg bg-stone-900 border border-stone-800 text-white placeholder-stone-400 text-xs focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Card Footer: Last Updated Timestamp & Smart Inactivity Notification Info */}
                <div className="pt-2 border-t border-stone-800/80 flex items-center justify-between gap-2 flex-wrap text-[11px] text-stone-400">
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-indigo-400" />
                    <span>
                      {isEn ? 'Updated:' : 'آخرین آپدیت:'}{' '}
                      <strong className="text-stone-200">
                        {formatRelativeLastUpdate(item.lastUpdatedAt, nowMs, isEn)}
                      </strong>{' '}
                      <span className="opacity-75">
                        ({formatJalaliFull(item.lastUpdatedAt, isEn ? 'en' : 'fa')})
                      </span>
                    </span>
                  </div>

                  <div className="flex items-center gap-1">
                    {item.inactivityReminderEnabled ? (
                      <span className="inline-flex items-center gap-1 text-indigo-300 font-semibold">
                        <Bell className="w-3 h-3" />
                        <span>
                          {isEn
                            ? `Every ${item.inactivityDays}d inactive`
                            : `یادآور عدم فعالیت: ${formatNum(item.inactivityDays)} روز`}
                        </span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-stone-400">
                        <BellOff className="w-3 h-3" />
                        <span>{isEn ? 'Reminder off' : 'بدون یادآور'}</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

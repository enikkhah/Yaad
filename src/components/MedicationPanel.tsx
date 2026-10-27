import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  MedicationItem,
  MedicationInstruction,
  MedicationScheduleType,
  MedicationDoseStatus,
} from '../types';
import { formatJalaliFull, formatJalaliTime, toPersianDigits } from '../utils/jalali';
import {
  inferMedicationFromName,
  generateScheduledTimesFromInterval,
  getMedicationInstructionLabel,
} from '../utils/medicationFuzzy';
import {
  getLocalDayKey,
  getRemainingTreatmentDays,
  isMedicationActiveOnDate,
  isMedicationLowStock,
} from '../utils/medicationNotifications';
import { requestNotificationPermission } from '../utils/nativePermissions';
import { ValidationAlertModal } from './ValidationAlertModal';
import {
  Pill,
  Plus,
  Check,
  CheckCircle2,
  Clock,
  Edit3,
  Trash2,
  AlertTriangle,
  Sparkles,
  ChevronUp,
  ChevronDown,
  RotateCcw,
  History,
  Package,
  Calendar,
  X,
  Bell,
  XCircle,
} from 'lucide-react';

interface MedicationPanelProps {
  medications: MedicationItem[];
  onSaveMedication: (
    medData: Omit<MedicationItem, 'id' | 'createdAt' | 'history'>,
    editingId?: string
  ) => void;
  onLogDose: (
    medicationId: string,
    dateKey: string,
    scheduledTime: string,
    status: MedicationDoseStatus | 'reset'
  ) => void;
  onDeleteMedication: (id: string) => void;
  onRefillStock?: (id: string, addedAmount: number) => void;
  language?: 'fa' | 'en';
  mode?: 'modal-tab' | 'page';
  searchQuery?: string;
  initialOpenForm?: boolean;
}

const INSTRUCTION_OPTIONS: { id: MedicationInstruction; labelFa: string; labelEn: string }[] = [
  { id: 'after_food', labelFa: 'بعد از غذا', labelEn: 'After Meal' },
  { id: 'before_food', labelFa: 'قبل از غذا', labelEn: 'Before Meal' },
  { id: 'with_food', labelFa: 'همراه غذا', labelEn: 'With Meal' },
  { id: 'empty_stomach', labelFa: 'ناشتا', labelEn: 'Empty Stomach' },
  { id: 'anytime', labelFa: 'هر زمان (آزاد)', labelEn: 'Anytime' },
];

const INTERVAL_PRESETS: { hours: number; labelFa: string; labelEn: string }[] = [
  { hours: 6, labelFa: 'هر ۶ ساعت', labelEn: 'Every 6h' },
  { hours: 8, labelFa: 'هر ۸ ساعت', labelEn: 'Every 8h' },
  { hours: 12, labelFa: 'هر ۱۲ ساعت', labelEn: 'Every 12h' },
  { hours: 24, labelFa: 'روزی یک‌بار', labelEn: 'Once Daily' },
];

const DURATION_PRESETS: { days: number | undefined; labelFa: string; labelEn: string }[] = [
  { days: undefined, labelFa: 'نامحدود / مداوم', labelEn: 'Ongoing' },
  { days: 5, labelFa: '۵ روز', labelEn: '5 Days' },
  { days: 7, labelFa: '۷ روز', labelEn: '7 Days' },
  { days: 10, labelFa: '۱۰ روز', labelEn: '10 Days' },
  { days: 14, labelFa: '۱۴ روز', labelEn: '14 Days' },
  { days: 30, labelFa: '۳۰ روز', labelEn: '30 Days' },
];

export const MedicationPanel: React.FC<MedicationPanelProps> = ({
  medications,
  onSaveMedication,
  onLogDose,
  onDeleteMedication,
  onRefillStock,
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

  const activeMedications = useMemo(
    () => medications.filter((m) => !m.deletedAt),
    [medications]
  );

  // Form visibility & state
  const [isFormExpanded, setIsFormExpanded] = useState<boolean>(
    mode === 'modal-tab' || initialOpenForm || activeMedications.length === 0
  );
  const [editingMed, setEditingMed] = useState<MedicationItem | null>(null);

  const [name, setName] = useState('');
  const [dosageAmountInput, setDosageAmountInput] = useState('1');
  const [hasManualDose, setHasManualDose] = useState(false);
  const [instruction, setInstruction] = useState<MedicationInstruction>('after_food');
  const [hasManualInstruction, setHasManualInstruction] = useState(false);
  const [scheduleType, setScheduleType] = useState<MedicationScheduleType>('interval_hours');
  const [intervalHours, setIntervalHours] = useState<number>(8);
  const [hasManualInterval, setHasManualInterval] = useState(false);
  const [scheduledTimes, setScheduledTimes] = useState<string[]>(() =>
    generateScheduledTimesFromInterval(8, 8, 0)
  );
  const [durationDaysInput, setDurationDaysInput] = useState<string>('');
  const [isUnlimitedDuration, setIsUnlimitedDuration] = useState<boolean>(true);
  const [stockCountInput, setStockCountInput] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  // Validation state
  const [validationAlertField, setValidationAlertField] = useState<string | null>(null);
  const [missingTarget, setMissingTarget] = useState<'name' | 'dose' | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const doseInputRef = useRef<HTMLInputElement>(null);

  // Expanded history log & refill UI states
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const [refillMedId, setRefillMedId] = useState<string | null>(null);
  const [refillAmountInput, setRefillAmountInput] = useState<string>('20');

  // Real-time Fuzzy Logic inference from medication name
  const fuzzyInfo = useMemo(
    () => inferMedicationFromName(name, isEn),
    [name, isEn]
  );

  // Auto-apply fuzzy defaults while typing medication name unless user manually edited them
  useEffect(() => {
    if (!name.trim() || editingMed) return;
    if (!hasManualDose) {
      setDosageAmountInput(String(fuzzyInfo.defaultDose));
    }
    if (!hasManualInstruction) {
      setInstruction(fuzzyInfo.suggestedInstruction);
    }
    if (!hasManualInterval && scheduleType === 'interval_hours') {
      setIntervalHours(fuzzyInfo.suggestedIntervalHours);
      const anchor = scheduledTimes[0] || '08:00';
      const [hStr, mStr] = anchor.split(':');
      setScheduledTimes(
        generateScheduledTimesFromInterval(
          fuzzyInfo.suggestedIntervalHours,
          parseInt(hStr || '8', 10),
          parseInt(mStr || '0', 10)
        )
      );
    }
  }, [
    fuzzyInfo.id,
    fuzzyInfo.defaultDose,
    fuzzyInfo.suggestedInstruction,
    fuzzyInfo.suggestedIntervalHours,
  ]);

  const resetForm = () => {
    setEditingMed(null);
    setName('');
    setDosageAmountInput('1');
    setHasManualDose(false);
    setInstruction('after_food');
    setHasManualInstruction(false);
    setScheduleType('interval_hours');
    setIntervalHours(8);
    setHasManualInterval(false);
    setScheduledTimes(generateScheduledTimesFromInterval(8, 8, 0));
    setDurationDaysInput('');
    setIsUnlimitedDuration(true);
    setStockCountInput('');
    setNotes('');
  };

  const handleStartEdit = (med: MedicationItem) => {
    setEditingMed(med);
    setName(med.name);
    setDosageAmountInput(String(med.dosageAmount));
    setHasManualDose(true);
    setInstruction(med.instruction);
    setHasManualInstruction(true);
    setScheduleType(med.scheduleType);
    setIntervalHours(med.intervalHours || 8);
    setHasManualInterval(true);
    setScheduledTimes(med.scheduledTimes.length > 0 ? [...med.scheduledTimes] : ['08:00']);
    if (med.durationDays && med.durationDays > 0) {
      setIsUnlimitedDuration(false);
      setDurationDaysInput(String(med.durationDays));
    } else {
      setIsUnlimitedDuration(true);
      setDurationDaysInput('');
    }
    setStockCountInput(med.stockCount !== undefined ? String(med.stockCount) : '');
    setNotes(med.notes || '');
    setIsFormExpanded(true);
  };

  const handleSelectIntervalPreset = (hours: number) => {
    setScheduleType('interval_hours');
    setIntervalHours(hours);
    setHasManualInterval(true);
    const firstSlot = scheduledTimes[0] || '08:00';
    const [hStr, mStr] = firstSlot.split(':');
    const startH = parseInt(hStr || '8', 10);
    const startM = parseInt(mStr || '0', 10);
    setScheduledTimes(generateScheduledTimesFromInterval(hours, startH, startM));
  };

  const handleTimeSlotChange = (index: number, newTime: string) => {
    if (!newTime) return;
    if (scheduleType === 'interval_hours' && index === 0 && intervalHours) {
      // Changing the first anchor slot in interval mode shifts all subsequent slots cleanly
      const [hStr, mStr] = newTime.split(':');
      const startH = parseInt(hStr || '8', 10);
      const startM = parseInt(mStr || '0', 10);
      setScheduledTimes(generateScheduledTimesFromInterval(intervalHours, startH, startM));
      return;
    }
    setScheduledTimes((prev) => {
      const next = [...prev];
      next[index] = newTime;
      return next;
    });
  };

  const handleAddCustomTimeSlot = () => {
    setScheduleType('custom_times');
    setScheduledTimes((prev) => [...prev, '14:00']);
  };

  const handleRemoveTimeSlot = (index: number) => {
    if (scheduledTimes.length <= 1) return;
    setScheduleType('custom_times');
    setScheduledTimes((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) {
      setMissingTarget('name');
      setValidationAlertField(isEn ? 'Medication Name' : 'نام دارو');
      setTimeout(() => nameInputRef.current?.focus(), 30);
      return;
    }

    const cleanDoseStr = dosageAmountInput.trim();
    if (!cleanDoseStr || isNaN(Number(cleanDoseStr)) || Number(cleanDoseStr) <= 0) {
      setMissingTarget('dose');
      setValidationAlertField(fuzzyInfo.doseInputLabel);
      setTimeout(() => doseInputRef.current?.focus(), 30);
      return;
    }

    requestNotificationPermission().catch(() => {});

    const parsedDose = Number(cleanDoseStr);
    const parsedDuration =
      !isUnlimitedDuration && durationDaysInput.trim() && Number(durationDaysInput) > 0
        ? Math.round(Number(durationDaysInput))
        : undefined;
    const parsedStock =
      stockCountInput.trim() !== '' && Number(stockCountInput) >= 0
        ? Number(stockCountInput)
        : undefined;

    const cleanTimes = Array.from(new Set(scheduledTimes.filter(Boolean))).sort();

    onSaveMedication(
      {
        name: cleanName,
        categoryLabel: fuzzyInfo.categoryLabel,
        dosageAmount: parsedDose,
        dosageUnit: fuzzyInfo.unit,
        instruction,
        scheduleType,
        intervalHours: scheduleType === 'interval_hours' ? intervalHours : undefined,
        scheduledTimes: cleanTimes.length > 0 ? cleanTimes : ['08:00'],
        startDate: editingMed ? editingMed.startDate : Date.now(),
        durationDays: parsedDuration,
        stockCount: parsedStock,
        initialStockCount:
          editingMed?.initialStockCount !== undefined
            ? editingMed.initialStockCount
            : parsedStock,
        notes: notes.trim() || undefined,
        active: true,
      },
      editingMed?.id
    );

    resetForm();
    if (mode === 'page') {
      setIsFormExpanded(false);
    }
  };

  // Search filter
  const searchedMedications = useMemo(() => {
    if (!searchQuery.trim()) return activeMedications;
    const q = searchQuery.trim().toLowerCase();
    return activeMedications.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        (m.categoryLabel && m.categoryLabel.toLowerCase().includes(q)) ||
        (m.notes && m.notes.toLowerCase().includes(q)) ||
        m.dosageUnit.toLowerCase().includes(q)
    );
  }, [activeMedications, searchQuery]);

  // Build Today's Daily Checklist across all active medications
  const todayKey = getLocalDayKey(nowMs);
  const todayChecklistSlots = useMemo(() => {
    const slots: {
      medication: MedicationItem;
      scheduledTime: string;
      logStatus?: MedicationDoseStatus;
      actionTimestamp?: number;
    }[] = [];

    for (const med of searchedMedications) {
      if (!isMedicationActiveOnDate(med, nowMs)) continue;
      for (const timeStr of med.scheduledTimes) {
        const logEntry = med.history.find(
          (h) => h.dateKey === todayKey && h.scheduledTime === timeStr
        );
        slots.push({
          medication: med,
          scheduledTime: timeStr,
          logStatus: logEntry?.status,
          actionTimestamp: logEntry?.actionTimestamp,
        });
      }
    }

    return slots.sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));
  }, [searchedMedications, todayKey, nowMs]);

  const takenTodayCount = todayChecklistSlots.filter((s) => s.logStatus === 'taken').length;
  const lowStockMedicationsCount = searchedMedications.filter((m) =>
    isMedicationLowStock(m)
  ).length;

  return (
    <div className="space-y-5" dir={isEn ? 'ltr' : 'rtl'}>
      {/* Validation Alert Modal for Mandatory Fields */}
      <ValidationAlertModal
        isOpen={!!validationAlertField}
        onClose={() => {
          const target = missingTarget;
          setValidationAlertField(null);
          setMissingTarget(null);
          setTimeout(() => {
            if (target === 'name') {
              nameInputRef.current?.focus();
            } else if (target === 'dose') {
              doseInputRef.current?.focus();
            }
          }, 50);
        }}
        title={isEn ? 'Required Field Missing' : 'تکمیل فیلد اجباری'}
        fieldName={validationAlertField || (isEn ? 'Required Field' : 'فیلد اجباری')}
        language={language}
      />

      {/* 1. MEDICATION REGISTRATION FORM (WITH FUZZY LOGIC) */}
      <div className="rounded-2xl bg-stone-900 border border-stone-800 p-3.5 sm:p-4 shadow-sm space-y-3.5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-400 flex items-center justify-center shrink-0">
              <Pill className="w-4.5 h-4.5" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-black text-white flex items-center gap-2 flex-wrap">
                <span>{isEn ? 'Medication Reminder' : 'یادآور تخصصی دارو'}</span>
                {lowStockMedicationsCount > 0 && (
                  <span className="px-2 py-0.5 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-300 text-[10px] font-bold flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    <span>
                      {formatNum(lowStockMedicationsCount)}{' '}
                      {isEn ? 'low stock' : 'کمبود موجودی'}
                    </span>
                  </span>
                )}
              </h3>
              <p className="text-[11px] text-stone-400">
                {isEn
                  ? 'Smart unit & instruction detection with high-priority dose notifications'
                  : 'تشخیص هوشمند نوع دارو و واحد دوز + چک‌لیست روزانه و هشدار دقیق مصرف'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              if (editingMed) {
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
                <span>{isEn ? 'Hide Form' : 'بستن فرم'}</span>
              </>
            ) : (
              <>
                <Plus className="w-4 h-4 stroke-[2.8]" />
                <span>{isEn ? 'Add Medication' : 'افزودن داروی جدید'}</span>
              </>
            )}
          </button>
        </div>

        {isFormExpanded && (
          <form
            onSubmit={handleSubmit}
            className="pt-3 border-t border-stone-800 space-y-3.5 animate-in fade-in duration-150"
          >
            {/* A. Prominent Mandatory Medication Name Input + Live Fuzzy Detection Badge */}
            <div className="p-3.5 sm:p-4 rounded-2xl bg-gradient-to-br from-indigo-950/55 via-stone-900/95 to-stone-950 border-2 border-indigo-500/55 shadow-lg shadow-indigo-500/10 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <label className="text-sm sm:text-base font-black text-white tracking-tight flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#F7941E] shadow-[0_0_8px_rgba(247,148,30,0.85)] shrink-0" />
                  <span>{isEn ? 'Medication Name' : 'نام دارو'}</span>
                  <span className="text-[#F7941E] font-black text-base">*</span>
                </label>

                {name.trim().length > 0 && (
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
                ref={nameInputRef}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={
                  isEn
                    ? 'e.g. Amoxicillin 500 Capsule, Diphenhydramine Syrup, Eye Drops, Vitamin D...'
                    : 'مثال: کپسول آموکسی‌سیلین ۵۰۰، شربت دیفن‌هیدرامین، قطره چشمی، قرص ویتامین دی...'
                }
                className="w-full bg-stone-950 border-2 border-indigo-400/70 focus:border-[#F7941E] ring-2 ring-indigo-500/15 focus:ring-[#F7941E]/25 rounded-2xl px-4 py-3.5 text-white placeholder-stone-400 focus:outline-none transition-all text-base sm:text-lg font-extrabold shadow-inner"
              />
            </div>

            {/* B. Mandatory Dose Amount + Food Instruction */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Mandatory Dose per intake */}
              <div className="p-3 rounded-2xl bg-stone-950/70 border-2 border-indigo-500/45 space-y-1.5">
                <label className="text-xs sm:text-sm font-black text-white flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#F7941E] shadow-[0_0_6px_rgba(247,148,30,0.85)] shrink-0" />
                  <span>{fuzzyInfo.doseInputLabel}</span>
                  <span className="text-[#F7941E] font-black text-sm">*</span>
                </label>
                <div className="relative flex items-center">
                  <input
                    ref={doseInputRef}
                    type="number"
                    min="0.25"
                    step="any"
                    dir="ltr"
                    value={dosageAmountInput}
                    onChange={(e) => {
                      setDosageAmountInput(e.target.value);
                      setHasManualDose(true);
                    }}
                    placeholder={fuzzyInfo.dosePlaceholder}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-stone-950 border-2 border-indigo-400/60 focus:border-[#F7941E] text-white placeholder-stone-400 text-center font-mono text-sm sm:text-base font-black focus:outline-none transition-colors shadow-inner"
                  />
                  <span className="absolute end-3 text-[11px] font-bold text-indigo-300 pointer-events-none">
                    {fuzzyInfo.unit}
                  </span>
                </div>
              </div>

              {/* Instruction (قبل/بعد از غذا) */}
              <div className="p-3 rounded-2xl bg-stone-950/40 border border-stone-800 space-y-1.5">
                <label className="text-xs sm:text-sm font-bold text-stone-300 block">
                  {isEn ? 'Usage Instruction' : 'دستور مصرف'}
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {INSTRUCTION_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        setInstruction(opt.id);
                        setHasManualInstruction(true);
                      }}
                      className={`flex-1 min-w-[74px] py-2 px-2 rounded-xl text-[11px] font-bold border transition-all cursor-pointer ${
                        instruction === opt.id
                          ? 'bg-indigo-500 text-white border-indigo-400 font-black shadow-xs'
                          : 'bg-stone-900 border-stone-800 text-stone-300 hover:border-stone-700'
                      }`}
                    >
                      {isEn ? opt.labelEn : opt.labelFa}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* C. Schedule Interval & Exact Daily Dose Times */}
            <div className="p-3 rounded-2xl bg-stone-950/50 border border-stone-800 space-y-2.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <label className="text-xs sm:text-sm font-bold text-stone-200 flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-indigo-400" />
                  <span>
                    {isEn ? 'Repeat Interval & Dose Hours' : 'بازه تکرار و ساعت‌های مصرف در روز'}
                  </span>
                </label>

                <button
                  type="button"
                  onClick={handleAddCustomTimeSlot}
                  className="px-2.5 py-1 rounded-lg bg-stone-900 hover:bg-stone-800 border border-stone-700 text-indigo-300 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{isEn ? 'Add Time' : 'افزودن ساعت'}</span>
                </button>
              </div>

              {/* Interval Presets */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {INTERVAL_PRESETS.map((preset) => {
                  const isSelected =
                    scheduleType === 'interval_hours' && intervalHours === preset.hours;
                  return (
                    <button
                      key={preset.hours}
                      type="button"
                      onClick={() => handleSelectIntervalPreset(preset.hours)}
                      className={`py-2 px-2.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-indigo-500 text-white border-indigo-400 font-black shadow-xs'
                          : 'bg-stone-900 border-stone-800 text-stone-300 hover:border-stone-700'
                      }`}
                    >
                      {isEn ? preset.labelEn : preset.labelFa}
                    </button>
                  );
                })}
              </div>

              {/* Editable Time Slots */}
              <div className="flex items-center gap-2 flex-wrap pt-1">
                {scheduledTimes.map((timeVal, idx) => (
                  <div
                    key={`slot-${idx}`}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-stone-900 border border-stone-700/80"
                  >
                    <span className="text-[10px] font-bold text-stone-400">
                      {isEn ? `#${idx + 1}` : `نوبت ${formatNum(idx + 1)}:`}
                    </span>
                    <input
                      type="time"
                      dir="ltr"
                      value={timeVal}
                      onChange={(e) => handleTimeSlotChange(idx, e.target.value)}
                      className="bg-transparent text-white font-mono text-xs sm:text-sm font-black focus:outline-none cursor-pointer"
                    />
                    {scheduledTimes.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveTimeSlot(idx)}
                        className="p-0.5 rounded-md text-stone-400 hover:text-rose-400 cursor-pointer"
                        title={isEn ? 'Remove slot' : 'حذف این نوبت'}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* D. Treatment Duration (طول دوره درمان) & Stock Inventory (موجودی دارو) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Duration of Treatment */}
              <div className="p-3 rounded-2xl bg-stone-950/40 border border-stone-800 space-y-2">
                <label className="text-xs font-bold text-stone-300 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-indigo-400" />
                  <span>{isEn ? 'Treatment Duration' : 'طول دوره درمان'}</span>
                </label>
                <div className="flex flex-wrap gap-1">
                  {DURATION_PRESETS.map((preset) => {
                    const isSelected =
                      preset.days === undefined
                        ? isUnlimitedDuration
                        : !isUnlimitedDuration && Number(durationDaysInput) === preset.days;
                    return (
                      <button
                        key={preset.days ?? 'unlimited'}
                        type="button"
                        onClick={() => {
                          if (preset.days === undefined) {
                            setIsUnlimitedDuration(true);
                            setDurationDaysInput('');
                          } else {
                            setIsUnlimitedDuration(false);
                            setDurationDaysInput(String(preset.days));
                          }
                        }}
                        className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-indigo-500 text-white border-indigo-400 font-black'
                            : 'bg-stone-900 border-stone-800 text-stone-300 hover:border-stone-700'
                        }`}
                      >
                        {isEn ? preset.labelEn : preset.labelFa}
                      </button>
                    );
                  })}
                </div>
                {!isUnlimitedDuration && (
                  <div className="relative flex items-center pt-1">
                    <input
                      type="number"
                      min="1"
                      max="365"
                      dir="ltr"
                      value={durationDaysInput}
                      onChange={(e) => {
                        setIsUnlimitedDuration(false);
                        setDurationDaysInput(e.target.value);
                      }}
                      placeholder={isEn ? 'Custom days (e.g. 5)' : 'تعداد روز دوره درمان (مثلاً ۵)'}
                      className="w-full px-3 py-2 rounded-xl bg-stone-900 border border-stone-700 text-white font-mono text-xs font-black text-center focus:outline-none focus:border-indigo-500"
                    />
                    <span className="absolute end-3 text-[11px] font-bold text-stone-400 pointer-events-none">
                      {isEn ? 'days' : 'روز'}
                    </span>
                  </div>
                )}
              </div>

              {/* Medication Stock Inventory (محدودیت تعداد / موجودی دارو) */}
              <div className="p-3 rounded-2xl bg-stone-950/40 border border-stone-800 space-y-2 flex flex-col justify-between">
                <label className="text-xs font-bold text-stone-300 flex items-center gap-1.5">
                  <Package className="w-3.5 h-3.5 text-indigo-400" />
                  <span>{fuzzyInfo.stockInputLabel}</span>
                </label>
                <div className="relative flex items-center">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    dir="ltr"
                    value={stockCountInput}
                    onChange={(e) => setStockCountInput(e.target.value)}
                    placeholder={fuzzyInfo.stockPlaceholder}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-stone-950 border border-stone-800 focus:border-indigo-500 text-white placeholder-stone-500 text-center font-mono text-sm font-black focus:outline-none transition-colors"
                  />
                  <span className="absolute end-3 text-[11px] font-bold text-stone-400 pointer-events-none">
                    {fuzzyInfo.unit}
                  </span>
                </div>
              </div>
            </div>

            {/* E. Optional Note + Submit Button */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 pt-0.5">
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={
                  isEn
                    ? 'Doctor note or special warning (optional)...'
                    : 'توضیح پزشک یا نکته تکمیلی (اختیاری)...'
                }
                className="flex-1 px-3.5 py-2.5 rounded-xl bg-stone-950 border border-stone-800 focus:border-indigo-500 text-white placeholder-stone-400 text-xs focus:outline-none transition-colors"
              />

              <div className="flex items-center justify-end gap-2 shrink-0">
                {editingMed && (
                  <button
                    type="button"
                    onClick={resetForm}
                    className="min-h-[44px] px-3.5 py-2 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-300 text-xs font-bold transition-colors cursor-pointer"
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
                    {editingMed
                      ? isEn
                        ? 'Save Changes'
                        : 'ذخیره تغییرات دارو'
                      : isEn
                      ? 'Save Medication'
                      : 'ثبت یادآور دارو'}
                  </span>
                </button>
              </div>
            </div>
          </form>
        )}
      </div>

      {/* 2. DAILY CHECKLIST (چک‌لیست روزانه مصرف داروهای امروز) */}
      {todayChecklistSlots.length > 0 && (
        <div className="rounded-2xl bg-stone-900 border border-stone-800 p-4 space-y-3.5 shadow-sm">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-4.5 h-4.5" />
              </div>
              <div>
                <h4 className="text-sm sm:text-base font-black text-white">
                  {isEn ? "Today's Medication Checklist" : 'چک‌لیست نوبت‌های امروز'}
                </h4>
                <p className="text-[11px] text-stone-400">
                  {isEn
                    ? 'Tap Taken to log intake, deduct stock & cancel that dose alarm'
                    : 'با تیک زدن هر نوبت، مصرف ثبت شده، از موجودی کسر می‌شود و آلارم آن نوبت لغو می‌گردد'}
                </p>
              </div>
            </div>

            <span className="px-3 py-1 rounded-xl bg-stone-950 border border-stone-800 text-xs font-black font-mono text-indigo-300">
              {formatNum(takenTodayCount)} / {formatNum(todayChecklistSlots.length)}{' '}
              {isEn ? 'taken' : 'مصرف شده'}
            </span>
          </div>

          {/* Today's Adherence Progress Bar */}
          <div className="w-full h-2.5 rounded-full bg-stone-950 border border-stone-800 overflow-hidden p-0.5">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-300"
              style={{
                width: `${Math.max(
                  4,
                  Math.round((takenTodayCount / todayChecklistSlots.length) * 100)
                )}%`,
              }}
            />
          </div>

          {/* Checklist Items */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {todayChecklistSlots.map((slot) => {
              const { medication: med, scheduledTime, logStatus, actionTimestamp } = slot;
              const isTaken = logStatus === 'taken';
              const isMissed = logStatus === 'missed';

              return (
                <div
                  key={`${med.id}-${scheduledTime}`}
                  className={`p-3 rounded-xl border flex items-center justify-between gap-2.5 transition-all ${
                    isTaken
                      ? 'bg-emerald-500/10 border-emerald-500/40'
                      : isMissed
                      ? 'bg-rose-500/10 border-rose-500/35 opacity-80'
                      : 'bg-stone-950 border-stone-800 hover:border-stone-700'
                  }`}
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="px-2 py-0.5 rounded-md bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 font-mono text-xs font-black">
                        {formatNum(scheduledTime)}
                      </span>
                      <span
                        className={`text-xs sm:text-sm font-black text-white truncate ${
                          isTaken ? 'line-through opacity-75' : ''
                        }`}
                      >
                        {med.name}
                      </span>
                    </div>
                    <div className="text-[11px] text-stone-400 flex items-center gap-1.5 flex-wrap">
                      <span>
                        {formatNum(med.dosageAmount)} {med.dosageUnit}
                      </span>
                      <span>•</span>
                      <span>{getMedicationInstructionLabel(med.instruction, isEn)}</span>
                      {actionTimestamp && (
                        <>
                          <span>•</span>
                          <span className={isTaken ? 'text-emerald-300 font-bold' : 'text-rose-300 font-bold'}>
                            {isTaken
                              ? isEn
                                ? `Taken at ${formatJalaliTime(actionTimestamp, 'en')}`
                                : `مصرف در ${formatJalaliTime(actionTimestamp, 'fa')}`
                              : isEn
                              ? 'Missed'
                              : 'فراموش‌شده'}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Quick One-Tap Actions */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {!logStatus ? (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            onLogDose(med.id, todayKey, scheduledTime, 'taken')
                          }
                          className="min-h-[38px] px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-black text-xs flex items-center gap-1 shadow-sm cursor-pointer active:scale-95"
                        >
                          <Check className="w-4 h-4 stroke-[3]" />
                          <span>{isEn ? 'Taken' : 'مصرف شد'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onLogDose(med.id, todayKey, scheduledTime, 'missed')
                          }
                          className="min-h-[38px] p-2 rounded-xl bg-stone-900 hover:bg-rose-500/20 border border-stone-800 hover:border-rose-500/40 text-stone-400 hover:text-rose-300 transition-colors cursor-pointer"
                          title={isEn ? 'Mark as Missed' : 'ثبت به عنوان فراموش‌شده'}
                        >
                          <XCircle className="w-4 h-4" />
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          onLogDose(med.id, todayKey, scheduledTime, 'reset')
                        }
                        className="min-h-[36px] px-2.5 py-1 rounded-xl bg-stone-900 hover:bg-stone-800 border border-stone-700 text-stone-300 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                        title={isEn ? 'Undo status' : 'بازگردانی وضعیت این نوبت'}
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>{isEn ? 'Undo' : 'بازگردانی'}</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 3. REGISTERED MEDICATION CARDS & INTAKE HISTORY LOG */}
      {searchedMedications.length === 0 ? (
        <div className="py-10 px-4 text-center rounded-3xl border border-dashed border-stone-800 bg-stone-900/40 space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/25 text-indigo-400 flex items-center justify-center mx-auto">
            <Pill className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h4 className="text-sm sm:text-base font-bold text-white">
              {isEn ? 'No medications registered yet' : 'هنوز دارویی ثبت نشده است'}
            </h4>
            <p className="text-xs text-stone-400 max-w-md mx-auto leading-relaxed">
              {isEn
                ? 'Add your medications above to get accurate high-priority dose notifications, daily checklist tracking, and low-stock alerts.'
                : 'داروهای خود را در فرم بالا وارد کنید تا نوتیفیکیشن دقیق هر نوبت، چک‌لیست روزانه و هشدار اتمام موجودی دارو برایتان فعال شود.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {searchedMedications.map((med) => {
            const remainingDays = getRemainingTreatmentDays(med, nowMs);
            const lowStock = isMedicationLowStock(med);
            const isOut = med.stockCount !== undefined && med.stockCount <= 0;
            const isHistoryOpen = expandedHistoryId === med.id;
            const isRefilling = refillMedId === med.id;
            const sortedHistory = [...med.history]
              .sort((a, b) => b.actionTimestamp - a.actionTimestamp)
              .slice(0, 15);

            return (
              <div
                key={med.id}
                className={`rounded-2xl bg-stone-900 border p-4 space-y-3 transition-all shadow-sm ${
                  isOut
                    ? 'border-rose-500/60'
                    : lowStock
                    ? 'border-amber-500/60'
                    : 'border-stone-800 hover:border-stone-700'
                }`}
              >
                {/* Card Header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {med.categoryLabel && (
                        <span className="px-2 py-0.5 rounded-md bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-[10px] font-bold">
                          {med.categoryLabel}
                        </span>
                      )}
                      <span className="px-2 py-0.5 rounded-md bg-stone-950 border border-stone-800 text-stone-300 text-[10px] font-bold">
                        {getMedicationInstructionLabel(med.instruction, isEn)}
                      </span>
                      {remainingDays !== null ? (
                        <span className="px-2 py-0.5 rounded-md bg-stone-950 border border-stone-800 text-indigo-300 text-[10px] font-bold">
                          {remainingDays > 0
                            ? isEn
                              ? `${remainingDays}d left`
                              : `${formatNum(remainingDays)} روز باقی‌مانده`
                            : isEn
                            ? 'Course finished'
                            : 'پایان دوره درمان'}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-md bg-stone-950 border border-stone-800 text-stone-400 text-[10px] font-semibold">
                          {isEn ? 'Ongoing' : 'مصرف مداوم'}
                        </span>
                      )}
                    </div>

                    <h4 className="text-sm sm:text-base font-black text-white leading-snug break-words">
                      {med.name}
                    </h4>
                  </div>

                  {/* Edit & Delete Buttons */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleStartEdit(med)}
                      className="p-2 rounded-xl bg-stone-950 border border-stone-800 text-stone-400 hover:text-white hover:border-stone-700 transition-colors cursor-pointer"
                      title={isEn ? 'Edit' : 'ویرایش دارو'}
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteMedication(med.id)}
                      className="p-2 rounded-xl bg-stone-950 border border-stone-800 text-stone-400 hover:text-rose-400 hover:border-stone-700 transition-colors cursor-pointer"
                      title={isEn ? 'Delete' : 'حذف دارو'}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Dose & Daily Times Summary */}
                <div className="flex items-center justify-between gap-2 flex-wrap p-2.5 rounded-xl bg-stone-950/80 border border-stone-800/90">
                  <div className="flex items-center gap-1.5">
                    <Pill className="w-4 h-4 text-indigo-400 shrink-0" />
                    <span className="text-xs font-bold text-stone-300">
                      {isEn ? 'Dose:' : 'هر نوبت:'}{' '}
                      <strong className="text-white font-black">
                        {formatNum(med.dosageAmount)} {med.dosageUnit}
                      </strong>
                    </span>
                  </div>

                  <div className="flex items-center gap-1 flex-wrap">
                    <Bell className="w-3.5 h-3.5 text-indigo-400 me-0.5" />
                    {med.scheduledTimes.map((tStr) => (
                      <span
                        key={tStr}
                        className="px-2 py-0.5 rounded-md bg-stone-900 border border-stone-700 text-indigo-300 font-mono text-[11px] font-bold"
                      >
                        {formatNum(tStr)}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Stock Inventory & Low Stock Warning */}
                {med.stockCount !== undefined && (
                  <div
                    className={`p-2.5 rounded-xl border flex items-center justify-between gap-2 flex-wrap ${
                      isOut
                        ? 'bg-rose-500/15 border-rose-500/40 text-rose-200'
                        : lowStock
                        ? 'bg-amber-500/15 border-amber-500/40 text-amber-200'
                        : 'bg-stone-950/50 border-stone-800 text-stone-300'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-xs font-bold">
                      {lowStock ? (
                        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                      ) : (
                        <Package className="w-4 h-4 text-indigo-400 shrink-0" />
                      )}
                      <span>
                        {isEn ? 'Remaining Stock:' : 'موجودی باقی‌مانده:'}{' '}
                        <strong className="font-mono font-black">
                          {formatNum(med.stockCount)} {med.dosageUnit}
                        </strong>
                      </span>
                      {isOut && (
                        <span className="text-[11px] font-black text-rose-300">
                          ({isEn ? 'Out of stock!' : 'اتمام موجودی!'})
                        </span>
                      )}
                      {!isOut && lowStock && (
                        <span className="text-[11px] font-black text-amber-300">
                          ({isEn ? 'Refill soon' : 'رو به اتمام'})
                        </span>
                      )}
                    </div>

                    {onRefillStock && (
                      <button
                        type="button"
                        onClick={() => {
                          setRefillMedId(isRefilling ? null : med.id);
                          setRefillAmountInput('20');
                        }}
                        className="px-2.5 py-1 rounded-lg bg-stone-900 hover:bg-stone-800 border border-stone-700 text-indigo-300 text-[11px] font-bold cursor-pointer"
                      >
                        {isEn ? '+ Refill' : '+ شارژ موجودی'}
                      </button>
                    )}
                  </div>
                )}

                {isRefilling && onRefillStock && (
                  <div className="p-2.5 rounded-xl bg-stone-950 border border-stone-800 flex items-center gap-2">
                    <span className="text-xs font-bold text-stone-300">
                      {isEn ? `Add (${med.dosageUnit}):` : `افزودن به موجودی (${med.dosageUnit}):`}
                    </span>
                    <input
                      type="number"
                      min="1"
                      step="any"
                      dir="ltr"
                      value={refillAmountInput}
                      onChange={(e) => setRefillAmountInput(e.target.value)}
                      className="w-24 px-2.5 py-1 rounded-lg bg-stone-900 border border-stone-700 text-white font-mono text-xs font-black text-center"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const add = Number(refillAmountInput) || 0;
                        if (add > 0) {
                          onRefillStock(med.id, add);
                        }
                        setRefillMedId(null);
                      }}
                      className="px-3 py-1 rounded-lg bg-indigo-500 text-white text-xs font-black cursor-pointer"
                    >
                      {isEn ? 'Add' : 'ثبت'}
                    </button>
                  </div>
                )}

                {med.notes && (
                  <p className="text-xs text-stone-300 bg-stone-950/60 border border-stone-800/80 rounded-xl px-3 py-2">
                    {med.notes}
                  </p>
                )}

                {/* Card Footer: Toggle Intake History Log */}
                <div className="pt-2 border-t border-stone-800/80 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-stone-400">
                    {isEn
                      ? `${med.history.filter((h) => h.status === 'taken').length} doses taken total`
                      : `مجموع نوبت‌های مصرف‌شده: ${formatNum(
                          med.history.filter((h) => h.status === 'taken').length
                        )} نوبت`}
                  </span>

                  <button
                    type="button"
                    onClick={() =>
                      setExpandedHistoryId(isHistoryOpen ? null : med.id)
                    }
                    className="px-2.5 py-1 rounded-lg bg-stone-950 hover:bg-stone-800 border border-stone-800 text-indigo-300 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <History className="w-3.5 h-3.5" />
                    <span>{isEn ? 'History Log' : 'تاریخچه مصرف'}</span>
                    {isHistoryOpen ? (
                      <ChevronUp className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>

                {/* Expandable History Log Array */}
                {isHistoryOpen && (
                  <div className="p-2.5 rounded-xl bg-stone-950 border border-stone-800 space-y-1.5 max-h-44 overflow-y-auto">
                    {sortedHistory.length === 0 ? (
                      <p className="text-[11px] text-stone-400 text-center py-2">
                        {isEn
                          ? 'No dose logs recorded yet.'
                          : 'هنوز سابقه مصرفی برای این دارو ثبت نشده است.'}
                      </p>
                    ) : (
                      sortedHistory.map((log) => (
                        <div
                          key={log.id}
                          className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-stone-900 border border-stone-800/80 text-[11px]"
                        >
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`px-1.5 py-0.5 rounded font-bold text-[10px] ${
                                log.status === 'taken'
                                  ? 'bg-emerald-500/20 text-emerald-300'
                                  : 'bg-rose-500/20 text-rose-300'
                              }`}
                            >
                              {log.status === 'taken'
                                ? isEn
                                  ? 'Taken'
                                  : 'مصرف شد'
                                : isEn
                                ? 'Missed'
                                : 'فراموش شد'}
                            </span>
                            <span className="text-stone-300 font-mono">
                              {isEn ? `Slot ${log.scheduledTime}` : `نوبت ${formatNum(log.scheduledTime)}`}
                            </span>
                          </div>
                          <span className="text-stone-400 font-mono">
                            {formatJalaliFull(log.actionTimestamp, isEn ? 'en' : 'fa')} •{' '}
                            {formatJalaliTime(log.actionTimestamp, isEn ? 'en' : 'fa')}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

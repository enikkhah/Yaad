import React, { useState, useEffect } from 'react';
import { 
  X, 
  Check, 
  Calendar, 
  User, 
  FileText, 
  Bell, 
  Sparkles,
  Cake,
  HeartHandshake,
  Flame,
  Users,
  Briefcase,
  CalendarHeart
} from 'lucide-react';
import { Occasion, OccasionType } from '../types';
import { 
  OCCASION_TYPES, 
  getOccasionTypeMeta, 
  calculateNextOccasionOccurrence,
  getOccasionAnniversaryLabel
} from '../utils/occasionUtils';
import { 
  getJalaliComponents, 
  getGregorianComponents,
  PERSIAN_MONTHS, 
  GREGORIAN_MONTHS,
  toPersianDigits, 
  getDaysInJalaliMonth,
  getDaysInGregorianMonth,
  getJalaliWeekdayIndex,
  getGregorianMondayWeekdayIndex,
  JALALI_WEEKDAYS_HEADER,
  GREGORIAN_WEEKDAYS_MONDAY_FIRST,
  getCalendarDayHolidayInfo,
  getMonthOfficialHolidays
} from '../utils/jalali';
import { WheelPicker } from './WheelPicker';
import { ValidationAlertModal } from './ValidationAlertModal';
import { AppLanguage } from '../utils/i18n';

interface OccasionFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (occasion: Omit<Occasion, 'id' | 'createdAt'>, alsoCreateReminder?: boolean) => void;
  editingOccasion?: Occasion | null;
  language?: AppLanguage;
}

const NOTIFY_DAYS_OPTIONS = [
  { days: 0, labelFa: 'همان روز (روز رویداد)', labelEn: 'Same Day' },
  { days: 1, labelFa: '۱ روز قبل (فرداش مناسبته)', labelEn: '1 Day Before' },
  { days: 2, labelFa: '۲ روز قبل (برای تدارک)', labelEn: '2 Days Before' },
  { days: 3, labelFa: '۳ روز قبل', labelEn: '3 Days Before' },
  { days: 7, labelFa: '۱ هفته قبل (برای خرید کادو)', labelEn: '1 Week Before' },
];

export const OccasionFormModal: React.FC<OccasionFormModalProps> = ({
  isOpen,
  onClose,
  onSave,
  editingOccasion,
  language = 'fa',
}) => {
  const isEn = language === 'en';
  const currentJalali = getJalaliComponents(Date.now());
  const currentGregorian = getGregorianComponents(Date.now());
  const activeCalendarYear = isEn ? currentGregorian.year : currentJalali.year;

  const [type, setType] = useState<OccasionType>('birthday');
  const [title, setTitle] = useState('');
  const [personName, setPersonName] = useState('');
  const [solarYear, setSolarYear] = useState<number | undefined>(undefined);
  const [hasStartingYear, setHasStartingYear] = useState(false);
  const [solarMonth, setSolarMonth] = useState<number>(isEn ? currentGregorian.month : currentJalali.month);
  const [solarDay, setSolarDay] = useState<number>(isEn ? currentGregorian.day : currentJalali.day);
  const [dateActiveTab, setDateActiveTab] = useState<'day' | 'month' | 'year' | null>(null);
  const [customStartYearInput, setCustomStartYearInput] = useState<string>('');
  const [notifyDaysBefore, setNotifyDaysBefore] = useState<number>(1);
  const [notifyHour, setNotifyHour] = useState<number>(9);
  const [notifyMinute, setNotifyMinute] = useState<number>(0);
  const [customNote, setCustomNote] = useState('');
  const [alsoCreateReminder, setAlsoCreateReminder] = useState(true);

  // Validation
  const [showValidationModal, setShowValidationModal] = useState(false);
  const [validationFieldName, setValidationFieldName] = useState('');

  // Keyboard viewport
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return;
    const handleViewportChange = () => {
      if (window.visualViewport) {
        setViewportHeight(window.visualViewport.height);
      }
    };
    window.visualViewport.addEventListener('resize', handleViewportChange);
    window.visualViewport.addEventListener('scroll', handleViewportChange);
    handleViewportChange();
    return () => {
      window.visualViewport?.removeEventListener('resize', handleViewportChange);
      window.visualViewport?.removeEventListener('scroll', handleViewportChange);
    };
  }, []);

  useEffect(() => {
    if (editingOccasion) {
      setType(editingOccasion.type);
      setTitle(editingOccasion.title);
      setPersonName(editingOccasion.personName || '');
      setSolarMonth(editingOccasion.solarMonth);
      setSolarDay(editingOccasion.solarDay);
      if (editingOccasion.solarYear) {
        setSolarYear(editingOccasion.solarYear);
        setHasStartingYear(true);
        setCustomStartYearInput(String(editingOccasion.solarYear));
      } else {
        setSolarYear(undefined);
        setHasStartingYear(false);
        setCustomStartYearInput('');
      }
      setNotifyDaysBefore(editingOccasion.notifyDaysBefore);
      const [hStr, mStr] = (editingOccasion.notifyTime || '09:00').split(':');
      setNotifyHour(parseInt(hStr || '9', 10));
      setNotifyMinute(parseInt(mStr || '0', 10));
      setCustomNote(editingOccasion.customNote || '');
      setAlsoCreateReminder(false);
      setDateActiveTab(null);
    } else {
      setType('birthday');
      setTitle('');
      setPersonName('');
      setSolarMonth(isEn ? currentGregorian.month : currentJalali.month);
      setSolarDay(isEn ? currentGregorian.day : currentJalali.day);
      setSolarYear((isEn ? currentGregorian.year : currentJalali.year) - 20);
      setHasStartingYear(false);
      setCustomStartYearInput('');
      setNotifyDaysBefore(1);
      setNotifyHour(9);
      setNotifyMinute(0);
      setCustomNote('');
      setAlsoCreateReminder(true);
      setDateActiveTab(null);
    }
  }, [editingOccasion, isOpen]);

  // Auto-generate title placeholder or suggestion if title is empty
  const handleTypeSelect = (selectedType: OccasionType) => {
    setType(selectedType);
    const meta = getOccasionTypeMeta(selectedType);
    const [h, m] = meta.defaultTime.split(':');
    setNotifyHour(parseInt(h, 10));
    setNotifyMinute(parseInt(m, 10));

    if (!title.trim() || Object.values(OCCASION_TYPES).some((t) => t.labelFa === title || t.labelEn === title)) {
      if (selectedType === 'birthday') {
        setTitle(personName ? (isEn ? `${personName}'s Birthday` : `تولد ${personName}`) : (isEn ? 'Birthday' : 'تولد'));
      } else if (selectedType === 'wedding') {
        setTitle(isEn ? 'Wedding Anniversary' : 'سالگرد ازدواج');
      } else if (selectedType === 'dating') {
        setTitle(isEn ? 'Relationship Anniversary' : 'سالگرد آشنایی');
      } else if (selectedType === 'memorial') {
        setTitle(personName ? (isEn ? `Memorial of ${personName}` : `سالگرد درگذشت ${personName}`) : (isEn ? 'Memorial Day' : 'سالگرد درگذشت'));
      } else {
        setTitle(isEn ? meta.labelEn : meta.labelFa);
      }
    }
  };

  const handlePersonNameChange = (val: string) => {
    setPersonName(val);
    if (!title.trim() || title === 'تولد' || title.startsWith('تولد ') || title.startsWith('سالگرد درگذشت')) {
      if (type === 'birthday') {
        setTitle(val.trim() ? `تولد ${val.trim()}` : 'تولد');
      } else if (type === 'memorial') {
        setTitle(val.trim() ? `سالگرد درگذشت ${val.trim()}` : 'سالگرد درگذشت');
      }
    }
  };

  const daysInSelectedMonth = isEn
    ? getDaysInGregorianMonth(activeCalendarYear, solarMonth)
    : getDaysInJalaliMonth(activeCalendarYear, solarMonth);

  const recentStartYearsGrid = Array.from({ length: 35 }, (_, i) => activeCalendarYear - i);

  const handleSave = () => {
    if (!title.trim()) {
      setValidationFieldName(isEn ? 'Occasion Title' : 'عنوان مناسبت');
      setShowValidationModal(true);
      return;
    }

    const timeStr = `${notifyHour.toString().padStart(2, '0')}:${notifyMinute.toString().padStart(2, '0')}`;

    onSave(
      {
        title: title.trim(),
        personName: personName.trim() || undefined,
        type,
        solarYear: hasStartingYear && solarYear ? solarYear : undefined,
        solarMonth,
        solarDay: Math.min(solarDay, daysInSelectedMonth),
        notifyDaysBefore,
        notifyTime: timeStr,
        customNote: customNote.trim() || undefined,
      },
      alsoCreateReminder
    );

    onClose();
  };

  if (!isOpen) return null;

  const renderIcon = (iconName: string) => {
    switch (iconName) {
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
        return <CalendarHeart className="w-5 h-5 text-indigo-400" />;
    }
  };

  // Preview next occurrence and calculated anniversary turn
  const tempOccasion: Occasion = {
    id: 'preview',
    title: title.trim() || 'مناسبت',
    personName: personName.trim() || undefined,
    type,
    solarYear: hasStartingYear && solarYear ? solarYear : undefined,
    solarMonth,
    solarDay: Math.min(solarDay, daysInSelectedMonth),
    notifyDaysBefore,
    notifyTime: `${notifyHour.toString().padStart(2, '0')}:${notifyMinute.toString().padStart(2, '0')}`,
    createdAt: Date.now(),
  };
  const preview = calculateNextOccasionOccurrence(tempOccasion, Date.now(), language);
  const previewLabel = getOccasionAnniversaryLabel(tempOccasion, preview.yearsPassed, isEn ? 'en' : 'fa');

  return (
    <>
      <div 
        className="fixed inset-0 z-50 flex flex-col justify-end sm:justify-center items-center p-0 sm:p-4 bg-black/80 backdrop-blur-sm overflow-hidden"
        style={{ height: viewportHeight ? `${viewportHeight}px` : '100dvh' }}
        dir={isEn ? 'ltr' : 'rtl'}
      >
        <div 
          className="bg-stone-900 border border-stone-800 rounded-t-3xl sm:rounded-3xl w-full max-w-xl overflow-hidden shadow-2xl flex flex-col transition-all duration-150"
          style={{ maxHeight: viewportHeight ? `${viewportHeight}px` : '94dvh' }}
        >
          {/* Header */}
          <div className="p-4 sm:p-5 border-b border-stone-800 flex items-center justify-between shrink-0 bg-stone-900/90 backdrop-blur">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-pink-500/20 to-rose-500/20 border border-pink-500/40 text-pink-400 flex items-center justify-center">
                <Cake className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-black text-sm sm:text-base text-white">
                  {editingOccasion 
                    ? (isEn ? 'Edit Occasion' : 'ویرایش مناسبت') 
                    : (isEn ? 'New Occasion' : 'ثبت مناسبت جدید')}
                </h3>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-400 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="p-4 sm:p-5 space-y-4 sm:space-y-5 overflow-y-auto flex-1 text-right rtl:text-right ltr:text-left">
            {/* Primary Title Field — Distinct & First */}
            <div className="p-3.5 sm:p-4 rounded-2xl bg-gradient-to-br from-pink-950/55 via-stone-900/95 to-stone-950 border-2 border-pink-500/55 shadow-lg shadow-pink-500/10 space-y-2.5">
              <label className="text-sm sm:text-base font-black text-white tracking-tight flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)] shrink-0" />
                <span>{isEn ? 'Occasion Title' : 'عنوان مناسبت'}</span>
                <span className="text-amber-400 font-black text-base">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={isEn ? 'e.g. Ali Birthday, Wedding Anniversary...' : 'مثال: تولد علی، سالگرد ازدواج، سالگرد آشنایی...'}
                className="w-full bg-stone-950 border-2 border-pink-400/70 focus:border-amber-400 ring-2 ring-pink-500/15 focus:ring-amber-400/25 rounded-2xl px-4 py-3.5 text-base sm:text-lg font-extrabold text-white placeholder-stone-400 focus:outline-none transition-all shadow-inner"
              />
            </div>

            {/* Occasion Types - Small Horizontal List */}
            <div>
              <label className="block text-xs font-bold text-stone-200 mb-1.5">
                {isEn ? 'Occasion Type' : 'نوع مناسبت'}
              </label>
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1.5 pt-0.5 no-scrollbar">
                {OCCASION_TYPES.map((t) => {
                  const isSelected = type === t.type;
                  return (
                    <button
                      key={t.type}
                      type="button"
                      onClick={() => handleTypeSelect(t.type)}
                      className={`min-h-[40px] px-3 py-1.5 rounded-xl border flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer text-xs font-bold shrink-0 ${
                        isSelected
                          ? `${t.badgeBg} ${t.borderCol} shadow-sm ring-1 ring-pink-500/40`
                          : 'bg-stone-950/80 border-stone-800 text-stone-300 hover:border-stone-700 hover:text-white'
                      }`}
                    >
                      <span className="shrink-0">{renderIcon(t.iconName)}</span>
                      <span className={`text-xs ${isSelected ? t.badgeText : 'text-stone-300'}`}>
                        {isEn ? t.labelEn : t.labelFa}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Person Name (Optional) */}
            <div>
              <label className="block text-xs font-bold text-stone-300 mb-1.5 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-stone-400" />
                <span>{isEn ? 'Person Name (Optional)' : 'نام شخص یا طرف مقابل (اختیاری)'}</span>
              </label>
              <input
                type="text"
                value={personName}
                onChange={(e) => handlePersonNameChange(e.target.value)}
                placeholder={isEn ? 'e.g. Sarah, Ali, Mom...' : 'مثلاً: سارا، مادر، علی...'}
                className="w-full bg-stone-950 border border-stone-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-stone-500 focus:outline-none focus:border-pink-500 transition-colors"
              />
            </div>

            {/* Unified Date Picker Model (روز / ماه / سال مبدأ) with Separated Independent Boxes */}
            <div className="p-3.5 rounded-2xl bg-stone-950/70 border border-stone-800 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-pink-400">
                  <Calendar className="w-4 h-4" />
                  <span>{isEn ? 'Occasion Date (Select Day, Month & Start Year)' : 'تاریخ مناسبت (انتخاب روز، ماه و سال مبدأ)'}</span>
                </div>
                <span className="text-[11px] font-bold text-stone-400">
                  {isEn
                    ? `${GREGORIAN_MONTHS[solarMonth - 1]} ${Math.min(solarDay, daysInSelectedMonth)}`
                    : `${toPersianDigits(Math.min(solarDay, daysInSelectedMonth))} ${PERSIAN_MONTHS[solarMonth - 1]}`}
                </span>
              </div>

              {/* 3 Separated Independent Boxes for Day, Month, and Start Year */}
              <div className="grid grid-cols-3 gap-2.5 text-xs">
                <button
                  type="button"
                  onClick={() => setDateActiveTab(dateActiveTab === 'day' ? null : 'day')}
                  className={`py-2.5 px-2 rounded-2xl border-2 text-center font-black transition-all cursor-pointer flex flex-col items-center justify-center gap-0.5 shadow-sm ${
                    dateActiveTab === 'day'
                      ? 'bg-pink-600 border-pink-400 text-white shadow-lg shadow-pink-600/25 ring-2 ring-pink-400/30'
                      : 'bg-stone-950 border-stone-700/90 text-stone-200 hover:text-white hover:border-pink-500/60 hover:bg-stone-900'
                  }`}
                >
                  <span className={`text-[10px] font-bold ${dateActiveTab === 'day' ? 'text-pink-100' : 'text-stone-400'}`}>{isEn ? 'Day' : 'روز'}</span>
                  <span className="text-sm sm:text-base font-black">
                    {isEn ? Math.min(solarDay, daysInSelectedMonth) : toPersianDigits(Math.min(solarDay, daysInSelectedMonth))}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setDateActiveTab(dateActiveTab === 'month' ? null : 'month')}
                  className={`py-2.5 px-2 rounded-2xl border-2 text-center font-black transition-all cursor-pointer flex flex-col items-center justify-center gap-0.5 shadow-sm ${
                    dateActiveTab === 'month'
                      ? 'bg-pink-600 border-pink-400 text-white shadow-lg shadow-pink-600/25 ring-2 ring-pink-400/30'
                      : 'bg-stone-950 border-stone-700/90 text-stone-200 hover:text-white hover:border-pink-500/60 hover:bg-stone-900'
                  }`}
                >
                  <span className={`text-[10px] font-bold ${dateActiveTab === 'month' ? 'text-pink-100' : 'text-stone-400'}`}>{isEn ? 'Month' : 'ماه'}</span>
                  <span className="text-sm sm:text-base font-black truncate max-w-full">
                    {isEn ? GREGORIAN_MONTHS[solarMonth - 1] : PERSIAN_MONTHS[solarMonth - 1]}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setDateActiveTab(dateActiveTab === 'year' ? null : 'year')}
                  className={`py-2.5 px-2 rounded-2xl border-2 text-center font-black transition-all cursor-pointer flex flex-col items-center justify-center gap-0.5 shadow-sm ${
                    dateActiveTab === 'year'
                      ? 'bg-pink-600 border-pink-400 text-white shadow-lg shadow-pink-600/25 ring-2 ring-pink-400/30'
                      : 'bg-stone-950 border-stone-700/90 text-stone-200 hover:text-white hover:border-pink-500/60 hover:bg-stone-900'
                  }`}
                >
                  <span className={`text-[10px] font-bold ${dateActiveTab === 'year' ? 'text-pink-100' : 'text-stone-400'}`}>{isEn ? 'Start Year' : 'سال مبدأ'}</span>
                  <span className="text-sm sm:text-base font-black">
                    {hasStartingYear && solarYear
                      ? (isEn ? solarYear : toPersianDigits(solarYear))
                      : (isEn ? 'Annual' : 'سالانه')}
                  </span>
                </button>
              </div>

              {/* Active Table/Grid Content */}
              {dateActiveTab === 'day' && (() => {
                const startWeekday = isEn
                  ? getGregorianMondayWeekdayIndex(activeCalendarYear, solarMonth, 1)
                  : getJalaliWeekdayIndex(activeCalendarYear, solarMonth, 1);
                const monthHolidays = getMonthOfficialHolidays(activeCalendarYear, solarMonth, language);
                const clampedDay = Math.min(solarDay, daysInSelectedMonth);
                const selectedDayHoliday = getCalendarDayHolidayInfo(activeCalendarYear, solarMonth, clampedDay, language);

                return (
                  <div className="p-2.5 sm:p-3 rounded-2xl bg-stone-950/90 border border-stone-800 space-y-2.5 animate-in fade-in">
                    {/* Row 1: Weekday Headers (Saturday-first in FA, Monday-first in EN) */}
                    <div className="grid grid-cols-7 gap-1 sm:gap-1.5 text-center border-b border-stone-800 pb-2">
                      {(isEn ? GREGORIAN_WEEKDAYS_MONDAY_FIRST : JALALI_WEEKDAYS_HEADER).map((w) => (
                        <div
                          key={w.index}
                          className={`py-1 rounded-lg text-[10px] sm:text-xs font-extrabold ${
                            w.isWeekend
                              ? 'text-rose-400 bg-rose-500/10 border border-rose-500/25'
                              : 'text-stone-300 bg-stone-900/70 border border-stone-800/70'
                          }`}
                          title={w.full}
                        >
                          {w.label}
                        </div>
                      ))}
                    </div>

                    {/* Days Grid Aligned by Weekday */}
                    <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
                      {Array.from({ length: startWeekday }).map((_, idx) => (
                        <div key={`empty-${idx}`} className="min-h-[34px] sm:min-h-[38px] rounded-xl bg-stone-900/20 border border-stone-900/40" />
                      ))}

                      {Array.from({ length: daysInSelectedMonth }, (_, i) => i + 1).map((d) => {
                        const isSelected = clampedDay === d;
                        const holidayInfo = getCalendarDayHolidayInfo(activeCalendarYear, solarMonth, d, language);

                        return (
                          <button
                            key={d}
                            type="button"
                            onClick={() => {
                              setSolarDay(d);
                              setDateActiveTab(null);
                            }}
                            title={
                              holidayInfo.occasionTitle
                                ? `${isEn ? 'Official Holiday:' : 'تعطیل رسمی:'} ${holidayInfo.occasionTitle}`
                                : holidayInfo.isWeekend
                                ? (isEn ? 'Weekend Holiday' : 'تعطیل آخر هفته')
                                : undefined
                            }
                            className={`min-h-[34px] sm:min-h-[38px] rounded-xl text-xs sm:text-sm font-bold flex flex-col items-center justify-center transition-all cursor-pointer active:scale-95 relative border ${
                              isSelected
                                ? 'bg-pink-600 border-pink-400 text-white font-black shadow-md ring-2 ring-pink-400'
                                : holidayInfo.isOfficialHoliday
                                ? 'bg-rose-500/20 border-rose-500/50 text-rose-300 hover:bg-rose-500/30 font-black'
                                : holidayInfo.isWeekend
                                ? 'bg-rose-500/10 border-rose-500/30 text-rose-400 hover:bg-rose-500/20'
                                : 'bg-stone-900/80 hover:bg-stone-800 text-stone-300 hover:text-white border-stone-800/80'
                            }`}
                          >
                            <span>{isEn ? d : toPersianDigits(d)}</span>
                            {holidayInfo.isOfficialHoliday && !isSelected && (
                              <span className="w-1 h-1 rounded-full bg-rose-400 mt-0.5" />
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {/* Holidays Legend & Monthly Occasion Holidays Info */}
                    <div className="pt-1.5 border-t border-stone-800/80 space-y-1.5">
                      <div className="flex items-center justify-between flex-wrap gap-2 text-[10px] text-stone-400">
                        <div className="flex items-center gap-3">
                          <span className="inline-flex items-center gap-1 text-rose-400 font-bold">
                            <span className="w-2 h-2 rounded-sm bg-rose-500/30 border border-rose-500/60" />
                            {isEn ? 'Weekend (Sat & Sun)' : 'تعطیل آخر هفته (پنج‌شنبه و جمعه)'}
                          </span>
                          <span className="inline-flex items-center gap-1 text-rose-300 font-bold">
                            <span className="w-2 h-2 rounded-full bg-rose-400" />
                            {isEn ? 'Official Holiday' : 'تعطیل رسمی مناسبتی'}
                          </span>
                        </div>
                        {selectedDayHoliday.occasionTitle && (
                          <span className="text-rose-300 font-black">
                            {isEn ? `Selected: ${selectedDayHoliday.occasionTitle}` : `مناسبت روز انتخابی: ${selectedDayHoliday.occasionTitle}`}
                          </span>
                        )}
                      </div>

                      {monthHolidays.length > 0 && (
                        <div className="p-2 rounded-xl bg-rose-500/10 border border-rose-500/25 text-[11px] text-rose-200 leading-relaxed">
                          <span className="font-black text-rose-300">
                            {isEn ? 'Official Holidays this month: ' : 'تعطیلات مناسبتی این ماه: '}
                          </span>
                          <span>
                            {monthHolidays
                              .map((h) =>
                                isEn
                                  ? `${GREGORIAN_MONTHS[solarMonth - 1]} ${h.day} (${h.title})`
                                  : `${toPersianDigits(h.day)} ${PERSIAN_MONTHS[solarMonth - 1]} (${h.title})`
                              )
                              .join(isEn ? ' • ' : ' ، ')}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {dateActiveTab === 'month' && (
                <div className="p-2 sm:p-2.5 rounded-2xl bg-stone-950/90 border border-stone-800 animate-in fade-in">
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                    {(isEn ? GREGORIAN_MONTHS : PERSIAN_MONTHS).map((mName, idx) => {
                      const monthNum = idx + 1;
                      const isSelected = solarMonth === monthNum;
                      return (
                        <button
                          key={mName}
                          type="button"
                          onClick={() => {
                            setSolarMonth(monthNum);
                            const maxD = isEn
                              ? getDaysInGregorianMonth(activeCalendarYear, monthNum)
                              : getDaysInJalaliMonth(activeCalendarYear, monthNum);
                            if (solarDay > maxD) {
                              setSolarDay(maxD);
                            }
                            setDateActiveTab(null);
                          }}
                          className={`py-2 px-1 rounded-xl text-xs font-bold transition-all text-center cursor-pointer active:scale-95 ${
                            isSelected
                              ? 'bg-pink-600 text-white font-black shadow-md ring-2 ring-pink-400'
                              : 'bg-stone-900/80 hover:bg-stone-800 text-stone-300 hover:text-white border border-stone-800/80'
                          }`}
                        >
                          <span>{mName}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {dateActiveTab === 'year' && (
                <div className="p-2.5 rounded-2xl bg-stone-950/90 border border-stone-800 space-y-3 animate-in fade-in">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold text-stone-300">
                      {isEn ? 'Select Birth / Start Year (for age/anniversary count):' : 'انتخاب سال تولد / شروع مناسبت (برای محاسبه سن یا سالگرد):'}
                    </span>
                    {hasStartingYear && (
                      <button
                        type="button"
                        onClick={() => {
                          setHasStartingYear(false);
                          setDateActiveTab(null);
                        }}
                        className="px-2 py-0.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-300 text-[10px] font-bold cursor-pointer"
                      >
                        {isEn ? 'Set as Annual Only' : 'بدون سال مبدأ (فقط سالانه)'}
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-4 sm:grid-cols-5 gap-1.5 max-h-44 overflow-y-auto no-scrollbar p-0.5">
                    {recentStartYearsGrid.map((yr) => {
                      const isSelected = hasStartingYear && solarYear === yr;
                      return (
                        <button
                          key={yr}
                          type="button"
                          onClick={() => {
                            setHasStartingYear(true);
                            setSolarYear(yr);
                            setCustomStartYearInput(String(yr));
                            setDateActiveTab(null);
                          }}
                          className={`py-1.5 px-1 rounded-xl text-xs font-mono font-bold transition-all text-center cursor-pointer active:scale-95 ${
                            isSelected
                              ? 'bg-pink-600 text-white font-black shadow-md ring-2 ring-pink-400'
                              : 'bg-stone-900/80 hover:bg-stone-800 text-stone-300 hover:text-white border border-stone-800/80'
                          }`}
                        >
                          {isEn ? yr : toPersianDigits(yr)}
                        </button>
                      );
                    })}
                  </div>

                  <div className="pt-2 border-t border-stone-800/80 flex items-center gap-2">
                    <input
                      type="number"
                      min={isEn ? 1900 : 1300}
                      max={activeCalendarYear}
                      value={customStartYearInput}
                      onChange={(e) => {
                        setCustomStartYearInput(e.target.value);
                        const val = parseInt(e.target.value, 10);
                        if (!isNaN(val) && val >= (isEn ? 1900 : 1300) && val <= activeCalendarYear) {
                          setHasStartingYear(true);
                          setSolarYear(val);
                        }
                      }}
                      placeholder={isEn ? 'Type year (e.g. 1990)' : 'تایپ سال مبدأ (مثلاً ۱۳۶۵)...'}
                      className="flex-1 bg-stone-900 border border-stone-700 rounded-xl px-3 py-2 text-xs text-white placeholder-stone-500 focus:outline-none focus:border-pink-500 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const val = parseInt(customStartYearInput, 10);
                        if (!isNaN(val) && val >= (isEn ? 1900 : 1300) && val <= activeCalendarYear) {
                          setHasStartingYear(true);
                          setSolarYear(val);
                          setDateActiveTab(null);
                        }
                      }}
                      className="px-3.5 py-2 rounded-xl bg-pink-600 hover:bg-pink-500 text-white font-bold text-xs cursor-pointer active:scale-95 transition-all"
                    >
                      {isEn ? 'Apply' : 'ثبت'}
                    </button>
                  </div>
                </div>
              )}

              {/* Quick Toggle for Starting Year */}
              <div className="pt-2 border-t border-stone-800/80 flex items-center justify-between gap-2 flex-wrap">
                <label className="flex items-center gap-2.5 cursor-pointer text-xs">
                  <input
                    type="checkbox"
                    checked={hasStartingYear}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setHasStartingYear(checked);
                      if (checked) {
                        if (!solarYear) setSolarYear(activeCalendarYear - 20);
                        setDateActiveTab('year');
                      }
                    }}
                    className="w-4 h-4 rounded accent-pink-500 cursor-pointer"
                  />
                  <span className="text-stone-300 font-bold">
                    {isEn ? 'Calculate Age / Anniversary Year' : 'محاسبه سن یا چندمین سالگرد (ثبت سال مبدأ رویداد)'}
                  </span>
                </label>

                {hasStartingYear && solarYear && activeCalendarYear >= solarYear && (
                  <span className="text-[11px] font-bold text-pink-300 bg-pink-500/15 px-2.5 py-0.5 rounded-lg border border-pink-500/30">
                    {isEn
                      ? `${activeCalendarYear - solarYear} years`
                      : `امسال: ${toPersianDigits(activeCalendarYear - solarYear)} ساله / مین سالگرد`}
                  </span>
                )}
              </div>
            </div>

            {/* Notification & Reminder Ahead */}
            <div className="p-3.5 rounded-2xl bg-stone-950/70 border border-stone-800 space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-pink-400">
                <Bell className="w-4 h-4" />
                <span>{isEn ? 'Reminder & Advance Notification' : 'زمان‌بندی و هشدار یادآوری'}</span>
              </div>

              {/* Days Before Selector */}
              <div>
                <label className="block text-[11px] text-stone-400 mb-1.5">
                  {isEn ? 'Notify Ahead:' : 'هشدار چند روز قبل فعال شود؟'}
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {NOTIFY_DAYS_OPTIONS.map((opt) => (
                    <button
                      key={opt.days}
                      type="button"
                      onClick={() => setNotifyDaysBefore(opt.days)}
                      className={`px-2.5 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                        notifyDaysBefore === opt.days
                          ? 'bg-pink-500/20 text-pink-300 border-pink-500/50 shadow-sm'
                          : 'bg-stone-900 text-stone-400 border-stone-800 hover:border-stone-700'
                      }`}
                    >
                      {isEn ? opt.labelEn : opt.labelFa}
                    </button>
                  ))}
                </div>
              </div>

              {/* Notify Time Hour & Minute Wheel Pickers */}
              <div className="pt-2 border-t border-stone-800/80">
                <label className="block text-[11px] text-stone-400 mb-2">
                  {isEn ? 'Alarm Time on Milestone Day:' : 'ساعت دقیق پخش آلارم و اعلان در روز یادآوری:'}
                </label>
                <div dir="ltr" className="grid grid-cols-2 gap-3 max-w-[260px] mx-auto">
                  <WheelPicker
                    label={isEn ? 'Hour' : 'ساعت'}
                    selectedValue={notifyHour}
                    onChange={(val) => setNotifyHour(val)}
                    min={0}
                    max={23}
                    itemHeight={76}
                    items={Array.from({ length: 24 }, (_, i) => ({
                      value: i,
                      label: i.toString().padStart(2, '0'),
                    }))}
                  />
                  <WheelPicker
                    label={isEn ? 'Minute' : 'دقیقه'}
                    selectedValue={notifyMinute}
                    onChange={(val) => setNotifyMinute(val)}
                    min={0}
                    max={59}
                    itemHeight={76}
                    items={Array.from({ length: 60 }, (_, i) => ({
                      value: i,
                      label: i.toString().padStart(2, '0'),
                    }))}
                  />
                </div>
              </div>
            </div>

            {/* Custom Notes / Gift Ideas */}
            <div>
              <label className="block text-xs font-bold text-stone-300 mb-1.5 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-stone-400" />
                <span>{isEn ? 'Notes / Gift Ideas (Optional)' : 'یادداشت یا ایده هدیه (اختیاری)'}</span>
              </label>
              <textarea
                value={customNote}
                onChange={(e) => setCustomNote(e.target.value)}
                placeholder={isEn ? 'e.g. Loves books, gift card idea, dinner reservation...' : 'مثلاً: به ساعت علاقه‌مند است، رزرو رستوران، هدیه مشترک...'}
                rows={2}
                className="w-full bg-stone-950 border border-stone-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-stone-500 focus:outline-none focus:border-pink-500 transition-colors resize-none"
              />
            </div>

            {/* Live Preview Card */}
            <div className="p-3 rounded-2xl bg-gradient-to-r from-pink-500/10 via-purple-500/10 to-indigo-500/10 border border-pink-500/30 flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <span className="text-[10px] text-pink-300 font-bold block">
                  {isEn ? 'Preview Card' : 'پیش‌نمایش کارت مناسبت:'}
                </span>
                <span className="text-xs font-black text-white block">
                  {previewLabel}
                </span>
                <span className="text-[11px] text-stone-300 block">
                  {preview.formattedTargetDate}
                  {' • '}
                  {preview.isToday 
                    ? (isEn ? 'TODAY!' : 'امروز!') 
                    : (isEn ? `${preview.daysRemaining} days left` : `${toPersianDigits(preview.daysRemaining)} روز مانده`)}
                </span>
              </div>
              <div className="px-2.5 py-1 rounded-xl bg-pink-500/20 text-pink-300 border border-pink-500/40 text-xs font-black">
                {preview.isToday ? (isEn ? 'Today' : 'امروز') : (isEn ? `${preview.daysRemaining}d` : `${toPersianDigits(preview.daysRemaining)} روز`)}
              </div>
            </div>

            {/* Also Create System Reminder */}
            {!editingOccasion && (
              <label className="flex items-center gap-3 p-3 rounded-2xl bg-stone-950 border border-stone-800/80 cursor-pointer hover:border-pink-500/30 transition-colors">
                <input
                  type="checkbox"
                  checked={alsoCreateReminder}
                  onChange={(e) => setAlsoCreateReminder(e.target.checked)}
                  className="w-4 h-4 rounded accent-pink-500 cursor-pointer"
                />
                <div className="flex-1">
                  <span className="text-xs font-bold text-white block">
                    {isEn ? 'Add alarm reminder to Timeline & Alarm' : 'تنظیم خودکار آلارم صوتی در خط زمانی یادآورها'}
                  </span>
                  <span className="text-[10px] text-stone-400 block">
                    {isEn 
                      ? 'Automatically triggers alarm audio at specified notification day and hour' 
                      : 'در تاریخ مشخص‌شده آلارم رسا و اعلان بومی با عنوان مناسبت فعال خواهد شد'}
                  </span>
                </div>
              </label>
            )}
          </div>

          {/* Footer - Sticky at bottom with min 48px buttons */}
          <div className="sticky bottom-0 z-20 p-3 sm:p-4 border-t border-stone-800 bg-stone-900 shadow-2xl flex items-center justify-between gap-3 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[48px] px-5 py-2.5 rounded-xl bg-stone-800 hover:bg-stone-700 active:scale-95 text-stone-300 hover:text-white text-xs sm:text-sm font-semibold transition-colors cursor-pointer flex items-center justify-center border border-stone-700/60"
            >
              {isEn ? 'Cancel' : 'انصراف'}
            </button>

            <button
              type="button"
              onClick={handleSave}
              className={`min-h-[48px] flex-1 sm:flex-initial px-6 py-2.5 rounded-xl text-xs sm:text-sm font-black flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-95 ${
                !title.trim()
                  ? 'bg-pink-500/20 border border-pink-500/40 text-pink-300'
                  : 'bg-pink-500 hover:bg-pink-400 text-stone-950 font-black shadow-lg shadow-pink-500/25'
              }`}
            >
              <Check className={`w-4 h-4 stroke-[3] ${!title.trim() ? 'text-pink-300' : 'text-stone-950'}`} />
              <span className={!title.trim() ? 'text-pink-300 font-bold' : 'text-stone-950 font-black'}>
                {editingOccasion 
                  ? (isEn ? 'Save Changes' : 'ذخیره تغییرات') 
                  : (isEn ? 'Save Occasion' : 'ثبت نهایی مناسبت')}
              </span>
            </button>
          </div>
        </div>
      </div>

      <ValidationAlertModal
        isOpen={showValidationModal}
        onClose={() => setShowValidationModal(false)}
        title={isEn ? 'Required Field Missing' : 'تکمیل فیلد اجباری'}
        fieldName={validationFieldName}
        language={language}
      />
    </>
  );
};

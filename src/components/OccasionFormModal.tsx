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
  getNotifyDaysOptionsForType,
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
  defaultType?: OccasionType;
  language?: AppLanguage;
}

export const OccasionFormModal: React.FC<OccasionFormModalProps> = ({
  isOpen,
  onClose,
  onSave,
  editingOccasion,
  defaultType,
  language = 'fa',
}) => {
  const isEn = language === 'en';
  const currentJalali = getJalaliComponents(Date.now());
  const currentGregorian = getGregorianComponents(Date.now());
  const activeCalendarYear = isEn ? currentGregorian.year : currentJalali.year;

  const [type, setType] = useState<OccasionType>(defaultType || 'birthday');
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
  const [viewportOffsetTop, setViewportOffsetTop] = useState<number>(0);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return;
    const handleViewportChange = () => {
      if (window.visualViewport) {
        setViewportHeight(window.visualViewport.height);
        setViewportOffsetTop(window.visualViewport.offsetTop || 0);
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
    if (!isOpen) return;
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
      const initialType = defaultType || 'birthday';
      const initialMeta = getOccasionTypeMeta(initialType);
      const [hStr, mStr] = (initialMeta.defaultTime || '09:00').split(':');
      setType(initialType);
      setTitle('');
      setPersonName('');
      setSolarMonth(isEn ? currentGregorian.month : currentJalali.month);
      setSolarDay(isEn ? currentGregorian.day : currentJalali.day);
      setSolarYear((isEn ? currentGregorian.year : currentJalali.year) - 20);
      setHasStartingYear(false);
      setCustomStartYearInput('');
      setNotifyDaysBefore(1);
      setNotifyHour(parseInt(hStr || '9', 10));
      setNotifyMinute(parseInt(mStr || '0', 10));
      setCustomNote('');
      setAlsoCreateReminder(true);
      setDateActiveTab(null);
    }
  }, [editingOccasion, isOpen, defaultType]);

  // Check if current title is an auto-generated default title
  const isAutoGeneratedTitle = (tVal: string) => {
    const trimmed = tVal.trim();
    if (!trimmed) return true;
    const autoPrefixes = [
      'تولد',
      'سالگرد ازدواج',
      'سالگرد آشنایی',
      'سالگرد درگذشت',
      'سالگرد فوت',
      'مناسبت خانوادگی',
      'مناسبت کاری',
      'سایر مناسبت',
      'Birthday',
      'Wedding Anniversary',
      'Relationship Anniversary',
      'Memorial',
      'Family Occasion',
      'Work & Professional',
      'Custom Occasion',
    ];
    if (OCCASION_TYPES.some((ot) => ot.labelFa === trimmed || ot.labelEn === trimmed)) {
      return true;
    }
    return autoPrefixes.some((p) => trimmed === p || trimmed.startsWith(p + ' '));
  };

  // Auto-generate title suggestion when switching Occasion Type tabs
  const handleTypeSelect = (selectedType: OccasionType) => {
    setType(selectedType);
    const meta = getOccasionTypeMeta(selectedType);
    const [h, m] = meta.defaultTime.split(':');
    setNotifyHour(parseInt(h, 10));
    setNotifyMinute(parseInt(m, 10));

    if (isAutoGeneratedTitle(title)) {
      const pName = personName.trim();
      if (selectedType === 'birthday') {
        setTitle(pName ? (isEn ? `${pName}'s Birthday` : `تولد ${pName}`) : (isEn ? 'Birthday' : 'تولد'));
      } else if (selectedType === 'wedding') {
        setTitle(pName ? (isEn ? `Wedding Anniversary (${pName})` : `سالگرد ازدواج ${pName}`) : (isEn ? 'Wedding Anniversary' : 'سالگرد ازدواج'));
      } else if (selectedType === 'dating') {
        setTitle(pName ? (isEn ? `Anniversary (${pName})` : `سالگرد آشنایی ${pName}`) : (isEn ? 'Relationship Anniversary' : 'سالگرد آشنایی'));
      } else if (selectedType === 'memorial') {
        setTitle(pName ? (isEn ? `Memorial of ${pName}` : `سالگرد درگذشت ${pName}`) : (isEn ? 'Memorial Day' : 'سالگرد درگذشت'));
      } else {
        setTitle(isEn ? meta.labelEn : meta.labelFa);
      }
    }
  };

  const handlePersonNameChange = (val: string) => {
    setPersonName(val);
    if (isAutoGeneratedTitle(title)) {
      const pName = val.trim();
      if (type === 'birthday') {
        setTitle(pName ? (isEn ? `${pName}'s Birthday` : `تولد ${pName}`) : (isEn ? 'Birthday' : 'تولد'));
      } else if (type === 'memorial') {
        setTitle(pName ? (isEn ? `Memorial of ${pName}` : `سالگرد درگذشت ${pName}`) : (isEn ? 'Memorial Day' : 'سالگرد درگذشت'));
      } else if (type === 'wedding') {
        setTitle(pName ? (isEn ? `Wedding Anniversary (${pName})` : `سالگرد ازدواج ${pName}`) : (isEn ? 'Wedding Anniversary' : 'سالگرد ازدواج'));
      } else if (type === 'dating') {
        setTitle(pName ? (isEn ? `Anniversary (${pName})` : `سالگرد آشنایی ${pName}`) : (isEn ? 'Relationship Anniversary' : 'سالگرد آشنایی'));
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

  const activeMeta = getOccasionTypeMeta(type);
  const notifyDaysOptions = getNotifyDaysOptionsForType(type);

  const renderIcon = (iconName: string, customClass?: string) => {
    const cls = customClass || 'w-5 h-5';
    switch (iconName) {
      case 'Cake':
        return <Cake className={`${cls} text-rose-400`} />;
      case 'HeartHandshake':
        return <HeartHandshake className={`${cls} text-pink-400`} />;
      case 'Sparkles':
        return <Sparkles className={`${cls} text-purple-400`} />;
      case 'Flame':
        return <Flame className={`${cls} text-slate-300`} />;
      case 'Users':
        return <Users className={`${cls} text-emerald-400`} />;
      case 'Briefcase':
        return <Briefcase className={`${cls} text-sky-400`} />;
      case 'CalendarHeart':
      default:
        return <CalendarHeart className={`${cls} text-[#F7941E]`} />;
    }
  };

  // Preview next occurrence and calculated anniversary turn
  const tempOccasion: Occasion = {
    id: 'preview',
    title: title.trim() || (isEn ? activeMeta.labelEn : activeMeta.labelFa),
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
        style={{
          height: viewportHeight ? `${viewportHeight}px` : '100dvh',
          top: viewportOffsetTop ? `${viewportOffsetTop}px` : 0,
          bottom: 'auto',
        }}
        dir={isEn ? 'ltr' : 'rtl'}
      >
        <div 
          className="bg-stone-900 border border-stone-800 rounded-t-3xl sm:rounded-3xl w-full max-w-xl overflow-hidden shadow-2xl flex flex-col transition-all duration-150"
          style={{ maxHeight: viewportHeight ? `${viewportHeight}px` : '94dvh' }}
        >
          {/* Header with Dynamic Mood per Occasion Type */}
          <div className={`p-4 sm:p-5 border-b flex items-center justify-between shrink-0 bg-gradient-to-r ${activeMeta.headerBgClass} transition-all duration-300`}>
            <div className="flex items-center gap-3 min-w-0">
              <div className={`w-10 h-10 rounded-2xl border flex items-center justify-center shrink-0 ${activeMeta.badgeBg} ${activeMeta.borderCol}`}>
                {renderIcon(activeMeta.iconName, 'w-5 h-5')}
              </div>
              <div className="min-w-0">
                <h3 className="font-black text-sm sm:text-base text-white truncate">
                  {editingOccasion 
                    ? (isEn ? `Edit ${activeMeta.labelEn}` : `ویرایش ${activeMeta.labelFa}`) 
                    : (isEn ? `New ${activeMeta.labelEn}` : `ثبت ${activeMeta.labelFa}`)}
                </h3>
                <p className="text-[11px] text-stone-300 truncate">
                  {isEn ? activeMeta.moodTitleEn : activeMeta.moodTitleFa}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl bg-stone-800/90 hover:bg-stone-700 text-stone-400 hover:text-white transition-colors cursor-pointer shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="p-4 sm:p-5 space-y-4 sm:space-y-5 overflow-y-auto overscroll-contain flex-1 min-h-0 text-right rtl:text-right ltr:text-left">
            {/* 1. Occasion Types - MOVED ABOVE TITLE per user request */}
            <div className="p-3 rounded-2xl bg-stone-950/75 border border-stone-800/90 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="block text-xs font-extrabold text-stone-200">
                  {isEn ? 'Occasion Type' : 'نوع مناسبت'}
                </label>
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-lg border ${activeMeta.badgeBg} ${activeMeta.badgeText} ${activeMeta.borderCol}`}>
                  {isEn ? activeMeta.labelEn : activeMeta.labelFa}
                </span>
              </div>
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-0.5 no-scrollbar">
                {OCCASION_TYPES.map((t) => {
                  const isSelected = type === t.type;
                  return (
                    <button
                      key={t.type}
                      type="button"
                      onClick={() => handleTypeSelect(t.type)}
                      className={`min-h-[40px] px-3 py-1.5 rounded-xl border flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer text-xs font-bold shrink-0 ${
                        isSelected
                          ? `${t.activeTabClass} font-black`
                          : 'bg-stone-900/90 border-stone-800 text-stone-300 hover:border-stone-700 hover:text-white'
                      }`}
                    >
                      <span className="shrink-0">{renderIcon(t.iconName, 'w-4 h-4')}</span>
                      <span className="text-xs">
                        {isEn ? t.labelEn : t.labelFa}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-stone-400 leading-relaxed">
                {isEn ? activeMeta.moodDescEn : activeMeta.moodDescFa}
              </p>
            </div>

            {/* 2. Primary Title Field — Distinct & Adapted to Selected Occasion Type */}
            <div className={`p-3.5 sm:p-4 rounded-2xl bg-gradient-to-br ${activeMeta.headerBgClass} border-2 shadow-lg space-y-2.5 transition-all duration-300`}>
              <label className="text-sm sm:text-base font-black text-white tracking-tight flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#F7941E] shadow-[0_0_8px_rgba(247,148,30,0.85)] shrink-0" />
                <span>{isEn ? 'Occasion Title' : 'عنوان مناسبت'}</span>
                <span className="text-[#F7941E] font-black text-base">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={isEn ? activeMeta.titlePlaceholderEn : activeMeta.titlePlaceholderFa}
                className={`w-full bg-stone-950 border-2 ${activeMeta.borderCol} focus:border-[#F7941E] ring-2 ring-black/20 focus:ring-[#F7941E]/25 rounded-2xl px-4 py-3.5 text-base sm:text-lg font-extrabold text-white placeholder-stone-400 focus:outline-none transition-all shadow-inner`}
              />
            </div>

            {/* 3. Person Name (Contextual label & placeholder per Occasion Type) */}
            <div>
              <label className="block text-xs font-bold text-stone-300 mb-1.5 flex items-center gap-1.5">
                <User className={`w-3.5 h-3.5 ${activeMeta.accentTextClass}`} />
                <span>{isEn ? activeMeta.personLabelEn : activeMeta.personLabelFa}</span>
              </label>
              <input
                type="text"
                value={personName}
                onChange={(e) => handlePersonNameChange(e.target.value)}
                placeholder={isEn ? activeMeta.personPlaceholderEn : activeMeta.personPlaceholderFa}
                className="w-full bg-stone-950 border border-stone-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-stone-500 focus:outline-none focus:border-[#F7941E] transition-colors"
              />
            </div>

            {/* 4. Unified Date Picker Model (روز / ماه / سال مبدأ) with Separated Independent Boxes */}
            <div className="p-3.5 rounded-2xl bg-stone-950/70 border border-stone-800 space-y-3">
              <div className="flex items-center justify-between">
                <div className={`flex items-center gap-2 text-xs font-bold ${activeMeta.accentTextClass}`}>
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
                      ? `${activeMeta.activeTabClass}`
                      : 'bg-stone-950 border-stone-700/90 text-stone-200 hover:text-white hover:border-stone-500 hover:bg-stone-900'
                  }`}
                >
                  <span className={`text-[10px] font-bold ${dateActiveTab === 'day' ? 'opacity-90' : 'text-stone-400'}`}>{isEn ? 'Day' : 'روز'}</span>
                  <span className="text-sm sm:text-base font-black">
                    {isEn ? Math.min(solarDay, daysInSelectedMonth) : toPersianDigits(Math.min(solarDay, daysInSelectedMonth))}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setDateActiveTab(dateActiveTab === 'month' ? null : 'month')}
                  className={`py-2.5 px-2 rounded-2xl border-2 text-center font-black transition-all cursor-pointer flex flex-col items-center justify-center gap-0.5 shadow-sm ${
                    dateActiveTab === 'month'
                      ? `${activeMeta.activeTabClass}`
                      : 'bg-stone-950 border-stone-700/90 text-stone-200 hover:text-white hover:border-stone-500 hover:bg-stone-900'
                  }`}
                >
                  <span className={`text-[10px] font-bold ${dateActiveTab === 'month' ? 'opacity-90' : 'text-stone-400'}`}>{isEn ? 'Month' : 'ماه'}</span>
                  <span className="text-sm sm:text-base font-black truncate max-w-full">
                    {isEn ? GREGORIAN_MONTHS[solarMonth - 1] : PERSIAN_MONTHS[solarMonth - 1]}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setDateActiveTab(dateActiveTab === 'year' ? null : 'year')}
                  className={`py-2.5 px-2 rounded-2xl border-2 text-center font-black transition-all cursor-pointer flex flex-col items-center justify-center gap-0.5 shadow-sm ${
                    dateActiveTab === 'year'
                      ? `${activeMeta.activeTabClass}`
                      : 'bg-stone-950 border-stone-700/90 text-stone-200 hover:text-white hover:border-stone-500 hover:bg-stone-900'
                  }`}
                >
                  <span className={`text-[10px] font-bold ${dateActiveTab === 'year' ? 'opacity-90' : 'text-stone-400'}`}>{isEn ? 'Start Year' : 'سال مبدأ'}</span>
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
                                ? `${activeMeta.activeTabClass} font-black`
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
                          className={`py-2 px-1 rounded-xl text-xs font-bold transition-all text-center cursor-pointer active:scale-95 border ${
                            isSelected
                              ? `${activeMeta.activeTabClass} font-black`
                              : 'bg-stone-900/80 hover:bg-stone-800 text-stone-300 hover:text-white border-stone-800/80'
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
                      {isEn ? activeMeta.yearToggleLabelEn : activeMeta.yearToggleLabelFa}
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
                          className={`py-1.5 px-1 rounded-xl text-xs font-mono font-bold transition-all text-center cursor-pointer active:scale-95 border ${
                            isSelected
                              ? `${activeMeta.activeTabClass} font-black`
                              : 'bg-stone-900/80 hover:bg-stone-800 text-stone-300 hover:text-white border-stone-800/80'
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
                      className="flex-1 bg-stone-900 border border-stone-700 rounded-xl px-3 py-2 text-xs text-white placeholder-stone-500 focus:outline-none focus:border-[#F7941E] font-mono"
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
                      className={`px-3.5 py-2 rounded-xl font-bold text-xs cursor-pointer active:scale-95 transition-all ${activeMeta.primaryBtnClass}`}
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
                    className="w-4 h-4 rounded accent-[#F7941E] cursor-pointer"
                  />
                  <span className="text-stone-300 font-bold">
                    {isEn ? activeMeta.yearToggleLabelEn : activeMeta.yearToggleLabelFa}
                  </span>
                </label>

                {hasStartingYear && solarYear && activeCalendarYear >= solarYear && (
                  <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-lg border ${activeMeta.badgeBg} ${activeMeta.badgeText} ${activeMeta.borderCol}`}>
                    {isEn
                      ? `${activeCalendarYear - solarYear} years`
                      : type === 'birthday'
                      ? `امسال: ${toPersianDigits(activeCalendarYear - solarYear)} سالگی`
                      : `امسال: ${toPersianDigits(activeCalendarYear - solarYear)}مین سالگرد`}
                  </span>
                )}
              </div>
            </div>

            {/* 5. Notification & Reminder Ahead (Contextual Options per Type — NO gift shopping for Memorial!) */}
            <div className="p-3.5 rounded-2xl bg-stone-950/70 border border-stone-800 space-y-3">
              <div className={`flex items-center gap-2 text-xs font-bold ${activeMeta.accentTextClass}`}>
                <Bell className="w-4 h-4" />
                <span>{isEn ? 'Reminder & Advance Notification' : 'زمان‌بندی و هشدار یادآوری'}</span>
              </div>

              {/* Days Before Selector */}
              <div>
                <label className="block text-[11px] text-stone-400 mb-1.5">
                  {isEn ? 'Notify Ahead:' : 'هشدار چند روز قبل فعال شود؟'}
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {notifyDaysOptions.map((opt) => (
                    <button
                      key={opt.days}
                      type="button"
                      onClick={() => setNotifyDaysBefore(opt.days)}
                      className={`px-2.5 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                        notifyDaysBefore === opt.days
                          ? `${activeMeta.badgeBg} ${activeMeta.badgeText} ${activeMeta.borderCol} shadow-sm`
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

            {/* 6. Contextual Notes (Memorial Service/Charity vs Gift Ideas vs Work Notes) */}
            <div>
              <label className="block text-xs font-bold text-stone-300 mb-1.5 flex items-center gap-1.5">
                <FileText className={`w-3.5 h-3.5 ${activeMeta.accentTextClass}`} />
                <span>{isEn ? activeMeta.noteLabelEn : activeMeta.noteLabelFa}</span>
              </label>
              <textarea
                value={customNote}
                onChange={(e) => setCustomNote(e.target.value)}
                placeholder={isEn ? activeMeta.notePlaceholderEn : activeMeta.notePlaceholderFa}
                rows={2}
                className="w-full bg-stone-950 border border-stone-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-stone-500 focus:outline-none focus:border-[#F7941E] transition-colors resize-none"
              />
            </div>

            {/* 7. Live Preview Card */}
            <div className={`p-3 rounded-2xl bg-gradient-to-r ${activeMeta.headerBgClass} border flex items-center justify-between gap-3 transition-all duration-300`}>
              <div className="space-y-0.5">
                <span className={`text-[10px] font-bold block ${activeMeta.badgeText}`}>
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
              <div className={`px-2.5 py-1 rounded-xl border text-xs font-black ${activeMeta.badgeBg} ${activeMeta.badgeText} ${activeMeta.borderCol}`}>
                {preview.isToday ? (isEn ? 'Today' : 'امروز') : (isEn ? `${preview.daysRemaining}d` : `${toPersianDigits(preview.daysRemaining)} روز`)}
              </div>
            </div>

            {/* 8. Also Create System Reminder */}
            {!editingOccasion && (
              <label className="flex items-center gap-3 p-3 rounded-2xl bg-stone-950 border border-stone-800/80 cursor-pointer hover:border-stone-700 transition-colors">
                <input
                  type="checkbox"
                  checked={alsoCreateReminder}
                  onChange={(e) => setAlsoCreateReminder(e.target.checked)}
                  className="w-4 h-4 rounded accent-[#F7941E] cursor-pointer"
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
              className={`min-h-[48px] flex-1 sm:flex-initial px-6 py-2.5 rounded-xl text-xs sm:text-sm font-black flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-95 shadow-lg ${
                !title.trim()
                  ? `${activeMeta.badgeBg} border ${activeMeta.borderCol} ${activeMeta.badgeText}`
                  : activeMeta.primaryBtnClass
              }`}
            >
              <Check className="w-4 h-4 stroke-[3]" />
              <span className="font-black">
                {editingOccasion 
                  ? (isEn ? 'Save Changes' : 'ذخیره تغییرات') 
                  : (isEn ? `Save ${activeMeta.labelEn}` : `ثبت ${activeMeta.labelFa}`)}
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


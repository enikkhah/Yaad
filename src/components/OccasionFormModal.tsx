import React, { useState, useEffect } from 'react';
import { 
  X, 
  Check, 
  Calendar, 
  Clock, 
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
  OccasionTypeMeta, 
  getOccasionTypeMeta, 
  calculateNextOccasionOccurrence,
  getOccasionAnniversaryLabel
} from '../utils/occasionUtils';
import { 
  getJalaliComponents, 
  PERSIAN_MONTHS, 
  toPersianDigits, 
  getDaysInJalaliMonth 
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

  const [type, setType] = useState<OccasionType>('birthday');
  const [title, setTitle] = useState('');
  const [personName, setPersonName] = useState('');
  const [solarYear, setSolarYear] = useState<number | undefined>(undefined);
  const [hasStartingYear, setHasStartingYear] = useState(false);
  const [solarMonth, setSolarMonth] = useState<number>(currentJalali.month);
  const [solarDay, setSolarDay] = useState<number>(currentJalali.day);
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
      } else {
        setSolarYear(undefined);
        setHasStartingYear(false);
      }
      setNotifyDaysBefore(editingOccasion.notifyDaysBefore);
      const [hStr, mStr] = (editingOccasion.notifyTime || '09:00').split(':');
      setNotifyHour(parseInt(hStr || '9', 10));
      setNotifyMinute(parseInt(mStr || '0', 10));
      setCustomNote(editingOccasion.customNote || '');
      setAlsoCreateReminder(false);
    } else {
      setType('birthday');
      setTitle('');
      setPersonName('');
      setSolarMonth(currentJalali.month);
      setSolarDay(currentJalali.day);
      setSolarYear(currentJalali.year - 20); // Default reasonable starting year for birth
      setHasStartingYear(false);
      setNotifyDaysBefore(1);
      setNotifyHour(9);
      setNotifyMinute(0);
      setCustomNote('');
      setAlsoCreateReminder(true);
    }
  }, [editingOccasion, isOpen]);

  // Auto-generate title placeholder or suggestion if title is empty
  const handleTypeSelect = (selectedType: OccasionType) => {
    setType(selectedType);
    const meta = getOccasionTypeMeta(selectedType);
    const [h, m] = meta.defaultTime.split(':');
    setNotifyHour(parseInt(h, 10));
    setNotifyMinute(parseInt(m, 10));

    if (!title.trim() || Object.values(OCCASION_TYPES).some((t) => t.labelFa === title)) {
      if (selectedType === 'birthday') {
        setTitle(personName ? `تولد ${personName}` : 'تولد');
      } else if (selectedType === 'wedding') {
        setTitle('سالگرد ازدواج');
      } else if (selectedType === 'dating') {
        setTitle('سالگرد آشنایی');
      } else if (selectedType === 'memorial') {
        setTitle(personName ? `سالگرد درگذشت ${personName}` : 'سالگرد درگذشت');
      } else {
        setTitle(meta.labelFa);
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

  const daysInSelectedMonth = getDaysInJalaliMonth(currentJalali.year, solarMonth);

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
        return <CalendarHeart className="w-5 h-5 text-amber-400" />;
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
  const preview = calculateNextOccasionOccurrence(tempOccasion);
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
                <p className="text-[11px] text-stone-400">
                  {isEn 
                    ? 'Birthdays, anniversaries & annual milestones' 
                    : 'تولد، سالگرد ازدواج، آشنایی، یادبود و تاریخ‌های مهم'}
                </p>
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
            {/* Occasion Types Grid */}
            <div>
              <label className="block text-xs font-bold text-stone-200 mb-2">
                {isEn ? 'Occasion Type' : 'نوع مناسبت'}
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {OCCASION_TYPES.map((t) => {
                  const isSelected = type === t.type;
                  return (
                    <button
                      key={t.type}
                      type="button"
                      onClick={() => handleTypeSelect(t.type)}
                      className={`p-2.5 rounded-2xl border flex flex-col items-center gap-1.5 transition-all text-center cursor-pointer ${
                        isSelected
                          ? `${t.badgeBg} ${t.borderCol} shadow-md scale-[1.02]`
                          : 'bg-stone-950/60 border-stone-800 text-stone-400 hover:border-stone-700'
                      }`}
                    >
                      <div className="p-1 rounded-xl bg-stone-900/80 border border-stone-800">
                        {renderIcon(t.iconName)}
                      </div>
                      <span className={`text-[11px] font-bold ${isSelected ? t.badgeText : 'text-stone-300'}`}>
                        {isEn ? t.labelEn : t.labelFa}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Title & Person Name */}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-stone-200 mb-1.5">
                  <span>{isEn ? 'Occasion Title' : 'عنوان مناسبت'}</span>
                  <span className="text-pink-400 font-black mr-1 ml-1">*</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={isEn ? 'e.g. Ali Birthday, Wedding Anniversary...' : 'مثال: تولد علی، سالگرد ازدواج، سالگرد آشنایی...'}
                  className="w-full bg-stone-950 border border-stone-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-stone-500 focus:outline-none focus:border-pink-500 transition-colors"
                />
              </div>

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
            </div>

            {/* Solar Month & Day Picker */}
            <div className="p-3.5 rounded-2xl bg-stone-950/70 border border-stone-800 space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-pink-400">
                <Calendar className="w-4 h-4" />
                <span>{isEn ? 'Solar Date (Annual Milestone)' : 'تاریخ شمسی مناسبت (سالانه)'}</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Month */}
                <div>
                  <label className="block text-[11px] text-stone-400 mb-1">{isEn ? 'Month' : 'ماه شمسی'}</label>
                  <select
                    value={solarMonth}
                    onChange={(e) => setSolarMonth(parseInt(e.target.value, 10))}
                    className="w-full bg-stone-900 border border-stone-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-pink-500 font-bold"
                  >
                    {PERSIAN_MONTHS.map((m, idx) => (
                      <option key={m} value={idx + 1}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Day */}
                <div>
                  <label className="block text-[11px] text-stone-400 mb-1">{isEn ? 'Day' : 'روز ماه'}</label>
                  <select
                    value={Math.min(solarDay, daysInSelectedMonth)}
                    onChange={(e) => setSolarDay(parseInt(e.target.value, 10))}
                    className="w-full bg-stone-900 border border-stone-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-pink-500 font-bold"
                  >
                    {Array.from({ length: daysInSelectedMonth }, (_, i) => i + 1).map((d) => (
                      <option key={d} value={d}>
                        {isEn ? d : toPersianDigits(d)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Starting Year Toggle for Age / Anniversary Turn Calculation */}
              <div className="pt-2 border-t border-stone-800/80 space-y-2">
                <label className="flex items-center gap-2.5 cursor-pointer text-xs">
                  <input
                    type="checkbox"
                    checked={hasStartingYear}
                    onChange={(e) => {
                      setHasStartingYear(e.target.checked);
                      if (e.target.checked && !solarYear) {
                        setSolarYear(currentJalali.year - 20);
                      }
                    }}
                    className="w-4 h-4 rounded accent-pink-500 cursor-pointer"
                  />
                  <span className="text-stone-300 font-bold">
                    {isEn ? 'Calculate Age / Anniversary Year' : 'محاسبه سن یا چندمین سالگرد (ثبت سال مبدأ رویداد)'}
                  </span>
                </label>

                {hasStartingYear && (
                  <div className="flex items-center gap-2 ps-6">
                    <span className="text-[11px] text-stone-400">{isEn ? 'Birth/Start Year:' : 'سال شروع/تولد شمسی:'}</span>
                    <input
                      type="number"
                      min="1300"
                      max={currentJalali.year}
                      value={solarYear || currentJalali.year - 20}
                      onChange={(e) => setSolarYear(parseInt(e.target.value, 10) || undefined)}
                      className="w-28 bg-stone-900 border border-stone-700 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-pink-500 font-mono"
                    />
                    <span className="text-[11px] text-stone-400">
                      {solarYear && currentJalali.year >= solarYear && (
                        <span>
                          (امسال: {toPersianDigits(currentJalali.year - solarYear)} ساله / مین سالگرد)
                        </span>
                      )}
                    </span>
                  </div>
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
            <div className="p-3 rounded-2xl bg-gradient-to-r from-pink-500/10 via-purple-500/10 to-amber-500/10 border border-pink-500/30 flex items-center justify-between gap-3">
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
                    : `${toPersianDigits(preview.daysRemaining)} روز مانده`}
                </span>
              </div>
              <div className="px-2.5 py-1 rounded-xl bg-pink-500/20 text-pink-300 border border-pink-500/40 text-xs font-black">
                {preview.isToday ? 'امروز' : `${toPersianDigits(preview.daysRemaining)} روز`}
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

          {/* Footer */}
          <div className="p-3 sm:p-5 border-t border-stone-800 bg-stone-900/95 backdrop-blur flex items-center justify-between gap-3 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-300 text-xs sm:text-sm font-semibold transition-colors cursor-pointer"
            >
              {isEn ? 'Cancel' : 'انصراف'}
            </button>

            <button
              type="button"
              onClick={handleSave}
              className={`flex-1 sm:flex-initial px-6 py-2.5 rounded-xl text-xs sm:text-sm font-black flex items-center justify-center gap-2 transition-all cursor-pointer ${
                !title.trim()
                  ? 'bg-pink-500/20 border border-pink-500/40 text-pink-300'
                  : 'bg-pink-500 hover:bg-pink-400 text-stone-950 font-black shadow-lg shadow-pink-500/25 active:scale-95'
              }`}
            >
              <Check className={`w-4 h-4 stroke-[3] ${!title.trim() ? 'text-pink-300' : 'text-stone-950'}`} />
              <span className={!title.trim() ? 'text-pink-300 font-bold' : 'text-stone-950 font-black'}>
                {editingOccasion 
                  ? (isEn ? 'Save Changes' : 'ذخیره تغییرات مناسبت') 
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

import React, { useState } from 'react';
import { 
  PERSIAN_MONTHS, 
  toPersianDigits, 
  getDaysInJalaliMonth, 
  getJalaliWeekdayIndex, 
  getJalaliComponents,
  GREGORIAN_MONTHS,
  GREGORIAN_WEEKDAYS_SHORT,
  getDaysInGregorianMonth,
  getGregorianComponents
} from '../utils/jalali';
import { PERSIAN_WEEK_DAYS } from '../utils/recurrence';
import { ChevronRight, ChevronLeft, Calendar as CalendarIcon, Check, X, RotateCcw } from 'lucide-react';

interface JalaliMultiDatePickerProps {
  selectedDates: string[]; // array of "YYYY/MM/DD"
  onChange: (dates: string[]) => void;
  baseYear?: number;
  baseMonth?: number;
  language?: 'fa' | 'en';
}

export const JalaliMultiDatePicker: React.FC<JalaliMultiDatePickerProps> = ({
  selectedDates,
  onChange,
  baseYear,
  baseMonth,
  language = 'fa',
}) => {
  const isEn = language === 'en';
  const currentJalali = getJalaliComponents(Date.now());
  const currentGregorian = getGregorianComponents(Date.now());

  const [viewYear, setViewYear] = useState<number>(
    baseYear || (isEn ? currentGregorian.year : currentJalali.year)
  );
  const [viewMonth, setViewMonth] = useState<number>(
    baseMonth || (isEn ? currentGregorian.month : currentJalali.month)
  );

  const daysInMonth = isEn 
    ? getDaysInGregorianMonth(viewYear, viewMonth) 
    : getDaysInJalaliMonth(viewYear, viewMonth);

  // In Gregorian, 0=Sunday, 6=Saturday. In Jalali, 0=Saturday (شنبه), 6=Friday (جمعه)
  const startWeekday = isEn
    ? new Date(viewYear, viewMonth - 1, 1).getDay()
    : getJalaliWeekdayIndex(viewYear, viewMonth, 1);

  // Prev / Next Month
  const handlePrevMonth = () => {
    if (viewMonth === 1) {
      setViewMonth(12);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 12) {
      setViewMonth(1);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const formatDateStr = (y: number, m: number, d: number): string => {
    const mm = m.toString().padStart(2, '0');
    const dd = d.toString().padStart(2, '0');
    return `${y}/${mm}/${dd}`;
  };

  const toggleDay = (day: number) => {
    const dateStr = formatDateStr(viewYear, viewMonth, day);
    if (selectedDates.includes(dateStr)) {
      onChange(selectedDates.filter((d) => d !== dateStr));
    } else {
      onChange([...selectedDates, dateStr].sort());
    }
  };

  const removeDate = (dateStr: string) => {
    onChange(selectedDates.filter((d) => d !== dateStr));
  };

  const clearAll = () => {
    onChange([]);
  };

  // Quick preset: Select next 7 days or next 14 days
  const handleAddNextDays = (count: number) => {
    const datesSet = new Set(selectedDates);
    if (isEn) {
      const now = new Date();
      for (let i = 1; i <= count; i++) {
        const d = new Date(now.getTime() + i * 86400000);
        datesSet.add(formatDateStr(d.getFullYear(), d.getMonth() + 1, d.getDate()));
      }
    } else {
      let curComp = getJalaliComponents(Date.now());
      let y = curComp.year;
      let m = curComp.month;
      let d = curComp.day;

      for (let i = 0; i < count; i++) {
        d += 1;
        const maxDays = getDaysInJalaliMonth(y, m);
        if (d > maxDays) {
          d = 1;
          m += 1;
          if (m > 12) {
            m = 1;
            y += 1;
          }
        }
        datesSet.add(formatDateStr(y, m, d));
      }
    }
    onChange(Array.from(datesSet).sort());
  };

  return (
    <div className="bg-stone-950/95 border border-stone-800 rounded-2xl p-3 sm:p-4 space-y-3" dir={isEn ? 'ltr' : 'rtl'}>
      {/* Calendar Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarIcon className="w-4 h-4 text-indigo-400" />
          <span className="font-extrabold text-sm text-stone-200">
            {isEn 
              ? `${GREGORIAN_MONTHS[viewMonth - 1]} ${viewYear}` 
              : `${PERSIAN_MONTHS[viewMonth - 1]} ${toPersianDigits(viewYear)}`}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={isEn ? handlePrevMonth : handlePrevMonth}
            className="p-1.5 rounded-lg bg-stone-900 hover:bg-stone-800 text-stone-300 hover:text-indigo-400 border border-stone-800 transition-colors"
            title={isEn ? 'Previous month' : 'ماه قبل'}
          >
            {isEn ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={isEn ? handleNextMonth : handleNextMonth}
            className="p-1.5 rounded-lg bg-stone-900 hover:bg-stone-800 text-stone-300 hover:text-indigo-400 border border-stone-800 transition-colors"
            title={isEn ? 'Next month' : 'ماه بعد'}
          >
            {isEn ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 gap-1 text-center border-b border-stone-800 pb-1.5">
        {isEn ? (
          GREGORIAN_WEEKDAYS_SHORT.map((short, idx) => (
            <span
              key={short}
              className={`text-xs font-bold ${idx === 0 ? 'text-rose-400' : 'text-stone-400'}`}
            >
              {short}
            </span>
          ))
        ) : (
          PERSIAN_WEEK_DAYS.map((w) => (
            <span
              key={w.index}
              className={`text-xs font-bold ${w.index === 6 ? 'text-rose-400' : 'text-stone-400'}`}
            >
              {w.short}
            </span>
          ))
        )}
      </div>

      {/* Days Grid */}
      <div className="grid grid-cols-7 gap-1">
        {/* Leading empty slots */}
        {Array.from({ length: startWeekday }).map((_, i) => (
          <div key={`empty-${i}`} className="h-8 sm:h-9" />
        ))}

        {/* Days of current month */}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const dateStr = formatDateStr(viewYear, viewMonth, day);
          const isSelected = selectedDates.includes(dateStr);
          const isToday = isEn
            ? viewYear === currentGregorian.year &&
              viewMonth === currentGregorian.month &&
              day === currentGregorian.day
            : viewYear === currentJalali.year &&
              viewMonth === currentJalali.month &&
              day === currentJalali.day;

          const weekdayIndex = (startWeekday + i) % 7;
          const isHighlightDay = isEn ? (weekdayIndex === 0 || weekdayIndex === 6) : (weekdayIndex === 6);

          return (
            <button
              key={day}
              type="button"
              onClick={() => toggleDay(day)}
              className={`h-8 sm:h-9 rounded-xl flex items-center justify-center font-mono font-bold text-xs sm:text-sm transition-all relative active:scale-95 cursor-pointer ${
                isSelected
                  ? 'bg-indigo-600 text-white font-black shadow-md shadow-indigo-600/30 ring-2 ring-indigo-400'
                  : isToday
                  ? 'border border-indigo-400/80 text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/20'
                  : isHighlightDay
                  ? 'text-rose-400 hover:bg-stone-800/80'
                  : 'text-stone-300 hover:bg-stone-800/80 hover:text-white'
              }`}
            >
              <span>{isEn ? day : toPersianDigits(day)}</span>
              {isSelected && (
                <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-white" />
              )}
            </button>
          );
        })}
      </div>

      {/* Quick selection presets */}
      <div className="flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-stone-800/80 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-stone-400">
            {isEn ? 'Quick Select:' : 'انتخاب سریع:'}
          </span>
          <button
            type="button"
            onClick={() => handleAddNextDays(7)}
            className="px-2 py-0.5 rounded-lg bg-stone-900 hover:bg-stone-800 text-stone-300 hover:text-indigo-400 border border-stone-800 text-[11px] transition-colors"
          >
            {isEn ? '+7 Days' : '۷ روز بعد'}
          </button>
          <button
            type="button"
            onClick={() => handleAddNextDays(14)}
            className="px-2 py-0.5 rounded-lg bg-stone-900 hover:bg-stone-800 text-stone-300 hover:text-indigo-400 border border-stone-800 text-[11px] transition-colors"
          >
            {isEn ? '+14 Days' : '۱۴ روز بعد'}
          </button>
        </div>

        {selectedDates.length > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="flex items-center gap-1 text-[11px] text-rose-400 hover:text-rose-300 px-2 py-0.5 rounded-lg hover:bg-rose-500/10 transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            <span>
              {isEn ? `Clear all (${selectedDates.length})` : `پاک کردن همه (${toPersianDigits(selectedDates.length)})`}
            </span>
          </button>
        )}
      </div>

      {/* Selected dates tags preview */}
      {selectedDates.length > 0 && (
        <div className="space-y-1.5 pt-2 border-t border-stone-800/80">
          <div className="flex items-center justify-between text-[11px] text-stone-400 font-medium">
            <span>
              {isEn 
                ? `Selected Dates (${selectedDates.length} days):` 
                : `روزهای انتخاب شده (${toPersianDigits(selectedDates.length)} روز):`}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto p-1 rounded-xl bg-stone-900/60 border border-stone-800/60">
            {selectedDates.map((dateStr) => {
              const parts = dateStr.split('/');
              const mIdx = parseInt(parts[1], 10) - 1;
              const display = isEn
                ? `${GREGORIAN_MONTHS[mIdx] || ''} ${parseInt(parts[2], 10)}`
                : `${toPersianDigits(parseInt(parts[2], 10))} ${PERSIAN_MONTHS[mIdx]}`;
              return (
                <span
                  key={dateStr}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 text-[11px] font-bold"
                >
                  <span>{display}</span>
                  <button
                    type="button"
                    onClick={() => removeDate(dateStr)}
                    className="p-0.5 rounded hover:bg-indigo-500/30 text-indigo-400 hover:text-white"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

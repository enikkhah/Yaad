import React, { useState } from 'react';
import {
  PERSIAN_MONTHS,
  toPersianDigits,
  getDaysInJalaliMonth,
  getJalaliWeekdayIndex,
  getJalaliComponents,
  GREGORIAN_MONTHS,
  GREGORIAN_MONTHS_SHORT,
  getDaysInGregorianMonth,
  getGregorianComponents,
  JALALI_WEEKDAYS_HEADER,
  GREGORIAN_WEEKDAYS_SUNDAY_FIRST,
  getGregorianSundayWeekdayIndex,
  getCalendarDayHolidayInfo,
  getMonthOfficialHolidays,
} from '../utils/jalali';
import { ChevronRight, ChevronLeft, X, RotateCcw } from 'lucide-react';

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

  const getDaysInMonth = (y: number, m: number) =>
    isEn ? getDaysInGregorianMonth(y, m) : getDaysInJalaliMonth(y, m);

  const daysInMonth = getDaysInMonth(viewYear, viewMonth);

  // In English: Sunday-first (0=Sunday ... 6=Saturday)
  // In Persian: Saturday-first (0=Saturday ... 6=Friday)
  const startWeekday = isEn
    ? getGregorianSundayWeekdayIndex(viewYear, viewMonth, 1)
    : getJalaliWeekdayIndex(viewYear, viewMonth, 1);

  const prevMonth = viewMonth === 1 ? 12 : viewMonth - 1;
  const prevMonthYear = viewMonth === 1 ? viewYear - 1 : viewYear;
  const daysInPrevMonth = getDaysInMonth(prevMonthYear, prevMonth);

  const nextMonth = viewMonth === 12 ? 1 : viewMonth + 1;
  const nextMonthYear = viewMonth === 12 ? viewYear + 1 : viewYear;

  const cells: Array<{ year: number; month: number; day: number; isCurrentMonth: boolean }> = [];
  for (let i = startWeekday - 1; i >= 0; i--) {
    cells.push({
      year: prevMonthYear,
      month: prevMonth,
      day: daysInPrevMonth - i,
      isCurrentMonth: false,
    });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({
      year: viewYear,
      month: viewMonth,
      day: d,
      isCurrentMonth: true,
    });
  }
  const trailingCount = 42 - cells.length;
  for (let d = 1; d <= trailingCount; d++) {
    cells.push({
      year: nextMonthYear,
      month: nextMonth,
      day: d,
      isCurrentMonth: false,
    });
  }

  const monthHolidays = getMonthOfficialHolidays(viewYear, viewMonth, language);

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

  const toggleDate = (y: number, m: number, d: number, isCurrentMonth: boolean) => {
    if (!isCurrentMonth) {
      setViewYear(y);
      setViewMonth(m);
    }
    const dateStr = formatDateStr(y, m, d);
    if (selectedDates.includes(dateStr)) {
      onChange(selectedDates.filter((item) => item !== dateStr));
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
      const curComp = getJalaliComponents(Date.now());
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
    <div className="bg-stone-950/90 border border-stone-800 rounded-2xl p-3 sm:p-4 space-y-3" dir={isEn ? 'ltr' : 'rtl'}>
      {/* Calendar Header: < Month Year > */}
      <div className="flex items-center justify-between pt-0.5 px-1">
        <button
          type="button"
          onClick={handlePrevMonth}
          className="w-9 h-9 rounded-full flex items-center justify-center text-stone-200 hover:bg-stone-800 hover:text-white transition-all cursor-pointer active:scale-90"
          title={isEn ? 'Previous month' : 'ماه قبل'}
        >
          {isEn ? <ChevronLeft className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
        </button>

        <span className="font-black text-sm sm:text-base text-stone-100">
          {isEn
            ? `${GREGORIAN_MONTHS[viewMonth - 1]} ${viewYear}`
            : `${PERSIAN_MONTHS[viewMonth - 1]} ${toPersianDigits(viewYear)}`}
        </span>

        <button
          type="button"
          onClick={handleNextMonth}
          className="w-9 h-9 rounded-full flex items-center justify-center text-stone-200 hover:bg-stone-800 hover:text-white transition-all cursor-pointer active:scale-90"
          title={isEn ? 'Next month' : 'ماه بعد'}
        >
          {isEn ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
        </button>
      </div>

      {/* Weekday headers (Sunday-first in EN, Saturday-first in FA) */}
      <div className="grid grid-cols-7 text-center pb-1">
        {(isEn ? GREGORIAN_WEEKDAYS_SUNDAY_FIRST : JALALI_WEEKDAYS_HEADER).map((w) => (
          <div
            key={w.index}
            className={`py-1 text-[10px] sm:text-[11px] font-bold tracking-wider ${
              w.isWeekend
                ? isEn
                  ? 'text-indigo-400'
                  : 'text-rose-400'
                : 'text-stone-400'
            }`}
            title={w.full}
          >
            {w.short}
          </div>
        ))}
      </div>

      {/* 42-Cell Continuous Circular Day Grid */}
      <div className="grid grid-cols-7 gap-y-1 text-center">
        {cells.map((cell) => {
          const dateStr = formatDateStr(cell.year, cell.month, cell.day);
          const isSelected = selectedDates.includes(dateStr);
          const isToday = isEn
            ? cell.year === currentGregorian.year &&
              cell.month === currentGregorian.month &&
              cell.day === currentGregorian.day
            : cell.year === currentJalali.year &&
              cell.month === currentJalali.month &&
              cell.day === currentJalali.day;

          const holidayInfo = getCalendarDayHolidayInfo(cell.year, cell.month, cell.day, language);

          let cellColorClass = '';
          if (isSelected) {
            cellColorClass = 'bg-indigo-600 text-white font-black shadow-md';
          } else if (!cell.isCurrentMonth) {
            if (holidayInfo.isWeekend) {
              cellColorClass = isEn ? 'text-indigo-400/40' : 'text-rose-400/40';
            } else {
              cellColorClass = 'text-stone-500/55';
            }
          } else if (isToday) {
            cellColorClass = 'ring-1.5 ring-indigo-400/80 text-indigo-300 font-black hover:bg-stone-800/80';
          } else if (holidayInfo.isOfficialHoliday) {
            cellColorClass = 'text-rose-400 font-black hover:bg-stone-800/80';
          } else if (holidayInfo.isWeekend) {
            cellColorClass = isEn
              ? 'text-indigo-400 font-semibold hover:bg-stone-800/80'
              : 'text-rose-400 font-semibold hover:bg-stone-800/80';
          } else {
            cellColorClass = 'text-stone-100 font-medium hover:bg-stone-800/80';
          }

          return (
            <div key={`${cell.year}-${cell.month}-${cell.day}`} className="flex items-center justify-center py-0.5">
              <button
                type="button"
                onClick={() => toggleDate(cell.year, cell.month, cell.day, cell.isCurrentMonth)}
                title={
                  holidayInfo.occasionTitle
                    ? `${isEn ? 'Official Holiday:' : 'تعطیل رسمی:'} ${holidayInfo.occasionTitle}`
                    : holidayInfo.isWeekend
                    ? isEn
                      ? 'Weekend'
                      : 'تعطیل آخر هفته'
                    : undefined
                }
                className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex flex-col items-center justify-center text-xs sm:text-sm transition-all relative active:scale-90 cursor-pointer ${cellColorClass}`}
              >
                <span className="leading-none">{isEn ? cell.day : toPersianDigits(cell.day)}</span>
                {holidayInfo.isOfficialHoliday && cell.isCurrentMonth && !isSelected && (
                  <span className="w-1 h-1 rounded-full bg-rose-400 mt-0.5" />
                )}
              </button>
            </div>
          );
        })}
      </div>

      {/* Official Occasion Holidays Monthly List */}
      {monthHolidays.length > 0 && (
        <div className="pt-2 border-t border-stone-800/80">
          <div className="p-2 rounded-xl bg-rose-500/10 border border-rose-500/20 text-[11px] text-rose-200 leading-relaxed">
            <span className="font-black text-rose-300">
              {isEn ? 'Official Holidays: ' : 'تعطیلات رسمی این ماه: '}
            </span>
            <span>
              {monthHolidays
                .map((h) =>
                  isEn
                    ? `${GREGORIAN_MONTHS_SHORT[viewMonth - 1]} ${h.day} (${h.title})`
                    : `${toPersianDigits(h.day)} ${PERSIAN_MONTHS[viewMonth - 1]} (${h.title})`
                )
                .join(isEn ? ' • ' : ' ، ')}
            </span>
          </div>
        </div>
      )}

      {/* Quick selection presets */}
      <div className="flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-stone-800/80 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-stone-400">
            {isEn ? 'Quick Select:' : 'انتخاب سریع:'}
          </span>
          <button
            type="button"
            onClick={() => handleAddNextDays(7)}
            className="px-2 py-0.5 rounded-lg bg-stone-900 hover:bg-stone-800 text-stone-300 hover:text-indigo-400 border border-stone-800 text-[11px] transition-colors cursor-pointer"
          >
            {isEn ? '+7 Days' : '۷ روز بعد'}
          </button>
          <button
            type="button"
            onClick={() => handleAddNextDays(14)}
            className="px-2 py-0.5 rounded-lg bg-stone-900 hover:bg-stone-800 text-stone-300 hover:text-indigo-400 border border-stone-800 text-[11px] transition-colors cursor-pointer"
          >
            {isEn ? '+14 Days' : '۱۴ روز بعد'}
          </button>
        </div>

        {selectedDates.length > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="flex items-center gap-1 text-[11px] text-rose-400 hover:text-rose-300 px-2 py-0.5 rounded-lg hover:bg-rose-500/10 transition-colors cursor-pointer"
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
                    className="p-0.5 rounded hover:bg-indigo-500/30 text-indigo-400 hover:text-white cursor-pointer"
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

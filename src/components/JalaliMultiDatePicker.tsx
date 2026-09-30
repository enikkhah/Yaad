import React, { useState } from 'react';
import { 
  PERSIAN_MONTHS, 
  toPersianDigits, 
  getDaysInJalaliMonth, 
  getJalaliWeekdayIndex, 
  getJalaliComponents 
} from '../utils/jalali';
import { PERSIAN_WEEK_DAYS } from '../utils/recurrence';
import { ChevronRight, ChevronLeft, Calendar as CalendarIcon, Check, X, RotateCcw } from 'lucide-react';

interface JalaliMultiDatePickerProps {
  selectedDates: string[]; // array of "YYYY/MM/DD"
  onChange: (dates: string[]) => void;
  baseYear?: number;
  baseMonth?: number;
}

export const JalaliMultiDatePicker: React.FC<JalaliMultiDatePickerProps> = ({
  selectedDates,
  onChange,
  baseYear,
  baseMonth,
}) => {
  const currentJalali = getJalaliComponents(Date.now());
  const [viewYear, setViewYear] = useState<number>(baseYear || currentJalali.year);
  const [viewMonth, setViewMonth] = useState<number>(baseMonth || currentJalali.month);

  const daysInMonth = getDaysInJalaliMonth(viewYear, viewMonth);
  const startWeekday = getJalaliWeekdayIndex(viewYear, viewMonth, 1); // 0=شنبه, ..., 6=جمعه

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
    onChange(Array.from(datesSet).sort());
  };

  return (
    <div className="bg-stone-950/95 border border-stone-800 rounded-2xl p-3 sm:p-4 space-y-3">
      {/* Calendar Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarIcon className="w-4 h-4 text-amber-400" />
          <span className="font-extrabold text-sm text-stone-200">
            {PERSIAN_MONTHS[viewMonth - 1]} {toPersianDigits(viewYear)}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handlePrevMonth}
            className="p-1.5 rounded-lg bg-stone-900 hover:bg-stone-800 text-stone-300 hover:text-amber-400 border border-stone-800 transition-colors"
            title="ماه قبل"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleNextMonth}
            className="p-1.5 rounded-lg bg-stone-900 hover:bg-stone-800 text-stone-300 hover:text-amber-400 border border-stone-800 transition-colors"
            title="ماه بعد"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Weekday headers (ش تا ج) */}
      <div className="grid grid-cols-7 gap-1 text-center border-b border-stone-800 pb-1.5">
        {PERSIAN_WEEK_DAYS.map((w) => (
          <span
            key={w.index}
            className={`text-xs font-bold ${w.index === 6 ? 'text-rose-400' : 'text-stone-400'}`}
          >
            {w.short}
          </span>
        ))}
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
          const isToday =
            viewYear === currentJalali.year &&
            viewMonth === currentJalali.month &&
            day === currentJalali.day;

          const weekdayIndex = (startWeekday + i) % 7;
          const isFriday = weekdayIndex === 6;

          return (
            <button
              key={day}
              type="button"
              onClick={() => toggleDay(day)}
              className={`h-8 sm:h-9 rounded-xl flex items-center justify-center font-mono font-bold text-xs sm:text-sm transition-all relative active:scale-95 cursor-pointer ${
                isSelected
                  ? 'bg-amber-600 text-white font-black shadow-md shadow-amber-600/30 ring-2 ring-amber-400'
                  : isToday
                  ? 'border border-amber-400/80 text-amber-300 bg-amber-500/10 hover:bg-amber-500/20'
                  : isFriday
                  ? 'text-rose-400 hover:bg-stone-800/80'
                  : 'text-stone-300 hover:bg-stone-800/80 hover:text-white'
              }`}
            >
              <span>{toPersianDigits(day)}</span>
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
          <span className="text-[11px] text-stone-400">انتخاب سریع:</span>
          <button
            type="button"
            onClick={() => handleAddNextDays(7)}
            className="px-2 py-0.5 rounded-lg bg-stone-900 hover:bg-stone-800 text-stone-300 hover:text-amber-400 border border-stone-800 text-[11px] transition-colors"
          >
            ۷ روز بعد
          </button>
          <button
            type="button"
            onClick={() => handleAddNextDays(14)}
            className="px-2 py-0.5 rounded-lg bg-stone-900 hover:bg-stone-800 text-stone-300 hover:text-amber-400 border border-stone-800 text-[11px] transition-colors"
          >
            ۱۴ روز بعد
          </button>
        </div>

        {selectedDates.length > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="flex items-center gap-1 text-[11px] text-rose-400 hover:text-rose-300 px-2 py-0.5 rounded-lg hover:bg-rose-500/10 transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            <span>پاک کردن همه ({toPersianDigits(selectedDates.length)})</span>
          </button>
        )}
      </div>

      {/* Selected dates tags preview */}
      {selectedDates.length > 0 && (
        <div className="space-y-1.5 pt-2 border-t border-stone-800/80">
          <div className="flex items-center justify-between text-[11px] text-stone-400 font-medium">
            <span>روزهای انتخاب شده ({toPersianDigits(selectedDates.length)} روز):</span>
          </div>
          <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto p-1 rounded-xl bg-stone-900/60 border border-stone-800/60">
            {selectedDates.map((dateStr) => {
              const parts = dateStr.split('/');
              const mIdx = parseInt(parts[1], 10) - 1;
              const display = `${toPersianDigits(parseInt(parts[2], 10))} ${PERSIAN_MONTHS[mIdx]}`;
              return (
                <span
                  key={dateStr}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[11px] font-bold"
                >
                  <span>{display}</span>
                  <button
                    type="button"
                    onClick={() => removeDate(dateStr)}
                    className="p-0.5 rounded hover:bg-amber-500/30 text-amber-400 hover:text-white"
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

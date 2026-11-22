import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, Calendar as CalendarIcon } from 'lucide-react';
import {
  PERSIAN_MONTHS,
  GREGORIAN_MONTHS,
  GREGORIAN_MONTHS_SHORT,
  toPersianDigits,
  getDaysInJalaliMonth,
  getDaysInGregorianMonth,
  getJalaliWeekdayIndex,
  getGregorianSundayWeekdayIndex,
  getJalaliComponents,
  getGregorianComponents,
  JALALI_WEEKDAYS_HEADER,
  GREGORIAN_WEEKDAYS_SUNDAY_FIRST,
  getCalendarDayHolidayInfo,
  getMonthOfficialHolidays,
  jalaliToGregorian,
} from '../utils/jalali';

const JALALI_FUTURE_YEARS = Array.from({ length: 1425 - 1404 + 1 }, (_, i) => 1404 + i);
const GREGORIAN_FUTURE_YEARS = Array.from({ length: 2046 - 2025 + 1 }, (_, i) => 2025 + i);

interface YaadCalendarPickerProps {
  year: number;
  month: number;
  day: number;
  onSelectDate: (year: number, month: number, day: number) => void;
  language?: 'fa' | 'en';
  disablePast?: boolean;
  timeLabel?: string;
  onTimeClick?: () => void;
  secondaryLabel?: string;
  yearMode?: 'future' | 'past';
  hasStartingYear?: boolean;
  onSelectYear?: (year: number) => void;
  onToggleAnnualOnly?: () => void;
  selectedCircleClass?: string;
  compactHeaderLabel?: string;
}

interface CalendarCell {
  year: number;
  month: number;
  day: number;
  isCurrentMonth: boolean;
}

export const YaadCalendarPicker: React.FC<YaadCalendarPickerProps> = ({
  year,
  month,
  day,
  onSelectDate,
  language = 'fa',
  disablePast = false,
  timeLabel,
  onTimeClick,
  secondaryLabel,
  yearMode = 'future',
  hasStartingYear = true,
  onSelectYear,
  onToggleAnnualOnly,
  selectedCircleClass,
  compactHeaderLabel,
}) => {
  const isEn = language === 'en';
  const nowDate = new Date();
  const nowJalali = getJalaliComponents(nowDate.getTime());
  const nowGregorian = getGregorianComponents(nowDate.getTime());
  const curYear = isEn ? nowGregorian.year : nowJalali.year;
  const curMonth = isEn ? nowGregorian.month : nowJalali.month;
  const curDay = isEn ? nowGregorian.day : nowJalali.day;

  const [viewYear, setViewYear] = useState<number>(year || curYear);
  const [viewMonth, setViewMonth] = useState<number>(month || curMonth);
  const [pickerView, setPickerView] = useState<'calendar' | 'monthYear'>('calendar');
  const [customYearInput, setCustomYearInput] = useState<string>('');

  // Keep calendar month/year synced when external date changes (e.g., quick preset buttons or edit open)
  useEffect(() => {
    if (year > 0) setViewYear(year);
    if (month >= 1 && month <= 12) setViewMonth(month);
  }, [year, month]);

  const getDaysInMonth = (y: number, m: number) =>
    isEn ? getDaysInGregorianMonth(y, m) : getDaysInJalaliMonth(y, m);

  const daysInViewMonth = getDaysInMonth(viewYear, viewMonth);
  const startWeekday = isEn
    ? getGregorianSundayWeekdayIndex(viewYear, viewMonth, 1)
    : getJalaliWeekdayIndex(viewYear, viewMonth, 1);

  const prevMonth = viewMonth === 1 ? 12 : viewMonth - 1;
  const prevMonthYear = viewMonth === 1 ? viewYear - 1 : viewYear;
  const daysInPrevMonth = getDaysInMonth(prevMonthYear, prevMonth);

  const nextMonth = viewMonth === 12 ? 1 : viewMonth + 1;
  const nextMonthYear = viewMonth === 12 ? viewYear + 1 : viewYear;

  // Build continuous 42-cell (6 rows x 7 columns) calendar grid
  const cells: CalendarCell[] = [];
  for (let i = startWeekday - 1; i >= 0; i--) {
    cells.push({
      year: prevMonthYear,
      month: prevMonth,
      day: daysInPrevMonth - i,
      isCurrentMonth: false,
    });
  }
  for (let d = 1; d <= daysInViewMonth; d++) {
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

  const canGoPrevMonth = !disablePast || viewYear > curYear || (viewYear === curYear && viewMonth > curMonth);

  const handlePrevMonth = () => {
    if (!canGoPrevMonth) return;
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

  // Summary Pill Text (matching screenshot "Sun, Nov 22" in EN or "یکشنبه، ۲ آذر ۱۴۰۵" in FA)
  const getSummaryDateText = (): string => {
    const safeDay = Math.min(day, getDaysInMonth(year || curYear, month));
    if (isEn) {
      const targetYear = year || curYear;
      const dObj = new Date(targetYear, month - 1, safeDay, 12, 0, 0);
      const shortWeekday = dObj.toLocaleDateString('en-US', { weekday: 'short' });
      const shortMonth = GREGORIAN_MONTHS_SHORT[month - 1] || '';
      if (yearMode === 'past' && !hasStartingYear) {
        return `${shortMonth} ${safeDay}`;
      }
      const yearSuffix = targetYear !== curYear ? `, ${targetYear}` : '';
      return `${shortWeekday}, ${shortMonth} ${safeDay}${yearSuffix}`;
    } else {
      const targetYear = year || curYear;
      const [gy, gm, gd] = jalaliToGregorian(targetYear, month, safeDay);
      const dObj = new Date(gy, gm - 1, gd, 12, 0, 0);
      const weekdayFa = JALALI_WEEKDAYS_HEADER[(dObj.getDay() + 1) % 7]?.full || '';
      const monthNameFa = PERSIAN_MONTHS[month - 1] || '';
      if (yearMode === 'past' && !hasStartingYear) {
        return `${toPersianDigits(safeDay)} ${monthNameFa}`;
      }
      const yearSuffix = targetYear !== curYear ? ` ${toPersianDigits(targetYear)}` : '';
      return `${weekdayFa}، ${toPersianDigits(safeDay)} ${monthNameFa}${yearSuffix}`;
    }
  };

  const monthHolidays = getMonthOfficialHolidays(viewYear, viewMonth, language);
  const clampedDay = Math.min(day, getDaysInMonth(year || curYear, month));
  const selectedDayHoliday = getCalendarDayHolidayInfo(year || curYear, month, clampedDay, language);

  const yearsGridList =
    yearMode === 'past'
      ? Array.from({ length: 35 }, (_, i) => curYear - i)
      : isEn
      ? GREGORIAN_FUTURE_YEARS
      : JALALI_FUTURE_YEARS;

  const minCustomYear = yearMode === 'past' ? (isEn ? 1900 : 1300) : isEn ? 2047 : 1426;
  const maxCustomYear = yearMode === 'past' ? curYear : isEn ? 2200 : 1600;

  return (
    <div
      className="p-3 sm:p-4 rounded-2xl bg-stone-950/90 border border-stone-800 space-y-3"
      dir={isEn ? 'ltr' : 'rtl'}
    >
      {/* Top Optional Header Label */}
      {compactHeaderLabel && (
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-stone-400">
          <CalendarIcon className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
          <span>{compactHeaderLabel}</span>
        </div>
      )}

      {/* Row 1: Summary Pill + Divider + Time/Secondary Readout (matches screenshot "Sun, Nov 22 | 10:00") */}
      <div className="flex items-center justify-center sm:justify-start gap-2.5 flex-wrap">
        <button
          type="button"
          onClick={() => {
            setViewYear(year || curYear);
            setViewMonth(month);
            setPickerView('calendar');
          }}
          className="px-4 py-1.5 rounded-full bg-stone-800 hover:bg-stone-700 border border-stone-700/80 text-white font-black text-xs sm:text-sm shadow-sm transition-all cursor-pointer active:scale-95"
          title={isEn ? 'Jump to selected date' : 'نمایش تاریخ انتخاب‌شده'}
        >
          {getSummaryDateText()}
        </button>

        {(timeLabel || secondaryLabel) && (
          <>
            <span className="text-stone-600 text-base font-light select-none">|</span>
            {timeLabel && (
              <button
                type="button"
                onClick={onTimeClick}
                className={`px-2 py-1 rounded-xl text-sm sm:text-base font-black text-white tracking-wide transition-colors ${
                  onTimeClick ? 'hover:bg-stone-800/80 cursor-pointer' : 'cursor-default'
                }`}
              >
                {isEn ? timeLabel : toPersianDigits(timeLabel)}
              </button>
            )}
            {secondaryLabel && (
              <span className="text-xs font-extrabold text-stone-300 px-2 py-0.5 rounded-lg bg-stone-900 border border-stone-800">
                {secondaryLabel}
              </span>
            )}
          </>
        )}
      </div>

      {/* Row 2: < Month Year > Navigation Header */}
      <div className="flex items-center justify-between pt-0.5 px-1">
        <button
          type="button"
          disabled={pickerView === 'calendar' && !canGoPrevMonth}
          onClick={() => {
            if (pickerView === 'monthYear') {
              setViewYear((y) => (yearMode === 'past' ? Math.max(minCustomYear, y - 1) : y - 1));
            } else {
              handlePrevMonth();
            }
          }}
          className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${
            pickerView === 'calendar' && !canGoPrevMonth
              ? 'text-stone-600 opacity-35 cursor-not-allowed'
              : 'text-stone-200 hover:bg-stone-800 hover:text-white cursor-pointer active:scale-90'
          }`}
          title={isEn ? 'Previous month' : 'ماه قبل'}
        >
          {isEn ? <ChevronLeft className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
        </button>

        <button
          type="button"
          onClick={() => setPickerView((prev) => (prev === 'calendar' ? 'monthYear' : 'calendar'))}
          className="px-3 py-1.5 rounded-xl hover:bg-stone-900 text-stone-100 font-black text-sm sm:text-base flex items-center gap-1.5 transition-colors cursor-pointer"
          title={isEn ? 'Select month or year' : 'انتخاب سریع ماه و سال'}
        >
          <span>
            {isEn
              ? yearMode === 'past' && !hasStartingYear
                ? `${GREGORIAN_MONTHS[viewMonth - 1]}`
                : `${GREGORIAN_MONTHS[viewMonth - 1]} ${viewYear}`
              : yearMode === 'past' && !hasStartingYear
              ? `${PERSIAN_MONTHS[viewMonth - 1]}`
              : `${PERSIAN_MONTHS[viewMonth - 1]} ${toPersianDigits(viewYear)}`}
          </span>
          <ChevronDown
            className={`w-4 h-4 text-stone-400 transition-transform duration-200 ${
              pickerView === 'monthYear' ? 'rotate-180 text-indigo-400' : ''
            }`}
          />
        </button>

        <button
          type="button"
          onClick={() => {
            if (pickerView === 'monthYear') {
              setViewYear((y) => (yearMode === 'past' ? Math.min(curYear, y + 1) : y + 1));
            } else {
              handleNextMonth();
            }
          }}
          className="w-9 h-9 rounded-full flex items-center justify-center text-stone-200 hover:bg-stone-800 hover:text-white transition-all cursor-pointer active:scale-90"
          title={isEn ? 'Next month' : 'ماه بعد'}
        >
          {isEn ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
        </button>
      </div>

      {/* View Mode A: Continuous 6-Week Calendar Grid (Matches User Screenshot) */}
      {pickerView === 'calendar' ? (
        <div className="space-y-2 animate-in fade-in duration-150">
          {/* Weekday Headers */}
          <div className="grid grid-cols-7 text-center pb-1">
            {(isEn ? GREGORIAN_WEEKDAYS_SUNDAY_FIRST : JALALI_WEEKDAYS_HEADER).map((w) => (
              <div
                key={w.index}
                title={w.full}
                className={`py-1 text-[10px] sm:text-[11px] font-bold tracking-wider ${
                  w.isWeekend
                    ? isEn
                      ? 'text-indigo-400'
                      : 'text-rose-400'
                    : 'text-stone-400'
                }`}
              >
                {w.short}
              </div>
            ))}
          </div>

          {/* 42-Cell Continuous Day Grid */}
          <div className="grid grid-cols-7 gap-y-1 text-center">
            {cells.map((cell) => {
              const isPastCell =
                disablePast &&
                (cell.year < curYear ||
                  (cell.year === curYear && cell.month < curMonth) ||
                  (cell.year === curYear && cell.month === curMonth && cell.day < curDay));

              const isSelected =
                yearMode === 'past' && !hasStartingYear
                  ? cell.month === month && cell.day === clampedDay && cell.isCurrentMonth
                  : cell.year === year && cell.month === month && cell.day === clampedDay;

              const isToday =
                cell.year === curYear && cell.month === curMonth && cell.day === curDay;

              const holidayInfo = getCalendarDayHolidayInfo(cell.year, cell.month, cell.day, language);

              const handleCellClick = () => {
                if (isPastCell) return;
                setViewYear(cell.year);
                setViewMonth(cell.month);
                if (onSelectYear && (yearMode === 'future' || hasStartingYear)) {
                  onSelectYear(cell.year);
                }
                onSelectDate(cell.year, cell.month, cell.day);
              };

              let cellColorClass = '';
              if (isSelected) {
                cellColorClass = selectedCircleClass
                  ? `${selectedCircleClass} font-black`
                  : 'bg-indigo-600 text-white font-black shadow-md';
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
                    disabled={isPastCell}
                    onClick={handleCellClick}
                    title={
                      isPastCell
                        ? isEn
                          ? 'Past date cannot be selected'
                          : 'تاریخ گذشته قابل انتخاب نیست'
                        : holidayInfo.occasionTitle
                        ? `${isEn ? 'Official Holiday:' : 'تعطیل رسمی:'} ${holidayInfo.occasionTitle}`
                        : holidayInfo.isWeekend
                        ? isEn
                          ? 'Weekend'
                          : 'تعطیل آخر هفته'
                        : undefined
                    }
                    className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex flex-col items-center justify-center text-xs sm:text-sm transition-all relative ${
                      isPastCell ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer active:scale-90'
                    } ${cellColorClass}`}
                  >
                    <span className="leading-none">{isEn ? cell.day : toPersianDigits(cell.day)}</span>
                    {holidayInfo.isOfficialHoliday && cell.isCurrentMonth && !isSelected && !isPastCell && (
                      <span className="w-1 h-1 rounded-full bg-rose-400 mt-0.5" />
                    )}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Official Occasion Holiday Details (compact, preserves Iranian holiday info) */}
          {(selectedDayHoliday.occasionTitle || monthHolidays.length > 0) && (
            <div className="pt-2 border-t border-stone-800/80 space-y-1.5 text-[11px]">
              {selectedDayHoliday.occasionTitle && (
                <div className="text-rose-300 font-bold flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0" />
                  <span>
                    {isEn
                      ? `Selected day: ${selectedDayHoliday.occasionTitle}`
                      : `مناسبت روز انتخابی: ${selectedDayHoliday.occasionTitle}`}
                  </span>
                </div>
              )}
              {monthHolidays.length > 0 && (
                <div className="p-2 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-200 leading-relaxed">
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
              )}
            </div>
          )}
        </div>
      ) : (
        /* View Mode B: Quick Month & Year Selector when tapping Month/Year title */
        <div className="space-y-3 pt-1 animate-in fade-in duration-150">
          {/* Month Grid */}
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
            {(isEn ? GREGORIAN_MONTHS : PERSIAN_MONTHS).map((mName, idx) => {
              const monthNum = idx + 1;
              const isSelectedMonth = viewMonth === monthNum;
              const isPastMonth =
                disablePast && (viewYear < curYear || (viewYear === curYear && monthNum < curMonth));
              return (
                <button
                  key={mName}
                  type="button"
                  disabled={isPastMonth}
                  onClick={() => {
                    if (isPastMonth) return;
                    const maxD = getDaysInMonth(viewYear, monthNum);
                    let nextD = Math.min(day, maxD);
                    if (disablePast && viewYear === curYear && monthNum === curMonth && nextD < curDay) {
                      nextD = curDay;
                    }
                    setViewMonth(monthNum);
                    onSelectDate(viewYear, monthNum, nextD);
                    setPickerView('calendar');
                  }}
                  className={`py-2 px-1 rounded-xl text-xs font-bold transition-all text-center border ${
                    isPastMonth
                      ? 'bg-stone-950/40 text-stone-600 border-stone-900 opacity-40 cursor-not-allowed'
                      : isSelectedMonth
                      ? selectedCircleClass
                        ? `${selectedCircleClass} font-black`
                        : 'bg-indigo-600 border-indigo-400 text-white font-black'
                      : 'bg-stone-900/80 hover:bg-stone-800 text-stone-300 hover:text-white border-stone-800 cursor-pointer'
                  }`}
                >
                  {mName}
                </button>
              );
            })}
          </div>

          {/* Year Grid */}
          <div className="pt-2 border-t border-stone-800/80 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold text-stone-400">
                {yearMode === 'past'
                  ? isEn
                    ? 'Select Year'
                    : 'انتخاب سال مبدأ'
                  : isEn
                  ? 'Select Year'
                  : 'انتخاب سال'}
              </span>
              {yearMode === 'past' && hasStartingYear && onToggleAnnualOnly && (
                <button
                  type="button"
                  onClick={() => {
                    onToggleAnnualOnly();
                    setPickerView('calendar');
                  }}
                  className="px-2.5 py-0.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 text-[10.5px] font-bold cursor-pointer"
                >
                  {isEn ? 'Annual Only (No Year)' : 'بدون سال مبدأ (فقط سالانه)'}
                </button>
              )}
            </div>

            <div className="grid grid-cols-4 sm:grid-cols-5 gap-1.5 max-h-36 overflow-y-auto no-scrollbar p-0.5">
              {yearsGridList.map((yr) => {
                const isSelectedYear =
                  yearMode === 'past' ? hasStartingYear && viewYear === yr : viewYear === yr;
                const isPastYear = disablePast && yr < curYear;
                return (
                  <button
                    key={yr}
                    type="button"
                    disabled={isPastYear}
                    onClick={() => {
                      if (isPastYear) return;
                      let nextM = viewMonth;
                      let nextD = Math.min(day, getDaysInMonth(yr, nextM));
                      if (disablePast && yr === curYear) {
                        if (nextM < curMonth) {
                          nextM = curMonth;
                          nextD = curDay;
                        } else if (nextM === curMonth && nextD < curDay) {
                          nextD = curDay;
                        }
                      }
                      setViewYear(yr);
                      setViewMonth(nextM);
                      onSelectYear?.(yr);
                      onSelectDate(yr, nextM, nextD);
                      setPickerView('calendar');
                    }}
                    className={`py-1.5 px-1 rounded-xl text-xs font-mono font-bold transition-all text-center border ${
                      isPastYear
                        ? 'bg-stone-950/40 text-stone-600 border-stone-900 opacity-40 cursor-not-allowed'
                        : isSelectedYear
                        ? selectedCircleClass
                          ? `${selectedCircleClass} font-black`
                          : 'bg-indigo-600 border-indigo-400 text-white font-black'
                        : 'bg-stone-900/80 hover:bg-stone-800 text-stone-300 hover:text-white border-stone-800 cursor-pointer'
                    }`}
                  >
                    {isEn ? yr : toPersianDigits(yr)}
                  </button>
                );
              })}
            </div>

            {/* Custom Year Typing Input */}
            <div className="flex items-center gap-2 pt-1">
              <input
                type="number"
                min={minCustomYear}
                max={maxCustomYear}
                value={customYearInput}
                onChange={(e) => setCustomYearInput(e.target.value)}
                placeholder={
                  yearMode === 'past'
                    ? isEn
                      ? 'Type year (e.g. 1990)'
                      : 'تایپ سال (مثلاً ۱۳۶۵)...'
                    : isEn
                    ? 'Higher year (e.g. 2050)'
                    : 'سال بالاتر از ۱۴۲۵ (مثلاً ۱۴۳۰)...'
                }
                className="flex-1 bg-stone-900 border border-stone-700 rounded-xl px-3 py-2 text-xs text-white placeholder-stone-500 focus:outline-none focus:border-indigo-500 font-mono"
              />
              <button
                type="button"
                onClick={() => {
                  const val = parseInt(customYearInput, 10);
                  if (!isNaN(val) && val >= minCustomYear && val <= maxCustomYear) {
                    const maxD = getDaysInMonth(val, viewMonth);
                    setViewYear(val);
                    onSelectYear?.(val);
                    onSelectDate(val, viewMonth, Math.min(day, maxD));
                    setPickerView('calendar');
                  }
                }}
                disabled={
                  !customYearInput ||
                  isNaN(parseInt(customYearInput, 10)) ||
                  parseInt(customYearInput, 10) < minCustomYear ||
                  parseInt(customYearInput, 10) > maxCustomYear
                }
                className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-bold text-xs cursor-pointer active:scale-95 transition-all"
              >
                {isEn ? 'Apply' : 'ثبت'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

import { Reminder, RecurrenceType } from '../types';
import { AppLanguage } from './i18n';
import { 
  getJalaliComponents, 
  jalaliToTimestamp, 
  toPersianDigits, 
  PERSIAN_MONTHS, 
  getDaysInJalaliMonth,
  getJalaliWeekdayIndex 
} from './jalali';

export interface RecurrenceOptionMeta {
  id: RecurrenceType;
  label: string;
  labelEn: string;
  desc: string;
  descEn: string;
}

export const RECURRENCE_OPTIONS: RecurrenceOptionMeta[] = [
  { id: 'none', label: 'بدون تکرار', labelEn: 'No Recurrence', desc: 'یکباره', descEn: 'Once' },
  { id: 'hourly', label: 'ساعتی', labelEn: 'Hourly', desc: 'هر چند ساعت یک‌بار', descEn: 'Every X hours' },
  { id: 'daily', label: 'روزانه', labelEn: 'Daily', desc: 'هر روز در این ساعت', descEn: 'Every day' },
  { id: 'weekly', label: 'هفتگی', labelEn: 'Weekly', desc: 'روزهای مشخص هفته', descEn: 'Specific days of week' },
  { id: 'monthly', label: 'ماهیانه', labelEn: 'Monthly', desc: 'هر ماه در این روز', descEn: 'Every month' },
  { id: 'custom_dates', label: 'انتخاب از تقویم', labelEn: 'Calendar Dates', desc: 'روزهای منتخب تقویم', descEn: 'Selected dates' },
];

export const PERSIAN_WEEK_DAYS = [
  { index: 0, short: 'ش', name: 'شنبه' },
  { index: 1, short: 'ی', name: 'یکشنبه' },
  { index: 2, short: 'د', name: 'دوشنبه' },
  { index: 3, short: 'س', name: 'سه‌شنبه' },
  { index: 4, short: 'چ', name: 'چهارشنبه' },
  { index: 5, short: 'پ', name: 'پنج‌شنبه' },
  { index: 6, short: 'ج', name: 'جمعه' },
];

export const ENGLISH_WEEK_DAYS = [
  { index: 0, short: 'Sat', name: 'Saturday' },
  { index: 1, short: 'Sun', name: 'Sunday' },
  { index: 2, short: 'Mon', name: 'Monday' },
  { index: 3, short: 'Tue', name: 'Tuesday' },
  { index: 4, short: 'Wed', name: 'Wednesday' },
  { index: 5, short: 'Thu', name: 'Thursday' },
  { index: 6, short: 'Fri', name: 'Friday' },
];

export const HOURLY_INTERVALS = [1, 2, 3, 4, 6, 8, 12];

/**
 * Returns human-readable label for the reminder's recurrence
 */
export function getRecurrenceLabel(reminder: Reminder, language: AppLanguage = 'fa'): string {
  const isEn = language === 'en';

  if (!reminder.recurrence || reminder.recurrence === 'none') {
    return isEn ? 'Once' : 'یکباره';
  }

  switch (reminder.recurrence) {
    case 'hourly': {
      const interval = reminder.recurrenceInterval || 1;
      if (isEn) {
        return interval === 1 ? 'Hourly' : `Every ${interval} hrs`;
      }
      return interval === 1 ? 'تکرار ساعتی' : `هر ${toPersianDigits(interval)} ساعت`;
    }
    case 'daily':
      return isEn ? 'Daily' : 'تکرار روزانه';
    case 'weekly': {
      const days = reminder.recurrenceDaysOfWeek || [];
      if (days.length === 0 || days.length === 7) {
        return isEn ? 'Every day' : 'تکرار هر روز هفته';
      }
      if (isEn) {
        const names = days
          .sort((a, b) => a - b)
          .map((idx) => ENGLISH_WEEK_DAYS.find((d) => d.index === idx)?.short || '')
          .filter(Boolean);
        return `Weekly (${names.join(', ')})`;
      }
      const names = days
        .sort((a, b) => a - b)
        .map((idx) => PERSIAN_WEEK_DAYS.find((d) => d.index === idx)?.short || '')
        .filter(Boolean);
      return `هفتگی (${names.join('، ')})`;
    }
    case 'monthly':
      return isEn ? 'Monthly' : 'تکرار ماهیانه';
    case 'custom_dates': {
      const count = reminder.recurrenceCustomDates?.length || 0;
      if (isEn) {
        return count > 0 ? `Calendar (${count} days)` : 'Calendar';
      }
      return count > 0 ? `تقویمی (${toPersianDigits(count)} روز)` : 'تقویمی';
    }
    default:
      return isEn ? 'Recurring' : 'تکرار';
  }
}

/**
 * Calculates the next occurrence timestamp after referenceTime (defaults to now)
 */
export function getNextRecurrenceTimestamp(
  reminder: Reminder,
  referenceTime: number = Date.now()
): number | null {
  if (!reminder.recurrence || reminder.recurrence === 'none') {
    return null;
  }

  const { hour, minute, day, month, year } = getJalaliComponents(reminder.dueTimestamp);

  switch (reminder.recurrence) {
    case 'hourly': {
      const intervalHours = reminder.recurrenceInterval || 1;
      const intervalMs = intervalHours * 3600 * 1000;
      let nextTs = reminder.dueTimestamp;
      while (nextTs <= referenceTime) {
        nextTs += intervalMs;
      }
      return nextTs;
    }

    case 'daily': {
      // Find the next day where time (hour, minute) is > referenceTime
      const refComp = getJalaliComponents(referenceTime);
      let targetYear = refComp.year;
      let targetMonth = refComp.month;
      let targetDay = refComp.day;

      let candidate = jalaliToTimestamp(targetYear, targetMonth, targetDay, hour, minute);
      if (candidate <= referenceTime) {
        // Advance 1 day in Jalali calendar
        targetDay += 1;
        const maxDays = getDaysInJalaliMonth(targetYear, targetMonth);
        if (targetDay > maxDays) {
          targetDay = 1;
          targetMonth += 1;
          if (targetMonth > 12) {
            targetMonth = 1;
            targetYear += 1;
          }
        }
        candidate = jalaliToTimestamp(targetYear, targetMonth, targetDay, hour, minute);
      }
      return candidate;
    }

    case 'weekly': {
      let allowedDays = reminder.recurrenceDaysOfWeek;
      if (!allowedDays || allowedDays.length === 0) {
        const curWeekday = getJalaliWeekdayIndex(year, month, day);
        allowedDays = [curWeekday];
      }

      // Check next 28 days for the earliest matching day
      const refComp = getJalaliComponents(referenceTime);
      let curYear = refComp.year;
      let curMonth = refComp.month;
      let curDay = refComp.day;

      for (let offset = 0; offset <= 28; offset++) {
        const candidate = jalaliToTimestamp(curYear, curMonth, curDay, hour, minute);
        const weekdayIdx = getJalaliWeekdayIndex(curYear, curMonth, curDay);

        if (allowedDays.includes(weekdayIdx) && candidate > referenceTime) {
          return candidate;
        }

        // Advance one day
        curDay += 1;
        const maxDays = getDaysInJalaliMonth(curYear, curMonth);
        if (curDay > maxDays) {
          curDay = 1;
          curMonth += 1;
          if (curMonth > 12) {
            curMonth = 1;
            curYear += 1;
          }
        }
      }
      return null;
    }

    case 'monthly': {
      // Next month on the same day (or max day of that month)
      const refComp = getJalaliComponents(referenceTime);
      let targetYear = refComp.year;
      let targetMonth = refComp.month;

      const maxDaysThisMonth = getDaysInJalaliMonth(targetYear, targetMonth);
      const clampedDay = Math.min(day, maxDaysThisMonth);
      let candidate = jalaliToTimestamp(targetYear, targetMonth, clampedDay, hour, minute);

      if (candidate <= referenceTime) {
        targetMonth += 1;
        if (targetMonth > 12) {
          targetMonth = 1;
          targetYear += 1;
        }
        const maxDaysNextMonth = getDaysInJalaliMonth(targetYear, targetMonth);
        const nextClampedDay = Math.min(day, maxDaysNextMonth);
        candidate = jalaliToTimestamp(targetYear, targetMonth, nextClampedDay, hour, minute);
      }
      return candidate;
    }

    case 'custom_dates': {
      if (!reminder.recurrenceCustomDates || reminder.recurrenceCustomDates.length === 0) {
        return null;
      }

      // recurrenceCustomDates are in "YYYY/MM/DD" format
      const validTimestamps: number[] = [];
      for (const dateStr of reminder.recurrenceCustomDates) {
        const parts = dateStr.split('/').map((p) => parseInt(p, 10));
        if (parts.length === 3) {
          const [y, m, d] = parts;
          const ts = jalaliToTimestamp(y, m, d, hour, minute);
          if (ts > referenceTime) {
            validTimestamps.push(ts);
          }
        }
      }

      if (validTimestamps.length === 0) {
        return null;
      }

      validTimestamps.sort((a, b) => a - b);
      return validTimestamps[0];
    }

    default:
      return null;
  }
}

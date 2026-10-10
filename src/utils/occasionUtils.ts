import { Occasion, OccasionType, Reminder } from '../types';
import { 
  getJalaliComponents, 
  jalaliToTimestamp, 
  toPersianDigits, 
  PERSIAN_MONTHS, 
  getDaysInJalaliMonth 
} from './jalali';

export const OCCASIONS_STORAGE_KEY = 'yaad_occasions_data';

export interface OccasionTypeMeta {
  type: OccasionType;
  labelFa: string;
  labelEn: string;
  iconName: string;
  badgeBg: string;
  badgeText: string;
  borderCol: string;
  defaultTime: string;
}

export const OCCASION_TYPES: OccasionTypeMeta[] = [
  {
    type: 'birthday',
    labelFa: 'تولد',
    labelEn: 'Birthday',
    iconName: 'Cake',
    badgeBg: 'bg-rose-500/15',
    badgeText: 'text-rose-400',
    borderCol: 'border-rose-500/30',
    defaultTime: '09:00',
  },
  {
    type: 'wedding',
    labelFa: 'سالگرد ازدواج',
    labelEn: 'Wedding Anniversary',
    iconName: 'HeartHandshake',
    badgeBg: 'bg-pink-500/15',
    badgeText: 'text-pink-400',
    borderCol: 'border-pink-500/30',
    defaultTime: '09:00',
  },
  {
    type: 'dating',
    labelFa: 'سالگرد آشنایی / دوستی',
    labelEn: 'Relationship Anniversary',
    iconName: 'Sparkles',
    badgeBg: 'bg-purple-500/15',
    badgeText: 'text-purple-400',
    borderCol: 'border-purple-500/30',
    defaultTime: '10:00',
  },
  {
    type: 'memorial',
    labelFa: 'سالگرد فوت عزیزان',
    labelEn: 'Memorial Day',
    iconName: 'Flame',
    badgeBg: 'bg-stone-500/15',
    badgeText: 'text-stone-300',
    borderCol: 'border-stone-500/30',
    defaultTime: '09:00',
  },
  {
    type: 'family',
    labelFa: 'مناسبت خانوادگی',
    labelEn: 'Family Occasion',
    iconName: 'Users',
    badgeBg: 'bg-emerald-500/15',
    badgeText: 'text-emerald-400',
    borderCol: 'border-emerald-500/30',
    defaultTime: '09:00',
  },
  {
    type: 'work',
    labelFa: 'مناسبت کاری و حرفه‌ای',
    labelEn: 'Work & Professional',
    iconName: 'Briefcase',
    badgeBg: 'bg-sky-500/15',
    badgeText: 'text-sky-400',
    borderCol: 'border-sky-500/30',
    defaultTime: '08:30',
  },
  {
    type: 'custom',
    labelFa: 'سایر مناسبت‌های مهم',
    labelEn: 'Custom Occasion',
    iconName: 'CalendarHeart',
    badgeBg: 'bg-amber-500/15',
    badgeText: 'text-amber-400',
    borderCol: 'border-amber-500/30',
    defaultTime: '09:00',
  },
];

export function getOccasionTypeMeta(type: OccasionType): OccasionTypeMeta {
  return OCCASION_TYPES.find((t) => t.type === type) || OCCASION_TYPES[OCCASION_TYPES.length - 1];
}

/**
 * Calculates next timestamp for the occasion, days remaining, and current anniversary turn (e.g., 25th birthday).
 */
export function calculateNextOccasionOccurrence(
  occasion: Occasion,
  referenceTimestamp = Date.now()
): {
  nextTimestamp: number;
  daysRemaining: number;
  occurrenceYear: number;
  yearsPassed: number | null;
  isToday: boolean;
  formattedTargetDate: string;
} {
  const currentJalali = getJalaliComponents(referenceTimestamp);
  const curYear = currentJalali.year;

  // Split hour and minute from notifyTime (default "09:00")
  let [hStr, mStr] = (occasion.notifyTime || '09:00').split(':');
  const hour = parseInt(hStr || '9', 10);
  const minute = parseInt(mStr || '0', 10);

  // Check this year
  const maxDaysThisYear = getDaysInJalaliMonth(curYear, occasion.solarMonth);
  const dayThisYear = Math.min(occasion.solarDay, maxDaysThisYear);
  const timestampThisYear = jalaliToTimestamp(curYear, occasion.solarMonth, dayThisYear, hour, minute);

  // If timestamp for this year has passed, next occurrence is next year
  let occurrenceYear = curYear;
  let nextTimestamp = timestampThisYear;

  // Consider "passed" if timestamp has passed today (past end of day or past notification moment)
  // To allow showing "امروز" if today is the day:
  const isDateToday = 
    currentJalali.month === occasion.solarMonth && 
    currentJalali.day === occasion.solarDay;

  if (nextTimestamp < referenceTimestamp && !isDateToday) {
    occurrenceYear = curYear + 1;
    const maxDaysNextYear = getDaysInJalaliMonth(occurrenceYear, occasion.solarMonth);
    const dayNextYear = Math.min(occasion.solarDay, maxDaysNextYear);
    nextTimestamp = jalaliToTimestamp(occurrenceYear, occasion.solarMonth, dayNextYear, hour, minute);
  }

  // Calculate days difference
  const oneDayMs = 24 * 60 * 60 * 1000;
  // Day boundaries calculation for clean day count
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const targetDateObj = new Date(nextTimestamp);
  targetDateObj.setHours(0, 0, 0, 0);
  const daysDiff = Math.round((targetDateObj.getTime() - todayStart.getTime()) / oneDayMs);
  const daysRemaining = Math.max(0, daysDiff);

  const yearsPassed = occasion.solarYear ? occurrenceYear - occasion.solarYear : null;

  const monthName = PERSIAN_MONTHS[occasion.solarMonth - 1] || 'فروردین';
  const formattedTargetDate = `${toPersianDigits(occasion.solarDay)} ${monthName}`;

  return {
    nextTimestamp,
    daysRemaining,
    occurrenceYear,
    yearsPassed,
    isToday: isDateToday,
    formattedTargetDate,
  };
}

/**
 * Returns a human-friendly description for the occasion
 * e.g. "تولد ۳۰ سالگی علی" or "پنجمین سالگرد ازدواج"
 */
export function getOccasionAnniversaryLabel(
  occasion: Occasion,
  yearsPassed: number | null,
  language: 'fa' | 'en' = 'fa'
): string {
  const isEn = language === 'en';
  if (yearsPassed === null || yearsPassed <= 0) {
    return occasion.title;
  }

  if (isEn) {
    if (occasion.type === 'birthday') return `${yearsPassed}th Birthday`;
    if (occasion.type === 'wedding') return `${yearsPassed}th Wedding Anniversary`;
    if (occasion.type === 'dating') return `${yearsPassed}th Anniversary`;
    if (occasion.type === 'memorial') return `${yearsPassed}th Memorial Anniversary`;
    return `${occasion.title} (${yearsPassed} years)`;
  }

  const yearsPersian = toPersianDigits(yearsPassed);
  switch (occasion.type) {
    case 'birthday':
      return occasion.personName 
        ? `تولد ${yearsPersian} سالگی ${occasion.personName}` 
        : `تولد ${yearsPersian} سالگی`;
    case 'wedding':
      return `${yearsPersian}مین سالگرد ازدواج`;
    case 'dating':
      return `${yearsPersian}مین سالگرد آشنایی`;
    case 'memorial':
      return `${yearsPersian}مین سالگرد درگذشت`;
    case 'family':
    case 'work':
    case 'custom':
    default:
      return `${yearsPersian}مین سالگرد ${occasion.title}`;
  }
}

/**
 * Generates an automatic Reminder object linked to an Occasion
 */
export function createReminderFromOccasion(
  occasion: Occasion,
  options?: {
    daysBefore?: number;
    referenceTimestamp?: number;
  }
): Omit<Reminder, 'id' | 'createdAt' | 'status' | 'postponeCount'> {
  const { nextTimestamp, yearsPassed, formattedTargetDate } = calculateNextOccasionOccurrence(
    occasion,
    options?.referenceTimestamp || Date.now()
  );

  const daysBefore = options?.daysBefore !== undefined ? options.daysBefore : occasion.notifyDaysBefore;
  
  // Calculate trigger timestamp (subtract daysBefore)
  const triggerTimestamp = nextTimestamp - (daysBefore * 24 * 60 * 60 * 1000);

  const annivLabel = getOccasionAnniversaryLabel(occasion, yearsPassed, 'fa');
  const whenLabel = daysBefore === 0 
    ? 'امروز' 
    : `${toPersianDigits(daysBefore)} روز مانده (${formattedTargetDate})`;

  const reminderTitle = `مناسبت: ${annivLabel} (${whenLabel})`;
  const reminderDesc = [
    occasion.customNote ? `یادداشت: ${occasion.customNote}` : '',
    occasion.personName ? `شخص: ${occasion.personName}` : '',
    `تاریخ اصلی: ${formattedTargetDate}`,
  ].filter(Boolean).join('\n');

  return {
    title: reminderTitle,
    description: reminderDesc,
    category: occasion.type === 'work' ? 'work' : 'family',
    priority: 'high',
    dueTimestamp: Math.max(Date.now() + 60000, triggerTimestamp),
    useFlash: true,
    ringTune: occasion.ringTune || 'family',
    voiceReadAloud: true,
    recurrence: 'none',
  };
}

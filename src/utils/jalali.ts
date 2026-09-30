/**
 * Persian (Jalali / Shamsi) calendar helpers and formatting
 */

export const PERSIAN_MONTHS = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
];

export const PERSIAN_DAYS = [
  'شنبه',
  'یکشنبه',
  'دوشنبه',
  'سه‌شنبه',
  'چهارشنبه',
  'پنج‌شنبه',
  'جمعه',
];

export function toPersianDigits(input: string | number): string {
  const farsiDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  return String(input).replace(/\d/g, (x) => farsiDigits[parseInt(x, 10)]);
}

export function fromPersianDigits(input: string): string {
  const farsiDigits = [/۰/g, /۱/g, /۲/g, /۳/g, /۴/g, /۵/g, /۶/g, /۷/g, /۸/g, /۹/g];
  const arabicDigits = [/٠/g, /١/g, /٢/g, /٣/g, /٤/g, /٥/g, /٦/g, /٧/g, /٨/g, /٩/g];
  let res = input;
  for (let i = 0; i < 10; i++) {
    res = res.replace(farsiDigits[i], String(i)).replace(arabicDigits[i], String(i));
  }
  return res;
}

/**
 * Gets Jalali date components for a given timestamp
 */
export function getJalaliComponents(timestamp: number): {
  year: number;
  month: number; // 1-12
  monthName: string;
  day: number;
  hour: number;
  minute: number;
  weekday: string;
  timeString: string;
  dateString: string;
} {
  const date = new Date(timestamp);

  // Using native Intl API for Persian Calendar
  const formatter = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const partObj: Record<string, string> = {};
  for (const part of parts) {
    partObj[part.type] = part.value;
  }

  // Parse numeric values from Persian digits
  const year = parseInt(fromPersianDigits(partObj.year || '1403'), 10);
  const month = parseInt(fromPersianDigits(partObj.month || '1'), 10);
  const day = parseInt(fromPersianDigits(partObj.day || '1'), 10);
  const hour = date.getHours();
  const minute = date.getMinutes();

  const monthName = PERSIAN_MONTHS[month - 1] || 'فروردین';
  const weekday = partObj.weekday || 'شنبه';

  const timeString = `${toPersianDigits(hour.toString().padStart(2, '0'))}:${toPersianDigits(minute.toString().padStart(2, '0'))}`;
  const dateString = `${toPersianDigits(day)} ${monthName} ${toPersianDigits(year)}`;

  return {
    year,
    month,
    monthName,
    day,
    hour,
    minute,
    weekday,
    timeString,
    dateString,
  };
}

/**
 * Formats a timestamp into: "ساعت ۱۴:۳۰ - ۲۲ فروردین"
 */
export function formatJalaliFull(timestamp: number): string {
  const { dateString, timeString } = getJalaliComponents(timestamp);
  return `${dateString} ساعت ${timeString}`;
}

/**
 * Formats time only: "۱۴:۳۰"
 */
export function formatJalaliTime(timestamp: number): string {
  const d = new Date(timestamp);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${toPersianDigits(h)}:${toPersianDigits(m)}`;
}

/**
 * Returns a human friendly relative time in Persian
 */
export function getPersianRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = timestamp - now;
  const absDiff = Math.abs(diff);

  const minutes = Math.round(absDiff / 60000);
  const hours = Math.round(absDiff / 3600000);
  const days = Math.round(absDiff / 86400000);

  if (diff > 0) {
    // In future
    if (minutes < 1) return 'چند لحظه دیگر';
    if (minutes < 60) return `${toPersianDigits(minutes)} دقیقه دیگر`;
    if (hours < 24) return `${toPersianDigits(hours)} ساعت دیگر`;
    if (days === 1) return 'فردا';
    return `${toPersianDigits(days)} روز دیگر`;
  } else {
    // In past
    if (minutes < 1) return 'همین الان';
    if (minutes < 60) return `${toPersianDigits(minutes)} دقیقه پیش`;
    if (hours < 24) return `${toPersianDigits(hours)} ساعت پیش`;
    if (days === 1) return 'دیروز';
    return `${toPersianDigits(days)} روز پیش`;
  }
}

/**
 * Jalali to Gregorian converter algorithm for accurate date picking
 */
export function jalaliToGregorian(jy: number, jm: number, jd: number): [number, number, number] {
  const gy = jy <= 979 ? 621 : 1600;
  let jy_adj = jy <= 979 ? jy : jy - 979;

  let days =
    365 * jy_adj +
    Math.floor(jy_adj / 33) * 8 +
    Math.floor(((jy_adj % 33) + 3) / 4) +
    78 +
    jd +
    (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);

  let g_y = gy + 400 * Math.floor(days / 146097);
  days %= 146097;

  let leap = true;
  if (days >= 36525) {
    days--;
    g_y += 100 * Math.floor(days / 36524);
    days %= 36524;
    if (days >= 365) days++;
    else leap = false;
  }

  g_y += 4 * Math.floor(days / 1461);
  days %= 1461;

  if (days >= 366) {
    leap = false;
    days--;
    g_y += Math.floor(days / 365);
    days %= 365;
  }

  const sal_a = [0, 31, (leap ? 29 : 28), 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let g_m = 0;
  for (let i = 1; i <= 12; i++) {
    if (days < sal_a[i]) {
      g_m = i;
      break;
    }
    days -= sal_a[i];
  }
  const g_d = days + 1;
  return [g_y, g_m, g_d];
}

/**
 * Checks if a Jalali year is leap
 */
export function isJalaliLeapYear(jy: number): boolean {
  const breaks = [1, 5, 9, 13, 17, 22, 26, 30];
  const mod = ((jy % 33) + 33) % 33;
  return breaks.includes(mod);
}

/**
 * Returns the number of days in a given Jalali month (1-12)
 */
export function getDaysInJalaliMonth(jy: number, jm: number): number {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return isJalaliLeapYear(jy) ? 30 : 29;
}

/**
 * Converts Jalali year, month, day, hour, minute to Unix timestamp (ms)
 */
export function jalaliToTimestamp(
  jy: number,
  jm: number,
  jd: number,
  hour: number = 0,
  minute: number = 0
): number {
  const [gy, gm, gd] = jalaliToGregorian(jy, jm, jd);
  const d = new Date(gy, gm - 1, gd, hour, minute, 0, 0);
  return d.getTime();
}

/**
 * Returns weekday index in Persian week:
 * 0: شنبه (Saturday)
 * 1: یکشنبه (Sunday)
 * 2: دوشنبه (Monday)
 * 3: سه‌شنبه (Tuesday)
 * 4: چهارشنبه (Wednesday)
 * 5: پنج‌شنبه (Thursday)
 * 6: جمعه (Friday)
 */
export function getJalaliWeekdayIndex(jy: number, jm: number, jd: number): number {
  const [gy, gm, gd] = jalaliToGregorian(jy, jm, jd);
  const d = new Date(gy, gm - 1, gd, 12, 0, 0);
  // JS getDay(): 0 is Sunday, 6 is Saturday
  return (d.getDay() + 1) % 7;
}


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
 * Normalizes Persian/Arabic/English text and digits for accurate, case-insensitive bilingual search matching
 */
export function normalizeSearchText(input?: string | number | null): string {
  if (input === null || input === undefined) return '';
  return fromPersianDigits(String(input))
    .toLowerCase()
    .replace(/ي/g, 'ی')
    .replace(/ى/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/ة/g, 'ه')
    .replace(/آ/g, 'ا')
    .replace(/أ/g, 'ا')
    .replace(/إ/g, 'ا')
    .replace(/ؤ/g, 'و')
    .replace(/\u200c/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
 * Formats a timestamp into: "ساعت ۱۴:۳۰ - ۲۲ فروردین" or "22 Farvardin at 14:30"
 */
export function formatJalaliFull(timestamp: number, language: string = 'fa'): string {
  const { dateString, timeString } = getJalaliComponents(timestamp);
  if (language === 'en') {
    const d = new Date(timestamp);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} - ${h}:${m}`;
  }
  return `${dateString} ساعت ${timeString}`;
}

/**
 * Formats time only: "۱۴:۳۰" or "14:30"
 */
export function formatJalaliTime(timestamp: number, language: string = 'fa'): string {
  const d = new Date(timestamp);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  if (language === 'en') {
    return `${h}:${m}`;
  }
  return `${toPersianDigits(h)}:${toPersianDigits(m)}`;
}

/**
 * Returns a human friendly relative time in Persian or English
 */
export function getPersianRelativeTime(timestamp: number, language: string = 'fa'): string {
  const isEn = language === 'en';
  const now = Date.now();
  const diff = timestamp - now;
  const absDiff = Math.abs(diff);

  const minutes = Math.round(absDiff / 60000);
  const hours = Math.round(absDiff / 3600000);
  const days = Math.round(absDiff / 86400000);

  if (diff > 0) {
    // In future
    if (minutes < 1) return isEn ? 'in a moment' : 'چند لحظه دیگر';
    if (minutes < 60) return isEn ? `in ${minutes}m` : `${toPersianDigits(minutes)} دقیقه دیگر`;
    if (hours < 24) return isEn ? `in ${hours}h` : `${toPersianDigits(hours)} ساعت دیگر`;
    if (days === 1) return isEn ? 'tomorrow' : 'فردا';
    return isEn ? `in ${days} days` : `${toPersianDigits(days)} روز دیگر`;
  } else {
    // In past
    if (minutes < 1) return isEn ? 'just now' : 'همین الان';
    if (minutes < 60) return isEn ? `${minutes}m ago` : `${toPersianDigits(minutes)} دقیقه پیش`;
    if (hours < 24) return isEn ? `${hours}h ago` : `${toPersianDigits(hours)} ساعت پیش`;
    if (days === 1) return isEn ? 'yesterday' : 'دیروز';
    return isEn ? `${days} days ago` : `${toPersianDigits(days)} روز پیش`;
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

/**
 * Returns a stable string key representing the calendar date of the timestamp.
 */
export function getDateKey(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * Returns a clean day label for timeline sectioning: "امروز", "فردا", "دیروز", or full Jalali/Gregorian date.
 */
export function getDayHeaderLabel(timestamp: number, language: string = 'fa'): string {
  const isEn = language === 'en';
  const now = new Date();
  const target = new Date(timestamp);

  const nowDateKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  const targetDateKey = `${target.getFullYear()}-${target.getMonth() + 1}-${target.getDate()}`;

  const tomorrow = new Date(now.getTime() + 86400000);
  const tomorrowDateKey = `${tomorrow.getFullYear()}-${tomorrow.getMonth() + 1}-${tomorrow.getDate()}`;

  const yesterday = new Date(now.getTime() - 86400000);
  const yesterdayDateKey = `${yesterday.getFullYear()}-${yesterday.getMonth() + 1}-${yesterday.getDate()}`;

  const monthsEn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fullEnDate = `${monthsEn[target.getMonth()]} ${target.getDate()}, ${target.getFullYear()}`;
  const { weekday, day, monthName, year } = getJalaliComponents(timestamp);
  const fullFaDate = `${toPersianDigits(day)} ${monthName} ${toPersianDigits(year)}`;

  if (targetDateKey === nowDateKey) {
    return isEn ? `Today — ${fullEnDate}` : `امروز — ${fullFaDate}`;
  }
  if (targetDateKey === tomorrowDateKey) {
    return isEn ? `Tomorrow — ${fullEnDate}` : `فردا — ${fullFaDate}`;
  }
  if (targetDateKey === yesterdayDateKey) {
    return isEn ? `Yesterday — ${fullEnDate}` : `دیروز — ${fullFaDate}`;
  }

  if (isEn) {
    return `${target.toLocaleDateString('en-US', { weekday: 'short' })}, ${fullEnDate}`;
  }

  return `${weekday} ${fullFaDate}`;
}

export const GREGORIAN_MONTHS: readonly string[] = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export const GREGORIAN_MONTHS_SHORT: readonly string[] = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export const GREGORIAN_WEEKDAYS: readonly string[] = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export const GREGORIAN_WEEKDAYS_SHORT: readonly string[] = [
  'Sun',
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
] as const;

/**
 * Persian week header starting from Saturday (شنبه) with Thursday & Friday as weekend holidays
 */
export const JALALI_WEEKDAYS_HEADER = [
  { index: 0, short: 'ش', label: 'شنبه', full: 'شنبه', isWeekend: false },
  { index: 1, short: 'ی', label: '۱شنبه', full: 'یکشنبه', isWeekend: false },
  { index: 2, short: 'د', label: '۲شنبه', full: 'دوشنبه', isWeekend: false },
  { index: 3, short: 'س', label: '۳شنبه', full: 'سه‌شنبه', isWeekend: false },
  { index: 4, short: 'چ', label: '۴شنبه', full: 'چهارشنبه', isWeekend: false },
  { index: 5, short: 'پ', label: '۵شنبه', full: 'پنج‌شنبه', isWeekend: true },
  { index: 6, short: 'ج', label: 'جمعه', full: 'جمعه', isWeekend: true },
] as const;

/**
 * English week header starting from Monday (Mon) with Saturday & Sunday as weekend holidays
 */
export const GREGORIAN_WEEKDAYS_MONDAY_FIRST = [
  { index: 0, short: 'Mon', label: 'Mon', full: 'Monday', isWeekend: false },
  { index: 1, short: 'Tue', label: 'Tue', full: 'Tuesday', isWeekend: false },
  { index: 2, short: 'Wed', label: 'Wed', full: 'Wednesday', isWeekend: false },
  { index: 3, short: 'Thu', label: 'Thu', full: 'Thursday', isWeekend: false },
  { index: 4, short: 'Fri', label: 'Fri', full: 'Friday', isWeekend: false },
  { index: 5, short: 'Sat', label: 'Sat', full: 'Saturday', isWeekend: true },
  { index: 6, short: 'Sun', label: 'Sun', full: 'Sunday', isWeekend: true },
] as const;

/**
 * Returns weekday index in English Monday-first week:
 * 0: Monday ... 5: Saturday, 6: Sunday
 */
export function getGregorianMondayWeekdayIndex(gy: number, gm: number, gd: number): number {
  const d = new Date(gy, gm - 1, gd, 12, 0, 0);
  return (d.getDay() + 6) % 7;
}

const SOLAR_OFFICIAL_HOLIDAYS: Record<string, { fa: string; en: string }> = {
  '1/1': { fa: 'عید نوروز', en: 'Nowruz (Persian New Year)' },
  '1/2': { fa: 'عید نوروز', en: 'Nowruz Holiday' },
  '1/3': { fa: 'عید نوروز', en: 'Nowruz Holiday' },
  '1/4': { fa: 'عید نوروز', en: 'Nowruz Holiday' },
  '1/12': { fa: 'روز جمهوری اسلامی', en: 'Islamic Republic Day' },
  '1/13': { fa: 'روز طبیعت (سیزده‌به‌در)', en: 'Nature Day (Sizdah Bedar)' },
  '3/14': { fa: 'رحلت امام خمینی', en: 'Demise of Imam Khomeini' },
  '3/15': { fa: 'قیام ۱۵ خرداد', en: '15 Khordad Uprising' },
  '11/22': { fa: 'پیروزی انقلاب اسلامی', en: 'Islamic Revolution Victory Day' },
  '12/29': { fa: 'روز ملی شدن صنعت نفت', en: 'Oil Nationalization Day' },
  '12/30': { fa: 'تعطیل پایان سال', en: 'End of Year Holiday' },
};

const LUNAR_OFFICIAL_HOLIDAYS: Record<string, { fa: string; en: string }> = {
  '1/9': { fa: 'تاسوعای حسینی', en: 'Tasua' },
  '1/10': { fa: 'عاشورای حسینی', en: 'Ashura' },
  '2/20': { fa: 'اربعین حسینی', en: 'Arbaeen' },
  '2/28': { fa: 'رحلت پیامبر اکرم (ص) و شهادت امام حسن مجتبی (ع)', en: 'Demise of Prophet Muhammad & Imam Hasan' },
  '3/8': { fa: 'شهادت امام حسن عسکری (ع)', en: 'Martyrdom of Imam Hasan al-Askari' },
  '3/17': { fa: 'میلاد پیامبر اکرم (ص) و امام جعفر صادق (ع)', en: 'Birth of Prophet Muhammad & Imam Sadiq' },
  '6/3': { fa: 'شهادت حضرت فاطمه زهرا (س)', en: 'Martyrdom of Hazrat Fatimah' },
  '7/13': { fa: 'ولادت امام علی (ع) و روز پدر', en: 'Birth of Imam Ali' },
  '7/27': { fa: 'مبعث پیامبر اکرم (ص)', en: 'Mab\'ath of Prophet Muhammad' },
  '8/15': { fa: 'ولادت حضرت مهدی (عج)', en: 'Birth of Imam Mahdi' },
  '9/21': { fa: 'شهادت حضرت علی (ع)', en: 'Martyrdom of Imam Ali' },
  '10/1': { fa: 'عید سعید فطر', en: 'Eid al-Fitr' },
  '10/2': { fa: 'تعطیل به مناسبت عید سعید فطر', en: 'Eid al-Fitr Holiday' },
  '10/25': { fa: 'شهادت امام جعفر صادق (ع)', en: 'Martyrdom of Imam Sadiq' },
  '12/10': { fa: 'عید سعید قربان', en: 'Eid al-Adha' },
  '12/18': { fa: 'عید سعید غدیر خم', en: 'Eid al-Ghadir' },
};

const GREGORIAN_OFFICIAL_HOLIDAYS: Record<string, { fa: string; en: string }> = {
  '1/1': { fa: 'آغاز سال نو میلادی', en: "New Year's Day" },
  '5/1': { fa: 'روز جهانی کارگر', en: "International Workers' Day" },
  '12/25': { fa: 'کریسمس', en: 'Christmas Day' },
  '12/26': { fa: 'تعطیلات کریسمس', en: 'Boxing Day' },
};

function getIslamicMonthDay(date: Date): { month: number; day: number } {
  const calendars = ['en-u-ca-islamic-umalqura', 'en-u-ca-islamic-civil', 'en-u-ca-islamic'];
  for (const cal of calendars) {
    try {
      const fmt = new Intl.DateTimeFormat(cal, { month: 'numeric', day: 'numeric' });
      const parts = fmt.formatToParts(date);
      let m = 0;
      let d = 0;
      for (const p of parts) {
        if (p.type === 'month') m = parseInt(fromPersianDigits(p.value), 10);
        if (p.type === 'day') d = parseInt(fromPersianDigits(p.value), 10);
      }
      if (m >= 1 && m <= 12 && d >= 1 && d <= 30) {
        return { month: m, day: d };
      }
    } catch {
      // Try next calendar
    }
  }
  return { month: 0, day: 0 };
}

export interface CalendarDayHolidayInfo {
  weekdayIndex: number; // 0..6 (Saturday=0 in FA, Monday=0 in EN)
  isWeekend: boolean; // Thu/Fri in FA, Sat/Sun in EN
  isOfficialHoliday: boolean; // Occasion holiday
  isHoliday: boolean; // Weekend or Occasion holiday
  occasionTitle: string | null;
}

/**
 * Returns complete weekday & official holiday info (weekend + occasion holidays) for a calendar cell
 */
export function getCalendarDayHolidayInfo(
  year: number,
  month: number,
  day: number,
  language: 'fa' | 'en' = 'fa'
): CalendarDayHolidayInfo {
  const isEn = language === 'en';
  let gy = year;
  let gm = month;
  let gd = day;
  let jy = year;
  let jm = month;
  let jd = day;

  if (isEn) {
    const dObj = new Date(gy, gm - 1, gd, 12, 0, 0);
    const jComp = getJalaliComponents(dObj.getTime());
    jy = jComp.year;
    jm = jComp.month;
    jd = jComp.day;
  } else {
    const [gYear, gMonth, gDay] = jalaliToGregorian(jy, jm, jd);
    gy = gYear;
    gm = gMonth;
    gd = gDay;
  }

  const weekdayIndex = isEn
    ? getGregorianMondayWeekdayIndex(gy, gm, gd)
    : getJalaliWeekdayIndex(jy, jm, jd);

  // Thu (5) & Fri (6) in Persian; Sat (5) & Sun (6) in English Monday-first
  const isWeekend = weekdayIndex === 5 || weekdayIndex === 6;

  const titles: string[] = [];

  // 1. Check Solar (Jalali) official holidays
  const solarKey = `${jm}/${jd}`;
  if (SOLAR_OFFICIAL_HOLIDAYS[solarKey]) {
    titles.push(isEn ? SOLAR_OFFICIAL_HOLIDAYS[solarKey].en : SOLAR_OFFICIAL_HOLIDAYS[solarKey].fa);
  }

  // 2. Check Lunar (Islamic) official holidays
  const dateObj = new Date(gy, gm - 1, gd, 12, 0, 0);
  const islamic = getIslamicMonthDay(dateObj);
  if (islamic.month > 0 && islamic.day > 0) {
    const lunarKey = `${islamic.month}/${islamic.day}`;
    if (LUNAR_OFFICIAL_HOLIDAYS[lunarKey]) {
      titles.push(isEn ? LUNAR_OFFICIAL_HOLIDAYS[lunarKey].en : LUNAR_OFFICIAL_HOLIDAYS[lunarKey].fa);
    }
    // Check last day of Safar (29 or 30 Safar -> Martyrdom of Imam Reza)
    if (islamic.month === 2 && (islamic.day === 29 || islamic.day === 30)) {
      const nextDateObj = new Date(gy, gm - 1, gd + 1, 12, 0, 0);
      const nextIslamic = getIslamicMonthDay(nextDateObj);
      if (nextIslamic.month === 3) {
        titles.push(isEn ? 'Martyrdom of Imam Reza' : 'شهادت امام رضا (ع)');
      }
    }
  }

  // 3. Check Gregorian official holidays (in English mode)
  if (isEn) {
    const gregKey = `${gm}/${gd}`;
    if (GREGORIAN_OFFICIAL_HOLIDAYS[gregKey]) {
      titles.push(GREGORIAN_OFFICIAL_HOLIDAYS[gregKey].en);
    }
  }

  const uniqueTitles = Array.from(new Set(titles));
  const isOfficialHoliday = uniqueTitles.length > 0;

  return {
    weekdayIndex,
    isWeekend,
    isOfficialHoliday,
    isHoliday: isWeekend || isOfficialHoliday,
    occasionTitle: isOfficialHoliday ? uniqueTitles.join(isEn ? ' • ' : ' ، ') : null,
  };
}

/**
 * Returns all official occasion holidays in the given month
 */
export function getMonthOfficialHolidays(
  year: number,
  month: number,
  language: 'fa' | 'en' = 'fa'
): Array<{ day: number; title: string }> {
  const isEn = language === 'en';
  const maxDays = isEn ? getDaysInGregorianMonth(year, month) : getDaysInJalaliMonth(year, month);
  const list: Array<{ day: number; title: string }> = [];
  for (let d = 1; d <= maxDays; d++) {
    const info = getCalendarDayHolidayInfo(year, month, d, language);
    if (info.isOfficialHoliday && info.occasionTitle) {
      list.push({ day: d, title: info.occasionTitle });
    }
  }
  return list;
}

/**
 * Returns number of days in a Gregorian month (month: 1-12)
 */
export function getDaysInGregorianMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * Extracts Gregorian date/time components for standard English mode
 */
export function getGregorianComponents(timestamp: number) {
  const d = new Date(timestamp);
  const year = d.getFullYear();
  const month = d.getMonth() + 1; // 1-12
  const day = d.getDate();
  const hour = d.getHours();
  const minute = d.getMinutes();
  const weekday = GREGORIAN_WEEKDAYS[d.getDay()];
  const monthName = GREGORIAN_MONTHS[month - 1];

  const timeString = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  const dateString = `${monthName} ${day}, ${year}`;

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
 * Formats date string respecting user language (Jalali for Persian, Gregorian for English)
 */
export function formatDateByLanguage(timestamp: number, language: string = 'fa'): string {
  if (language === 'en') {
    const comp = getGregorianComponents(timestamp);
    return `${comp.monthName} ${comp.day}, ${comp.year}`;
  }
  const comp = getJalaliComponents(timestamp);
  return comp.dateString;
}

/**
 * Helper to match tokenized query against a normalized haystack (supporting Persian & English)
 */
export function matchesNormalizedQuery(haystackParts: (string | number | undefined | null)[], query: string): boolean {
  const qNorm = normalizeSearchText(query);
  if (!qNorm) return true;
  const haystack = normalizeSearchText(haystackParts.filter((p) => p !== null && p !== undefined && p !== '').join(' '));
  const tokens = qNorm.split(' ').filter(Boolean);
  return tokens.every((tok) => haystack.includes(tok));
}

/**
 * Comprehensive bilingual search for Reminders across all user-entered fields
 */
export function matchesReminderSearch(r: any, query: string): boolean {
  if (!query || !query.trim()) return true;
  const catKeywords =
    r.category === 'work'
      ? 'work کاری کار شغلی اداره office job business'
      : r.category === 'family'
      ? 'family خانوادگی خانواده منزل خانه home personal'
      : 'other سایر عمومی متفرقه general misc';
  const prioKeywords =
    r.priority === 'high'
      ? 'high urgent فوری بالا مهم اضطراری'
      : r.priority === 'medium'
      ? 'medium normal متوسط معمولی'
      : 'low عادی پایین کم';
  const statusKeywords =
    r.status === 'completed'
      ? 'completed done انجام شده تکمیل'
      : r.status === 'postponed'
      ? 'postponed snoozed معوق به تعویق افتاده'
      : 'pending active در انتظار فعال';
  const recurrenceKeywords =
    r.recurrence === 'hourly'
      ? 'hourly ساعتی هر ساعت'
      : r.recurrence === 'daily'
      ? 'daily روزانه هر روز'
      : r.recurrence === 'weekly'
      ? 'weekly هفتگی هر هفته'
      : r.recurrence === 'monthly'
      ? 'monthly ماهانه ماهیانه هر ماه'
      : r.recurrence === 'custom_dates'
      ? 'custom calendar تقویم انتخابی'
      : '';

  const jComp = getJalaliComponents(r.dueTimestamp);
  const gComp = getGregorianComponents(r.dueTimestamp);
  const jNumeric = `${jComp.year}/${String(jComp.month).padStart(2, '0')}/${String(jComp.day).padStart(2, '0')} ${jComp.year}/${jComp.month}/${jComp.day}`;
  const gNumeric = `${gComp.year}-${String(gComp.month).padStart(2, '0')}-${String(gComp.day).padStart(2, '0')} ${gComp.year}/${gComp.month}/${gComp.day}`;

  return matchesNormalizedQuery(
    [
      r.title,
      r.description,
      r.geofence?.locationName,
      r.geofence?.address,
      r.geofence?.radius ? `${r.geofence.radius}m` : '',
      r.recurrenceCustomDates?.join(' '),
      catKeywords,
      prioKeywords,
      statusKeywords,
      recurrenceKeywords,
      formatJalaliFull(r.dueTimestamp, 'fa'),
      formatJalaliFull(r.dueTimestamp, 'en'),
      jComp.weekday,
      jComp.monthName,
      jComp.year,
      jNumeric,
      gComp.weekday,
      gComp.monthName,
      gComp.year,
      gNumeric,
      gComp.timeString,
      'reminder یادآور یاداوری',
    ],
    query
  );
}

/**
 * Comprehensive bilingual search for Ideas/Notes across all user-entered fields
 */
export function matchesIdeaSearch(idea: any, query: string): boolean {
  if (!query || !query.trim()) return true;
  const catKeywords =
    idea.category === 'work'
      ? 'work کاری کار شغلی office job'
      : idea.category === 'family'
      ? 'family خانوادگی خانواده شخصی'
      : 'other سایر عمومی متفرقه';
  const mediaKeywords = [
    idea.audioRecordUrl ? 'voice audio memo ویس صوتی ضبط صدا' : '',
    idea.videoRecordUrl ? 'video clip ویدیو فیلم' : '',
    idea.drawingDataUrl ? 'drawing sketch canvas نقاشی طراحی دستخط' : '',
  ].join(' ');

  const jComp = getJalaliComponents(idea.createdAt);
  const gComp = getGregorianComponents(idea.createdAt);

  return matchesNormalizedQuery(
    [
      idea.title,
      idea.content,
      idea.tags?.join(' '),
      catKeywords,
      mediaKeywords,
      formatJalaliFull(idea.createdAt, 'fa'),
      formatJalaliFull(idea.createdAt, 'en'),
      jComp.weekday,
      jComp.monthName,
      jComp.year,
      gComp.weekday,
      gComp.monthName,
      gComp.year,
      'idea note thought ایده یادداشت فکر افکار',
    ],
    query
  );
}

/**
 * Comprehensive bilingual search for Saved Locations across all user-entered fields
 */
export function matchesLocationSearch(loc: any, query: string): boolean {
  if (!query || !query.trim()) return true;
  const jComp = getJalaliComponents(loc.createdAt);
  const gComp = getGregorianComponents(loc.createdAt);
  const geofenceKeywords = loc.geofence
    ? `geofence checkpoint radar حصار مکانی رادار ${loc.geofence.customMessage || ''} ${loc.geofence.radius || ''}m ${
        loc.geofence.triggerOn === 'enter'
          ? 'enter arrival ورود رسیدن'
          : loc.geofence.triggerOn === 'exit'
          ? 'exit departure خروج ترک'
          : 'both enter exit ورود و خروج'
      }`
    : '';

  return matchesNormalizedQuery(
    [
      loc.title,
      loc.description,
      loc.address,
      loc.latitude,
      loc.longitude,
      loc.googleMapsUrl,
      geofenceKeywords,
      formatJalaliFull(loc.createdAt, 'fa'),
      formatJalaliFull(loc.createdAt, 'en'),
      jComp.weekday,
      jComp.monthName,
      jComp.year,
      gComp.weekday,
      gComp.monthName,
      gComp.year,
      'location place gps map مکان لوکیشن موقعیت نقشه آدرس',
    ],
    query
  );
}

/**
 * Comprehensive bilingual search for Occasions across all user-entered fields
 */
export function matchesOccasionSearch(occ: any, query: string): boolean {
  if (!query || !query.trim()) return true;
  const typeKeywords =
    occ.type === 'birthday'
      ? 'birthday birth تولد زادروز'
      : occ.type === 'wedding'
      ? 'wedding marriage anniversary سالگرد ازدواج عروسی'
      : occ.type === 'dating'
      ? 'dating relationship anniversary سالگرد آشنایی دوستی'
      : occ.type === 'memorial'
      ? 'memorial remembrance سالگرد فوت درگذشت یادبود'
      : occ.type === 'family'
      ? 'family occasion مناسبت خانوادگی خانواده'
      : occ.type === 'work'
      ? 'work occasion مناسبت کاری شغلی'
      : 'custom occasion سایر مناسبت دلخواه';

  const persianMonth = PERSIAN_MONTHS[(occ.solarMonth || 1) - 1] || '';
  const dateStr = `${occ.solarYear ? occ.solarYear + '/' : ''}${String(occ.solarMonth).padStart(2, '0')}/${String(occ.solarDay).padStart(2, '0')} ${occ.solarDay} ${persianMonth} ${occ.solarYear || ''}`;

  return matchesNormalizedQuery(
    [
      occ.title,
      occ.personName,
      occ.customNote,
      occ.notifyTime,
      typeKeywords,
      persianMonth,
      dateStr,
      occ.solarYear,
      occ.solarMonth,
      occ.solarDay,
      'occasion event milestone مناسبت رویداد سالگرد یادبود',
    ],
    query
  );
}


import { Category, OccasionType, Priority, RecurrenceType } from '../types';
import {
  PERSIAN_MONTHS,
  fromPersianDigits,
  getJalaliComponents,
  jalaliToTimestamp,
  toPersianDigits,
} from './jalali';

export type SmartIntentType = 'reminder' | 'occasion' | 'location' | 'idea' | 'unknown';

export type SmartWizardStep =
  | 'ask_subject'
  | 'ask_day'
  | 'ask_time'
  | 'ask_details'
  | 'confirm';

export interface SmartCaptureDraft {
  intentType: SmartIntentType;
  wizardStep?: SmartWizardStep;
  title?: string;
  description?: string;
  category?: Category;
  priority?: Priority;
  daySpecified?: boolean;
  offsetDays?: number | null;
  hour?: number | null;
  minute?: number | null;
  solarYear?: number | null;
  solarMonth?: number | null;
  solarDay?: number | null;
  occasionType?: OccasionType;
  personName?: string;
  locationAddress?: string;
  enableGeofence?: boolean;
  detailsAsked?: boolean;
  recurrence?: RecurrenceType;
}

export interface SmartChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
}

export interface SmartAnalysisResult {
  intentType: SmartIntentType;
  isComplete: boolean;
  shouldAutoSubmit?: boolean;
  clarifyingQuestion: string;
  draft: SmartCaptureDraft;
}

const PERSIAN_WORD_NUMBERS: Record<string, number> = {
  یک: 1,
  یه: 1,
  اول: 1,
  یکم: 1,
  دو: 2,
  دوم: 2,
  سه: 3,
  سوم: 3,
  چهار: 4,
  چهارم: 4,
  پنج: 5,
  پنجم: 5,
  شش: 6,
  شیش: 6,
  ششم: 6,
  هفت: 7,
  هفتم: 7,
  هشت: 8,
  هشتم: 8,
  نه: 9,
  نهم: 9,
  ده: 10,
  دهم: 10,
  یازده: 11,
  یازدهم: 11,
  دوازده: 12,
  دوازدهم: 12,
  سیزده: 13,
  سیزدهم: 13,
  چهارده: 14,
  چهاردهم: 14,
  پانزده: 15,
  پانزدهم: 15,
  پونزده: 15,
  پونزدهم: 15,
  شانزده: 16,
  شانزدهم: 16,
  شونزده: 16,
  شونزدهم: 16,
  هفده: 17,
  هفدهم: 17,
  هجده: 18,
  هجدهم: 18,
  هژده: 18,
  هژدهم: 18,
  نوزده: 19,
  نوزدهم: 19,
  بیست: 20,
  بیستم: 20,
  'بیست و یک': 21,
  'بیست و یکم': 21,
  'بیست و دو': 22,
  'بیست و دوم': 22,
  'بیست و سه': 23,
  'بیست و سوم': 23,
  'بیست و چهار': 24,
  'بیست و چهارم': 24,
  'بیست و پنج': 25,
  'بیست و پنجم': 25,
  'بیست و شش': 26,
  'بیست و ششم': 26,
  'بیست و شیش': 26,
  'بیست و هفت': 27,
  'بیست و هفتم': 27,
  'بیست و هشت': 28,
  'بیست و هشتم': 28,
  'بیست و نه': 29,
  'بیست و نهم': 29,
  سی: 30,
  'سی ام': 30,
  سی‌ام: 30,
  'سی و یک': 31,
  'سی و یکم': 31,
  'سی و پنج': 35,
  چهل: 40,
  'چهل و پنج': 45,
  پنجاه: 50,
  'پنجاه و پنج': 55,
};

const ENGLISH_WORD_NUMBERS: Record<string, number> = {
  one: 1,
  first: 1,
  two: 2,
  second: 2,
  three: 3,
  third: 3,
  four: 4,
  fourth: 4,
  five: 5,
  fifth: 5,
  six: 6,
  sixth: 6,
  seven: 7,
  seventh: 7,
  eight: 8,
  eighth: 8,
  nine: 9,
  ninth: 9,
  ten: 10,
  tenth: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
};

const ENGLISH_MONTHS = [
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
];

const GREGORIAN_MONTH_PATTERNS: Array<{ month: number; regex: RegExp }> = [
  { month: 1, regex: /\b(january|jan|ژانویه)\b/i },
  { month: 2, regex: /\b(february|feb|فوریه)\b/i },
  { month: 3, regex: /\b(march|mar|مارس)\b/i },
  { month: 4, regex: /\b(april|apr|آوریل|اوریل)\b/i },
  { month: 5, regex: /\b(may|مه)\b/i },
  { month: 6, regex: /\b(june|jun|ژوئن|جون)\b/i },
  { month: 7, regex: /\b(july|jul|ژوئیه|جولای)\b/i },
  { month: 8, regex: /\b(august|aug|اوت|آگوست|اگوست)\b/i },
  { month: 9, regex: /\b(september|sep|sept|سپتامبر)\b/i },
  { month: 10, regex: /\b(october|oct|اکتبر)\b/i },
  { month: 11, regex: /\b(november|nov|نوامبر)\b/i },
  { month: 12, regex: /\b(december|dec|دسامبر)\b/i },
];

// Map JS getDay() (0=Sunday .. 6=Saturday) for Persian & English weekdays
const WEEKDAY_JS_INDEX: Array<{ pattern: RegExp; jsDay: number }> = [
  { pattern: /(?:^|\s|[،,.:؛!?-])(پنج\s*شنبه|\bthursday\b)(?=\s|$|[،,.:؛!?-])/i, jsDay: 4 },
  { pattern: /(?:^|\s|[،,.:؛!?-])(چهار\s*شنبه|\bwednesday\b)(?=\s|$|[،,.:؛!?-])/i, jsDay: 3 },
  { pattern: /(?:^|\s|[،,.:؛!?-])(سه\s*شنبه|\btuesday\b)(?=\s|$|[،,.:؛!?-])/i, jsDay: 2 },
  { pattern: /(?:^|\s|[،,.:؛!?-])(دو\s*شنبه|\bmonday\b)(?=\s|$|[،,.:؛!?-])/i, jsDay: 1 },
  { pattern: /(?:^|\s|[،,.:؛!?-])(یک\s*شنبه|\bsunday\b)(?=\s|$|[،,.:؛!?-])/i, jsDay: 0 },
  { pattern: /(?<!یک\s*|دو\s*|سه\s*|چهار\s*|پنج\s*)(?:^|\s|[،,.:؛!?-])(شنبه|\bsaturday\b)(?=\s|$|[،,.:؛!?-])/i, jsDay: 6 },
  { pattern: /(?:^|\s|[،,.:؛!?-])(جمعه|\bfriday\b)(?=\s|$|[،,.:؛!?-])/i, jsDay: 5 },
];

/**
 * تصحیح فوق‌سریع (< 0.2ms) خطاهای رایج شنیداری و هم‌آوایی در تشخیص گفتار فارسی (100% لوکال و بدون بار پردازشی)
 */
export function correctPersianAsrErrors(raw: string): string {
  return (raw || '')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\u200c/g, ' ')
    .replace(/(^|\s)(سبت|صبت)(\s|$)/g, '$1ثبت$3')
    .replace(/(^|\s)(سبت کن|صبت کن|ثبتشکن|ثبت کنن)(\s|$)/g, '$1ثبت کن$3')
    .replace(/(^|\s)(طایید|تأیید|تائید|تاییده)(\s|$)/g, '$1تایید$3')
    .replace(/(^|\s)(او کی|اکی|اکے)(\s|$)/g, '$1اوکی$3')
    .replace(/(^|\s)(با شه|بشه)(\s|$)/g, '$1باشه$3')
    .replace(/(^|\s)(یاد هم بنداز|یادم بندازه|یادم انداختن)(\s|$)/g, '$1یادم بنداز$3')
    .replace(/(^|\s)(پس از فردا|پسا فردا)(\s|$)/g, '$1پس فردا$3')
    .replace(/(\d+|یک|دو|سه|چهار|پنج|شش|شیش|هفت|هشت|نه|ده)\s*(?:روزی\s*که|روزه\s*دیگه|روزه\s*دیگر)/g, '$1 روز دیگه')
    .replace(/(\d+|یک|دو|سه|چهار|پنج|شش|شیش|هفت|هشت|نه|ده| یازده|دوازده)\s*از(?=\s|$)/g, '$1 عصر')
    .replace(/(^|\s)شیش(\s|$)/g, '$1شش$2')
    .replace(/(^|\s)چار(\s|$)/g, '$1چهار$2')
    .replace(/(^|\s)دیقه(\s|$)/g, '$1دقیقه$2')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePersianSpeech(raw: string, expectTimeOrDay = false): string {
  let s = fromPersianDigits(correctPersianAsrErrors(raw || ''))
    .replace(/\s+/g, ' ')
    .trim();

  // Protect negative "نه" at the very start of an utterance ("نه ساعتش رو عوض کن") unless followed by time/day words or standalone in time/day step
  const sortedKeys = Object.keys(PERSIAN_WORD_NUMBERS).sort((a, b) => b.length - a.length);
  for (const word of sortedKeys) {
    const val = PERSIAN_WORD_NUMBERS[word];
    if (word === 'نه') {
      s = s.replace(
        /(?<=(?:^|\s)(?:ساعت|روز|ماه|برج|تا|و|برای)\s+)نه(?=\s|$|[.،,/:٫-])/g,
        '9'
      );
      s = s.replace(
        /(?<=^|\s)نه(?=\s+(?:صبح|قبل\s*از\s*ظهر|ظهر|بعد\s*از\s*ظهر|عصر|غروب|شب|بامداد|دقیقه|و\s*نیم|و\s*ربع|روز\s*دیگه|روز\s*دیگر|هفته\s*دیگه))/g,
        '9'
      );
      if (expectTimeOrDay && /^نه(\s+(باشه|خوبه))?$/.test(s)) {
        s = s.replace(/^نه/, '9');
      }
      continue;
    }
    const reg = new RegExp(`(?<=^|\\s|[/:٫.-])(${word})(?=\\s|$|[.،,/:٫-])`, 'g');
    s = s.replace(reg, String(val));
  }

  for (const [enWord, val] of Object.entries(ENGLISH_WORD_NUMBERS)) {
    const reg = new RegExp(`\\b${enWord}\\b`, 'gi');
    s = s.replace(reg, String(val));
  }

  return s;
}

/**
 * محاسبه فاصله لونشتاین و شباهت فازی بین دو رشته برای تشخیص مقاوم در برابر خطاهای صوتی
 */
function fuzzyWordSimilarity(a: string, b: string): number {
  const s1 = a.trim().toLowerCase();
  const s2 = b.trim().toLowerCase();
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;
  if (s1.length >= 3 && s2.length >= 3 && (s1.includes(s2) || s2.includes(s1))) {
    return 0.88;
  }

  const m = s1.length;
  const n = s2.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  const maxLen = Math.max(m, n);
  return maxLen === 0 ? 1 : (maxLen - dp[m][n]) / maxLen;
}

const FUZZY_INTENT_LEXICON: Record<Exclude<SmartIntentType, 'unknown'>, string[]> = {
  occasion: [
    'مناسبت',
    'تولد',
    'زادروز',
    'سالگرد',
    'ازدواج',
    'عقد',
    'آشنایی',
    'یادبود',
    'درگذشت',
    'وفات',
    'فوت',
    'birthday',
    'anniversary',
    'wedding',
    'memorial',
    'occasion',
  ],
  location: [
    'مکان',
    'لوکیشن',
    'موقعیت',
    'مختصات',
    'آدرس',
    'پارکینگ',
    'پارک',
    'ماشین',
    'خودرو',
    'مطب',
    'فروشگاه',
    'رستوران',
    'حصار',
    'location',
    'place',
    'address',
    'parked',
    'coordinates',
    'gps',
  ],
  idea: [
    'ایده',
    'فکر',
    'طرح',
    'یادداشت',
    'پیشنهاد',
    'خلاقیت',
    'داستان',
    'مقاله',
    'استارتاپ',
    'اپلیکیشن',
    'idea',
    'note',
    'thought',
    'brainstorm',
    'concept',
  ],
  reminder: [
    'یادآور',
    'یادآوری',
    'یادم',
    'آلارم',
    'هشدار',
    'زنگ',
    'جلسه',
    'قرار',
    'دارو',
    'قرص',
    'دکتر',
    'پزشک',
    'آزمایش',
    'تعمیر',
    'پمپ',
    'سرویس',
    'خرید',
    'پرداخت',
    'قسط',
    'وام',
    'قبض',
    'چک',
    'فاکتور',
    'تماس',
    'تلفن',
    'پرواز',
    'قطار',
    'بیدارم',
    'reminder',
    'remind',
    'alarm',
    'meeting',
    'appointment',
    'medicine',
    'pill',
    'call',
    'payment',
    'bill',
    'repair',
  ],
};

/**
 * تشخیص هوشمند دسته‌بندی با ترکیب عبارت‌شناسی و منطق فازی (Fuzzy Logic)
 */
export function detectIntentFromText(text: string, prevIntent: SmartIntentType): SmartIntentType {
  const norm = text
    .toLowerCase()
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\u200c/g, ' ')
    .trim();

  // Explicit single-word category selection
  if (/^(یادآور|یاداور|آلارم|الارم|reminder)$/i.test(norm)) return 'reminder';
  if (/^(مناسبت|تولد|سالگرد|occasion)$/i.test(norm)) return 'occasion';
  if (/^(مکان|لوکیشن|آدرس|موقعیت|location|place)$/i.test(norm)) return 'location';
  if (/^(ایده|فکر|یادداشت|طرح|idea|note)$/i.test(norm)) return 'idea';

  // If previous intent is already locked (in step 2+), keep it unless user explicitly asks to switch category
  if (prevIntent && prevIntent !== 'unknown') {
    if (/^(تغییر به|بخش|دسته)\s*(مناسبت|مکان|ایده|یادآور)/i.test(norm)) {
      if (norm.includes('مناسبت')) return 'occasion';
      if (norm.includes('مکان')) return 'location';
      if (norm.includes('ایده')) return 'idea';
      return 'reminder';
    }
    return prevIntent;
  }

  // Strong regex patterns first
  if (
    /(تولد|زادروز|سالگرد ازدواج|سالگرد عقد|سالگرد آشنایی|سالگرد فوت|درگذشت|وفات|مناسبت|birthday|anniversary|memorial)/i.test(
      norm
    )
  ) {
    return 'occasion';
  }

  if (
    /(لوکیشن|مکان|پارک کردم|پارکینگ|طبقه منفی|محل پارک|مختصات|اینجا رو ثبت|این مکان|آدرس مطب|آدرس شرکت|حصار مکانی|موقعیت فعلی|location|parked|save this place|gps)/i.test(
      norm
    )
  ) {
    return 'location';
  }

  if (
    /(ایده دارم|یه ایده|یک ایده|ایده|فکر جدید|یادداشت کن|یادداشت ذهنی|دفترچه ایده|پروژه جدید|طرح جدید|موضوع کتاب|idea|brainstorm|note down)/i.test(
      norm
    )
  ) {
    return 'idea';
  }

  if (
    /(یادآوری|یاداوری|یادآور|یادم بنداز|یادم بیار|بیدارم کن|آلارم|ساعت\s*\d|فردا|پس فردا|امروز|امشب|قرص|دارو|جلسه|قرار|زنگ بزنم|تماس|پرداخت|قسط|چک|خرید|دکتر|آزمایش|تعمیر|پمپ|سرویس|پرواز|قطار|remind|alarm|meeting|call|medicine|bill)/i.test(
      norm
    )
  ) {
    return 'reminder';
  }

  // Fuzzy token scoring across all 4 categories
  const words = norm.split(/[\s،,.:؛!?-]+/).filter((w) => w.length >= 2);
  const scores: Record<Exclude<SmartIntentType, 'unknown'>, number> = {
    reminder: 0,
    occasion: 0,
    location: 0,
    idea: 0,
  };

  for (const w of words) {
    (Object.keys(FUZZY_INTENT_LEXICON) as Array<Exclude<SmartIntentType, 'unknown'>>).forEach(
      (cat) => {
        for (const target of FUZZY_INTENT_LEXICON[cat]) {
          const sim = fuzzyWordSimilarity(w, target);
          if (sim >= 0.76) {
            scores[cat] = Math.max(scores[cat], sim);
          }
        }
      }
    );
  }

  let bestCat: SmartIntentType = 'unknown';
  let bestScore = 0.75;
  (Object.keys(scores) as Array<Exclude<SmartIntentType, 'unknown'>>).forEach((cat) => {
    if (scores[cat] > bestScore) {
      bestScore = scores[cat];
      bestCat = cat;
    }
  });

  if (bestCat !== 'unknown') {
    return bestCat;
  }

  // Default any actionable phrase with 2+ characters in step 1 to 'reminder' so the user is smoothly guided through Day -> Time -> Confirm
  if (norm.length >= 2) {
    return 'reminder';
  }

  return 'unknown';
}

/**
 * تشخیص عبارات تایید نهایی در گام ۶ (فارسی و انگلیسی)
 */
export function isConfirmationUtterance(rawText: string): boolean {
  const cleaned = correctPersianAsrErrors(rawText)
    .toLowerCase()
    .replace(/[!.،,؟?؛:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return false;

  // Allow explicit "نه توضیحی ندارم ثبت کن" / "بدون توضیح ثبت کن" before checking negative words
  if (
    /^(نه\s+)?(توضیحی\s+ندارم|بدون\s+توضیح|نیازی\s+نیست|همین\s+خوبه|فقط\s+ثبت\s+کن|ثبت\s+کن|ذخیره\s+کن)/i.test(
      cleaned
    )
  ) {
    return true;
  }

  // Must not contain a negative or edit command or a new time/date change
  if (
    /(^|\s)(نه|خیر|نخیر|ویرایش|تغییر|عوض|غلط|اشتباه|صبر|دست نگه دار|اصلاح|ساعت\s*\d|روز\s*\d|فردا|پس فردا|امروز|no|nope|wait|edit|change|wrong|modify)(\s|$)/i.test(
      cleaned
    )
  ) {
    return false;
  }

  // Direct match for standard single/compound confirmation phrases
  if (
    /^(اوکی|اوکیه|اکی|خوب|خوبه|بسیار خوب|خیلی خوب|عالی|عالیه|بله|بلی|بلع|بلا|آره|اره|آری|اری|باشه|باش|حتما|حتماً|ثبت|ثبتش|ثبت کن|ثبت کنید|ثبتش کن|ثبت بشه|ثبت شود|ثبت نهایی|ذخیره|ذخیره کن|ذخیره شود|ذخیره ش کن|ادامه|ادامه بده|تایید|تاییده|تایید کن|تایید میکنم|مورد تایید است|تائید|درست|درسته|کاملا درسته|حله|انجام بده|انجامش بده|فقط ثبت کن|همینه|همین خوبه|همین ثبت بشه|بدون توضیح ثبت کن|توضیحی ندارم|موافقم|قبوله|ردیفه|ok|okay|good|sounds good|great|yes|yeah|yep|sure|save|save it|confirm|confirmed|continue|go ahead|do it|correct|right|fine)(\s+(بله|آره|اره|درسته|خوبه|لطفا|لطفاً|ممنون|مرسی|دستت درد نکنه|ثبت|ثبت کن|ثبتش کن|ثبت بشه|ثبت شود|ذخیره کن|انجام بده|نهایی|please|thanks|thank you|save|save it|confirm))*$/i.test(
      cleaned
    )
  ) {
    return true;
  }

  // For short utterances (up to 6 words) in the final confirmation step, check if any core confirmation keyword is present
  const words = cleaned.split(' ').filter(Boolean);
  if (words.length <= 6 && !/\d/.test(cleaned)) {
    return /(^|\s)(بله|بلی|بلع|آره|اره|آری|اوکی|اوکیه|اکی|باشه|باش|خوبه|عالیه|تایید|تائید|تاییده|درسته|حله|موافقم|ثبت کن|ثبتش کن|ثبت بشه|ثبت شود|ثبت نهایی|ذخیره کن|ذخیره شود|انجام بده|ادامه بده|yes|yeah|yep|ok|okay|confirm|confirmed|save it|go ahead)(\s|$)/i.test(
      cleaned
    );
  }

  return false;
}

/**
 * تشخیص عبارات رد یا درخواست اصلاح در مرحله تایید
 */
export function isRejectionOrEditUtterance(rawText: string): boolean {
  const cleaned = rawText
    .toLowerCase()
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\u200c/g, ' ')
    .replace(/[!.،,؟?؛:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return /^(نه|خیر|نخیر|صبر کن|دست نگه دار|فعلا نه|ویرایش|تغییر|میخوام تغییر بدم|عوضش کن|اصلاح|no|nope|wait|hold on|edit|change|modify)$/i.test(
    cleaned
  );
}

function normalizeTwoOrFourDigitYear(rawYearStr?: string): number | null {
  if (!rawYearStr) return null;
  const y = parseInt(rawYearStr, 10);
  if (Number.isNaN(y)) return null;
  if (y >= 1300 && y <= 1500) return y;
  if (y >= 0 && y <= 99) {
    return y < 50 ? 1400 + y : 1300 + y;
  }
  return null;
}

export function extractTimeAndDate(
  rawText: string,
  expectTimeOnly = false,
  expectDayOnly = false
): {
  hour: number | null;
  minute: number | null;
  offsetDays: number | null;
  solarDay: number | null;
  solarMonth: number | null;
  solarYear: number | null;
  hasExplicitDayOrDate: boolean;
} {
  const rawCleaned = rawText
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\u200c/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const norm = normalizePersianSpeech(rawText, expectTimeOnly || expectDayOnly);
  const now = new Date();
  let hour: number | null = null;
  let minute: number | null = null;
  let offsetDays: number | null = null;
  let solarDay: number | null = null;
  let solarMonth: number | null = null;
  let solarYear: number | null = null;

  // Conversational relative intervals ("یه ربع دیگه", "نیم ساعت دیگه", "سه ربع دیگه", "2 ساعت دیگه", "45 دقیقه دیگه", "in 30 minutes", "in 2 hours")
  if (/(?:(?:یک|یه|1)\s*ربع\s*(?:دیگه|دیگر|بعد)|in\s+15\s+min)/i.test(norm)) {
    const target = new Date(now.getTime() + 15 * 60000);
    return {
      hour: target.getHours(),
      minute: target.getMinutes(),
      offsetDays: 0,
      solarDay: null,
      solarMonth: null,
      solarYear: null,
      hasExplicitDayOrDate: true,
    };
  }

  if (/(?:(?:سه|3)\s*ربع\s*(?:دیگه|دیگر|بعد)|in\s+45\s+min)/i.test(norm)) {
    const target = new Date(now.getTime() + 45 * 60000);
    return {
      hour: target.getHours(),
      minute: target.getMinutes(),
      offsetDays: 0,
      solarDay: null,
      solarMonth: null,
      solarYear: null,
      hasExplicitDayOrDate: true,
    };
  }

  if (/(?:نیم\s*ساعت\s*(?:دیگه|دیگر|بعد)|in\s+(?:half\s+an\s+hour|30\s+minutes))/i.test(norm)) {
    const target = new Date(now.getTime() + 30 * 60000);
    return {
      hour: target.getHours(),
      minute: target.getMinutes(),
      offsetDays: 0,
      solarDay: null,
      solarMonth: null,
      solarYear: null,
      hasExplicitDayOrDate: true,
    };
  }

  const relMinMatch =
    norm.match(/(\d+)\s*دقیقه\s*(دیگه|دیگر|بعد)/i) ||
    norm.match(/\bin\s+(\d+)\s*min(?:ute)?s?\b/i);
  if (relMinMatch) {
    const mins = parseInt(relMinMatch[1], 10);
    const target = new Date(now.getTime() + mins * 60000);
    return {
      hour: target.getHours(),
      minute: target.getMinutes(),
      offsetDays: 0,
      solarDay: null,
      solarMonth: null,
      solarYear: null,
      hasExplicitDayOrDate: true,
    };
  }

  const relHourMatch =
    norm.match(/(\d+)\s*ساعت\s*(دیگه|دیگر|بعد)/i) ||
    norm.match(/\bin\s+(\d+)\s*hours?\b/i);
  if (relHourMatch) {
    const hrs = parseInt(relHourMatch[1], 10);
    const target = new Date(now.getTime() + hrs * 3600000);
    return {
      hour: target.getHours(),
      minute: target.getMinutes(),
      offsetDays: 0,
      solarDay: null,
      solarMonth: null,
      solarYear: null,
      hasExplicitDayOrDate: true,
    };
  }

  let normWithoutDate = norm;

  // 1. Jalali Month Name & Day detection (e.g. "15 اردیبهشت 1405", "روز 10 آبان ماه سال 1405", "20 خرداد")
  for (let i = 0; i < PERSIAN_MONTHS.length; i++) {
    const mName = PERSIAN_MONTHS[i];
    const mRegex = new RegExp(
      `(?:(?:روز|تاریخ|مورخ|در\\s*تاریخ|برای\\s*روز|برای\\s*تاریخ)\\s*)?(\\d{1,2})(?:\\s*(?:ام|م))?\\s*${mName}(?:\\s*ماه)?(?:\\s*(?:سال\\s*)?(1[34]\\d{2}|\\d{2}))?`,
      'i'
    );
    const match = normWithoutDate.match(mRegex);
    if (match) {
      const d = parseInt(match[1], 10);
      if (d >= 1 && d <= 31) {
        solarDay = d;
        solarMonth = i + 1;
        solarYear = normalizeTwoOrFourDigitYear(match[2]);
        normWithoutDate = normWithoutDate.replace(match[0], ' ');
      }
      break;
    }
  }

  // 2. Gregorian Month Name & Day detection (e.g. "15 November 2026", "November 15, 2026", "۱۵ نوامبر ۲۰۲۶")
  if (!solarMonth) {
    for (const gm of GREGORIAN_MONTH_PATTERNS) {
      const mSource = gm.regex.source.replace(/^\\b|\\b$/g, '');
      const dFirstRegex = new RegExp(
        `\\b(\\d{1,2})(?:st|nd|rd|th|\\s*ام)?\\s+(?:of\\s+)?(?:${mSource})(?:[\\s,]+(20\\d{2}))?\\b`,
        'i'
      );
      const mFirstRegex = new RegExp(
        `\\b(?:${mSource})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:[\\s,]+(20\\d{2}))?\\b`,
        'i'
      );
      const match = normWithoutDate.match(dFirstRegex) || normWithoutDate.match(mFirstRegex);
      if (match) {
        const gDay = parseInt(match[1], 10);
        const gYear = match[2] ? parseInt(match[2], 10) : now.getFullYear();
        if (gDay >= 1 && gDay <= 31) {
          let gDate = new Date(gYear, gm.month - 1, gDay, 12, 0, 0);
          if (!match[2] && gDate.getTime() < now.getTime() - 86400000) {
            gDate = new Date(gYear + 1, gm.month - 1, gDay, 12, 0, 0);
          }
          const jalali = getJalaliComponents(gDate.getTime());
          solarDay = jalali.day;
          solarMonth = jalali.month;
          solarYear = jalali.year;
          normWithoutDate = normWithoutDate.replace(match[0], ' ');
        }
        break;
      }
    }
  }

  // 3. Numeric Gregorian Date: YYYY-MM-DD or YYYY/MM/DD where YYYY is 2024..2099
  if (!solarMonth) {
    const gregYmdRegex = /\b(20[2-9]\d)\s*(?:\/|-|\.)\s*(\d{1,2})\s*(?:\/|-|\.)\s*(\d{1,2})\b/;
    const gregMatch = normWithoutDate.match(gregYmdRegex);
    if (gregMatch) {
      const gy = parseInt(gregMatch[1], 10);
      const gm = parseInt(gregMatch[2], 10);
      const gd = parseInt(gregMatch[3], 10);
      if (gm >= 1 && gm <= 12 && gd >= 1 && gd <= 31) {
        const gDate = new Date(gy, gm - 1, gd, 12, 0, 0);
        const jalali = getJalaliComponents(gDate.getTime());
        solarDay = jalali.day;
        solarMonth = jalali.month;
        solarYear = jalali.year;
        normWithoutDate = normWithoutDate.replace(gregMatch[0], ' ');
      }
    }
  }

  // 4. Numeric Jalali Date: Day - Month - Year (e.g. "روز 10 8 1405", "10.8.1405", "10٫8٫1405", "10/8/1405", "روز 10 ماه 8 سال 1405")
  if (!solarMonth) {
    const dmyRegex =
      /(?:(?:روز|تاریخ|مورخ|در\s*تاریخ|برای\s*روز|برای\s*تاریخ)\s*)?\b(\d{1,2})(?:\s*(?:ام|م))?(?:\s*(?:\/|\.|٫|-|ماه\s*|برج\s*|\s+)\s*)(\d{1,2})(?:\s*(?:\/|\.|٫|-|سال\s*|\s+)\s*)(1[34]\d{2}|0[4-9]\b)/i;
    const dmyMatch = normWithoutDate.match(dmyRegex);
    if (dmyMatch) {
      const d = parseInt(dmyMatch[1], 10);
      const m = parseInt(dmyMatch[2], 10);
      const y = normalizeTwoOrFourDigitYear(dmyMatch[3]);
      if (d >= 1 && d <= 31 && m >= 1 && m <= 12 && y) {
        solarDay = d;
        solarMonth = m;
        solarYear = y;
        normWithoutDate = normWithoutDate.replace(dmyMatch[0], ' ');
      }
    }
  }

  // 5. Numeric Jalali Date: Year - Month - Day (e.g. "1405/8/10", "1405.8.10", "1405 8 10", "سال 1405 ماه 8 روز 10")
  if (!solarMonth) {
    const ymdRegex =
      /(?:(?:در\s*تاریخ|تاریخ|مورخ|سال)\s*)?\b(1[34]\d{2})(?:\s*(?:\/|\.|٫|-|ماه\s*|برج\s*|\s+)\s*)(\d{1,2})(?:\s*(?:\/|\.|٫|-|روز\s*|\s+)\s*)(\d{1,2})\b/i;
    const ymdMatch = normWithoutDate.match(ymdRegex);
    if (ymdMatch) {
      const y = parseInt(ymdMatch[1], 10);
      const m = parseInt(ymdMatch[2], 10);
      const d = parseInt(ymdMatch[3], 10);
      if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
        solarYear = y;
        solarMonth = m;
        solarDay = d;
        normWithoutDate = normWithoutDate.replace(ymdMatch[0], ' ');
      }
    }
  }

  // 6. Numeric Jalali Date without Year: Day & Month (e.g. "روز 10 8", "روز 10 ماه 8", "10 برج 8", "10/8", "10.8", "10٫8")
  if (!solarMonth) {
    const dmExplicitRegex =
      /(?:(?:روز|تاریخ|مورخ|در\s*تاریخ)\s+)(\d{1,2})(?:\s*(?:ام|م))?(?:\s*(?:\/|\.|٫|-|ماه\s*|برج\s*|\s+)\s*)(\d{1,2})\b(?!\s*(?:\/|\.|٫|-|:)\s*\d)/i;
    const dmSeparatorRegex =
      /\b(\d{1,2})\s*(?:\/|\.|٫|ماه|برج)\s*(\d{1,2})\b(?!\s*(?:\/|\.|٫)\s*\d)/i;
    const dmMatch =
      normWithoutDate.match(dmExplicitRegex) || normWithoutDate.match(dmSeparatorRegex);
    if (dmMatch) {
      const first = parseInt(dmMatch[1], 10);
      const second = parseInt(dmMatch[2], 10);
      if (first >= 1 && first <= 31 && second >= 1 && second <= 12) {
        solarDay = first;
        solarMonth = second;
        normWithoutDate = normWithoutDate.replace(dmMatch[0], ' ');
      }
    }
  }

  // 7. Single Day of Month (e.g. "روز 25م", "روز 10 ام", or standalone "15 ام" / "20" when expectDayOnly is true)
  if (!solarMonth && !solarDay) {
    const singleDayMatch =
      normWithoutDate.match(
        /(?:روز|تاریخ)\s+(\d{1,2})\s*(?:ام|م)?(?=\s|$|[.،,/:؛!?-])(?!\s*(?:صبح|ظهر|عصر|شب|ساعت|دقیقه|روز|دیگه|دیگر|بعد))/i
      ) ||
      (expectDayOnly
        ? normWithoutDate.match(
            /^\s*(?:روز\s*|تاریخ\s*)?(\d{1,2})\s*(?:ام|م)?(?:\s*(?:همین\s*ماه|ماه\s*جاری|باشه|خوبه))?\s*$/i
          )
        : null);
    if (singleDayMatch) {
      const d = parseInt(singleDayMatch[1], 10);
      if (d >= 1 && d <= 31) {
        const nowJalali = getJalaliComponents(now.getTime());
        solarDay = d;
        solarMonth = d >= nowJalali.day ? nowJalali.month : (nowJalali.month % 12) + 1;
        normWithoutDate = normWithoutDate.replace(singleDayMatch[0], ' ');
      }
    }
  }

  // 8. Relative day expressions ("امروز", "فردا", "پس فردا", "چهار روز دیگه", "3 روز دیگر", "هفته آینده", "in 4 days")
  const nDaysLaterMatch =
    normWithoutDate.match(/(?:^|\s)(\d{1,3})\s*روز\s*(دیگه|دیگر|بعد|آینده)(?=\s|$|[.،,/:؛!?-])/i) ||
    normWithoutDate.match(/\bin\s+(\d{1,3})\s*days?\b/i) ||
    normWithoutDate.match(/\b(\d{1,3})\s*days?\s*(later|from\s+now)\b/i);

  const nWeeksLaterMatch =
    normWithoutDate.match(/(?:^|\s)(\d{1,2})\s*هفته\s*(دیگه|دیگر|بعد|آینده)(?=\s|$|[.،,/:؛!?-])/i) ||
    normWithoutDate.match(/\bin\s+(\d{1,2})\s*weeks?\b/i);

  if (nDaysLaterMatch) {
    offsetDays = parseInt(nDaysLaterMatch[1], 10);
    normWithoutDate = normWithoutDate.replace(nDaysLaterMatch[0], ' ');
  } else if (nWeeksLaterMatch) {
    offsetDays = parseInt(nWeeksLaterMatch[1], 10) * 7;
    normWithoutDate = normWithoutDate.replace(nWeeksLaterMatch[0], ' ');
  } else if (/(?:پس\s*فردا|day\s+after\s+tomorrow)/i.test(normWithoutDate)) {
    offsetDays = 2;
  } else if (/(?:فردا|tomorrow)/i.test(normWithoutDate)) {
    offsetDays = 1;
  } else if (/(?:امروز|امشب|today|tonight)/i.test(normWithoutDate)) {
    offsetDays = 0;
  } else if (/(?:هفته\s*(?:آینده|بعد|دیگه|دیگر)|next\s+week)/i.test(normWithoutDate)) {
    offsetDays = 7;
  } else if (/(?:ماه\s*(?:آینده|بعد|دیگه|دیگر)|next\s+month)/i.test(normWithoutDate)) {
    offsetDays = 30;
  } else if (!solarMonth) {
    // Check Persian & English weekday names
    for (const item of WEEKDAY_JS_INDEX) {
      if (item.pattern.test(rawCleaned)) {
        const todayJs = now.getDay();
        let diff = (item.jsDay - todayJs + 7) % 7;
        if (diff === 0) diff = 7;
        offsetDays = diff;
        break;
      }
    }
  }

  // 9. Natural & 24-hour Time Extraction:
  // Support "یک ربع به X" / "یه ربع به X" / "quarter to X"
  const quarterToMatch =
    normWithoutDate.match(/(?:یک|یه|1)?\s*ربع\s+به\s+(\d{1,2})\s*(صبح|قبل\s*از\s*ظهر|ظهر|بعد\s*از\s*ظهر|عصر|غروب|شب|بامداد|بعد\s*از\s*نصفه\s*شب|نصفه\s*شب|نیمه\s*شب)?/i) ||
    normWithoutDate.match(/\bquarter\s+to\s+(\d{1,2})\s*(am|pm|in\s+the\s+morning|in\s+the\s+afternoon|in\s+the\s+evening|at\s+night)?/i);

  if (quarterToMatch) {
    let targetHour = parseInt(quarterToMatch[1], 10);
    const period = quarterToMatch[2] || '';
    targetHour = applyTimePeriod(targetHour, period || normWithoutDate);
    hour = (targetHour + 23) % 24;
    minute = 45;
  } else if (!expectDayOnly || /(?:ساعت|صبح|ظهر|عصر|غروب|شب|بامداد|am|pm|:)/i.test(normWithoutDate)) {
    // HH:MM format (e.g. 18:30, 08:15, 4:30 pm, 4:30 بعد از ظهر)
    const colonTime = normWithoutDate.match(
      /(?:ساعت\s*|at\s*)?(\d{1,2}):(\d{2})(?:\s*(صبح|قبل\s*از\s*ظهر|ظهر|بعد\s*از\s*ظهر|عصر|غروب|شب|بامداد|بعد\s*از\s*نصفه\s*شب|نصفه\s*شب|نیمه\s*شب|am|pm|a\.m\.|p\.m\.))?/i
    );
    if (colonTime) {
      let h = parseInt(colonTime[1], 10);
      const m = parseInt(colonTime[2], 10);
      const period = colonTime[3] || '';
      h = applyTimePeriod(h, period || normWithoutDate);
      if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
        hour = h;
        minute = m;
      }
    } else {
      const periodPattern =
        '(?:صبح|قبل\\s*از\\s*ظهر|ظهر|بعد\\s*از\\s*ظهر|عصر|غروب|شب|بامداد|بعد\\s*از\\s*نصفه\\s*شب|بعد\\s*از\\s*نیمه\\s*شب|نصفه\\s*شب|نیمه\\s*شب|am|pm|a\\.m\\.|p\\.m\\.|in\\s+the\\s+morning|in\\s+the\\s+afternoon|in\\s+the\\s+evening|at\\s+night|after\\s+midnight)';

      const explicitSaatMatch = normWithoutDate.match(
        new RegExp(
          `(?:ساعت|at)\\s*(\\d{1,2})(?:\\s*(?:و|and|:)?\\s*(نیم|ربع|half|\\d{1,2})\\s*(?:دقیقه|minutes?|mins?)?)?\\s*(${periodPattern})?`,
          'i'
        )
      );

      const implicitTimeMatch =
        normWithoutDate.match(
          new RegExp(
            `(?:^|\\s)(\\d{1,2})\\s*و\\s*(نیم|ربع|\\d{1,2})\\s*(?:دقیقه)?\\s*(${periodPattern})?`,
            'i'
          )
        ) ||
        normWithoutDate.match(
          new RegExp(`(?:^|\\s)(\\d{1,2})\\s*()(${periodPattern})(?=\\s|$|[.،,/:؛!?-])`, 'i')
        ) ||
        (expectTimeOnly
          ? normWithoutDate.match(
              /^\s*(?:ساعت\s*|برای\s*ساعت\s*)?(\d{1,2})(?:\s*(?:و)?\s*(\d{1,2}|نیم|ربع))?(?:\s*دقیقه)?\s*(صبح|قبل\s*از\s*ظهر|ظهر|بعد\s*از\s*ظهر|عصر|غروب|شب|بامداد)?(?:\s*(?:باشه|خوبه|بذار|تنظیم\s*کن|ثبت\s*کن))?\s*$/i
            )
          : null);

      const chosenTimeMatch = explicitSaatMatch || implicitTimeMatch;

      if (chosenTimeMatch) {
        let h = parseInt(chosenTimeMatch[1], 10);
        let m = 0;
        const minPart = (chosenTimeMatch[2] || '').toLowerCase();
        const period = chosenTimeMatch[3] || '';

        if (minPart === 'نیم' || minPart === 'half') m = 30;
        else if (minPart === 'ربع') m = 15;
        else if (minPart && /^\d+$/.test(minPart)) m = parseInt(minPart, 10);

        h = applyTimePeriod(h, period || normWithoutDate);

        if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
          hour = h;
          minute = m;
        }
      } else {
        // Standalone time-of-day phrases without digits ("نصفه شب", "نیمه شب", "سر ظهر", "اول صبح", "غروب")
        if (/(?:نصفه\s*شب|نیمه\s*شب|\bmidnight\b)/i.test(rawCleaned)) {
          hour = 0;
          minute = 0;
        } else if (/(?:اول\s*صبح|کله\s*سحر)/i.test(rawCleaned)) {
          hour = 7;
          minute = 30;
        } else if (/(?:سر\s*ظهر|\bnoon\b|^ظهر$)/i.test(rawCleaned)) {
          hour = 12;
          minute = 0;
        } else if (/^غروب$/i.test(rawCleaned)) {
          hour = 18;
          minute = 30;
        } else if (/آخر\s*شب/i.test(rawCleaned)) {
          hour = 23;
          minute = 0;
        }
      }
    }
  }

  const hasExplicitDayOrDate =
    offsetDays !== null || (solarDay !== null && solarMonth !== null);

  return {
    hour,
    minute,
    offsetDays,
    solarDay,
    solarMonth,
    solarYear,
    hasExplicitDayOrDate,
  };
}

/**
 * تبدیل ساعت ۱۲ ساعته به ۲۴ ساعته بر اساس قیدهای زمانی (صبح، قبل از ظهر، ظهر، بعد از ظهر، عصر، غروب، شب، بعد از نصفه‌شب، بامداد، AM/PM)
 */
function applyTimePeriod(rawHour: number, periodText: string): number {
  let h = rawHour;
  const p = (periodText || '').toLowerCase();

  if (/(?:بعد\s*از\s*نصفه\s*شب|بعد\s*از\s*نیمه\s*شب|نصفه\s*شب|نیمه\s*شب|بامداد|after\s+midnight|midnight)/i.test(p)) {
    if (h === 12) return 0;
    return h;
  }

  if (/(?:قبل\s*از\s*ظهر|صبح|\bam\b|a\.m\.|in\s+the\s+morning)/i.test(p)) {
    if (h === 12) return 0;
    return h;
  }

  if (/(?:بعد\s*از\s*ظهر|عصر|غروب|\bpm\b|p\.m\.|in\s+the\s+afternoon|in\s+the\s+evening)/i.test(p)) {
    if (h < 12) return h + 12;
    return h;
  }

  if (/(?:شب|امشب|at\s+night)/i.test(p)) {
    if (h === 12) return 0;
    if (h >= 5 && h < 12) return h + 12;
    return h;
  }

  if (/ظهر/i.test(p)) {
    if (h >= 1 && h <= 4) return h + 12;
    return h;
  }

  return h;
}

export function cleanExtractedTitle(rawText: string, intent: SmartIntentType): string {
  let t = normalizePersianSpeech(rawText)
    .replace(
      /^(?:(?:سلام|درود|علیک\s*سلام|خسته\s*نباشید|وقت\s*بخیر|صبح\s*بخیر|عصر\s*بخیر|شب\s*بخیر|hello|hi|hey)[\s،,.:؛!?-]*)+/gi,
      ''
    )
    .replace(
      /^(لطفاً|لطفا|بیزحمت|دیگه|من|میخوام|می‌خوام|میخواهم|می‌خواهم|ثبت کن|ذخیره کن|اضافه کن|بنویس|یادآوری کن|یادم بنداز|یادم بیار|یه یادآور|یک یادآور|یادآور|یه ایده دارم|ایده دارم|یه ایده|یک ایده|ایده جدید|ایده|مکان جدید|لوکیشن جدید|مکان|لوکیشن|مناسبت جدید|مناسبت|عنوانش رو بکن|عنوانش بشه|تغییر عنوان به|remind me to|set a reminder for|set a reminder to|save location|new idea|idea|reminder|occasion|location)\s*/gi,
      ''
    )
    .replace(/\b(که|رو|را|باشه|حله|برام|برایم)\b\s*$/gi, '');

  // Strip Jalali month dates
  for (const mName of PERSIAN_MONTHS) {
    const reg = new RegExp(
      `(?:در\\s*تاریخ\\s*|برای\\s*تاریخ\\s*|برای\\s*روز\\s*|تاریخ\\s*|روز\\s*|مورخ\\s*)?(\\d{1,2})(?:\\s*(?:ام|م))?\\s*${mName}(?:\\s*ماه)?(?:\\s*(?:سال\\s*)?(?:1[34]\\d{2}|\\d{2}))?`,
      'gi'
    );
    t = t.replace(reg, ' ');
  }

  // Strip Gregorian month dates
  for (const gm of GREGORIAN_MONTH_PATTERNS) {
    const mSource = gm.regex.source.replace(/^\\b|\\b$/g, '');
    t = t
      .replace(
        new RegExp(
          `(?:on\\s+|در\\s*تاریخ\\s*|روز\\s*)?\\b\\d{1,2}(?:st|nd|rd|th|\\s*ام)?\\s+(?:of\\s+)?(?:${mSource})(?:[\\s,]+20\\d{2})?\\b`,
          'gi'
        ),
        ' '
      )
      .replace(
        new RegExp(
          `(?:on\\s+)?\\b(?:${mSource})\\s+\\d{1,2}(?:st|nd|rd|th)?(?:[\\s,]+20\\d{2})?\\b`,
          'gi'
        ),
        ' '
      );
  }

  // Strip numeric dates
  t = t
    .replace(/\b20[2-9]\d\s*(?:\/|-|\.)\s*\d{1,2}\s*(?:\/|-|\.)\s*\d{1,2}\b/gi, ' ')
    .replace(
      /(?:در\s*تاریخ\s*|برای\s*تاریخ\s*|برای\s*روز\s*|تاریخ\s*|روز\s*|مورخ\s*)?\b\d{1,2}(?:\s*(?:ام|م))?(?:\s*(?:\/|\.|٫|-|ماه\s*|برج\s*|\s+)\s*)\d{1,2}(?:\s*(?:\/|\.|٫|-|سال\s*|\s+)\s*)(?:1[34]\d{2}|0[4-9]\b)/gi,
      ' '
    )
    .replace(
      /(?:در\s*تاریخ\s*|تاریخ\s*|مورخ\s*|سال\s*)?\b1[34]\d{2}(?:\s*(?:\/|\.|٫|-|ماه\s*|برج\s*|\s+)\s*)\d{1,2}(?:\s*(?:\/|\.|٫|-|روز\s*|\s+)\s*)\d{1,2}\b/gi,
      ' '
    )
    .replace(
      /(?:در\s*تاریخ\s*|تاریخ\s*|روز\s*|مورخ\s+)\d{1,2}(?:\s*(?:ام|م))?(?:\s*(?:\/|\.|٫|-|ماه\s*|برج\s*|\s+)\s*)\d{1,2}\b/gi,
      ' '
    )
    .replace(/\b\d{1,2}\s*(?:\/|\.|٫|ماه|برج)\s*\d{1,2}\b/gi, ' ')
    .replace(/(?:روز|تاریخ)\s+\d{1,2}\s*(?:ام|م)?(?=\s|$|[.،,/:؛!?-])(?!\s*(?:دیگه|دیگر|بعد))/gi, ' ');

  if (intent === 'reminder' || intent === 'unknown') {
    t = t
      .replace(/(?:^|\s)\d{1,3}\s*(?:روز|هفته)\s*(?:دیگه|دیگر|بعد|آینده)(?=\s|$|[.،,/:؛!?-])/gi, ' ')
      .replace(/\bin\s+\d{1,3}\s*(?:days?|weeks?|hours?|minutes?)\b/gi, ' ')
      .replace(/(?:امروز|فردا|پس\s*فردا|امشب|هفته\s*آینده|هفته\s*بعد|ماه\s*آینده|ماه\s*بعد|today|tomorrow|tonight|day\s+after\s+tomorrow|next\s+week|next\s+month)/gi, ' ')
      .replace(/(?:^|\s)(یک\s*شنبه|دو\s*شنبه|سه\s*شنبه|چهار\s*شنبه|پنج\s*شنبه|شنبه|جمعه|saturday|sunday|monday|tuesday|wednesday|thursday|friday)(?=\s|$|[.،,/:؛!?-])/gi, ' ')
      .replace(/(?:یک|یه|1)?\s*ربع\s+به\s+\d{1,2}\s*(?:صبح|قبل\s*از\s*ظهر|ظهر|بعد\s*از\s*ظهر|عصر|غروب|شب|بامداد|بعد\s*از\s*نصفه\s*شب|نصفه\s*شب|نیمه\s*شب)?/gi, ' ')
      .replace(/(?:ساعت|at)\s*\d{1,2}(?::\d{2})?(?:\s*و\s*(?:نیم|ربع|\d{1,2})\s*(?:دقیقه)?)?\s*(?:صبح|قبل\s*از\s*ظهر|ظهر|بعد\s*از\s*ظهر|عصر|غروب|شب|بامداد|بعد\s*از\s*نصفه\s*شب|نصفه\s*شب|نیمه\s*شب|am|pm)?/gi, ' ')
      .replace(/(?:^|\s)\d{1,2}\s*و\s*(?:نیم|ربع|\d{1,2})(?:\s*دقیقه)?\s*(?:صبح|قبل\s*از\s*ظهر|ظهر|بعد\s*از\s*ظهر|عصر|غروب|شب|بامداد|بعد\s*از\s*نصفه\s*شب|نصفه\s*شب|نیمه\s*شب)?/gi, ' ')
      .replace(/(?:^|\s)\d{1,2}(?::\d{2})\s*(?:صبح|قبل\s*از\s*ظهر|ظهر|بعد\s*از\s*ظهر|عصر|غروب|شب|بامداد|am|pm)?/gi, ' ')
      .replace(/(?:^|\s)\d{1,2}\s*(?:صبح|قبل\s*از\s*ظهر|ظهر|بعد\s*از\s*ظهر|عصر|غروب|شب|بامداد|بعد\s*از\s*نصفه\s*شب|نصفه\s*شب|نیمه\s*شب|am|pm)(?=\s|$|[.،,/:؛!?-])/gi, ' ')
      .replace(/(?:^|\s)(نیم|یک|یه|سه|\d+)\s*(ربع|ساعت|دقیقه)\s*(دیگه|دیگر|بعد)/gi, ' ')
      .replace(/(?:^|\s)(اول\s*صبح|سر\s*ظهر|آخر\s*شب|نصفه\s*شب|نیمه\s*شب|غروب|midnight|noon)(?=\s|$|[.،,/:؛!?-])/gi, ' ')
      .replace(/(?:^|\s)(یادم\s*بنداز|یادم\s*بیار|بهم\s*خبر\s*بده|خبر\s*بده|یادآوری\s*کن|باشه|در\s*ساعت|برای\s*ساعت|در\s*روز|برای\s*روز)(?=\s|$|[.،,/:؛!?-])/gi, ' ');
  } else if (intent === 'occasion') {
    t = t.replace(/(?:^|\s)(باشه|حله|ثبتش کن|ثبت کن)(?=\s|$|[.،,/:؛!?-])/gi, ' ');
  } else if (intent === 'location') {
    t = t.replace(/(اینجا رو|این مکان رو|لوکیشن فعلی رو|با نام|به اسم|به نام|با اسم)/gi, ' ');
  }

  t = t
    .replace(/^[\s،,.:٫-]+|[\s،,.:٫-]+$/g, '')
    .replace(/^(که|رو|را|در|برای|روز|تاریخ|ساعت|on|at|for)\s+/i, '')
    .replace(/\s+(رو|را|برام|برایم|در|روز|تاریخ|ساعت|on|at|for)\s*(ثبت کن|ذخیره کن|بذار|بگذار|باشه)?$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  return t;
}

/**
 * فرمت نمایش روز/تاریخ برای خوانش صوتی و متنی به زبان فارسی یا انگلیسی
 */
export function formatDraftDayLabel(draft: SmartCaptureDraft, isEn: boolean): string {
  const hasSolarDate =
    typeof draft.solarDay === 'number' &&
    draft.solarDay >= 1 &&
    typeof draft.solarMonth === 'number' &&
    draft.solarMonth >= 1;

  if (hasSolarDate) {
    if (isEn) {
      const ts = computeReminderTimestampFromDraft(draft);
      const d = new Date(ts);
      const gMonthName = ENGLISH_MONTHS[d.getMonth()] || 'Month';
      return `${gMonthName} ${d.getDate()}, ${d.getFullYear()}`;
    }
    return `${toPersianDigits(draft.solarDay!)} ${PERSIAN_MONTHS[draft.solarMonth! - 1]}${
      draft.solarYear ? ` ${toPersianDigits(draft.solarYear)}` : ''
    }`;
  }

  const offset = typeof draft.offsetDays === 'number' ? draft.offsetDays : 0;
  if (isEn) {
    if (offset === 0) return 'today';
    if (offset === 1) return 'tomorrow';
    if (offset === 2) return 'the day after tomorrow';
    if (offset === 7) return 'next week';
    return `in ${offset} days`;
  }

  if (offset === 0) return 'امروز';
  if (offset === 1) return 'فردا';
  if (offset === 2) return 'پس‌فردا';
  if (offset === 7) return 'هفته آینده';
  return `${toPersianDigits(offset)} روز دیگر`;
}

let greetingRotationCounter = 0;
let stepQuestionRotationCounter = 0;

/**
 * انتخاب جمله کوتاه و متنوع برای شروع گفتگو
 */
export function pickInitialGreeting(language: 'fa' | 'en' = 'fa'): string {
  const idx = greetingRotationCounter++ % 3;
  if (language === 'en') {
    const enGreetings = [
      'Hello! Go ahead, I am ready to save it.',
      'Hi there! Please go ahead, I am listening.',
      'Hello! What would you like me to save for you?',
    ];
    return enGreetings[idx];
  }
  const faGreetings = [
    'سلام؛ بفرمایید ثبت کنم.',
    'سلام؛ بفرمایید، منتظرم.',
    'سلام؛ در خدمتم، بفرمایید.',
  ];
  return faGreetings[idx];
}

/**
 * انتخاب جمله کوتاه و مودبانه در صورت نامفهوم بودن صدای کاربر (با قانون ۳ بار تلاش)
 */
export function pickUnclearRetryPrompt(
  retryCount: number,
  language: 'fa' | 'en' = 'fa'
): string {
  if (language === 'en') {
    if (retryCount >= 3) {
      return 'Sorry, I still could not hear you clearly. Please type it below.';
    }
    return retryCount === 1
      ? 'I did not catch that. Could you please say it one more time?'
      : 'Your voice was not clear. Please say it again.';
  }

  if (retryCount >= 3) {
    return 'ببخشید باز هم متوجه نشدم؛ لطفاً همین پایین تایپ کنید.';
  }
  return retryCount === 1
    ? 'متوجه نشدم؛ لطفاً یه بار دیگه بگید.'
    : 'صداتون واضح نبود؛ لطفاً دوباره بفرمایید.';
}

/**
 * بررسی اینکه آیا عبارت شنیده‌شده در مرحله فعلی معنی‌دار است یا صدای نامفهوم/نویز بوده است
 */
export function isMeaningfulStepInput(
  rawText: string,
  currentDraft: SmartCaptureDraft
): boolean {
  const cleaned = correctPersianAsrErrors(rawText || '').trim();
  if (!cleaned || cleaned.length < 2) return false;

  // Reject pure filler sounds or standalone greetings without any command
  if (
    /^(ام+|اا+|هم+|اه+|او+|هوم+|نگاه|صدا|تست|الو|سلام|درود|علیک سلام|خسته نباشید|um+|uh+|hmm+|hello|hi)$/i.test(
      cleaned
    )
  ) {
    return false;
  }

  if (isConfirmationUtterance(cleaned) || isRejectionOrEditUtterance(cleaned)) {
    return true;
  }

  if (/^(عنوان|موضوع|اسم|نام|روز|تاریخ|ساعت|زمان|آلارم|title|subject|day|date|time|alarm)/i.test(cleaned)) {
    return true;
  }

  const step = currentDraft.wizardStep || 'ask_subject';
  const timeInfo = extractTimeAndDate(cleaned, step === 'ask_time', step === 'ask_day');

  if (step === 'ask_day') {
    return (
      timeInfo.hasExplicitDayOrDate ||
      timeInfo.solarDay !== null ||
      timeInfo.offsetDays !== null ||
      /(عنوانش|موضوعش|اسمش|تغییر|عوض)/i.test(cleaned)
    );
  }

  if (step === 'ask_time') {
    return (
      timeInfo.hour !== null ||
      timeInfo.hasExplicitDayOrDate ||
      /(عنوانش|موضوعش|روزش|تغییر|عوض)/i.test(cleaned)
    );
  }

  if (step === 'confirm') {
    return (
      timeInfo.hour !== null ||
      timeInfo.hasExplicitDayOrDate ||
      /(عنوانش|موضوعش|روزش|ساعتش|تغییر|عوض|ویرایش)/i.test(cleaned)
    );
  }

  return true;
}

/**
 * موتور مرحله‌ای هوشمند (۶ گام استاندارد برای یادآور، مناسبت، مکان و ایده با سوالات کوتاه و متنوع)
 */
export function analyzeSmartCaptureLocally(
  messages: SmartChatMessage[],
  currentDraft: SmartCaptureDraft,
  language: 'fa' | 'en' = 'fa'
): SmartAnalysisResult {
  const isEn = language === 'en';
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')?.text.trim() || '';
  const normLast = normalizePersianSpeech(lastUserMsg);
  const vIdx = stepQuestionRotationCounter++ % 3;

  const isConfirmCommand = isConfirmationUtterance(lastUserMsg);
  const isRejectOrEdit = isRejectionOrEditUtterance(lastUserMsg);

  let intent: SmartIntentType = currentDraft.intentType || 'unknown';
  const detectedNow = detectIntentFromText(lastUserMsg, intent);
  if (
    intent === 'unknown' ||
    /^(یادآور|مناسبت|مکان|ایده|reminder|occasion|location|idea)$/i.test(lastUserMsg.trim())
  ) {
    intent = detectedNow;
  }

  const expectTimeOnly = currentDraft.wizardStep === 'ask_time';
  const expectDayOnly = currentDraft.wizardStep === 'ask_day';
  const timeInfo = extractTimeAndDate(lastUserMsg, expectTimeOnly, expectDayOnly);
  const candidateTitle = cleanExtractedTitle(lastUserMsg, intent);

  const nextDraft: SmartCaptureDraft = {
    ...currentDraft,
    intentType: intent,
  };

  // Merge extracted Day/Date into draft
  if (timeInfo.solarDay !== null && timeInfo.solarMonth !== null) {
    nextDraft.solarDay = timeInfo.solarDay;
    nextDraft.solarMonth = timeInfo.solarMonth;
    if (timeInfo.solarYear !== null) {
      nextDraft.solarYear = timeInfo.solarYear;
    }
    nextDraft.offsetDays = undefined;
    nextDraft.daySpecified = true;
  } else if (timeInfo.offsetDays !== null) {
    nextDraft.offsetDays = timeInfo.offsetDays;
    nextDraft.solarDay = undefined;
    nextDraft.solarMonth = undefined;
    nextDraft.solarYear = undefined;
    nextDraft.daySpecified = true;
  }

  // Merge extracted Time into draft
  if (timeInfo.hour !== null) {
    nextDraft.hour = timeInfo.hour;
    nextDraft.minute = timeInfo.minute ?? 0;
  }

  // Detect Category & Priority
  if (/(کاری|شرکت|جلسه|پروژه|اداره|مدیر|چک|بانک|فاکتور|work|office|meeting|invoice)/i.test(normLast)) {
    nextDraft.category = 'work';
  } else if (/(خانواده|تولد|همسر|مادر|پدر|فرزند|مهمانی|شام|ناهار|family|mother|father|spouse)/i.test(normLast)) {
    nextDraft.category = 'family';
  } else if (!nextDraft.category) {
    nextDraft.category = 'other';
  }

  if (/(فوری|خیلی مهم|ضروری|حیاتی|اورژانسی|urgent|important|high priority)/i.test(normLast)) {
    nextDraft.priority = 'high';
  } else if (!nextDraft.priority) {
    nextDraft.priority = 'medium';
  }

  // Detect Occasion Type
  if (intent === 'occasion') {
    if (/تولد|زادروز|birthday/i.test(normLast)) nextDraft.occasionType = 'birthday';
    else if (/ازدواج|عقد|wedding|anniversary/i.test(normLast)) nextDraft.occasionType = 'wedding';
    else if (/آشنایی|dating/i.test(normLast)) nextDraft.occasionType = 'dating';
    else if (/فوت|درگذشت|وفات|یادبود|memorial/i.test(normLast)) nextDraft.occasionType = 'memorial';
    else if (!nextDraft.occasionType) nextDraft.occasionType = 'custom';
  }

  // Handle user saying "نه / ویرایش" without specifying what to change
  if (isRejectOrEdit && !timeInfo.hasExplicitDayOrDate && timeInfo.hour === null) {
    nextDraft.wizardStep = 'ask_subject';
    return {
      intentType: nextDraft.intentType,
      isComplete: false,
      shouldAutoSubmit: false,
      clarifyingQuestion: isEn
        ? 'No problem. Please tell me which part you would like to change (the title, day, or time)?'
        : 'خواهش می‌کنم؛ لطفاً بفرمایید کدام بخش (عنوان، روز یا ساعت) را می‌خواهید تغییر دهید؟',
      draft: nextDraft,
    };
  }

  // Handle user answering "عنوان / موضوع" or "روز / تاریخ" or "ساعت / زمان" after asking what to edit
  if (/^(عنوان|موضوع|اسم|نام|title|subject|name)$/i.test(lastUserMsg.trim())) {
    nextDraft.title = undefined;
    nextDraft.wizardStep = 'ask_subject';
  } else if (/^(روز|تاریخ|day|date)$/i.test(lastUserMsg.trim())) {
    nextDraft.daySpecified = false;
    nextDraft.offsetDays = undefined;
    nextDraft.solarDay = undefined;
    nextDraft.solarMonth = undefined;
    nextDraft.wizardStep = 'ask_day';
  } else if (/^(ساعت|زمان|آلارم|time|alarm)$/i.test(lastUserMsg.trim())) {
    nextDraft.hour = undefined;
    nextDraft.minute = undefined;
    nextDraft.wizardStep = 'ask_time';
  }

  // Smart Title Locking:
  const isPureCategoryWord = /^(یادآور|مناسبت|مکان|ایده|عنوان|موضوع|روز|تاریخ|ساعت|زمان|بله|تایید|ثبت کن|امروز|فردا|پس فردا|شنبه|یکشنبه|دوشنبه|سه شنبه|چهارشنبه|پنجشنبه|جمعه|reminder|occasion|location|idea|title|day|date|time|today|tomorrow|yes|ok|confirm)$/i.test(
    lastUserMsg.replace(/\u200c/g, ' ').trim()
  );
  const isPureTimeOrDatePhrase =
    candidateTitle.length < 2 ||
    /^(\d{1,2}(:\d{2})?|\d{1,2}\s*(صبح|قبل از ظهر|ظهر|بعد از ظهر|عصر|غروب|شب|بامداد|am|pm)|ساعت\s*\d+|نصفه شب|نیمه شب)$/i.test(
      candidateTitle
    );
  const isExplicitTitleEdit =
    /(عنوانش|موضوعش|اسمش|تغییر عنوان|ویرایش عنوان|تغییر نام|change title|rename)/i.test(
      lastUserMsg
    );

  const canCaptureTitleInThisStep =
    !nextDraft.title ||
    currentDraft.wizardStep === 'ask_subject' ||
    isExplicitTitleEdit;

  if (
    canCaptureTitleInThisStep &&
    !isPureCategoryWord &&
    !isPureTimeOrDatePhrase &&
    candidateTitle.length >= 2 &&
    !isConfirmCommand &&
    !isRejectOrEdit
  ) {
    nextDraft.title = candidateTitle;
  }

  const faConfirmQuestions = [
    'همه‌چی آماده‌ست؛ ثبتش کنم؟',
    'تنظیم شد؛ مورد تاییده که ثبت بشه؟',
  ];

  // CASE 0: Unknown Intent -> Step 1: Ask for Subject
  if (nextDraft.intentType === 'unknown') {
    nextDraft.wizardStep = 'ask_subject';
    return {
      intentType: 'unknown',
      isComplete: false,
      clarifyingQuestion: pickInitialGreeting(language),
      draft: nextDraft,
    };
  }

  // ============================================================================
  // CASE 1: REMINDER (یادآور) — سوالات کوتاه، متنوع و صمیمی
  // ============================================================================
  if (nextDraft.intentType === 'reminder') {
    const hasTitle = Boolean(nextDraft.title && nextDraft.title.trim().length >= 2);
    const hasDay = Boolean(
      nextDraft.daySpecified ||
        (typeof nextDraft.solarDay === 'number' &&
          nextDraft.solarDay >= 1 &&
          typeof nextDraft.solarMonth === 'number' &&
          nextDraft.solarMonth >= 1) ||
        typeof nextDraft.offsetDays === 'number'
    );
    const hasTime = typeof nextDraft.hour === 'number' && nextDraft.hour >= 0;

    if (!hasTitle) {
      nextDraft.wizardStep = 'ask_subject';
      return {
        intentType: 'reminder',
        isComplete: false,
        clarifyingQuestion: isEn
          ? 'Please tell me the subject or title of your reminder?'
          : 'لطفاً موضوع یا عنوان یادآور مورد نظر خود را بفرمایید؟',
        draft: nextDraft,
      };
    }

    if (!hasDay) {
      nextDraft.wizardStep = 'ask_day';
      const faDayQuestions = [
        'چه روزی یادتون بندازم؟',
        'برای کدوم روز تنظیمش کنم؟',
        'کی بهتون یادآوری کنم؟',
      ];
      return {
        intentType: 'reminder',
        isComplete: false,
        clarifyingQuestion: isEn
          ? `On which day or date should I remind you about "${nextDraft.title}"?`
          : faDayQuestions[vIdx],
        draft: nextDraft,
      };
    }

    if (!hasTime) {
      nextDraft.wizardStep = 'ask_time';
      const dayLabel = formatDraftDayLabel(nextDraft, isEn);
      const faTimeQuestions = [
        'ساعت چند یادآوری کنم؟',
        'آلارمش روی چه ساعتی باشه؟',
        'چه ساعتی بهتون خبر بدم؟',
      ];
      return {
        intentType: 'reminder',
        isComplete: false,
        clarifyingQuestion: isEn
          ? `What time should I set the alarm for "${nextDraft.title}" on ${dayLabel}?`
          : faTimeQuestions[vIdx],
        draft: nextDraft,
      };
    }

    if (nextDraft.minute === undefined || nextDraft.minute === null || nextDraft.minute < 0) {
      nextDraft.minute = 0;
    }
    nextDraft.wizardStep = 'confirm';

    const dayLabel = formatDraftDayLabel(nextDraft, isEn);
    const timeLabel = `${String(nextDraft.hour).padStart(2, '0')}:${String(nextDraft.minute).padStart(2, '0')}`;

    return {
      intentType: 'reminder',
      isComplete: true,
      shouldAutoSubmit: isConfirmCommand,
      clarifyingQuestion: isEn
        ? `"${nextDraft.title}" for ${dayLabel} at ${timeLabel}. Do you confirm saving it?`
        : faConfirmQuestions[vIdx % 2],
      draft: nextDraft,
    };
  }

  // ============================================================================
  // CASE 2: OCCASION (مناسبت)
  // ============================================================================
  if (nextDraft.intentType === 'occasion') {
    const hasTitle = Boolean(nextDraft.title && nextDraft.title.trim().length >= 2);
    const hasDate =
      typeof nextDraft.solarDay === 'number' &&
      nextDraft.solarDay >= 1 &&
      typeof nextDraft.solarMonth === 'number' &&
      nextDraft.solarMonth >= 1;

    if (!hasTitle) {
      nextDraft.wizardStep = 'ask_subject';
      return {
        intentType: 'occasion',
        isComplete: false,
        clarifyingQuestion: isEn
          ? 'Please tell me the title of this occasion?'
          : 'لطفاً عنوان این مناسبت را بفرمایید؟',
        draft: nextDraft,
      };
    }

    if (!hasDate) {
      nextDraft.wizardStep = 'ask_day';
      return {
        intentType: 'occasion',
        isComplete: false,
        clarifyingQuestion: isEn
          ? `On what day and month is "${nextDraft.title}"?`
          : `بسیار خب، مناسبتِ «${nextDraft.title}» در چه روز و چه ماهی است؟`,
        draft: nextDraft,
      };
    }

    nextDraft.wizardStep = 'confirm';
    const monthName = PERSIAN_MONTHS[(nextDraft.solarMonth || 1) - 1] || 'فروردین';
    const dateLabel = `${nextDraft.solarDay} ${monthName}${nextDraft.solarYear ? ` ${nextDraft.solarYear}` : ''}`;

    return {
      intentType: 'occasion',
      isComplete: true,
      shouldAutoSubmit: isConfirmCommand,
      clarifyingQuestion: isEn
        ? `Your occasion "${nextDraft.title}" on ${dateLabel} is ready. Do you confirm saving it?`
        : faConfirmQuestions[vIdx % 2],
      draft: nextDraft,
    };
  }

  // ============================================================================
  // CASE 3: LOCATION (مکان)
  // ============================================================================
  if (nextDraft.intentType === 'location') {
    const hasTitle = Boolean(nextDraft.title && nextDraft.title.trim().length >= 2);
    if (!hasTitle) {
      nextDraft.wizardStep = 'ask_subject';
      return {
        intentType: 'location',
        isComplete: false,
        clarifyingQuestion: isEn
          ? 'I am getting your live GPS coordinates. What name would you like to save this location under?'
          : 'در حال دریافت موقعیت زنده GPS شما هستم؛ لطفاً نام این مکان را بفرمایید؟',
        draft: nextDraft,
      };
    }

    if (/(هشدار ورود|اعلان ورود|وقتی رسیدم|نزدیک شدم|حصار مکانی|arrival alert|geofence)/i.test(lastUserMsg)) {
      nextDraft.enableGeofence = true;
    }

    if (!nextDraft.detailsAsked) {
      nextDraft.detailsAsked = true;
      nextDraft.wizardStep = 'ask_details';
      return {
        intentType: 'location',
        isComplete: true,
        shouldAutoSubmit: false,
        clarifyingQuestion: isEn
          ? `Location "${nextDraft.title}" is set with your live GPS position. Would you like to add a note or enable arrival alert, or should I save it now?`
          : `مکانِ «${nextDraft.title}» با موقعیت زنده GPS آماده است. اگر توضیحی دارید یا می‌خواهید هشدار ورود فعال شود بفرمایید، وگرنه برای ذخیره بگویید ثبت کن.`,
        draft: nextDraft,
      };
    }

    if (!isConfirmCommand && !isRejectOrEdit && lastUserMsg.length >= 2) {
      if (!/(هشدار ورود|اعلان ورود|حصار مکانی)/i.test(lastUserMsg)) {
        nextDraft.description = lastUserMsg;
        nextDraft.locationAddress = lastUserMsg;
      }
    }

    nextDraft.wizardStep = 'confirm';
    return {
      intentType: 'location',
      isComplete: true,
      shouldAutoSubmit: isConfirmCommand,
      clarifyingQuestion: isEn
        ? `Location "${nextDraft.title}" is ready to be saved with your live GPS coordinates. Do you confirm?`
        : faConfirmQuestions[vIdx % 2],
      draft: nextDraft,
    };
  }

  // ============================================================================
  // CASE 4: IDEA (ایده)
  // ============================================================================
  const hasIdeaText = Boolean(nextDraft.title && nextDraft.title.trim().length >= 2);
  if (!hasIdeaText) {
    nextDraft.wizardStep = 'ask_subject';
    return {
      intentType: 'idea',
      isComplete: false,
      clarifyingQuestion: isEn
        ? 'Please tell me the title or subject of your idea?'
        : 'لطفاً عنوان یا موضوع ایده‌ی خود را بفرمایید؟',
      draft: nextDraft,
    };
  }

  if (!nextDraft.detailsAsked) {
    nextDraft.detailsAsked = true;
    nextDraft.wizardStep = 'ask_details';
    return {
      intentType: 'idea',
      isComplete: true,
      shouldAutoSubmit: false,
      clarifyingQuestion: isEn
        ? `Got the idea "${nextDraft.title}". If you have any additional details, please share them now, or say confirm to save it.`
        : `عنوان ایده‌ی «${nextDraft.title}» دریافت شد. اگر توضیح تکمیلی برای این ایده دارید بفرمایید، و در غیر این صورت بگویید ثبت شود.`,
      draft: nextDraft,
    };
  }

  if (!isConfirmCommand && !isRejectOrEdit && lastUserMsg.length >= 2) {
    nextDraft.description = nextDraft.description
      ? `${nextDraft.description} — ${lastUserMsg}`
      : lastUserMsg;
  }

  nextDraft.wizardStep = 'confirm';
  return {
    intentType: 'idea',
    isComplete: true,
    shouldAutoSubmit: isConfirmCommand,
    clarifyingQuestion: isEn
      ? `Your idea "${nextDraft.title}" is ready. Do you confirm saving it?`
      : faConfirmQuestions[vIdx % 2],
    draft: nextDraft,
  };
}

/**
 * فراخوانی موتور مرحله‌ای هوشمند:
 * برای تضمین اجرای دقیق ۶ مرحله‌ی استاندارد، تشخیص فازی، تاریخ‌های شمسی/میلادی/نسبی و تفکیک ۱۰۰٪ فارسی و انگلیسی،
 * موتور مرحله‌ای کنترل کامل ترتیب سوالات و بازخوانی نهایی را بر عهده دارد.
 */
export async function analyzeSmartCaptureTurn(
  messages: SmartChatMessage[],
  currentDraft: SmartCaptureDraft,
  language: 'fa' | 'en' = 'fa'
): Promise<SmartAnalysisResult> {
  return analyzeSmartCaptureLocally(messages, currentDraft, language);
}

/**
 * محاسبه timestamp دقیق یادآور از روی پیش‌نویس استخراج‌شده
 */
export function computeReminderTimestampFromDraft(draft: SmartCaptureDraft): number {
  const now = new Date();
  const nowJalali = getJalaliComponents(now.getTime());
  const hour = typeof draft.hour === 'number' && draft.hour >= 0 ? draft.hour : (now.getHours() + 1) % 24;
  const minute = typeof draft.minute === 'number' && draft.minute >= 0 ? draft.minute : 0;

  if (draft.solarMonth && draft.solarDay) {
    const jy = draft.solarYear && draft.solarYear >= 1350 ? draft.solarYear : nowJalali.year;
    let ts = jalaliToTimestamp(jy, draft.solarMonth, draft.solarDay, hour, minute);
    if (ts < now.getTime() - 60000 && !draft.solarYear) {
      ts = jalaliToTimestamp(jy + 1, draft.solarMonth, draft.solarDay, hour, minute);
    }
    return ts;
  }

  const offsetDays = typeof draft.offsetDays === 'number' && draft.offsetDays >= 0 ? draft.offsetDays : 0;
  const target = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + offsetDays,
    hour,
    minute,
    0,
    0
  );

  // If today was chosen and the hour has already passed, bump to tomorrow
  if (offsetDays === 0 && target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }

  return target.getTime();
}

import { Category, OccasionType, Priority, RecurrenceType } from '../types';
import {
  PERSIAN_MONTHS,
  fromPersianDigits,
  getJalaliComponents,
  jalaliToTimestamp,
  toPersianDigits,
} from './jalali';

export type SmartIntentType = 'reminder' | 'occasion' | 'location' | 'idea' | 'unknown';

export interface SmartCaptureDraft {
  intentType: SmartIntentType;
  title?: string;
  description?: string;
  category?: Category;
  priority?: Priority;
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
  quickSuggestions: string[];
  draft: SmartCaptureDraft;
}

const PERSIAN_WORD_NUMBERS: Record<string, number> = {
  یک: 1,
  یه: 1,
  اول: 1,
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
  دوازده: 12,
  سیزده: 13,
  چهارده: 14,
  پانزده: 15,
  پونزده: 15,
  شانزده: 16,
  شونزده: 16,
  هفده: 17,
  هجده: 18,
  هژده: 18,
  نوزده: 19,
  بیست: 20,
  'بیست و یک': 21,
  'بیست و دو': 22,
  'بیست و سه': 23,
  'بیست و چهار': 24,
  'بیست و پنج': 25,
  'بیست و شش': 26,
  'بیست و هفت': 27,
  'بیست و هشت': 28,
  'بیست و نه': 29,
  سی: 30,
  'سی و یک': 31,
  'سی و پنج': 35,
  چهل: 40,
  'چهل و پنج': 45,
  پنجاه: 50,
  'پنجاه و پنج': 55,
};

// Map JS getDay() (0=Sunday .. 6=Saturday) for Persian weekdays
const PERSIAN_WEEKDAY_JS_INDEX: Array<{ pattern: RegExp; jsDay: number }> = [
  { pattern: /\bپنج\s*شنبه\b/i, jsDay: 4 },
  { pattern: /\bچهار\s*شنبه\b/i, jsDay: 3 },
  { pattern: /\bسه\s*شنبه\b/i, jsDay: 2 },
  { pattern: /\bدو\s*شنبه\b/i, jsDay: 1 },
  { pattern: /\bیک\s*شنبه\b/i, jsDay: 0 },
  { pattern: /(?<!یک\s*|دو\s*|سه\s*|چهار\s*|پنج\s*)\bشنبه\b/i, jsDay: 6 },
  { pattern: /\bجمعه\b/i, jsDay: 5 },
];

function normalizePersianSpeech(raw: string): string {
  let s = fromPersianDigits(raw || '')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\u200c/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Replace multi-word numbers first, then single-word numbers
  const sortedKeys = Object.keys(PERSIAN_WORD_NUMBERS).sort((a, b) => b.length - a.length);
  for (const word of sortedKeys) {
    const val = PERSIAN_WORD_NUMBERS[word];
    const reg = new RegExp(`(?<=^|\\s)(${word})(?=\\s|$)`, 'g');
    s = s.replace(reg, String(val));
  }
  return s;
}

function detectIntentFromText(text: string, prevIntent: SmartIntentType): SmartIntentType {
  const norm = text.toLowerCase();

  // Explicit switches
  if (/^(یادآور|یاداور|آلارم|الارم|reminder)$/i.test(norm.trim())) return 'reminder';
  if (/^(مناسبت|تولد|سالگرد|occasion)$/i.test(norm.trim())) return 'occasion';
  if (/^(مکان|لوکیشن|آدرس|location|place)$/i.test(norm.trim())) return 'location';
  if (/^(ایده|فکر|یادداشت|idea|note)$/i.test(norm.trim())) return 'idea';

  // 1. Occasion keywords
  if (
    /(تولد|زادروز|سالگرد ازدواج|سالگرد عقد|سالگرد آشنایی|سالگرد فوت|درگذشت|مناسبت|birthday|anniversary)/i.test(
      norm
    )
  ) {
    return 'occasion';
  }

  // 2. Location keywords
  if (
    /(لوکیشن|مکان|پارک کردم|پارکینگ|طبقه منفی|محل پارک|مختصات|اینجا رو ثبت|این مکان|آدرس مطب|آدرس شرکت|حصار مکانی|location|parked)/i.test(
      norm
    )
  ) {
    return 'location';
  }

  // 3. Idea keywords
  if (
    /(ایده دارم|یه ایده|یک ایده|فکر جدید|یادداشت کن|یادداشت ذهنی|دفترچه ایده|پروژه جدید|طرح جدید|idea|brainstorm)/i.test(
      norm
    )
  ) {
    return 'idea';
  }

  // 4. Reminder keywords / time expressions
  if (
    /(یادآوری|یاداوری|یادآور|یادم بنداز|یادم بیار|بیدارم کن|آلارم|ساعت\s*\d|فردا|پس فردا|امروز|امشب|شنبه|جمعه|غروب|ظهر|قرص|دارو|جلسه|قرار|زنگ بزنم|تماس بگیرم|پرداخت|قسط|چک|خرید|دکتر|آزمایش|پرواز|قطار)/i.test(
      norm
    )
  ) {
    return 'reminder';
  }

  if (prevIntent && prevIntent !== 'unknown') {
    return prevIntent;
  }

  return 'unknown';
}

function extractTimeAndDate(rawText: string): {
  hour: number | null;
  minute: number | null;
  offsetDays: number | null;
  solarDay: number | null;
  solarMonth: number | null;
  solarYear: number | null;
} {
  const rawCleaned = rawText
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\u200c/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const norm = normalizePersianSpeech(rawText);
  const now = new Date();
  let hour: number | null = null;
  let minute: number | null = null;
  let offsetDays: number | null = null;
  let solarDay: number | null = null;
  let solarMonth: number | null = null;
  let solarYear: number | null = null;

  // Conversational relative intervals ("یه ربع دیگه", "نیم ساعت دیگه", "سه ربع دیگه", "2 ساعت دیگه", "45 دقیقه دیگه")
  if (/(یک|یه|1)\s*ربع\s*(دیگه|دیگر|بعد)/i.test(norm)) {
    const target = new Date(now.getTime() + 15 * 60000);
    return {
      hour: target.getHours(),
      minute: target.getMinutes(),
      offsetDays: 0,
      solarDay: null,
      solarMonth: null,
      solarYear: null,
    };
  }

  if (/(سه|3)\s*ربع\s*(دیگه|دیگر|بعد)/i.test(norm)) {
    const target = new Date(now.getTime() + 45 * 60000);
    return {
      hour: target.getHours(),
      minute: target.getMinutes(),
      offsetDays: 0,
      solarDay: null,
      solarMonth: null,
      solarYear: null,
    };
  }

  if (/نیم\s*ساعت\s*(دیگه|دیگر|بعد)/i.test(norm)) {
    const target = new Date(now.getTime() + 30 * 60000);
    return {
      hour: target.getHours(),
      minute: target.getMinutes(),
      offsetDays: 0,
      solarDay: null,
      solarMonth: null,
      solarYear: null,
    };
  }

  const relMinMatch = norm.match(/(\d+)\s*دقیقه\s*(دیگه|دیگر|بعد)/i);
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
    };
  }

  const relHourMatch = norm.match(/(\d+)\s*ساعت\s*(دیگه|دیگر|بعد)/i);
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
    };
  }

  // Relative day cues
  if (/پس\s*فردا/i.test(norm)) {
    offsetDays = 2;
  } else if (/فردا/i.test(norm)) {
    offsetDays = 1;
  } else if (/(امروز|امشب)/i.test(norm)) {
    offsetDays = 0;
  } else if (/هفته\s*(آینده|بعد|دیگه)/i.test(norm)) {
    offsetDays = 7;
  } else {
    // Check Persian weekday names (شنبه تا جمعه) using rawCleaned before number word replacement turns "یک شنبه" into "1 شنبه"
    for (const item of PERSIAN_WEEKDAY_JS_INDEX) {
      if (item.pattern.test(rawCleaned)) {
        const todayJs = now.getDay();
        let diff = (item.jsDay - todayJs + 7) % 7;
        if (diff === 0) diff = 7; // next occurrence of that weekday
        offsetDays = diff;
        break;
      }
    }
  }

  // Jalali Month & Day detection (e.g. "15 اردیبهشت 1405" or "20 خرداد")
  for (let i = 0; i < PERSIAN_MONTHS.length; i++) {
    const mName = PERSIAN_MONTHS[i];
    const mRegex = new RegExp(`(\\d{1,2})\\s*${mName}(?:\\s*(\\d{2,4}))?`, 'i');
    const match = norm.match(mRegex);
    if (match) {
      const d = parseInt(match[1], 10);
      if (d >= 1 && d <= 31) {
        solarDay = d;
        solarMonth = i + 1;
      }
      if (match[2]) {
        let y = parseInt(match[2], 10);
        if (y < 100) y += 1300;
        solarYear = y;
      }
      break;
    }
  }

  // Numeric slash date e.g. 1404/02/15 or 02/15
  const slashMatch = norm.match(/(?:(\d{4})\/)?(\d{1,2})\/(\d{1,2})/);
  if (slashMatch && !solarMonth) {
    if (slashMatch[1]) solarYear = parseInt(slashMatch[1], 10);
    const m = parseInt(slashMatch[2], 10);
    const d = parseInt(slashMatch[3], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      solarMonth = m;
      solarDay = d;
    }
  }

  // Explicit time patterns:
  // 1) HH:MM (e.g. 18:30 or 9:15)
  const colonTime = norm.match(/(\d{1,2}):(\d{2})/);
  if (colonTime) {
    let h = parseInt(colonTime[1], 10);
    const m = parseInt(colonTime[2], 10);
    if (/(عصر|شب|بعد\s*از\s*ظهر|غروب)/i.test(norm) && h < 12) h += 12;
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      hour = h;
      minute = m;
    }
  } else {
    // 2) "ساعت 9 و نیم صبح", "ساعت 6 و ربع عصر", "ساعت 8 شب", "9 صبح", "6 عصر"
    const spokenTime = norm.match(
      /(?:ساعت\s*)?(\d{1,2})(?:\s*و\s*(نیم|ربع|\d{1,2})\s*(?:دقیقه)?)?\s*(صبح|ظهر|بعد\s*از\s*ظهر|عصر|غروب|شب|بامداد)?/i
    );
    const hasExplicitHourKeyword =
      /ساعت\s*\d{1,2}/i.test(norm) ||
      /\d{1,2}\s*(?:و\s*(?:نیم|ربع|\d{1,2})(?:\s*دقیقه)?\s*)?(صبح|ظهر|بعد\s*از\s*ظهر|عصر|غروب|شب|بامداد)/i.test(
        norm
      );

    if (spokenTime && hasExplicitHourKeyword) {
      let h = parseInt(spokenTime[1], 10);
      let m = 0;
      const minPart = spokenTime[2];
      const period = spokenTime[3] || '';

      if (minPart === 'نیم') m = 30;
      else if (minPart === 'ربع') m = 15;
      else if (minPart && /^\d+$/.test(minPart)) m = parseInt(minPart, 10);

      if (/(عصر|شب|بعد\s*از\s*ظهر|غروب)/i.test(period) && h < 12) {
        h += 12;
      } else if (/ظهر/i.test(period) && h < 12 && h !== 12) {
        h += 12;
      } else if (/بامداد/i.test(period) && h === 12) {
        h = 0;
      } else if (!period && /(امشب|عصر|غروب|بعد\s*از\s*ظهر)/i.test(norm) && h < 12) {
        h += 12;
      }

      if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
        hour = h;
        minute = m;
      }
    } else {
      // 3) Conversational time-of-day phrases without explicit digits ("اول صبح", "سر ظهر", "غروب", "آخر شب")
      if (/(اول\s*صبح|کله\s*سحر)/i.test(rawCleaned)) {
        hour = 7;
        minute = 30;
      } else if (/(سر\s*ظهر|ظهر)/i.test(rawCleaned)) {
        hour = 12;
        minute = 0;
      } else if (/غروب/i.test(rawCleaned)) {
        hour = 18;
        minute = 30;
      } else if (/آخر\s*شب/i.test(rawCleaned)) {
        hour = 23;
        minute = 0;
      }
    }
  }

  return { hour, minute, offsetDays, solarDay, solarMonth, solarYear };
}

function cleanExtractedTitle(rawText: string, intent: SmartIntentType): string {
  let t = fromPersianDigits(rawText)
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(
      /^(لطفاً|لطفا|بیزحمت|دیگه|من|میخوام|می‌خوام|میخواهم|می‌خواهم|ثبت کن|ذخیره کن|اضافه کن|بنویس|یادآوری کن|یادم بنداز|یادم بیار|یه یادآور|یک یادآور|یادآور|یه ایده دارم|ایده دارم|یه ایده|یک ایده|ایده جدید|مکان جدید|لوکیشن جدید|مناسبت جدید|عنوانش رو بکن|عنوانش بشه|تغییر عنوان به)\s*/gi,
      ''
    )
    .replace(/\b(که|رو|را|باشه|حله|برام|برایم)\b\s*$/gi, '');

  if (intent === 'reminder') {
    t = t
      .replace(/(امروز|فردا|پس\s*فردا|امشب|هفته\s*آینده|هفته\s*بعد)/gi, '')
      .replace(/\b(یک\s*شنبه|دو\s*شنبه|سه\s*شنبه|چهار\s*شنبه|پنج\s*شنبه|شنبه|جمعه)\b/gi, '')
      .replace(/ساعت\s*\d{1,2}(?::\d{2})?(?:\s*و\s*(?:نیم|ربع|\d{1,2})\s*(?:دقیقه)?)?\s*(?:صبح|ظهر|بعد\s*از\s*ظهر|عصر|غروب|شب|بامداد)?/gi, '')
      .replace(/\b\d{1,2}(?::\d{2})\s*(?:صبح|ظهر|عصر|غروب|شب)?/gi, '')
      .replace(/\b(نیم|یک|یه|سه|\d+)\s*(ربع|ساعت|دقیقه)\s*(دیگه|دیگر|بعد)/gi, '')
      .replace(/\b(اول\s*صبح|سر\s*ظهر|آخر\s*شب|غروب)\b/gi, '')
      .replace(/\b(یادم\s*بنداز|یادم\s*بیار|بهم\s*خبر\s*بده|خبر\s*بده|یادآوری\s*کن|باشه)\b/gi, '');
  } else if (intent === 'occasion') {
    for (const mName of PERSIAN_MONTHS) {
      const reg = new RegExp(`(?:در\\s*تاریخ\\s*|تاریخ\\s*)?(\\d{1,2}|[آ-ی]+)\\s*${mName}(?:\\s*\\d{2,4})?`, 'gi');
      t = t.replace(reg, '');
    }
    t = t.replace(/\b(باشه|حله|ثبتش کن|ثبت کن)\b/gi, '');
  } else if (intent === 'location') {
    t = t.replace(/(اینجا رو|این مکان رو|لوکیشن فعلی رو|با نام|به اسم|به نام|با اسم)/gi, '');
  }

  t = t
    .replace(/^[\s،,:-]+|[\s،,:-]+$/g, '')
    .replace(/^(که|رو|را|در|برای)\s+/i, '')
    .replace(/\s+(رو|را|برام|برایم)\s*(ثبت کن|ذخیره کن|بذار|بگذار|باشه)?$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  return t;
}

/**
 * تحلیل محلی هوشمند چندمرحله‌ای (پشتیبانی آفلاین و اندروید بدون سرور)
 */
export function analyzeSmartCaptureLocally(
  messages: SmartChatMessage[],
  currentDraft: SmartCaptureDraft,
  language: 'fa' | 'en' = 'fa'
): SmartAnalysisResult {
  const isEn = language === 'en';
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')?.text.trim() || '';
  const normLast = normalizePersianSpeech(lastUserMsg);

  // Check if user is confirming an already complete draft
  const isConfirmCommand = /^(ثبت|ثبت کن|ذخیره|ذخیره کن|تایید|بله|آره|حله|باشه|بله ثبت کن|آره ثبت کن|انجام بده|ok|yes|save|confirm)$/i.test(
    lastUserMsg.replace(/[!.،؟?]/g, '').trim()
  );

  let intent: SmartIntentType = currentDraft.intentType || 'unknown';
  const detectedNow = detectIntentFromText(lastUserMsg, intent);
  if (intent === 'unknown' || /^(یادآور|مناسبت|مکان|ایده|reminder|occasion|location|idea)$/i.test(lastUserMsg.trim())) {
    intent = detectedNow;
  }

  const timeInfo = extractTimeAndDate(lastUserMsg);
  const candidateTitle = cleanExtractedTitle(lastUserMsg, intent);

  const nextDraft: SmartCaptureDraft = {
    ...currentDraft,
    intentType: intent,
  };

  // Merge time/date into draft
  if (timeInfo.hour !== null) nextDraft.hour = timeInfo.hour;
  if (timeInfo.minute !== null) nextDraft.minute = timeInfo.minute;
  if (timeInfo.offsetDays !== null) nextDraft.offsetDays = timeInfo.offsetDays;
  if (timeInfo.solarDay !== null) nextDraft.solarDay = timeInfo.solarDay;
  if (timeInfo.solarMonth !== null) nextDraft.solarMonth = timeInfo.solarMonth;
  if (timeInfo.solarYear !== null) nextDraft.solarYear = timeInfo.solarYear;

  // Detect Category & Priority
  if (/(کاری|شرکت|جلسه|پروژه|اداره|مدیر|چک|بانک|فاکتور)/i.test(normLast)) {
    nextDraft.category = 'work';
  } else if (/(خانواده|تولد|همسر|مادر|پدر|فرزند|مهمانی|شام|ناهار)/i.test(normLast)) {
    nextDraft.category = 'family';
  } else if (!nextDraft.category) {
    nextDraft.category = 'other';
  }

  if (/(فوری|خیلی مهم|ضروری|حیاتی|اورژانسی)/i.test(normLast)) {
    nextDraft.priority = 'high';
  } else if (!nextDraft.priority) {
    nextDraft.priority = 'medium';
  }

  // Detect Occasion Type
  if (intent === 'occasion') {
    if (/تولد|زادروز/i.test(normLast)) nextDraft.occasionType = 'birthday';
    else if (/ازدواج|عقد/i.test(normLast)) nextDraft.occasionType = 'wedding';
    else if (/آشنایی/i.test(normLast)) nextDraft.occasionType = 'dating';
    else if (/فوت|درگذشت|سالگرد وفات/i.test(normLast)) nextDraft.occasionType = 'memorial';
    else if (!nextDraft.occasionType) nextDraft.occasionType = 'custom';
  }

  // Smart Title Locking:
  // Once a title has been extracted in an earlier turn, do NOT overwrite it when the user is simply answering a time/date question
  const isPureCategoryWord = /^(یادآور|مناسبت|مکان|ایده|بله|تایید|ثبت کن|امروز|فردا|پس فردا|شنبه|یکشنبه|دوشنبه|سه شنبه|چهارشنبه|پنجشنبه|جمعه)$/i.test(
    lastUserMsg.replace(/\u200c/g, ' ').trim()
  );
  const isPureTimePhrase =
    candidateTitle.length < 2 ||
    /^(\d{1,2}(:\d{2})?|\d{1,2}\s*(صبح|عصر|شب|ظهر|غروب)|ساعت\s*\d+)$/i.test(candidateTitle);
  const hasNewTimeOrDateInTurn =
    timeInfo.hour !== null ||
    timeInfo.solarDay !== null ||
    timeInfo.solarMonth !== null ||
    timeInfo.offsetDays !== null;
  const isExplicitTitleEdit = /(عنوانش|موضوعش|اسمش|تغییر عنوان|ویرایش عنوان|تغییر نام)/i.test(lastUserMsg);

  if (!isPureCategoryWord && !isPureTimePhrase && candidateTitle.length >= 2 && !isConfirmCommand) {
    if (!nextDraft.title) {
      nextDraft.title = candidateTitle;
    } else if (isExplicitTitleEdit) {
      nextDraft.title = candidateTitle;
    } else if (!hasNewTimeOrDateInTurn && currentDraft.intentType === 'unknown') {
      nextDraft.title = candidateTitle;
    }
  }

  // Evaluate completeness and generate clarifying questions per section
  // CASE 0: Intent is still unknown
  if (nextDraft.intentType === 'unknown') {
    if (candidateTitle.length >= 2 && !isPureCategoryWord) {
      nextDraft.title = candidateTitle;
      return {
        intentType: 'unknown',
        isComplete: false,
        clarifyingQuestion: isEn
          ? `Got "${candidateTitle}"! Which section should I save it in for you: Reminder, Occasion, Location, or Idea?`
          : `«${candidateTitle}» رو گرفتم! می‌خوای توی کدوم بخش برات ثبتش کنم: یادآور، مناسبت، مکان یا ایده؟`,
        quickSuggestions: isEn
          ? ['Reminder', 'Idea', 'Occasion', 'Location']
          : ['یادآور', 'ایده', 'مناسبت', 'مکان'],
        draft: nextDraft,
      };
    }

    return {
      intentType: 'unknown',
      isComplete: false,
      clarifyingQuestion: isEn
        ? 'Tell me, what would you like me to save for you today: a Reminder, an Occasion, a Location, or an Idea?'
        : 'بگو ببینم چه موردی رو می‌خوای برات ثبت کنم: یادآور، مناسبت، مکان یا ایده؟',
      quickSuggestions: isEn
        ? ['New Reminder', 'New Idea', 'Save Location', 'Add Occasion']
        : ['ثبت یادآور', 'ثبت ایده', 'ثبت مکان', 'ثبت مناسبت'],
      draft: nextDraft,
    };
  }

  // CASE 1: REMINDER (یادآور)
  if (nextDraft.intentType === 'reminder') {
    const hasTitle = Boolean(nextDraft.title && nextDraft.title.trim().length >= 2);
    const hasTime = typeof nextDraft.hour === 'number' && nextDraft.hour >= 0;

    if (!hasTitle && !hasTime) {
      return {
        intentType: 'reminder',
        isComplete: false,
        clarifyingQuestion: isEn
          ? 'Sure thing! What is this reminder about, and what time should I remind you?'
          : 'رو چشمم! فقط بگو موضوع یادآور چیه و ساعت چند بهت یادآوری کنم؟',
        quickSuggestions: isEn
          ? ['Work call tomorrow at 10 AM', 'Take medicine tonight at 9 PM', 'Meeting tomorrow at 4 PM']
          : ['تماس کاری فردا ساعت ۱۰ صبح', 'خوردن دارو ساعت ۲۱ امشب', 'جلسه فردا ساعت ۱۶'],
        draft: nextDraft,
      };
    }

    if (!hasTitle) {
      return {
        intentType: 'reminder',
        isComplete: false,
        clarifyingQuestion: isEn
          ? 'I have the time set! What is the subject of this reminder?'
          : 'ساعتش مشخص شد! حالا بگو موضوع این یادآور چیه تا برات ثبتش کنم؟',
        quickSuggestions: isEn
          ? ['Work Meeting', 'Important Phone Call', 'Take Medication', 'Pay Bill']
          : ['جلسه کاری', 'تماس تلفنی مهم', 'مصرف دارو', 'پرداخت قبض یا قسط'],
        draft: nextDraft,
      };
    }

    if (!hasTime) {
      return {
        intentType: 'reminder',
        isComplete: false,
        clarifyingQuestion: isEn
          ? `Got it! What day and what time should I remind you about "${nextDraft.title}"?`
          : `خب، برای یادآورِ «${nextDraft.title}»، می‌خوای چه روزی و ساعت چند بهت خبر بدم؟`,
        quickSuggestions: isEn
          ? ['In 1 hour', 'Today at 18:00', 'Tonight at 21:00', 'Tomorrow at 9 AM']
          : ['یک ساعت دیگر', 'امروز ساعت ۱۸', 'امشب ساعت ۲۱', 'فردا ساعت ۹ صبح'],
        draft: nextDraft,
      };
    }

    if (nextDraft.offsetDays === undefined || nextDraft.offsetDays === null) {
      nextDraft.offsetDays = 0;
    }
    if (nextDraft.minute === undefined || nextDraft.minute === null || nextDraft.minute < 0) {
      nextDraft.minute = 0;
    }

    const dayLabel = isEn
      ? nextDraft.offsetDays === 1
        ? 'tomorrow'
        : nextDraft.offsetDays === 2
        ? 'in 2 days'
        : 'today'
      : nextDraft.solarDay && nextDraft.solarMonth
      ? `${toPersianDigits(nextDraft.solarDay)} ${PERSIAN_MONTHS[nextDraft.solarMonth - 1]}`
      : nextDraft.offsetDays === 1
      ? 'فردا'
      : nextDraft.offsetDays === 2
      ? 'پس‌فردا'
      : 'امروز';

    const timeLabel = isEn
      ? `${String(nextDraft.hour).padStart(2, '0')}:${String(nextDraft.minute).padStart(2, '0')}`
      : `${toPersianDigits(String(nextDraft.hour).padStart(2, '0'))}:${toPersianDigits(
          String(nextDraft.minute).padStart(2, '0')
        )}`;

    return {
      intentType: 'reminder',
      isComplete: true,
      shouldAutoSubmit: isConfirmCommand,
      clarifyingQuestion: isEn
        ? `All set! Your reminder "${nextDraft.title}" is scheduled for ${dayLabel} at ${timeLabel}. Should I go ahead and save it for you?`
        : `همه‌چی آماده است! یادآورِ «${nextDraft.title}» برای ${dayLabel} ساعت ${timeLabel} تنظیم شد. برات ثبتش کنم؟`,
      quickSuggestions: isEn ? ['Yes, save it', 'Change time'] : ['بله، ثبت کن', 'تغییر ساعت'],
      draft: nextDraft,
    };
  }

  // CASE 2: OCCASION (مناسبت)
  if (nextDraft.intentType === 'occasion') {
    const hasTitle = Boolean(nextDraft.title && nextDraft.title.trim().length >= 2);
    const hasDate =
      typeof nextDraft.solarDay === 'number' &&
      nextDraft.solarDay >= 1 &&
      typeof nextDraft.solarMonth === 'number' &&
      nextDraft.solarMonth >= 1;

    if (!hasTitle) {
      return {
        intentType: 'occasion',
        isComplete: false,
        clarifyingQuestion: isEn
          ? 'Whose occasion is this, or what name should I save it under?'
          : 'بگو این مناسبت برای کیه یا اسمش چیه تا برات ثبتش کنم؟',
        quickSuggestions: isEn
          ? ["Mother's Birthday", "Spouse's Birthday", 'Wedding Anniversary', 'First Met Anniversary']
          : ['تولد مادر', 'تولد همسر', 'سالگرد ازدواج', 'سالگرد آشنایی'],
        draft: nextDraft,
      };
    }

    if (!hasDate) {
      return {
        intentType: 'occasion',
        isComplete: false,
        clarifyingQuestion: isEn
          ? `Nice! What day and what month is "${nextDraft.title}"?`
          : `چه مناسبت قشنگی! «${nextDraft.title}» دقیقاً چه روزی و چه ماهیه؟`,
        quickSuggestions: isEn
          ? ['15 Farvardin', '20 Ordibehesht', '10 Mehr', '25 Bahman']
          : ['۱۵ فروردین', '۲۰ اردیبهشت', '۱۰ مهر', '۲۵ بهمن'],
        draft: nextDraft,
      };
    }

    const monthName = PERSIAN_MONTHS[(nextDraft.solarMonth || 1) - 1] || 'فروردین';
    return {
      intentType: 'occasion',
      isComplete: true,
      shouldAutoSubmit: isConfirmCommand,
      clarifyingQuestion: isEn
        ? `Awesome! Your occasion "${nextDraft.title}" on ${nextDraft.solarDay} ${monthName} is ready. Should I save it for you now?`
        : `عالیه! مناسبتِ «${nextDraft.title}» برای ${toPersianDigits(nextDraft.solarDay!)} ${monthName} آماده است. برات ثبتش کنم؟`,
      quickSuggestions: isEn ? ['Yes, save it', 'Change date'] : ['بله، ثبت کن', 'تغییر تاریخ'],
      draft: nextDraft,
    };
  }

  // CASE 3: LOCATION (مکان)
  if (nextDraft.intentType === 'location') {
    const hasTitle = Boolean(nextDraft.title && nextDraft.title.trim().length >= 2);
    if (!hasTitle) {
      return {
        intentType: 'location',
        isComplete: false,
        clarifyingQuestion: isEn
          ? 'I have your GPS location! What name would you like me to save this place under?'
          : 'موقعیت مکانی رو گرفتم! دوست داری این مکان رو با چه اسمی برات ذخیره کنم؟',
        quickSuggestions: isEn
          ? ['Parked Car Location', 'Office / Workplace', 'Doctor Clinic', 'Favorite Store']
          : ['محل پارک خودرو', 'شرکت و محل کار', 'مطب پزشک', 'فروشگاه منتخب'],
        draft: nextDraft,
      };
    }

    return {
      intentType: 'location',
      isComplete: true,
      shouldAutoSubmit: isConfirmCommand,
      clarifyingQuestion: isEn
        ? `All set! Location "${nextDraft.title}" with your current GPS coordinates is ready. Should I save it for you?`
        : `حله! مکانِ «${nextDraft.title}» با موقعیت فعلیت آماده است. برات ذخیره‌اش کنم؟`,
      quickSuggestions: isEn ? ['Yes, save it', 'Change name'] : ['بله، ثبت کن', 'تغییر نام مکان'],
      draft: nextDraft,
    };
  }

  // CASE 4: IDEA (ایده)
  const hasIdeaText = Boolean(nextDraft.title && nextDraft.title.trim().length >= 2);
  if (!hasIdeaText) {
    return {
      intentType: 'idea',
      isComplete: false,
      clarifyingQuestion: isEn
        ? 'What idea is on your mind? Tell me so I can jot it down for you!'
        : 'چه ایده‌ای تو ذهنته؟ بگو تا همین الان برات یادداشتش کنم؟',
      quickSuggestions: isEn
        ? ['New Business Idea', 'Reading List', 'Daily Note']
        : ['ایده کسب‌وکار جدید', 'لیست کتاب‌های مطالعه', 'یادداشت روزانه'],
      draft: nextDraft,
    };
  }

  return {
    intentType: 'idea',
    isComplete: true,
    shouldAutoSubmit: isConfirmCommand,
    clarifyingQuestion: isEn
      ? `Your idea "${nextDraft.title}" is ready. Should I go ahead and save it for you?`
      : `ایده «${nextDraft.title}» آماده است! همین الان برات ثبتش کنم؟`,
    quickSuggestions: isEn ? ['Yes, save it', 'Edit text'] : ['بله، ثبت کن', 'ویرایش متن'],
    draft: nextDraft,
  };
}

/**
 * فراخوانی ترکیبی (ابتدا سرور Gemini API و در صورت آفلاین/عدم دسترسی، موتور هوشمند محلی)
 */
export async function analyzeSmartCaptureTurn(
  messages: SmartChatMessage[],
  currentDraft: SmartCaptureDraft,
  language: 'fa' | 'en' = 'fa'
): Promise<SmartAnalysisResult> {
  const localResult = analyzeSmartCaptureLocally(messages, currentDraft, language);

  try {
    const nowJalali = getJalaliComponents(Date.now());
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5500);

    const response = await fetch('/api/smart-capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: messages.map((m) => ({ role: m.role, text: m.text })),
        currentDraft,
        currentJalaliInfo: nowJalali,
        language,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      if (data?.ok && data?.result) {
        const aiRes = data.result;
        const rawIntent = String(aiRes.intentType || localResult.intentType);
        const validIntent: SmartIntentType = ['reminder', 'occasion', 'location', 'idea', 'unknown'].includes(
          rawIntent
        )
          ? (rawIntent as SmartIntentType)
          : localResult.intentType;

        const mergedDraft: SmartCaptureDraft = {
          ...currentDraft,
          ...localResult.draft,
          intentType: validIntent,
          title: aiRes.draft?.title || localResult.draft.title,
          description: aiRes.draft?.description || localResult.draft.description,
          category: (['work', 'family', 'other'].includes(aiRes.draft?.category)
            ? aiRes.draft.category
            : localResult.draft.category || 'other') as Category,
          priority: (['high', 'medium', 'low'].includes(aiRes.draft?.priority)
            ? aiRes.draft.priority
            : localResult.draft.priority || 'medium') as Priority,
          offsetDays:
            typeof aiRes.draft?.offsetDays === 'number' && aiRes.draft.offsetDays >= 0
              ? aiRes.draft.offsetDays
              : localResult.draft.offsetDays,
          hour:
            typeof aiRes.draft?.hour === 'number' && aiRes.draft.hour >= 0
              ? aiRes.draft.hour
              : localResult.draft.hour,
          minute:
            typeof aiRes.draft?.minute === 'number' && aiRes.draft.minute >= 0
              ? aiRes.draft.minute
              : localResult.draft.minute ?? 0,
          solarYear:
            typeof aiRes.draft?.solarYear === 'number' && aiRes.draft.solarYear > 1300
              ? aiRes.draft.solarYear
              : localResult.draft.solarYear,
          solarMonth:
            typeof aiRes.draft?.solarMonth === 'number' &&
            aiRes.draft.solarMonth >= 1 &&
            aiRes.draft.solarMonth <= 12
              ? aiRes.draft.solarMonth
              : localResult.draft.solarMonth,
          solarDay:
            typeof aiRes.draft?.solarDay === 'number' &&
            aiRes.draft.solarDay >= 1 &&
            aiRes.draft.solarDay <= 31
              ? aiRes.draft.solarDay
              : localResult.draft.solarDay,
          occasionType: (aiRes.draft?.occasionType ||
            localResult.draft.occasionType ||
            'birthday') as OccasionType,
          personName: aiRes.draft?.personName || localResult.draft.personName,
          locationAddress: aiRes.draft?.locationAddress || localResult.draft.locationAddress,
          enableGeofence: Boolean(aiRes.draft?.enableGeofence ?? localResult.draft.enableGeofence),
        };

        return {
          intentType: validIntent,
          isComplete: Boolean(aiRes.isComplete),
          shouldAutoSubmit: Boolean(aiRes.shouldAutoSubmit),
          clarifyingQuestion: aiRes.clarifyingQuestion || localResult.clarifyingQuestion,
          quickSuggestions:
            Array.isArray(aiRes.quickSuggestions) && aiRes.quickSuggestions.length > 0
              ? aiRes.quickSuggestions
              : localResult.quickSuggestions,
          draft: mergedDraft,
        };
      }
    }
  } catch {
    // Fallback to local engine seamlessly when offline or in standalone Android APK
  }

  return localResult;
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
    const jy = draft.solarYear && draft.solarYear >= 1400 ? draft.solarYear : nowJalali.year;
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

export interface FuzzyInferenceResult {
  id: string;
  categoryLabel: string;
  unit: string;
  stepSize: number;
  inactivityDays: number;
  currentInputLabel: string;
  currentPlaceholder: string;
  totalInputLabel: string;
  totalPlaceholder: string;
  suggestedTotal?: number;
  confidence: number; // 0 to 1
  isDefault: boolean;
}

interface DomainRule {
  id: string;
  keywordsFa: string[];
  keywordsEn: string[];
  categoryFa: string;
  categoryEn: string;
  unitFa: string;
  unitEn: string;
  stepSize: number;
  inactivityDays: number;
  currentLabelFa: string;
  currentLabelEn: string;
  currentPlaceholderFa: string;
  currentPlaceholderEn: string;
  totalLabelFa: string;
  totalLabelEn: string;
  totalPlaceholderFa: string;
  totalPlaceholderEn: string;
  suggestedTotal?: number;
}

const DOMAIN_RULES: DomainRule[] = [
  {
    id: 'podcast',
    keywordsFa: [
      'پادکست', 'پادکس', 'کتاب صوتی', 'صوتی', 'اپیزود صوتی', 'سخنرانی',
      'ویس', 'فایل صوتی', 'رادیو', 'شنیدن', 'گوش دادن', 'آلبوم', 'موزیک', 'آهنگ',
      'چنل بی', 'رخ', 'جافکری', 'هشتگ', 'رواق', 'فردوسی خوانی', 'داستان شب'
    ],
    keywordsEn: ['podcast', 'audiobook', 'audio', 'voice', 'radio', 'listen', 'lecture', 'talk'],
    categoryFa: 'پادکست و صوتی',
    categoryEn: 'Podcast & Audio',
    unitFa: 'دقیقه',
    unitEn: 'min',
    stepSize: 5,
    inactivityDays: 1,
    currentLabelFa: 'زمان توقف گوش کردن (دقیقه)',
    currentLabelEn: 'Stopped listening at (min)',
    currentPlaceholderFa: 'مثلاً دقیقه ۲۴',
    currentPlaceholderEn: 'e.g. 24',
    totalLabelFa: 'مدت زمان کل (دقیقه - اختیاری)',
    totalLabelEn: 'Total duration (min - optional)',
    totalPlaceholderFa: 'مثلاً ۶۰',
    totalPlaceholderEn: 'e.g. 60'
  },
  {
    id: 'book',
    keywordsFa: [
      'کتاب', 'کتب', 'رمان', 'مطالعه', 'خواندن', 'مقاله', 'پایان نامه', 'پایان‌نامه',
      'جزوه', 'فصل', 'صفحه', 'داستان', 'شعر', 'زندگینامه', 'تاریخ', 'فلسفه', 'روانشناسی',
      'مجله', 'نشریه', 'پی دی اف', 'pdf'
    ],
    keywordsEn: ['book', 'novel', 'read', 'reading', 'paper', 'thesis', 'article', 'page', 'chapter', 'pdf'],
    categoryFa: 'کتاب و مطالعه',
    categoryEn: 'Book & Reading',
    unitFa: 'صفحه',
    unitEn: 'pages',
    stepSize: 5,
    inactivityDays: 1,
    currentLabelFa: 'آخرین صفحه مطالعه شده',
    currentLabelEn: 'Last page read',
    currentPlaceholderFa: 'مثلاً صفحه ۴۵',
    currentPlaceholderEn: 'e.g. 45',
    totalLabelFa: 'تعداد کل صفحات (اختیاری)',
    totalLabelEn: 'Total pages (optional)',
    totalPlaceholderFa: 'مثلاً ۳۲۰',
    totalPlaceholderEn: 'e.g. 320'
  },
  {
    id: 'series',
    keywordsFa: [
      'سریال', 'سریل', 'انیمه', 'انیمیشن', 'مینی سریال', 'مستند', 'قسمت', 'اپیزود',
      'فصل', 'سیزن', 'برنامه تلویزیونی', 'تاینی', 'نتفلیکس'
    ],
    keywordsEn: ['series', 'show', 'tv', 'anime', 'episode', 'season', 'sitcom', 'documentary'],
    categoryFa: 'سریال و اپیزودیک',
    categoryEn: 'Series & Shows',
    unitFa: 'قسمت',
    unitEn: 'ep',
    stepSize: 1,
    inactivityDays: 1,
    currentLabelFa: 'آخرین قسمت تماشا شده',
    currentLabelEn: 'Last episode watched',
    currentPlaceholderFa: 'مثلاً قسمت ۶',
    currentPlaceholderEn: 'e.g. 6',
    totalLabelFa: 'تعداد کل قسمت‌ها (اختیاری)',
    totalLabelEn: 'Total episodes (optional)',
    totalPlaceholderFa: 'مثلاً ۱۲',
    totalPlaceholderEn: 'e.g. 12'
  },
  {
    id: 'movie',
    keywordsFa: [
      'فیلم', 'سینمایی', 'ویدیو', 'ویدئو', 'کلیپ', 'یوتیوب', 'تماشا', 'پخش', 'تئاتر'
    ],
    keywordsEn: ['movie', 'film', 'video', 'youtube', 'cinema', 'watch'],
    categoryFa: 'فیلم و ویدیو',
    categoryEn: 'Movie & Video',
    unitFa: 'دقیقه',
    unitEn: 'min',
    stepSize: 10,
    inactivityDays: 1,
    currentLabelFa: 'زمان توقف تماشا (دقیقه)',
    currentLabelEn: 'Stopped watching at (min)',
    currentPlaceholderFa: 'مثلاً دقیقه ۴۸',
    currentPlaceholderEn: 'e.g. 48',
    totalLabelFa: 'مدت کل فیلم (دقیقه - اختیاری)',
    totalLabelEn: 'Total length (min - optional)',
    totalPlaceholderFa: 'مثلاً ۱۲۵',
    totalPlaceholderEn: 'e.g. 125'
  },
  {
    id: 'course',
    keywordsFa: [
      'دوره', 'آموزش', 'اموزش', 'کلاس', 'درس', 'زبان', 'انگلیسی', 'آیلتس', 'تافل',
      'کنکور', 'تست', 'کارگاه', 'وبینار', 'ترم', 'جلسه', 'یادگیری', 'تمرین درسی', 'فرادرس', 'مکتب'
    ],
    keywordsEn: ['course', 'tutorial', 'class', 'lesson', 'learn', 'study', 'bootcamp', 'workshop', 'exam', 'ielts'],
    categoryFa: 'آموزش و دوره',
    categoryEn: 'Course & Learning',
    unitFa: 'جلسه',
    unitEn: 'sessions',
    stepSize: 1,
    inactivityDays: 1,
    currentLabelFa: 'آخرین جلسه / درس گذرانده شده',
    currentLabelEn: 'Last completed session/lesson',
    currentPlaceholderFa: 'مثلاً جلسه ۸',
    currentPlaceholderEn: 'e.g. 8',
    totalLabelFa: 'تعداد کل جلسات (اختیاری)',
    totalLabelEn: 'Total sessions (optional)',
    totalPlaceholderFa: 'مثلاً ۲۴',
    totalPlaceholderEn: 'e.g. 24'
  },
  {
    id: 'quran_spiritual',
    keywordsFa: [
      'قرآن', 'قران', 'ختم', 'جزء', 'جز', 'سوره', 'آیه', 'حفظ', 'دعا', 'چله', 'زیارت', 'نهج البلاغه', 'صحیفه'
    ],
    keywordsEn: ['quran', 'juz', 'surah', 'prayer', 'spiritual'],
    categoryFa: 'معنوی و ختم',
    categoryEn: 'Spiritual',
    unitFa: 'صفحه',
    unitEn: 'pages',
    stepSize: 2,
    inactivityDays: 1,
    currentLabelFa: 'آخرین صفحه / جزء خوانده شده',
    currentLabelEn: 'Last page / juz read',
    currentPlaceholderFa: 'مثلاً صفحه ۱۲۰',
    currentPlaceholderEn: 'e.g. 120',
    totalLabelFa: 'هدف کل (مثلاً ۶۰۴ صفحه یا ۳۰ جزء)',
    totalLabelEn: 'Total target (e.g. 604 pages)',
    totalPlaceholderFa: 'مثلاً ۶۰۴',
    totalPlaceholderEn: 'e.g. 604'
  },
  {
    id: 'finance_loan',
    keywordsFa: [
      'وام', 'قسط', 'اقساط', 'بدهی', 'چک', 'قرعه کشی', 'قرعه‌کشی', 'پس انداز', 'پس‌انداز',
      'اجاره', 'شهریه', 'قرض', 'بانک'
    ],
    keywordsEn: ['loan', 'installment', 'debt', 'mortgage', 'payment', 'saving'],
    categoryFa: 'مالی و اقساط',
    categoryEn: 'Finance & Loan',
    unitFa: 'قسط',
    unitEn: 'installments',
    stepSize: 1,
    inactivityDays: 1,
    currentLabelFa: 'تعداد اقساط / مراحل پرداخت شده',
    currentLabelEn: 'Paid installments',
    currentPlaceholderFa: 'مثلاً قسط ۵',
    currentPlaceholderEn: 'e.g. 5',
    totalLabelFa: 'تعداد کل اقساط (اختیاری)',
    totalLabelEn: 'Total installments (optional)',
    totalPlaceholderFa: 'مثلاً ۲۴',
    totalPlaceholderEn: 'e.g. 24'
  },
  {
    id: 'project_work',
    keywordsFa: [
      'پروژه', 'پروژ', 'طراحی', 'برنامه نویسی', 'برنامه‌نویسی', 'کدنویسی', 'سایت', 'اپلیکیشن',
      'تدوین', 'ساخت', 'تولید محتوا', 'گزارش', 'معماری', 'بازسازی', 'تایپ', 'ترجمه', 'فریلنسری'
    ],
    keywordsEn: ['project', 'design', 'coding', 'development', 'website', 'app', 'build', 'work', 'translation'],
    categoryFa: 'پروژه و کار',
    categoryEn: 'Project & Work',
    unitFa: 'درصد',
    unitEn: '%',
    stepSize: 10,
    inactivityDays: 1,
    currentLabelFa: 'درصد پیشرفت فعلی کار',
    currentLabelEn: 'Current progress (%)',
    currentPlaceholderFa: 'مثلاً ۳۰',
    currentPlaceholderEn: 'e.g. 30',
    totalLabelFa: 'هدف نهایی (پیش‌فرض ۱۰۰٪)',
    totalLabelEn: 'Target total (default 100%)',
    totalPlaceholderFa: '۱۰۰',
    totalPlaceholderEn: '100',
    suggestedTotal: 100
  },
  {
    id: 'fitness_running',
    keywordsFa: [
      'پیاده روی', 'پیاده‌روی', 'دویدن', 'دوندگی', 'دوچرخه', 'کوهنوردی', 'مسیر'
    ],
    keywordsEn: ['walk', 'walking', 'run', 'running', 'jogging', 'cycling', 'km'],
    categoryFa: 'ورزش و پیاده‌روی',
    categoryEn: 'Running & Cardio',
    unitFa: 'کیلومتر',
    unitEn: 'km',
    stepSize: 1,
    inactivityDays: 1,
    currentLabelFa: 'مسافت طی شده تا الان (کیلومتر)',
    currentLabelEn: 'Distance covered (km)',
    currentPlaceholderFa: 'مثلاً ۳',
    currentPlaceholderEn: 'e.g. 3',
    totalLabelFa: 'هدف کل مسافت (اختیاری)',
    totalLabelEn: 'Target distance (optional)',
    totalPlaceholderFa: 'مثلاً ۵۰',
    totalPlaceholderEn: 'e.g. 50'
  },
  {
    id: 'fitness_gym',
    keywordsFa: [
      'ورزش', 'باشگاه', 'بدنسازی', 'فیتنس', 'شنا', 'یوگا', 'پیلاتس', 'رژیم', 'کالری', 'تمرین ورزشی', 'چالش'
    ],
    keywordsEn: ['gym', 'workout', 'fitness', 'yoga', 'swim', 'diet', 'exercise', 'challenge'],
    categoryFa: 'ورزش و سلامت',
    categoryEn: 'Fitness & Health',
    unitFa: 'جلسه',
    unitEn: 'sessions',
    stepSize: 1,
    inactivityDays: 1,
    currentLabelFa: 'تعداد جلسات / روزهای انجام شده',
    currentLabelEn: 'Completed sessions / days',
    currentPlaceholderFa: 'مثلاً جلسه ۴',
    currentPlaceholderEn: 'e.g. 4',
    totalLabelFa: 'تعداد کل جلسات هدف (اختیاری)',
    totalLabelEn: 'Target total sessions (optional)',
    totalPlaceholderFa: 'مثلاً ۳۰',
    totalPlaceholderEn: 'e.g. 30'
  },
  {
    id: 'game',
    keywordsFa: [
      'بازی', 'گیم', 'مرحله بازی', 'پلی استیشن', 'واکترو', 'غوغا', 'باس'
    ],
    keywordsEn: ['game', 'gaming', 'play', 'level', 'quest', 'mission'],
    categoryFa: 'بازی و سرگرمی',
    categoryEn: 'Gaming',
    unitFa: 'مرحله',
    unitEn: 'levels',
    stepSize: 1,
    inactivityDays: 1,
    currentLabelFa: 'آخرین مرحله / لول رد شده',
    currentLabelEn: 'Current level / stage',
    currentPlaceholderFa: 'مثلاً مرحله ۷',
    currentPlaceholderEn: 'e.g. 7',
    totalLabelFa: 'کل مراحل (اختیاری)',
    totalLabelEn: 'Total levels (optional)',
    totalPlaceholderFa: 'مثلاً ۵۰',
    totalPlaceholderEn: 'e.g. 50'
  }
];

/**
 * Normalizes Persian & English strings for accurate fuzzy matching.
 */
export function normalizeFuzzyText(input: string): string {
  if (!input) return '';
  return input
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '') // Remove Arabic/Persian diacritics
    .replace(/[يئ]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/[أإآ]/g, 'ا')
    .replace(/\u200c/g, ' ') // Convert ZWNJ to space
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Computes Sørensen–Dice bigram similarity between two strings (0 to 1).
 */
function diceSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigramsA = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const bg = a.slice(i, i + 2);
    bigramsA.set(bg, (bigramsA.get(bg) || 0) + 1);
  }

  let intersection = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bg = b.slice(i, i + 2);
    const count = bigramsA.get(bg) || 0;
    if (count > 0) {
      bigramsA.set(bg, count - 1);
      intersection++;
    }
  }

  return (2.0 * intersection) / (a.length - 1 + (b.length - 1));
}

/**
 * Computes fuzzy match score between user title and a single keyword.
 */
function scoreKeywordAgainstText(normalizedTitle: string, titleTokens: string[], keyword: string): number {
  const normKw = normalizeFuzzyText(keyword);
  if (!normKw) return 0;

  // 1. Exact phrase or word match
  if (normalizedTitle === normKw) return 1.0;
  if (titleTokens.includes(normKw)) return 0.98;

  // 2. Multi-word phrase contained in title
  if (normKw.includes(' ') && normalizedTitle.includes(normKw)) {
    return 0.95;
  }

  // 3. Prefix/substring match on tokens (e.g., "پادکست‌های" matches "پادکست")
  let bestTokenScore = 0;
  for (const token of titleTokens) {
    if (token.length < 2) continue;
    if (token.startsWith(normKw) || (normKw.startsWith(token) && token.length >= 3)) {
      const ratio = Math.min(token.length, normKw.length) / Math.max(token.length, normKw.length);
      bestTokenScore = Math.max(bestTokenScore, 0.82 + ratio * 0.14);
    } else {
      // 4. Fuzzy Dice similarity for typos (e.g. "پادکس", "سریل", "اموزش")
      const sim = diceSimilarity(token, normKw);
      if (sim >= 0.65) {
        bestTokenScore = Math.max(bestTokenScore, sim * 0.9);
      }
    }
  }

  // Also check full string bigram similarity if keyword has spaces
  if (normKw.includes(' ')) {
    const phraseSim = diceSimilarity(normalizedTitle, normKw);
    if (phraseSim >= 0.65) {
      bestTokenScore = Math.max(bestTokenScore, phraseSim * 0.92);
    }
  }

  return bestTokenScore;
}

/**
 * Infers the domain, category tag, unit, step size, and contextual field labels
 * from the task title using Fuzzy Logic.
 */
export function inferInProgressFromTitle(title: string, isEn: boolean = false): FuzzyInferenceResult {
  const normalized = normalizeFuzzyText(title);
  const tokens = normalized.split(' ').filter(Boolean);

  const defaultResult: FuzzyInferenceResult = {
    id: 'general',
    categoryLabel: isEn ? 'In Progress' : 'در حال انجام',
    unit: isEn ? 'steps' : 'مرحله',
    stepSize: 1,
    inactivityDays: 1,
    currentInputLabel: isEn ? 'Current progress / step' : 'مرحله یا وضعیت فعلی',
    currentPlaceholder: isEn ? 'e.g. 2' : 'مثلاً مرحله ۲',
    totalInputLabel: isEn ? 'Total steps (optional)' : 'کل مراحل (اختیاری)',
    totalPlaceholder: isEn ? 'e.g. 10' : 'مثلاً ۱۰',
    confidence: 0,
    isDefault: true
  };

  if (!normalized) {
    return defaultResult;
  }

  let bestRule: DomainRule | null = null;
  let bestScore = 0;

  for (const rule of DOMAIN_RULES) {
    const allKeywords = [...rule.keywordsFa, ...rule.keywordsEn];
    let ruleMaxScore = 0;
    let matchedCount = 0;

    for (const kw of allKeywords) {
      const score = scoreKeywordAgainstText(normalized, tokens, kw);
      if (score > 0.62) {
        matchedCount++;
        if (score > ruleMaxScore) {
          ruleMaxScore = score;
        }
      }
    }

    // Slight boost if multiple keywords from the same domain appear in the title
    const finalScore = Math.min(1, ruleMaxScore + Math.min(0.08, (matchedCount - 1) * 0.03));

    if (finalScore > bestScore) {
      bestScore = finalScore;
      bestRule = rule;
    }
  }

  // Threshold for fuzzy confidence
  if (!bestRule || bestScore < 0.64) {
    return defaultResult;
  }

  // Special sub-rule refinement: if Quran/Spiritual and user wrote "جزء" or "جز", set unit to "جزء" and suggested total 30
  if (bestRule.id === 'quran_spiritual' && (normalized.includes('جزء') || normalized.includes('جز'))) {
    return {
      id: bestRule.id,
      categoryLabel: isEn ? bestRule.categoryEn : bestRule.categoryFa,
      unit: isEn ? 'Juz' : 'جزء',
      stepSize: 1,
      inactivityDays: bestRule.inactivityDays,
      currentInputLabel: isEn ? 'Last Juz read' : 'آخرین جزء خوانده شده',
      currentPlaceholder: isEn ? 'e.g. 5' : 'مثلاً جزء ۵',
      totalInputLabel: isEn ? 'Total Juz (optional)' : 'تعداد کل جزءها (اختیاری)',
      totalPlaceholder: isEn ? 'e.g. 30' : 'مثلاً ۳۰',
      suggestedTotal: 30,
      confidence: bestScore,
      isDefault: false
    };
  }

  // Special sub-rule refinement: if Book/Reading and user wrote "فصل", set unit to "فصل"
  if (bestRule.id === 'book' && tokens.includes('فصل') && !tokens.includes('صفحه')) {
    return {
      id: bestRule.id,
      categoryLabel: isEn ? bestRule.categoryEn : bestRule.categoryFa,
      unit: isEn ? 'chapters' : 'فصل',
      stepSize: 1,
      inactivityDays: bestRule.inactivityDays,
      currentInputLabel: isEn ? 'Last chapter read' : 'آخرین فصل مطالعه شده',
      currentPlaceholder: isEn ? 'e.g. 3' : 'مثلاً فصل ۳',
      totalInputLabel: isEn ? 'Total chapters (optional)' : 'تعداد کل فصول (اختیاری)',
      totalPlaceholder: isEn ? 'e.g. 12' : 'مثلاً ۱۲',
      confidence: bestScore,
      isDefault: false
    };
  }

  // Special sub-rule refinement: if Course and user wrote "تست", adapt unit
  if (bestRule.id === 'course' && tokens.includes('تست')) {
    return {
      id: bestRule.id,
      categoryLabel: isEn ? bestRule.categoryEn : bestRule.categoryFa,
      unit: isEn ? 'tests' : 'تست',
      stepSize: 10,
      inactivityDays: bestRule.inactivityDays,
      currentInputLabel: isEn ? 'Tests solved so far' : 'تعداد تست‌های زده شده',
      currentPlaceholder: isEn ? 'e.g. 50' : 'مثلاً ۵۰ تست',
      totalInputLabel: isEn ? 'Total tests (optional)' : 'تعداد کل تست‌ها (اختیاری)',
      totalPlaceholder: isEn ? 'e.g. 300' : 'مثلاً ۳۰۰',
      confidence: bestScore,
      isDefault: false
    };
  }

  return {
    id: bestRule.id,
    categoryLabel: isEn ? bestRule.categoryEn : bestRule.categoryFa,
    unit: isEn ? bestRule.unitEn : bestRule.unitFa,
    stepSize: bestRule.stepSize,
    inactivityDays: bestRule.inactivityDays,
    currentInputLabel: isEn ? bestRule.currentLabelEn : bestRule.currentLabelFa,
    currentPlaceholder: isEn ? bestRule.currentPlaceholderEn : bestRule.currentPlaceholderFa,
    totalInputLabel: isEn ? bestRule.totalLabelEn : bestRule.totalLabelFa,
    totalPlaceholder: isEn ? bestRule.totalPlaceholderEn : bestRule.totalPlaceholderFa,
    suggestedTotal: bestRule.suggestedTotal,
    confidence: bestScore,
    isDefault: false
  };
}

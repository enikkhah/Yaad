import { MedicationInstruction } from '../types';

export interface MedicationFuzzyInference {
  id: string;
  categoryLabel: string;
  unit: string;
  defaultDose: number;
  doseInputLabel: string;
  dosePlaceholder: string;
  stockInputLabel: string;
  stockPlaceholder: string;
  suggestedInstruction: MedicationInstruction;
  suggestedIntervalHours: number;
  confidence: number;
}

interface MedicationDomainRule {
  id: string;
  keywordsFa: string[];
  keywordsEn: string[];
  categoryFa: string;
  categoryEn: string;
  unitFa: string;
  unitEn: string;
  defaultDose: number;
  doseLabelFa: string;
  doseLabelEn: string;
  dosePlaceholderFa: string;
  dosePlaceholderEn: string;
  stockLabelFa: string;
  stockLabelEn: string;
  stockPlaceholderFa: string;
  stockPlaceholderEn: string;
  suggestedInstruction: MedicationInstruction;
  suggestedIntervalHours: number;
}

const MEDICATION_RULES: MedicationDomainRule[] = [
  {
    id: 'syrup_liquid',
    keywordsFa: [
      'شربت', 'سوسپانسیون', 'الیکسیر', 'محلول خوراکی', 'سی سی', 'سی‌سی', 'میلی لیتر',
      'دیفن هیدرامین', 'دیفن‌هیدرامین', 'شربت سینه', 'اکسپکتورانت', 'برم هگزین', 'دکسترومتورفان',
      'آلومینیوم ام جی', 'شربت معده', 'شربت زینک', 'شربت استامینوفن', 'شربت ایبوپروفن', 'لاکتولوز'
    ],
    keywordsEn: ['syrup', 'suspension', 'elixir', 'liquid', 'ml', 'cc', 'diphenhydramine', 'expectorant'],
    categoryFa: 'شربت و مایعات',
    categoryEn: 'Syrup & Liquid',
    unitFa: 'سی‌سی',
    unitEn: 'ml',
    defaultDose: 5,
    doseLabelFa: 'مقدار مصرف در هر نوبت (سی‌سی)',
    doseLabelEn: 'Dose per intake (ml)',
    dosePlaceholderFa: 'مثلاً ۵ یا ۱۰',
    dosePlaceholderEn: 'e.g. 5 or 10',
    stockLabelFa: 'حجم کل موجودی شربت (سی‌سی - اختیاری)',
    stockLabelEn: 'Total bottle volume (ml - optional)',
    stockPlaceholderFa: 'مثلاً ۱۲۰',
    stockPlaceholderEn: 'e.g. 120',
    suggestedInstruction: 'after_food',
    suggestedIntervalHours: 8,
  },
  {
    id: 'drops',
    keywordsFa: [
      'قطره', 'قطره چشمی', 'قطره گوشی', 'قطره بینی', 'اشک مصنوعی', 'کلرامفنیکل',
      'سیپروفلوکساسین چشمی', 'نفازولین', 'بتامتازون چشمی', 'تیمولول', 'قطره آهن', 'قطره آ د'
    ],
    keywordsEn: ['drop', 'drops', 'eyedrop', 'eardrop', 'nasal drop', 'artificial tears'],
    categoryFa: 'قطره دارویی',
    categoryEn: 'Medicated Drops',
    unitFa: 'قطره',
    unitEn: 'drops',
    defaultDose: 2,
    doseLabelFa: 'تعداد قطره در هر نوبت',
    doseLabelEn: 'Drops per intake',
    dosePlaceholderFa: 'مثلاً ۲ قطره',
    dosePlaceholderEn: 'e.g. 2',
    stockLabelFa: 'موجودی کل قطره‌ها (اختیاری)',
    stockLabelEn: 'Total drops available (optional)',
    stockPlaceholderFa: 'مثلاً ۱۰۰',
    stockPlaceholderEn: 'e.g. 100',
    suggestedInstruction: 'anytime',
    suggestedIntervalHours: 8,
  },
  {
    id: 'spray_inhaler',
    keywordsFa: [
      'اسپری', 'پاف', 'دم یار', 'دم‌یار', 'استنشاقی', 'آسم', 'سالبوتامول', 'ونتولین',
      'فلوتیکازون', 'سرتاید', 'بکلومتازون', 'سیمبیکورت', 'اسپری بینی', 'فلوئوناز', 'سدم کلراید'
    ],
    keywordsEn: ['spray', 'inhaler', 'puff', 'salbutamol', 'ventolin', 'fluticasone', 'seretide'],
    categoryFa: 'اسپری و استنشاقی',
    categoryEn: 'Spray & Inhaler',
    unitFa: 'پاف',
    unitEn: 'puffs',
    defaultDose: 2,
    doseLabelFa: 'تعداد پاف در هر نوبت',
    doseLabelEn: 'Puffs per intake',
    dosePlaceholderFa: 'مثلاً ۲ پاف',
    dosePlaceholderEn: 'e.g. 2',
    stockLabelFa: 'کل پاف‌های موجود در اسپری (اختیاری)',
    stockLabelEn: 'Total puffs in canister (optional)',
    stockPlaceholderFa: 'مثلاً ۲۰۰',
    stockPlaceholderEn: 'e.g. 200',
    suggestedInstruction: 'anytime',
    suggestedIntervalHours: 12,
  },
  {
    id: 'injection_insulin',
    keywordsFa: [
      'انسولین', 'آمپول', 'تزریق', 'تزریقی', 'ویال', 'سرم', 'قلم انسولین', 'لانتوس',
      'نووراپید', 'انوکساپارین', 'هپارین', 'پنی سیلین', 'پنی‌سیلین', 'ب کمپلکس تزریقی', 'نوروبیون'
    ],
    keywordsEn: ['insulin', 'injection', 'ampoule', 'vial', 'lantus', 'novorapid', 'pen', 'unit'],
    categoryFa: 'تزریقی و انسولین',
    categoryEn: 'Injection & Insulin',
    unitFa: 'واحد',
    unitEn: 'units',
    defaultDose: 1,
    doseLabelFa: 'مقدار تزریق در هر نوبت (واحد / عدد)',
    doseLabelEn: 'Dose per injection (units)',
    dosePlaceholderFa: 'مثلاً ۱ یا ۱۰',
    dosePlaceholderEn: 'e.g. 1 or 10',
    stockLabelFa: 'موجودی کل (واحد / عدد آمپول - اختیاری)',
    stockLabelEn: 'Total stock (units / ampoules - optional)',
    stockPlaceholderFa: 'مثلاً ۱۰',
    stockPlaceholderEn: 'e.g. 10',
    suggestedInstruction: 'before_food',
    suggestedIntervalHours: 12,
  },
  {
    id: 'topical_ointment',
    keywordsFa: [
      'پماد', 'کرم', 'ژل', 'لوسیون', 'موضعی', 'تتراسایکلین', 'موپیروسین', 'هیدروکورتیزون',
      'کلوتریمازول', 'آسیکلوویر', 'دیکلوفناک موضعی', 'پیرکسیکام', 'زینک اکساید'
    ],
    keywordsEn: ['ointment', 'cream', 'gel', 'lotion', 'topical'],
    categoryFa: 'پماد و موضعی',
    categoryEn: 'Topical & Ointment',
    unitFa: 'بار',
    unitEn: 'apply',
    defaultDose: 1,
    doseLabelFa: 'مقدار استفاده در هر نوبت (بار)',
    doseLabelEn: 'Applications per turn',
    dosePlaceholderFa: 'مثلاً ۱',
    dosePlaceholderEn: 'e.g. 1',
    stockLabelFa: 'تعداد دفعات قابل مصرف (اختیاری)',
    stockLabelEn: 'Total applications left (optional)',
    stockPlaceholderFa: 'مثلاً ۳۰',
    stockPlaceholderEn: 'e.g. 30',
    suggestedInstruction: 'anytime',
    suggestedIntervalHours: 12,
  },
  {
    id: 'powder_sachet',
    keywordsFa: [
      'پودر', 'ساشه', 'جوشان', 'قرص جوشان', 'او آر اس', 'پیدرولاکس', 'منیزیم ساشه',
      'کلاژن', 'پروتئین', 'کراتین', 'پیمانه'
    ],
    keywordsEn: ['powder', 'sachet', 'effervescent', 'ors', 'scoop'],
    categoryFa: 'پودر و ساشه',
    categoryEn: 'Powder & Sachet',
    unitFa: 'ساشه',
    unitEn: 'sachet',
    defaultDose: 1,
    doseLabelFa: 'تعداد ساشه / پیمانه در هر نوبت',
    doseLabelEn: 'Sachets / scoops per intake',
    dosePlaceholderFa: 'مثلاً ۱',
    dosePlaceholderEn: 'e.g. 1',
    stockLabelFa: 'تعداد کل ساشه موجود (اختیاری)',
    stockLabelEn: 'Total sachets in stock (optional)',
    stockPlaceholderFa: 'مثلاً ۲۰',
    stockPlaceholderEn: 'e.g. 20',
    suggestedInstruction: 'after_food',
    suggestedIntervalHours: 24,
  },
  {
    id: 'capsule_antibiotic',
    keywordsFa: [
      'کپسول', 'سافت ژل', 'سافت‌ژل', 'ژلاتینی', 'آموکسی سیلین', 'آموکسی‌سیلین', 'آزیترومایسین',
      'سفالکسین', 'سفیکسیم', 'داکسی سایکلین', 'کلیندامایسین', 'امپرازول', 'پنتوپرازول', 'اس امپرازول',
      'گاباپنتین', 'پرگابالین', 'فلوکستین', 'فرودین', 'فروس سولفات', 'کپسول آهن', 'امگا ۳', 'امگا'
    ],
    keywordsEn: ['capsule', 'softgel', 'amoxicillin', 'azithromycin', 'cephalexin', 'omeprazole', 'pantoprazole', 'omega'],
    categoryFa: 'کپسول خوراکی',
    categoryEn: 'Oral Capsule',
    unitFa: 'کپسول',
    unitEn: 'capsule',
    defaultDose: 1,
    doseLabelFa: 'تعداد کپسول در هر نوبت',
    doseLabelEn: 'Capsules per intake',
    dosePlaceholderFa: 'مثلاً ۱ کپسول',
    dosePlaceholderEn: 'e.g. 1',
    stockLabelFa: 'تعداد کل کپسول‌های موجود (اختیاری)',
    stockLabelEn: 'Total capsules in stock (optional)',
    stockPlaceholderFa: 'مثلاً ۲۰',
    stockPlaceholderEn: 'e.g. 20',
    suggestedInstruction: 'after_food',
    suggestedIntervalHours: 8,
  },
  {
    id: 'vitamin_supplement',
    keywordsFa: [
      'ویتامین', 'مولتی ویتامین', 'ویتامین دی', 'ویتامین سی', 'ویتامین ب', 'ب کمپلکس',
      'زینک پلاس', 'کلسیم', 'منیزیم', 'فولیک اسید', 'بیوتین', 'مکمل', 'هیرویت', 'ول من', 'ول وومن'
    ],
    keywordsEn: ['vitamin', 'multivitamin', 'supplement', 'zinc', 'calcium', 'magnesium', 'folic', 'biotin'],
    categoryFa: 'ویتامین و مکمل',
    categoryEn: 'Vitamin & Supplement',
    unitFa: 'عدد',
    unitEn: 'pill',
    defaultDose: 1,
    doseLabelFa: 'تعداد مصرف در هر نوبت (عدد)',
    doseLabelEn: 'Pills per intake',
    dosePlaceholderFa: 'مثلاً ۱ عدد',
    dosePlaceholderEn: 'e.g. 1',
    stockLabelFa: 'تعداد کل موجود در بسته (اختیاری)',
    stockLabelEn: 'Total pills in pack (optional)',
    stockPlaceholderFa: 'مثلاً ۳۰',
    stockPlaceholderEn: 'e.g. 30',
    suggestedInstruction: 'with_food',
    suggestedIntervalHours: 24,
  },
  {
    id: 'tablet_pill',
    keywordsFa: [
      'قرص', 'استامینوفن', 'ایبوپروفن', 'ژلوفن', 'ناپروکسن', 'مفنامیک', 'متفورمین', 'لوزارتان',
      'والزارتان', 'آملودیپین', 'آتورواستاتین', 'رزوواستاتین', 'آسپرین', 'لووتیروکسین', 'فاموتیدین',
      'سیتریزین', 'لوراتادین', 'فکسوفنادین', 'سرماخوردگی', 'آلتادین', 'پروپرانولول', 'متوپرولول',
      'سرترالین', 'سیتالوپرام', 'آلپرازولام', 'کلردیازپوکساید', 'پردنیزولون', 'دمپریدون', 'متوکلوپرامید'
    ],
    keywordsEn: ['tablet', 'pill', 'acetaminophen', 'ibuprofen', 'metformin', 'losartan', 'aspirin', 'levothyroxine', 'cetirizine'],
    categoryFa: 'قرص خوراکی',
    categoryEn: 'Oral Tablet',
    unitFa: 'قرص',
    unitEn: 'tablet',
    defaultDose: 1,
    doseLabelFa: 'تعداد قرص در هر نوبت',
    doseLabelEn: 'Tablets per intake',
    dosePlaceholderFa: 'مثلاً ۱ قرص',
    dosePlaceholderEn: 'e.g. 1',
    stockLabelFa: 'تعداد کل قرص‌های موجود (اختیاری)',
    stockLabelEn: 'Total tablets in stock (optional)',
    stockPlaceholderFa: 'مثلاً ۳۰',
    stockPlaceholderEn: 'e.g. 30',
    suggestedInstruction: 'after_food',
    suggestedIntervalHours: 8,
  },
];

function normalizeMedText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, ' ')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/ة/g, 'ه')
    .replace(/[أإآ]/g, 'ا')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const v0 = new Array(b.length + 1).fill(0);
  const v1 = new Array(b.length + 1).fill(0);
  for (let i = 0; i <= b.length; i++) v0[i] = i;
  for (let i = 0; i < a.length; i++) {
    v1[0] = i + 1;
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    for (let j = 0; j <= b.length; j++) v0[j] = v1[j];
  }
  return v1[b.length];
}

function scoreKeyword(text: string, tokens: string[], keyword: string): number {
  const kw = normalizeMedText(keyword);
  if (!kw) return 0;
  if (text === kw) return 1.0;
  if (tokens.includes(kw)) return 0.96;
  if (text.includes(kw)) return 0.9;

  for (const token of tokens) {
    if (token.length >= 3 && kw.length >= 3) {
      if (token.startsWith(kw) || kw.startsWith(token)) return 0.84;
      const dist = levenshtein(token, kw);
      const maxLen = Math.max(token.length, kw.length);
      const sim = 1 - dist / maxLen;
      if (sim >= 0.72) return sim * 0.85;
    }
  }
  return 0;
}

/**
 * Fuzzy Logic inference for Medication Name.
 * Automatically determines dosage unit, category tag, contextual input labels,
 * suggested instruction (e.g. empty stomach for omeprazole/levothyroxine), and interval.
 */
export function inferMedicationFromName(name: string, isEn: boolean = false): MedicationFuzzyInference {
  const normalized = normalizeMedText(name);
  const tokens = normalized ? normalized.split(' ') : [];

  const defaultRule = MEDICATION_RULES[MEDICATION_RULES.length - 1]; // tablet_pill

  if (!normalized) {
    return {
      id: defaultRule.id,
      categoryLabel: isEn ? defaultRule.categoryEn : defaultRule.categoryFa,
      unit: isEn ? defaultRule.unitEn : defaultRule.unitFa,
      defaultDose: defaultRule.defaultDose,
      doseInputLabel: isEn ? defaultRule.doseLabelEn : defaultRule.doseLabelFa,
      dosePlaceholder: isEn ? defaultRule.dosePlaceholderEn : defaultRule.dosePlaceholderFa,
      stockInputLabel: isEn ? defaultRule.stockLabelEn : defaultRule.stockLabelFa,
      stockPlaceholder: isEn ? defaultRule.stockPlaceholderEn : defaultRule.stockPlaceholderFa,
      suggestedInstruction: defaultRule.suggestedInstruction,
      suggestedIntervalHours: defaultRule.suggestedIntervalHours,
      confidence: 0,
    };
  }

  let bestRule = defaultRule;
  let bestScore = 0;

  for (const rule of MEDICATION_RULES) {
    let ruleScore = 0;
    const allKeywords = [...rule.keywordsFa, ...rule.keywordsEn];
    for (const kw of allKeywords) {
      const s = scoreKeyword(normalized, tokens, kw);
      if (s > ruleScore) ruleScore = s;
    }
    if (ruleScore > bestScore) {
      bestScore = ruleScore;
      bestRule = rule;
    }
  }

  // Contextual overrides for specific well-known medications (instruction & interval)
  let suggestedInstruction = bestRule.suggestedInstruction;
  let suggestedIntervalHours = bestRule.suggestedIntervalHours;

  if (/(امپرازول|پنتوپرازول|لووتیروکسین|omeprazole|pantoprazole|levothyroxine)/.test(normalized)) {
    suggestedInstruction = 'empty_stomach';
    suggestedIntervalHours = 24;
  } else if (/(متفورمین|گلی بن کلامید|metformin)/.test(normalized)) {
    suggestedInstruction = 'with_food';
    suggestedIntervalHours = 12;
  } else if (/(آزیترومایسین|لوراتادین|سیتریزین|آتورواستاتین|لوزارتان|azithromycin|cetirizine|atorvastatin)/.test(normalized)) {
    suggestedIntervalHours = 24;
  } else if (/(آموکسی|سفالکسین|استامینوفن|ایبوپروفن|ژلوفن|دیفن|amoxicillin|cephalexin|ibuprofen)/.test(normalized)) {
    suggestedInstruction = 'after_food';
    suggestedIntervalHours = 8;
  }

  return {
    id: bestRule.id,
    categoryLabel: isEn ? bestRule.categoryEn : bestRule.categoryFa,
    unit: isEn ? bestRule.unitEn : bestRule.unitFa,
    defaultDose: bestRule.defaultDose,
    doseInputLabel: isEn ? bestRule.doseLabelEn : bestRule.doseLabelFa,
    dosePlaceholder: isEn ? bestRule.dosePlaceholderEn : bestRule.dosePlaceholderFa,
    stockInputLabel: isEn ? bestRule.stockLabelEn : bestRule.stockLabelFa,
    stockPlaceholder: isEn ? bestRule.stockPlaceholderEn : bestRule.stockPlaceholderFa,
    suggestedInstruction,
    suggestedIntervalHours,
    confidence: Number(bestScore.toFixed(2)),
  };
}

/**
 * Generates evenly spaced HH:mm time slots starting from a given anchor hour (default 08:00)
 * so interval schedules (every 6h, 8h, 12h, 24h) never drift into random night hours.
 */
export function generateScheduledTimesFromInterval(
  intervalHours: number,
  startHour: number = 8,
  startMinute: number = 0
): string[] {
  const safeInterval = Math.max(1, Math.min(24, Math.round(intervalHours || 8)));
  const count = Math.max(1, Math.floor(24 / safeInterval));
  const times: string[] = [];

  for (let i = 0; i < count; i++) {
    const h = (startHour + i * safeInterval) % 24;
    const hh = h.toString().padStart(2, '0');
    const mm = startMinute.toString().padStart(2, '0');
    times.push(`${hh}:${mm}`);
  }

  return times;
}

export function getMedicationInstructionLabel(
  instruction: MedicationInstruction,
  isEn: boolean = false
): string {
  switch (instruction) {
    case 'after_food':
      return isEn ? 'After Meal' : 'بعد از غذا';
    case 'before_food':
      return isEn ? 'Before Meal' : 'قبل از غذا';
    case 'with_food':
      return isEn ? 'With Meal' : 'همراه با غذا';
    case 'empty_stomach':
      return isEn ? 'Empty Stomach' : 'ناشتا (معده خالی)';
    case 'anytime':
    default:
      return isEn ? 'Anytime' : 'هر زمان (آزاد)';
  }
}

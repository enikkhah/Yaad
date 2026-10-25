import { Occasion, OccasionType, Reminder } from '../types';
import { 
  getJalaliComponents, 
  jalaliToTimestamp, 
  toPersianDigits, 
  PERSIAN_MONTHS, 
  GREGORIAN_MONTHS,
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
  activeTabClass: string;
  headerBgClass: string;
  accentTextClass: string;
  primaryBtnClass: string;
  moodTitleFa: string;
  moodTitleEn: string;
  moodDescFa: string;
  moodDescEn: string;
  titlePlaceholderFa: string;
  titlePlaceholderEn: string;
  personLabelFa: string;
  personLabelEn: string;
  personPlaceholderFa: string;
  personPlaceholderEn: string;
  yearToggleLabelFa: string;
  yearToggleLabelEn: string;
  noteLabelFa: string;
  noteLabelEn: string;
  notePlaceholderFa: string;
  notePlaceholderEn: string;
  defaultTime: string;
}

export const OCCASION_TYPES: OccasionTypeMeta[] = [
  {
    type: 'birthday',
    labelFa: 'تولد',
    labelEn: 'Birthday',
    iconName: 'Cake',
    badgeBg: 'bg-rose-500/15',
    badgeText: 'text-rose-300',
    borderCol: 'border-rose-500/45',
    activeTabClass: 'bg-rose-600 border-rose-400 text-white shadow-md shadow-rose-600/25',
    headerBgClass: 'from-rose-950/60 via-stone-900/95 to-stone-950 border-rose-500/50',
    accentTextClass: 'text-rose-400',
    primaryBtnClass: 'bg-rose-500 hover:bg-rose-400 text-white shadow-rose-500/25',
    moodTitleFa: 'جشن تولد و زادروز عزیزان',
    moodTitleEn: 'Birthdays & Celebrations',
    moodDescFa: 'ثبت تاریخ تولد عزیزان، محاسبه خودکار سن و یادآوری به‌موقع برای تبریک و تهیه هدیه',
    moodDescEn: 'Track birthdays with automatic age calculation and timely gift & celebration reminders',
    titlePlaceholderFa: 'مثال: تولد علی، تولد سارا، تولد مادر...',
    titlePlaceholderEn: 'e.g. Ali Birthday, Mom Birthday...',
    personLabelFa: 'نام متولد (اختیاری)',
    personLabelEn: 'Birthday Person (Optional)',
    personPlaceholderFa: 'مثلاً: علی، سارا، مادر...',
    personPlaceholderEn: 'e.g. Sarah, Ali, Mom...',
    yearToggleLabelFa: 'محاسبه سن متولد (ثبت سال تولد)',
    yearToggleLabelEn: 'Calculate Age (Set Birth Year)',
    noteLabelFa: 'یادداشت، ایده کادو یا تدارک جشن (اختیاری)',
    noteLabelEn: 'Notes, Gift Ideas or Party Plans (Optional)',
    notePlaceholderFa: 'مثلاً: علاقه‌مند به کتاب و ساعت، سفارش کیک، ایده خرید کادو...',
    notePlaceholderEn: 'e.g. Loves books, cake order, gift idea...',
    defaultTime: '09:00',
  },
  {
    type: 'wedding',
    labelFa: 'سالگرد ازدواج',
    labelEn: 'Wedding Anniversary',
    iconName: 'HeartHandshake',
    badgeBg: 'bg-pink-500/15',
    badgeText: 'text-pink-300',
    borderCol: 'border-pink-500/45',
    activeTabClass: 'bg-pink-600 border-pink-400 text-white shadow-md shadow-pink-600/25',
    headerBgClass: 'from-pink-950/60 via-stone-900/95 to-stone-950 border-pink-500/50',
    accentTextClass: 'text-pink-400',
    primaryBtnClass: 'bg-pink-500 hover:bg-pink-400 text-white shadow-pink-500/25',
    moodTitleFa: 'سالگرد ازدواج و پیوند عاشقانه',
    moodTitleEn: 'Wedding Anniversaries',
    moodDescFa: 'یادآوری سالگرد ازدواج و عقد با شمارش معکوس و محاسبه سال‌های زندگی مشترک',
    moodDescEn: 'Celebrate wedding milestones with yearly countdowns and romantic planning',
    titlePlaceholderFa: 'مثال: سالگرد ازدواج ما، سالگرد عقد مریم و رضا...',
    titlePlaceholderEn: 'e.g. Our Wedding Anniversary...',
    personLabelFa: 'نام همسر یا زوج (اختیاری)',
    personLabelEn: 'Spouse / Couple Name (Optional)',
    personPlaceholderFa: 'مثلاً: همسرم، مریم و رضا...',
    personPlaceholderEn: 'e.g. My Spouse, Sarah & John...',
    yearToggleLabelFa: 'محاسبه چندمین سالگرد ازدواج (ثبت سال ازدواج)',
    yearToggleLabelEn: 'Calculate Wedding Anniversary Year',
    noteLabelFa: 'یادداشت، ایده هدیه سالگرد یا رزرو شام (اختیاری)',
    noteLabelEn: 'Anniversary Gift or Dinner Plans (Optional)',
    notePlaceholderFa: 'مثلاً: رزرو رستوران، خرید گل، هدیه سالگرد ازدواج...',
    notePlaceholderEn: 'e.g. Dinner reservation, flowers, anniversary gift...',
    defaultTime: '09:00',
  },
  {
    type: 'dating',
    labelFa: 'سالگرد آشنایی / دوستی',
    labelEn: 'Relationship Anniversary',
    iconName: 'Sparkles',
    badgeBg: 'bg-purple-500/15',
    badgeText: 'text-purple-300',
    borderCol: 'border-purple-500/45',
    activeTabClass: 'bg-purple-600 border-purple-400 text-white shadow-md shadow-purple-600/25',
    headerBgClass: 'from-purple-950/60 via-stone-900/95 to-stone-950 border-purple-500/50',
    accentTextClass: 'text-purple-400',
    primaryBtnClass: 'bg-purple-500 hover:bg-purple-400 text-white shadow-purple-500/25',
    moodTitleFa: 'سالگرد آشنایی و خاطرات دوستی',
    moodTitleEn: 'Relationship & Friendship Milestones',
    moodDescFa: 'ثبت روزهای خاطره‌انگیز آشنایی، اولین دیدار و دوستی‌های صمیمی',
    moodDescEn: 'Remember special relationship milestones and first-meet anniversaries',
    titlePlaceholderFa: 'مثال: سالگرد آشنایی، سالگرد اولین دیدار...',
    titlePlaceholderEn: 'e.g. First Meet Anniversary...',
    personLabelFa: 'نام مخاطب خاص یا دوست (اختیاری)',
    personLabelEn: 'Partner or Friend Name (Optional)',
    personPlaceholderFa: 'مثلاً: سارا، امیر...',
    personPlaceholderEn: 'e.g. Alex, Emma...',
    yearToggleLabelFa: 'محاسبه چندمین سالگرد آشنایی (ثبت سال شروع)',
    yearToggleLabelEn: 'Calculate Years Together',
    noteLabelFa: 'یادداشت، سورپرایز یا خاطره مشترک (اختیاری)',
    noteLabelEn: 'Shared Memory or Surprise Idea (Optional)',
    notePlaceholderFa: 'مثلاً: قرار در کافه همیشگی، یادگاری ویژه...',
    notePlaceholderEn: 'e.g. Favorite cafe, special keepsake...',
    defaultTime: '10:00',
  },
  {
    type: 'memorial',
    labelFa: 'سالگرد فوت عزیزان',
    labelEn: 'Memorial Day',
    iconName: 'Flame',
    badgeBg: 'bg-slate-500/20',
    badgeText: 'text-slate-200',
    borderCol: 'border-slate-500/50',
    activeTabClass: 'bg-slate-700 border-slate-400 text-slate-100 shadow-md shadow-slate-900/50',
    headerBgClass: 'from-slate-900/90 via-stone-950 to-zinc-950 border-slate-500/55',
    accentTextClass: 'text-slate-300',
    primaryBtnClass: 'bg-slate-600 hover:bg-slate-500 text-white shadow-slate-700/30',
    moodTitleFa: 'یادبود و سالگرد درگذشت عزیزان',
    moodTitleEn: 'In Loving Memory & Memorials',
    moodDescFa: 'گرامیداشت یاد و خاطره درگذشتگان، یادآوری تاریخ سالگرد وفات، قرائت فاتحه، خیرات و مراسم یادبود',
    moodDescEn: 'Honor the memory of departed loved ones with respectful memorial and tribute reminders',
    titlePlaceholderFa: 'مثال: سالگرد درگذشت پدربزرگ، یادبود مادر بزرگوار...',
    titlePlaceholderEn: 'e.g. Grandfather Memorial Day...',
    personLabelFa: 'نام مرحوم / عزیز از دست‌رفته (اختیاری)',
    personLabelEn: 'Name of Departed Loved One (Optional)',
    personPlaceholderFa: 'مثلاً: مرحوم پدربزرگ، حاج علی...',
    personPlaceholderEn: 'e.g. Late Grandfather...',
    yearToggleLabelFa: 'محاسبه چندمین سالگرد درگذشت (ثبت سال وفات)',
    yearToggleLabelEn: 'Calculate Years Since Passing (Set Year)',
    noteLabelFa: 'یادداشت مراسم یادبود، خیرات یا قرائت فاتحه (اختیاری)',
    noteLabelEn: 'Memorial Service, Charity or Tribute Notes (Optional)',
    notePlaceholderFa: 'مثلاً: قرائت فاتحه و قرآن، تهیه گل و خرما، حضور در آرامستان، هماهنگی مراسم یادبود...',
    notePlaceholderEn: 'e.g. Visit cemetery, flowers, charity & prayers, family gathering...',
    defaultTime: '09:00',
  },
  {
    type: 'family',
    labelFa: 'مناسبت خانوادگی',
    labelEn: 'Family Occasion',
    iconName: 'Users',
    badgeBg: 'bg-emerald-500/15',
    badgeText: 'text-emerald-300',
    borderCol: 'border-emerald-500/45',
    activeTabClass: 'bg-emerald-600 border-emerald-400 text-white shadow-md shadow-emerald-600/25',
    headerBgClass: 'from-emerald-950/55 via-stone-900/95 to-stone-950 border-emerald-500/50',
    accentTextClass: 'text-emerald-400',
    primaryBtnClass: 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/25',
    moodTitleFa: 'مناسبت‌ها و دورهمی‌های خانوادگی',
    moodTitleEn: 'Family Gatherings & Milestones',
    moodDescFa: 'ثبت رویدادهای مهم خانواده، دید و بازدیدها، جشن‌های خانوادگی و سالگردها',
    moodDescEn: 'Keep track of important family reunions, traditions, and milestones',
    titlePlaceholderFa: 'مثال: دورهمی خانوادگی، جشن فارغ‌التحصیلی، دید و بازدید...',
    titlePlaceholderEn: 'e.g. Family Reunion, Graduation...',
    personLabelFa: 'نام عضو خانواده یا میزبان (اختیاری)',
    personLabelEn: 'Family Member / Host (Optional)',
    personPlaceholderFa: 'مثلاً: منزل پدر و مادر، خانواده...',
    personPlaceholderEn: 'e.g. Parents House, Family...',
    yearToggleLabelFa: 'محاسبه چندمین سالگرد رویداد خانوادگی (ثبت سال مبدأ)',
    yearToggleLabelEn: 'Calculate Milestone Year (Set Start Year)',
    noteLabelFa: 'یادداشت هماهنگی یا تدارک برنامه خانوادگی (اختیاری)',
    noteLabelEn: 'Family Coordination & Preparation Notes (Optional)',
    notePlaceholderFa: 'مثلاً: هماهنگی با اعضای خانواده، پذیرایی، برنامه شام...',
    notePlaceholderEn: 'e.g. Coordinate with family members, dinner plans...',
    defaultTime: '09:00',
  },
  {
    type: 'work',
    labelFa: 'مناسبت کاری و حرفه‌ای',
    labelEn: 'Work & Professional',
    iconName: 'Briefcase',
    badgeBg: 'bg-sky-500/15',
    badgeText: 'text-sky-300',
    borderCol: 'border-sky-500/45',
    activeTabClass: 'bg-sky-600 border-sky-400 text-white shadow-md shadow-sky-600/25',
    headerBgClass: 'from-sky-950/60 via-stone-900/95 to-stone-950 border-sky-500/50',
    accentTextClass: 'text-sky-400',
    primaryBtnClass: 'bg-sky-600 hover:bg-sky-500 text-white shadow-sky-600/25',
    moodTitleFa: 'رویدادها و سالگردهای کاری و حرفه‌ای',
    moodTitleEn: 'Work & Professional Milestones',
    moodDescFa: 'پیگیری سالگرد تأسیس، سررسید قراردادها، تاریخ استخدام و مناسبت‌های رسمی و سازمانی',
    moodDescEn: 'Manage company anniversaries, contract renewals, and professional dates',
    titlePlaceholderFa: 'مثال: سالگرد تأسیس شرکت، تمدید قرارداد، سالگرد همکاری...',
    titlePlaceholderEn: 'e.g. Company Anniversary, Contract Renewal...',
    personLabelFa: 'نام همکار، سازمان یا پروژه (اختیاری)',
    personLabelEn: 'Colleague, Organization or Project (Optional)',
    personPlaceholderFa: 'مثلاً: شرکت، تیم فنی، مهندس رضایی...',
    personPlaceholderEn: 'e.g. Tech Team, Client Name...',
    yearToggleLabelFa: 'محاسبه سابقه یا چندمین سالگرد کاری (ثبت سال شروع)',
    yearToggleLabelEn: 'Calculate Work Tenure / Anniversary Year',
    noteLabelFa: 'یادداشت کاری، دستور کار یا اقدام لازم (اختیاری)',
    noteLabelEn: 'Professional Action Items or Notes (Optional)',
    notePlaceholderFa: 'مثلاً: ارسال پیام تبریک رسمی، آماده‌سازی گزارش، تمدید قرارداد...',
    notePlaceholderEn: 'e.g. Send official message, prepare report, renew contract...',
    defaultTime: '08:30',
  },
  {
    type: 'custom',
    labelFa: 'سایر مناسبت‌های مهم',
    labelEn: 'Custom Occasion',
    iconName: 'CalendarHeart',
    badgeBg: 'bg-amber-500/15',
    badgeText: 'text-amber-300',
    borderCol: 'border-amber-500/45',
    activeTabClass: 'bg-amber-500 border-amber-300 text-stone-950 shadow-md shadow-amber-500/25',
    headerBgClass: 'from-amber-950/55 via-stone-900/95 to-stone-950 border-amber-500/50',
    accentTextClass: 'text-amber-400',
    primaryBtnClass: 'bg-amber-500 hover:bg-amber-400 text-stone-950 shadow-amber-500/25',
    moodTitleFa: 'سایر مناسبت‌ها و تاریخ‌های ویژه',
    moodTitleEn: 'Custom Special Dates',
    moodDescFa: 'ثبت هرگونه سالگرد شخصی، رویداد خاص و تاریخ‌های مهم سالانه با یادآور هوشمند',
    moodDescEn: 'Register any personal milestone or annual event with smart reminders',
    titlePlaceholderFa: 'مثال: سالگرد خرید خانه، روز جهانی، رویداد شخصی...',
    titlePlaceholderEn: 'e.g. New Home Anniversary, Special Event...',
    personLabelFa: 'نام شخص یا مخاطب مرتبط (اختیاری)',
    personLabelEn: 'Related Person (Optional)',
    personPlaceholderFa: 'مثلاً: نام شخص یا مکان مرتبط...',
    personPlaceholderEn: 'e.g. Person or group...',
    yearToggleLabelFa: 'محاسبه چندمین سالگرد رویداد (ثبت سال مبدأ)',
    yearToggleLabelEn: 'Calculate Years Passed (Set Start Year)',
    noteLabelFa: 'یادداشت و توضیحات مناسبت (اختیاری)',
    noteLabelEn: 'Occasion Notes & Details (Optional)',
    notePlaceholderFa: 'مثلاً: توضیحات، برنامه‌ریزی یا نکات مهم این روز...',
    notePlaceholderEn: 'e.g. Details and plans for this date...',
    defaultTime: '09:00',
  },
];

export function getOccasionTypeMeta(type: OccasionType): OccasionTypeMeta {
  return OCCASION_TYPES.find((t) => t.type === type) || OCCASION_TYPES[OCCASION_TYPES.length - 1];
}

export function getNotifyDaysOptionsForType(type: OccasionType): { days: number; labelFa: string; labelEn: string }[] {
  if (type === 'memorial') {
    return [
      { days: 0, labelFa: 'همان روز (روز سالگرد وفات)', labelEn: 'Same Day (Memorial Day)' },
      { days: 1, labelFa: '۱ روز قبل (یادآوری فردا)', labelEn: '1 Day Before' },
      { days: 2, labelFa: '۲ روز قبل (تدارک خیرات و مراسم)', labelEn: '2 Days Before (Preparations)' },
      { days: 3, labelFa: '۳ روز قبل (هماهنگی با خانواده)', labelEn: '3 Days Before (Family Notice)' },
      { days: 7, labelFa: '۱ هفته قبل (هماهنگی مراسم یادبود)', labelEn: '1 Week Before (Service Planning)' },
    ];
  }
  if (type === 'work') {
    return [
      { days: 0, labelFa: 'همان روز (روز رویداد کاری)', labelEn: 'Same Day' },
      { days: 1, labelFa: '۱ روز قبل (آماده‌سازی مقدمات)', labelEn: '1 Day Before' },
      { days: 2, labelFa: '۲ روز قبل (هماهنگی تیمی)', labelEn: '2 Days Before' },
      { days: 3, labelFa: '۳ روز قبل', labelEn: '3 Days Before' },
      { days: 7, labelFa: '۱ هفته قبل (برنامه‌ریزی و پیگیری)', labelEn: '1 Week Before' },
    ];
  }
  if (type === 'family' || type === 'custom') {
    return [
      { days: 0, labelFa: 'همان روز (روز رویداد)', labelEn: 'Same Day' },
      { days: 1, labelFa: '۱ روز قبل (فرداش مناسبته)', labelEn: '1 Day Before' },
      { days: 2, labelFa: '۲ روز قبل (برای تدارک و هماهنگی)', labelEn: '2 Days Before' },
      { days: 3, labelFa: '۳ روز قبل', labelEn: '3 Days Before' },
      { days: 7, labelFa: '۱ هفته قبل (برنامه‌ریزی از قبل)', labelEn: '1 Week Before' },
    ];
  }
  // birthday, wedding, dating
  return [
    { days: 0, labelFa: 'همان روز (روز جشن و تبریک)', labelEn: 'Same Day' },
    { days: 1, labelFa: '۱ روز قبل (فرداش مناسبته)', labelEn: '1 Day Before' },
    { days: 2, labelFa: '۲ روز قبل (برای تدارک)', labelEn: '2 Days Before' },
    { days: 3, labelFa: '۳ روز قبل', labelEn: '3 Days Before' },
    { days: 7, labelFa: '۱ هفته قبل (برای خرید کادو)', labelEn: '1 Week Before (Gift Shopping)' },
  ];
}

/**
 * Calculates next timestamp for the occasion, days remaining, and current anniversary turn (e.g., 25th birthday).
 */
export function calculateNextOccasionOccurrence(
  occasion: Occasion,
  referenceTimestamp = Date.now(),
  language: string = 'fa'
): {
  nextTimestamp: number;
  daysRemaining: number;
  occurrenceYear: number;
  yearsPassed: number | null;
  isToday: boolean;
  formattedTargetDate: string;
} {
  const isEn = language === 'en';
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

  const monthNameFa = PERSIAN_MONTHS[occasion.solarMonth - 1] || 'فروردین';
  const monthNameEn = GREGORIAN_MONTHS[occasion.solarMonth - 1] || 'January';
  const formattedTargetDate = isEn 
    ? `${monthNameEn} ${occasion.solarDay}, ${occurrenceYear}`
    : `${toPersianDigits(occasion.solarDay)} ${monthNameFa} ${toPersianDigits(occurrenceYear)}`;

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
    ringTune: occasion.ringTune || 'family',
    voiceReadAloud: true,
    recurrence: 'none',
  };
}

export type AppLanguage = 'fa' | 'en';

export interface Translations {
  newReminder: string;
  settings: string;
  categoryWork: string;
  categoryFamily: string;
  categoryOther: string;
  priorityHigh: string;
  priorityMedium: string;
  priorityLow: string;
  statsTitle: string;
  viewStats: string;
  confirm: string;
  statsWeekly: string;
  statsMonthly: string;
  statsYearly: string;
  statsTotal: string;
  statsDone: string;
  statsPostponed: string;
  tabReminders: string;
  tabIdeas: string;
  tabLocations: string;
  tabOccasions: string;
  installApp: string;
}

export const translations: Record<AppLanguage, Translations> = {
  fa: {
    newReminder: 'ثبت سریع یادآور',
    settings: 'تنظیمات',
    categoryWork: 'کار',
    categoryFamily: 'خانواده',
    categoryOther: 'سایر',
    priorityHigh: 'فوری',
    priorityMedium: 'متوسط',
    priorityLow: 'عادی',
    statsTitle: 'آمار و گزارش عملکرد',
    viewStats: 'مشاهده آمار',
    confirm: 'تأیید',
    statsWeekly: 'گزارش هفتگی',
    statsMonthly: 'گزارش ماهانه',
    statsYearly: 'گزارش سالانه',
    statsTotal: 'کل یادآورها',
    statsDone: 'انجام‌شده',
    statsPostponed: 'به تعویق افتاده',
    tabReminders: 'یادآورها',
    tabIdeas: 'ایده‌ها',
    tabLocations: 'مکان‌ها',
    tabOccasions: 'مناسبت‌ها',
    installApp: 'نصب برنامه',
  },
  en: {
    newReminder: 'Add Reminder',
    settings: 'Settings',
    categoryWork: 'Work',
    categoryFamily: 'Family',
    categoryOther: 'Other',
    priorityHigh: 'High',
    priorityMedium: 'Medium',
    priorityLow: 'Normal',
    statsTitle: 'Performance Statistics',
    viewStats: 'View Statistics',
    confirm: 'Confirm',
    statsWeekly: 'Weekly Report',
    statsMonthly: 'Monthly Report',
    statsYearly: 'Yearly Report',
    statsTotal: 'Total Reminders',
    statsDone: 'Completed',
    statsPostponed: 'Postponed',
    tabReminders: 'Reminders',
    tabIdeas: 'Ideas',
    tabLocations: 'Places',
    tabOccasions: 'Occasions',
    installApp: 'Install App',
  },
};

export function getT(lang: AppLanguage = 'fa'): Translations {
  return translations[lang] || translations.fa;
}

const PERSIAN_DIGITS_MAP: Record<string, string> = {
  '۰': '0',
  '۱': '1',
  '۲': '2',
  '۳': '3',
  '۴': '4',
  '۵': '5',
  '۶': '6',
  '۷': '7',
  '۸': '8',
  '۹': '9',
};

const ENGLISH_DIGITS_MAP: Record<string, string> = {
  '0': '۰',
  '1': '۱',
  '2': '۲',
  '3': '۳',
  '4': '۴',
  '5': '۵',
  '6': '۶',
  '7': '۷',
  '8': '۸',
  '9': '۹',
};

export function formatSavedLocationTitle(rawTitle: string, lang: AppLanguage = 'fa'): string {
  if (!rawTitle) return '';
  if (lang === 'en') {
    const convertedDigits = rawTitle.replace(/[۰-۹]/g, (d) => PERSIAN_DIGITS_MAP[d] ?? d);
    return convertedDigits
      .replace(/موقعیت ثبت[‌\s]*شده/g, 'Saved Location')
      .replace(/مکان ثبت[‌\s]*شده/g, 'Saved Location')
      .replace(/موقعیت فعلی من/g, 'Current Location');
  } else {
    const convertedDigits = rawTitle.replace(/[0-9]/g, (d) => ENGLISH_DIGITS_MAP[d] ?? d);
    return convertedDigits
      .replace(/Saved Location/gi, 'موقعیت ثبت‌شده');
  }
}


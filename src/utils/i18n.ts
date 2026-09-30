export type AppLanguage = 'fa' | 'en';

export interface Translations {
  appTitle: string;
  appSubtitle: string;
  newReminder: string;
  captureIdea: string;
  settings: string;
  stats: string;
  searchPlaceholder: string;
  filterAll: string;
  filterPending: string;
  filterCompleted: string;
  filterPostponed: string;
  filterWork: string;
  filterFamily: string;
  filterOther: string;
  categoryWork: string;
  categoryFamily: string;
  categoryOther: string;
  priorityHigh: string;
  priorityMedium: string;
  priorityLow: string;
  done: string;
  postpone15: string;
  edit: string;
  delete: string;
  upcomingNext: string;
  save: string;
  cancel: string;
  language: string;
  languagePersian: string;
  languageEnglish: string;
  theme: string;
  fontSize: string;
  fontSmall: string;
  fontNormal: string;
  fontLarge: string;
  fontXLarge: string;
  alarmVolume: string;
  alarmSound: string;
  voiceSpeechRate: string;
  systemNotification: string;
  enableFlash: string;
  timelineOrientation: string;
  vertical: string;
  horizontal: string;
  recurrenceTitle: string;
  recurrenceNone: string;
  recurrenceHourly: string;
  recurrenceDaily: string;
  recurrenceWeekly: string;
  recurrenceMonthly: string;
  recurrenceCalendar: string;
  timeRotateLabel: string;
  hourLabel: string;
  minuteLabel: string;
  typingHint: string;
  strobeLed: string;
  autoMicInput: string;
  statsTitle: string;
  viewStats: string;
  mapsServiceTitle: string;
  mapsKeyLabel: string;
  saved: string;
  confirm: string;
  statsWeekly: string;
  statsMonthly: string;
  statsYearly: string;
  statsTotal: string;
  statsDone: string;
  statsPostponed: string;
}

export const translations: Record<AppLanguage, Translations> = {
  fa: {
    appTitle: 'یاد',
    appSubtitle: 'مدیریت حرفه‌ای وظایف با آلارم رسا و تقویم فارسی',
    newReminder: 'ثبت سریع یادآور',
    captureIdea: 'یادداشت ایده',
    settings: 'تنظیمات',
    stats: 'آمار',
    searchPlaceholder: 'جستجو در یادآورها و ایده‌ها...',
    filterAll: 'همه',
    filterPending: 'در انتظار',
    filterCompleted: 'انجام‌شده',
    filterPostponed: 'به تعویق افتاده',
    filterWork: 'کاری',
    filterFamily: 'خانوادگی',
    filterOther: 'سایر',
    categoryWork: 'کار',
    categoryFamily: 'خانواده',
    categoryOther: 'سایر',
    priorityHigh: 'فوری',
    priorityMedium: 'متوسط',
    priorityLow: 'عادی',
    done: 'انجام شد',
    postpone15: '+۱۵د تعویق',
    edit: 'ویرایش',
    delete: 'حذف',
    upcomingNext: 'بعدی:',
    save: 'ذخیره',
    cancel: 'انصراف',
    language: 'زبان برنامه',
    languagePersian: 'فارسی (Persian)',
    languageEnglish: 'English (انگلیسی)',
    theme: 'پوسته و تم ظاهری',
    fontSize: 'اندازه فونت و متون',
    fontSmall: 'کوچک',
    fontNormal: 'استاندارد',
    fontLarge: 'بزرگ',
    fontXLarge: 'خیلی بزرگ',
    alarmVolume: 'میزان بلندی صدای آلارم (تقویت‌شده)',
    alarmSound: 'نوع صدای زنگ آلارم',
    voiceSpeechRate: 'سرعت خواندن صوتی یادآور',
    systemNotification: 'اعلان بومی سیستم در صفحه اصلی و قفل',
    enableFlash: 'فلاش چشمک‌زن صفحه/فلش هنگام آلارم',
    timelineOrientation: 'چیدمان خط زمانی (Timeline)',
    vertical: 'عمودی',
    horizontal: 'افقی',
    recurrenceTitle: 'نحوه تکرار یادآور',
    recurrenceNone: 'بدون تکرار',
    recurrenceHourly: 'ساعتی',
    recurrenceDaily: 'روزانه',
    recurrenceWeekly: 'هفتگی',
    recurrenceMonthly: 'ماهیانه',
    recurrenceCalendar: 'انتخاب از تقویم',
    timeRotateLabel: 'تنظیم زمان به صورت چرخشی (بزرگ و روان)',
    hourLabel: 'ساعت (00 - 23)',
    minuteLabel: 'دقیقه (00 - 59)',
    typingHint: '💡 ۲ بار کلیک رو گردونه = تایپ مستقیم عدد',
    strobeLed: 'پالس نوری فلاش LED',
    autoMicInput: 'میکروفون خودکار فرم',
    statsTitle: 'آمار و گزارش عملکرد',
    viewStats: 'مشاهده آمار',
    mapsServiceTitle: 'تنظیمات خدمات Google Maps',
    mapsKeyLabel: 'کلید اختصاصی Google Maps (اختیاری):',
    saved: 'ذخیره شد',
    confirm: 'تأیید',
    statsWeekly: 'گزارش هفتگی',
    statsMonthly: 'گزارش ماهانه',
    statsYearly: 'گزارش سالانه',
    statsTotal: 'کل یادآورها',
    statsDone: 'انجام‌شده',
    statsPostponed: 'به تعویق افتاده',
  },
  en: {
    appTitle: 'Yadnik Smart Reminder',
    appSubtitle: 'Professional Task Management with Loud Alarms & Recurrence',
    newReminder: 'Add Reminder',
    captureIdea: 'Capture Idea',
    settings: 'Settings',
    stats: 'Statistics',
    searchPlaceholder: 'Search reminders and ideas...',
    filterAll: 'All',
    filterPending: 'Pending',
    filterCompleted: 'Completed',
    filterPostponed: 'Postponed',
    filterWork: 'Work',
    filterFamily: 'Family',
    filterOther: 'Other',
    categoryWork: 'Work',
    categoryFamily: 'Family',
    categoryOther: 'Other',
    priorityHigh: 'High',
    priorityMedium: 'Medium',
    priorityLow: 'Normal',
    done: 'Done',
    postpone15: '+15m Snooze',
    edit: 'Edit',
    delete: 'Delete',
    upcomingNext: 'Next:',
    save: 'Save',
    cancel: 'Cancel',
    language: 'App Language',
    languagePersian: 'Persian (فارسی)',
    languageEnglish: 'English',
    theme: 'App Theme',
    fontSize: 'Font Size',
    fontSmall: 'Small',
    fontNormal: 'Standard',
    fontLarge: 'Large',
    fontXLarge: 'Extra Large',
    alarmVolume: 'Alarm Volume',
    alarmSound: 'Alarm Ring Sound',
    voiceSpeechRate: 'Text-to-Speech Speed',
    systemNotification: 'System Notifications (Lock screen & Apps)',
    enableFlash: 'Flashlight Strobe during Alarm',
    timelineOrientation: 'Timeline Orientation',
    vertical: 'Vertical',
    horizontal: 'Horizontal',
    recurrenceTitle: 'Reminder Recurrence',
    recurrenceNone: 'No Recurrence',
    recurrenceHourly: 'Hourly',
    recurrenceDaily: 'Daily',
    recurrenceWeekly: 'Weekly',
    recurrenceMonthly: 'Monthly',
    recurrenceCalendar: 'Pick from Calendar',
    timeRotateLabel: 'Time Setting (Large & Smooth)',
    hourLabel: 'Hour (00 - 23)',
    minuteLabel: 'Minute (00 - 59)',
    typingHint: '💡 Double-click wheel to type directly',
    strobeLed: 'Strobe Flashlight LED',
    autoMicInput: 'Auto Voice Input in Form',
    statsTitle: 'Performance Statistics',
    viewStats: 'View Statistics',
    mapsServiceTitle: 'Google Maps Service',
    mapsKeyLabel: 'Custom Google Maps API Key (Optional):',
    saved: 'Saved',
    confirm: 'Confirm',
    statsWeekly: 'Weekly Report',
    statsMonthly: 'Monthly Report',
    statsYearly: 'Yearly Report',
    statsTotal: 'Total Reminders',
    statsDone: 'Completed',
    statsPostponed: 'Postponed',
  },
};

export function getT(lang: AppLanguage = 'fa'): Translations {
  return translations[lang] || translations.fa;
}

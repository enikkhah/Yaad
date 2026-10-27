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
  // Extended UI Keys
  tabReminders: string;
  tabIdeas: string;
  tabLocations: string;
  tabOccasions: string;
  installApp: string;
  addReminderTitle: string;
  addReminderDesc: string;
  addIdeaTitle: string;
  addIdeaDesc: string;
  addLocationTitle: string;
  addLocationDesc: string;
  addOccasionTitle: string;
  addOccasionDesc: string;
  titlePlaceholder: string;
  descriptionPlaceholder: string;
  cameraPhoto: string;
  uploadPhoto: string;
  saveReminder: string;
  saveChanges: string;
  requiredFieldAlert: string;
  autoDismiss: string;
  timelineTitle: string;
  now: string;
  noPastReminders: string;
  noFutureReminders: string;
  nextReminder: string;
  ideaModalTitle: string;
  tabText: string;
  tabVoice: string;
  tabVideo: string;
  tabDrawing: string;
  saveIdea: string;
  locationModalTitle: string;
  locationTitleLabel: string;
  locationDescLabel: string;
  saveLocation: string;
  directions: string;
  refreshGps: string;
  alarmDueTitle: string;
  snooze15Action: string;
  dismissAction: string;
  completeAction: string;
  googleSynced: string;
  geofenceCheckpoints: string;
  activeCheckpoints: string;
  checkpointActive: string;
  checkpointPaused: string;
  addCheckpointReminder: string;
  addCheckpointDesc: string;
  geofenceServiceActive: string;
  geofenceServicePaused: string;
  simulateCheckpointAlert: string;
  checkpointSettings: string;
}

export const translations: Record<AppLanguage, Translations> = {
  fa: {
    appTitle: 'یاد',
    appSubtitle: 'مدیریت حرفه‌ای وظایف با آلارم رسا و تقویم فارسی',
    newReminder: 'ثبت سریع یادآور',
    captureIdea: 'یادداشت ایده',
    settings: 'تنظیمات',
    stats: 'آمار',
    searchPlaceholder: 'جستجو در یادآورها، ایده‌ها و مکان‌ها...',
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
    tabReminders: 'یادآورها',
    tabIdeas: 'ایده‌ها',
    tabLocations: 'مکان‌ها',
    tabOccasions: 'مناسبت‌ها',
    installApp: 'نصب برنامه',
    addReminderTitle: 'ثبت یادآور',
    addReminderDesc: 'با آلارم، صوت و تقویم شمسی',
    addIdeaTitle: 'ثبت ایده',
    addIdeaDesc: 'متن، ویس، ویدیو و نقاشی',
    addLocationTitle: 'ثبت مکان (GPS)',
    addLocationDesc: 'مختصات، عکس دوربین و نقشه',
    addOccasionTitle: 'ثبت مناسبت',
    addOccasionDesc: 'تولد، سالگرد ازدواج و رویدادهای مهم',
    titlePlaceholder: 'عنوان یادآور (مثلاً: تماس با همکار، نوبت دندانپزشکی...)',
    descriptionPlaceholder: 'توضیحات و جزئیات تکمیلی یادآور...',
    cameraPhoto: 'گرفتن عکس با دوربین',
    uploadPhoto: 'آپلود فایل عکس',
    saveReminder: 'ثبت نهایی یادآور',
    saveChanges: 'ذخیره تغییرات',
    requiredFieldAlert: 'تکمیل فیلد اجباری',
    autoDismiss: 'محو خودکار',
    timelineTitle: 'خط زمانی ۱۲ ساعته',
    now: 'اکنون',
    noPastReminders: 'بدون یادآور در ۱۲ ساعت گذشته',
    noFutureReminders: 'بدون یادآور در ۱۲ ساعت آینده',
    nextReminder: 'یادآور بعدی',
    ideaModalTitle: 'ثبت ایده، یادداشت و افکار',
    tabText: 'متن و یادداشت',
    tabVoice: 'ویس صوتی',
    tabVideo: 'ویدیو کوتاه',
    tabDrawing: 'طراحی و نقاشی',
    saveIdea: 'ثبت نهایی ایده',
    locationModalTitle: 'ثبت موقعیت مکانی (GPS)',
    locationTitleLabel: 'عنوان یا نام مکان:',
    locationDescLabel: 'توضیحات و جزئیات تکمیلی (فیلد توضیح):',
    saveLocation: 'ذخیره لوکیشن و اطلاعات',
    directions: 'مسیریابی',
    refreshGps: 'دریافت مجدد GPS',
    alarmDueTitle: 'سررسید یادآوری',
    snooze15Action: '⏱ به تعویق انداختن (۱۵ دقیقه)',
    dismissAction: '✕ بستن',
    completeAction: '✓ خاتمه (تیک انجام)',
    googleSynced: 'همگام با گوگل',
    geofenceCheckpoints: 'حصارهای مکانی (Geofence)',
    activeCheckpoints: 'حصارهای مکانی فعال',
    checkpointActive: 'حصار مکانی فعال',
    checkpointPaused: 'حصار مکانی متوقف',
    addCheckpointReminder: 'ثبت حصار مکانی',
    addCheckpointDesc: 'اعلام متناسب ورود یا خروج با رادار GPS',
    geofenceServiceActive: 'رادار پایش حصار مکانی فعال است',
    geofenceServicePaused: 'رادار حصار مکانی متوقف است',
    simulateCheckpointAlert: 'شبیه‌سازی اعلام حصار مکانی',
    checkpointSettings: 'تنظیمات حصار مکانی و رادار پایش',
  },
  en: {
    appTitle: 'YAAD Smart Reminder',
    appSubtitle: 'Professional Task Management with Loud Alarms & Jalali/Gregorian Calendar',
    newReminder: 'Add Reminder',
    captureIdea: 'Capture Idea',
    settings: 'Settings',
    stats: 'Statistics',
    searchPlaceholder: 'Search reminders, ideas & places...',
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
    languageEnglish: 'English (انگلیسی)',
    theme: 'App Theme',
    fontSize: 'Font Size',
    fontSmall: 'Small',
    fontNormal: 'Standard',
    fontLarge: 'Large',
    fontXLarge: 'Extra Large',
    alarmVolume: 'Alarm Volume (Amplified)',
    alarmSound: 'Alarm Ring Sound',
    voiceSpeechRate: 'Text-to-Speech Speed',
    systemNotification: 'System Notifications (Lock screen & Apps)',
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
    tabReminders: 'Reminders',
    tabIdeas: 'Ideas',
    tabLocations: 'Places',
    tabOccasions: 'Occasions',
    installApp: 'Install App',
    addReminderTitle: 'Add Reminder',
    addReminderDesc: 'With alarm, audio & recurrence',
    addIdeaTitle: 'Capture Idea',
    addIdeaDesc: 'Text, voice memo, video & sketch',
    addLocationTitle: 'Save Place (GPS)',
    addLocationDesc: 'Coordinates, photo & maps',
    addOccasionTitle: 'Add Occasion',
    addOccasionDesc: 'Birthdays, anniversaries & milestones',
    titlePlaceholder: 'Reminder title (e.g., Call colleague, Dentist appointment...)',
    descriptionPlaceholder: 'Additional notes and details...',
    cameraPhoto: 'Take Camera Photo',
    uploadPhoto: 'Upload Photo',
    saveReminder: 'Save Reminder',
    saveChanges: 'Save Changes',
    requiredFieldAlert: 'Required Field Missing',
    autoDismiss: 'Auto-dismiss',
    timelineTitle: '12-Hour Timeline',
    now: 'Now',
    noPastReminders: 'No reminders in the past 12 hours',
    noFutureReminders: 'No reminders in the next 12 hours',
    nextReminder: 'Next Reminder',
    ideaModalTitle: 'Capture Ideas, Notes & Thoughts',
    tabText: 'Text & Note',
    tabVoice: 'Voice Memo',
    tabVideo: 'Short Video',
    tabDrawing: 'Sketch & Draw',
    saveIdea: 'Save Idea',
    locationModalTitle: 'Save GPS Location',
    locationTitleLabel: 'Location Name / Title:',
    locationDescLabel: 'Notes, directions & details:',
    saveLocation: 'Save Location',
    directions: 'Directions',
    refreshGps: 'Refresh GPS',
    alarmDueTitle: 'Reminder Alarm',
    snooze15Action: '⏱ Snooze (15 min)',
    dismissAction: '✕ Dismiss',
    completeAction: '✓ Done (Complete)',
    googleSynced: 'Google Synced',
    geofenceCheckpoints: 'Location Checkpoints (Geofence)',
    activeCheckpoints: 'Active Checkpoints',
    checkpointActive: 'Active Checkpoint',
    checkpointPaused: 'Paused Checkpoint',
    addCheckpointReminder: 'Add Location Checkpoint',
    addCheckpointDesc: 'Arrival & departure alert with GPS',
    geofenceServiceActive: 'Checkpoint radar is active',
    geofenceServicePaused: 'Location radar is paused',
    simulateCheckpointAlert: 'Simulate Checkpoint Alert',
    checkpointSettings: 'Checkpoint & Radar Settings',
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


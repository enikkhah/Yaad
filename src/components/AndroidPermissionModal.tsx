import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { 
  Bell, 
  MapPin, 
  Mic, 
  Camera, 
  Settings, 
  ExternalLink, 
  X, 
  CheckCircle2, 
  Smartphone,
  Clock,
  Maximize2
} from 'lucide-react';
import { AndroidPermissionType, openAndroidSettings } from '../utils/nativePermissions';

interface AndroidPermissionModalProps {
  isOpen: boolean;
  onClose: () => void;
  permissionType: AndroidPermissionType;
  onRetry?: () => void;
  language?: 'fa' | 'en';
}

export const AndroidPermissionModal: React.FC<AndroidPermissionModalProps> = ({
  isOpen,
  onClose,
  permissionType,
  onRetry,
  language = 'fa',
}) => {
  const isEn = language === 'en';

  const getPermissionDetails = () => {
    switch (permissionType) {
      case 'exact_alarm':
        return {
          icon: Clock,
          color: 'text-amber-400 bg-amber-500/15 border-amber-500/40',
          titleFa: 'مجوز زمان‌بندی آلارم دقیق (اندروید ۱۲+)',
          titleEn: 'Exact Alarms & Reminders (Android 12+)',
          descFa: 'برای اینکه زنگ هشدار و یادآورهای «یاد» دقیقاً در ساعت مشخص‌شده و حتی زمانی که برنامه بسته است به صدا درآیند، باید مجوز «آلارم‌ها و یادآورها» فعال باشد.',
          descEn: 'To trigger alarms and reminders accurately at the scheduled time even when the app is closed, please enable "Alarms & reminders" for YAAD.',
          sectionNameFa: 'تنظیمات برنامه ← هشدارها و یادآورها (Alarms & reminders)',
          sectionNameEn: 'App Info → Alarms & reminders',
        };
      case 'full_screen_intent':
        return {
          icon: Maximize2,
          color: 'text-indigo-400 bg-indigo-500/15 border-indigo-500/40',
          titleFa: 'مجوز نمایش تمام‌صفحه اعلان زنگ (اندروید ۱۴+)',
          titleEn: 'Full-Screen Alarm Intent (Android 14+)',
          descFa: 'برای نمایش صفحه کامل زنگ هشدار روی صفحه قفل در اندروید ۱۴ و بالاتر، لطفاً دسترسی «اعلان‌های تمام‌صفحه» را در تنظیمات برای یاد فعال کنید.',
          descEn: 'To show the full-screen alarm screen over the lock screen on Android 14+, please enable "Full screen intents" for YAAD in Settings.',
          sectionNameFa: 'تنظیمات گوشی ← اعلان‌های تمام‌صفحه (Full screen intents)',
          sectionNameEn: 'System Settings → Full screen intents',
        };
      case 'notifications':
        return {
          icon: Bell,
          color: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/30',
          titleFa: 'دسترسی ارسال اعلان و زنگ هشدار',
          titleEn: 'Notification & Alarm Permission',
          descFa: 'برای یادآوری به موقع رویدادها، پخش زنگ بیدارباش و نمایش اعلان‌ها در اندروید، این دسترسی الزامی است.',
          descEn: 'Required to ring alarms, show push reminders, and keep timely alerts running on Android.',
          sectionNameFa: 'بخش اعلان‌های برنامه در اندروید',
          sectionNameEn: 'Android App Notifications Section',
        };
      case 'gps_disabled':
        return {
          icon: MapPin,
          color: 'text-amber-400 bg-amber-500/15 border-amber-500/40',
          titleFa: '⚠️ مکان‌یاب (GPS) گوشی خاموش است',
          titleEn: '⚠️ Device Location (GPS) is Off',
          descFa: 'حصار مکانی فعال شده است، اما مکان‌یاب (GPS / Location) گوشی شما خاموش است.\nبرای اینکه رادار حصار مکانی یاد بتواند مسافت زنده را پایش کند و به محض ورود یا خروج اعلان صادر نماید، لطفاً مکان‌یاب گوشی خود را روشن کنید.',
          descEn: 'Geofencing is active, but your phone Location (GPS) is turned off.\nPlease turn on Location Services so the YAAD Geofence Radar can track live distance and trigger arrival/departure alerts.',
          sectionNameFa: 'تنظیمات مکان‌یاب (Location / GPS) در اندروید',
          sectionNameEn: 'Android Location Services (GPS) Settings',
        };
      case 'background_location':
        return {
          icon: MapPin,
          color: 'text-emerald-400 bg-emerald-500/15 border-emerald-500/40',
          titleFa: 'دسترسی موقعیت مکانی در پس‌زمینه (همیشه مجاز)',
          titleEn: 'Background Location Permission (Allow All the Time)',
          descFa: 'در حال حاضر مجوز مکان‌یاب برنامه روی «فقط هنگام استفاده» است.\nبرای اینکه رادار حصار مکانی بیرون از برنامه و روی صفحه قفل در همان بار اول فعال‌سازی به‌درستی اعلان صادر کند، لطفاً از مسیر زیر گزینه را روی «همیشه مجاز» (Allow all the time) قرار دهید:\n\nتنظیمات برنامه ← مجوزها (Permissions) ← مکان (Location) ← همیشه مجاز (Allow all the time)',
          descEn: 'Location access is currently set to "While using the app".\nFor Geofence Radar to trigger reliably out of the app and on the lock screen right from the first activation, please set Location permission to "Allow all the time":\n\nApp Info → Permissions → Location → Allow all the time',
          sectionNameFa: 'تنظیمات برنامه ← مجوزها ← مکان ← همیشه مجاز',
          sectionNameEn: 'App Info → Permissions → Location → Allow all the time',
        };
      case 'location':
        return {
          icon: MapPin,
          color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
          titleFa: 'دسترسی موقعیت مکانی (همیشه مجاز)',
          titleEn: 'Location Permission (Allow All the Time)',
          descFa: 'برای فعال‌سازی یادآورهای مکان‌محور و عملکرد دقیق رادار حصار مکانی بیرون از برنامه، دسترسی موقعیت مکانی را از مسیر زیر روی «همیشه مجاز» (Allow all the time) تنظیم کنید:\n\nتنظیمات برنامه ← مجوزها (Permissions) ← مکان (Location) ← همیشه مجاز (Allow all the time)',
          descEn: 'For location checkpoints and reliable out-of-app Geofence Radar alerts, please grant Location permission and set it to "Allow all the time":\n\nApp Info → Permissions → Location → Allow all the time',
          sectionNameFa: 'تنظیمات برنامه ← مجوزها ← مکان ← همیشه مجاز',
          sectionNameEn: 'App Info → Permissions → Location → Allow all the time',
        };
      case 'microphone':
        return {
          icon: Mic,
          color: 'text-sky-400 bg-sky-500/10 border-sky-500/30',
          titleFa: 'دسترسی میکروفون (ضبط صدا)',
          titleEn: 'Microphone Permission (Audio Note)',
          descFa: 'برای ضبط یادداشت صوتی و ثبت ایده‌ها با صدای شما، دسترسی به میکروفون دستگاه نیاز است.',
          descEn: 'Required for recording audio voice memos.',
          sectionNameFa: 'بخش مجوزهای برنامه در اندروید',
          sectionNameEn: 'Android App Permissions Section',
        };
      case 'camera':
        return {
          icon: Camera,
          color: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
          titleFa: 'دوربین',
          titleEn: 'Camera',
          descFa: 'برای عکس‌برداری و افزودن تصویر به یادآورها و مکان‌ها، دسترسی به دوربین دستگاه نیاز است.',
          descEn: 'Required for taking photos and attaching images to reminders and locations.',
          sectionNameFa: 'بخش مجوزهای برنامه در اندروید',
          sectionNameEn: 'Android App Permissions Section',
        };
      case 'storage':
      case 'battery':
      default:
        return {
          icon: Smartphone,
          color: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/30',
          titleFa: 'تنظیمات برنامه در اندروید',
          titleEn: 'Android App Settings',
          descFa: 'برای عملکرد دقیق و پایدار هشدارها در پس‌زمینه اندروید، لطفاً دسترسی‌های لازم را فعال کنید.',
          descEn: 'Required for background alarms and optimal execution on Android.',
          sectionNameFa: 'تنظیمات برنامه در اندروید',
          sectionNameEn: 'Android App Settings',
        };
    }
  };

  const details = getPermissionDetails();
  const Icon = details.icon;

  const handleOpenSettings = () => {
    openAndroidSettings(permissionType === 'location' ? 'background_location' : permissionType);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
          style={{ willChange: 'opacity' }}
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.985 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            style={{ willChange: 'transform, opacity' }}
            className="w-full max-w-md bg-stone-900 border border-stone-800 rounded-3xl p-5 sm:p-6 space-y-5 shadow-2xl text-stone-100"
            onClick={(e) => e.stopPropagation()}
            dir={isEn ? 'ltr' : 'rtl'}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className={`w-12 h-12 rounded-2xl border flex items-center justify-center shrink-0 ${details.color}`}>
                  <Icon className="w-6 h-6 stroke-[2.2]" />
                </div>
                <div>
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-indigo-400">
                    <Smartphone className="w-3.5 h-3.5" />
                    <span>{isEn ? 'Android System Request' : 'درخواست سیستمی اندروید'}</span>
                  </div>
                  <h3 className="text-base sm:text-lg font-black text-white">
                    {isEn ? details.titleEn : details.titleFa}
                  </h3>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="p-1.5 text-stone-400 hover:text-white rounded-xl hover:bg-stone-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Explanation */}
            <div className="p-3.5 rounded-2xl bg-stone-950/70 border border-stone-800/80 space-y-2">
              <p className="text-xs sm:text-sm text-stone-300 leading-relaxed whitespace-pre-line">
                {isEn ? details.descEn : details.descFa}
              </p>
              <div className="flex items-center gap-1.5 text-[11px] text-indigo-300 font-medium pt-1">
                <Settings className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span>
                  {isEn ? `Target: ${details.sectionNameEn}` : `مقصد: ${details.sectionNameFa}`}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-2.5 pt-1">
              {/* Direct to Android Settings */}
              <button
                type="button"
                onClick={handleOpenSettings}
                className="min-h-[48px] w-full px-4 py-3 rounded-2xl bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-400 hover:to-indigo-500 text-white font-black text-xs sm:text-sm flex items-center justify-center gap-2.5 shadow-lg shadow-indigo-500/25 active:scale-95 transition-all cursor-pointer"
              >
                <ExternalLink className="w-4 h-4 stroke-[2.5]" />
                <span>{isEn ? 'Open Android Settings' : 'انتقال به بخش مرتبط اندروید'}</span>
              </button>

              {/* Retry Request in App */}
              {onRetry && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onRetry();
                  }}
                  className="min-h-[44px] w-full px-4 py-2.5 rounded-2xl bg-stone-800/90 hover:bg-stone-700 text-stone-200 hover:text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-2 border border-stone-700/80 transition-all cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>{isEn ? 'Try Again / Grant Permission' : 'تلاش مجدد برای صدور مجوز'}</span>
                </button>
              )}

              {/* Cancel */}
              <button
                type="button"
                onClick={onClose}
                className="min-h-[40px] w-full px-4 py-2 text-stone-400 hover:text-stone-200 font-semibold text-xs transition-colors cursor-pointer text-center"
              >
                {isEn ? 'Dismiss' : 'انصراف'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};


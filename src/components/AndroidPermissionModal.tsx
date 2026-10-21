import React from 'react';
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
  FolderOpen
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
  if (!isOpen) return null;
  const isEn = language === 'en';

  const getPermissionDetails = () => {
    switch (permissionType) {
      case 'storage':
      case 'all_files':
        return {
          icon: FolderOpen,
          color: 'text-teal-400 bg-teal-500/10 border-teal-500/30',
          titleFa: 'دسترسی به حافظه',
          titleEn: 'Storage Access',
          descFa: 'برای ایجاد پوشه پشتیبان‌گیری، اجازه دسترسی لازم را از مسیر زیر بدهید:\nتنظیمات گوشی ← برنامه‌ها ← منوی سه نقطه ← دسترسی ویژه ← دسترسی به همه فایل‌ها ← کلید کشویی یاد',
          descEn: 'To create the backup folder, please grant the required permission from the following path:\nSetting → Apps → 3-point menu → Special access → All files access → Yaad slide key',
          sectionNameFa: 'تنظیمات گوشی ← برنامه‌ها ← منوی سه نقطه ← دسترسی ویژه ← دسترسی به همه فایل‌ها ← کلید کشویی یاد',
          sectionNameEn: 'Setting → Apps → 3-point menu → Special access → All files access → Yaad slide key',
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
      case 'location':
        return {
          icon: MapPin,
          color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
          titleFa: 'دسترسی موقعیت مکانی (GPS)',
          titleEn: 'Location Permission (GPS)',
          descFa: 'برای فعال‌سازی یادآورهای مکان‌محور (حضور در مکان، ورود یا خروج از محدوده مقصد)، نیاز به دسترسی به موقعیت مکانی دستگاه دارید.',
          descEn: 'Required for location checkpoints (remind me when arriving at or leaving a place).',
          sectionNameFa: 'بخش موقعیت مکانی در تنظیمات اندروید',
          sectionNameEn: 'Android Location Settings Section',
        };
      case 'microphone':
        return {
          icon: Mic,
          color: 'text-sky-400 bg-sky-500/10 border-sky-500/30',
          titleFa: 'دسترسی میکروفون (تایپ صوتی)',
          titleEn: 'Microphone Permission (Voice Input)',
          descFa: 'برای تبدیل گفتار به متن و ثبت آسان یادآورها با صدای شما، دسترسی به میکروفون دستگاه نیاز است.',
          descEn: 'Required for speech-to-text and hands-free voice reminder creation.',
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
    openAndroidSettings(permissionType);
  };

  return (
    <div 
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div 
        className="w-full max-w-md bg-stone-900 border border-stone-800 rounded-3xl p-5 sm:p-6 space-y-5 shadow-2xl animate-in zoom-in-95 duration-200 text-stone-100"
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
      </div>
    </div>
  );
};

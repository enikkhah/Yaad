import React, { useEffect, useState } from 'react';
import { Reminder, AppSettings, PhoneAlarmSound } from '../types';
import { formatJalaliFull, toPersianDigits } from '../utils/jalali';
import { getRecurrenceLabel } from '../utils/recurrence';
import { startAlarmRinging, stopAlarmRinging } from '../utils/audio';
import { startFlashlightStrobe, stopFlashlightStrobe } from '../utils/torch';
import { getThemeStyles } from '../utils/themeStyles';
import { 
  Bell, 
  CheckCircle2, 
  Clock, 
  Zap, 
  Briefcase, 
  Heart, 
  Tag,
  Repeat,
  X,
  Flashlight
} from 'lucide-react';

interface AlarmModalProps {
  reminder: Reminder | null;
  settings?: AppSettings;
  onUpdateSettings?: (newSettings: Partial<AppSettings>) => void;
  onDismiss: () => void;
  onComplete: (id: string) => void;
  onPostpone: (id: string, minutes: number) => void;
}

export const AlarmModal: React.FC<AlarmModalProps> = ({
  reminder,
  settings,
  onUpdateSettings,
  onDismiss,
  onComplete,
  onPostpone,
}) => {
  const [torchActive, setTorchActive] = useState<boolean>(false);

  const themeStyles = getThemeStyles(settings?.theme);

  useEffect(() => {
    if (!reminder) {
      stopAlarmRinging();
      stopFlashlightStrobe();
      setTorchActive(false);
      return;
    }

    // Play alarm sound (with volume determined by phone/device system controls)
    const sound: PhoneAlarmSound = (reminder.ringTune as PhoneAlarmSound) || settings?.alarmSound || 'digital-beep';
    startAlarmRinging(reminder.category, sound, 1.0);

    // Strobe the physical camera flash LED on the back of the phone (no screen flash per user request)
    if (reminder.useFlash || settings?.enableFlash) {
      setTorchActive(true);
      startFlashlightStrobe().catch(() => {});
    }

    return () => {
      stopAlarmRinging();
      stopFlashlightStrobe();
      setTorchActive(false);
    };
  }, [reminder]);

  if (!reminder) return null;



  const getCategoryIcon = () => {
    switch (reminder.category) {
      case 'work':
        return <Briefcase className="w-4 h-4 text-cyan-400" />;
      case 'family':
        return <Heart className="w-4 h-4 text-rose-400" />;
      default:
        return <Tag className="w-4 h-4 text-amber-400" />;
    }
  };

  const handleComplete = () => {
    stopAlarmRinging();
    stopFlashlightStrobe();
    onComplete(reminder.id);
  };

  const handlePostpone = (minutes: number) => {
    stopAlarmRinging();
    stopFlashlightStrobe();
    onPostpone(reminder.id, minutes);
  };

  const handleDismiss = () => {
    stopAlarmRinging();
    stopFlashlightStrobe();
    onDismiss();
  };

  const toggleManualTorch = async () => {
    if (torchActive) {
      stopFlashlightStrobe();
      setTorchActive(false);
    } else {
      setTorchActive(true);
      await startFlashlightStrobe();
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4">
      {/* Calm, solid dark backdrop without any screen flashing */}
      <div 
        onClick={handleDismiss}
        className="fixed inset-0 bg-black/85 backdrop-blur-md z-[90] transition-opacity"
      />

      {/* Floating Pop-up Banner over the screen with amber neon border */}
      <div 
        id="alarm-popup-banner"
        className="relative z-[100] w-full max-w-4xl bg-stone-900 border-2 border-amber-500/80 rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-2xl shadow-amber-950/90 text-right animate-in fade-in zoom-in-95 duration-200"
        dir="rtl"
      >
        {/* Top bar with pulsing alarm icon, category badge & close button */}
        <div className="flex items-center justify-between gap-3 pb-3 mb-3 border-b border-stone-800">
          <div className="flex items-center gap-2.5 min-w-0">
            {/* Pulsing Alarm Icon */}
            <div className="relative w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-amber-500/20 border border-amber-500/50 flex items-center justify-center flex-shrink-0 shadow-lg shadow-amber-500/20">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-2xl bg-amber-400 opacity-30" />
              <Bell className="w-5 h-5 sm:w-6 sm:h-6 text-amber-400 animate-wiggle" />
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-black text-sm sm:text-base text-amber-400">پاپ‌آپ هشدار یادآور</span>
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-stone-800 border border-stone-700 text-xs text-white">
                {getCategoryIcon()}
                <span>{reminder.category === 'work' ? 'کاری' : reminder.category === 'family' ? 'خانوادگی' : 'سایر'}</span>
              </div>
              {(reminder.useFlash || settings?.enableFlash) && (
                <span className="flex items-center gap-1 text-[11px] text-amber-300 bg-amber-500/15 border border-amber-500/30 px-2.5 py-0.5 rounded-full font-bold">
                  <Flashlight className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                  فلاش چراغ دوربین فعال
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Close Button */}
            <button 
              type="button"
              onClick={handleDismiss}
              className="p-2 rounded-xl text-stone-400 hover:text-white hover:bg-stone-800 transition-colors"
              title="بستن موقت"
            >
              <X className="w-5 h-5 text-white" />
            </button>
          </div>
        </div>

        {/* Reminder Content with horizontal wide arrangement */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 sm:gap-4 items-center mb-4">
          <div className="md:col-span-8 space-y-2">
            <h2 className="text-lg sm:text-2xl font-black text-white leading-tight">
              {reminder.title}
            </h2>
            {reminder.description && (
              <p className="text-xs sm:text-sm text-stone-300 leading-relaxed max-h-24 overflow-y-auto">
                {reminder.description}
              </p>
            )}
            <div className="flex items-center gap-3 text-xs text-stone-400 flex-wrap pt-1">
              <span className="flex items-center gap-1.5 text-stone-300">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                <span className="font-mono text-amber-300 font-bold">
                  {toPersianDigits(formatJalaliFull(reminder.dueTimestamp))}
                </span>
              </span>
              {reminder.recurrence && reminder.recurrence !== 'none' && (
                <span className="flex items-center gap-1 text-teal-300 bg-teal-500/15 border border-teal-500/30 px-2 py-0.5 rounded-md font-bold">
                  <Repeat className="w-3 h-3 text-teal-400" />
                  {getRecurrenceLabel(reminder)}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Action Buttons: High-contrast white text */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2.5 pt-3 border-t border-stone-800">
          {/* Postpone 15m Button */}
          <button
            type="button"
            onClick={() => handlePostpone(15)}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-white font-bold text-xs sm:text-sm border border-stone-700 transition-all cursor-pointer active:scale-95 shadow-sm"
          >
            <Clock className="w-4 h-4 text-white" />
            <span className="text-white">+۱۵ دقیقه تعویق</span>
          </button>

          {/* Postpone 1 Hour Button */}
          <button
            type="button"
            onClick={() => handlePostpone(60)}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-white font-bold text-xs sm:text-sm border border-stone-700 transition-all cursor-pointer active:scale-95 shadow-sm"
          >
            <span className="text-white">+۱ ساعت تعویق</span>
          </button>

          {/* Complete Button (Primary) */}
          <button
            type="button"
            onClick={handleComplete}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-7 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs sm:text-sm shadow-lg shadow-emerald-600/30 transition-all cursor-pointer active:scale-95"
          >
            <CheckCircle2 className="w-4 h-4 text-white stroke-[2.5]" />
            <span className="text-white">انجام شد (تیک خاتمه)</span>
          </button>
        </div>
      </div>
    </div>
  );
};

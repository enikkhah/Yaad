import React, { useEffect, useState } from 'react';
import { Reminder, AppSettings, PhoneAlarmSound } from '../types';
import { formatJalaliFull, formatJalaliTime } from '../utils/jalali';
import { getRecurrenceLabel } from '../utils/recurrence';
import { startAlarmRinging, stopAlarmRinging } from '../utils/audio';
import { startFlashlightStrobe, stopFlashlightStrobe } from '../utils/torch';
import { 
  Bell, 
  CheckCircle2, 
  Clock, 
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
  onDismiss,
  onComplete,
  onPostpone,
}) => {
  const [torchActive, setTorchActive] = useState<boolean>(false);
  const isEn = settings?.language === 'en';

  useEffect(() => {
    if (!reminder) {
      stopAlarmRinging();
      stopFlashlightStrobe();
      setTorchActive(false);
      return;
    }

    // Play alarm sound with volume configured in app settings
    const sound: PhoneAlarmSound = (reminder.ringTune as PhoneAlarmSound) || settings?.alarmSound || 'digital-beep';
    const vol = settings?.alarmVolume !== undefined ? settings.alarmVolume : 0.85;
    startAlarmRinging(reminder.category, sound, vol);

    // Strobe the physical camera flash LED on the back of the phone if enabled
    if (reminder.useFlash || settings?.enableFlash) {
      setTorchActive(true);
      startFlashlightStrobe().catch(() => {});
    }

    return () => {
      stopAlarmRinging();
      stopFlashlightStrobe();
      setTorchActive(false);
    };
  }, [reminder, settings?.alarmSound, settings?.alarmVolume, settings?.enableFlash]);

  if (!reminder) return null;

  const getCategoryIcon = () => {
    switch (reminder.category) {
      case 'work':
        return <Briefcase className="w-3.5 h-3.5 text-cyan-400" />;
      case 'family':
        return <Heart className="w-3.5 h-3.5 text-rose-400" />;
      default:
        return <Tag className="w-3.5 h-3.5 text-amber-400" />;
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

  const timeFormatted = formatJalaliTime(reminder.dueTimestamp, isEn ? 'en' : 'fa');
  const dateFormatted = formatJalaliFull(reminder.dueTimestamp, isEn ? 'en' : 'fa');

  return (
    <div 
      className="fixed inset-0 z-[100] bg-stone-950 text-white flex flex-col justify-between p-5 sm:p-10 select-none animate-in fade-in duration-200"
      dir={isEn ? 'ltr' : 'rtl'}
    >
      {/* 1. MINIMAL TOP BAR */}
      <div className="flex items-center justify-between gap-3 w-full max-w-4xl mx-auto">
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          {/* Subtle pulsating alarm icon */}
          <div className="relative w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center flex-shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-xl bg-amber-400 opacity-20" />
            <Bell className="w-4 h-4 text-amber-400" />
          </div>

          <span className="text-xs sm:text-sm font-bold text-stone-300">
            {isEn ? 'YAAD Reminder' : 'یادآور یاد'}
          </span>

          {/* Minimal Category Pill */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-stone-900 border border-stone-800 text-xs text-stone-300">
            {getCategoryIcon()}
            <span>
              {reminder.category === 'work' 
                ? (isEn ? 'Work' : 'کاری') 
                : reminder.category === 'family' 
                ? (isEn ? 'Family' : 'خانوادگی') 
                : (isEn ? 'Other' : 'سایر')}
            </span>
          </div>

          {/* Flashlight status button */}
          {(reminder.useFlash || settings?.enableFlash) && (
            <button
              type="button"
              onClick={toggleManualTorch}
              className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border transition-all cursor-pointer ${
                torchActive 
                  ? 'bg-amber-500/15 border-amber-500/30 text-amber-300' 
                  : 'bg-stone-900 border-stone-800 text-stone-400'
              }`}
            >
              <Flashlight className={`w-3.5 h-3.5 ${torchActive ? 'text-amber-400 animate-pulse' : 'text-stone-400'}`} />
              <span>{torchActive ? (isEn ? 'Flash on' : 'فلاش روشن') : (isEn ? 'Flash' : 'فلاش')}</span>
            </button>
          )}
        </div>

        {/* Minimal Close button */}
        <button 
          type="button"
          onClick={handleDismiss}
          className="p-2 rounded-xl text-stone-400 hover:text-white hover:bg-stone-900 transition-colors cursor-pointer"
          title={isEn ? 'Close' : 'بستن'}
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* 2. MINIMAL CENTER HERO CONTENT */}
      <div className="flex-1 flex flex-col justify-center items-center text-center my-6 sm:my-8 px-2 max-w-3xl mx-auto w-full">
        {/* Large Minimal Time Display */}
        <div className="mb-2">
          <div className="text-5xl sm:text-7xl font-mono font-black text-amber-400 tracking-tight">
            {timeFormatted}
          </div>
          <div className="text-xs sm:text-sm text-stone-400 mt-1 font-medium">
            {dateFormatted}
          </div>
        </div>

        {/* Recurrence Pill (if recurring) */}
        {reminder.recurrence && reminder.recurrence !== 'none' && (
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-teal-500/10 border border-teal-500/20 text-teal-300 text-xs font-bold my-3">
            <Repeat className="w-3.5 h-3.5 text-teal-400" />
            <span>{getRecurrenceLabel(reminder, isEn ? 'en' : 'fa')}</span>
          </div>
        )}

        {/* Reminder Title in Large Minimal Typography */}
        <h1 className="text-2xl sm:text-4xl font-black text-stone-100 mt-4 mb-3 leading-snug max-w-2xl px-2">
          {reminder.title}
        </h1>

        {/* Description in Clean Subtle Text */}
        {reminder.description && (
          <p className="text-sm sm:text-base text-stone-300/90 leading-relaxed max-w-xl max-h-48 overflow-y-auto px-4 py-2 rounded-xl bg-stone-900/40 border border-stone-800/60">
            {reminder.description}
          </p>
        )}
      </div>

      {/* 3. MINIMAL ACTION BUTTONS AT BOTTOM */}
      <div className="w-full max-w-2xl mx-auto space-y-3">
        {/* Primary Complete Button */}
        <button
          type="button"
          onClick={handleComplete}
          className="w-full py-4 px-6 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-base sm:text-lg shadow-lg shadow-emerald-950/60 transition-all cursor-pointer active:scale-98 flex items-center justify-center gap-2.5"
        >
          <CheckCircle2 className="w-5 h-5 stroke-[2.5]" />
          <span>{isEn ? 'Done' : 'انجام شد'}</span>
        </button>

        {/* Secondary Snooze & Dismiss Row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          <button
            type="button"
            onClick={() => handlePostpone(15)}
            className="py-3 px-3 rounded-xl bg-stone-900 hover:bg-stone-800 text-stone-200 hover:text-white font-bold text-xs sm:text-sm border border-stone-800 transition-all cursor-pointer active:scale-95 flex items-center justify-center gap-1.5"
          >
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <span>{isEn ? '+15m Snooze' : '+۱۵ دقیقه تعویق'}</span>
          </button>

          <button
            type="button"
            onClick={() => handlePostpone(60)}
            className="py-3 px-3 rounded-xl bg-stone-900 hover:bg-stone-800 text-stone-200 hover:text-white font-bold text-xs sm:text-sm border border-stone-800 transition-all cursor-pointer active:scale-95 flex items-center justify-center gap-1.5"
          >
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <span>{isEn ? '+1h Snooze' : '+۱ ساعت تعویق'}</span>
          </button>

          <button
            type="button"
            onClick={handleDismiss}
            className="col-span-2 sm:col-span-1 py-3 px-3 rounded-xl bg-stone-900/70 hover:bg-stone-800 text-stone-400 hover:text-stone-200 font-bold text-xs sm:text-sm border border-stone-800/80 transition-all cursor-pointer active:scale-95 flex items-center justify-center gap-1.5"
          >
            <X className="w-3.5 h-3.5" />
            <span>{isEn ? 'Dismiss' : 'بستن'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

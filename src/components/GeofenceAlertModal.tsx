import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, Edit2, MapPin, Navigation } from 'lucide-react';
import appIcon from '../assets/images/icon.png';
import {
  calculateHaversineDistance,
  saveLastKnownPosition,
} from '../utils/geofenceManager';
import {
  stopAlarmRinging,
  stopSubmarineSonarLoop,
  updateSubmarineSonarDistance,
} from '../utils/audio';
import { toPersianDigits } from '../utils/jalali';

export interface GeofenceAlertData {
  id: string;
  targetType: 'location' | 'reminder';
  targetId: string;
  locationTitle: string;
  description?: string;
  triggerType: 'enter' | 'exit' | 'arrived_under_10m';
  initialDistance: number;
  radius: number;
  latitude: number;
  longitude: number;
}

interface GeofenceAlertModalProps {
  alert: GeofenceAlertData | null;
  userPosition?: { latitude: number; longitude: number } | null;
  language?: 'fa' | 'en';
  onGotIt: () => void;
  onEditRadius: (alert: GeofenceAlertData) => void;
}

export const GeofenceAlertModal: React.FC<GeofenceAlertModalProps> = ({
  alert,
  userPosition,
  language = 'fa',
  onGotIt,
  onEditRadius,
}) => {
  const isEn = language === 'en';
  const [liveDistance, setLiveDistance] = useState<number>(alert?.initialDistance ?? 0);

  // Sync initial distance when alert opens
  useEffect(() => {
    if (!alert) return;
    setLiveDistance(alert.initialDistance);
  }, [alert?.id, alert?.initialDistance]);

  // Update live distance whenever parent userPosition updates
  useEffect(() => {
    if (!alert || !userPosition) return;
    const d = calculateHaversineDistance(
      userPosition.latitude,
      userPosition.longitude,
      alert.latitude,
      alert.longitude
    );
    setLiveDistance(d);
    if (d > 10) {
      updateSubmarineSonarDistance(d, alert.radius || 200);
    }
  }, [
    alert?.id,
    alert?.latitude,
    alert?.longitude,
    alert?.radius,
    userPosition?.latitude,
    userPosition?.longitude,
  ]);

  // Dedicated high-frequency GPS watcher while GeofenceAlertModal is open for smooth live distance updates
  useEffect(() => {
    if (!alert) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;

    let watchId: number | null = null;
    try {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          saveLastKnownPosition({
            latitude: lat,
            longitude: lng,
            accuracy: pos.coords.accuracy || 10,
            timestamp: pos.timestamp || Date.now(),
          });
          const d = calculateHaversineDistance(lat, lng, alert.latitude, alert.longitude);
          setLiveDistance(d);
          if (d > 10) {
            updateSubmarineSonarDistance(d, alert.radius || 200);
          }
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
      );
    } catch {
      // ignore
    }

    return () => {
      if (watchId !== null) {
        try {
          navigator.geolocation.clearWatch(watchId);
        } catch {
          // ignore
        }
      }
    };
  }, [alert?.id, alert?.latitude, alert?.longitude, alert?.radius]);

  const stopAllGeofenceSounds = () => {
    stopSubmarineSonarLoop();
    stopAlarmRinging();
    try {
      const bridge = (window as any).YaadGeofenceBridge;
      if (bridge && typeof bridge.stopGeofenceAlertAudio === 'function') {
        bridge.stopGeofenceAlertAudio();
      }
    } catch {
      // ignore
    }
  };

  const handleGotIt = () => {
    stopAllGeofenceSounds();
    onGotIt();
  };

  const handleEdit = () => {
    if (!alert) return;
    stopAllGeofenceSounds();
    onEditRadius(alert);
  };

  const formatDistanceText = (meters: number): { value: string; unit: string } => {
    if (meters >= 1000) {
      const km = Number((meters / 1000).toFixed(2));
      return {
        value: isEn ? String(km) : toPersianDigits(km),
        unit: isEn ? 'km' : 'کیلومتر',
      };
    }
    const m = Math.max(0, Math.round(meters));
    return {
      value: isEn ? String(m) : toPersianDigits(m),
      unit: isEn ? 'm' : 'متر',
    };
  };

  const formatRadiusText = (meters: number): string => {
    if (meters >= 1000) {
      const km = Number((meters / 1000).toFixed(2));
      return isEn ? `${km} km` : `${toPersianDigits(km)} کیلومتر`;
    }
    return isEn ? `${meters} m` : `${toPersianDigits(meters)} متر`;
  };

  const isSub10m = alert?.triggerType === 'arrived_under_10m' || liveDistance <= 10;
  const distFormatted = formatDistanceText(liveDistance);

  const triggerBadgeLabel = !alert
    ? ''
    : isSub10m
    ? isEn
      ? '🎯 Target Reached (Within 10m)'
      : '🎯 حضور در نقطه مقصد (زیر ۱۰ متر)'
    : alert.triggerType === 'exit'
    ? isEn
      ? '📡 Geofence Exit Alert'
      : '📡 اعلان خروج از محدوده حصار مکانی'
    : isEn
    ? '📡 Geofence Arrival Radar'
    : '📡 رادار ورود به محدوده حصار مکانی';

  return (
    <AnimatePresence>
      {alert && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          className="fixed inset-0 z-[110] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 select-none"
          dir={isEn ? 'ltr' : 'rtl'}
        >
          <motion.div
            initial={{ scale: 0.92, y: 24, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.92, y: 24, opacity: 0 }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-3xl border-2 border-emerald-400/90 bg-gradient-to-b from-[#042621] via-[#031D19] to-[#021512] shadow-[0_0_50px_rgba(16,185,129,0.35)] overflow-hidden p-5 sm:p-6 flex flex-col items-center text-center space-y-5"
          >
            {/* 1. TOP: Location Title Clearly & Prominently Displayed */}
            <div className="w-full space-y-2">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/50 text-emerald-300 text-xs font-black">
                <span>{triggerBadgeLabel}</span>
              </div>

              <div className="w-full px-4 py-3 rounded-2xl bg-[#073B33]/90 border-2 border-emerald-400/60 shadow-inner">
                <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight leading-snug break-words">
                  {alert.locationTitle}
                </h2>
                {alert.description && (
                  <p className="text-xs sm:text-sm font-medium text-emerald-100/90 mt-1.5 leading-relaxed line-clamp-2">
                    {alert.description}
                  </p>
                )}
              </div>
            </div>

            {/* 2. CENTER: Large Pulsing App Logo + Submarine Sonar Rings + Pulsing GPS Pin */}
            <div className="relative my-2 flex items-center justify-center py-3">
              {/* Outer Expanding Submarine Sonar Rings */}
              <span
                className="animate-ping absolute inline-flex w-28 h-28 sm:w-32 sm:h-32 rounded-full bg-emerald-400/25 border border-emerald-300/60"
                style={{ animationDuration: '1.8s' }}
              />
              <span
                className="animate-ping absolute inline-flex w-24 h-24 sm:w-28 sm:h-28 rounded-3xl bg-cyan-400/20 border border-cyan-300/50"
                style={{ animationDuration: '1.35s' }}
              />

              {/* Main App Logo Container */}
              <motion.div
                animate={{
                  scale: [1, 1.06, 1],
                }}
                transition={{
                  duration: 1.5,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
                className="relative z-10 w-24 h-24 sm:w-28 sm:h-28 rounded-3xl border-2 border-emerald-400 bg-[#063830] flex items-center justify-center shadow-[0_0_30px_rgba(16,185,129,0.55)]"
              >
                <img
                  src={appIcon}
                  alt="YAAD"
                  className="w-20 h-20 sm:w-24 sm:h-24 object-contain rounded-2xl"
                  draggable={false}
                />

                {/* Pulsing GPS Symbol Badge on Logo */}
                <motion.div
                  animate={{
                    scale: [1, 1.35, 0.94, 1.25, 1],
                    y: [0, -3, 0, -2, 0],
                  }}
                  transition={{
                    duration: 1.2,
                    repeat: Infinity,
                    ease: 'easeInOut',
                  }}
                  className="absolute -top-2.5 -right-2.5 z-20 w-9 h-9 rounded-full bg-emerald-400 border-2 border-[#031D19] flex items-center justify-center shadow-[0_0_16px_rgba(16,185,129,1)]"
                >
                  <MapPin className="w-5 h-5 text-stone-950 fill-stone-950" />
                </motion.div>
              </motion.div>
            </div>

            {/* 3. BELOW LOGO: Dedicated Large Live Distance Box */}
            <div className="w-full rounded-2xl border-2 border-cyan-400/75 bg-[#052E28]/95 px-4 py-3.5 shadow-[0_0_24px_rgba(6,182,212,0.2)] space-y-1.5">
              <div className="flex items-center justify-center gap-1.5 text-xs font-extrabold text-cyan-300">
                <Navigation className="w-3.5 h-3.5 animate-pulse text-emerald-400" />
                <span>
                  {isEn ? 'LIVE DISTANCE TO LOCATION' : 'مسافت زنده تا مکان مورد نظر'}
                </span>
              </div>

              <div className="flex items-baseline justify-center gap-2 py-0.5">
                <span className="text-3xl sm:text-4xl font-black font-mono tracking-tight text-emerald-300 drop-shadow-[0_0_10px_rgba(52,211,153,0.5)]">
                  {distFormatted.value}
                </span>
                <span className="text-base sm:text-lg font-black text-emerald-100">
                  {distFormatted.unit}
                </span>
              </div>

              <div className="flex items-center justify-center gap-2 text-[11px] font-bold text-teal-200/85 pt-0.5">
                <span>
                  {isEn
                    ? `Geofence Radius: ${formatRadiusText(alert.radius || 200)}`
                    : `شعاع حصار مکانی: ${formatRadiusText(alert.radius || 200)}`}
                </span>
                {isSub10m && (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/25 border border-emerald-400/50 text-emerald-200 font-black">
                    {isEn ? 'At Destination (<10m)' : 'در نقطه مقصد (<۱۰ متر)'}
                  </span>
                )}
              </div>
            </div>

            {/* 4. BOTTOM: Only Two Buttons ("متوجه شدم" and "ویرایش") */}
            <div className="w-full grid grid-cols-2 gap-3 pt-1">
              {/* Got It Button */}
              <button
                type="button"
                onClick={handleGotIt}
                className="min-h-[48px] py-3 px-4 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-stone-950 font-black text-sm sm:text-base transition-all cursor-pointer active:scale-95 flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/30"
              >
                <CheckCircle2 className="w-5 h-5 stroke-[2.5] shrink-0" />
                <span>{isEn ? 'Got It' : 'متوجه شدم'}</span>
              </button>

              {/* Edit Radius Button */}
              <button
                type="button"
                onClick={handleEdit}
                className="min-h-[48px] py-3 px-4 rounded-2xl bg-[#073B33] hover:bg-[#0B4F45] text-cyan-200 border-2 border-cyan-400/70 font-black text-sm sm:text-base transition-all cursor-pointer active:scale-95 flex items-center justify-center gap-2 shadow-md"
              >
                <Edit2 className="w-4 h-4 shrink-0 text-cyan-300" />
                <span>{isEn ? 'Edit' : 'ویرایش'}</span>
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

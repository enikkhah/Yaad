import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, Edit2, MapPin, Navigation } from 'lucide-react';
import appIcon from '../assets/images/icon.png';
import {
  acknowledgeGeofenceAlert,
  calculateHaversineDistance,
  openGoogleMapsDirections,
  saveLastKnownPosition,
  shouldAcceptLocationUpdate,
} from '../utils/geofenceManager';
import {
  computeSubmarineSonarIntervalMs,
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
  const [pingBeat, setPingBeat] = useState<number>(0);

  // Sync initial distance when alert opens or is edited
  useEffect(() => {
    if (!alert) return;
    setLiveDistance(alert.initialDistance);
    updateSubmarineSonarDistance(alert.initialDistance, alert.radius || 200);
  }, [alert?.id, alert?.initialDistance, alert?.radius, alert?.latitude, alert?.longitude]);

  // Listen to submarine sonar ping events to keep the pulse animation in exact lockstep with each sonar ping
  useEffect(() => {
    if (!alert || typeof window === 'undefined') return;
    const handleSonarPing = () => {
      setPingBeat((prev) => prev + 1);
    };
    window.addEventListener('yaad:sonar-ping', handleSonarPing);
    return () => {
      window.removeEventListener('yaad:sonar-ping', handleSonarPing);
    };
  }, [alert?.id]);

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
    updateSubmarineSonarDistance(d, alert.radius || 200);
  }, [
    alert?.id,
    alert?.latitude,
    alert?.longitude,
    alert?.radius,
    userPosition?.latitude,
    userPosition?.longitude,
  ]);

  // Stabilized high-accuracy GPS watcher while GeofenceAlertModal is open
  useEffect(() => {
    if (!alert) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;

    let watchId: number | null = null;
    try {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const candidatePos = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy || 10,
            timestamp: pos.timestamp || Date.now(),
          };
          if (!shouldAcceptLocationUpdate(candidatePos)) {
            return;
          }
          saveLastKnownPosition(candidatePos);
          const d = calculateHaversineDistance(
            candidatePos.latitude,
            candidatePos.longitude,
            alert.latitude,
            alert.longitude
          );
          setLiveDistance(d);
          updateSubmarineSonarDistance(d, alert.radius || 200);
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
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

  const stopAllGeofenceSounds = (targetId?: string) => {
    stopSubmarineSonarLoop();
    stopAlarmRinging();
    acknowledgeGeofenceAlert(targetId || alert?.targetId);
  };

  const handleStopOperation = () => {
    stopAllGeofenceSounds(alert?.targetId);
    onGotIt();
  };

  const handleEdit = () => {
    if (!alert) return;
    stopAllGeofenceSounds(alert.targetId);
    onEditRadius(alert);
  };

  const handleDirections = () => {
    if (!alert) return;
    stopAllGeofenceSounds(alert.targetId);
    openGoogleMapsDirections(alert.latitude, alert.longitude, alert.locationTitle);
    onGotIt();
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

  const effectiveRadius = Math.max(1, alert?.radius || 200);
  const sonarIntervalMs = computeSubmarineSonarIntervalMs(liveDistance, effectiveRadius);
  const is4HzMode = sonarIntervalMs <= 250;
  const isSub10m = alert?.triggerType === 'arrived_under_10m' || liveDistance <= 10 || is4HzMode;
  const distFormatted = formatDistanceText(liveDistance);

  // Pulse animation timing:
  // - In <=10% remaining distance (4 Hz mode): 0.25s (250ms) continuous 4 Hz pulse
  // - Above 10%: synchronized pulse beat on each sonar ping with repeatDelay matching the exact sonar interval
  const activeBeatDurationSec = is4HzMode
    ? 0.25
    : Math.min(0.75, Math.max(0.25, (sonarIntervalMs / 1000) * 0.65));
  const activeRepeatDelaySec = is4HzMode
    ? 0
    : Math.max(0.05, sonarIntervalMs / 1000 - activeBeatDurationSec);

  const triggerBadgeLabel = !alert
    ? ''
    : isSub10m
    ? isEn
      ? '🎯 Target Reached (4 Hz Sonar)'
      : '🎯 در محدوده ۱۰٪ پایانی مقصد (سونار ۴ هرتز)'
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
              {/* Outer Expanding Submarine Sonar Rings synchronized with distance frequency */}
              <motion.span
                key={`outer-ring-${is4HzMode ? '4hz' : pingBeat}`}
                initial={{ scale: 0.85, opacity: 0.8 }}
                animate={{ scale: 1.55, opacity: 0 }}
                transition={{
                  duration: activeBeatDurationSec,
                  repeat: Infinity,
                  repeatDelay: activeRepeatDelaySec,
                  ease: 'easeOut',
                }}
                className="absolute inline-flex w-28 h-28 sm:w-32 sm:h-32 rounded-full bg-emerald-400/25 border border-emerald-300/60"
              />
              <motion.span
                key={`inner-ring-${is4HzMode ? '4hz' : pingBeat}`}
                initial={{ scale: 0.9, opacity: 0.85 }}
                animate={{ scale: 1.38, opacity: 0 }}
                transition={{
                  duration: activeBeatDurationSec * 0.85,
                  repeat: Infinity,
                  repeatDelay: activeRepeatDelaySec,
                  ease: 'easeOut',
                }}
                className="absolute inline-flex w-24 h-24 sm:w-28 sm:h-28 rounded-3xl bg-cyan-400/20 border border-cyan-300/50"
              />

              {/* Main App Logo Container */}
              <motion.div
                key={`logo-pulse-${is4HzMode ? '4hz' : pingBeat}`}
                animate={{
                  scale: [1, 1.09, 1],
                }}
                transition={{
                  duration: activeBeatDurationSec,
                  repeat: Infinity,
                  repeatDelay: activeRepeatDelaySec,
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
                  key={`pin-pulse-${is4HzMode ? '4hz' : pingBeat}`}
                  animate={{
                    scale: [1, 1.35, 0.94, 1.25, 1],
                    y: [0, -3, 0, -2, 0],
                  }}
                  transition={{
                    duration: activeBeatDurationSec,
                    repeat: Infinity,
                    repeatDelay: activeRepeatDelaySec,
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

            {/* 4. BOTTOM: Action Buttons ("توقف عملیات", "مسیریابی" in Google Maps, and "ویرایش") */}
            <div className="w-full grid grid-cols-3 gap-2.5 pt-1">
              {/* Stop Operation Button */}
              <button
                type="button"
                onClick={handleStopOperation}
                className="min-h-[48px] py-2.5 px-2.5 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-stone-950 font-black text-xs sm:text-sm transition-all cursor-pointer active:scale-95 flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-500/30"
              >
                <CheckCircle2 className="w-4 h-4 stroke-[2.5] shrink-0" />
                <span className="truncate">{isEn ? 'Stop Operation' : 'توقف عملیات'}</span>
              </button>

              {/* Google Maps Directions Button */}
              <button
                type="button"
                onClick={handleDirections}
                className="min-h-[48px] py-2.5 px-2.5 rounded-2xl bg-sky-500/25 hover:bg-sky-500/35 text-sky-200 border-2 border-sky-400/80 font-black text-xs sm:text-sm transition-all cursor-pointer active:scale-95 flex items-center justify-center gap-1.5 shadow-md"
              >
                <Navigation className="w-4 h-4 shrink-0 text-sky-300" />
                <span className="truncate">{isEn ? 'Directions' : 'مسیریابی'}</span>
              </button>

              {/* Edit Radius Button */}
              <button
                type="button"
                onClick={handleEdit}
                className="min-h-[48px] py-2.5 px-2.5 rounded-2xl bg-[#073B33] hover:bg-[#0B4F45] text-cyan-200 border-2 border-cyan-400/70 font-black text-xs sm:text-sm transition-all cursor-pointer active:scale-95 flex items-center justify-center gap-1.5 shadow-md"
              >
                <Edit2 className="w-4 h-4 shrink-0 text-cyan-300" />
                <span className="truncate">{isEn ? 'Edit' : 'ویرایش'}</span>
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

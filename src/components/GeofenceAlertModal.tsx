import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, Edit2, MapPin, Navigation, Volume2, VolumeX } from 'lucide-react';
import appIcon from '../assets/images/icon.png';
import {
  acknowledgeGeofenceAlert,
  calculateHaversineDistance,
  EvaluatedGeofenceAlertItem,
  GeofenceScenarioPhase,
  openGoogleMapsDirections,
  pauseGeofenceAlertTemporarily,
  saveLastKnownPosition,
  shouldAcceptLocationUpdate,
  toggleGeofenceAlertMute,
} from '../utils/geofenceManager';
import {
  computeSubmarineSonarIntervalMs,
  SonarScenarioMode,
  stopAlarmRinging,
  stopSubmarineSonarLoop,
  updateSubmarineSonarDistance,
} from '../utils/audio';
import { toPersianDigits } from '../utils/jalali';

export interface GeofenceAlertData extends Partial<EvaluatedGeofenceAlertItem> {
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
  alert?: GeofenceAlertData | null;
  alerts?: GeofenceAlertData[];
  userPosition?: { latitude: number; longitude: number } | null;
  language?: 'fa' | 'en';
  onGotIt: (targetId?: string, locationTitle?: string) => void;
  onEditRadius: (alert: GeofenceAlertData) => void;
  onStartDirections?: (alert: GeofenceAlertData) => void;
}

export const GeofenceAlertModal: React.FC<GeofenceAlertModalProps> = ({
  alert,
  alerts,
  userPosition,
  language = 'fa',
  onGotIt,
  onEditRadius,
  onStartDirections,
}) => {
  const isEn = language === 'en';
  const [liveUserPos, setLiveUserPos] = useState<{ latitude: number; longitude: number } | null>(
    userPosition || null
  );
  const [pingBeat, setPingBeat] = useState<number>(0);
  const [mutedMap, setMutedMap] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (userPosition) {
      setLiveUserPos(userPosition);
    }
  }, [userPosition?.latitude, userPosition?.longitude]);

  // Normalize single or multiple alerts into a priority-sorted list (shortest targetDistance at index 0)
  const sortedAlerts = useMemo<GeofenceAlertData[]>(() => {
    const rawList: GeofenceAlertData[] =
      alerts && alerts.length > 0 ? alerts : alert ? [alert] : [];
    if (rawList.length === 0) return [];

    const enriched = rawList.map((item) => {
      const liveDist = liveUserPos
        ? calculateHaversineDistance(
            liveUserPos.latitude,
            liveUserPos.longitude,
            item.latitude,
            item.longitude
          )
        : item.initialDistance;
      const safeRad = Math.max(20, item.radius || 200);
      const triggerOn = item.triggerOn || (item.triggerType === 'exit' ? 'exit' : 'enter');
      const computedTargetDist =
        item.targetDistance !== undefined
          ? item.targetDistance
          : triggerOn === 'enter'
          ? liveDist
          : Math.abs(safeRad - liveDist);

      const sonarMode: SonarScenarioMode =
        item.sonarMode || (triggerOn === 'exit' ? 'exit' : 'enter');
      const sonarIntervalMs =
        item.sonarIntervalMs || computeSubmarineSonarIntervalMs(liveDist, safeRad, sonarMode);

      const cleanTargetId = item.targetId.replace(/^(loc_|rem_)/, '');
      const isMuted =
        mutedMap[cleanTargetId] !== undefined
          ? mutedMap[cleanTargetId]
          : Boolean(item.isAudioMuted);

      return {
        ...item,
        initialDistance: liveDist,
        targetDistance: computedTargetDist,
        sonarMode,
        sonarIntervalMs,
        isAudioMuted: isMuted,
        playAudio: item.playAudio !== false && !isMuted && !item.isVisualOnly,
      };
    });

    enriched.sort((a, b) => {
      const tdA = a.targetDistance ?? a.initialDistance;
      const tdB = b.targetDistance ?? b.initialDistance;
      if (tdA !== tdB) return tdA - tdB;
      return a.initialDistance - b.initialDistance;
    });

    return enriched;
  }, [alerts, alert, liveUserPos, mutedMap]);

  const topPriorityAlert = sortedAlerts[0] || null;
  const isMultiMode = sortedAlerts.length > 1;

  // Drive submarine sonar audio strictly from the #1 priority alert (when not muted and not in visual-only phase)
  useEffect(() => {
    if (!topPriorityAlert) {
      stopSubmarineSonarLoop();
      return;
    }

    if (
      topPriorityAlert.isVisualOnly ||
      topPriorityAlert.playAudio === false ||
      topPriorityAlert.isAudioMuted
    ) {
      stopSubmarineSonarLoop();
      return;
    }

    const mode: SonarScenarioMode = topPriorityAlert.sonarMode || 'enter';
    updateSubmarineSonarDistance(
      topPriorityAlert.initialDistance,
      topPriorityAlert.radius || 200,
      mode
    );
  }, [
    topPriorityAlert?.id,
    topPriorityAlert?.targetId,
    topPriorityAlert?.initialDistance,
    topPriorityAlert?.radius,
    topPriorityAlert?.isVisualOnly,
    topPriorityAlert?.playAudio,
    topPriorityAlert?.isAudioMuted,
    topPriorityAlert?.sonarMode,
  ]);

  // Listen to submarine sonar ping events to keep the pulse animation in exact lockstep with each sonar ping
  useEffect(() => {
    if (sortedAlerts.length === 0 || typeof window === 'undefined') return;
    const handleSonarPing = () => {
      setPingBeat((prev) => prev + 1);
    };
    window.addEventListener('yaad:sonar-ping', handleSonarPing);
    return () => {
      window.removeEventListener('yaad:sonar-ping', handleSonarPing);
    };
  }, [sortedAlerts.length]);

  // Stabilized high-accuracy GPS watcher while GeofenceAlertModal is open
  useEffect(() => {
    if (sortedAlerts.length === 0) return;
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
          setLiveUserPos({
            latitude: candidatePos.latitude,
            longitude: candidatePos.longitude,
          });
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
  }, [sortedAlerts.length]);

  const handleStopItemOperation = (item: GeofenceAlertData) => {
    if (sortedAlerts.length <= 1) {
      stopSubmarineSonarLoop();
      stopAlarmRinging();
    }
    acknowledgeGeofenceAlert(item.targetId);
    onGotIt(item.targetId, item.locationTitle);
  };

  const handleEditItem = (item: GeofenceAlertData) => {
    stopSubmarineSonarLoop();
    stopAlarmRinging();
    pauseGeofenceAlertTemporarily(item.targetId, 'edit');
    onEditRadius(item);
  };

  const handleDirectionsItem = (item: GeofenceAlertData) => {
    if (sortedAlerts.length <= 1) {
      stopSubmarineSonarLoop();
      stopAlarmRinging();
    }
    pauseGeofenceAlertTemporarily(item.targetId, 'directions');
    if (onStartDirections) {
      onStartDirections(item);
    }
    openGoogleMapsDirections(item.latitude, item.longitude, item.locationTitle);
  };

  const handleToggleMuteItem = (item: GeofenceAlertData) => {
    const cleanId = item.targetId.replace(/^(loc_|rem_)/, '');
    const currentMuted =
      mutedMap[cleanId] !== undefined ? mutedMap[cleanId] : Boolean(item.isAudioMuted);
    const nextMuted = !currentMuted;
    toggleGeofenceAlertMute(item.targetId, nextMuted);
    setMutedMap((prev) => ({ ...prev, [cleanId]: nextMuted }));
    if (nextMuted) {
      stopSubmarineSonarLoop();
    } else if (
      topPriorityAlert &&
      topPriorityAlert.targetId === item.targetId &&
      !item.isVisualOnly
    ) {
      updateSubmarineSonarDistance(
        item.initialDistance,
        item.radius || 200,
        item.sonarMode || 'enter'
      );
    }
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

  const getScenarioBadgeLabel = (item: GeofenceAlertData): string => {
    const phase: GeofenceScenarioPhase | undefined = item.scenarioPhase;
    if (item.isVisualOnly) {
      if (phase === 'enter_center_visual_10s') {
        return isEn
          ? '🎯 Center of Geofence Reached (30s Visual)'
          : '🎯 حضور در مرکز حصار مکانی (نمایش ۳۰ ثانیه‌ای)';
      }
      if (phase === 'both_entered_visual_10s') {
        return isEn ? '✅ Entered Geofence Boundary' : '✅ ورود به حصار مکانی';
      }
      return isEn
        ? '🚪 Exited Geofence Boundary (30s Visual)'
        : '🚪 خروج از حصار مکانی (نمایش ۳۰ ثانیه‌ای)';
    }

    const is5Hz = (item.sonarIntervalMs || 1000) <= 200;
    if (phase === 'enter_center_5hz') {
      return isEn
        ? '🎯 Central 5% Zone (Rapid Sonar 10s)'
        : '🎯 محدوده ۵٪ مرکزی مقصد (سونار سریع ۱۰ ثانیه‌ای)';
    }
    if (phase === 'exit_border_5hz' || phase === 'both_exit_border_5hz') {
      return isEn
        ? '🚪 Exited Boundary (Rapid Exit Sonar 10s)'
        : '🚪 خروج از مرز حصار (سونار خروجی سریع ۱۰ ثانیه‌ای)';
    }
    if (phase === 'both_approaching_enter') {
      return isEn
        ? '📡 5% Pre-Entry Band (10 Pings/Min)'
        : '📡 ۵٪ قبل از ورود به محدوده (سونار ۱۰ بار در دقیقه)';
    }
    if (phase === 'both_approaching_exit' || phase === 'exit_moving_out' || item.triggerType === 'exit') {
      return isEn
        ? '📡 Exiting Geofence (Deep Sonar 10/Min)'
        : '📡 در حال خروج از حصار مکانی (سونار بم ۱۰ بار در دقیقه)';
    }
    if (is5Hz) {
      return isEn ? '🎯 Target Stage (Rapid Sonar 10s)' : '🎯 مرحله هدف (سونار سریع ۱۰ ثانیه‌ای)';
    }
    return isEn
      ? '📡 Geofence Arrival Radar (10 Pings/Min)'
      : '📡 رادار ورود به حصار مکانی (سونار ۱۰ بار در دقیقه)';
  };

  if (sortedAlerts.length === 0) return null;

  // Single-Card Mode Timing
  const primaryItem = sortedAlerts[0];
  const primaryIntervalMs = primaryItem.sonarIntervalMs || 1000;
  const isPrimary5Hz = !primaryItem.isVisualOnly && primaryIntervalMs <= 200;
  const activeBeatDurationSec = isPrimary5Hz
    ? 0.2
    : Math.min(0.75, Math.max(0.2, (primaryIntervalMs / 1000) * 0.65));
  const activeRepeatDelaySec = isPrimary5Hz
    ? 0
    : Math.max(0.04, primaryIntervalMs / 1000 - activeBeatDurationSec);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-[110] bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 select-none overflow-y-auto"
        dir={isEn ? 'ltr' : 'rtl'}
      >
        {!isMultiMode ? (
          /* =====================================================================
             SINGLE ACTIVE GEOFENCE ALERT CARD (FULL-SIZE)
             ===================================================================== */
          <motion.div
            key={primaryItem.id}
            initial={{ scale: 0.92, y: 20, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.92, y: 20, opacity: 0 }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-3xl border-2 border-emerald-400/90 bg-gradient-to-b from-[#042621] via-[#031D19] to-[#021512] shadow-[0_0_50px_rgba(16,185,129,0.35)] overflow-hidden p-5 sm:p-6 flex flex-col items-center text-center space-y-4"
          >
            {/* SEPARATE 10-SECOND BOUNDARY ENTRY MESSAGE BANNER (WHILE DEDICATED ALERT & SONAR CONTINUE) */}
            {primaryItem.entryToastMessage && (
              <div className="w-full rounded-2xl border-2 border-emerald-300 bg-emerald-500/20 px-4 py-2.5 shadow-md flex items-center justify-between gap-2">
                <span className="text-xs sm:text-sm font-black text-emerald-200 text-start leading-snug">
                  ✅ {primaryItem.entryToastMessage}
                </span>
                {primaryItem.entryToastRemainingSeconds !== undefined && (
                  <span className="shrink-0 text-xs font-black font-mono tabular-nums px-2 py-0.5 rounded-lg bg-emerald-400/25 text-emerald-100">
                    {isEn
                      ? `${primaryItem.entryToastRemainingSeconds}s`
                      : `${toPersianDigits(primaryItem.entryToastRemainingSeconds)} ثانیه`}
                  </span>
                )}
              </div>
            )}

            {/* 1. TOP: Scenario Status & Prominent Location Title */}
            <div className="w-full space-y-2">
              <div className="flex items-center justify-center gap-2 flex-wrap">
                <span className="text-xs font-extrabold text-emerald-300 tracking-wide">
                  {getScenarioBadgeLabel(primaryItem)}
                </span>
                {primaryItem.phaseRemainingSeconds !== undefined && (
                  <span className="text-xs font-black font-mono tabular-nums text-amber-300">
                    ·{' '}
                    {isEn
                      ? `${primaryItem.phaseRemainingSeconds}s`
                      : `${toPersianDigits(primaryItem.phaseRemainingSeconds)} ثانیه`}
                  </span>
                )}
              </div>

              <div className="w-full px-4 py-3 rounded-2xl bg-[#073B33]/90 border-2 border-emerald-400/60 shadow-inner">
                <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight leading-snug break-words">
                  {primaryItem.locationTitle}
                </h2>
                {primaryItem.description && (
                  <p className="text-xs sm:text-sm font-medium text-emerald-100/90 mt-1.5 leading-relaxed line-clamp-2">
                    {primaryItem.description}
                  </p>
                )}
              </div>

              {!primaryItem.isVisualOnly && primaryItem.visualBannerMessage && (
                <div className="w-full rounded-xl border border-amber-400/70 bg-amber-500/15 px-3.5 py-2 text-xs sm:text-sm font-black text-amber-200 leading-relaxed">
                  {primaryItem.visualBannerMessage}
                </div>
              )}
            </div>

            {/* 2. VISUAL-ONLY 30-SECOND COMPLETION BANNER OR PULSING SONAR RADAR */}
            {primaryItem.isVisualOnly && primaryItem.visualBannerMessage ? (
              <div className="w-full rounded-2xl border-2 border-amber-400/80 bg-[#07382F] p-5 space-y-3 shadow-lg">
                <div className="flex items-center justify-center gap-2 text-amber-300 text-xs font-extrabold">
                  <VolumeX className="w-4 h-4 shrink-0" />
                  <span>
                    {isEn
                      ? 'Visual Notification (Up to 30s - Sonar Completed)'
                      : 'اعلان دیداری تا ۳۰ ثانیه (اتمام پخش ۱۰ ثانیه‌ای سونار)'}
                  </span>
                </div>
                <p className="text-lg sm:text-xl font-black text-white leading-relaxed">
                  {primaryItem.visualBannerMessage}
                </p>
                {primaryItem.phaseRemainingSeconds !== undefined && (
                  <div className="text-xs font-bold text-emerald-200/90 font-mono tabular-nums">
                    {isEn
                      ? `Closing automatically in ${primaryItem.phaseRemainingSeconds}s`
                      : `بسته شدن خودکار تا ${toPersianDigits(primaryItem.phaseRemainingSeconds)} ثانیه دیگر`}
                  </div>
                )}
              </div>
            ) : (
              <div className="relative my-1 flex items-center justify-center py-3">
                <motion.span
                  key={`outer-ring-${isPrimary5Hz ? '5hz' : pingBeat}`}
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
                  key={`inner-ring-${isPrimary5Hz ? '5hz' : pingBeat}`}
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

                <motion.div
                  key={`logo-pulse-${isPrimary5Hz ? '5hz' : pingBeat}`}
                  animate={{ scale: [1, 1.09, 1] }}
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
                    referrerPolicy="no-referrer"
                    className="w-20 h-20 sm:w-24 sm:h-24 object-contain rounded-2xl"
                    draggable={false}
                  />

                  <motion.div
                    key={`pin-pulse-${isPrimary5Hz ? '5hz' : pingBeat}`}
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
            )}

            {/* 3. LIVE DISTANCE BOX */}
            {(() => {
              const distFormatted = formatDistanceText(primaryItem.initialDistance);
              const borderDistFormatted = formatDistanceText(
                Math.abs((primaryItem.radius || 200) - primaryItem.initialDistance)
              );
              return (
                <div className="w-full rounded-2xl border-2 border-cyan-400/75 bg-[#052E28]/95 px-4 py-3 shadow-[0_0_24px_rgba(6,182,212,0.2)] space-y-1.5">
                  <div className="flex items-center justify-center gap-1.5 text-xs font-extrabold text-cyan-300">
                    <Navigation className="w-3.5 h-3.5 text-emerald-400" />
                    <span>
                      {isEn ? 'LIVE DISTANCE TO CENTER' : 'مسافت زنده تا مرکز مکان'}
                    </span>
                  </div>

                  <div className="flex items-baseline justify-center gap-2 py-0.5 tabular-nums">
                    <span className="text-3xl sm:text-4xl font-black font-mono tracking-tight text-emerald-300 drop-shadow-[0_0_10px_rgba(52,211,153,0.5)]">
                      {distFormatted.value}
                    </span>
                    <span className="text-base sm:text-lg font-black text-emerald-100">
                      {distFormatted.unit}
                    </span>
                  </div>

                  <div className="flex items-center justify-center gap-2 flex-wrap text-[11px] font-bold text-teal-200/90 pt-0.5">
                    <span>
                      {isEn
                        ? `Radius: ${formatRadiusText(primaryItem.radius || 200)}`
                        : `شعاع حصار: ${formatRadiusText(primaryItem.radius || 200)}`}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {isEn
                        ? `To Border: ${borderDistFormatted.value} ${borderDistFormatted.unit}`
                        : `فاصله تا مرز: ${borderDistFormatted.value} ${borderDistFormatted.unit}`}
                    </span>
                  </div>
                </div>
              );
            })()}

            {/* 4. MUTE AUDIO BUTTON + 3 INDEPENDENT ACTION BUTTONS */}
            <div className="w-full space-y-2 pt-1">
              {!primaryItem.isVisualOnly && (
                <button
                  type="button"
                  onClick={() => handleToggleMuteItem(primaryItem)}
                  className={`w-full min-h-[42px] py-2 px-3 rounded-2xl font-black text-xs sm:text-sm transition-all cursor-pointer active:scale-95 flex items-center justify-center gap-2 border-2 shadow-md ${
                    primaryItem.isAudioMuted
                      ? 'bg-amber-500/20 border-amber-400 text-amber-200 hover:bg-amber-500/30'
                      : 'bg-[#063830] border-emerald-400/70 text-emerald-200 hover:bg-[#09483E]'
                  }`}
                >
                  {primaryItem.isAudioMuted ? (
                    <>
                      <Volume2 className="w-4 h-4 shrink-0 text-amber-300" />
                      <span>
                        {isEn
                          ? 'Sonar Muted — Tap to Unmute Audio'
                          : 'صدای اعلان قطع شد — وصل مجدد صدای سونار'}
                      </span>
                    </>
                  ) : (
                    <>
                      <VolumeX className="w-4 h-4 shrink-0 text-rose-300" />
                      <span>{isEn ? 'Mute Alert Sound' : 'قطع صدای اعلان'}</span>
                    </>
                  )}
                </button>
              )}

              <div className="w-full grid grid-cols-3 gap-2.5">
                <button
                  type="button"
                  onClick={() => handleStopItemOperation(primaryItem)}
                  className="min-h-[48px] py-2.5 px-2.5 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-stone-950 font-black text-xs sm:text-sm transition-all cursor-pointer active:scale-95 flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-500/30 whitespace-nowrap"
                >
                  <CheckCircle2 className="w-4 h-4 stroke-[2.5] shrink-0" />
                  <span className="truncate">{isEn ? 'Stop Operation' : 'توقف عملیات'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleDirectionsItem(primaryItem)}
                  className="min-h-[48px] py-2.5 px-2.5 rounded-2xl bg-sky-500/25 hover:bg-sky-500/35 text-sky-200 border-2 border-sky-400/80 font-black text-xs sm:text-sm transition-all cursor-pointer active:scale-95 flex items-center justify-center gap-1.5 shadow-md whitespace-nowrap"
                >
                  <Navigation className="w-4 h-4 shrink-0 text-sky-300" />
                  <span className="truncate">{isEn ? 'Directions' : 'مسیریابی'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleEditItem(primaryItem)}
                  className="min-h-[48px] py-2.5 px-2.5 rounded-2xl bg-[#073B33] hover:bg-[#0B4F45] text-cyan-200 border-2 border-cyan-400/70 font-black text-xs sm:text-sm transition-all cursor-pointer active:scale-95 flex items-center justify-center gap-1.5 shadow-md whitespace-nowrap"
                >
                  <Edit2 className="w-4 h-4 shrink-0 text-cyan-300" />
                  <span className="truncate">{isEn ? 'Edit' : 'ویرایش'}</span>
                </button>
              </div>
            </div>
          </motion.div>
        ) : (
          /* =====================================================================
             MULTI-GEOFENCE COMPACT STACKED CARDS (N >= 2 SIMULTANEOUS ALERTS)
             Sorted by shortest distance to target; #1 at top drives audio!
             ===================================================================== */
          <motion.div
            initial={{ scale: 0.95, y: 16, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.95, y: 16, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg max-h-[92vh] flex flex-col rounded-3xl border-2 border-emerald-400/90 bg-gradient-to-b from-[#042621] via-[#031D19] to-[#021512] shadow-[0_0_50px_rgba(16,185,129,0.35)] overflow-hidden p-4 sm:p-5 space-y-3"
          >
            {/* Multi-Alert Header */}
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-emerald-500/30">
              <div className="flex items-center gap-2">
                <img
                  src={appIcon}
                  alt="YAAD"
                  referrerPolicy="no-referrer"
                  className="w-8 h-8 rounded-xl border border-emerald-400/70 object-contain bg-[#063830]"
                />
                <div className="text-start">
                  <h2 className="text-sm sm:text-base font-black text-white">
                    {isEn
                      ? `${sortedAlerts.length} Active Geofence Alerts`
                      : `${toPersianDigits(sortedAlerts.length)} اعلان حصار مکانی همزمان`}
                  </h2>
                  <p className="text-[11px] font-bold text-emerald-300/90">
                    {isEn
                      ? 'Sorted by shortest distance · Sonar plays for #1 priority'
                      : 'مرتب‌شده بر اساس کمترین مسافت · پخش صدای سونار برای اولویت اول'}
                  </p>
                </div>
              </div>
            </div>

            {/* Scrollable Stack of Compact N Cards */}
            <div className="flex-1 overflow-y-auto space-y-3 pr-0.5">
              {sortedAlerts.map((item, idx) => {
                const isTopPriority = idx === 0;
                const distFormatted = formatDistanceText(item.initialDistance);
                const borderDistFormatted = formatDistanceText(
                  Math.abs((item.radius || 200) - item.initialDistance)
                );
                const rankStr = isEn ? `#${idx + 1}` : `اولویت ${toPersianDigits(idx + 1)}`;

                return (
                  <div
                    key={item.id || item.targetId}
                    className={`w-full rounded-2xl p-3.5 transition-all space-y-2.5 ${
                      isTopPriority
                        ? 'bg-[#063830] border-2 border-emerald-400 shadow-[0_0_25px_rgba(16,185,129,0.28)]'
                        : 'bg-[#04241F]/90 border border-emerald-500/40'
                    }`}
                  >
                    {/* Card Top Metadata Row */}
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-1.5 font-black text-emerald-300">
                        <span>{rankStr}</span>
                        <span aria-hidden="true">·</span>
                        {isTopPriority && !item.isVisualOnly && item.playAudio !== false ? (
                          <span className="inline-flex items-center gap-1 text-amber-300">
                            <Volume2 className="w-3.5 h-3.5 shrink-0" />
                            <span>{isEn ? 'Active Sonar Audio' : 'پخش سونار فعال'}</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-teal-200/75">
                            <VolumeX className="w-3.5 h-3.5 shrink-0" />
                            <span>{isEn ? 'Visual Only' : 'فقط دیداری'}</span>
                          </span>
                        )}
                      </div>

                      <span className="text-[11px] font-bold text-cyan-200 truncate">
                        {getScenarioBadgeLabel(item)}
                      </span>
                    </div>

                    {/* Title + Live Distance Compact Row */}
                    <div className="flex items-center justify-between gap-3 bg-[#031D19]/90 rounded-xl px-3 py-2.5 border border-emerald-400/35">
                      <div className="min-w-0 flex-1 text-start">
                        <h3 className="text-base sm:text-lg font-black text-white truncate">
                          {item.locationTitle}
                        </h3>
                        {item.isVisualOnly && item.visualBannerMessage ? (
                          <p className="text-xs font-extrabold text-amber-300 mt-0.5 leading-snug">
                            {item.visualBannerMessage}
                            {item.phaseRemainingSeconds !== undefined &&
                              ` (${
                                isEn
                                  ? `${item.phaseRemainingSeconds}s`
                                  : `${toPersianDigits(item.phaseRemainingSeconds)} ثانیه`
                              })`}
                          </p>
                        ) : (
                          <p className="text-[11px] font-bold text-teal-200/80 mt-0.5 truncate">
                            {isEn
                              ? `Radius: ${formatRadiusText(item.radius || 200)} · Border: ${borderDistFormatted.value} ${borderDistFormatted.unit}`
                              : `شعاع: ${formatRadiusText(item.radius || 200)} · تا مرز: ${borderDistFormatted.value} ${borderDistFormatted.unit}`}
                          </p>
                        )}
                      </div>

                      <div className="shrink-0 text-end font-mono tabular-nums bg-[#052E28] px-3 py-1.5 rounded-xl border border-cyan-400/50">
                        <div className="text-xl sm:text-2xl font-black text-emerald-300 leading-none">
                          {distFormatted.value}
                        </div>
                        <div className="text-[10px] font-bold text-emerald-100 mt-0.5">
                          {distFormatted.unit}
                        </div>
                      </div>
                    </div>

                    {/* Independent Action Buttons for this Card (Mute + Stop + Directions + Edit) */}
                    <div className="grid grid-cols-4 gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleStopItemOperation(item)}
                        className="min-h-[42px] py-2 px-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-stone-950 font-black text-[11px] transition-all cursor-pointer active:scale-95 flex items-center justify-center gap-1 shadow-md whitespace-nowrap"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 stroke-[2.5] shrink-0" />
                        <span className="truncate">{isEn ? 'Stop' : 'توقف عملیات'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleToggleMuteItem(item)}
                        className={`min-h-[42px] py-2 px-1.5 rounded-xl font-black text-[11px] transition-all cursor-pointer active:scale-95 flex items-center justify-center gap-1 border whitespace-nowrap ${
                          item.isAudioMuted
                            ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                            : 'bg-rose-500/20 border-rose-400/70 text-rose-200'
                        }`}
                      >
                        {item.isAudioMuted ? (
                          <>
                            <Volume2 className="w-3.5 h-3.5 shrink-0 text-amber-300" />
                            <span className="truncate">{isEn ? 'Unmute' : 'وصل صدا'}</span>
                          </>
                        ) : (
                          <>
                            <VolumeX className="w-3.5 h-3.5 shrink-0 text-rose-300" />
                            <span className="truncate">{isEn ? 'Mute' : 'قطع صدا'}</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDirectionsItem(item)}
                        className="min-h-[42px] py-2 px-1.5 rounded-xl bg-sky-500/25 hover:bg-sky-500/35 text-sky-200 border border-sky-400/80 font-black text-[11px] transition-all cursor-pointer active:scale-95 flex items-center justify-center gap-1 whitespace-nowrap"
                      >
                        <Navigation className="w-3.5 h-3.5 shrink-0 text-sky-300" />
                        <span className="truncate">{isEn ? 'Directions' : 'مسیریابی'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleEditItem(item)}
                        className="min-h-[42px] py-2 px-1.5 rounded-xl bg-[#073B33] hover:bg-[#0B4F45] text-cyan-200 border border-cyan-400/70 font-black text-[11px] transition-all cursor-pointer active:scale-95 flex items-center justify-center gap-1 whitespace-nowrap"
                      >
                        <Edit2 className="w-3.5 h-3.5 shrink-0 text-cyan-300" />
                        <span className="truncate">{isEn ? 'Edit' : 'ویرایش'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </motion.div>
    </AnimatePresence>
  );
};

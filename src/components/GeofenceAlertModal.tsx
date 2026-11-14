import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, Clock, Edit2, Maximize2, Minus, Navigation, Volume2, VolumeX, X } from 'lucide-react';
import { LivePolarRadar } from './LivePolarRadar';
import appIcon from '../assets/images/icon.png';
import {
  acknowledgeGeofenceAlert,
  calculateHaversineDistance,
  EvaluatedGeofenceAlertItem,
  GeofenceScenarioPhase,
  openGoogleMapsDirections,
  pauseGeofenceAlertTemporarily,
  snoozeGeofenceAlertPassThrough,
  toggleGeofenceAlertMute,
} from '../utils/geofenceManager';
import {
  computeSubmarineSonarIntervalMs,
  setSubmarineSonarMuted,
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
  onSnoozePassThrough?: (alert: GeofenceAlertData) => void;
  onEditRadius: (alert: GeofenceAlertData) => void;
  onStartDirections?: (alert: GeofenceAlertData) => void;
}

export const GeofenceAlertModal: React.FC<GeofenceAlertModalProps> = ({
  alert,
  alerts,
  userPosition,
  language = 'fa',
  onGotIt,
  onSnoozePassThrough,
  onEditRadius,
  onStartDirections,
}) => {
  const isEn = language === 'en';
  const [liveUserPos, setLiveUserPos] = useState<{ latitude: number; longitude: number } | null>(
    userPosition || null
  );
  const [pingBeat, setPingBeat] = useState<number>(0);
  const [mutedMap, setMutedMap] = useState<Record<string, boolean>>({});
  const [isMinimized, setIsMinimized] = useState<boolean>(false);

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
      const liveDist =
        typeof item.initialDistance === 'number' && Number.isFinite(item.initialDistance)
          ? item.initialDistance
          : liveUserPos
          ? calculateHaversineDistance(
              liveUserPos.latitude,
              liveUserPos.longitude,
              item.latitude,
              item.longitude
            )
          : 0;
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

  const handleStopItemOperation = (item: GeofenceAlertData) => {
    if (sortedAlerts.length <= 1) {
      setSubmarineSonarMuted(false);
      stopSubmarineSonarLoop();
      stopAlarmRinging();
      setIsMinimized(false);
    }
    acknowledgeGeofenceAlert(item.targetId);
    onGotIt(item.targetId, item.locationTitle);
  };

  const handleCloseAllCompletely = () => {
    setSubmarineSonarMuted(false);
    stopSubmarineSonarLoop();
    stopAlarmRinging();
    setIsMinimized(false);
    sortedAlerts.forEach((item) => {
      acknowledgeGeofenceAlert(item.targetId);
      onGotIt(item.targetId, item.locationTitle);
    });
  };

  const handleMinimizeModal = () => {
    setSubmarineSonarMuted(true);
    stopSubmarineSonarLoop();
    setIsMinimized(true);
  };

  const handleRestoreMinimizedModal = () => {
    setIsMinimized(false);
  };

  const handleSnoozePassThroughItem = (item: GeofenceAlertData) => {
    if (sortedAlerts.length <= 1) {
      setSubmarineSonarMuted(false);
      stopSubmarineSonarLoop();
      stopAlarmRinging();
    }
    snoozeGeofenceAlertPassThrough(item.targetId);
    if (onSnoozePassThrough) {
      onSnoozePassThrough(item);
    } else {
      onGotIt(item.targetId, item.locationTitle);
    }
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
    setSubmarineSonarMuted(nextMuted);
    toggleGeofenceAlertMute(item.targetId, nextMuted);
    setMutedMap((prev) => ({ ...prev, [cleanId]: nextMuted }));
    if (nextMuted) {
      stopSubmarineSonarLoop();
    } else if (
      topPriorityAlert &&
      topPriorityAlert.targetId === item.targetId &&
      !item.isVisualOnly &&
      item.playAudio !== false
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

  const getConciseStatusText = (item: GeofenceAlertData): string => {
    const phase: GeofenceScenarioPhase | undefined = item.scenarioPhase;
    const remSec =
      typeof item.phaseRemainingSeconds === 'number' && item.phaseRemainingSeconds > 0
        ? isEn
          ? ` (${item.phaseRemainingSeconds}s)`
          : ` (${toPersianDigits(item.phaseRemainingSeconds)} ثانیه)`
        : '';

    if (item.visualBannerMessage) {
      return `${item.visualBannerMessage}${remSec}`;
    }
    if (phase === 'enter_center_5hz' || phase === 'enter_center_visual_10s') {
      return isEn
        ? `Arrived at central zone of «${item.locationTitle}»${remSec}`
        : `رسیدن به ناحیه مرکزی «${item.locationTitle}»${remSec}`;
    }
    if (phase === 'exit_border_5hz' || phase === 'exit_crossed_visual_10s') {
      return isEn
        ? `Exited geofence «${item.locationTitle}»${remSec}`
        : `خارج شدن از حصار مکانی «${item.locationTitle}»${remSec}`;
    }
    if (phase === 'exit_moving_out' || item.triggerType === 'exit' || item.triggerOn === 'exit') {
      return isEn
        ? `Exiting «${item.locationTitle}»`
        : `در حال خروج از حصار مکانی «${item.locationTitle}»`;
    }
    return isEn
      ? `Entered «${item.locationTitle}»`
      : `ورود به حصار مکانی «${item.locationTitle}»`;
  };

  if (sortedAlerts.length === 0) return null;

  const primaryItem = sortedAlerts[0];
  const primaryIntervalMs = primaryItem.sonarIntervalMs || 6000;
  const isPrimary5Hz = !primaryItem.isVisualOnly && primaryIntervalMs <= 200;
  const primaryRadarMode: 'enter' | 'exit' =
    primaryItem.sonarMode === 'exit' ||
    primaryItem.triggerType === 'exit' ||
    primaryItem.triggerOn === 'exit' ||
    primaryItem.scenarioPhase?.startsWith('exit')
      ? 'exit'
      : 'enter';

  return (
    <AnimatePresence>
      {isMinimized ? (
        <motion.div
          key="geofence-minimized-pill"
          initial={{ y: 40, opacity: 0, scale: 0.94 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 40, opacity: 0, scale: 0.94 }}
          transition={{ type: 'spring', damping: 24, stiffness: 320 }}
          className="fixed bottom-20 left-3 right-3 z-[115] max-w-md mx-auto select-none"
          dir="ltr"
        >
          <div
            onClick={handleRestoreMinimizedModal}
            className="flex items-center justify-between gap-2.5 px-3.5 py-2.5 rounded-2xl border-2 border-emerald-400 bg-[#042621]/95 backdrop-blur-md shadow-[0_8px_30px_rgba(0,0,0,0.65)] cursor-pointer hover:bg-[#063830] transition-all"
          >
            {/* Left: Complete Close (X) */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleCloseAllCompletely();
              }}
              className="w-8 h-8 rounded-xl bg-rose-500/20 hover:bg-rose-500/35 border border-rose-500/50 text-rose-200 flex items-center justify-center shrink-0 transition-all cursor-pointer active:scale-90"
              title={isEn ? 'Close completely' : 'بستن کامل'}
            >
              <X className="w-4 h-4 stroke-[2.5]" />
            </button>

            {/* Center: Location Title & Live Distance */}
            <div
              className="flex items-center gap-2.5 min-w-0 flex-1"
              dir={isEn ? 'ltr' : 'rtl'}
            >
              <img
                src={appIcon}
                alt="YAAD"
                className="w-8 h-8 rounded-xl object-contain shrink-0"
                draggable={false}
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs sm:text-sm font-black text-white truncate">
                  {isMultiMode
                    ? isEn
                      ? `${sortedAlerts.length} Active Geofence Alerts`
                      : `${toPersianDigits(sortedAlerts.length)} اعلان حصار مکانی فعال`
                    : primaryItem.locationTitle}
                </p>
                <p className="text-[11px] font-bold text-emerald-300 truncate">
                  {isEn ? 'Tap to reopen full-screen radar' : 'برای باز کردن مجدد رادار تمام‌صفحه ضربه بزنید'}
                </p>
              </div>
            </div>

            {/* Right: Reopen Button */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleRestoreMinimizedModal();
              }}
              className="px-2.5 py-1.5 rounded-xl bg-emerald-500/25 hover:bg-emerald-500/40 border border-emerald-400/70 text-emerald-100 text-xs font-black flex items-center gap-1 shrink-0 transition-all cursor-pointer active:scale-95"
              title={isEn ? 'Reopen' : 'باز کردن مجدد'}
            >
              <Maximize2 className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>{isEn ? 'Open' : 'باز کردن'}</span>
            </button>
          </div>
        </motion.div>
      ) : (
        <motion.div
          key="geofence-fullscreen-modal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[110] bg-black/85 backdrop-blur-md flex items-center justify-center px-1.5 py-2 sm:p-4 select-none overflow-y-auto"
          dir={isEn ? 'ltr' : 'rtl'}
        >
          {!isMultiMode ? (
            /* =====================================================================
               SINGLE CONCISE GEOFENCE ALERT CARD WITH LIVE POLAR TRAJECTORY RADAR:
               0. Top-Left Close (X) & Top-Right Minimize (—) Window Controls
               1. Location Name + Short Status Phrase (Compact)
               2. Expanded Live Polar Trajectory Radar (20px from screen edges, YAAD App Logo marker)
               3. Live Distance + Geofence Radius (Compact)
               4. Prominent «الان نه (Snooze)» Pass-Through Button + 4 Action Buttons
               ===================================================================== */
            <motion.div
              key={primaryItem.id}
              initial={{ scale: 0.94, y: 14, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.94, y: 14, opacity: 0 }}
              transition={{ type: 'spring', damping: 26, stiffness: 340 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-3xl border-2 border-emerald-400/90 bg-gradient-to-b from-[#042621] via-[#031D19] to-[#021512] shadow-[0_0_50px_rgba(16,185,129,0.35)] overflow-hidden px-1.5 py-2 sm:p-4 flex flex-col items-center text-center space-y-1.5"
            >
              {/* Separate 10-second entry toast if distinct from current status */}
              {primaryItem.entryToastMessage &&
                primaryItem.entryToastMessage !== getConciseStatusText(primaryItem) && (
                  <div className="w-[calc(100%-8px)] rounded-xl border border-emerald-300/80 bg-emerald-500/20 px-3 py-1 text-xs font-black text-emerald-100">
                    {primaryItem.entryToastMessage}
                  </div>
                )}

              {/* 1. Header Box with Top-Left Close (X), Location Name + Status, and Top-Right Minimize (—) */}
              <div className="w-[calc(100%-8px)] px-2.5 py-1.5 rounded-2xl bg-[#073B33]/90 border border-emerald-400/60 flex items-center justify-between gap-2" dir="ltr">
                {/* Top-Left: Close Completely (X) */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCloseAllCompletely();
                  }}
                  className="w-8 h-8 rounded-xl bg-rose-500/20 hover:bg-rose-500/35 border border-rose-400/60 text-rose-200 flex items-center justify-center shrink-0 transition-all cursor-pointer active:scale-90"
                  title={isEn ? 'Close completely' : 'بستن کامل'}
                  aria-label={isEn ? 'Close completely' : 'بستن کامل'}
                >
                  <X className="w-4 h-4 stroke-[2.5]" />
                </button>

                {/* Center: Location Name + Short Status Phrase */}
                <div className="min-w-0 flex-1 text-center space-y-0.5" dir={isEn ? 'ltr' : 'rtl'}>
                  <h2 className="text-base sm:text-lg font-black text-white tracking-tight leading-tight break-words">
                    {primaryItem.locationTitle}
                  </h2>
                  <p className="text-xs sm:text-sm font-extrabold text-amber-300 leading-tight">
                    {getConciseStatusText(primaryItem)}
                  </p>
                </div>

                {/* Top-Right: Minimize Temporarily (—) */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleMinimizeModal();
                  }}
                  className="w-8 h-8 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/35 border border-emerald-400/60 text-emerald-100 flex items-center justify-center shrink-0 transition-all cursor-pointer active:scale-90"
                  title={isEn ? 'Minimize temporarily' : 'مینیمایز (بستن موقت)'}
                  aria-label={isEn ? 'Minimize temporarily' : 'مینیمایز (بستن موقت)'}
                >
                  <Minus className="w-4 h-4 stroke-[2.5]" />
                </button>
              </div>

            {/* 2. Expanded Live Polar Trajectory Radar Graph with YAAD App Logo Marker */}
            <LivePolarRadar
              locationTitle={primaryItem.locationTitle}
              distanceMeters={primaryItem.initialDistance}
              radiusMeters={primaryItem.radius || 200}
              targetLat={primaryItem.latitude}
              targetLon={primaryItem.longitude}
              userLat={liveUserPos?.latitude}
              userLon={liveUserPos?.longitude}
              mode={primaryRadarMode}
              is5Hz={isPrimary5Hz}
              isVisualOnly={Boolean(primaryItem.isVisualOnly)}
              pingBeat={pingBeat}
              language={language}
            />

            {/* 3. Live Distance + Geofence Radius (Compact) */}
            {(() => {
              const distFormatted = formatDistanceText(primaryItem.initialDistance);
              const radiusFormatted = formatDistanceText(primaryItem.radius || 200);
              return (
                <div className="w-[calc(100%-8px)] rounded-2xl border border-cyan-400/75 bg-[#052E28]/95 px-3 py-1 flex flex-col items-center justify-center gap-0.5 tabular-nums">
                  <div className="flex items-baseline justify-center gap-1.5">
                    <span className="text-xl sm:text-2xl font-black font-mono tracking-tight text-emerald-300 leading-none">
                      {distFormatted.value}
                    </span>
                    <span className="text-xs sm:text-sm font-black text-emerald-100">
                      {distFormatted.unit}
                    </span>
                  </div>
                  <div className="text-[11px] sm:text-xs font-extrabold text-cyan-200/90 leading-tight">
                    {isEn
                      ? `Geofence Radius: ${radiusFormatted.value} ${radiusFormatted.unit}`
                      : `شعاع حصار: ${radiusFormatted.value} ${radiusFormatted.unit}`}
                  </div>
                </div>
              );
            })()}

            {/* 4A. Prominent Pass-Through Snooze Button: «الان نه (Snooze)» */}
            <button
              type="button"
              onClick={() => handleSnoozePassThroughItem(primaryItem)}
              className="w-[calc(100%-8px)] min-h-[40px] py-2 px-3 rounded-2xl bg-gradient-to-r from-[#FF8C00] to-amber-500 hover:from-[#FF9E1F] hover:to-amber-400 text-stone-950 font-black text-xs sm:text-sm transition-all cursor-pointer active:scale-95 flex items-center justify-center gap-2 shadow-lg shadow-amber-500/25 border border-amber-300/80"
            >
              <Clock className="w-4 h-4 stroke-[2.5] shrink-0" />
              <span>{isEn ? 'Not Now (Snooze)' : 'الان نه (Snooze)'}</span>
            </button>

            {/* 4B. 4 Concise Action Buttons (Compact): قطع صدا، توقف، مسیریابی، ویرایش */}
            <div className="w-[calc(100%-8px)] grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              <button
                type="button"
                onClick={() => handleToggleMuteItem(primaryItem)}
                className={`min-h-[36px] py-1.5 px-2 rounded-xl font-black text-xs transition-all cursor-pointer active:scale-95 flex items-center justify-center gap-1.5 border shadow-sm whitespace-nowrap ${
                  primaryItem.isAudioMuted
                    ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                    : 'bg-rose-500/20 border-rose-400/80 text-rose-200'
                }`}
              >
                {primaryItem.isAudioMuted ? (
                  <>
                    <Volume2 className="w-3.5 h-3.5 shrink-0 text-amber-300" />
                    <span>{isEn ? 'Unmute' : 'وصل صدا'}</span>
                  </>
                ) : (
                  <>
                    <VolumeX className="w-3.5 h-3.5 shrink-0 text-rose-300" />
                    <span>{isEn ? 'Mute' : 'قطع صدا'}</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => handleStopItemOperation(primaryItem)}
                className="min-h-[36px] py-1.5 px-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-stone-950 font-black text-xs transition-all cursor-pointer active:scale-95 flex items-center justify-center gap-1.5 shadow-md shadow-emerald-500/25 whitespace-nowrap"
              >
                <CheckCircle2 className="w-3.5 h-3.5 stroke-[2.5] shrink-0" />
                <span>{isEn ? 'Stop' : 'توقف'}</span>
              </button>

              <button
                type="button"
                onClick={() => handleDirectionsItem(primaryItem)}
                className="min-h-[36px] py-1.5 px-2 rounded-xl bg-sky-500/25 hover:bg-sky-500/35 text-sky-200 border border-sky-400/80 font-black text-xs transition-all cursor-pointer active:scale-95 flex items-center justify-center gap-1.5 shadow-sm whitespace-nowrap"
              >
                <Navigation className="w-3.5 h-3.5 shrink-0 text-sky-300" />
                <span>{isEn ? 'Directions' : 'مسیریابی'}</span>
              </button>

              <button
                type="button"
                onClick={() => handleEditItem(primaryItem)}
                className="min-h-[36px] py-1.5 px-2 rounded-xl bg-[#073B33] hover:bg-[#0B4F45] text-cyan-200 border border-cyan-400/70 font-black text-xs transition-all cursor-pointer active:scale-95 flex items-center justify-center gap-1.5 shadow-sm whitespace-nowrap"
              >
                <Edit2 className="w-3.5 h-3.5 shrink-0 text-cyan-300" />
                <span>{isEn ? 'Edit' : 'ویرایش'}</span>
              </button>
            </div>
          </motion.div>
        ) : (
          /* =====================================================================
             MULTI-GEOFENCE CONCISE STACKED CARDS (N >= 2 SIMULTANEOUS ALERTS)
             ===================================================================== */
          <motion.div
            initial={{ scale: 0.95, y: 14, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.95, y: 14, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg max-h-[92vh] flex flex-col rounded-3xl border-2 border-emerald-400/90 bg-gradient-to-b from-[#042621] via-[#031D19] to-[#021512] shadow-[0_0_50px_rgba(16,185,129,0.35)] overflow-hidden p-4 space-y-3"
          >
            {/* Top Window Control Row for Multi-Geofence Card (Top-Left = Close (X), Top-Right = Minimize (—)) */}
            <div className="flex items-center justify-between gap-2 pb-1 border-b border-emerald-500/30" dir="ltr">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleCloseAllCompletely();
                }}
                className="w-8 h-8 rounded-xl bg-rose-500/20 hover:bg-rose-500/35 border border-rose-400/60 text-rose-200 flex items-center justify-center shrink-0 transition-all cursor-pointer active:scale-90"
                title={isEn ? 'Close completely' : 'بستن کامل'}
                aria-label={isEn ? 'Close completely' : 'بستن کامل'}
              >
                <X className="w-4 h-4 stroke-[2.5]" />
              </button>

              <span className="text-xs sm:text-sm font-black text-emerald-300 truncate" dir={isEn ? 'ltr' : 'rtl'}>
                {isEn
                  ? `📡 ${sortedAlerts.length} Active Geofence Alerts`
                  : `📡 ${toPersianDigits(sortedAlerts.length)} اعلان حصار مکانی فعال`}
              </span>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleMinimizeModal();
                }}
                className="w-8 h-8 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/35 border border-emerald-400/60 text-emerald-100 flex items-center justify-center shrink-0 transition-all cursor-pointer active:scale-90"
                title={isEn ? 'Minimize temporarily' : 'مینیمایز (بستن موقت)'}
                aria-label={isEn ? 'Minimize temporarily' : 'مینیمایز (بستن موقت)'}
              >
                <Minus className="w-4 h-4 stroke-[2.5]" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-0.5">
              {sortedAlerts.map((item, idx) => {
                const isTopPriority = idx === 0;
                const distFormatted = formatDistanceText(item.initialDistance);

                return (
                  <div
                    key={item.id || item.targetId}
                    className={`w-full rounded-2xl p-3.5 transition-all space-y-2.5 ${
                      isTopPriority
                        ? 'bg-[#063830] border-2 border-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.25)]'
                        : 'bg-[#04241F]/90 border border-emerald-500/40'
                    }`}
                  >
                    {/* Location Name + Short Status + Live Distance + Geofence Radius */}
                    {(() => {
                      const radiusFormatted = formatDistanceText(item.radius || 200);
                      return (
                        <div className="flex items-center justify-between gap-3 bg-[#031D19]/90 rounded-xl px-3.5 py-2.5 border border-emerald-400/35">
                          <div className="min-w-0 flex-1 text-start">
                            <h3 className="text-base sm:text-lg font-black text-white truncate">
                              {item.locationTitle}
                            </h3>
                            <p className="text-xs font-extrabold text-amber-300 mt-0.5 truncate">
                              {getConciseStatusText(item)}
                            </p>
                            <p className="text-[11px] font-bold text-cyan-200/90 mt-0.5 truncate">
                              {isEn
                                ? `Radius: ${radiusFormatted.value} ${radiusFormatted.unit}`
                                : `شعاع حصار: ${radiusFormatted.value} ${radiusFormatted.unit}`}
                            </p>
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
                      );
                    })()}

                    {/* Prominent Pass-Through Snooze Button: «الان نه (Snooze)» */}
                    <button
                      type="button"
                      onClick={() => handleSnoozePassThroughItem(item)}
                      className="w-full min-h-[40px] py-2 px-3 rounded-xl bg-gradient-to-r from-[#FF8C00] to-amber-500 hover:from-[#FF9E1F] hover:to-amber-400 text-stone-950 font-black text-xs transition-all cursor-pointer active:scale-95 flex items-center justify-center gap-1.5 shadow-md border border-amber-300/80"
                    >
                      <Clock className="w-4 h-4 stroke-[2.5] shrink-0" />
                      <span>{isEn ? 'Not Now (Snooze)' : 'الان نه (Snooze)'}</span>
                    </button>

                    {/* 4 Concise Buttons: قطع صدا، توقف، مسیریابی، ویرایش */}
                    <div className="grid grid-cols-4 gap-1.5">
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
                        onClick={() => handleStopItemOperation(item)}
                        className="min-h-[42px] py-2 px-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-stone-950 font-black text-[11px] transition-all cursor-pointer active:scale-95 flex items-center justify-center gap-1 shadow-md whitespace-nowrap"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 stroke-[2.5] shrink-0" />
                        <span className="truncate">{isEn ? 'Stop' : 'توقف'}</span>
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
      )}
    </AnimatePresence>
  );
};

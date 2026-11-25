import { Reminder, SavedLocation } from '../types';
import {
  computeFivePercentZoneMeters,
  setSubmarineSonarMuted,
  SonarScenarioMode,
} from './audio';

// Storage key for user preference on background geofence tracking
export const GEOFENCE_TRACKING_ENABLED_KEY = 'yaad_geofence_tracking_enabled_v1';
export const LAST_KNOWN_POSITION_KEY = 'yaad_last_known_user_position_v1';
export const GEOFENCE_PROXIMITY_STATE_KEY = 'yaad_geofence_proximity_state_v2';

export interface UserPosition {
  latitude: number;
  longitude: number;
  accuracy: number;
  speed?: number | null;
  timestamp: number;
}

export type GeofenceScenarioPhase =
  | 'enter_approaching'        // Scenario 'enter': 10% center < d <= R (10/min sonar)
  | 'enter_center_5hz'         // Scenario 'enter': d <= 10% center for 10 seconds (5 Hz sonar)
  | 'enter_center_visual_10s'  // Scenario 'enter': after 10s of 5Hz, visual-only completion
  | 'exit_moving_out'          // Scenario 'exit': 0.85*R <= d <= R moving out (10/min deep sonar)
  | 'exit_border_5hz'          // Scenario 'exit': d > R for 10 seconds (5 Hz deep sonar)
  | 'exit_crossed_visual_10s'; // Scenario 'exit': after 10s of 5Hz, visual-only completion

export interface EvaluatedGeofenceAlertItem {
  id: string;
  targetType: 'location' | 'reminder';
  targetId: string;
  locationTitle: string;
  description?: string;
  triggerType: 'enter' | 'exit' | 'arrived_under_10m';
  triggerOn: 'enter' | 'exit';
  scenarioPhase: GeofenceScenarioPhase;
  sonarMode: SonarScenarioMode;
  sonarIntervalMs: number;
  isVisualOnly: boolean;
  visualBannerMessage?: string;
  phaseRemainingSeconds?: number;
  entryToastMessage?: string;
  entryToastRemainingSeconds?: number;
  isAudioMuted?: boolean;
  initialDistance: number;
  targetDistance: number;
  radius: number;
  latitude: number;
  longitude: number;
  playAudio: boolean;
}

interface DistanceSample {
  distance: number;
  accuracy: number;
  timestamp: number;
}

interface ItemScenarioRuntimeState {
  samples: DistanceSample[];
  trend: 'inward' | 'outward' | 'stationary';
  lastMoveRefDistance: number;
  lastSignificantMoveMs: number;
  lastInwardMoveMs: number;
  lastOutwardMoveMs: number;
  lastPhaseTransitionMs: number;
  // Directional extrema for strict Enter vs Exit discrimination
  minDistanceReachedInside: number;
  maxDistanceInApproach: number;
  startedOutsideBoundary?: boolean;
  // Scenario 'enter'
  enterAlertActive: boolean;
  enterCycleCompleted: boolean;
  center5HzStartMs: number;
  entryBannerStartMs: number;
  enterApproachStartMs: number;
  // Scenario 'exit' & fuzzy boundary phase lock
  wasInsideForExit: boolean;
  armedForExit: boolean;
  exitCycleCompleted: boolean;
  exitMovingOutStartMs: number;
  // Scenario 'both'
  wasInsideBorder?: boolean;
  bothDirectionLock: 'inward' | 'outward' | null;
  border5HzStartMs: number;
  // Shared visual completion banner timer
  visual10sStartMs: number;
  visualCrossingType: 'enter_center' | 'exit_crossed' | 'both_entered' | 'both_exited' | null;
  // Mute audio for current alert cycle ("قطع صدا")
  audioMutedForCycle: boolean;
  // Permanent cutoff of 6s sonar once 5 Hz 10s stage has finished in this cycle
  sonarFinishedForCycle: boolean;
  // Dismissed / acknowledged for current phase
  acknowledgedUntilExit: boolean;
  // Anti-Ping-Pong & Debounce / Cooldown state
  cooldownUntilMs: number;
  lastTriggerTimestampMs: number;
  consecutiveOutsideSamples: number;
  consecutiveInsideSamples: number;
  // Exit 15%-to-boundary & Speed-Adaptive GPS Anti-Bounce State
  wasInFivePercentZoneForExit: boolean;
  consecutiveExitOutwardSamples: number;
  consecutiveFivePercentInsideSamples: number;
  lastExitAlertEmittedMs: number;
  exitGpsAntiBounceUntilMs: number;
  exitBoundaryOscillationCount: number;
  lastEvaluatedDistanceMeters: number;
  lastEvaluatedSampleTimeMs: number;
  // Speed & ZoneDetector-harmonized EMA/confirmation state
  rawMedianWindow: number[];
  emaDistanceMeters: number;
  emaDistanceTimeMs: number;
  emaMaxMeters: number;
  speedHistory: number[];
  lastSpeedDistMeters: number;
  lastSpeedTimeMs: number;
  lastSpeedAccMeters: number;
  stillSinceMs: number;
  isStationaryMode: boolean;
  effectiveSpeedMps: number;
  exitStartFirstMs: number;
  exitCancelConsecutive: number;
  exitCancelFirstMs: number;
  exitBoundaryOutConsecutive: number;
  exitBoundaryOutFirstMs: number;
  lastBoundaryInMs: number;
}

export const GEOFENCE_PASS_THROUGH_SNOOZE_MS = 5 * 60 * 1000; // 5 minutes snooze ("الان نه (Snooze)") after which the alert process re-emits
export const GEOFENCE_ANTI_PINGPONG_COOLDOWN_MS = 3 * 60 * 1000; // 3 minutes minimum cooldown between same-phase triggers
export const GEOFENCE_IN_APP_VISUAL_MAX_MS = 10 * 1000; // 10 seconds auto-off for in-app full-screen visual alert

const scenarioRuntimeMap = new Map<string, ItemScenarioRuntimeState>();
const minimizedGeofenceMap = new Map<string, boolean>();

export function getGeofenceMinimizedState(itemId?: string): boolean {
  const cleanId = (itemId || '').replace(/^(loc_|rem_)/, '');
  if (typeof window !== 'undefined') {
    try {
      const bridge = (window as any).YaadGeofenceBridge;
      if (bridge && typeof bridge.isGeofenceMinimized === 'function') {
        const nativeMin = Boolean(bridge.isGeofenceMinimized(cleanId));
        if (nativeMin) {
          if (cleanId) minimizedGeofenceMap.set(cleanId, true);
          return true;
        }
      }
    } catch {
      // ignore
    }
  }
  if (cleanId && minimizedGeofenceMap.has(cleanId)) {
    return Boolean(minimizedGeofenceMap.get(cleanId));
  }
  for (const val of minimizedGeofenceMap.values()) {
    if (val) return true;
  }
  return false;
}

export function setGeofenceMinimizedState(
  itemId: string | undefined,
  minimized: boolean,
  notifyNativeBridge: boolean = true
): void {
  const cleanId = (itemId || '').replace(/^(loc_|rem_)/, '');
  if (cleanId) {
    if (minimized) {
      minimizedGeofenceMap.set(cleanId, true);
    } else {
      minimizedGeofenceMap.delete(cleanId);
    }
  } else if (!minimized) {
    minimizedGeofenceMap.clear();
  }

  if (notifyNativeBridge && typeof window !== 'undefined') {
    try {
      const bridge = (window as any).YaadGeofenceBridge;
      if (bridge && typeof bridge.setGeofenceMinimized === 'function') {
        bridge.setGeofenceMinimized(itemId || '', minimized);
      }
    } catch {
      // ignore
    }
  }
}

export function dismissActiveGeofenceStatusBarNotification(): void {
  if (typeof window === 'undefined') return;
  try {
    const bridge = (window as any).YaadGeofenceBridge;
    if (bridge && typeof bridge.dismissActiveGeofenceStatusBarNotification === 'function') {
      bridge.dismissActiveGeofenceStatusBarNotification();
    }
  } catch {
    // ignore
  }
}

function getOrCreateRuntimeState(key: string, nowMs: number = Date.now()): ItemScenarioRuntimeState {
  let st = scenarioRuntimeMap.get(key);
  if (!st) {
    st = {
      samples: [],
      trend: 'stationary',
      lastMoveRefDistance: Number.NaN,
      lastSignificantMoveMs: nowMs,
      lastInwardMoveMs: 0,
      lastOutwardMoveMs: 0,
      lastPhaseTransitionMs: 0,
      minDistanceReachedInside: Number.POSITIVE_INFINITY,
      maxDistanceInApproach: 0,
      startedOutsideBoundary: undefined,
      enterAlertActive: false,
      enterCycleCompleted: false,
      center5HzStartMs: 0,
      entryBannerStartMs: 0,
      enterApproachStartMs: 0,
      wasInsideForExit: false,
      armedForExit: false,
      exitCycleCompleted: false,
      exitMovingOutStartMs: 0,
      wasInsideBorder: undefined,
      bothDirectionLock: null,
      border5HzStartMs: 0,
      visual10sStartMs: 0,
      visualCrossingType: null,
      audioMutedForCycle: false,
      sonarFinishedForCycle: false,
      acknowledgedUntilExit: false,
      cooldownUntilMs: 0,
      lastTriggerTimestampMs: 0,
      consecutiveOutsideSamples: 0,
      consecutiveInsideSamples: 0,
      wasInFivePercentZoneForExit: false,
      consecutiveExitOutwardSamples: 0,
      consecutiveFivePercentInsideSamples: 0,
      lastExitAlertEmittedMs: 0,
      exitGpsAntiBounceUntilMs: 0,
      exitBoundaryOscillationCount: 0,
      lastEvaluatedDistanceMeters: Number.NaN,
      lastEvaluatedSampleTimeMs: 0,
      rawMedianWindow: [],
      emaDistanceMeters: Number.NaN,
      emaDistanceTimeMs: 0,
      emaMaxMeters: Number.NaN,
      speedHistory: [],
      lastSpeedDistMeters: Number.NaN,
      lastSpeedTimeMs: 0,
      lastSpeedAccMeters: 100,
      stillSinceMs: 0,
      isStationaryMode: false,
      effectiveSpeedMps: 0,
      exitStartFirstMs: 0,
      exitCancelConsecutive: 0,
      exitCancelFirstMs: 0,
      exitBoundaryOutConsecutive: 0,
      exitBoundaryOutFirstMs: 0,
      lastBoundaryInMs: nowMs - 20_000,
    };
    scenarioRuntimeMap.set(key, st);
  }
  return st;
}

/**
 * Accuracy-Weighted Moving Average & Fuzzy Trend Detector:
 * Weights each GPS sample by 1 / max(5, accuracy)^2 so noisy fixes near the boundary
 * cannot flip inward/outward state, while firing immediately (< 2s) on the very first fix.
 */
export function recordAndAnalyzeDistanceTrend(
  itemKey: string,
  distanceMeters: number,
  nowMs: number = Date.now(),
  accuracyMeters: number = 12
): 'inward' | 'outward' | 'stationary' {
  const st = getOrCreateRuntimeState(itemKey, nowMs);
  const safeAcc = Math.max(5, Math.min(100, accuracyMeters || 12));
  const lastSample = st.samples[st.samples.length - 1];

  if (Number.isNaN(st.lastMoveRefDistance)) {
    st.lastMoveRefDistance = distanceMeters;
    st.lastSignificantMoveMs = nowMs;
  } else {
    const moveThreshold = Math.max(2.0, Math.min(6.0, safeAcc * 0.2));
    const diffFromRef = distanceMeters - st.lastMoveRefDistance;
    if (Math.abs(diffFromRef) >= moveThreshold) {
      if (diffFromRef <= -moveThreshold) {
        st.lastInwardMoveMs = nowMs;
        st.trend = 'inward';
      } else if (diffFromRef >= moveThreshold) {
        st.lastOutwardMoveMs = nowMs;
        st.trend = 'outward';
      }
      st.lastMoveRefDistance = distanceMeters;
      st.lastSignificantMoveMs = nowMs;
    }
  }

  if (!lastSample || Math.abs(distanceMeters - lastSample.distance) >= 0.8) {
    st.samples.push({
      distance: distanceMeters,
      accuracy: safeAcc,
      timestamp: nowMs,
    });
    if (st.samples.length > 5) {
      st.samples.shift();
    }
  }

  if (st.samples.length < 2) {
    return st.trend;
  }

  const n = st.samples.length;
  const splitIdx = Math.max(1, Math.floor(n / 2));
  const olderSlice = st.samples.slice(0, splitIdx);
  const newerSlice = st.samples.slice(splitIdx);

  const weightedMean = (slice: DistanceSample[]) => {
    let wSum = 0;
    let dSum = 0;
    for (const s of slice) {
      const w = 1 / Math.pow(Math.max(5, s.accuracy || 12), 2);
      wSum += w;
      dSum += s.distance * w;
    }
    return wSum > 0 ? dSum / wSum : slice[slice.length - 1].distance;
  };

  const olderAvg = weightedMean(olderSlice);
  const newerAvg = weightedMean(newerSlice);
  const totalDelta = st.samples[n - 1].distance - st.samples[0].distance;
  const avgDelta = newerAvg - olderAvg;
  const jitterGuard = Math.max(1.5, Math.min(5.0, safeAcc * 0.18));

  if (avgDelta <= -jitterGuard || totalDelta <= -(jitterGuard * 1.4)) {
    st.trend = 'inward';
    st.lastInwardMoveMs = nowMs;
  } else if (avgDelta >= jitterGuard || totalDelta >= jitterGuard * 1.4) {
    st.trend = 'outward';
    st.lastOutwardMoveMs = nowMs;
  } else if (nowMs - st.lastSignificantMoveMs >= 15_000) {
    st.trend = 'stationary';
  }

  return st.trend;
}

interface SpeedTierProfile {
  confirmGoodMs: number;
  confirmPoorMs: number;
  minDwellMs: number;
  emaTauMs: number;
  cancelBlockMs: number;
  isSlowOrStill: boolean;
}

function computeSpeedTierProfile(effSpeedMps: number, isStationary: boolean): SpeedTierProfile {
  if (!isStationary && effSpeedMps > 7.0) {
    return {
      confirmGoodMs: 1000,
      confirmPoorMs: 1200,
      minDwellMs: 4000,
      emaTauMs: 2000,
      cancelBlockMs: 30_000,
      isSlowOrStill: false,
    };
  }
  if (!isStationary && effSpeedMps >= 2.5) {
    return {
      confirmGoodMs: 2000,
      confirmPoorMs: 4500,
      minDwellMs: 10_000,
      emaTauMs: 4500,
      cancelBlockMs: 60_000,
      isSlowOrStill: false,
    };
  }
  return {
    confirmGoodMs: 3000,
    confirmPoorMs: 7000,
    minDwellMs: 18_000,
    emaTauMs: 8000,
    cancelBlockMs: 120_000,
    isSlowOrStill: true,
  };
}

function updateRuntimeSpeedAndMedianEma(
  st: ItemScenarioRuntimeState,
  rawDistance: number,
  accuracy: number,
  now: number,
  gpsSpeedMps?: number | null
): { medianDm: number; emaDistance: number; effectiveSpeedMps: number; profile: SpeedTierProfile } {
  const safeAcc = Math.max(5, Math.min(100, accuracy || 15));

  let candSpeed = Number.NaN;
  if (typeof gpsSpeedMps === 'number' && Number.isFinite(gpsSpeedMps) && gpsSpeedMps >= 0 && safeAcc <= 40) {
    candSpeed = Math.max(0, Math.min(65, gpsSpeedMps));
  } else if (
    Number.isFinite(st.lastSpeedDistMeters) &&
    st.lastSpeedTimeMs > 0 &&
    now - st.lastSpeedTimeMs >= 500 &&
    safeAcc <= 40 &&
    st.lastSpeedAccMeters <= 40
  ) {
    const dtSec = (now - st.lastSpeedTimeMs) / 1000;
    const v = Math.abs(rawDistance - st.lastSpeedDistMeters) / dtSec;
    if (v <= 60) {
      candSpeed = v;
    }
  }

  if (safeAcc <= 40 && (st.lastSpeedTimeMs === 0 || now - st.lastSpeedTimeMs >= 300)) {
    st.lastSpeedDistMeters = rawDistance;
    st.lastSpeedTimeMs = now;
    st.lastSpeedAccMeters = safeAcc;
  }

  if (Number.isFinite(candSpeed)) {
    st.speedHistory.push(candSpeed);
    if (st.speedHistory.length > 3) {
      st.speedHistory.shift();
    }
    if (candSpeed <= 0.6) {
      if (st.stillSinceMs === 0) st.stillSinceMs = now;
      st.isStationaryMode = now - st.stillSinceMs >= 20_000;
    } else if (candSpeed > 0.85) {
      st.stillSinceMs = 0;
      st.isStationaryMode = false;
    }
  }

  let effSpeed = 0;
  if (st.speedHistory.length > 0) {
    const sorted = [...st.speedHistory].sort((a, b) => a - b);
    effSpeed = sorted[Math.floor(sorted.length / 2)];
  }
  st.effectiveSpeedMps = effSpeed;

  const profile = computeSpeedTierProfile(effSpeed, st.isStationaryMode);

  st.rawMedianWindow.push(rawDistance);
  if (st.rawMedianWindow.length > 3) {
    st.rawMedianWindow.shift();
  }
  const medianDm =
    st.rawMedianWindow.length < 3
      ? rawDistance
      : [...st.rawMedianWindow].sort((a, b) => a - b)[1];

  if (!Number.isFinite(st.emaDistanceMeters) || st.emaDistanceTimeMs === 0) {
    st.emaDistanceMeters = medianDm;
    st.emaDistanceTimeMs = now;
    st.emaMaxMeters = medianDm;
  } else {
    const dtMs = Math.max(0, now - st.emaDistanceTimeMs);
    const alpha = dtMs > 0 ? 1 - Math.exp(-dtMs / profile.emaTauMs) : 0;
    st.emaDistanceMeters = st.emaDistanceMeters + alpha * (medianDm - st.emaDistanceMeters);
    st.emaDistanceTimeMs = now;
  }

  return {
    medianDm,
    emaDistance: st.emaDistanceMeters,
    effectiveSpeedMps: effSpeed,
    profile,
  };
}

function getSmoothedDistance(itemKey: string, rawDistance: number): number {
  const st = scenarioRuntimeMap.get(itemKey);
  if (!st || st.samples.length === 0) return rawDistance;
  let wSum = 0;
  let dSum = 0;
  for (let i = 0; i < st.samples.length; i++) {
    const s = st.samples[i];
    // Give newer samples and higher-accuracy fixes stronger weight
    const recencyFactor = 1 + i * 0.35;
    const w = recencyFactor / Math.pow(Math.max(5, s.accuracy || 12), 2);
    wSum += w;
    dSum += s.distance * w;
  }
  return wSum > 0 ? Math.round(dSum / wSum) : rawDistance;
}

// Memory + persisted tracking of notified status (true = inside & already notified for current stay, false = outside)
const proximityStateMap = new Map<string, boolean>();
const lastTransitionTimeMap = new Map<string, number>();

function loadProximityStateFromStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem(GEOFENCE_PROXIMITY_STATE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'boolean') {
          proximityStateMap.set(k, v);
        }
      }
    }
  } catch {
    // Ignore storage read errors
  }
}

function saveProximityStateToStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    const obj: Record<string, boolean> = {};
    proximityStateMap.forEach((val, key) => {
      obj[key] = val;
    });
    localStorage.setItem(GEOFENCE_PROXIMITY_STATE_KEY, JSON.stringify(obj));
  } catch {
    // Ignore storage write errors
  }
}

loadProximityStateFromStorage();

/**
 * Resets cached inside/outside proximity state for a specific location (or all items if omitted).
 * Must be called whenever a geofence is created, edited, radius-adjusted, or re-activated so that
 * if the user is currently inside the boundary, the alert triggers immediately (< 2s).
 */
export function resetGeofenceProximityState(itemId?: string): void {
  if (!itemId) {
    proximityStateMap.clear();
    lastTransitionTimeMap.clear();
    scenarioRuntimeMap.clear();
    pausedGeofenceItemsMap.clear();
    minimizedGeofenceMap.clear();
    setSubmarineSonarMuted(false);
  } else {
    const cleanId = itemId.replace(/^(loc_|rem_)/, '');
    pausedGeofenceItemsMap.delete(cleanId);
    minimizedGeofenceMap.delete(cleanId);
    const keysToDelete = [
      cleanId,
      `loc_${cleanId}`,
      `rem_${cleanId}`,
      `u10m_loc_${cleanId}`,
      `u10m_rem_${cleanId}`,
    ];
    for (const k of keysToDelete) {
      proximityStateMap.delete(k);
      lastTransitionTimeMap.delete(k);
      scenarioRuntimeMap.delete(k);
    }
  }
  saveProximityStateToStorage();

  if (typeof window !== 'undefined') {
    try {
      const bridge = (window as any).YaadGeofenceBridge;
      if (bridge && typeof bridge.resetGeofenceState === 'function') {
        bridge.resetGeofenceState(itemId || '');
      }
    } catch {
      // Ignore bridge error on web
    }
  }
}

/**
 * Marks a geofence item as acknowledged by the user ("توقف") for the current stay,
 * ensuring the alert process and submarine sonar stop completely.
 */
export function acknowledgeGeofenceAlert(
  itemId?: string,
  notifyNativeBridge: boolean = true
): void {
  setSubmarineSonarMuted(false);
  if (itemId) {
    const cleanId = itemId.replace(/^(loc_|rem_)/, '');
    const now = Date.now();
    pausedGeofenceItemsMap.delete(cleanId);
    setGeofenceMinimizedState(cleanId, false, notifyNativeBridge);
    proximityStateMap.set(`loc_${cleanId}`, true);
    proximityStateMap.set(`rem_${cleanId}`, true);
    proximityStateMap.set(`u10m_loc_${cleanId}`, true);
    proximityStateMap.set(`u10m_rem_${cleanId}`, true);
    lastTransitionTimeMap.set(`loc_${cleanId}`, now);
    lastTransitionTimeMap.set(`rem_${cleanId}`, now);

    for (const key of [`loc_${cleanId}`, `rem_${cleanId}`]) {
      const st = getOrCreateRuntimeState(key, now);
      st.acknowledgedUntilExit = true;
      st.enterAlertActive = false;
      st.enterCycleCompleted = true;
      st.exitCycleCompleted = true;
      st.sonarFinishedForCycle = true;
      st.cooldownUntilMs = now + GEOFENCE_ANTI_PINGPONG_COOLDOWN_MS;
      st.visual10sStartMs = 0;
      st.center5HzStartMs = 0;
      st.border5HzStartMs = 0;
      st.enterApproachStartMs = 0;
      st.exitMovingOutStartMs = 0;
    }

    saveProximityStateToStorage();
  }

  if (notifyNativeBridge && typeof window !== 'undefined') {
    try {
      const bridge = (window as any).YaadGeofenceBridge;
      if (bridge) {
        if (typeof bridge.acknowledgeGeofenceItem === 'function') {
          bridge.acknowledgeGeofenceItem(itemId || '');
        } else if (typeof bridge.stopGeofenceAlertAudio === 'function') {
          bridge.stopGeofenceAlertAudio();
        }
      }
    } catch {
      // Ignore bridge error on web
    }
  }
}

/**
 * Automatically turns off the in-app full-screen visual alert after 10 seconds for the current phase:
 * - If in `enter_approaching` or `exit_moving_out`, marks the 10s approach visual window as finished
 *   (while still allowing the 5% central zone arrival or outer border crossing stage to trigger when reached).
 * - If in the final `enter_center_*` or `exit_border_*` / `exit_crossed_*` stage, completes the cycle.
 */
export function expireInAppGeofenceVisualPhase(
  itemId?: string,
  phase?: GeofenceScenarioPhase
): void {
  if (!itemId) return;
  if (
    phase === 'enter_approaching' ||
    phase === 'exit_moving_out' ||
    phase === 'enter_center_5hz' ||
    phase === 'exit_border_5hz'
  ) {
    return;
  }
  const cleanId = itemId.replace(/^(loc_|rem_)/, '');
  for (const key of [`loc_${cleanId}`, `rem_${cleanId}`]) {
    const st = getOrCreateRuntimeState(key);
    st.enterCycleCompleted = true;
    st.exitCycleCompleted = true;
    st.enterAlertActive = false;
    st.sonarFinishedForCycle = true;
  }
}

/**
 * Snoozes a geofence alert when the user taps «الان نه (Snooze)».
 * - Stops sonar & vibration immediately and closes the full-screen alert for 5 minutes (300,000 ms).
 * - Keeps the geofence ENABLED and does NOT permanently lock the cycle, so after 5 minutes
 *   the geofence process automatically re-evaluates and re-emits the alert if still applicable!
 */
export function snoozeGeofenceAlertPassThrough(
  itemId?: string,
  durationMs: number = GEOFENCE_PASS_THROUGH_SNOOZE_MS,
  notifyNativeBridge: boolean = true
): void {
  setSubmarineSonarMuted(false);
  const now = Date.now();
  const safeDuration = Math.max(10_000, durationMs);

  if (itemId) {
    const cleanId = itemId.replace(/^(loc_|rem_)/, '');
    setGeofenceMinimizedState(cleanId, false, notifyNativeBridge);
    pausedGeofenceItemsMap.set(cleanId, {
      reason: 'snooze',
      pausedAt: now,
      resumeAt: now + safeDuration,
    });
    for (const key of [`loc_${cleanId}`, `rem_${cleanId}`]) {
      const st = getOrCreateRuntimeState(key, now);
      st.acknowledgedUntilExit = false;
      st.enterAlertActive = false;
      st.enterCycleCompleted = false;
      st.exitCycleCompleted = false;
      st.sonarFinishedForCycle = false;
      st.audioMutedForCycle = false;
      st.cooldownUntilMs = now + safeDuration;
      st.visual10sStartMs = 0;
      st.center5HzStartMs = 0;
      st.border5HzStartMs = 0;
      st.entryBannerStartMs = 0;
      st.enterApproachStartMs = 0;
      st.exitMovingOutStartMs = 0;
      st.consecutiveOutsideSamples = 0;
    }
    proximityStateMap.set(`loc_${cleanId}`, false);
    proximityStateMap.set(`rem_${cleanId}`, false);
    lastTransitionTimeMap.set(`loc_${cleanId}`, now);
    lastTransitionTimeMap.set(`rem_${cleanId}`, now);
    saveProximityStateToStorage();
  }

  if (notifyNativeBridge && typeof window !== 'undefined') {
    try {
      const bridge = (window as any).YaadGeofenceBridge;
      if (bridge) {
        if (typeof bridge.snoozeGeofenceItem === 'function') {
          bridge.snoozeGeofenceItem(itemId || '', safeDuration);
        } else if (typeof bridge.pauseGeofenceItemTemporarily === 'function') {
          bridge.pauseGeofenceItemTemporarily(itemId || '', safeDuration);
        } else if (typeof bridge.stopGeofenceAlertAudio === 'function') {
          bridge.stopGeofenceAlertAudio();
        }
      }
    } catch {
      // Ignore bridge error on web
    }
  }
}

interface PausedGeofenceEntry {
  reason: 'edit' | 'directions' | 'snooze';
  pausedAt: number;
  resumeAt: number;
}

const pausedGeofenceItemsMap = new Map<string, PausedGeofenceEntry>();

/**
 * Temporarily pauses geofence alert emission for an item when the user clicks
 * "ویرایش" (Edit), "مسیریابی" (Directions), or "الان نه (Snooze)".
 * - Does NOT disable the geofence or permanently acknowledge it.
 * - If no edit is saved or if navigation is canceled/returned from, the alert resumes automatically.
 */
export function pauseGeofenceAlertTemporarily(
  itemId?: string,
  reason: 'edit' | 'directions' | 'snooze' = 'edit'
): void {
  if (reason === 'snooze') {
    snoozeGeofenceAlertPassThrough(itemId, GEOFENCE_PASS_THROUGH_SNOOZE_MS);
    return;
  }
  const now = Date.now();
  const durationMs = 30 * 60_000; // 30 minutes pause while editing or navigating so locking screen never re-opens popup
  if (itemId) {
    const cleanId = itemId.replace(/^(loc_|rem_)/, '');
    pausedGeofenceItemsMap.set(cleanId, {
      reason,
      pausedAt: now,
      resumeAt: now + durationMs,
    });
  }

  if (typeof window !== 'undefined') {
    try {
      const bridge = (window as any).YaadGeofenceBridge;
      if (bridge) {
        if (typeof bridge.pauseGeofenceItemTemporarily === 'function') {
          bridge.pauseGeofenceItemTemporarily(itemId || '', durationMs);
        } else if (typeof bridge.stopGeofenceAlertAudio === 'function') {
          bridge.stopGeofenceAlertAudio();
        }
      }
    } catch {
      // Ignore bridge error on web
    }
  }
}

/**
 * Resumes any temporarily paused geofence alert(s) (e.g., when closing the Edit modal without
 * disabling the geofence, or when returning from / canceling Google Maps navigation).
 * Note: 'snooze' entries are NOT auto-resumed on modal close; they wait for their 5-minute timer.
 */
export function resumeGeofenceAlertFromPause(
  itemId?: string,
  reasonFilter?: 'edit' | 'directions'
): boolean {
  const now = Date.now();
  let resumedAny = false;

  const refreshRuntimeTimers = (cleanId: string) => {
    for (const key of [`loc_${cleanId}`, `rem_${cleanId}`]) {
      const st = scenarioRuntimeMap.get(key);
      if (st) {
        st.lastSignificantMoveMs = now;
        st.lastInwardMoveMs = now;
        if (st.lastOutwardMoveMs > 0) {
          st.lastOutwardMoveMs = now;
        }
      }
    }
  };

  if (itemId) {
    const cleanId = itemId.replace(/^(loc_|rem_)/, '');
    const existing = pausedGeofenceItemsMap.get(cleanId);
    if (existing && existing.reason !== 'snooze' && (!reasonFilter || existing.reason === reasonFilter)) {
      pausedGeofenceItemsMap.delete(cleanId);
      refreshRuntimeTimers(cleanId);
      resumedAny = true;
    }
  } else {
    for (const [cleanId, entry] of Array.from(pausedGeofenceItemsMap.entries())) {
      if (entry.reason === 'snooze') continue;
      if (!reasonFilter || entry.reason === reasonFilter) {
        if (reasonFilter === 'directions' && now - entry.pausedAt < 1200) {
          continue;
        }
        pausedGeofenceItemsMap.delete(cleanId);
        refreshRuntimeTimers(cleanId);
        resumedAny = true;
      }
    }
  }

  if (resumedAny && typeof window !== 'undefined') {
    try {
      const bridge = (window as any).YaadGeofenceBridge;
      if (bridge && typeof bridge.resumeGeofenceItemFromPause === 'function') {
        bridge.resumeGeofenceItemFromPause(itemId || '');
      }
    } catch {
      // Ignore bridge error on web
    }
  }

  return resumedAny;
}

function isGeofenceItemTemporarilyPaused(rawId: string, now: number = Date.now()): boolean {
  const cleanId = rawId.replace(/^(loc_|rem_)/, '');
  const entry = pausedGeofenceItemsMap.get(cleanId);
  if (!entry) return false;
  if (now >= entry.resumeAt) {
    const wasSnooze = entry.reason === 'snooze';
    pausedGeofenceItemsMap.delete(cleanId);
    for (const key of [`loc_${cleanId}`, `rem_${cleanId}`]) {
      const st = scenarioRuntimeMap.get(key);
      if (st) {
        st.cooldownUntilMs = 0;
        st.acknowledgedUntilExit = false;
        st.lastSignificantMoveMs = now;
        st.lastInwardMoveMs = now;
        if (wasSnooze) {
          // Reset cycle and timers after 5-minute snooze so the alert & sonar immediately re-emit!
          st.enterAlertActive = false;
          st.enterCycleCompleted = false;
          st.exitCycleCompleted = false;
          st.sonarFinishedForCycle = false;
          st.audioMutedForCycle = false;
          st.wasInsideBorder = false;
          st.center5HzStartMs = 0;
          st.border5HzStartMs = 0;
          st.entryBannerStartMs = 0;
          st.enterApproachStartMs = 0;
          st.exitMovingOutStartMs = 0;
          st.visual10sStartMs = 0;
          st.wasInsideForExit = true;
          st.armedForExit = true;
          st.bothDirectionLock = 'outward';
          st.lastOutwardMoveMs = now;
          st.exitGpsAntiBounceUntilMs = 0;
          st.exitBoundaryOscillationCount = 0;
        } else if (st.lastOutwardMoveMs > 0) {
          st.lastOutwardMoveMs = now;
        }
      }
    }
    return false;
  }
  return true;
}

/**
 * Mutes or unmutes the submarine sonar audio for the current alert cycle ("قطع صدا" / "وصل صدا")
 * across BOTH the 10-times/min (6s) normal stage AND the 5 Hz (200ms) target stage.
 */
export function toggleGeofenceAlertMute(itemId?: string, forceMute?: boolean): boolean {
  let nextMute = true;
  if (itemId) {
    const cleanId = itemId.replace(/^(loc_|rem_)/, '');
    const locSt = getOrCreateRuntimeState(`loc_${cleanId}`);
    const remSt = getOrCreateRuntimeState(`rem_${cleanId}`);
    nextMute = typeof forceMute === 'boolean' ? forceMute : !locSt.audioMutedForCycle;
    locSt.audioMutedForCycle = nextMute;
    remSt.audioMutedForCycle = nextMute;
  } else {
    for (const st of scenarioRuntimeMap.values()) {
      nextMute = typeof forceMute === 'boolean' ? forceMute : !st.audioMutedForCycle;
      st.audioMutedForCycle = nextMute;
    }
  }

  // Immediately mute/unmute Web Audio + Native Bridge for both 6000ms (10/min) and 200ms (5 Hz) sonar
  setSubmarineSonarMuted(nextMute);

  if (typeof window !== 'undefined') {
    try {
      const bridge = (window as any).YaadGeofenceBridge;
      if (bridge) {
        if (typeof bridge.setGeofenceAudioMuted === 'function') {
          bridge.setGeofenceAudioMuted(itemId || '', nextMute);
        } else if (nextMute && typeof bridge.stopGeofenceAlertAudio === 'function') {
          bridge.stopGeofenceAlertAudio();
        }
      }
    } catch {
      // Ignore bridge error on web
    }
  }

  return nextMute;
}

/**
 * Evaluates a single SavedLocation or Reminder geofence item against 'enter' or 'exit'
 * with Fuzzy Boundary Hysteresis, <= 1s immediate activation, permanent sonar stop after 10s of 5 Hz,
 * 10s auto-off for in-app full-screen visual alerts, and strict directional discrimination.
 */
function evaluateSingleItemScenario(params: {
  itemKey: string;
  targetType: 'location' | 'reminder';
  targetId: string;
  title: string;
  description?: string;
  latitude: number;
  longitude: number;
  radius: number;
  triggerOn: 'enter' | 'exit';
  playAudio: boolean;
  distance: number;
  accuracy: number;
  speed?: number | null;
  now: number;
  isEn: boolean;
}): EvaluatedGeofenceAlertItem | null {
  const {
    itemKey,
    targetType,
    targetId,
    title,
    description,
    latitude,
    longitude,
    radius,
    triggerOn: rawTriggerOn,
    playAudio,
    distance: rawDistance,
    accuracy,
    speed,
    now,
    isEn,
  } = params;

  const triggerOn: 'enter' | 'exit' = rawTriggerOn === 'exit' ? 'exit' : 'enter';
  const safeRadius = Math.max(20, radius || 100);
  const st = getOrCreateRuntimeState(itemKey, now);
  const trend = recordAndAnalyzeDistanceTrend(itemKey, rawDistance, now, accuracy);
  const speedAndEma = updateRuntimeSpeedAndMedianEma(st, rawDistance, accuracy, now, speed);
  const distance = Math.round(
    speedAndEma.profile.isSlowOrStill ? speedAndEma.medianDm : rawDistance
  );
  const legacySmoothed = getSmoothedDistance(itemKey, rawDistance);

  // Physical 10% central zone width (min 40m, capped at 35% R) — used ONLY for 'enter'
  const centerZoneMeters = computeFivePercentZoneMeters(safeRadius);

  // Speed-harmonized boundary hysteresis margin (5m .. 25m, <= 25% R) & deadband
  const fuzzyHysteresisMeters = Math.min(
    25,
    Math.min(Math.round(safeRadius * 0.25), Math.max(5, Math.round((accuracy || 15) * 0.75)))
  );
  const antiPingPongDeadbandMeters = Math.max(
    fuzzyHysteresisMeters,
    Math.min(80, Math.round(safeRadius * 0.15))
  );

  // Only increment sample counters when a genuinely new GPS fix or >=900ms tick arrives
  // so 500ms UI countdown ticks never artificially inflate consecutive sample counts
  const isDistinctEvalTick =
    Number.isNaN(st.lastEvaluatedDistanceMeters) ||
    Math.abs(rawDistance - st.lastEvaluatedDistanceMeters) >= 1 ||
    now - st.lastEvaluatedSampleTimeMs >= 900;

  if (triggerOn === 'enter' && isDistinctEvalTick) {
    st.lastEvaluatedDistanceMeters = rawDistance;
    st.lastEvaluatedSampleTimeMs = now;
  }

  // Track consecutive inside/outside samples to debounce signal drops
  if (distance > safeRadius + antiPingPongDeadbandMeters) {
    if (isDistinctEvalTick) {
      st.consecutiveOutsideSamples += 1;
    }
    st.consecutiveInsideSamples = 0;
  } else if (distance <= safeRadius) {
    if (isDistinctEvalTick) {
      st.consecutiveInsideSamples += 1;
    }
    st.consecutiveOutsideSamples = 0;
  }

  // Respect active pass-through Snooze / Cooldown window
  if (st.cooldownUntilMs > now && st.acknowledgedUntilExit) {
    return null;
  }

  // Once the 10s 5Hz stage finishes (`sonarFinishedForCycle`), 6s sonar is permanently cut off for the rest of this cycle
  const effectivePlayAudio = playAudio && !st.audioMutedForCycle && !st.sonarFinishedForCycle;

  // Concise core status phrases matching user specification
  const msgEntered = isEn ? `Entered «${title}»` : `ورود به حصار مکانی «${title}»`;
  const msgCenter = isEn
    ? `Arrived at central zone of «${title}»`
    : `رسیدن به ناحیه مرکزی «${title}»`;
  const msgExiting = isEn ? `Exiting «${title}»` : `در حال خروج از حصار مکانی «${title}»`;
  const msgExited = isEn ? `Exited geofence «${title}»` : `خارج شدن از حصار مکانی «${title}»`;

  const directionConfirmMeters = Math.max(4, Math.min(12, Math.round((accuracy || 12) * 0.35)));

  if (st.startedOutsideBoundary === undefined) {
    st.startedOutsideBoundary = distance > safeRadius;
  }
  if (triggerOn === 'enter') {
    if (distance <= safeRadius + antiPingPongDeadbandMeters) {
      if (distance < st.minDistanceReachedInside) {
        st.minDistanceReachedInside = distance;
      }
      if (distance > st.maxDistanceInApproach) {
        st.maxDistanceInApproach = distance;
      }
    } else if (st.consecutiveOutsideSamples >= 3) {
      st.startedOutsideBoundary = true;
      st.maxDistanceInApproach = distance;
    }
  }

  // True when user is moving away from their closest point to the center (exiting)
  const isConfirmedExitingDirection =
    trend === 'outward' ||
    (Number.isFinite(st.minDistanceReachedInside) &&
      distance >= st.minDistanceReachedInside + directionConfirmMeters &&
      st.lastOutwardMoveMs >= st.lastInwardMoveMs &&
      now - st.lastOutwardMoveMs <= 60_000);

  // =========================================================================
  // SCENARIO 1: ENTER ONLY ('enter')
  // Keeps the 10% central zone (`centerZoneMeters`), enhanced with speed-adaptive EMA & deadband reset.
  // =========================================================================
  if (triggerOn === 'enter') {
    const enterResetSamplesNeeded = !st.isStationaryMode && st.effectiveSpeedMps > 7.0 ? 2 : 3;
    const enterEvalDist = !st.isStationaryMode && st.effectiveSpeedMps > 7.0 ? distance : legacySmoothed;
    if (enterEvalDist > safeRadius + antiPingPongDeadbandMeters) {
      if (st.consecutiveOutsideSamples >= enterResetSamplesNeeded) {
        st.enterAlertActive = false;
        st.enterCycleCompleted = false;
        st.wasInsideBorder = false;
        st.center5HzStartMs = 0;
        st.entryBannerStartMs = 0;
        st.enterApproachStartMs = 0;
        st.visual10sStartMs = 0;
        st.visualCrossingType = null;
        st.audioMutedForCycle = false;
        st.sonarFinishedForCycle = false;
        st.acknowledgedUntilExit = false;
        st.cooldownUntilMs = 0;
        st.minDistanceReachedInside = Number.POSITIVE_INFINITY;
        st.maxDistanceInApproach = enterEvalDist;
        st.startedOutsideBoundary = true;
        setGeofenceMinimizedState(targetId, false, false);
      }
      return null;
    }

    if (st.acknowledgedUntilExit || st.enterCycleCompleted) {
      return null;
    }

    // Only start a new Enter alert when inside the geofence radius (d <= safeRadius),
    // or keep it active if already latched (`st.enterAlertActive === true`) within the anti-ping-pong deadband.
    if (distance > safeRadius && !st.enterAlertActive) {
      return null;
    }

    // Latch Enter alert immediately upon entering / being inside the geofence radius
    if (distance <= safeRadius) {
      st.enterAlertActive = true;
      if (!st.wasInsideBorder) {
        st.wasInsideBorder = true;
        st.entryBannerStartMs = now;
      }
    }

    let entryToastMessage: string | undefined = undefined;
    let entryToastRemainingSeconds: number | undefined = undefined;
    if (st.entryBannerStartMs > 0) {
      const elapsedEntryBanner = now - st.entryBannerStartMs;
      if (elapsedEntryBanner < 10_000) {
        entryToastMessage = msgEntered;
        entryToastRemainingSeconds = Math.max(1, Math.ceil((10_000 - elapsedEntryBanner) / 1000));
      } else {
        st.entryBannerStartMs = 0;
      }
    }

    // 1A. Central 5% target zone (d <= max(5% R, 15m)):
    // - 0..10s: 5 Hz sonar + visual arrival message
    // - Next 10s: audio cuts off, visual arrival message continues for 10 seconds
    // - After 10s visual window: all alerts stop and cycle completes
    if (distance <= centerZoneMeters || st.center5HzStartMs > 0) {
      st.enterAlertActive = true;
      if (st.center5HzStartMs === 0) {
        st.center5HzStartMs = now;
      }
      const elapsedCenter = now - st.center5HzStartMs;

      if (elapsedCenter < 10_000) {
        const remSec = Math.max(1, Math.ceil((10_000 - elapsedCenter) / 1000));
        return {
          id: `alert_${itemKey}`,
          targetType,
          targetId,
          locationTitle: title,
          description,
          triggerType: 'arrived_under_10m',
          triggerOn: 'enter',
          scenarioPhase: 'enter_center_5hz',
          sonarMode: 'enter',
          sonarIntervalMs: 200,
          isVisualOnly: false,
          visualBannerMessage: msgCenter,
          phaseRemainingSeconds: remSec,
          entryToastMessage,
          entryToastRemainingSeconds,
          isAudioMuted: st.audioMutedForCycle,
          initialDistance: distance,
          targetDistance: distance,
          radius: safeRadius,
          latitude,
          longitude,
          playAudio: effectivePlayAudio,
        };
      }

      st.sonarFinishedForCycle = true;

      if (st.visual10sStartMs === 0) {
        st.visual10sStartMs = now;
      }
      const elapsedVisual = now - st.visual10sStartMs;

      // Visual-only continuation window for 10 seconds (`GEOFENCE_IN_APP_VISUAL_MAX_MS = 10_000`)
      if (elapsedVisual < GEOFENCE_IN_APP_VISUAL_MAX_MS) {
        const remVisualSec = Math.max(
          1,
          Math.ceil((GEOFENCE_IN_APP_VISUAL_MAX_MS - elapsedVisual) / 1000)
        );
        return {
          id: `alert_${itemKey}`,
          targetType,
          targetId,
          locationTitle: title,
          description,
          triggerType: 'arrived_under_10m',
          triggerOn: 'enter',
          scenarioPhase: 'enter_center_visual_10s',
          sonarMode: 'enter',
          sonarIntervalMs: 6000,
          isVisualOnly: true,
          visualBannerMessage: msgCenter,
          phaseRemainingSeconds: remVisualSec,
          entryToastMessage,
          entryToastRemainingSeconds,
          isAudioMuted: st.audioMutedForCycle,
          initialDistance: distance,
          targetDistance: distance,
          radius: safeRadius,
          latitude,
          longitude,
          playAudio: false,
        };
      }

      // 10 seconds of visual central-zone alert have completed -> stop all alerts for this cycle!
      st.enterCycleCompleted = true;
      st.enterAlertActive = false;
      st.sonarFinishedForCycle = true;
      setGeofenceMinimizedState(targetId, false, false);
      if (typeof window !== 'undefined') {
        try {
          const bridge = (window as any).YaadGeofenceBridge;
          if (bridge && typeof bridge.acknowledgeGeofenceItem === 'function') {
            bridge.acknowledgeGeofenceItem(targetId);
          }
        } catch {
          // ignore
        }
      }
      return null;
    }

    // 1B. Inside geofence boundary outside the central zone Rc (Rc < d <= R, or latched within deadband):
    // Keep approach alert and 6s sonar active continuously until arrival at Rc (matched with native ZoneDetector).
    if (!st.sonarFinishedForCycle && (st.enterAlertActive || distance <= safeRadius)) {
      st.enterAlertActive = true;
      if (st.enterApproachStartMs === 0) {
        st.enterApproachStartMs = now;
      }

      return {
        id: `alert_${itemKey}`,
        targetType,
        targetId,
        locationTitle: title,
        description,
        triggerType: 'enter',
        triggerOn: 'enter',
        scenarioPhase: 'enter_approaching',
        sonarMode: 'enter',
        sonarIntervalMs: 6000,
        isVisualOnly: false,
        visualBannerMessage: entryToastMessage || msgEntered,
        entryToastMessage,
        entryToastRemainingSeconds,
        isAudioMuted: st.audioMutedForCycle,
        initialDistance: distance,
        targetDistance: distance,
        radius: safeRadius,
        latitude,
        longitude,
        playAudio: effectivePlayAudio,
      };
    }

    return null;
  }

  // =========================================================================
  // SCENARIO 2: EXIT ONLY ('exit')
  // Central 10% zone is NOT used in Exit equations!
  // 1. Arms whenever user is inside boundary (d <= R).
  // 2. In [0 .. 0.85 * R): silent (no premature alert inside interior).
  // 3. In outer 15% warning zone [0.85 * R .. R]: starts `exit_moving_out` ONLY when confirmed moving outward
  //    with speed-adaptive timing & stationary drift protection.
  // 4. Upon crossing outside boundary (d >= R + hb) while armed or active:
  //    - Plays 5 Hz Exit sonar for 10s (`exit_border_5hz`), then 10s visual banner (`exit_crossed_visual_10s`).
  //    - Works reliably even at 100+ km/h highway speeds when passing 0.85 * R quickly.
  // =========================================================================
  const exitWarnMeters = safeRadius * 0.85;
  const safeAcc = Math.max(5, Math.min(100, accuracy || 15));
  const exitConfirmMs = safeAcc > 15 ? speedAndEma.profile.confirmPoorMs : speedAndEma.profile.confirmGoodMs;

  if (distance <= safeRadius - fuzzyHysteresisMeters && !st.wasInsideForExit) {
    st.wasInsideForExit = true;
    st.armedForExit = true;
    st.exitCycleCompleted = false;
    st.lastBoundaryInMs = now;
    st.minDistanceReachedInside = distance;
    st.emaMaxMeters = speedAndEma.emaDistance;
  } else if (distance <= safeRadius && rawDistance <= safeRadius + fuzzyHysteresisMeters && !st.exitCycleCompleted && !st.armedForExit && !st.wasInsideForExit) {
    st.wasInsideForExit = true;
    st.armedForExit = true;
    st.lastBoundaryInMs = now;
    st.minDistanceReachedInside = distance;
    st.emaMaxMeters = speedAndEma.emaDistance;
  }

  // Re-enter cleanly from outside after a completed exit cycle
  if (st.exitCycleCompleted && distance <= safeRadius - fuzzyHysteresisMeters) {
    st.exitCycleCompleted = false;
    st.sonarFinishedForCycle = false;
    st.audioMutedForCycle = false;
    st.acknowledgedUntilExit = false;
    st.wasInsideForExit = true;
    st.armedForExit = true;
    st.bothDirectionLock = null;
    st.exitMovingOutStartMs = 0;
    st.border5HzStartMs = 0;
    st.visual10sStartMs = 0;
    st.lastBoundaryInMs = now;
    st.minDistanceReachedInside = distance;
    st.emaMaxMeters = speedAndEma.emaDistance;
  }

  if (
    distance > safeRadius + antiPingPongDeadbandMeters &&
    st.consecutiveOutsideSamples >= (!st.isStationaryMode && st.effectiveSpeedMps > 7.0 ? 2 : 3) &&
    st.exitCycleCompleted
  ) {
    st.wasInsideForExit = false;
    st.armedForExit = false;
    st.bothDirectionLock = null;
    st.exitMovingOutStartMs = 0;
    st.border5HzStartMs = 0;
    st.minDistanceReachedInside = Number.POSITIVE_INFINITY;
  }

  if (distance > safeRadius && !st.armedForExit && !st.wasInsideForExit && st.border5HzStartMs === 0) {
    if (isDistinctEvalTick) {
      st.lastEvaluatedDistanceMeters = rawDistance;
      st.lastEvaluatedSampleTimeMs = now;
    }
    return null;
  }

  // Update conservative inside anchor for Exit mode (no central 10% zone needed)
  if (distance <= safeRadius && st.bothDirectionLock !== 'outward' && st.border5HzStartMs === 0) {
    if (!Number.isFinite(st.minDistanceReachedInside)) {
      st.minDistanceReachedInside = speedAndEma.emaDistance;
    } else if (safeAcc <= 25 && distance < exitWarnMeters - fuzzyHysteresisMeters) {
      st.minDistanceReachedInside = Math.min(st.minDistanceReachedInside, distance);
    } else if (
      safeAcc <= 20 &&
      !st.isStationaryMode &&
      st.effectiveSpeedMps >= 0.5 &&
      speedAndEma.emaDistance < st.minDistanceReachedInside
    ) {
      st.minDistanceReachedInside = speedAndEma.emaDistance;
    }
  }

  // Check boundary crossing FIRST so high-speed 100+ km/h exits are never blocked by the warning-zone guard
  const canLeaveBoundary =
    (st.armedForExit || st.wasInsideForExit) &&
    (now - st.lastBoundaryInMs >= speedAndEma.profile.minDwellMs || st.bothDirectionLock === 'outward');

  if (
    canLeaveBoundary &&
    distance >= safeRadius + fuzzyHysteresisMeters &&
    !st.exitCycleCompleted &&
    !st.acknowledgedUntilExit &&
    st.border5HzStartMs === 0
  ) {
    if (isDistinctEvalTick) {
      if (st.exitBoundaryOutConsecutive === 0) {
        st.exitBoundaryOutFirstMs = now;
      }
      st.exitBoundaryOutConsecutive += 1;
    }
  } else if (st.border5HzStartMs === 0) {
    st.exitBoundaryOutConsecutive = 0;
    st.exitBoundaryOutFirstMs = 0;
  }

  const confirmedBoundaryCrossed =
    st.border5HzStartMs > 0 ||
    (st.exitBoundaryOutConsecutive >= 2 && now - st.exitBoundaryOutFirstMs >= exitConfirmMs);

  if (
    !st.exitCycleCompleted &&
    !st.acknowledgedUntilExit &&
    confirmedBoundaryCrossed &&
    (st.armedForExit || st.wasInsideForExit || st.border5HzStartMs > 0)
  ) {
    st.bothDirectionLock = 'outward';
    st.lastExitAlertEmittedMs = now;
    if (st.border5HzStartMs === 0) {
      st.border5HzStartMs = now;
    }
    const elapsedExit = now - st.border5HzStartMs;

    if (elapsedExit < 10_000) {
      const remSec = Math.max(1, Math.ceil((10_000 - elapsedExit) / 1000));
      return {
        id: `alert_${itemKey}`,
        targetType,
        targetId,
        locationTitle: title,
        description,
        triggerType: 'exit',
        triggerOn: 'exit',
        scenarioPhase: 'exit_border_5hz',
        sonarMode: 'exit',
        sonarIntervalMs: 200,
        isVisualOnly: false,
        visualBannerMessage: msgExited,
        phaseRemainingSeconds: remSec,
        isAudioMuted: st.audioMutedForCycle,
        initialDistance: distance,
        targetDistance: 0,
        radius: safeRadius,
        latitude,
        longitude,
        playAudio: effectivePlayAudio,
      };
    }

    st.sonarFinishedForCycle = true;

    if (st.visual10sStartMs === 0) {
      st.visual10sStartMs = now;
    }
    const elapsedVisual = now - st.visual10sStartMs;

    if (elapsedVisual < GEOFENCE_IN_APP_VISUAL_MAX_MS) {
      const remVisualSec = Math.max(
        1,
        Math.ceil((GEOFENCE_IN_APP_VISUAL_MAX_MS - elapsedVisual) / 1000)
      );
      return {
        id: `alert_${itemKey}`,
        targetType,
        targetId,
        locationTitle: title,
        description,
        triggerType: 'exit',
        triggerOn: 'exit',
        scenarioPhase: 'exit_crossed_visual_10s',
        sonarMode: 'exit',
        sonarIntervalMs: 6000,
        isVisualOnly: true,
        visualBannerMessage: msgExited,
        phaseRemainingSeconds: remVisualSec,
        isAudioMuted: st.audioMutedForCycle,
        initialDistance: distance,
        targetDistance: 0,
        radius: safeRadius,
        latitude,
        longitude,
        playAudio: false,
      };
    }

    // 10 seconds of visual exit banner have completed -> finish operation until re-entry!
    st.exitCycleCompleted = true;
    st.sonarFinishedForCycle = true;
    st.bothDirectionLock = null;
    st.armedForExit = false;
    st.wasInsideForExit = false;
    st.exitBoundaryOutConsecutive = 0;
    st.exitBoundaryOutFirstMs = 0;
    setGeofenceMinimizedState(targetId, false, false);
    if (typeof window !== 'undefined') {
      try {
        const bridge = (window as any).YaadGeofenceBridge;
        if (bridge && typeof bridge.acknowledgeGeofenceItem === 'function') {
          bridge.acknowledgeGeofenceItem(targetId);
        }
      } catch {
        // ignore
      }
    }
    return null;
  }

  const exitGuard = evaluateExitFivePercentAndGpsJitterGuard({
    st,
    rawDistance,
    smoothedDistance: distance,
    safeRadius,
    centerZoneMeters,
    accuracy,
    trend,
    isConfirmedExitingDirection,
    now,
    emaDistance: speedAndEma.emaDistance,
    effectiveSpeedMps: speedAndEma.effectiveSpeedMps,
    isSlowOrStill: speedAndEma.profile.isSlowOrStill,
    confirmMs: exitConfirmMs,
    cancelBlockMs: speedAndEma.profile.cancelBlockMs,
    hysteresisMeters: fuzzyHysteresisMeters,
  });

  if (exitGuard.suppressAlert) {
    return null;
  }

  // 2B. Outer 15% warning zone (0.85 * R <= d <= R):
  if (distance <= safeRadius && st.border5HzStartMs === 0) {
    st.wasInsideForExit = true;
    st.armedForExit = true;
    st.exitCycleCompleted = false;

    if (st.acknowledgedUntilExit || st.sonarFinishedForCycle) {
      return null;
    }

    st.bothDirectionLock = 'outward';
    st.lastExitAlertEmittedMs = now;
    if (st.exitMovingOutStartMs === 0) {
      st.exitMovingOutStartMs = now;
    }
    const distToBorder = Math.max(0, safeRadius - distance);

    return {
      id: `alert_${itemKey}`,
      targetType,
      targetId,
      locationTitle: title,
      description,
      triggerType: 'exit',
      triggerOn: 'exit',
      scenarioPhase: 'exit_moving_out',
      sonarMode: 'exit',
      sonarIntervalMs: 6000,
      isVisualOnly: false,
      visualBannerMessage: msgExiting,
      isAudioMuted: st.audioMutedForCycle,
      initialDistance: distance,
      targetDistance: distToBorder,
      radius: safeRadius,
      latitude,
      longitude,
      playAudio: effectivePlayAudio,
    };
  }

  return null;
}

/**
 * Outer 15%-to-Boundary Exit Guard & Speed-Adaptive Indoor/Stationary Anti-Drift Filter:
 * - Central 10% zone (`centerZoneMeters`) is intentionally EXCLUDED from all Exit decisions.
 * - Remains completely silent while d < 0.85 * R.
 * - In [0.85 * R .. R], starts Exit warning only when outward displacement & movement speed confirm real exiting.
 * - Cancels cleanly with speed-adaptive cooldown when turning back inside (< 0.85 * R - hb or significant inward drop).
 */
export function evaluateExitFivePercentAndGpsJitterGuard(params: {
  st: ItemScenarioRuntimeState;
  rawDistance: number;
  smoothedDistance: number;
  safeRadius: number;
  centerZoneMeters: number;
  accuracy: number;
  trend: 'inward' | 'outward' | 'stationary';
  isConfirmedExitingDirection: boolean;
  now: number;
  emaDistance?: number;
  effectiveSpeedMps?: number;
  isSlowOrStill?: boolean;
  confirmMs?: number;
  cancelBlockMs?: number;
  hysteresisMeters?: number;
}): { suppressAlert: boolean } {
  const {
    st,
    rawDistance,
    smoothedDistance,
    safeRadius,
    accuracy,
    now,
    emaDistance = smoothedDistance,
    effectiveSpeedMps = st.effectiveSpeedMps || 0,
    isSlowOrStill = st.isStationaryMode || effectiveSpeedMps < 2.5,
    confirmMs,
    cancelBlockMs,
    hysteresisMeters,
  } = params;

  const safeAcc = Math.max(5, Math.min(100, accuracy || 15));
  const exitWarnMeters = safeRadius * 0.85;
  const hb =
    hysteresisMeters ??
    Math.min(25, Math.min(Math.round(safeRadius * 0.25), Math.max(5, Math.round(safeAcc * 0.75))));
  const reqConfirmMs = confirmMs ?? (safeAcc > 15 ? 7000 : 3000);
  const baseBlockMs = cancelBlockMs ?? 120_000;

  const isNewSampleTick =
    Number.isNaN(st.lastEvaluatedDistanceMeters) ||
    Math.abs(rawDistance - st.lastEvaluatedDistanceMeters) >= 1 ||
    now - st.lastEvaluatedSampleTimeMs >= 950;

  if (isNewSampleTick) {
    st.lastEvaluatedDistanceMeters = rawDistance;
    st.lastEvaluatedSampleTimeMs = now;
  }

  const isAlreadyLatchedOutward =
    st.bothDirectionLock === 'outward' || st.border5HzStartMs > 0;

  // 1. Cooldown guard after recent turn-back cancellation (does NOT block actual d > R crossing handled above)
  if (!isAlreadyLatchedOutward && now < st.exitGpsAntiBounceUntilMs && smoothedDistance <= safeRadius) {
    st.consecutiveExitOutwardSamples = 0;
    st.exitStartFirstMs = 0;
    return { suppressAlert: true };
  }

  // 2. While Exit ACTIVE (`bothDirectionLock === 'outward'`) and not yet crossed: handle turn-back cancellation
  if (isAlreadyLatchedOutward && st.border5HzStartMs === 0 && smoothedDistance <= safeRadius) {
    if (!Number.isFinite(st.emaMaxMeters) || emaDistance > st.emaMaxMeters) {
      st.emaMaxMeters = emaDistance;
    }
    const backThresh = Math.max(20, 2.0 * safeAcc, 0.03 * safeRadius);
    const dropFromMax = st.emaMaxMeters - emaDistance;
    const tbCond = smoothedDistance < exitWarnMeters - hb || dropFromMax >= backThresh;

    if (tbCond) {
      if (isNewSampleTick) {
        if (st.exitCancelConsecutive === 0) st.exitCancelFirstMs = now;
        st.exitCancelConsecutive += 1;
      }
      if (st.exitCancelConsecutive >= 2 && now - st.exitCancelFirstMs >= reqConfirmMs) {
        st.bothDirectionLock = null;
        st.exitMovingOutStartMs = 0;
        st.consecutiveExitOutwardSamples = 0;
        st.exitStartFirstMs = 0;
        st.exitCancelConsecutive = 0;
        st.exitCancelFirstMs = 0;
        st.minDistanceReachedInside = emaDistance;
        st.emaMaxMeters = emaDistance;
        st.exitBoundaryOscillationCount = Math.min(3, st.exitBoundaryOscillationCount + 1);
        const shift = Math.min(3, st.exitBoundaryOscillationCount - 1);
        st.exitGpsAntiBounceUntilMs = Math.max(st.exitGpsAntiBounceUntilMs, now + baseBlockMs * (1 << shift));
        return { suppressAlert: true };
      }
    } else {
      st.exitCancelConsecutive = 0;
      st.exitCancelFirstMs = 0;
    }
    return { suppressAlert: false };
  }

  // 3. Silent interior (d < 0.85 * R): never trigger exit warning here
  if (!isAlreadyLatchedOutward && smoothedDistance < exitWarnMeters) {
    st.consecutiveExitOutwardSamples = 0;
    st.exitStartFirstMs = 0;
    return { suppressAlert: true };
  }

  // 4. Outer 15% warning zone [0.85 * R .. R]: confirm real outward motion + stationary drift protection
  if (!isAlreadyLatchedOutward && smoothedDistance <= safeRadius) {
    const outwardDispThresh = Math.max(15, Math.min(60, 0.02 * safeRadius), 1.8 * safeAcc);
    const dispFromAnchor = Number.isFinite(st.minDistanceReachedInside)
      ? (isSlowOrStill ? emaDistance : smoothedDistance) - st.minDistanceReachedInside
      : 0;
    const movingOk =
      !isSlowOrStill ||
      effectiveSpeedMps >= 0.85 ||
      (!st.isStationaryMode && dispFromAnchor >= Math.max(40, 2.5 * safeAcc));

    if (dispFromAnchor >= outwardDispThresh && movingOk) {
      if (isNewSampleTick) {
        if (st.consecutiveExitOutwardSamples === 0) {
          st.exitStartFirstMs = now;
        }
        st.consecutiveExitOutwardSamples += 1;
      }
      if (st.consecutiveExitOutwardSamples >= 2 && now - st.exitStartFirstMs >= reqConfirmMs) {
        st.emaMaxMeters = emaDistance;
        st.exitCancelConsecutive = 0;
        st.exitCancelFirstMs = 0;
        return { suppressAlert: false };
      }
    } else {
      st.consecutiveExitOutwardSamples = 0;
      st.exitStartFirstMs = 0;
    }
    return { suppressAlert: true };
  }

  return { suppressAlert: false };
}

/**
 * Evaluates active Saved Locations (`locations`) AND location-enabled Reminders (`reminders`)
 * across both scenarios ('enter' and 'exit') in <= 1s.
 */
export function evaluateAllActiveGeofenceScenarios(
  userPos: { latitude: number; longitude: number; accuracy?: number; speed?: number | null },
  reminders: Reminder[] = [],
  locations: SavedLocation[] = [],
  language: 'fa' | 'en' = 'fa',
  formatLocTitle?: (title: string, lang?: 'fa' | 'en') => string
): EvaluatedGeofenceAlertItem[] {
  const now = Date.now();
  const isEn = language === 'en';
  const activeAlerts: EvaluatedGeofenceAlertItem[] = [];
  const accuracy = userPos.accuracy && userPos.accuracy > 0 ? userPos.accuracy : 12;
  const speed = typeof userPos.speed === 'number' && Number.isFinite(userPos.speed) ? userPos.speed : null;

  for (const loc of locations) {
    if (loc.deletedAt || !loc.geofence || !loc.geofence.enabled) continue;
    if (isGeofenceItemTemporarilyPaused(loc.id, now)) continue;
    const distance = calculateHaversineDistance(
      userPos.latitude,
      userPos.longitude,
      loc.latitude,
      loc.longitude
    );
    const displayTitle = formatLocTitle ? formatLocTitle(loc.title, language) : loc.title;
    const normalizedTriggerOn: 'enter' | 'exit' =
      loc.geofence.triggerOn === 'exit' ? 'exit' : 'enter';

    const evaluated = evaluateSingleItemScenario({
      itemKey: `loc_${loc.id}`,
      targetType: 'location',
      targetId: loc.id,
      title: displayTitle,
      description: loc.description || loc.geofence.customMessage,
      latitude: loc.latitude,
      longitude: loc.longitude,
      radius: loc.geofence.radius || 100,
      triggerOn: normalizedTriggerOn,
      playAudio: loc.geofence.playAudio !== false,
      distance,
      accuracy,
      speed,
      now,
      isEn,
    });

    if (evaluated) {
      activeAlerts.push(evaluated);
    }
  }

  for (const rem of reminders) {
    if (
      rem.deletedAt ||
      rem.status === 'completed' ||
      !rem.geofence ||
      !rem.geofence.enabled ||
      typeof rem.geofence.latitude !== 'number' ||
      typeof rem.geofence.longitude !== 'number'
    ) {
      continue;
    }
    if (isGeofenceItemTemporarilyPaused(rem.id, now)) continue;
    const distance = calculateHaversineDistance(
      userPos.latitude,
      userPos.longitude,
      rem.geofence.latitude,
      rem.geofence.longitude
    );
    const rawRemTitle = rem.geofence.locationName || rem.title;
    const displayTitle = formatLocTitle ? formatLocTitle(rawRemTitle, language) : rawRemTitle;
    const normalizedTriggerOn: 'enter' | 'exit' =
      rem.geofence.triggerOn === 'exit' ? 'exit' : 'enter';

    const evaluated = evaluateSingleItemScenario({
      itemKey: `rem_${rem.id}`,
      targetType: 'reminder',
      targetId: rem.id,
      title: displayTitle,
      description: rem.description || rem.title,
      latitude: rem.geofence.latitude,
      longitude: rem.geofence.longitude,
      radius: rem.geofence.radius || 200,
      triggerOn: normalizedTriggerOn,
      playAudio: true,
      distance,
      accuracy,
      speed,
      now,
      isEn,
    });

    if (evaluated) {
      activeAlerts.push(evaluated);
    }
  }

  // Sort by shortest targetDistance (center for 'enter', boundary for 'exit')
  activeAlerts.sort((a, b) => {
    if (a.targetDistance !== b.targetDistance) {
      return a.targetDistance - b.targetDistance;
    }
    return a.initialDistance - b.initialDistance;
  });

  return activeAlerts;
}

/**
 * Opens Google Maps turn-by-turn directions to the target coordinates.
 * Uses Native Android Intent when running in the Android app, or standard Google Maps URL in browser.
 */
export function openGoogleMapsDirections(
  latitude: number,
  longitude: number,
  label?: string
): void {
  if (typeof window === 'undefined') return;
  try {
    const bridge = (window as any).YaadGeofenceBridge;
    if (bridge && typeof bridge.openGoogleMapsNavigation === 'function') {
      bridge.openGoogleMapsNavigation(latitude, longitude, label || '');
      return;
    }
  } catch {
    // Fallback to URL below
  }

  const navUrl = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}&travelmode=driving`;
  try {
    const link = document.createElement('a');
    link.href = navUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch {
    window.location.href = navUrl;
  }
}

/**
 * Calculates distance between two coordinates in meters using the Haversine formula
 */
export function calculateHaversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
}

/**
 * Checks if geofence tracking is enabled in localStorage
 */
export function isGeofenceTrackingEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const bridge = (window as any).YaadGeofenceBridge;
    if (bridge && typeof bridge.isRadarDisabledFromBackground === 'function' && bridge.isRadarDisabledFromBackground()) {
      localStorage.setItem(GEOFENCE_TRACKING_ENABLED_KEY, JSON.stringify(false));
      return false;
    }
    const val = localStorage.getItem(GEOFENCE_TRACKING_ENABLED_KEY);
    if (val === null) return false;
    return JSON.parse(val) === true;
  } catch {
    return false;
  }
}

/**
 * Sets geofence tracking toggle in localStorage
 */
export function setGeofenceTrackingEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(GEOFENCE_TRACKING_ENABLED_KEY, JSON.stringify(enabled));
  } catch {
    // Ignore
  }
}

/**
 * Logarithmic Geofence Radius Slider Mapping (20m to 25km, with 5km at exact 50% midpoint):
 * Slider position is 0..1000:
 * - 0 -> 20 meters
 * - 500 (50% midpoint) -> 5,000 meters (5 km)
 * - 1000 (100% end) -> 25,000 meters (25 km)
 */
export function radiusToLogSliderPosition(radiusMeters: number): number {
  const r = Math.max(20, Math.min(25000, radiusMeters || 100));
  if (r <= 5000) {
    const ratio = Math.log(r / 20) / Math.log(250);
    return Math.round(Math.max(0, Math.min(500, ratio * 500)));
  } else {
    const ratio = Math.log(r / 5000) / Math.log(5);
    return Math.round(Math.max(500, Math.min(1000, 500 + ratio * 500)));
  }
}

export function logSliderPositionToRadius(sliderPos: number): number {
  const pos = Math.max(0, Math.min(1000, sliderPos));
  if (pos === 0) return 20;
  if (pos === 500) return 5000;
  if (pos === 1000) return 25000;

  let rawRadius: number;
  if (pos < 500) {
    const t = pos / 500;
    rawRadius = 20 * Math.pow(250, t);
  } else {
    const u = (pos - 500) / 500;
    rawRadius = 5000 * Math.pow(5, u);
  }

  if (rawRadius < 100) {
    return Math.max(20, Math.round(rawRadius / 5) * 5);
  } else if (rawRadius < 1000) {
    return Math.round(rawRadius / 10) * 10;
  } else if (rawRadius < 5000) {
    return Math.round(rawRadius / 50) * 50;
  } else {
    return Math.min(25000, Math.round(rawRadius / 100) * 100);
  }
}

// High-accuracy GPS stabilizer to prevent live distance from jumping back and forth
// between fine satellite GPS fixes and coarse cell-tower/network fixes.
let lastAcceptedPosition: UserPosition | null = null;

export function shouldAcceptLocationUpdate(newPos: UserPosition): boolean {
  if (
    !newPos ||
    typeof newPos.latitude !== 'number' ||
    typeof newPos.longitude !== 'number' ||
    Number.isNaN(newPos.latitude) ||
    Number.isNaN(newPos.longitude)
  ) {
    return false;
  }

  const now = Date.now();
  const normalizedPos: UserPosition = {
    latitude: newPos.latitude,
    longitude: newPos.longitude,
    accuracy: newPos.accuracy && newPos.accuracy > 0 ? newPos.accuracy : 15,
    timestamp: newPos.timestamp && newPos.timestamp > 0 ? newPos.timestamp : now,
  };

  if (!lastAcceptedPosition) {
    lastAcceptedPosition = normalizedPos;
    return true;
  }

  if (normalizedPos.timestamp < lastAcceptedPosition.timestamp - 1500) {
    return false;
  }

  const ageSinceLastMs = Math.max(0, now - lastAcceptedPosition.timestamp);
  const jumpMeters = calculateHaversineDistance(
    lastAcceptedPosition.latitude,
    lastAcceptedPosition.longitude,
    normalizedPos.latitude,
    normalizedPos.longitude
  );

  if (
    ageSinceLastMs < 35000 &&
    lastAcceptedPosition.accuracy <= 28 &&
    normalizedPos.accuracy > lastAcceptedPosition.accuracy + 12 &&
    jumpMeters >= 25
  ) {
    return false;
  }

  if (
    ageSinceLastMs < 45000 &&
    lastAcceptedPosition.accuracy <= 30 &&
    normalizedPos.accuracy > 45 &&
    jumpMeters < normalizedPos.accuracy + lastAcceptedPosition.accuracy + 25
  ) {
    return false;
  }

  if (
    ageSinceLastMs < 15000 &&
    lastAcceptedPosition.accuracy <= 35 &&
    normalizedPos.accuracy > 65 &&
    jumpMeters > 35
  ) {
    return false;
  }

  if (
    ageSinceLastMs < 4000 &&
    jumpMeters > 250 &&
    normalizedPos.accuracy > lastAcceptedPosition.accuracy * 1.5
  ) {
    return false;
  }

  lastAcceptedPosition = normalizedPos;
  return true;
}

/**
 * Saves last known position to localStorage for quick restore
 */
export function saveLastKnownPosition(pos: UserPosition): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LAST_KNOWN_POSITION_KEY, JSON.stringify(pos));
    const bridge = (window as any).YaadGeofenceBridge;
    if (bridge && typeof bridge.updateUserPosition === 'function') {
      bridge.updateUserPosition(
        pos.latitude,
        pos.longitude,
        pos.accuracy || 15,
        pos.timestamp || Date.now()
      );
    }
  } catch {
    // Ignore
  }
}

/**
 * Retrieves last known position
 */
export function getLastKnownPosition(): UserPosition | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LAST_KNOWN_POSITION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Syncs active SavedLocation geofences AND location-enabled Reminders with the native Android background service (YaadGeofenceService)
 * so geofence monitoring responds in < 2s whether the app is open, backgrounded, or killed.
 */
export function syncGeofencesWithNativeAndroid(
  enabled: boolean,
  reminders: Reminder[] = [],
  locations: SavedLocation[] = [],
  language: 'fa' | 'en' = 'fa'
): void {
  if (typeof window === 'undefined') return;
  const bridge = (window as any).YaadGeofenceBridge;
  if (!bridge || typeof bridge.syncGeofences !== 'function') return;

  try {
    const isEn = language === 'en';
    const items: Array<{
      id: string;
      type: 'location' | 'reminder';
      title: string;
      description: string;
      latitude: number;
      longitude: number;
      radius: number;
      triggerOn: 'enter' | 'exit';
      customMessage: string;
      playAudio: boolean;
      cooldownMs: number;
    }> = [];

    for (const loc of locations) {
      if (loc.deletedAt || !loc.geofence || !loc.geofence.enabled) continue;
      items.push({
        id: `loc_${loc.id}`,
        type: 'location',
        title: loc.title || (isEn ? 'Saved Location' : 'مکان ذخیره‌شده'),
        description: loc.description || '',
        latitude: loc.latitude,
        longitude: loc.longitude,
        radius: loc.geofence.radius || 100,
        triggerOn: loc.geofence.triggerOn === 'exit' ? 'exit' : 'enter',
        customMessage: loc.geofence.customMessage || '',
        playAudio: loc.geofence.playAudio !== false,
        cooldownMs: 1000,
      });
    }

    for (const rem of reminders) {
      if (
        rem.deletedAt ||
        rem.status === 'completed' ||
        !rem.geofence ||
        !rem.geofence.enabled ||
        typeof rem.geofence.latitude !== 'number' ||
        typeof rem.geofence.longitude !== 'number'
      ) {
        continue;
      }
      items.push({
        id: `rem_${rem.id}`,
        type: 'reminder',
        title: rem.geofence.locationName || rem.title || (isEn ? 'Reminder' : 'یادآور'),
        description: rem.description || rem.title || '',
        latitude: rem.geofence.latitude,
        longitude: rem.geofence.longitude,
        radius: rem.geofence.radius || 200,
        triggerOn: rem.geofence.triggerOn === 'exit' ? 'exit' : 'enter',
        customMessage: rem.title || '',
        playAudio: true,
        cooldownMs: 1000,
      });
    }

    const gpsOn = typeof bridge.isLocationEnabled === 'function' ? Boolean(bridge.isLocationEnabled()) : true;
    const rawLastPos = gpsOn ? (lastAcceptedPosition || getLastKnownPosition()) : null;
    const isFreshPos =
      rawLastPos &&
      typeof rawLastPos.latitude === 'number' &&
      typeof rawLastPos.longitude === 'number' &&
      !Number.isNaN(rawLastPos.latitude) &&
      !Number.isNaN(rawLastPos.longitude) &&
      (!rawLastPos.timestamp || Date.now() - rawLastPos.timestamp <= 3 * 60 * 1000);
    const lastPos = isFreshPos ? rawLastPos : null;
    const payload = JSON.stringify({
      enabled: Boolean(enabled && items.length > 0),
      language,
      items,
      lastPosition: lastPos
        ? {
            latitude: lastPos.latitude,
            longitude: lastPos.longitude,
            accuracy: lastPos.accuracy || 15,
            timestamp: lastPos.timestamp || Date.now(),
          }
        : null,
    });
    bridge.syncGeofences(payload);
  } catch {
    // Ignore bridge errors on web
  }
}

/**
 * Returns the distance and radius of the nearest active geofence.
 */
export function getNearestActiveGeofenceDistance(
  userPos: { latitude: number; longitude: number },
  reminders: Reminder[] = [],
  locations: SavedLocation[] = []
): { distance: number; radius: number } | null {
  let nearest: { distance: number; radius: number } | null = null;

  for (const l of locations) {
    if (l.deletedAt || !l.geofence || !l.geofence.enabled) continue;
    const d = calculateHaversineDistance(
      userPos.latitude,
      userPos.longitude,
      l.latitude,
      l.longitude
    );
    const r = l.geofence.radius || 100;
    if (!nearest || d < nearest.distance) {
      nearest = { distance: d, radius: r };
    }
  }

  for (const rem of reminders) {
    if (
      rem.deletedAt ||
      rem.status === 'completed' ||
      !rem.geofence ||
      !rem.geofence.enabled ||
      typeof rem.geofence.latitude !== 'number' ||
      typeof rem.geofence.longitude !== 'number'
    ) {
      continue;
    }
    const d = calculateHaversineDistance(
      userPos.latitude,
      userPos.longitude,
      rem.geofence.latitude,
      rem.geofence.longitude
    );
    const r = rem.geofence.radius || 200;
    if (!nearest || d < nearest.distance) {
      nearest = { distance: d, radius: r };
    }
  }

  return nearest;
}

/**
 * Adaptive Speed-Aware (Time-To-Crossing) GPS Polling Interval:
 * Harmonized with native YaadGeofenceService:
 * - No active geofences: 60,000ms (Idle)
 * - Uses minimum margin to outer boundary R and either 0.85*R (exit) or 10% rc (enter),
 *   combined with Time-To-Boundary (`margin / max(speedMps, 1.0)`).
 */
export function getAdaptivePollingInterval(
  userPos: { latitude: number; longitude: number; speed?: number | null },
  reminders: Reminder[] = [],
  locations: SavedLocation[] = []
): number {
  let minMarginMeters = Number.POSITIVE_INFINITY;
  let hasAny = false;
  let maxObservedRuntimeSpeed = 0;

  for (const st of scenarioRuntimeMap.values()) {
    if (st.effectiveSpeedMps > maxObservedRuntimeSpeed) {
      maxObservedRuntimeSpeed = st.effectiveSpeedMps;
    }
  }

  const updateMinMargin = (d: number, rawRadius: number, triggerOn?: string) => {
    hasAny = true;
    const r = Math.max(20, rawRadius || 200);
    const mode = triggerOn === 'exit' ? 'exit' : triggerOn === 'both' ? 'both' : 'enter';
    const rc = computeFivePercentZoneMeters(r);
    const exitWarn = r * 0.85;
    let margin = Math.abs(d - r);
    if (mode === 'exit') {
      margin = Math.min(Math.abs(d - exitWarn), Math.abs(d - r));
    } else if (mode === 'enter') {
      margin = Math.min(Math.abs(d - rc), Math.abs(d - r));
    } else {
      margin = Math.min(Math.abs(d - rc), Math.abs(d - exitWarn), Math.abs(d - r));
    }
    if (margin < minMarginMeters) {
      minMarginMeters = margin;
    }
  };

  for (const l of locations) {
    if (l.deletedAt || !l.geofence || !l.geofence.enabled) continue;
    const d = calculateHaversineDistance(userPos.latitude, userPos.longitude, l.latitude, l.longitude);
    updateMinMargin(d, l.geofence.radius || 100, l.geofence.triggerOn);
  }

  for (const rem of reminders) {
    if (
      rem.deletedAt ||
      rem.status === 'completed' ||
      !rem.geofence ||
      !rem.geofence.enabled ||
      typeof rem.geofence.latitude !== 'number' ||
      typeof rem.geofence.longitude !== 'number'
    ) {
      continue;
    }
    const d = calculateHaversineDistance(
      userPos.latitude,
      userPos.longitude,
      rem.geofence.latitude,
      rem.geofence.longitude
    );
    updateMinMargin(d, rem.geofence.radius || 200, rem.geofence.triggerOn);
  }

  if (!hasAny || !Number.isFinite(minMarginMeters)) {
    return 60000;
  }

  const rawPosSpeed =
    typeof userPos.speed === 'number' && Number.isFinite(userPos.speed) && userPos.speed >= 0
      ? userPos.speed
      : 0;
  const effSpeedMps = Math.max(rawPosSpeed, maxObservedRuntimeSpeed);
  const ttcSec = minMarginMeters / Math.max(effSpeedMps, 1.0);

  if (minMarginMeters <= 50 || ttcSec <= 25) {
    return 1000;
  }
  if (minMarginMeters <= 150 || ttcSec <= 45) {
    return 2000;
  }
  if (minMarginMeters <= 600 || ttcSec <= 90) {
    return 4000;
  }
  if (minMarginMeters <= 2500 || ttcSec <= 180) {
    return 8000;
  }
  return 12000;
}


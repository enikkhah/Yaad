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
  timestamp: number;
}

export type GeofenceScenarioPhase =
  | 'enter_approaching'        // Scenario 'enter': 5% < d <= 105% R (10/min sonar)
  | 'enter_center_5hz'         // Scenario 'enter': d <= 5% R for 10 seconds (5 Hz sonar)
  | 'enter_center_visual_10s'  // Scenario 'enter': after 10s of 5Hz, visual-only up to 30s total
  | 'exit_moving_out'          // Scenario 'exit': 5% < d <= 100% R moving out (10/min deep sonar)
  | 'exit_border_5hz'          // Scenario 'exit': d > 100% R for 10 seconds (5 Hz deep sonar)
  | 'exit_crossed_visual_10s'  // Scenario 'exit': after 10s of 5Hz, visual-only up to 30s total
  | 'both_approaching_enter'   // Scenario 'both': 100% R < d <= 105% R moving inward (10/min sonar)
  | 'both_enter_border_5hz'    // Scenario 'both': center 5% 5 Hz sonar
  | 'both_entered_visual_10s'  // Scenario 'both': visual-only completion
  | 'both_approaching_exit'    // Scenario 'both': 5% R < d <= 100% R moving outward (10/min deep sonar)
  | 'both_exit_border_5hz'     // Scenario 'both': d > 100% R for 10 seconds (5 Hz deep sonar)
  | 'both_exited_visual_10s';  // Scenario 'both': after 10s of 5Hz exit, visual-only up to 30s total

export interface EvaluatedGeofenceAlertItem {
  id: string;
  targetType: 'location' | 'reminder';
  targetId: string;
  locationTitle: string;
  description?: string;
  triggerType: 'enter' | 'exit' | 'arrived_under_10m';
  triggerOn: 'enter' | 'exit' | 'both';
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
  // Scenario 'exit' & fuzzy boundary phase lock
  wasInsideForExit: boolean;
  armedForExit: boolean;
  exitCycleCompleted: boolean;
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
}

export const GEOFENCE_PASS_THROUGH_SNOOZE_MS = 30 * 60 * 1000; // 30 minutes snooze when passing through ("الان نه (Snooze)")
export const GEOFENCE_ANTI_PINGPONG_COOLDOWN_MS = 3 * 60 * 1000; // 3 minutes minimum cooldown between same-phase triggers

const scenarioRuntimeMap = new Map<string, ItemScenarioRuntimeState>();

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
      wasInsideForExit: false,
      armedForExit: false,
      exitCycleCompleted: false,
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

  if (
    !lastSample ||
    nowMs - lastSample.timestamp >= 450 ||
    Math.abs(distanceMeters - lastSample.distance) >= 1
  ) {
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
    setSubmarineSonarMuted(false);
  } else {
    const cleanId = itemId.replace(/^(loc_|rem_)/, '');
    pausedGeofenceItemsMap.delete(cleanId);
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
export function acknowledgeGeofenceAlert(itemId?: string): void {
  setSubmarineSonarMuted(false);
  if (itemId) {
    const cleanId = itemId.replace(/^(loc_|rem_)/, '');
    const now = Date.now();
    proximityStateMap.set(`loc_${cleanId}`, true);
    proximityStateMap.set(`rem_${cleanId}`, true);
    proximityStateMap.set(`u10m_loc_${cleanId}`, true);
    proximityStateMap.set(`u10m_rem_${cleanId}`, true);
    lastTransitionTimeMap.set(`loc_${cleanId}`, now);
    lastTransitionTimeMap.set(`rem_${cleanId}`, now);

    const locState = scenarioRuntimeMap.get(`loc_${cleanId}`);
    if (locState) {
      locState.acknowledgedUntilExit = true;
      locState.sonarFinishedForCycle = true;
      locState.cooldownUntilMs = now + GEOFENCE_ANTI_PINGPONG_COOLDOWN_MS;
      locState.visual10sStartMs = 0;
      locState.center5HzStartMs = 0;
      locState.border5HzStartMs = 0;
    }
    const remState = scenarioRuntimeMap.get(`rem_${cleanId}`);
    if (remState) {
      remState.acknowledgedUntilExit = true;
      remState.sonarFinishedForCycle = true;
      remState.cooldownUntilMs = now + GEOFENCE_ANTI_PINGPONG_COOLDOWN_MS;
      remState.visual10sStartMs = 0;
      remState.center5HzStartMs = 0;
      remState.border5HzStartMs = 0;
    }

    saveProximityStateToStorage();
  }

  if (typeof window !== 'undefined') {
    try {
      const bridge = (window as any).YaadGeofenceBridge;
      if (bridge && typeof bridge.stopGeofenceAlertAudio === 'function') {
        bridge.stopGeofenceAlertAudio();
      }
    } catch {
      // Ignore bridge error on web
    }
  }
}

/**
 * Snoozes a geofence alert when the user taps «الان نه (Snooze)» because they are just passing through.
 * - Stops sonar & vibration immediately and closes the full-screen alert.
 * - Keeps the geofence ENABLED for future trips (unlike "توقف").
 * - Applies both an anti-ping-pong spatial latch (`acknowledgedUntilExit = true`) AND a 30-minute cooldown
 *   so GPS jitter or traffic along the route never re-triggers the alert while passing through!
 */
export function snoozeGeofenceAlertPassThrough(
  itemId?: string,
  durationMs: number = GEOFENCE_PASS_THROUGH_SNOOZE_MS
): void {
  setSubmarineSonarMuted(false);
  const now = Date.now();
  const safeDuration = Math.max(60_000, durationMs);

  if (itemId) {
    const cleanId = itemId.replace(/^(loc_|rem_)/, '');
    pausedGeofenceItemsMap.set(cleanId, {
      reason: 'snooze',
      pausedAt: now,
      resumeAt: now + safeDuration,
    });
    for (const key of [`loc_${cleanId}`, `rem_${cleanId}`]) {
      const st = getOrCreateRuntimeState(key, now);
      st.acknowledgedUntilExit = true;
      st.sonarFinishedForCycle = true;
      st.cooldownUntilMs = now + safeDuration;
      st.visual10sStartMs = 0;
      st.center5HzStartMs = 0;
      st.border5HzStartMs = 0;
      st.consecutiveOutsideSamples = 0;
    }
    proximityStateMap.set(`loc_${cleanId}`, true);
    proximityStateMap.set(`rem_${cleanId}`, true);
    lastTransitionTimeMap.set(`loc_${cleanId}`, now);
    lastTransitionTimeMap.set(`rem_${cleanId}`, now);
    saveProximityStateToStorage();
  }

  if (typeof window !== 'undefined') {
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
  const durationMs = reason === 'directions' ? 20_000 : 15 * 60_000;
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
 * Note: 'snooze' entries are NOT auto-resumed on modal close; they wait for their cooldown/exit.
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
    pausedGeofenceItemsMap.delete(cleanId);
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
 * Evaluates a single SavedLocation geofence item against the 3 scenarios ('enter', 'exit', 'both')
 * with Fuzzy Boundary Hysteresis, < 2s immediate activation, permanent sonar stop after 10s of 5 Hz,
 * and ultra-concise core phrases.
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
  triggerOn: 'enter' | 'exit' | 'both';
  playAudio: boolean;
  distance: number;
  accuracy: number;
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
    triggerOn,
    playAudio,
    distance: rawDistance,
    accuracy,
    now,
    isEn,
  } = params;

  const safeRadius = Math.max(20, radius || 100);
  const st = getOrCreateRuntimeState(itemKey, now);
  const trend = recordAndAnalyzeDistanceTrend(itemKey, rawDistance, now, accuracy);
  const distance = getSmoothedDistance(itemKey, rawDistance);

  // Physical 5% zone width: max(5% R, 15m) (capped at 35% R for very small radii)
  const fivePctMeters = computeFivePercentZoneMeters(safeRadius);
  const centerZoneMeters = fivePctMeters;
  const preEntryStartMeters = safeRadius + fivePctMeters;

  // Fuzzy boundary hysteresis margin + Anti-Ping-Pong deadband (max(15m..35m, 15% of radius, capped at 80m))
  // Prevents GPS drift or temporary signal drop near the border from ping-ponging between inside and outside!
  const fuzzyHysteresisMeters = Math.max(
    12,
    Math.min(30, Math.round((accuracy || 15) * 0.65))
  );
  const antiPingPongDeadbandMeters = Math.max(
    fuzzyHysteresisMeters,
    Math.min(80, Math.round(safeRadius * 0.15))
  );
  const innerSafeExitArmRadius = Math.max(
    centerZoneMeters,
    safeRadius - Math.max(fuzzyHysteresisMeters, Math.round(safeRadius * 0.1))
  );

  // Track consecutive inside/outside samples to debounce signal drops
  if (distance > preEntryStartMeters + antiPingPongDeadbandMeters) {
    st.consecutiveOutsideSamples += 1;
    st.consecutiveInsideSamples = 0;
  } else if (distance <= safeRadius) {
    st.consecutiveInsideSamples += 1;
    st.consecutiveOutsideSamples = 0;
  }

  // Respect active pass-through Snooze / Cooldown window
  if (st.cooldownUntilMs > now && st.acknowledgedUntilExit) {
    return null;
  }

  // Once the 10s 5Hz stage finishes (`sonarFinishedForCycle`), 6s sonar is permanently cut off for the rest of this cycle
  const effectivePlayAudio = playAudio && !st.audioMutedForCycle && !st.sonarFinishedForCycle;

  // Concise core status phrases
  const msgApproaching = isEn ? `Approaching «${title}»` : `نزدیک شدن به «${title}»`;
  const msgEntered = isEn ? `Entered «${title}»` : `ورود به حصار مکانی «${title}»`;
  const msgCenter = isEn ? `At center of «${title}»` : `در مرکز حصار مکانی «${title}»`;
  const msgExiting = isEn ? `Exiting «${title}»` : `در حال خروج از حصار مکانی «${title}»`;
  const msgExited = isEn ? `Exited «${title}»` : `خروج از حصار مکانی «${title}»`;

  const directionConfirmMeters = Math.max(4, Math.min(12, Math.round((accuracy || 12) * 0.35)));

  if (st.startedOutsideBoundary === undefined) {
    st.startedOutsideBoundary = distance > safeRadius;
  }
  if (distance <= preEntryStartMeters) {
    if (distance < st.minDistanceReachedInside) {
      st.minDistanceReachedInside = distance;
    }
    if (distance > st.maxDistanceInApproach) {
      st.maxDistanceInApproach = distance;
    }
  } else if (st.consecutiveOutsideSamples >= 2) {
    st.startedOutsideBoundary = true;
    st.maxDistanceInApproach = distance;
  }

  // True when user is moving away from their closest point to the center (exiting)
  const isConfirmedExitingDirection =
    trend === 'outward' ||
    (Number.isFinite(st.minDistanceReachedInside) &&
      distance >= st.minDistanceReachedInside + directionConfirmMeters &&
      st.lastOutwardMoveMs > st.lastInwardMoveMs);

  // True when user is moving toward the center (entering)
  const isConfirmedEnteringDirection =
    trend === 'inward' ||
    (st.maxDistanceInApproach > 0 &&
      distance <= st.maxDistanceInApproach - directionConfirmMeters &&
      st.lastInwardMoveMs >= st.lastOutwardMoveMs) ||
    (st.startedOutsideBoundary && distance <= preEntryStartMeters && !isConfirmedExitingDirection);

  // =========================================================================
  // SCENARIO 1: ENTER ONLY ('enter')
  // =========================================================================
  if (triggerOn === 'enter') {
    // Anti-Ping-Pong Reset Condition:
    // Only reset the enter latch if the user has moved clearly outside the deadband (`preEntryStartMeters + antiPingPongDeadbandMeters`)
    // for at least 2 consecutive valid readings AND any cooldown has expired!
    if (distance > preEntryStartMeters + antiPingPongDeadbandMeters) {
      if (st.consecutiveOutsideSamples >= 2 && now >= st.cooldownUntilMs) {
        st.enterAlertActive = false;
        st.enterCycleCompleted = false;
        st.wasInsideBorder = false;
        st.center5HzStartMs = 0;
        st.entryBannerStartMs = 0;
        st.visual10sStartMs = 0;
        st.visualCrossingType = null;
        st.audioMutedForCycle = false;
        st.sonarFinishedForCycle = false;
        st.acknowledgedUntilExit = false;
        st.minDistanceReachedInside = Number.POSITIVE_INFINITY;
        st.maxDistanceInApproach = distance;
        st.startedOutsideBoundary = true;
      }
      return null;
    }

    // If GPS jitter momentarily pushes a latched inside user slightly outside `preEntryStartMeters` (within the deadband),
    // keep the enter alert latched instead of dropping and re-triggering (Zero Ping-Pong)!
    if (st.acknowledgedUntilExit || st.enterCycleCompleted) {
      return null;
    }

    // Separate 10-second entry message upon crossing into <= R ONLY when entering (not when exiting!)
    if (!st.wasInsideBorder && distance <= safeRadius && !isConfirmedExitingDirection) {
      st.wasInsideBorder = true;
      st.enterAlertActive = true;
      st.entryBannerStartMs = now;
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
    // 5 Hz rapid sonar for 10 seconds, then sonar stops permanently (`sonarFinishedForCycle = true`)
    // while the full-screen alert remains open until explicit user reaction!
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

      // 10s of 5 Hz finished -> permanently cut off all sonar, but KEEP the full-screen radar open until user reacts!
      st.sonarFinishedForCycle = true;

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

    // 1B. From ~5% before boundary (105% R) down to central 5% zone:
    // CRITICAL: If the user is moving outward (exiting the geofence) and was not already latched in an enter alert, DO NOT emit an enter alert!
    if (isConfirmedExitingDirection && !st.enterAlertActive) {
      return null;
    }

    if (
      distance <= preEntryStartMeters &&
      !st.sonarFinishedForCycle &&
      (st.enterAlertActive || isConfirmedEnteringDirection || !isConfirmedExitingDirection)
    ) {
      st.enterAlertActive = true;

      return {
        id: `alert_${itemKey}`,
        targetType,
        targetId,
        locationTitle: title,
        description,
        triggerType: 'enter',
        triggerOn: 'enter',
        scenarioPhase: distance > safeRadius ? 'both_approaching_enter' : 'enter_approaching',
        sonarMode: 'enter',
        sonarIntervalMs: 6000,
        isVisualOnly: false,
        visualBannerMessage: entryToastMessage || (distance > safeRadius ? msgApproaching : msgEntered),
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
  // =========================================================================
  if (triggerOn === 'exit') {
    // 2A. Inside the central 5% zone (d <= max(5% R, 15m)) while not exiting: silent & armed for exit
    if (distance <= centerZoneMeters && !isConfirmedExitingDirection) {
      st.wasInsideForExit = true;
      st.armedForExit = true;
      st.bothDirectionLock = null;
      st.exitCycleCompleted = false;
      st.border5HzStartMs = 0;
      st.visual10sStartMs = 0;
      st.audioMutedForCycle = false;
      st.sonarFinishedForCycle = false;
      st.acknowledgedUntilExit = false;
      st.minDistanceReachedInside = distance;
      return null;
    }

    // 2B. Inside boundary after leaving central 5% zone (5% R < d <= 100% R):
    // CRITICAL: If the user is entering the fence from outside, do NOT emit an exit alert!
    if (distance <= safeRadius && st.border5HzStartMs === 0) {
      st.wasInsideForExit = true;
      st.exitCycleCompleted = false;

      if (!st.startedOutsideBoundary || distance <= innerSafeExitArmRadius) {
        st.armedForExit = true;
      }

      if (st.acknowledgedUntilExit || st.sonarFinishedForCycle) {
        return null;
      }

      // Must be armed AND either actively moving outward or already latched in outward exit alert
      const isLatchedOutward = st.bothDirectionLock === 'outward' && trend !== 'inward';
      if (!st.armedForExit || (!isConfirmedExitingDirection && !isLatchedOutward)) {
        return null;
      }

      st.bothDirectionLock = 'outward';
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

    // 2C. Crossed outside boundary (d > R or already in 5Hz exit stage):
    const crossedOutside = distance > safeRadius;
    if (
      (st.wasInsideForExit || !st.startedOutsideBoundary) &&
      (st.armedForExit || !st.startedOutsideBoundary) &&
      !st.exitCycleCompleted &&
      !st.acknowledgedUntilExit &&
      (crossedOutside || st.border5HzStartMs > 0)
    ) {
      st.bothDirectionLock = 'outward';
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

      // 10s of 5 Hz exit sonar finished -> permanently stop sonar, but KEEP the full-screen radar open until user reacts!
      st.sonarFinishedForCycle = true;

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
        isAudioMuted: st.audioMutedForCycle,
        initialDistance: distance,
        targetDistance: 0,
        radius: safeRadius,
        latitude,
        longitude,
        playAudio: false,
      };
    }

    return null;
  }

  // =========================================================================
  // SCENARIO 3: BOTH ENTER & EXIT ('both') — With Fuzzy Boundary Phase Lock
  // =========================================================================
  const isCurrentlyInside = distance <= safeRadius;
  const isClearlyOutside = distance > safeRadius + Math.min(10, Math.round(fuzzyHysteresisMeters * 0.5));

  if (distance <= innerSafeExitArmRadius || !st.startedOutsideBoundary) {
    st.armedForExit = true;
  }

  if (st.wasInsideBorder === undefined) {
    st.wasInsideBorder = isCurrentlyInside;
    if (isCurrentlyInside) {
      st.wasInsideForExit = true;
      st.armedForExit = true;
    }
  } else if (!st.wasInsideBorder && isCurrentlyInside && !isConfirmedExitingDirection) {
    // Entered boundary from outside
    st.wasInsideBorder = true;
    st.wasInsideForExit = true;
    st.enterAlertActive = true;
    st.enterCycleCompleted = false;
    st.exitCycleCompleted = false;
    st.acknowledgedUntilExit = false;
    st.audioMutedForCycle = false;
    st.sonarFinishedForCycle = false;
    st.bothDirectionLock = 'inward';
    st.lastInwardMoveMs = now;
    st.lastPhaseTransitionMs = now;
    st.border5HzStartMs = 0;
    st.entryBannerStartMs = now;
  } else if (st.wasInsideBorder && isClearlyOutside && st.armedForExit) {
    // Exited boundary after being inside -> start 10s 5Hz exit sonar + persistent visual alert
    st.wasInsideBorder = false;
    st.enterAlertActive = false;
    st.bothDirectionLock = 'outward';
    st.lastPhaseTransitionMs = now;
    st.center5HzStartMs = 0;
    st.entryBannerStartMs = 0;
    st.acknowledgedUntilExit = false;
    st.audioMutedForCycle = false;
    st.sonarFinishedForCycle = false;
    if (st.border5HzStartMs === 0) {
      st.border5HzStartMs = now;
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

  // 3A. Outside boundary or actively running exit border cycle:
  if (!isCurrentlyInside || st.border5HzStartMs > 0) {
    if (
      st.wasInsideForExit &&
      !st.exitCycleCompleted &&
      !st.acknowledgedUntilExit &&
      st.border5HzStartMs > 0
    ) {
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
          triggerOn: 'both',
          scenarioPhase: 'both_exit_border_5hz',
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

      // 10s of 5 Hz exit sonar finished -> permanently stop sonar, keep full-screen visual alert open until user reacts!
      st.sonarFinishedForCycle = true;

      return {
        id: `alert_${itemKey}`,
        targetType,
        targetId,
        locationTitle: title,
        description,
        triggerType: 'exit',
        triggerOn: 'both',
        scenarioPhase: 'both_exited_visual_10s',
        sonarMode: 'exit',
        sonarIntervalMs: 6000,
        isVisualOnly: true,
        visualBannerMessage: msgExited,
        isAudioMuted: st.audioMutedForCycle,
        initialDistance: distance,
        targetDistance: 0,
        radius: safeRadius,
        latitude,
        longitude,
        playAudio: false,
      };
    }

    if (distance > preEntryStartMeters + fuzzyHysteresisMeters) {
      st.enterAlertActive = false;
      st.enterCycleCompleted = false;
      st.acknowledgedUntilExit = false;
      st.audioMutedForCycle = false;
      st.sonarFinishedForCycle = false;
      return null;
    }

    // Within ~5% before entering the boundary (R < d <= 105% R)
    if (!st.acknowledgedUntilExit && distance <= preEntryStartMeters && st.border5HzStartMs === 0) {
      const isApproachingToEnter =
        st.enterAlertActive ||
        trend !== 'outward';
      if (isApproachingToEnter) {
        st.enterAlertActive = true;
        st.bothDirectionLock = 'inward';
        return {
          id: `alert_${itemKey}`,
          targetType,
          targetId,
          locationTitle: title,
          description,
          triggerType: 'enter',
          triggerOn: 'both',
          scenarioPhase: 'both_approaching_enter',
          sonarMode: 'enter',
          sonarIntervalMs: 6000,
          isVisualOnly: false,
          visualBannerMessage: msgApproaching,
          isAudioMuted: st.audioMutedForCycle,
          initialDistance: distance,
          targetDistance: Math.max(0, distance - safeRadius),
          radius: safeRadius,
          latitude,
          longitude,
          playAudio: effectivePlayAudio,
        };
      }
    }

    return null;
  }

  if (st.acknowledgedUntilExit) {
    return null;
  }

  const exitSafeMarginMeters = Math.min(
    Math.floor(safeRadius * 0.45),
    Math.max(20, Math.round(safeRadius * 0.1))
  );
  const cooldownElapsed = now - st.lastPhaseTransitionMs >= 3_000;
  const isMovingOutward =
    st.armedForExit &&
    cooldownElapsed &&
    distance > centerZoneMeters &&
    (isConfirmedExitingDirection ||
      (st.bothDirectionLock === 'outward' && trend !== 'inward'));

  // If user starts moving outward after reaching center, unlatch center visual alert and switch to exit alert
  if (isMovingOutward && st.center5HzStartMs > 0 && st.sonarFinishedForCycle && distance > exitSafeMarginMeters) {
    st.enterCycleCompleted = true;
    st.enterAlertActive = false;
    st.center5HzStartMs = 0;
    st.audioMutedForCycle = false;
    st.sonarFinishedForCycle = false;
  }

  // 3B. Inside the boundary (d <= R):
  // Central 5% Zone (d <= max(5% R, 15m))
  if (!st.enterCycleCompleted && (distance <= centerZoneMeters || st.center5HzStartMs > 0)) {
    if (st.center5HzStartMs === 0) {
      st.center5HzStartMs = now;
      st.lastPhaseTransitionMs = now;
      st.armedForExit = true;
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
        triggerOn: 'both',
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

    // 10s of 5 Hz finished -> permanently cut off 6s sonar, keep full-screen radar open until user reacts (or exits)!
    st.sonarFinishedForCycle = true;

    return {
      id: `alert_${itemKey}`,
      targetType,
      targetId,
      locationTitle: title,
      description,
      triggerType: 'arrived_under_10m',
      triggerOn: 'both',
      scenarioPhase: 'enter_center_visual_10s',
      sonarMode: 'enter',
      sonarIntervalMs: 6000,
      isVisualOnly: true,
      visualBannerMessage: msgCenter,
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

  // 3C. Moving outward after leaving the 5% central zone:
  if (isMovingOutward) {
    st.bothDirectionLock = 'outward';
    st.wasInsideForExit = true;
    st.exitCycleCompleted = false;
    st.sonarFinishedForCycle = false;
    const distToBorder = Math.max(0, safeRadius - distance);

    return {
      id: `alert_${itemKey}`,
      targetType,
      targetId,
      locationTitle: title,
      description,
      triggerType: 'exit',
      triggerOn: 'both',
      scenarioPhase: 'both_approaching_exit',
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

  // 3D. Inside boundary moving toward the 5% center:
  if (
    !st.enterCycleCompleted &&
    !st.sonarFinishedForCycle &&
    (st.enterAlertActive || trend !== 'outward')
  ) {
    st.enterAlertActive = true;
    st.bothDirectionLock = 'inward';
    return {
      id: `alert_${itemKey}`,
      targetType,
      targetId,
      locationTitle: title,
      description,
      triggerType: 'enter',
      triggerOn: 'both',
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

/**
 * Evaluates active Saved Locations (`locations`) AND location-enabled Reminders (`reminders`)
 * across all 3 scenarios ('enter', 'exit', 'both') in < 2s.
 */
export function evaluateAllActiveGeofenceScenarios(
  userPos: { latitude: number; longitude: number; accuracy?: number },
  reminders: Reminder[] = [],
  locations: SavedLocation[] = [],
  language: 'fa' | 'en' = 'fa',
  formatLocTitle?: (title: string, lang?: 'fa' | 'en') => string
): EvaluatedGeofenceAlertItem[] {
  const now = Date.now();
  const isEn = language === 'en';
  const activeAlerts: EvaluatedGeofenceAlertItem[] = [];
  const accuracy = userPos.accuracy && userPos.accuracy > 0 ? userPos.accuracy : 12;

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

    const evaluated = evaluateSingleItemScenario({
      itemKey: `loc_${loc.id}`,
      targetType: 'location',
      targetId: loc.id,
      title: displayTitle,
      description: loc.description || loc.geofence.customMessage,
      latitude: loc.latitude,
      longitude: loc.longitude,
      radius: loc.geofence.radius || 100,
      triggerOn: loc.geofence.triggerOn || 'both',
      playAudio: loc.geofence.playAudio !== false,
      distance,
      accuracy,
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

    const evaluated = evaluateSingleItemScenario({
      itemKey: `rem_${rem.id}`,
      targetType: 'reminder',
      targetId: rem.id,
      title: displayTitle,
      description: rem.description || rem.title,
      latitude: rem.geofence.latitude,
      longitude: rem.geofence.longitude,
      radius: rem.geofence.radius || 200,
      triggerOn: rem.geofence.triggerOn || 'enter',
      playAudio: true,
      distance,
      accuracy,
      now,
      isEn,
    });

    if (evaluated) {
      activeAlerts.push(evaluated);
    }
  }

  // Sort by shortest targetDistance (center for 'enter', boundary for 'exit' and 'both')
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
      triggerOn: 'enter' | 'exit' | 'both';
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
        triggerOn: loc.geofence.triggerOn || 'both',
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
        triggerOn: rem.geofence.triggerOn || 'enter',
        customMessage: rem.title || '',
        playAudio: true,
        cooldownMs: 1000,
      });
    }

    const payload = JSON.stringify({
      enabled: (enabled || items.length > 0) && items.length > 0,
      language,
      items,
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
 * Adaptive Battery-Saving GPS Polling Interval:
 * - No active geofences: 60,000ms (Idle)
 * - Far from all geofence boundaries (> 2500m): 12,000ms (Low-Power Battery Saver)
 * - Medium distance (600m .. 2500m): 4,000ms (Balanced Approach)
 * - Near or inside any geofence boundary (<= 600m): 1,000ms (High-Precision < 2s Trigger)
 */
export function getAdaptivePollingInterval(
  userPos: { latitude: number; longitude: number },
  reminders: Reminder[] = [],
  locations: SavedLocation[] = []
): number {
  const nearest = getNearestActiveGeofenceDistance(userPos, reminders, locations);
  if (!nearest) {
    return 60000;
  }

  const distToBoundary = Math.max(0, nearest.distance - nearest.radius);
  if (distToBoundary <= 600) {
    return 1000;
  }
  if (distToBoundary <= 2500) {
    return 4000;
  }
  return 12000;
}


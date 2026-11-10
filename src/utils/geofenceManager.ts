import { Reminder, SavedLocation } from '../types';
import { computeSubmarineSonarIntervalMs, SonarScenarioMode } from './audio';

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

export interface GeofenceTriggerEvent {
  reminder: Reminder;
  triggerType: 'enter' | 'exit' | 'arrived_under_10m';
  distance: number;
  timestamp: number;
}

export interface SavedLocationTriggerEvent {
  location: SavedLocation;
  triggerType: 'enter' | 'exit' | 'arrived_under_10m';
  distance: number;
  timestamp: number;
}

export type GeofenceScenarioPhase =
  | 'enter_approaching'        // Scenario 'enter': 10% < d <= 100% R (adaptive sonar)
  | 'enter_center_5hz'         // Scenario 'enter': d <= 10% R for 10 seconds (5 Hz sonar)
  | 'enter_center_visual_10s'  // Scenario 'enter': after 10s of 5Hz, visual-only 10s ("شما در مرکز حصار مکانی ... هستید.")
  | 'exit_moving_out'          // Scenario 'exit': 10% < d < 90% R (reverse adaptive sonar)
  | 'exit_border_5hz'          // Scenario 'exit': 90% <= d <= 100% R (5 Hz sonar)
  | 'exit_crossed_visual_10s'  // Scenario 'exit': d > 100% R after being inside, visual-only 10s ("شما از حصار مکانی ... خارج شدید.")
  | 'both_approaching_enter'   // Scenario 'both': 102% R < d <= 120% R moving inward (scaled enter sonar)
  | 'both_enter_border_5hz'    // Scenario 'both': 100% R < d <= 102% R moving inward (5 Hz sonar, max 10s)
  | 'both_entered_visual_10s'  // Scenario 'both': crossed border into <= 100% R, visual-only 10s ("شما وارد حصار مکانی ... شدید.")
  | 'both_approaching_exit'    // Scenario 'both': 80% R <= d < 98% R moving outward (scaled exit sonar)
  | 'both_exit_border_5hz'     // Scenario 'both': 98% R <= d <= 100% R moving outward (5 Hz sonar, max 10s)
  | 'both_exited_visual_10s';  // Scenario 'both': crossed border to > 100% R, visual-only 10s ("شما از حصار مکانی ... خارج شدید.")

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
  initialDistance: number;
  targetDistance: number; // Distance to scenario target (center for 'enter', boundary |R - d| for 'exit' & 'both')
  radius: number;
  latitude: number;
  longitude: number;
  playAudio: boolean;
}

interface DistanceSample {
  distance: number;
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
  // Scenario 'enter'
  enterCycleCompleted: boolean;
  center5HzStartMs: number;
  // Scenario 'exit'
  wasInsideForExit: boolean;
  exitCycleCompleted: boolean;
  // Scenario 'both'
  wasInsideBorder?: boolean;
  bothDirectionLock: 'inward' | 'outward' | null;
  border5HzStartMs: number;
  // Shared 10-second visual-only completion banner timer
  visual10sStartMs: number;
  visualCrossingType: 'enter_center' | 'exit_crossed' | 'both_entered' | 'both_exited' | null;
  // Dismissed / acknowledged for current phase
  acknowledgedUntilExit: boolean;
}

const scenarioRuntimeMap = new Map<string, ItemScenarioRuntimeState>();

function getOrCreateRuntimeState(key: string, nowMs: number = Date.now()): ItemScenarioRuntimeState {
  let st = scenarioRuntimeMap.get(key);
  if (!st) {
    st = {
      samples: [],
      trend: 'stationary',
      lastMoveRefDistance: Number.NaN,
      lastSignificantMoveMs: nowMs,
      lastInwardMoveMs: nowMs,
      lastOutwardMoveMs: 0,
      lastPhaseTransitionMs: 0,
      enterCycleCompleted: false,
      center5HzStartMs: 0,
      wasInsideForExit: false,
      exitCycleCompleted: false,
      wasInsideBorder: undefined,
      bothDirectionLock: null,
      border5HzStartMs: 0,
      visual10sStartMs: 0,
      visualCrossingType: null,
      acknowledgedUntilExit: false,
    };
    scenarioRuntimeMap.set(key, st);
  }
  return st;
}

/**
 * 5-Sample Moving Average Trend & Stationary Detector:
 * Records up to 5 position/distance samples, computes smoothed distance, and determines
 * whether the user's distance is decreasing ('inward'), increasing ('outward'), or 'stationary'.
 */
export function recordAndAnalyzeDistanceTrend(
  itemKey: string,
  distanceMeters: number,
  nowMs: number = Date.now()
): 'inward' | 'outward' | 'stationary' {
  const st = getOrCreateRuntimeState(itemKey, nowMs);
  const lastSample = st.samples[st.samples.length - 1];

  if (Number.isNaN(st.lastMoveRefDistance)) {
    st.lastMoveRefDistance = distanceMeters;
    st.lastSignificantMoveMs = nowMs;
    st.lastInwardMoveMs = nowMs;
  } else {
    const diffFromRef = distanceMeters - st.lastMoveRefDistance;
    if (Math.abs(diffFromRef) >= 2.0) {
      if (diffFromRef <= -2.0) {
        st.lastInwardMoveMs = nowMs;
      } else if (diffFromRef >= 2.0) {
        st.lastOutwardMoveMs = nowMs;
      }
      st.lastMoveRefDistance = distanceMeters;
      st.lastSignificantMoveMs = nowMs;
    }
  }

  // Record sample if first sample, or if at least 800ms elapsed or distance changed by >= 1m
  if (
    !lastSample ||
    nowMs - lastSample.timestamp >= 800 ||
    Math.abs(distanceMeters - lastSample.distance) >= 1
  ) {
    st.samples.push({ distance: distanceMeters, timestamp: nowMs });
    if (st.samples.length > 5) {
      st.samples.shift();
    }
  }

  if (st.samples.length < 2) {
    return st.trend;
  }

  // Compare smoothed moving average of older half vs newer half across the up-to-5 sample window
  const n = st.samples.length;
  const splitIdx = Math.max(1, Math.floor(n / 2));
  const olderSlice = st.samples.slice(0, splitIdx);
  const newerSlice = st.samples.slice(splitIdx);

  const olderAvg =
    olderSlice.reduce((sum, s) => sum + s.distance, 0) / Math.max(1, olderSlice.length);
  const newerAvg =
    newerSlice.reduce((sum, s) => sum + s.distance, 0) / Math.max(1, newerSlice.length);
  const totalDelta = st.samples[n - 1].distance - st.samples[0].distance;
  const avgDelta = newerAvg - olderAvg;

  // Threshold of 1.2m net change prevents stationary GPS jitter from flipping direction
  if (avgDelta <= -1.2 || totalDelta <= -2.0) {
    st.trend = 'inward';
    st.lastInwardMoveMs = nowMs;
  } else if (avgDelta >= 1.2 || totalDelta >= 2.0) {
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
  const sum = st.samples.reduce((acc, s) => acc + s.distance, 0);
  return Math.round(sum / st.samples.length);
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
 * Resets cached inside/outside proximity state for a specific location/reminder (or all items if omitted).
 * Must be called whenever a geofence is created, edited, radius-adjusted, or re-activated so that
 * if the user is currently inside the boundary, the alert triggers immediately.
 */
export function resetGeofenceProximityState(itemId?: string): void {
  if (!itemId) {
    proximityStateMap.clear();
    lastTransitionTimeMap.clear();
    scenarioRuntimeMap.clear();
  } else {
    const cleanId = itemId.replace(/^(loc_|rem_)/, '');
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
 * Marks a geofence item as acknowledged by the user ("توقف عملیات") for the current stay,
 * ensuring the alert process and submarine sonar stop completely.
 */
export function acknowledgeGeofenceAlert(itemId?: string): void {
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
      locState.visual10sStartMs = 0;
      locState.center5HzStartMs = 0;
      locState.border5HzStartMs = 0;
    }
    const remState = scenarioRuntimeMap.get(`rem_${cleanId}`);
    if (remState) {
      remState.acknowledgedUntilExit = true;
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
 * Evaluates a single geofence item (location or reminder) against the unified 3 scenarios ('enter', 'exit', 'both'):
 * - Golden Rule 1: Direction-aware trend (5-sample moving average) + 15s stationary pause so parked/still users never get endless alarms.
 * - Golden Rule 2: Unified boundary R (100% map circle is always the true boundary across enter, exit, and both).
 * - Golden Rule 3: Minimum physical zone width max(10% R, 15m) for 5 Hz + 10s phase cooldown hysteresis.
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
    now,
    isEn,
  } = params;

  const safeRadius = Math.max(20, radius || 100);
  const st = getOrCreateRuntimeState(itemKey, now);
  const trend = recordAndAnalyzeDistanceTrend(itemKey, rawDistance, now);
  const distance = getSmoothedDistance(itemKey, rawDistance);

  // Golden Rule 3: Physical minimum width max(10% R, 15m) so GPS never skips the 5 Hz zone
  const zoneWidthMeters = Math.min(Math.floor(safeRadius * 0.45), Math.max(15, Math.round(safeRadius * 0.1)));
  const centerZoneMeters = zoneWidthMeters;
  const borderZoneStartMeters = Math.max(centerZoneMeters + 2, safeRadius - zoneWidthMeters);

  // =========================================================================
  // SCENARIO 1: ENTER ONLY ('enter')
  // =========================================================================
  if (triggerOn === 'enter') {
    // Reset cycle when user is clearly outside the boundary (+8m hysteresis)
    if (distance > safeRadius + 8) {
      st.enterCycleCompleted = false;
      st.center5HzStartMs = 0;
      st.visual10sStartMs = 0;
      st.visualCrossingType = null;
      st.acknowledgedUntilExit = false;
      return null;
    }

    if (st.acknowledgedUntilExit || st.enterCycleCompleted) {
      return null;
    }

    // 1A. Central target zone (d <= max(10% R, 15m)) -> 10s of 5 Hz then 10s visual banner
    if (distance <= centerZoneMeters || st.center5HzStartMs > 0) {
      if (st.center5HzStartMs === 0) {
        st.center5HzStartMs = now;
      }
      const elapsed5Hz = now - st.center5HzStartMs;
      if (elapsed5Hz < 10_000) {
        const remSec = Math.max(1, Math.ceil((10_000 - elapsed5Hz) / 1000));
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
          sonarIntervalMs: 200, // 5 Hz
          isVisualOnly: false,
          phaseRemainingSeconds: remSec,
          initialDistance: distance,
          targetDistance: distance,
          radius: safeRadius,
          latitude,
          longitude,
          playAudio,
        };
      }

      // After 10s of 5 Hz -> 10s visual-only banner: "شما در مرکز حصار مکانی ... هستید."
      if (st.visual10sStartMs === 0) {
        st.visual10sStartMs = now;
        st.visualCrossingType = 'enter_center';
      }
      const elapsedVisual = now - st.visual10sStartMs;
      if (elapsedVisual < 10_000) {
        const remSec = Math.max(1, Math.ceil((10_000 - elapsedVisual) / 1000));
        const msg = isEn
          ? `You are at the center of geofence «${title}».`
          : `شما در مرکز حصار مکانی «${title}» هستید.`;
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
          sonarIntervalMs: 200,
          isVisualOnly: true,
          visualBannerMessage: msg,
          phaseRemainingSeconds: remSec,
          initialDistance: distance,
          targetDistance: distance,
          radius: safeRadius,
          latitude,
          longitude,
          playAudio: false,
        };
      }

      // 10s visual completed: finish cycle for this stay, keep geofence switch enabled
      st.enterCycleCompleted = true;
      st.center5HzStartMs = 0;
      st.visual10sStartMs = 0;
      return null;
    }

    // 1B. Inside boundary (centerZone < d <= R):
    // Golden Rule 1: Play sonar only when moving inward or within 15s of last inward movement (pauses if parked >=15s or moving outward)
    if (distance <= safeRadius) {
      const isActivelyApproaching =
        trend === 'inward' || (trend !== 'outward' && now - st.lastInwardMoveMs < 15_000);
      if (!isActivelyApproaching) {
        return null;
      }

      const intervalMs = computeSubmarineSonarIntervalMs(distance, safeRadius, 'enter');
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
        sonarIntervalMs: intervalMs,
        isVisualOnly: false,
        initialDistance: distance,
        targetDistance: distance, // Distance to center
        radius: safeRadius,
        latitude,
        longitude,
        playAudio,
      };
    }

    return null;
  }

  // =========================================================================
  // SCENARIO 2: EXIT ONLY ('exit') — Direction-Aware Outward Departure
  // =========================================================================
  if (triggerOn === 'exit') {
    // 2A. In the central zone (d <= max(10% R, 15m)): silent & armed for exit
    if (distance <= centerZoneMeters) {
      st.wasInsideForExit = true;
      st.exitCycleCompleted = false;
      st.border5HzStartMs = 0;
      st.visual10sStartMs = 0;
      st.acknowledgedUntilExit = false;
      return null;
    }

    // 2B. Inside boundary (centerZone < d <= R):
    if (distance <= safeRadius) {
      st.wasInsideForExit = true;
      st.exitCycleCompleted = false;
      st.visual10sStartMs = 0;
      if (st.acknowledgedUntilExit) {
        return null;
      }

      // Golden Rule 1: Only trigger exit sonar when actively moving outward (or within 10s of outward movement)
      const isActivelyMovingOutward =
        trend === 'outward' || (trend !== 'inward' && st.lastOutwardMoveMs > 0 && now - st.lastOutwardMoveMs < 10_000);
      if (!isActivelyMovingOutward) {
        st.border5HzStartMs = 0;
        return null;
      }

      const distToBorder = Math.max(0, safeRadius - distance);
      const isBorderZone = distance >= borderZoneStartMeters;

      if (isBorderZone) {
        if (st.border5HzStartMs === 0) {
          st.border5HzStartMs = now;
        }
        const elapsed5Hz = now - st.border5HzStartMs;
        if (elapsed5Hz >= 10_000) {
          // 10s cap reached while waiting near border
          return null;
        }
        const remSec = Math.max(1, Math.ceil((10_000 - elapsed5Hz) / 1000));
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
          sonarIntervalMs: 200, // 5 Hz
          isVisualOnly: false,
          phaseRemainingSeconds: remSec,
          initialDistance: distance,
          targetDistance: distToBorder,
          radius: safeRadius,
          latitude,
          longitude,
          playAudio,
        };
      }

      st.border5HzStartMs = 0;
      const intervalMs = computeSubmarineSonarIntervalMs(distance, safeRadius, 'exit');
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
        sonarIntervalMs: intervalMs,
        isVisualOnly: false,
        initialDistance: distance,
        targetDistance: distToBorder,
        radius: safeRadius,
        latitude,
        longitude,
        playAudio,
      };
    }

    // 2C. Crossed outside the boundary (distance > safeRadius) after being inside
    if (st.wasInsideForExit && !st.exitCycleCompleted && !st.acknowledgedUntilExit) {
      st.border5HzStartMs = 0;
      if (st.visual10sStartMs === 0) {
        st.visual10sStartMs = now;
        st.visualCrossingType = 'exit_crossed';
      }
      const elapsedVisual = now - st.visual10sStartMs;
      if (elapsedVisual < 10_000) {
        const remSec = Math.max(1, Math.ceil((10_000 - elapsedVisual) / 1000));
        const msg = isEn
          ? `You exited geofence «${title}».`
          : `شما از حصار مکانی «${title}» خارج شدید.`;
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
          sonarIntervalMs: 200,
          isVisualOnly: true,
          visualBannerMessage: msg,
          phaseRemainingSeconds: remSec,
          initialDistance: distance,
          targetDistance: 0,
          radius: safeRadius,
          latitude,
          longitude,
          playAudio: false,
        };
      }

      st.exitCycleCompleted = true;
      st.wasInsideForExit = false;
      st.visual10sStartMs = 0;
    }

    return null;
  }

  // =========================================================================
  // SCENARIO 3: BOTH ENTER & EXIT ('both') — Unified Boundary R + Direction-Aware
  // =========================================================================
  const isCurrentlyInside = distance <= safeRadius;
  const isClearlyOutside = distance > safeRadius + 6;

  // Detect boundary crossing transition (with 10s phase cooldown hysteresis)
  if (st.wasInsideBorder === undefined) {
    st.wasInsideBorder = isCurrentlyInside;
    if (isCurrentlyInside) {
      st.wasInsideForExit = true;
    }
  } else if (!st.wasInsideBorder && isCurrentlyInside) {
    // Just entered boundary from outside!
    st.wasInsideBorder = true;
    st.wasInsideForExit = true;
    st.enterCycleCompleted = false;
    st.exitCycleCompleted = false;
    st.acknowledgedUntilExit = false;
    st.bothDirectionLock = 'inward';
    st.lastInwardMoveMs = now;
    st.lastPhaseTransitionMs = now;
    st.border5HzStartMs = 0;
    st.visual10sStartMs = now;
    st.visualCrossingType = 'both_entered';
  } else if (st.wasInsideBorder && isClearlyOutside) {
    // Just exited boundary from inside! Stop sonar & show 10s visual exit banner
    st.wasInsideBorder = false;
    st.bothDirectionLock = null;
    st.lastPhaseTransitionMs = now;
    st.border5HzStartMs = 0;
    st.center5HzStartMs = 0;
    st.visual10sStartMs = now;
    st.visualCrossingType = 'both_exited';
  }

  // Active 10-second visual-only banner (on border entry, center arrival, or border exit)
  if (st.visual10sStartMs > 0 && st.visualCrossingType !== null) {
    const elapsedVisual = now - st.visual10sStartMs;
    if (elapsedVisual < 10_000) {
      const remSec = Math.max(1, Math.ceil((10_000 - elapsedVisual) / 1000));
      const cType = st.visualCrossingType;
      const msg =
        cType === 'enter_center'
          ? isEn
            ? `You are at the center of geofence «${title}».`
            : `شما در مرکز حصار مکانی «${title}» هستید.`
          : cType === 'both_entered'
          ? isEn
            ? `You entered geofence «${title}».`
            : `شما وارد حصار مکانی «${title}» شدید.`
          : isEn
          ? `You exited geofence «${title}».`
          : `شما از حصار مکانی «${title}» خارج شدید.`;

      // Note: If the user just crossed inward ('both_entered') and is actively moving toward the center,
      // once the 10s entry visual finishes (or if they reach the center), the inward sonar continues seamlessly.
      if (cType === 'both_exited' || cType === 'enter_center') {
        return {
          id: `alert_${itemKey}`,
          targetType,
          targetId,
          locationTitle: title,
          description,
          triggerType: cType === 'enter_center' ? 'arrived_under_10m' : 'exit',
          triggerOn: 'both',
          scenarioPhase: cType === 'enter_center' ? 'enter_center_visual_10s' : 'both_exited_visual_10s',
          sonarMode: cType === 'enter_center' ? 'enter' : 'exit',
          sonarIntervalMs: 200,
          isVisualOnly: true,
          visualBannerMessage: msg,
          phaseRemainingSeconds: remSec,
          initialDistance: distance,
          targetDistance: 0,
          radius: safeRadius,
          latitude,
          longitude,
          playAudio: false,
        };
      }
    } else {
      if (st.visualCrossingType === 'enter_center') {
        st.enterCycleCompleted = true;
      } else if (st.visualCrossingType === 'both_exited') {
        st.exitCycleCompleted = true;
      }
      st.visual10sStartMs = 0;
      st.visualCrossingType = null;
    }
  }

  if (!isCurrentlyInside || st.acknowledgedUntilExit) {
    return null;
  }

  // Inside the boundary (d <= R):
  // 3A. Reached central target zone (d <= max(10% R, 15m))
  if (!st.enterCycleCompleted && (distance <= centerZoneMeters || st.center5HzStartMs > 0)) {
    if (st.center5HzStartMs === 0) {
      st.center5HzStartMs = now;
      st.lastPhaseTransitionMs = now;
    }
    const elapsed5Hz = now - st.center5HzStartMs;
    if (elapsed5Hz < 10_000) {
      const remSec = Math.max(1, Math.ceil((10_000 - elapsed5Hz) / 1000));
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
        sonarIntervalMs: 200, // 5 Hz
        isVisualOnly: false,
        phaseRemainingSeconds: remSec,
        initialDistance: distance,
        targetDistance: distance,
        radius: safeRadius,
        latitude,
        longitude,
        playAudio,
      };
    }

    // Transition to 10s visual center banner
    st.center5HzStartMs = 0;
    st.visual10sStartMs = now;
    st.visualCrossingType = 'enter_center';
    st.lastPhaseTransitionMs = now;
    const msg = isEn
      ? `You are at the center of geofence «${title}».`
      : `شما در مرکز حصار مکانی «${title}» هستید.`;
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
      sonarIntervalMs: 200,
      isVisualOnly: true,
      visualBannerMessage: msg,
      phaseRemainingSeconds: 10,
      initialDistance: distance,
      targetDistance: distance,
      radius: safeRadius,
      latitude,
      longitude,
      playAudio: false,
    };
  }

  // 3B. Moving Outward toward the boundary (after 10s phase cooldown from entry/center)
  const cooldownElapsed = now - st.lastPhaseTransitionMs >= 10_000;
  const isMovingOutward =
    cooldownElapsed &&
    distance > centerZoneMeters &&
    (trend === 'outward' || (st.bothDirectionLock === 'outward' && trend !== 'inward' && now - st.lastOutwardMoveMs < 10_000));

  if (isMovingOutward) {
    st.bothDirectionLock = 'outward';
    const distToBorder = Math.max(0, safeRadius - distance);
    const isBorderZone = distance >= borderZoneStartMeters;

    if (isBorderZone) {
      if (st.border5HzStartMs === 0) {
        st.border5HzStartMs = now;
      }
      const elapsed5Hz = now - st.border5HzStartMs;
      if (elapsed5Hz >= 10_000) {
        return null;
      }
      const remSec = Math.max(1, Math.ceil((10_000 - elapsed5Hz) / 1000));
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
        sonarIntervalMs: 200, // 5 Hz
        isVisualOnly: false,
        phaseRemainingSeconds: remSec,
        initialDistance: distance,
        targetDistance: distToBorder,
        radius: safeRadius,
        latitude,
        longitude,
        playAudio,
      };
    }

    st.border5HzStartMs = 0;
    const intervalMs = computeSubmarineSonarIntervalMs(distance, safeRadius, 'exit');
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
      sonarIntervalMs: intervalMs,
      isVisualOnly: false,
      initialDistance: distance,
      targetDistance: distToBorder,
      radius: safeRadius,
      latitude,
      longitude,
      playAudio,
    };
  }

  // 3C. Moving Inward toward the center (when entry cycle not yet completed and not stationary >= 15s)
  const isMovingInward =
    !st.enterCycleCompleted &&
    (trend === 'inward' || (trend !== 'outward' && now - st.lastInwardMoveMs < 15_000));

  if (isMovingInward) {
    st.bothDirectionLock = 'inward';
    st.border5HzStartMs = 0;
    const intervalMs = computeSubmarineSonarIntervalMs(distance, safeRadius, 'enter');
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
      sonarIntervalMs: intervalMs,
      isVisualOnly: false,
      initialDistance: distance,
      targetDistance: distance,
      radius: safeRadius,
      latitude,
      longitude,
      playAudio,
    };
  }

  return null;
}

/**
 * Evaluates all active saved locations and location-based reminders across the 3 scenarios
 * ('enter', 'exit', 'both') and returns all currently active alerts sorted by shortest targetDistance
 * (so the highest-priority alert is always at index 0).
 */
export function evaluateAllActiveGeofenceScenarios(
  userPos: { latitude: number; longitude: number },
  reminders: Reminder[] = [],
  locations: SavedLocation[] = [],
  language: 'fa' | 'en' = 'fa',
  formatLocTitle?: (title: string, lang?: 'fa' | 'en') => string
): EvaluatedGeofenceAlertItem[] {
  const now = Date.now();
  const isEn = language === 'en';
  const activeAlerts: EvaluatedGeofenceAlertItem[] = [];

  for (const loc of locations) {
    if (loc.deletedAt || !loc.geofence || !loc.geofence.enabled) continue;
    const distance = calculateHaversineDistance(
      userPos.latitude,
      userPos.longitude,
      loc.latitude,
      loc.longitude
    );
    const displayTitle = formatLocTitle ? formatLocTitle(loc.title, language) : loc.title;
    const details = [loc.description, loc.geofence.customMessage].filter(Boolean).join(' — ');

    const evaluated = evaluateSingleItemScenario({
      itemKey: `loc_${loc.id}`,
      targetType: 'location',
      targetId: loc.id,
      title: displayTitle,
      description: details || undefined,
      latitude: loc.latitude,
      longitude: loc.longitude,
      radius: loc.geofence.radius || 100,
      triggerOn: loc.geofence.triggerOn || 'both',
      playAudio: loc.geofence.playAudio !== false,
      distance,
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
      (rem.status !== 'pending' && rem.status !== 'postponed') ||
      !rem.geofence ||
      !rem.geofence.enabled
    ) {
      continue;
    }
    const distance = calculateHaversineDistance(
      userPos.latitude,
      userPos.longitude,
      rem.geofence.latitude,
      rem.geofence.longitude
    );
    const locName = rem.geofence.locationName || rem.title;

    const evaluated = evaluateSingleItemScenario({
      itemKey: `rem_${rem.id}`,
      targetType: 'reminder',
      targetId: rem.id,
      title: locName,
      description: rem.description || rem.title,
      latitude: rem.geofence.latitude,
      longitude: rem.geofence.longitude,
      radius: rem.geofence.radius || 100,
      triggerOn: rem.geofence.triggerOn || 'enter',
      playAudio: true,
      distance,
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
 * Syncs active geofences with the native Android background service (YaadGeofenceService)
 * so geofence monitoring continues reliably even when the user is outside the app or the app is closed.
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

    if (enabled) {
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
          cooldownMs: 15 * 1000,
        });
      }

      for (const rem of reminders) {
        if (
          rem.deletedAt ||
          (rem.status !== 'pending' && rem.status !== 'postponed') ||
          !rem.geofence ||
          !rem.geofence.enabled
        ) {
          continue;
        }
        items.push({
          id: `rem_${rem.id}`,
          type: 'reminder',
          title: rem.title || (isEn ? 'Location Reminder' : 'یادآور مکانی'),
          description: rem.description || '',
          latitude: rem.geofence.latitude,
          longitude: rem.geofence.longitude,
          radius: rem.geofence.radius || 100,
          triggerOn: rem.geofence.triggerOn || 'enter',
          customMessage: rem.description || rem.geofence.locationName || '',
          playAudio: true,
          cooldownMs: 15 * 1000,
        });
      }
    }

    const payload = JSON.stringify({
      enabled: enabled && items.length > 0,
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

  for (const r of reminders) {
    if (
      r.deletedAt ||
      (r.status !== 'pending' && r.status !== 'postponed') ||
      !r.geofence ||
      !r.geofence.enabled
    ) {
      continue;
    }
    const d = calculateHaversineDistance(
      userPos.latitude,
      userPos.longitude,
      r.geofence.latitude,
      r.geofence.longitude
    );
    const rad = r.geofence.radius || 100;
    if (!nearest || d < nearest.distance) {
      nearest = { distance: d, radius: rad };
    }
  }

  return nearest;
}

/**
 * Calculates adaptive polling interval (in milliseconds) based on distance
 * to the nearest active geofence boundary.
 */
export function getAdaptivePollingInterval(
  userPos: { latitude: number; longitude: number },
  reminders: Reminder[] = [],
  locations: SavedLocation[] = []
): number {
  const activeReminderGeofences = reminders.filter(
    (r) =>
      !r.deletedAt &&
      (r.status === 'pending' || r.status === 'postponed') &&
      r.geofence &&
      r.geofence.enabled
  );
  const activeLocationGeofences = locations.filter(
    (l) => !l.deletedAt && l.geofence && l.geofence.enabled
  );

  if (activeReminderGeofences.length === 0 && activeLocationGeofences.length === 0) {
    return 60000 * 2;
  }

  let minBoundaryDistance = Infinity;
  let minCenterDistance = Infinity;
  for (const r of activeReminderGeofences) {
    if (!r.geofence) continue;
    const centerDist = calculateHaversineDistance(
      userPos.latitude,
      userPos.longitude,
      r.geofence.latitude,
      r.geofence.longitude
    );
    const radius = r.geofence.radius || 100;
    const boundaryDist = Math.abs(centerDist - radius);
    if (boundaryDist < minBoundaryDistance) {
      minBoundaryDistance = boundaryDist;
    }
    if (centerDist < minCenterDistance) {
      minCenterDistance = centerDist;
    }
  }

  for (const l of activeLocationGeofences) {
    const centerDist = calculateHaversineDistance(
      userPos.latitude,
      userPos.longitude,
      l.latitude,
      l.longitude
    );
    const radius = l.geofence?.radius || 100;
    const boundaryDist = Math.abs(centerDist - radius);
    if (boundaryDist < minBoundaryDistance) {
      minBoundaryDistance = boundaryDist;
    }
    if (centerDist < minCenterDistance) {
      minCenterDistance = centerDist;
    }
  }

  if (minCenterDistance <= 250 || minBoundaryDistance < 250) {
    return 2000; // 2 seconds when inside or within 250m of boundary for smooth 5-sample trend detection
  } else if (minBoundaryDistance < 600) {
    return 5000;
  } else if (minBoundaryDistance < 1500) {
    return 12000;
  } else {
    return 25000;
  }
}

export function evaluateGeofences(
  userPos: UserPosition,
  reminders: Reminder[],
  onTrigger: (event: GeofenceTriggerEvent) => void
): Reminder[] {
  const updatedReminders: Reminder[] = [];
  const now = Date.now();
  let stateChanged = false;
  const DEBOUNCE_MS = 15 * 1000;

  for (const reminder of reminders) {
    if (
      reminder.deletedAt ||
      (reminder.status !== 'pending' && reminder.status !== 'postponed') ||
      !reminder.geofence ||
      !reminder.geofence.enabled
    ) {
      continue;
    }

    const { latitude, longitude, radius = 100, triggerOn = 'enter' } = reminder.geofence;
    const distance = calculateHaversineDistance(
      userPos.latitude,
      userPos.longitude,
      latitude,
      longitude
    );

    const proximityKey = `rem_${reminder.id}`;
    const under10mKey = `u10m_rem_${reminder.id}`;
    const isInsideNow = distance <= radius;
    const isDefinitelyOutside = distance > radius + 8;
    const isUnder10mNow = distance <= Math.max(10, Math.round(radius * 0.1));

    const wasInsideNotified = proximityStateMap.get(proximityKey);
    const wasUnder10mNotified = proximityStateMap.get(under10mKey);
    const lastTrigTime = lastTransitionTimeMap.get(proximityKey) || 0;

    if (isDefinitelyOutside && wasUnder10mNotified === true) {
      proximityStateMap.set(under10mKey, false);
      stateChanged = true;
    }

    if (
      triggerOn === 'enter' &&
      isInsideNow &&
      isUnder10mNow &&
      wasInsideNotified !== true &&
      wasUnder10mNotified !== true
    ) {
      proximityStateMap.set(under10mKey, true);
      proximityStateMap.set(proximityKey, true);
      lastTransitionTimeMap.set(proximityKey, now);
      stateChanged = true;

      const updatedReminder: Reminder = {
        ...reminder,
        geofence: {
          ...reminder.geofence,
          lastTriggeredAt: now,
          hasTriggered: true,
        },
      };
      updatedReminders.push(updatedReminder);
      onTrigger({
        reminder: updatedReminder,
        triggerType: 'arrived_under_10m',
        distance,
        timestamp: now,
      });
      continue;
    }

    let shouldTrigger = false;
    let eventType: 'enter' | 'exit' = 'enter';

    if (isInsideNow) {
      if (wasInsideNotified !== true) {
        if (triggerOn === 'enter' || triggerOn === 'both') {
          if (now - lastTrigTime >= DEBOUNCE_MS) {
            shouldTrigger = true;
            eventType = 'enter';
          }
        } else {
          proximityStateMap.set(proximityKey, true);
          stateChanged = true;
        }
      }
    } else if (isDefinitelyOutside) {
      if (wasInsideNotified === true) {
        if (triggerOn === 'exit' || triggerOn === 'both') {
          if (now - lastTrigTime >= DEBOUNCE_MS) {
            shouldTrigger = true;
            eventType = 'exit';
          }
        } else {
          proximityStateMap.set(proximityKey, false);
          stateChanged = true;
        }
      } else if (wasInsideNotified === undefined) {
        proximityStateMap.set(proximityKey, false);
        stateChanged = true;
      }
    }

    if (shouldTrigger) {
      proximityStateMap.set(proximityKey, eventType === 'enter');
      lastTransitionTimeMap.set(proximityKey, now);
      stateChanged = true;

      const updatedReminder: Reminder = {
        ...reminder,
        geofence: {
          ...reminder.geofence,
          lastTriggeredAt: now,
          hasTriggered: true,
        },
      };

      updatedReminders.push(updatedReminder);

      onTrigger({
        reminder: updatedReminder,
        triggerType: eventType,
        distance,
        timestamp: now,
      });
    }
  }

  if (stateChanged) {
    saveProximityStateToStorage();
  }

  return updatedReminders;
}

export function evaluateSavedLocationGeofences(
  userPos: UserPosition,
  locations: SavedLocation[],
  onTrigger: (event: SavedLocationTriggerEvent) => void
): SavedLocation[] {
  const updatedLocations: SavedLocation[] = [];
  const now = Date.now();
  let stateChanged = false;
  const DEBOUNCE_MS = 15 * 1000;

  for (const location of locations) {
    if (location.deletedAt || !location.geofence || !location.geofence.enabled) {
      continue;
    }

    const radius = location.geofence.radius || 100;
    const triggerOn = location.geofence.triggerOn || 'both';
    const distance = calculateHaversineDistance(
      userPos.latitude,
      userPos.longitude,
      location.latitude,
      location.longitude
    );

    const proximityKey = `loc_${location.id}`;
    const under10mKey = `u10m_loc_${location.id}`;
    const isInsideNow = distance <= radius;
    const isDefinitelyOutside = distance > radius + 8;
    const isUnder10mNow = distance <= Math.max(10, Math.round(radius * 0.1));

    const wasInsideNotified = proximityStateMap.get(proximityKey);
    const wasUnder10mNotified = proximityStateMap.get(under10mKey);
    const lastTrigTime = lastTransitionTimeMap.get(proximityKey) || 0;

    if (isDefinitelyOutside && wasUnder10mNotified === true) {
      proximityStateMap.set(under10mKey, false);
      stateChanged = true;
    }

    if (
      triggerOn === 'enter' &&
      isInsideNow &&
      isUnder10mNow &&
      wasInsideNotified !== true &&
      wasUnder10mNotified !== true
    ) {
      proximityStateMap.set(under10mKey, true);
      proximityStateMap.set(proximityKey, true);
      lastTransitionTimeMap.set(proximityKey, now);
      stateChanged = true;

      const updatedLoc: SavedLocation = {
        ...location,
        geofence: {
          ...location.geofence,
          lastTriggeredAt: now,
          hasTriggered: true,
        },
      };
      updatedLocations.push(updatedLoc);
      onTrigger({
        location: updatedLoc,
        triggerType: 'arrived_under_10m',
        distance,
        timestamp: now,
      });
      continue;
    }

    let shouldTrigger = false;
    let eventType: 'enter' | 'exit' = 'enter';

    if (isInsideNow) {
      if (wasInsideNotified !== true) {
        if (triggerOn === 'enter' || triggerOn === 'both') {
          if (now - lastTrigTime >= DEBOUNCE_MS) {
            shouldTrigger = true;
            eventType = 'enter';
          }
        } else {
          proximityStateMap.set(proximityKey, true);
          stateChanged = true;
        }
      }
    } else if (isDefinitelyOutside) {
      if (wasInsideNotified === true) {
        if (triggerOn === 'exit' || triggerOn === 'both') {
          if (now - lastTrigTime >= DEBOUNCE_MS) {
            shouldTrigger = true;
            eventType = 'exit';
          }
        } else {
          proximityStateMap.set(proximityKey, false);
          stateChanged = true;
        }
      } else if (wasInsideNotified === undefined) {
        proximityStateMap.set(proximityKey, false);
        stateChanged = true;
      }
    }

    if (shouldTrigger) {
      proximityStateMap.set(proximityKey, eventType === 'enter');
      lastTransitionTimeMap.set(proximityKey, now);
      stateChanged = true;

      const updatedLoc: SavedLocation = {
        ...location,
        geofence: {
          ...location.geofence,
          lastTriggeredAt: now,
          hasTriggered: true,
        },
      };

      updatedLocations.push(updatedLoc);

      onTrigger({
        location: updatedLoc,
        triggerType: eventType,
        distance,
        timestamp: now,
      });
    }
  }

  if (stateChanged) {
    saveProximityStateToStorage();
  }

  return updatedLocations;
}

/**
 * Checks if user is inside a saved location's geofence radius
 */
export function isLocationInGeofence(
  userPos: { latitude: number; longitude: number },
  location: SavedLocation
): { isInside: boolean; distance: number } | null {
  if (!location.geofence) return null;
  const distance = calculateHaversineDistance(
    userPos.latitude,
    userPos.longitude,
    location.latitude,
    location.longitude
  );
  return {
    isInside: distance <= (location.geofence.radius || 100),
    distance,
  };
}

import { Reminder, SavedLocation } from '../types';

// Storage key for user preference on background geofence tracking
export const GEOFENCE_TRACKING_ENABLED_KEY = 'yaad_geofence_tracking_enabled_v1';
export const LAST_KNOWN_POSITION_KEY = 'yaad_last_known_user_position_v1';
export const GEOFENCE_PROXIMITY_STATE_KEY = 'yaad_geofence_proximity_state_v1';

export interface UserPosition {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
}

export interface GeofenceTriggerEvent {
  reminder: Reminder;
  triggerType: 'enter' | 'exit';
  distance: number;
  timestamp: number;
}

export interface SavedLocationTriggerEvent {
  location: SavedLocation;
  triggerType: 'enter' | 'exit';
  distance: number;
  timestamp: number;
}

// Memory + persisted tracking of previously checked status (inside or outside geofence)
// Map of id -> boolean (true = currently inside, false = outside)
const proximityStateMap = new Map<string, boolean>();

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
    if (val === null) return false; // Disabled by default until enabled inside the app
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
          latitude: loc.latitude,
          longitude: loc.longitude,
          radius: loc.geofence.radius || 200,
          triggerOn: loc.geofence.triggerOn || 'enter',
          customMessage: loc.geofence.customMessage || '',
          playAudio: loc.geofence.playAudio !== false,
          cooldownMs: 3 * 60 * 1000,
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
          latitude: rem.geofence.latitude,
          longitude: rem.geofence.longitude,
          radius: rem.geofence.radius || 200,
          triggerOn: rem.geofence.triggerOn || 'enter',
          customMessage: rem.description || rem.geofence.locationName || '',
          playAudio: true,
          cooldownMs: 10 * 60 * 1000,
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
 * Calculates adaptive polling interval (in milliseconds) based on distance
 * to the nearest active geofence boundary (supports radii up to 10km) to preserve battery.
 */
export function getAdaptivePollingInterval(
  userPos: { latitude: number; longitude: number },
  reminders: Reminder[] = [],
  locations: SavedLocation[] = []
): number {
  const activeReminderGeofences = reminders.filter(
    (r) => !r.deletedAt && (r.status === 'pending' || r.status === 'postponed') && r.geofence && r.geofence.enabled
  );
  const activeLocationGeofences = locations.filter(
    (l) => !l.deletedAt && l.geofence && l.geofence.enabled
  );

  if (activeReminderGeofences.length === 0 && activeLocationGeofences.length === 0) {
    return 60000 * 5; // 5 minutes when no location checkpoints are active
  }

  let minBoundaryDistance = Infinity;
  for (const r of activeReminderGeofences) {
    if (!r.geofence) continue;
    const centerDist = calculateHaversineDistance(
      userPos.latitude,
      userPos.longitude,
      r.geofence.latitude,
      r.geofence.longitude
    );
    const radius = r.geofence.radius || 200;
    const boundaryDist = Math.abs(centerDist - radius);
    if (boundaryDist < minBoundaryDistance) {
      minBoundaryDistance = boundaryDist;
    }
  }

  for (const l of activeLocationGeofences) {
    const centerDist = calculateHaversineDistance(
      userPos.latitude,
      userPos.longitude,
      l.latitude,
      l.longitude
    );
    const radius = l.geofence?.radius || 200;
    const boundaryDist = Math.abs(centerDist - radius);
    if (boundaryDist < minBoundaryDistance) {
      minBoundaryDistance = boundaryDist;
    }
  }

  if (minBoundaryDistance < 350) {
    return 10000; // 10 seconds: Very close to geofence boundary (< 350m)
  } else if (minBoundaryDistance < 1200) {
    return 25000; // 25 seconds: Nearby boundary (< 1.2km)
  } else if (minBoundaryDistance < 5000) {
    return 45000; // 45 seconds: Moderate distance (< 5km)
  } else {
    return 120000; // 2 minutes: Far away (> 5km)
  }
}

/**
 * Checks all active location-based reminders against the current user coordinates.
 * Returns a list of triggered reminders with trigger event details.
 */
export function evaluateGeofences(
  userPos: UserPosition,
  reminders: Reminder[],
  onTrigger: (event: GeofenceTriggerEvent) => void
): Reminder[] {
  const updatedReminders: Reminder[] = [];
  const now = Date.now();
  let stateChanged = false;

  for (const reminder of reminders) {
    if (
      reminder.deletedAt ||
      (reminder.status !== 'pending' && reminder.status !== 'postponed') ||
      !reminder.geofence ||
      !reminder.geofence.enabled
    ) {
      continue;
    }

    const { latitude, longitude, radius, triggerOn, lastTriggeredAt } = reminder.geofence;

    // Minimum cooldown between repeated triggers for the exact same reminder: 10 minutes
    const COOLDOWN_MS = 10 * 60 * 1000;
    if (lastTriggeredAt && now - lastTriggeredAt < COOLDOWN_MS) {
      continue;
    }

    const distance = calculateHaversineDistance(
      userPos.latitude,
      userPos.longitude,
      latitude,
      longitude
    );

    const isInsideNow = distance <= radius;
    const wasInsideBefore = proximityStateMap.get(reminder.id);

    // Save current status for future transitions
    if (wasInsideBefore !== isInsideNow) {
      proximityStateMap.set(reminder.id, isInsideNow);
      stateChanged = true;
    }

    let shouldTrigger = false;
    let eventType: 'enter' | 'exit' = 'enter';

    if (triggerOn === 'enter') {
      // Trigger if user is inside AND either we just entered or first check inside
      if (isInsideNow && (wasInsideBefore === false || wasInsideBefore === undefined)) {
        shouldTrigger = true;
        eventType = 'enter';
      }
    } else if (triggerOn === 'exit') {
      // Trigger if user just exited the zone
      if (!isInsideNow && wasInsideBefore === true) {
        shouldTrigger = true;
        eventType = 'exit';
      }
    } else if (triggerOn === 'both') {
      // Trigger on enter or exit transition
      if (wasInsideBefore !== undefined && isInsideNow !== wasInsideBefore) {
        shouldTrigger = true;
        eventType = isInsideNow ? 'enter' : 'exit';
      } else if (wasInsideBefore === undefined && isInsideNow) {
        shouldTrigger = true;
        eventType = 'enter';
      }
    }

    if (shouldTrigger) {
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

/**
 * Checks all saved locations with active geofence checkpoints against current user coordinates.
 */
export function evaluateSavedLocationGeofences(
  userPos: UserPosition,
  locations: SavedLocation[],
  onTrigger: (event: SavedLocationTriggerEvent) => void
): SavedLocation[] {
  const updatedLocations: SavedLocation[] = [];
  const now = Date.now();
  let stateChanged = false;

  for (const location of locations) {
    if (location.deletedAt || !location.geofence || !location.geofence.enabled) {
      continue;
    }

    const { radius, triggerOn, lastTriggeredAt } = location.geofence;

    // Minimum cooldown between repeated triggers for same location: 3 minutes
    const COOLDOWN_MS = 3 * 60 * 1000;
    if (lastTriggeredAt && now - lastTriggeredAt < COOLDOWN_MS) {
      continue;
    }

    const distance = calculateHaversineDistance(
      userPos.latitude,
      userPos.longitude,
      location.latitude,
      location.longitude
    );

    const isInsideNow = distance <= radius;
    const proximityKey = `loc_${location.id}`;
    const wasInsideBefore = proximityStateMap.get(proximityKey);

    // Save current status for future transitions
    if (wasInsideBefore !== isInsideNow) {
      proximityStateMap.set(proximityKey, isInsideNow);
      stateChanged = true;
    }

    let shouldTrigger = false;
    let eventType: 'enter' | 'exit' = 'enter';

    if (triggerOn === 'enter') {
      if (isInsideNow && (wasInsideBefore === false || wasInsideBefore === undefined)) {
        shouldTrigger = true;
        eventType = 'enter';
      }
    } else if (triggerOn === 'exit') {
      if (!isInsideNow && wasInsideBefore === true) {
        shouldTrigger = true;
        eventType = 'exit';
      }
    } else if (triggerOn === 'both') {
      if (wasInsideBefore !== undefined && isInsideNow !== wasInsideBefore) {
        shouldTrigger = true;
        eventType = isInsideNow ? 'enter' : 'exit';
      } else if (wasInsideBefore === undefined && isInsideNow) {
        shouldTrigger = true;
        eventType = 'enter';
      }
    }

    if (shouldTrigger) {
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
    isInside: distance <= (location.geofence.radius || 200),
    distance,
  };
}


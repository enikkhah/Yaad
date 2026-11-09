import { Reminder, SavedLocation } from '../types';

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
          cooldownMs: 15 * 1000, // 15s anti-jitter debounce
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
          cooldownMs: 15 * 1000, // 15s anti-jitter debounce
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
 * Returns the distance and radius of the nearest active geofence (for live submarine sonar rhythm modulation).
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
    (r) => !r.deletedAt && (r.status === 'pending' || r.status === 'postponed') && r.geofence && r.geofence.enabled
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

  if (minCenterDistance <= 250 || minBoundaryDistance < 200) {
    return 3000; // 3 seconds when inside or near boundary
  } else if (minBoundaryDistance < 600) {
    return 6000; // 6 seconds
  } else if (minBoundaryDistance < 1500) {
    return 15000; // 15 seconds
  } else {
    return 30000; // 30 seconds
  }
}

/**
 * Checks all active location-based reminders against the current user coordinates.
 * Uses hysteresis and only records state transition AFTER an alert is actually triggered.
 */
export function evaluateGeofences(
  userPos: UserPosition,
  reminders: Reminder[],
  onTrigger: (event: GeofenceTriggerEvent) => void
): Reminder[] {
  const updatedReminders: Reminder[] = [];
  const now = Date.now();
  let stateChanged = false;
  const DEBOUNCE_MS = 15 * 1000; // 15s debounce against GPS jitter

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

    // Entry matches exact radius (same as UI card). Exit uses +8m hysteresis so standing on the border doesn't flap.
    const isInsideNow = distance <= radius;
    const isDefinitelyOutside = distance > radius + 8;
    const isUnder10mNow = distance <= 12; // 10m + 2m GPS accuracy margin
    const isDefinitelyOutside10m = distance > 16;

    const wasInsideNotified = proximityStateMap.get(proximityKey);
    const wasUnder10mNotified = proximityStateMap.get(under10mKey);
    const lastTrigTime = lastTransitionTimeMap.get(proximityKey) || 0;

    // Reset sub-10m flag once user moves > 16m away
    if (isDefinitelyOutside10m && wasUnder10mNotified === true) {
      proximityStateMap.set(under10mKey, false);
      stateChanged = true;
    }

    // 1. Sub-10m exact target arrival (fires whenever entering <= 10-12m and not yet notified for this stay)
    if (isInsideNow && isUnder10mNow && wasUnder10mNotified !== true) {
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

    // 2. Boundary Entry / Exit matching
    let shouldTrigger = false;
    let eventType: 'enter' | 'exit' = 'enter';

    if (isInsideNow) {
      // User is inside the geofence boundary: if we haven't notified them for this stay yet, trigger 'enter'!
      if (wasInsideNotified !== true) {
        if (triggerOn === 'enter' || triggerOn === 'both') {
          if (now - lastTrigTime >= DEBOUNCE_MS) {
            shouldTrigger = true;
            eventType = 'enter';
          }
        } else {
          // triggerOn === 'exit': silently record that user is now inside so we can detect their future exit
          proximityStateMap.set(proximityKey, true);
          stateChanged = true;
        }
      }
    } else if (isDefinitelyOutside) {
      // User is outside the geofence boundary (beyond +8m hysteresis)
      if (wasInsideNotified === true) {
        if (triggerOn === 'exit' || triggerOn === 'both') {
          if (now - lastTrigTime >= DEBOUNCE_MS) {
            shouldTrigger = true;
            eventType = 'exit';
          }
        } else {
          // triggerOn === 'enter': reset state to false so next entry will trigger immediately!
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

/**
 * Checks all saved locations with active geofence checkpoints against current user coordinates.
 * Guarantees that whenever a location's distance is inside `radius` (`distance <= radius`) and hasn't been
 * notified for the current stay, the alert reliably triggers.
 */
export function evaluateSavedLocationGeofences(
  userPos: UserPosition,
  locations: SavedLocation[],
  onTrigger: (event: SavedLocationTriggerEvent) => void
): SavedLocation[] {
  const updatedLocations: SavedLocation[] = [];
  const now = Date.now();
  let stateChanged = false;
  const DEBOUNCE_MS = 15 * 1000; // 15s debounce against GPS jitter

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

    // Entry matches exact `distance <= radius` (100% consistent with SavedLocationCard "🟢 داخل محدوده")
    const isInsideNow = distance <= radius;
    const isDefinitelyOutside = distance > radius + 8;
    const isUnder10mNow = distance <= 12; // 10m + 2m GPS accuracy tolerance
    const isDefinitelyOutside10m = distance > 16;

    const wasInsideNotified = proximityStateMap.get(proximityKey);
    const wasUnder10mNotified = proximityStateMap.get(under10mKey);
    const lastTrigTime = lastTransitionTimeMap.get(proximityKey) || 0;

    // Reset sub-10m flag once user moves > 16m away
    if (isDefinitelyOutside10m && wasUnder10mNotified === true) {
      proximityStateMap.set(under10mKey, false);
      stateChanged = true;
    }

    // 1. Sub-10m Target Arrival inside boundary
    if (isInsideNow && isUnder10mNow && wasUnder10mNotified !== true) {
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

    // 2. Boundary Entry / Exit matching
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
          // triggerOn === 'exit': record inside state so subsequent exit triggers
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
          // triggerOn === 'enter': reset state to false so re-entering triggers reliably
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

import { Reminder, LocationGeofenceConfig, GeofenceTriggerType } from '../types';

// Storage key for user preference on background geofence tracking
export const GEOFENCE_TRACKING_ENABLED_KEY = 'yaad_geofence_tracking_enabled_v1';
export const LAST_KNOWN_POSITION_KEY = 'yaad_last_known_user_position_v1';

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

// Memory tracking of previously checked status (inside or outside geofence)
// Map of reminderId -> boolean (true = currently inside, false = outside)
const proximityStateMap = new Map<string, boolean>();

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
  if (typeof window === 'undefined') return true;
  try {
    const val = localStorage.getItem(GEOFENCE_TRACKING_ENABLED_KEY);
    if (val === null) return true; // Enabled by default
    return JSON.parse(val) === true;
  } catch {
    return true;
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
 * Calculates adaptive polling interval (in milliseconds) based on distance
 * to the nearest active location-based reminder to preserve battery.
 */
export function getAdaptivePollingInterval(
  userPos: { latitude: number; longitude: number },
  reminders: Reminder[]
): number {
  const activeGeofences = reminders.filter(
    (r) => r.status === 'pending' && r.geofence && r.geofence.enabled
  );

  if (activeGeofences.length === 0) {
    return 60000 * 5; // 5 minutes when no location reminders are active
  }

  let minDistance = Infinity;
  for (const r of activeGeofences) {
    if (!r.geofence) continue;
    const d = calculateHaversineDistance(
      userPos.latitude,
      userPos.longitude,
      r.geofence.latitude,
      r.geofence.longitude
    );
    if (d < minDistance) {
      minDistance = d;
    }
  }

  if (minDistance < 300) {
    return 10000; // 10 seconds: Very close (within 300m)
  } else if (minDistance < 1000) {
    return 30000; // 30 seconds: Nearby (within 1km)
  } else if (minDistance < 5000) {
    return 60000; // 1 minute: Moderate distance (within 5km)
  } else {
    return 180000; // 3 minutes: Far away (> 5km)
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

  for (const reminder of reminders) {
    if (reminder.status !== 'pending' || !reminder.geofence || !reminder.geofence.enabled) {
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
    proximityStateMap.set(reminder.id, isInsideNow);

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

  return updatedReminders;
}

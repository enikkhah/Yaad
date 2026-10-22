import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Filesystem } from '@capacitor/filesystem';
import { unlockAudio } from './audio';
import { 
  checkNotificationPermission, 
  requestNotificationPermission as rawRequestNotificationPermission 
} from './nativeLocalNotifications';
import {
  checkLocalFolderPermissionStatus,
  requestLocalFolderPermission,
  FOLDER_PERMISSION_GRANTED_KEY
} from './backupStorage';
import { getLastKnownPosition } from './geofenceManager';

export interface NativePermissionsStatus {
  notifications: boolean;
  microphone: boolean;
  camera: boolean;
  location: boolean;
  storage?: boolean;
}

export const PERM_NOTIF_GRANTED_KEY = 'yaad_perm_notif_granted';
export const PERM_MIC_GRANTED_KEY = 'yaad_perm_mic_granted';
export const PERM_CAM_GRANTED_KEY = 'yaad_perm_cam_granted';
export const PERM_LOC_GRANTED_KEY = 'yaad_perm_loc_granted';

export { requestLocalFolderPermission };

/**
 * Checks if the current environment is running inside Capacitor (Native Android APK / iOS)
 */
export function isNativeAndroidApp(): boolean {
  if (typeof window === 'undefined') return false;
  return Capacitor.isNativePlatform() || (window as any).isCapacitor === true;
}

/**
 * Helper to explicitly mark a permission as granted in localStorage when a feature succeeds
 */
export function markPermissionGranted(
  type: 'notifications' | 'microphone' | 'camera' | 'location' | 'storage'
): void {
  try {
    if (type === 'notifications') localStorage.setItem(PERM_NOTIF_GRANTED_KEY, 'true');
    else if (type === 'microphone') localStorage.setItem(PERM_MIC_GRANTED_KEY, 'true');
    else if (type === 'camera') localStorage.setItem(PERM_CAM_GRANTED_KEY, 'true');
    else if (type === 'location') localStorage.setItem(PERM_LOC_GRANTED_KEY, 'true');
    else if (type === 'storage') localStorage.setItem(FOLDER_PERMISSION_GRANTED_KEY, 'true');
  } catch {
    // Ignore storage errors
  }
}

/**
 * Request Notification Permission and persist granted state
 */
export async function requestNotificationPermission(): Promise<boolean> {
  const granted = await rawRequestNotificationPermission();
  if (granted) {
    markPermissionGranted('notifications');
    return true;
  }
  if (isNativeAndroidApp()) {
    try {
      const enabledRes = await LocalNotifications.areEnabled();
      if (enabledRes?.value === true) {
        markPermissionGranted('notifications');
        return true;
      }
    } catch {
      // ignore
    }
  }
  return false;
}

/**
 * Request Microphone Permission (forces Android OS / WebView permission prompt)
 */
export async function requestMicrophonePermission(): Promise<boolean> {
  unlockAudio();
  if (isNativeAndroidApp()) {
    try {
      const res = (await LocalNotifications.requestPermissions({
        permissions: ['microphone'],
      } as any)) as any;
      if (res?.microphone === 'granted') {
        markPermissionGranted('microphone');
        return true;
      }
      // Re-check via checkPermissions in case callback resolved display only
      const checkRes = (await LocalNotifications.checkPermissions()) as any;
      if (checkRes?.microphone === 'granted') {
        markPermissionGranted('microphone');
        return true;
      }
    } catch {
      // Fallback to getUserMedia below
    }
  }
  if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      markPermissionGranted('microphone');
      return true;
    } catch (err) {
      console.warn('Microphone permission request failed:', err);
    }
  }
  return false;
}

/**
 * Request Camera Permission (forces Android OS / WebView permission prompt)
 */
export async function requestCameraPermission(): Promise<boolean> {
  if (isNativeAndroidApp()) {
    try {
      const res = (await LocalNotifications.requestPermissions({
        permissions: ['camera'],
      } as any)) as any;
      if (res?.camera === 'granted') {
        markPermissionGranted('camera');
        return true;
      }
      const checkRes = (await LocalNotifications.checkPermissions()) as any;
      if (checkRes?.camera === 'granted') {
        markPermissionGranted('camera');
        return true;
      }
    } catch {
      // Fallback to getUserMedia below
    }
  }
  if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      stream.getTracks().forEach((track) => track.stop());
      markPermissionGranted('camera');
      return true;
    } catch (err) {
      console.warn('Camera permission request failed:', err);
    }
  }
  return false;
}

/**
 * Request GPS / Geolocation Permission (forces Android OS / WebView permission prompt)
 */
export async function requestLocationPermission(): Promise<boolean> {
  if (isNativeAndroidApp()) {
    try {
      const res = (await LocalNotifications.requestPermissions({
        permissions: ['location'],
      } as any)) as any;
      if (res?.location === 'granted') {
        markPermissionGranted('location');
        return true;
      }
      const checkRes = (await LocalNotifications.checkPermissions()) as any;
      if (checkRes?.location === 'granted') {
        markPermissionGranted('location');
        return true;
      }
    } catch {
      // Fallback to geolocation below
    }
  }
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return false;
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      () => {
        markPermissionGranted('location');
        resolve(true);
      },
      (err) => {
        // Error code 2 (POSITION_UNAVAILABLE) or 3 (TIMEOUT) means permission WAS granted (code 1 is PERMISSION_DENIED)
        if (err && typeof err.code === 'number' && err.code !== 1) {
          markPermissionGranted('location');
          resolve(true);
          return;
        }
        console.warn('Location permission request failed:', err);
        resolve(false);
      },
      { timeout: 8000, enableHighAccuracy: false, maximumAge: 60000 }
    );
  });
}

/**
 * Check current status for all native permissions (notifications, microphone, camera, location, storage)
 * Combines Native OS checks, Capacitor Filesystem/LocalNotifications, Browser Permissions API,
 * MediaDevices enumeration, Geolocation cache, and persisted grant flags so active permissions
 * are always accurately detected and highlighted in green.
 */
export async function checkAllPermissionsStatus(): Promise<NativePermissionsStatus> {
  const result: NativePermissionsStatus = {
    notifications: false,
    microphone: false,
    camera: false,
    location: false,
    storage: false,
  };

  if (typeof window === 'undefined') return result;

  // 1. Check Native Android OS permissions via Capacitor plugins
  let nativeExplicitNotifDenied = false;
  let nativeExplicitMicDenied = false;
  let nativeExplicitCamDenied = false;
  let nativeExplicitLocDenied = false;
  let nativeExplicitStorageChecked = false;

  if (isNativeAndroidApp()) {
    try {
      const [permsSettled, enabledSettled] = await Promise.allSettled([
        LocalNotifications.checkPermissions(),
        LocalNotifications.areEnabled(),
      ]);

      const nativePerms: any =
        permsSettled.status === 'fulfilled' ? permsSettled.value : null;
      const enabledRes: any =
        enabledSettled.status === 'fulfilled' ? enabledSettled.value : null;

      if (enabledRes?.value === true || nativePerms?.display === 'granted') {
        result.notifications = true;
        markPermissionGranted('notifications');
      } else if (enabledRes?.value === false && nativePerms?.display === 'denied') {
        nativeExplicitNotifDenied = true;
        try {
          localStorage.removeItem(PERM_NOTIF_GRANTED_KEY);
        } catch {}
      }

      if (nativePerms) {
        if (typeof nativePerms.microphone === 'string') {
          if (nativePerms.microphone === 'granted') {
            result.microphone = true;
            markPermissionGranted('microphone');
          } else if (nativePerms.microphone === 'denied') {
            nativeExplicitMicDenied = true;
            try {
              localStorage.removeItem(PERM_MIC_GRANTED_KEY);
            } catch {}
          }
        }
        if (typeof nativePerms.camera === 'string') {
          if (nativePerms.camera === 'granted') {
            result.camera = true;
            markPermissionGranted('camera');
          } else if (nativePerms.camera === 'denied') {
            nativeExplicitCamDenied = true;
            try {
              localStorage.removeItem(PERM_CAM_GRANTED_KEY);
            } catch {}
          }
        }
        if (typeof nativePerms.location === 'string') {
          if (nativePerms.location === 'granted') {
            result.location = true;
            markPermissionGranted('location');
          } else if (nativePerms.location === 'denied') {
            nativeExplicitLocDenied = true;
            try {
              localStorage.removeItem(PERM_LOC_GRANTED_KEY);
            } catch {}
          }
        }
        if (typeof nativePerms.storage === 'string') {
          nativeExplicitStorageChecked = true;
          if (nativePerms.storage === 'granted') {
            result.storage = true;
            markPermissionGranted('storage');
          } else {
            result.storage = false;
            try {
              localStorage.removeItem(FOLDER_PERMISSION_GRANTED_KEY);
            } catch {}
          }
        }
      }
    } catch {
      // Fallback below
    }
  }

  // 2. Check Notification & Local Folder Backup storage status accurately
  if (!result.notifications && !nativeExplicitNotifDenied) {
    const notifOk = await checkNotificationPermission();
    if (notifOk) {
      result.notifications = true;
      markPermissionGranted('notifications');
    } else if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'denied') {
      nativeExplicitNotifDenied = true;
      try {
        localStorage.removeItem(PERM_NOTIF_GRANTED_KEY);
      } catch {}
    }
  }

  if (!nativeExplicitStorageChecked) {
    const storageOk = await checkLocalFolderPermissionStatus();
    result.storage = storageOk;
  }

  // 3. Always check Browser / WebView Permissions API, enumerateDevices, and localStorage flags
  if (typeof window !== 'undefined' && 'Notification' in window) {
    if (Notification.permission === 'granted') {
      result.notifications = true;
      markPermissionGranted('notifications');
    }
  }

  if (navigator.permissions && navigator.permissions.query) {
    try {
      const notifStatus = await navigator.permissions.query({ name: 'notifications' as any });
      if (notifStatus.state === 'granted') {
        result.notifications = true;
        markPermissionGranted('notifications');
      } else if (notifStatus.state === 'denied' && !result.notifications) {
        nativeExplicitNotifDenied = true;
        try {
          localStorage.removeItem(PERM_NOTIF_GRANTED_KEY);
        } catch {}
      }
    } catch {
      // Ignore
    }

    try {
      const micStatus = await navigator.permissions.query({ name: 'microphone' as any });
      if (micStatus.state === 'granted') {
        result.microphone = true;
        markPermissionGranted('microphone');
      } else if (micStatus.state === 'denied' && !result.microphone) {
        try { localStorage.removeItem(PERM_MIC_GRANTED_KEY); } catch {}
      }
    } catch {
      // Ignore
    }

    try {
      const camStatus = await navigator.permissions.query({ name: 'camera' as any });
      if (camStatus.state === 'granted') {
        result.camera = true;
        markPermissionGranted('camera');
      } else if (camStatus.state === 'denied' && !result.camera) {
        try { localStorage.removeItem(PERM_CAM_GRANTED_KEY); } catch {}
      }
    } catch {
      // Ignore
    }

    try {
      const locStatus = await navigator.permissions.query({ name: 'geolocation' as any });
      if (locStatus.state === 'granted') {
        result.location = true;
        markPermissionGranted('location');
      } else if (locStatus.state === 'denied' && !result.location) {
        try { localStorage.removeItem(PERM_LOC_GRANTED_KEY); } catch {}
      }
    } catch {
      // Ignore
    }
  }

  if (typeof navigator !== 'undefined' && navigator.mediaDevices?.enumerateDevices) {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (!nativeExplicitMicDenied && devices.some((d) => d.kind === 'audioinput' && d.label && d.label.trim().length > 0)) {
        result.microphone = true;
        markPermissionGranted('microphone');
      }
      if (!nativeExplicitCamDenied && devices.some((d) => d.kind === 'videoinput' && d.label && d.label.trim().length > 0)) {
        result.camera = true;
        markPermissionGranted('camera');
      }
    } catch {
      // Ignore
    }
  }

  // If the app has already acquired a valid GPS position, Location permission is active
  try {
    if (!result.location && !nativeExplicitLocDenied && getLastKnownPosition() !== null) {
      result.location = true;
      markPermissionGranted('location');
    }
  } catch {
    // Ignore
  }

  // 4. Persisted grant state fallback (only when not explicitly denied by OS)
  try {
    if (!result.notifications && !nativeExplicitNotifDenied && localStorage.getItem(PERM_NOTIF_GRANTED_KEY) === 'true') {
      result.notifications = true;
    }
    if (!result.microphone && !nativeExplicitMicDenied && localStorage.getItem(PERM_MIC_GRANTED_KEY) === 'true') {
      result.microphone = true;
    }
    if (!result.camera && !nativeExplicitCamDenied && localStorage.getItem(PERM_CAM_GRANTED_KEY) === 'true') {
      result.camera = true;
    }
    if (!result.location && !nativeExplicitLocDenied && localStorage.getItem(PERM_LOC_GRANTED_KEY) === 'true') {
      result.location = true;
    }
  } catch {
    // Ignore
  }

  return result;
}

/**
 * Requests all essential native permissions (Notifications, Mic, Cam, Location, Local Folder YAAD REMIDER) with 1 click
 */
export async function requestAllNativePermissions(): Promise<NativePermissionsStatus> {
  const notifOk = await requestNotificationPermission();
  const folderRes = await requestLocalFolderPermission(false);
  const micOk = await requestMicrophonePermission();
  const camOk = await requestCameraPermission();
  const locOk = await requestLocationPermission();

  const checked = await checkAllPermissionsStatus();
  return {
    notifications: Boolean(checked.notifications || notifOk),
    microphone: Boolean(checked.microphone || micOk),
    camera: Boolean(checked.camera || camOk),
    location: Boolean(checked.location || locOk),
    storage: Boolean(checked.storage || folderRes.granted),
  };
}

export type AndroidPermissionType = 'notifications' | 'location' | 'microphone' | 'camera' | 'battery' | 'storage' | 'all_files' | 'app_details';

/**
 * Directs the user to the relevant Android Settings screen for the specified feature.
 * Note: On Android 11+ (API 30+), Folder / All Files Access (MANAGE_EXTERNAL_STORAGE) is NOT inside
 * standard "App Permissions"—it is located in "Special app access -> All files access"
 * (android.settings.MANAGE_APP_ALL_FILES_ACCESS_PERMISSION).
 */
export function openAndroidSettings(section: AndroidPermissionType = 'app_details'): void {
  if (typeof window === 'undefined') return;

  const pkg = 'com.yaad.reminder';
  let intentUrl = `intent:#Intent;action=android.settings.APPLICATION_DETAILS_SETTINGS;data=package:${pkg};end`;

  switch (section) {
    case 'notifications':
      // Directs to Android App Notification Settings
      intentUrl = `intent:#Intent;action=android.settings.APP_NOTIFICATION_SETTINGS;S.android.provider.extra.APP_PACKAGE=${pkg};end`;
      break;
    case 'location':
      // Directs to Android Location Source Settings
      intentUrl = `intent:#Intent;action=android.settings.LOCATION_SOURCE_SETTINGS;end`;
      break;
    case 'battery':
      // Directs to Android Battery Optimization settings
      intentUrl = `intent:#Intent;action=android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS;end`;
      break;
    case 'storage':
    case 'all_files':
      // On Android 11-15, Folder / All Files Access is in Special App Access -> All files access, NOT in App Permissions!
      intentUrl = `intent:#Intent;action=android.settings.MANAGE_APP_ALL_FILES_ACCESS_PERMISSION;data=package:${pkg};S.browser_fallback_url=${encodeURIComponent(
        `intent:#Intent;action=android.settings.MANAGE_ALL_FILES_ACCESS_PERMISSION;end`
      )};end`;
      break;
    case 'microphone':
    case 'camera':
    case 'app_details':
    default:
      // Directs to Application Info / Permissions page
      intentUrl = `intent:#Intent;action=android.settings.APPLICATION_DETAILS_SETTINGS;data=package:${pkg};end`;
      break;
  }

  try {
    const link = document.createElement('a');
    link.href = intentUrl;
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (err) {
    try {
      window.location.href = intentUrl;
    } catch {
      console.warn('Could not open Android settings:', err);
    }
  }
}

import { Capacitor } from '@capacitor/core';
import { unlockAudio } from './audio';
import { 
  checkNotificationPermission, 
  requestNotificationPermission 
} from './nativeLocalNotifications';
import {
  checkLocalFolderPermissionStatus,
  requestLocalFolderPermission
} from './backupStorage';

export interface NativePermissionsStatus {
  notifications: boolean;
  microphone: boolean;
  camera: boolean;
  location: boolean;
  storage?: boolean;
}

export { requestNotificationPermission, requestLocalFolderPermission };

/**
 * Checks if the current environment is running inside Capacitor (Native Android APK / iOS)
 */
export function isNativeAndroidApp(): boolean {
  if (typeof window === 'undefined') return false;
  return Capacitor.isNativePlatform() || (window as any).isCapacitor === true;
}

/**
 * Request Microphone Permission (forces Android WebView OS permission prompt)
 */
export async function requestMicrophonePermission(): Promise<boolean> {
  unlockAudio();
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return true; // Fallback: let SpeechRecognition prompt directly
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Stop tracks immediately after permission is granted
    stream.getTracks().forEach((track) => track.stop());
    return true;
  } catch (err) {
    console.warn('Microphone permission request failed:', err);
    return false;
  }
}

/**
 * Request Camera Permission (forces Android WebView OS permission prompt)
 */
export async function requestCameraPermission(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return false;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
    });
    stream.getTracks().forEach((track) => track.stop());
    return true;
  } catch (err) {
    console.warn('Camera permission request failed:', err);
    return false;
  }
}

/**
 * Request GPS / Geolocation Permission (forces Android WebView OS permission prompt)
 */
export async function requestLocationPermission(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return false;
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      () => resolve(true),
      (err) => {
        console.warn('Location permission request failed:', err);
        resolve(false);
      },
      { timeout: 8000, enableHighAccuracy: true }
    );
  });
}

/**
 * Check current status for all native permissions (microphone, camera, location)
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

  // 1. Notification & Local Folder permission
  result.notifications = await checkNotificationPermission();
  result.storage = await checkLocalFolderPermissionStatus();

  // 2. Permissions API query (Chrome / Chromium WebView)
  if (navigator.permissions && navigator.permissions.query) {
    try {
      const micStatus = await navigator.permissions.query({ name: 'microphone' as any });
      result.microphone = micStatus.state === 'granted';
    } catch {
      // Ignore
    }

    try {
      const camStatus = await navigator.permissions.query({ name: 'camera' as any });
      result.camera = camStatus.state === 'granted';
    } catch {
      // Ignore
    }

    try {
      const locStatus = await navigator.permissions.query({ name: 'geolocation' as any });
      result.location = locStatus.state === 'granted';
    } catch {
      // Ignore
    }
  }

  return result;
}

/**
 * Requests all essential native permissions (Notifications, Mic, Cam, Location, Local Folder YAAD REMIDER) with 1 click
 */
export async function requestAllNativePermissions(): Promise<NativePermissionsStatus> {
  const notifications = await requestNotificationPermission();
  const folderPerm = await requestLocalFolderPermission(false);
  const microphone = await requestMicrophonePermission();
  const camera = await requestCameraPermission();
  const location = await requestLocationPermission();

  return {
    notifications,
    microphone,
    camera,
    location,
    storage: folderPerm.granted,
  };
}

export type AndroidPermissionType = 'notifications' | 'location' | 'microphone' | 'camera' | 'battery' | 'storage' | 'app_details';

/**
 * Directs the user to the relevant Android Settings screen for the specified feature
 */
export function openAndroidSettings(section: AndroidPermissionType = 'app_details'): void {
  if (typeof window === 'undefined') return;

  const pkg = 'com.yaad.reminder';
  let intentUrl = `intent:#Intent;action=android.settings.APPLICATION_DETAILS_SETTINGS;package=${pkg};end`;

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

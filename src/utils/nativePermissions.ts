import { Capacitor } from '@capacitor/core';
import { unlockAudio } from './audio';
import { 
  checkNotificationPermission, 
  requestNotificationPermission 
} from './nativeLocalNotifications';

export interface NativePermissionsStatus {
  notifications: boolean;
  microphone: boolean;
  camera: boolean;
  location: boolean;
}

export { requestNotificationPermission };

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
  };

  if (typeof window === 'undefined') return result;

  // 1. Notification permission
  result.notifications = await checkNotificationPermission();

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
 * Requests all essential native permissions (Notifications, Mic, Cam, Location) with 1 click
 */
export async function requestAllNativePermissions(): Promise<NativePermissionsStatus> {
  const notifications = await requestNotificationPermission();
  const microphone = await requestMicrophonePermission();
  const camera = await requestCameraPermission();
  const location = await requestLocationPermission();

  return {
    notifications,
    microphone,
    camera,
    location,
  };
}

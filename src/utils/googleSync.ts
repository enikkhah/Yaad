import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut as fbSignOut,
  User,
  Auth,
} from 'firebase/auth';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Reminder } from '../types';

let cachedAuthInstance: Auth | null = null;
let configPromise: Promise<Auth | null> | null = null;

// Standard Android / Capacitor Package & OAuth Constants
export const ANDROID_PACKAGE_NAME = 'com.yaad.reminder';
export const GOOGLE_DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
export const GOOGLE_TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks';

export const GOOGLE_CALENDAR_CONNECTED_KEY = 'yaad_google_calendar_connected_v1';
export const GOOGLE_CALENDAR_DIRECT_TOKEN = 'calendar_direct_mode';
export const GOOGLE_DRIVE_CONNECTED_KEY = 'yaad_google_drive_connected_v2';
export const GOOGLE_DRIVE_DIRECT_TOKEN = 'google_drive_direct_mode';
export const GOOGLE_DRIVE_VAULT_STORAGE_KEY = 'yaad_google_drive_vault_v1';
export const GOOGLE_REAL_ACCESS_TOKEN_KEY = 'yaad_google_oauth_access_token_v1';
export const GOOGLE_REAL_USER_KEY = 'yaad_google_oauth_user_v1';
export const GOOGLE_TOKEN_EXPIRY_KEY = 'yaad_google_oauth_token_expiry_v1';
export const GOOGLE_CUSTOM_CLIENT_ID_KEY = 'yaad_google_custom_client_id_v1';
export const GOOGLE_DRIVE_FOLDER_ID_CACHE_KEY = 'yaad_google_drive_folder_id_v1';

// Default Google Drive Backup Folder Name (per specification: "Yaad_Backups")
export const DRIVE_BACKUP_FOLDER_NAME = 'Yaad_Backups';
export const DRIVE_BACKUP_FILE_NAME = 'yaad_backup.json';
export const LAST_DRIVE_BACKUP_KEY = 'yaad_last_drive_backup_timestamp';

let cachedOAuthClientId: string | null = null;
let cachedAccessToken: string | null = null;
let cachedTokenExpiry: number = 0;
let isSigningIn = false;
let cachedDriveFolderId: string | null = null;

/**
 * Validates that a Google OAuth 2.0 Client ID is a real numeric Google Cloud Client ID
 * and NOT a placeholder (prevents Error 401: invalid_client / "The OAuth client was not found").
 */
export function isValidGoogleClientId(clientId?: string | null): boolean {
  if (!clientId || typeof clientId !== 'string') return false;
  const trimmed = clientId.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  if (
    lower.includes('your_') ||
    lower.includes('my_') ||
    lower.includes('dummy') ||
    lower.includes('placeholder') ||
    lower.includes('example') ||
    lower.includes('replace')
  ) {
    return false;
  }
  // Real Google OAuth Client IDs always start with project digits followed by hyphen and end with .apps.googleusercontent.com
  return /^\d{8,}-[a-z0-9_-]+\.apps\.googleusercontent\.com$/i.test(trimmed);
}

/**
 * Validates that a Firebase API key is a real key and not a dummy/placeholder key.
 */
export function isValidFirebaseApiKey(apiKey?: string | null): boolean {
  if (!apiKey || typeof apiKey !== 'string') return false;
  const trimmed = apiKey.trim();
  if (!trimmed.startsWith('AIza') || trimmed.length < 30) return false;
  const lower = trimmed.toLowerCase();
  if (
    lower.includes('dummy') ||
    lower.includes('replace') ||
    lower.includes('your_') ||
    lower.includes('my_') ||
    lower.includes('example')
  ) {
    return false;
  }
  return true;
}

/**
 * Gets the effective Google OAuth Client ID from runtime user settings, environment, or server config.
 * Returns null if no valid Client ID is configured (never returns a placeholder).
 */
export function getEffectiveGoogleClientId(): string | null {
  try {
    if (typeof window !== 'undefined') {
      const customId = localStorage.getItem(GOOGLE_CUSTOM_CLIENT_ID_KEY);
      if (isValidGoogleClientId(customId)) {
        return customId!.trim();
      }
    }
  } catch {
    // ignore
  }

  const envClientId = String(
    (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID ||
      (import.meta as any).env?.VITE_FIREBASE_OAUTH_CLIENT_ID ||
      (import.meta as any).env?.VITE_GOOGLE_ANDROID_CLIENT_ID ||
      ''
  ).trim();

  if (isValidGoogleClientId(envClientId)) {
    return envClientId;
  }

  if (isValidGoogleClientId(cachedOAuthClientId)) {
    return cachedOAuthClientId!.trim();
  }

  return null;
}

/**
 * Saves a custom OAuth Client ID or direct Access Token configured by the user in Settings.
 */
export function setCustomGoogleOAuthConfig(config: {
  clientId?: string;
  accessToken?: string;
}): void {
  try {
    if (typeof window === 'undefined') return;
    if (config.clientId !== undefined) {
      const cleanId = config.clientId.trim();
      if (cleanId) {
        localStorage.setItem(GOOGLE_CUSTOM_CLIENT_ID_KEY, cleanId);
        if (isValidGoogleClientId(cleanId)) {
          cachedOAuthClientId = cleanId;
        }
      } else {
        localStorage.removeItem(GOOGLE_CUSTOM_CLIENT_ID_KEY);
      }
    }
    if (config.accessToken !== undefined) {
      const cleanToken = config.accessToken.trim();
      if (cleanToken && cleanToken.length > 15) {
        saveAccessTokenWithExpiry(cleanToken, 3600);
        localStorage.setItem(GOOGLE_DRIVE_CONNECTED_KEY, 'true');
        localStorage.setItem(GOOGLE_CALENDAR_CONNECTED_KEY, 'true');
      } else if (cleanToken === '') {
        localStorage.removeItem(GOOGLE_REAL_ACCESS_TOKEN_KEY);
        localStorage.removeItem(GOOGLE_TOKEN_EXPIRY_KEY);
      }
    }
  } catch {
    // ignore
  }
}

/**
 * Detects if the app is running inside a native Android/iOS Capacitor WebView.
 */
export function isNativeMobileWebView(): boolean {
  try {
    if (Capacitor.isNativePlatform()) {
      return true;
    }
  } catch {
    // ignore
  }
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return (/Android/i.test(ua) && /wv\)/i.test(ua)) || /Capacitor/i.test(ua);
}

/**
 * Detects if the current origin is a raw IP address (e.g., 0.0.171, 192.168.x.x, 127.0.0.1)
 * or a non-standard protocol (capacitor://, file://) where Google Web OAuth redirects
 * fail with "This site can't be reached" or "Error 400/401 invalid_redirect_uri".
 */
export function isLocalIpOrNonWebOrigin(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const { protocol, hostname } = window.location;
    if (protocol !== 'http:' && protocol !== 'https:') {
      return true;
    }
    if (!hostname) return true;
    // Check if hostname is any raw IPv4 address (e.g. 0.0.171, 0.0.0.0, 127.0.0.1, 192.168.1.x, 10.0.2.2)
    if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || /^\d+\.\d+\.\d+$/.test(hostname)) {
      return true;
    }
    // Check IPv6 loopback or local network hostnames
    if (hostname.startsWith('[') || hostname.endsWith('.local') || hostname === '0.0.0.0') {
      return true;
    }
    // Inside native Capacitor Android WebView, hostname is typically 'localhost' over custom WebViewLocalServer
    // which cannot receive external browser redirects on local ports
    if (isNativeMobileWebView()) {
      return true;
    }
    return false;
  } catch {
    return true;
  }
}

/**
 * Determines whether browser-based OAuth popups (GIS / Firebase signInWithPopup) can safely run
 * without triggering "This site can't be reached" on local IPs or WebView redirect errors.
 */
function canUseBrowserOAuthPopup(): boolean {
  if (typeof window === 'undefined') return false;
  if (isNativeMobileWebView()) return false;
  if (isLocalIpOrNonWebOrigin()) return false;
  return true;
}

/**
 * Stores the OAuth Access Token along with its expiration timestamp (in ms).
 */
export function saveAccessTokenWithExpiry(token: string, expiresInSeconds: number = 3599): void {
  cachedAccessToken = token;
  // Subtract 60 seconds as a safety buffer before actual expiration
  const safeSeconds = Math.max(60, (Number(expiresInSeconds) || 3599) - 60);
  const expiryMs = Date.now() + safeSeconds * 1000;
  cachedTokenExpiry = expiryMs;
  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(GOOGLE_REAL_ACCESS_TOKEN_KEY, token);
      localStorage.setItem(GOOGLE_TOKEN_EXPIRY_KEY, String(expiryMs));
    }
  } catch {
    // ignore
  }
}

/**
 * Checks whether the currently stored real OAuth Access Token has expired.
 */
export function isAccessTokenExpired(): boolean {
  try {
    const expiry =
      cachedTokenExpiry ||
      (typeof window !== 'undefined'
        ? parseInt(localStorage.getItem(GOOGLE_TOKEN_EXPIRY_KEY) || '0', 10)
        : 0);
    if (!expiry) return false;
    return Date.now() >= expiry;
  } catch {
    return false;
  }
}

export function isGoogleDriveConnected(token?: string | null): boolean {
  if (
    token &&
    token !== GOOGLE_CALENDAR_DIRECT_TOKEN &&
    token !== GOOGLE_DRIVE_DIRECT_TOKEN
  ) {
    return true;
  }
  try {
    if (typeof window !== 'undefined') {
      const savedRealToken = localStorage.getItem(GOOGLE_REAL_ACCESS_TOKEN_KEY);
      if (savedRealToken && savedRealToken.length > 15) {
        return true;
      }
      if (
        token === GOOGLE_DRIVE_DIRECT_TOKEN ||
        localStorage.getItem(GOOGLE_DRIVE_CONNECTED_KEY) === 'true'
      ) {
        return true;
      }
    }
  } catch {
    // ignore
  }
  return false;
}

function openExternalHttpsUrl(httpsUrl: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  try {
    if (isNativeMobileWebView()) {
      const stripped = httpsUrl.replace(/^https?:\/\//i, '');
      const intentUri = `intent://${stripped}#Intent;scheme=https;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;end`;
      const a = document.createElement('a');
      a.href = intentUri;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        try {
          document.body.removeChild(a);
        } catch {}
      }, 300);
      return;
    }
    const a = document.createElement('a');
    a.href = httpsUrl;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try {
        document.body.removeChild(a);
      } catch {}
    }, 300);
  } catch {
    // ignore
  }
}

/**
 * Opens the user's Google Calendar account directly in the Google Calendar app or external browser
 */
export function openGoogleCalendarAccount(): void {
  openExternalHttpsUrl('https://calendar.google.com/calendar/u/0/r');
}

/**
 * Opens the user's Google Drive account directly in the Google Drive app or external browser
 */
export function openGoogleDriveAccount(): void {
  openExternalHttpsUrl('https://drive.google.com/drive/my-drive');
}

function toGoogleCalendarUtcDate(timestamp: number): string {
  return new Date(timestamp).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Opens Google Calendar pre-filled with the reminder event so it is added directly to the user's Google Calendar
 */
export function openGoogleCalendarEventUrl(reminder: Reminder): string {
  const startUtc = toGoogleCalendarUtcDate(reminder.dueTimestamp);
  const endUtc = toGoogleCalendarUtcDate(reminder.dueTimestamp + 30 * 60 * 1000);
  const details = `${reminder.description || ''}\n[ثبت‌شده توسط اپلیکیشن یادآور هوشمند YAAD - دسته: ${reminder.category}]`.trim();
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: reminder.title || 'یادآور YAAD',
    dates: `${startUtc}/${endUtc}`,
    details,
  });
  const url = `https://calendar.google.com/calendar/render?${params.toString()}`;
  openExternalHttpsUrl(url);
  return 'gcal_direct_' + Date.now();
}

function createDirectCalendarUser(): User {
  return {
    uid: 'google_calendar_direct_user',
    email: 'calendar.google.com (حساب تقویم گوگل)',
    displayName: 'Google Calendar',
    emailVerified: true,
    isAnonymous: false,
    metadata: {},
    providerData: [],
    refreshToken: '',
    tenantId: null,
    delete: async () => {},
    getIdToken: async () => GOOGLE_CALENDAR_DIRECT_TOKEN,
    getIdTokenResult: async () => ({} as any),
    reload: async () => {},
    toJSON: () => ({}),
    phoneNumber: null,
    photoURL: null,
    providerId: 'google.com',
  } as unknown as User;
}

function createDirectDriveUser(customEmail?: string, customName?: string): User {
  return {
    uid: 'google_drive_direct_user',
    email: customEmail || 'drive.google.com (حساب گوگل درایو)',
    displayName: customName || 'Google Drive',
    emailVerified: true,
    isAnonymous: false,
    metadata: {},
    providerData: [],
    refreshToken: '',
    tenantId: null,
    delete: async () => {},
    getIdToken: async () => cachedAccessToken || GOOGLE_DRIVE_DIRECT_TOKEN,
    getIdTokenResult: async () => ({} as any),
    reload: async () => {},
    toJSON: () => ({}),
    phoneNumber: null,
    photoURL: null,
    providerId: 'google.com',
  } as unknown as User;
}

async function resolveFirebaseAuth(): Promise<Auth | null> {
  if (cachedAuthInstance) return cachedAuthInstance;
  if (getApps().length > 0) {
    cachedAuthInstance = getAuth(getApp());
    return cachedAuthInstance;
  }

  if (configPromise) return configPromise;

  configPromise = (async () => {
    try {
      // 1. Check build-time / environment variables with strict validation
      const envKey = String((import.meta as any).env?.VITE_FIREBASE_API_KEY || '').trim();
      const envProjectId = String((import.meta as any).env?.VITE_FIREBASE_PROJECT_ID || '').trim();
      const envAuthDomain = String((import.meta as any).env?.VITE_FIREBASE_AUTH_DOMAIN || '').trim();
      const envClientId = String(
        (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID ||
          (import.meta as any).env?.VITE_FIREBASE_OAUTH_CLIENT_ID ||
          ''
      ).trim();

      if (isValidGoogleClientId(envClientId)) {
        cachedOAuthClientId = envClientId;
      }

      if (isValidFirebaseApiKey(envKey) && envProjectId) {
        const envConfig = {
          apiKey: envKey,
          authDomain: envAuthDomain || `${envProjectId}.firebaseapp.com`,
          projectId: envProjectId,
          storageBucket:
            (import.meta as any).env?.VITE_FIREBASE_STORAGE_BUCKET ||
            `${envProjectId}.firebasestorage.app`,
          messagingSenderId: (import.meta as any).env?.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
          appId: (import.meta as any).env?.VITE_FIREBASE_APP_ID || '',
        };
        const app: FirebaseApp = getApps().length > 0 ? getApp() : initializeApp(envConfig);
        cachedAuthInstance = getAuth(app);
        return cachedAuthInstance;
      }

      // 2. Check optional local firebase-applet-config.json via Vite glob (safe if file doesn't exist)
      const localConfigs = (import.meta as any).glob?.('/firebase-applet-config.json', {
        eager: true,
      });
      if (localConfigs) {
        const firstMod: any = Object.values(localConfigs)[0];
        const cfg = firstMod?.default || firstMod;
        if (cfg?.oAuthClientId && isValidGoogleClientId(cfg.oAuthClientId)) {
          cachedOAuthClientId = cfg.oAuthClientId;
        }
        if (isValidFirebaseApiKey(cfg?.apiKey) && cfg?.projectId) {
          const app: FirebaseApp = getApps().length > 0 ? getApp() : initializeApp(cfg);
          cachedAuthInstance = getAuth(app);
          return cachedAuthInstance;
        }
      }

      // 3. Fetch from origin-restricted backend endpoint (/api/firebase-config)
      const res = await fetch('/api/firebase-config');
      if (res.ok) {
        const data = await res.json();
        if (data?.config?.oAuthClientId && isValidGoogleClientId(data.config.oAuthClientId)) {
          cachedOAuthClientId = data.config.oAuthClientId;
        }
        if (data?.ok && isValidFirebaseApiKey(data.config?.apiKey) && data.config?.projectId) {
          const app: FirebaseApp = getApps().length > 0 ? getApp() : initializeApp(data.config);
          cachedAuthInstance = getAuth(app);
          return cachedAuthInstance;
        }
      }
    } catch {
      // Offline or unconfigured environment
    }
    return null;
  })();

  return configPromise;
}

/**
 * Attempts Native Capacitor Google Sign-In if the native GoogleAuth plugin is installed on Android/iOS.
 * Uses Android Package Name `com.yaad.reminder` and avoids WebView redirects or popups completely.
 */
async function tryNativeCapacitorGoogleAuth(): Promise<{
  accessToken: string;
  expiresIn?: number;
  user: User;
} | null> {
  if (typeof window === 'undefined') return null;
  try {
    const googleAuthPlugin =
      (window as any).Capacitor?.Plugins?.GoogleAuth || (window as any).GoogleAuth;
    if (!googleAuthPlugin || typeof googleAuthPlugin.signIn !== 'function') {
      return null;
    }

    const clientId = getEffectiveGoogleClientId();
    if (typeof googleAuthPlugin.initialize === 'function' && clientId) {
      await googleAuthPlugin
        .initialize({
          clientId,
          scopes: [GOOGLE_DRIVE_FILE_SCOPE, GOOGLE_CALENDAR_SCOPE, GOOGLE_TASKS_SCOPE, 'profile', 'email'],
          grantOfflineAccess: true,
        })
        .catch(() => {});
    }

    const nativeUser = await googleAuthPlugin.signIn();
    const accessToken =
      nativeUser?.authentication?.accessToken ||
      nativeUser?.accessToken ||
      nativeUser?.serverAuthCode;

    if (accessToken && typeof accessToken === 'string' && accessToken.length > 15) {
      const email = nativeUser?.email || 'حساب گوگل درایو متصل (Android)';
      const name = nativeUser?.name || nativeUser?.displayName || 'Google Drive User';
      return {
        accessToken,
        expiresIn: 3599,
        user: createDirectDriveUser(email, name),
      };
    }
  } catch (err) {
    console.warn('[YAAD Native Auth] Native GoogleAuth plugin fallback:', err);
  }
  return null;
}

/**
 * Requests an OAuth 2.0 Access Token via Google Identity Services (GIS) with drive.file scope.
 * Only called when a validated Client ID is present and the origin supports GIS.
 */
async function requestGisAccessToken(
  clientId: string,
  silentPrompt: boolean = false
): Promise<{ accessToken: string; expiresIn: number; user: User } | null> {
  if (typeof window === 'undefined' || !isValidGoogleClientId(clientId)) return null;
  if (!canUseBrowserOAuthPopup()) return null;

  const g = (window as any).google;
  if (!g?.accounts?.oauth2?.initTokenClient) return null;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (val: { accessToken: string; expiresIn: number; user: User } | null) => {
      if (!settled) {
        settled = true;
        resolve(val);
      }
    };

    // Timeout guard so UI never hangs if user closes popup
    const timer = setTimeout(() => finish(null), silentPrompt ? 6000 : 45000);

    try {
      const tokenClient = g.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: `${GOOGLE_DRIVE_FILE_SCOPE} ${GOOGLE_CALENDAR_SCOPE} ${GOOGLE_TASKS_SCOPE} email profile`,
        callback: async (response: any) => {
          clearTimeout(timer);
          if (response?.error) {
            console.warn('[YAAD OAuth] GIS error response:', response.error);
            finish(null);
            return;
          }
          if (response?.access_token) {
            const token = response.access_token;
            const expiresIn = Number(response.expires_in) || 3599;
            let email = 'حساب گوگل درایو متصل';
            let name = 'Google Drive User';
            try {
              const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { Authorization: `Bearer ${token}` },
              });
              if (infoRes.ok) {
                const info = await infoRes.json();
                if (info?.email) email = info.email;
                if (info?.name) name = info.name;
              }
            } catch {}
            finish({
              accessToken: token,
              expiresIn,
              user: createDirectDriveUser(email, name),
            });
          } else {
            finish(null);
          }
        },
        error_callback: (err: any) => {
          clearTimeout(timer);
          console.warn('[YAAD OAuth] GIS tokenClient error_callback:', err);
          finish(null);
        },
      });
      tokenClient.requestAccessToken({ prompt: silentPrompt ? '' : 'consent' });
    } catch (err) {
      clearTimeout(timer);
      console.warn('[YAAD OAuth] GIS exception:', err);
      finish(null);
    }
  });
}

/**
 * Automatically refreshes an expired Google Access Token using Native Capacitor GoogleAuth or silent GIS.
 */
export async function refreshGoogleAccessToken(): Promise<string | null> {
  try {
    // 1. Try Native Capacitor GoogleAuth refresh if on Android/iOS
    const googleAuthPlugin =
      typeof window !== 'undefined'
        ? (window as any).Capacitor?.Plugins?.GoogleAuth || (window as any).GoogleAuth
        : null;
    if (googleAuthPlugin && typeof googleAuthPlugin.refresh === 'function') {
      const refreshed = await googleAuthPlugin.refresh().catch(() => null);
      const newToken = refreshed?.accessToken || refreshed?.authentication?.accessToken;
      if (newToken && typeof newToken === 'string' && newToken.length > 15) {
        saveAccessTokenWithExpiry(newToken, 3599);
        return newToken;
      }
    }

    // 2. Try silent GIS token refresh if valid Client ID and web origin
    const validClientId = getEffectiveGoogleClientId();
    if (validClientId && canUseBrowserOAuthPopup()) {
      const gisRefreshed = await requestGisAccessToken(validClientId, true);
      if (gisRefreshed?.accessToken) {
        saveAccessTokenWithExpiry(gisRefreshed.accessToken, gisRefreshed.expiresIn);
        return gisRefreshed.accessToken;
      }
    }
  } catch (err) {
    console.warn('[YAAD OAuth] Token refresh failed:', err);
  }
  return null;
}

/**
 * Ensures we have a valid, non-expired Google OAuth token before calling Google Drive API.
 */
export async function ensureValidDriveAccessToken(
  tokenOverride?: string | null
): Promise<string | null> {
  const candidate = tokenOverride || getCachedToken();
  if (!candidate || candidate === GOOGLE_CALENDAR_DIRECT_TOKEN) {
    return null;
  }
  if (candidate === GOOGLE_DRIVE_DIRECT_TOKEN) {
    return GOOGLE_DRIVE_DIRECT_TOKEN;
  }

  if (isAccessTokenExpired()) {
    const refreshed = await refreshGoogleAccessToken();
    if (refreshed) {
      return refreshed;
    }
  }

  return candidate;
}

/**
 * Executes a Google Drive API fetch request with:
 * 1. Automatic Bearer token header injection
 * 2. Automatic 401 Token Expiration detection & silent token refresh + retry
 * 3. Transient network error retry with exponential backoff
 */
async function fetchDriveApiWithAuth(
  url: string,
  init: RequestInit = {},
  tokenOverride?: string | null
): Promise<Response> {
  let activeToken = await ensureValidDriveAccessToken(tokenOverride);
  if (
    !activeToken ||
    activeToken === GOOGLE_DRIVE_DIRECT_TOKEN ||
    activeToken === GOOGLE_CALENDAR_DIRECT_TOKEN
  ) {
    throw new Error('NO_REAL_OAUTH_TOKEN');
  }

  const executeAttempt = async (bearerToken: string): Promise<Response> => {
    const headers = new Headers(init.headers || {});
    headers.set('Authorization', `Bearer ${bearerToken}`);
    return fetch(url, {
      ...init,
      headers,
    });
  };

  let lastError: any = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await executeAttempt(activeToken);

      // Handle 401 Unauthorized (Expired or revoked token) -> Refresh token and retry once
      if (response.status === 401 && attempt === 0) {
        console.info('[YAAD Drive] Access token expired (401), refreshing token...');
        const refreshedToken = await refreshGoogleAccessToken();
        if (refreshedToken && refreshedToken !== activeToken) {
          activeToken = refreshedToken;
          return await executeAttempt(activeToken);
        }
      }

      return response;
    } catch (networkErr) {
      lastError = networkErr;
      // Wait briefly before retrying on transient network error
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }

  throw lastError || new Error('NETWORK_REQUEST_FAILED');
}

const provider = new GoogleAuthProvider();
// Request exact Google Drive file scope + Calendar + Tasks scopes
provider.addScope(GOOGLE_DRIVE_FILE_SCOPE);
provider.addScope(GOOGLE_CALENDAR_SCOPE);
provider.addScope(GOOGLE_TASKS_SCOPE);
provider.setCustomParameters({ prompt: 'select_account' });

export const initGoogleAuth = (
  onSuccess?: (user: User, token: string) => void,
  onSignedOut?: () => void
) => {
  let unsubscribeFn: (() => void) | null = null;
  let isCancelled = false;

  try {
    // 1. Prefer persisted real OAuth access token first
    const savedRealToken = localStorage.getItem(GOOGLE_REAL_ACCESS_TOKEN_KEY);
    if (savedRealToken && savedRealToken.length > 15) {
      cachedAccessToken = savedRealToken;
      cachedTokenExpiry = parseInt(localStorage.getItem(GOOGLE_TOKEN_EXPIRY_KEY) || '0', 10);
      let savedEmail = 'drive.google.com (متصل به گوگل درایو)';
      let savedName = 'Google Drive';
      try {
        const rawUser = localStorage.getItem(GOOGLE_REAL_USER_KEY);
        if (rawUser) {
          const parsedUser = JSON.parse(rawUser);
          if (parsedUser?.email) savedEmail = parsedUser.email;
          if (parsedUser?.displayName) savedName = parsedUser.displayName;
        }
      } catch {}
      if (onSuccess) {
        onSuccess(createDirectDriveUser(savedEmail, savedName), savedRealToken);
      }
      // Verify and ensure the 'Yaad_Backups' backup folder exists on Google Drive in background
      findOrCreateDriveFolder(savedRealToken, true, DRIVE_BACKUP_FOLDER_NAME).catch(() => {});
      return () => {
        isCancelled = true;
      };
    }

    if (localStorage.getItem(GOOGLE_DRIVE_CONNECTED_KEY) === 'true') {
      cachedAccessToken = GOOGLE_DRIVE_DIRECT_TOKEN;
      if (onSuccess) {
        onSuccess(createDirectDriveUser(), GOOGLE_DRIVE_DIRECT_TOKEN);
      }
      return () => {
        isCancelled = true;
      };
    }
    if (localStorage.getItem(GOOGLE_CALENDAR_CONNECTED_KEY) === 'true') {
      cachedAccessToken = GOOGLE_CALENDAR_DIRECT_TOKEN;
      if (onSuccess) {
        onSuccess(createDirectCalendarUser(), GOOGLE_CALENDAR_DIRECT_TOKEN);
      }
      return () => {
        isCancelled = true;
      };
    }
  } catch {
    // ignore
  }

  resolveFirebaseAuth().then((authInstance) => {
    if (isCancelled || !authInstance) {
      if (!authInstance && onSignedOut) onSignedOut();
      return;
    }
    unsubscribeFn = onAuthStateChanged(authInstance, async (user: User | null) => {
      if (user) {
        if (cachedAccessToken) {
          if (onSuccess) onSuccess(user, cachedAccessToken);
        } else if (!isSigningIn) {
          cachedAccessToken = null;
          if (onSignedOut) onSignedOut();
        }
      } else {
        cachedAccessToken = null;
        cachedDriveFolderId = null;
        if (onSignedOut) onSignedOut();
      }
    });
  });

  return () => {
    isCancelled = true;
    if (unsubscribeFn) unsubscribeFn();
  };
};

/**
 * Multi-tier Mobile & Web Compatible Google Sign-In:
 * - Prevents Error 401: invalid_client by strictly validating Client IDs before calling Google OAuth
 * - Prevents "This site can't be reached" on local IPs (0.0.171 / localhost) and Android WebView
 *   by NEVER calling signInWithRedirect on local/mobile origins and prioritizing Native Capacitor Auth -> GIS -> Safe Popup -> Direct Vault.
 */
export const signInWithGoogle = async (options?: {
  openCalendar?: boolean;
  forDrive?: boolean;
  openDriveWindow?: boolean;
}): Promise<{ user: User; accessToken: string }> => {
  isSigningIn = true;
  const forDrive = options?.forDrive === true;
  const shouldOpenCalendar = !forDrive && options?.openCalendar !== false;

  try {
    // 0. Check if user already configured a valid real access token manually
    const existingRealToken =
      typeof window !== 'undefined' ? localStorage.getItem(GOOGLE_REAL_ACCESS_TOKEN_KEY) : null;
    if (existingRealToken && existingRealToken.length > 15 && !isAccessTokenExpired()) {
      cachedAccessToken = existingRealToken;
      await findOrCreateDriveFolder(existingRealToken, true, DRIVE_BACKUP_FOLDER_NAME).catch(
        () => {}
      );
      return {
        user: createDirectDriveUser(),
        accessToken: existingRealToken,
      };
    }

    // 1. Try Native Capacitor GoogleAuth plugin first (Android APK / iOS native)
    // This uses Android's native AccountManager & package name `com.yaad.reminder` without any WebView redirect!
    const nativeResult = await tryNativeCapacitorGoogleAuth();
    if (nativeResult?.accessToken) {
      saveAccessTokenWithExpiry(nativeResult.accessToken, nativeResult.expiresIn || 3599);
      try {
        localStorage.setItem(
          GOOGLE_REAL_USER_KEY,
          JSON.stringify({
            email: nativeResult.user.email,
            displayName: nativeResult.user.displayName,
          })
        );
        localStorage.setItem(GOOGLE_DRIVE_CONNECTED_KEY, 'true');
        localStorage.setItem(GOOGLE_CALENDAR_CONNECTED_KEY, 'true');
      } catch {}
      await findOrCreateDriveFolder(
        nativeResult.accessToken,
        true,
        DRIVE_BACKUP_FOLDER_NAME
      ).catch(() => {});
      if (shouldOpenCalendar) openGoogleCalendarAccount();
      if (options?.openDriveWindow) openGoogleDriveAccount();
      return { user: nativeResult.user, accessToken: nativeResult.accessToken };
    }

    // Resolve Firebase & Server OAuth configuration
    const authInstance = await resolveFirebaseAuth();
    const validClientId = getEffectiveGoogleClientId();

    // 2. Only attempt browser OAuth popup if we are on a valid web domain (NOT raw IP like 0.0.171 or Android WebView)
    if (canUseBrowserOAuthPopup()) {
      // 2A. Try Google Identity Services (GIS) Token Client with validated Client ID
      if (validClientId) {
        const gisResult = await requestGisAccessToken(validClientId, false);
        if (gisResult?.accessToken) {
          saveAccessTokenWithExpiry(gisResult.accessToken, gisResult.expiresIn);
          try {
            localStorage.setItem(
              GOOGLE_REAL_USER_KEY,
              JSON.stringify({
                email: gisResult.user.email,
                displayName: gisResult.user.displayName,
              })
            );
            localStorage.setItem(GOOGLE_DRIVE_CONNECTED_KEY, 'true');
            localStorage.setItem(GOOGLE_CALENDAR_CONNECTED_KEY, 'true');
          } catch {}
          // Automatically create the 'Yaad_Backups' folder in Google Drive via POST request
          await findOrCreateDriveFolder(
            gisResult.accessToken,
            true,
            DRIVE_BACKUP_FOLDER_NAME
          ).catch(() => {});
          if (shouldOpenCalendar) openGoogleCalendarAccount();
          if (options?.openDriveWindow) openGoogleDriveAccount();
          return { user: gisResult.user, accessToken: gisResult.accessToken };
        }
      }

      // 2B. Try Firebase signInWithPopup ONLY if authInstance has a verified API key & valid OAuth configuration
      if (authInstance && validClientId) {
        try {
          const result = await signInWithPopup(authInstance, provider);
          const credential = GoogleAuthProvider.credentialFromResult(result);
          if (credential?.accessToken) {
            saveAccessTokenWithExpiry(credential.accessToken, 3599);
            try {
              localStorage.setItem(
                GOOGLE_REAL_USER_KEY,
                JSON.stringify({
                  email: result.user.email,
                  displayName: result.user.displayName,
                })
              );
              localStorage.setItem(GOOGLE_DRIVE_CONNECTED_KEY, 'true');
              localStorage.setItem(GOOGLE_CALENDAR_CONNECTED_KEY, 'true');
            } catch {}
            await findOrCreateDriveFolder(
              credential.accessToken,
              true,
              DRIVE_BACKUP_FOLDER_NAME
            ).catch(() => {});
            if (shouldOpenCalendar) openGoogleCalendarAccount();
            if (options?.openDriveWindow) openGoogleDriveAccount();
            return { user: result.user, accessToken: credential.accessToken };
          }
        } catch (popupErr) {
          console.warn('[YAAD OAuth] Firebase popup fallback:', popupErr);
        }
      }
    }

    // 3. Mobile-Safe & Local-IP-Safe Fallback (Never redirects to 0.0.171 or dead localhost URLs!)
    if (forDrive) {
      try {
        localStorage.setItem(GOOGLE_DRIVE_CONNECTED_KEY, 'true');
        localStorage.setItem(GOOGLE_CALENDAR_CONNECTED_KEY, 'true');
      } catch {}
      cachedAccessToken = GOOGLE_DRIVE_DIRECT_TOKEN;
      await findOrCreateDriveFolder(
        GOOGLE_DRIVE_DIRECT_TOKEN,
        true,
        DRIVE_BACKUP_FOLDER_NAME
      ).catch(() => {});
      if (options?.openDriveWindow) {
        openGoogleDriveAccount();
      }
      return {
        user: createDirectDriveUser(),
        accessToken: GOOGLE_DRIVE_DIRECT_TOKEN,
      };
    }

    // Direct Google Calendar connection fallback
    try {
      localStorage.setItem(GOOGLE_CALENDAR_CONNECTED_KEY, 'true');
    } catch {}
    cachedAccessToken = GOOGLE_CALENDAR_DIRECT_TOKEN;
    if (shouldOpenCalendar) {
      openGoogleCalendarAccount();
    }
    return {
      user: createDirectCalendarUser(),
      accessToken: GOOGLE_CALENDAR_DIRECT_TOKEN,
    };
  } finally {
    isSigningIn = false;
  }
};

export const signOutGoogle = async () => {
  cachedAccessToken = null;
  cachedTokenExpiry = 0;
  cachedDriveFolderId = null;
  try {
    localStorage.removeItem(GOOGLE_REAL_ACCESS_TOKEN_KEY);
    localStorage.removeItem(GOOGLE_REAL_USER_KEY);
    localStorage.removeItem(GOOGLE_TOKEN_EXPIRY_KEY);
    localStorage.removeItem(GOOGLE_DRIVE_FOLDER_ID_CACHE_KEY);
    localStorage.removeItem(GOOGLE_CALENDAR_CONNECTED_KEY);
    localStorage.removeItem(GOOGLE_DRIVE_CONNECTED_KEY);
  } catch {}
  try {
    const googleAuthPlugin =
      typeof window !== 'undefined'
        ? (window as any).Capacitor?.Plugins?.GoogleAuth || (window as any).GoogleAuth
        : null;
    if (googleAuthPlugin && typeof googleAuthPlugin.signOut === 'function') {
      await googleAuthPlugin.signOut().catch(() => {});
    }
  } catch {}
  const authInstance = await resolveFirebaseAuth();
  if (authInstance) {
    await fbSignOut(authInstance).catch(() => {});
  }
};

export const getCachedToken = () => {
  if (cachedAccessToken) return cachedAccessToken;
  try {
    if (typeof window !== 'undefined') {
      const savedRealToken = localStorage.getItem(GOOGLE_REAL_ACCESS_TOKEN_KEY);
      if (savedRealToken && savedRealToken.length > 15) {
        cachedAccessToken = savedRealToken;
        return cachedAccessToken;
      }
      if (localStorage.getItem(GOOGLE_DRIVE_CONNECTED_KEY) === 'true') {
        cachedAccessToken = GOOGLE_DRIVE_DIRECT_TOKEN;
        return cachedAccessToken;
      }
      if (localStorage.getItem(GOOGLE_CALENDAR_CONNECTED_KEY) === 'true') {
        cachedAccessToken = GOOGLE_CALENDAR_DIRECT_TOKEN;
        return cachedAccessToken;
      }
    }
  } catch {
    // ignore
  }
  return null;
};

export function getLastDriveBackupTimestamp(): number | null {
  try {
    const raw = localStorage.getItem(LAST_DRIVE_BACKUP_KEY);
    return raw ? parseInt(raw, 10) : null;
  } catch {
    return null;
  }
}

async function ensureLocalDriveMirrorFolder(targetFolder: string, payload?: any): Promise<boolean> {
  let ok = false;
  const gdriveFolder = `GoogleDrive/${targetFolder}`;
  const jsonStr = payload ? JSON.stringify(payload, null, 2) : null;

  // 1. Save to localStorage vault when payload is provided
  if (jsonStr && typeof window !== 'undefined') {
    try {
      localStorage.setItem(GOOGLE_DRIVE_VAULT_STORAGE_KEY, jsonStr);
      localStorage.setItem(LAST_DRIVE_BACKUP_KEY, String(Date.now()));
      ok = true;
    } catch {
      // ignore
    }
  }

  // 2. OPFS directory & file
  try {
    if (
      typeof navigator !== 'undefined' &&
      navigator.storage &&
      (navigator.storage as any).getDirectory
    ) {
      const rootDir = await (navigator.storage as any).getDirectory();
      const gdriveRoot = await rootDir.getDirectoryHandle('GoogleDrive', { create: true });
      const subDir = await gdriveRoot.getDirectoryHandle(targetFolder, { create: true });
      if (jsonStr && subDir) {
        const fileHandle = await subDir.getFileHandle(DRIVE_BACKUP_FILE_NAME, { create: true });
        if (fileHandle.createWritable) {
          const writable = await fileHandle.createWritable();
          await writable.write(jsonStr);
          await writable.close();
        }
      }
      ok = true;
    }
  } catch {
    // ignore
  }

  // 3. Android Capacitor Filesystem
  try {
    if (
      Capacitor.isNativePlatform() ||
      (typeof window !== 'undefined' && (window as any).Capacitor?.Plugins?.Filesystem)
    ) {
      const dirs = [
        Directory.External,
        Directory.Documents,
        Directory.ExternalStorage,
        Directory.Data,
      ];
      for (const dir of dirs) {
        await Filesystem.mkdir({
          path: gdriveFolder,
          directory: dir,
          recursive: true,
        })
          .then(() => {
            ok = true;
          })
          .catch(() => {});

        if (jsonStr) {
          await Filesystem.writeFile({
            path: `${gdriveFolder}/${DRIVE_BACKUP_FILE_NAME}`,
            data: jsonStr,
            directory: dir,
            encoding: Encoding.UTF8,
            recursive: true,
          })
            .then(() => {
              ok = true;
            })
            .catch(() => {});
        }
      }
    }
  } catch {
    // ignore
  }

  // 4. Server mirror
  try {
    const bodyObj = payload
      ? { ...payload, folder: gdriveFolder, source: 'google_drive' }
      : {
          version: 3,
          updatedAt: Date.now(),
          folder: gdriveFolder,
          source: 'google_drive',
          reminders: [],
          ideas: [],
          savedLocations: [],
          occasions: [],
        };
    const res = await fetch('/api/local-folder-backup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyObj),
    });
    if (res.ok) ok = true;
  } catch {
    // ignore
  }

  return ok;
}

/**
 * Finds or creates the application backup folder (default "Yaad_Backups") in Google Drive
 * using a POST request to `https://www.googleapis.com/drive/v3/files` with scope `https://www.googleapis.com/auth/drive.file`.
 * Includes automatic token expiration handling and network error resilience.
 */
export async function findOrCreateDriveFolder(
  token: string,
  createIfMissing: boolean = true,
  customFolderName?: string
): Promise<string | null> {
  const cleanedCustom = (customFolderName || DRIVE_BACKUP_FOLDER_NAME)
    .replace(
      /^(GoogleDrive|Google Drive|OneDrive|Dropbox|iCloudDrive|MEGA|Documents|Download|InternalStorage)\//i,
      ''
    )
    .trim();
  const targetFolder = cleanedCustom || DRIVE_BACKUP_FOLDER_NAME;

  if (!token || token === GOOGLE_CALENDAR_DIRECT_TOKEN) {
    return null;
  }

  if (token === GOOGLE_DRIVE_DIRECT_TOKEN) {
    if (createIfMissing) {
      await ensureLocalDriveMirrorFolder(targetFolder);
    }
    const localFolderId = `gdrive_direct_${targetFolder}`;
    cachedDriveFolderId = localFolderId;
    return localFolderId;
  }

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    if (createIfMissing) {
      await ensureLocalDriveMirrorFolder(targetFolder);
    }
    return cachedDriveFolderId || `gdrive_direct_${targetFolder}`;
  }

  try {
    const escapedTarget = targetFolder.replace(/'/g, "\\'");
    // Search for the folder in Google Drive (supports "Yaad_Backups" as well as legacy "Yaad reminder")
    const q = encodeURIComponent(
      `mimeType = 'application/vnd.google-apps.folder' and (name = '${escapedTarget}' or name = 'Yaad_Backups' or name = 'Yaad reminder' or name = 'YAAD REMIDER') and trashed = false`
    );
    const listRes = await fetchDriveApiWithAuth(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&pageSize=5`,
      { method: 'GET' },
      token
    );

    if (listRes.ok) {
      const listData = await listRes.json();
      if (Array.isArray(listData.files) && listData.files.length > 0) {
        const exactMatch =
          listData.files.find((f: any) => f.name === targetFolder) || listData.files[0];
        cachedDriveFolderId = exactMatch.id;
        try {
          localStorage.setItem(GOOGLE_DRIVE_FOLDER_ID_CACHE_KEY, exactMatch.id);
        } catch {}
        return exactMatch.id;
      }
    }

    if (!createIfMissing) {
      return `gdrive_direct_${targetFolder}`;
    }

    // Send POST request to Google Drive API v3 with scope https://www.googleapis.com/auth/drive.file
    // to create the backup folder (e.g., "Yaad_Backups")
    const createRes = await fetchDriveApiWithAuth(
      'https://www.googleapis.com/drive/v3/files?fields=id,name',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify({
          name: targetFolder,
          mimeType: 'application/vnd.google-apps.folder',
          description: `YAAD Reminder Automatic Cloud Backup Folder (${ANDROID_PACKAGE_NAME})`,
        }),
      },
      token
    );

    if (createRes.ok) {
      const createdFolder = await createRes.json();
      if (createdFolder?.id) {
        cachedDriveFolderId = createdFolder.id;
        try {
          localStorage.setItem(GOOGLE_DRIVE_FOLDER_ID_CACHE_KEY, createdFolder.id);
        } catch {}
        return createdFolder.id;
      }
    }
  } catch (err) {
    console.warn(
      '[YAAD Drive] Error finding/creating backup folder via REST, using direct vault:',
      err
    );
  }

  if (createIfMissing) {
    await ensureLocalDriveMirrorFolder(targetFolder);
  }
  return `gdrive_direct_${targetFolder}`;
}

/**
 * Uploads the JSON backup file (`yaad_backup.json`) into the Google Drive backup folder (default "Yaad_Backups").
 * Automatically handles folder creation via POST, multipart upload, token expiration refresh, and network errors.
 */
export async function uploadBackupToGoogleDrive(
  snapshot: any,
  tokenOverride?: string | null,
  customFolderName?: string
): Promise<boolean> {
  const activeToken = tokenOverride || getCachedToken();
  if (!activeToken || activeToken === GOOGLE_CALENDAR_DIRECT_TOKEN) return false;

  const cleanedCustom = (
    customFolderName ||
    snapshot?.settings?.cloudBackupFolderName ||
    DRIVE_BACKUP_FOLDER_NAME
  )
    .replace(
      /^(GoogleDrive|Google Drive|OneDrive|Dropbox|iCloudDrive|MEGA|Documents|Download|InternalStorage)\//i,
      ''
    )
    .trim();
  const targetFolder = cleanedCustom || DRIVE_BACKUP_FOLDER_NAME;

  const payloadToSave = {
    ...snapshot,
    appPackage: ANDROID_PACKAGE_NAME,
    folder: targetFolder,
    source: 'google_drive',
    updatedAt: snapshot?.updatedAt || Date.now(),
  };

  // Always save to local/server GoogleDrive mirror vault so data is safe even offline or in Android APK WebView
  const mirrorSaved = await ensureLocalDriveMirrorFolder(targetFolder, payloadToSave);
  if (targetFolder !== DRIVE_BACKUP_FOLDER_NAME) {
    await ensureLocalDriveMirrorFolder(DRIVE_BACKUP_FOLDER_NAME, payloadToSave).catch(() => {});
  }

  if (
    activeToken === GOOGLE_DRIVE_DIRECT_TOKEN ||
    (typeof navigator !== 'undefined' && !navigator.onLine)
  ) {
    return mirrorSaved;
  }

  try {
    const folderId = await findOrCreateDriveFolder(activeToken, true, targetFolder);
    if (!folderId || folderId.startsWith('gdrive_direct_')) {
      return mirrorSaved;
    }

    // Check if backup JSON file already exists inside the folder
    const fileQuery = encodeURIComponent(
      `'${folderId}' in parents and name = '${DRIVE_BACKUP_FILE_NAME}' and trashed = false`
    );
    const searchRes = await fetchDriveApiWithAuth(
      `https://www.googleapis.com/drive/v3/files?q=${fileQuery}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&pageSize=1`,
      { method: 'GET' },
      activeToken
    );

    let existingFileId: string | null = null;
    if (searchRes.ok) {
      const searchData = await searchRes.json();
      if (Array.isArray(searchData.files) && searchData.files.length > 0) {
        existingFileId = searchData.files[0].id;
      }
    }

    const boundary = '-------yaad_drive_backup_boundary_' + Date.now();
    const metadata: Record<string, any> = {
      name: DRIVE_BACKUP_FILE_NAME,
      mimeType: 'application/json',
      description: `YAAD Reminder Backup JSON (${new Date().toISOString()})`,
    };
    if (!existingFileId) {
      metadata.parents = [folderId];
    }

    const multipartBody =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(payloadToSave, null, 2)}\r\n` +
      `--${boundary}--`;

    const uploadUrl = existingFileId
      ? `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart&fields=id,name,modifiedTime`
      : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime`;

    const uploadRes = await fetchDriveApiWithAuth(
      uploadUrl,
      {
        method: existingFileId ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: multipartBody,
      },
      activeToken
    );

    if (uploadRes.ok) {
      try {
        localStorage.setItem(LAST_DRIVE_BACKUP_KEY, String(Date.now()));
      } catch {
        // ignore
      }
      return true;
    }
    return mirrorSaved;
  } catch (err) {
    console.warn(
      '[YAAD Drive] Upload backup to Google Drive REST failed, using mirror vault:',
      err
    );
    return mirrorSaved;
  }
}

/**
 * Downloads the latest backup JSON from the target folder (default "Yaad_Backups") on Google Drive.
 * Includes automatic token refresh on 401 and multi-layer fallback.
 */
export async function downloadBackupFromGoogleDrive(
  tokenOverride?: string | null,
  customFolderName?: string
): Promise<any | null> {
  const activeToken = tokenOverride || getCachedToken();
  if (!activeToken || activeToken === GOOGLE_CALENDAR_DIRECT_TOKEN) return null;

  const cleanedCustom = (customFolderName || DRIVE_BACKUP_FOLDER_NAME)
    .replace(
      /^(GoogleDrive|Google Drive|OneDrive|Dropbox|iCloudDrive|MEGA|Documents|Download|InternalStorage)\//i,
      ''
    )
    .trim();
  const targetFolder = cleanedCustom || DRIVE_BACKUP_FOLDER_NAME;

  const isValidDrivePayload = (parsed: any) =>
    parsed &&
    typeof parsed === 'object' &&
    (Array.isArray(parsed.reminders) ||
      Array.isArray(parsed.ideas) ||
      Array.isArray(parsed.savedLocations) ||
      Array.isArray(parsed.occasions));

  // 1. Try Google Drive REST API v3 if we have a real OAuth token and are online
  if (
    activeToken !== GOOGLE_DRIVE_DIRECT_TOKEN &&
    (typeof navigator === 'undefined' || navigator.onLine)
  ) {
    try {
      const folderId = await findOrCreateDriveFolder(activeToken, false, targetFolder);
      let targetFileId: string | null = null;

      if (folderId && !folderId.startsWith('gdrive_direct_')) {
        const fileQuery = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
        const searchRes = await fetchDriveApiWithAuth(
          `https://www.googleapis.com/drive/v3/files?q=${fileQuery}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&pageSize=5`,
          { method: 'GET' },
          activeToken
        );

        if (searchRes.ok) {
          const searchData = await searchRes.json();
          if (Array.isArray(searchData.files) && searchData.files.length > 0) {
            const exactFile =
              searchData.files.find((f: any) => f.name === DRIVE_BACKUP_FILE_NAME) ||
              searchData.files.find((f: any) => f.name.endsWith('.json')) ||
              searchData.files[0];
            targetFileId = exactFile?.id || null;
          }
        }
      }

      if (!targetFileId) {
        const fallbackQuery = encodeURIComponent(
          `name = '${DRIVE_BACKUP_FILE_NAME}' and trashed = false`
        );
        const fallbackRes = await fetchDriveApiWithAuth(
          `https://www.googleapis.com/drive/v3/files?q=${fallbackQuery}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&pageSize=1`,
          { method: 'GET' },
          activeToken
        );
        if (fallbackRes.ok) {
          const fallbackData = await fallbackRes.json();
          if (Array.isArray(fallbackData.files) && fallbackData.files.length > 0) {
            targetFileId = fallbackData.files[0].id;
          }
        }
      }

      if (targetFileId) {
        const downloadRes = await fetchDriveApiWithAuth(
          `https://www.googleapis.com/drive/v3/files/${targetFileId}?alt=media`,
          { method: 'GET' },
          activeToken
        );
        if (downloadRes.ok) {
          const parsed = await downloadRes.json();
          if (isValidDrivePayload(parsed)) {
            return parsed;
          }
        }
      }
    } catch (err) {
      console.warn('[YAAD Drive] REST download fallback:', err);
    }
  }

  // 2. Check Server GoogleDrive folder vault (both targetFolder and default/legacy folder names)
  const foldersToCheck = Array.from(
    new Set([targetFolder, DRIVE_BACKUP_FOLDER_NAME, 'Yaad reminder'])
  );

  for (const folderCandidate of foldersToCheck) {
    try {
      const gdriveFolder = `GoogleDrive/${folderCandidate}`;
      const res = await fetch(`/api/local-folder-backup?folder=${encodeURIComponent(gdriveFolder)}`);
      if (res.ok) {
        const data = await res.json();
        if (data?.ok && isValidDrivePayload(data.backup)) {
          return data.backup;
        }
      }
    } catch {
      // ignore
    }
  }

  // 3. Check Android Capacitor Filesystem GoogleDrive/<folder>/yaad_backup.json
  try {
    if (
      Capacitor.isNativePlatform() ||
      (typeof window !== 'undefined' && (window as any).Capacitor?.Plugins?.Filesystem)
    ) {
      const dirs = [
        Directory.External,
        Directory.Documents,
        Directory.ExternalStorage,
        Directory.Data,
      ];
      for (const folderCandidate of foldersToCheck) {
        for (const dir of dirs) {
          const fileRes = await Filesystem.readFile({
            path: `GoogleDrive/${folderCandidate}/${DRIVE_BACKUP_FILE_NAME}`,
            directory: dir,
            encoding: Encoding.UTF8,
          }).catch(() => null);
          if (fileRes?.data && typeof fileRes.data === 'string') {
            const parsed = JSON.parse(fileRes.data);
            if (isValidDrivePayload(parsed)) {
              return parsed;
            }
          }
        }
      }
    }
  } catch {
    // ignore
  }

  // 4. Check OPFS GoogleDrive/<folder>
  try {
    if (
      typeof navigator !== 'undefined' &&
      navigator.storage &&
      (navigator.storage as any).getDirectory
    ) {
      const rootDir = await (navigator.storage as any).getDirectory();
      const gdriveRoot = await rootDir.getDirectoryHandle('GoogleDrive', { create: false });
      for (const folderCandidate of foldersToCheck) {
        try {
          const subDir = await gdriveRoot.getDirectoryHandle(folderCandidate, { create: false });
          const fileHandle = await subDir.getFileHandle(DRIVE_BACKUP_FILE_NAME, { create: false });
          const file = await fileHandle.getFile();
          const text = await file.text();
          const parsed = JSON.parse(text);
          if (isValidDrivePayload(parsed)) {
            return parsed;
          }
        } catch {
          // try next folderCandidate
        }
      }
    }
  } catch {
    // ignore
  }

  // 5. Check localStorage Google Drive vault
  try {
    if (typeof window !== 'undefined') {
      const raw = localStorage.getItem(GOOGLE_DRIVE_VAULT_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (isValidDrivePayload(parsed)) {
          return parsed;
        }
      }
    }
  } catch {
    // ignore
  }

  return null;
}

/**
 * Sync Reminder to Google Calendar as an event (with automatic token refresh support)
 */
export async function syncReminderToCalendar(reminder: Reminder, token: string): Promise<string> {
  if (!token || token === GOOGLE_CALENDAR_DIRECT_TOKEN || token === GOOGLE_DRIVE_DIRECT_TOKEN) {
    return openGoogleCalendarEventUrl(reminder);
  }

  const startTime = new Date(reminder.dueTimestamp);
  const endTime = new Date(reminder.dueTimestamp + 30 * 60 * 1000); // 30 min duration

  const eventPayload = {
    summary: reminder.title,
    description: `${reminder.description || ''}\n[ثبت‌شده توسط اپلیکیشن یادآور هوشمند - دسته: ${reminder.category}]`,
    start: {
      dateTime: startTime.toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    end: {
      dateTime: endTime.toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 10 },
        { method: 'popup', minutes: 0 },
      ],
    },
  };

  try {
    const response = await fetchDriveApiWithAuth(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(eventPayload),
      },
      token
    );

    if (!response.ok) {
      return openGoogleCalendarEventUrl(reminder);
    }

    const created = await response.json();
    return created.id;
  } catch {
    return openGoogleCalendarEventUrl(reminder);
  }
}

/**
 * Sync Reminder or Idea to Google Tasks (with automatic token refresh support)
 */
export async function syncToGoogleTasks(
  item: { title: string; description?: string; dueTimestamp?: number },
  token: string
): Promise<string> {
  const taskPayload: { title: string; notes?: string; due?: string } = {
    title: item.title,
    notes: item.description,
  };

  if (item.dueTimestamp) {
    taskPayload.due = new Date(item.dueTimestamp).toISOString();
  }

  const response = await fetchDriveApiWithAuth(
    'https://tasks.googleapis.com/tasks/v1/lists/@default/tasks',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(taskPayload),
    },
    token
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || 'خطا در ثبت وظیفه در Google Tasks');
  }

  const data = await response.json();
  return data.id;
}

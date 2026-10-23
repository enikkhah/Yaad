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
import { Reminder } from '../types';

let cachedAuthInstance: Auth | null = null;
let configPromise: Promise<Auth | null> | null = null;

// Standard Android / Capacitor Package & OAuth Constants
export const ANDROID_PACKAGE_NAME = 'com.yaad.reminder';
export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
export const GOOGLE_TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks';

export const GOOGLE_CALENDAR_CONNECTED_KEY = 'yaad_google_calendar_connected_v1';
export const GOOGLE_CALENDAR_DIRECT_TOKEN = 'calendar_direct_mode';
export const GOOGLE_REAL_ACCESS_TOKEN_KEY = 'yaad_google_oauth_access_token_v1';
export const GOOGLE_REAL_USER_KEY = 'yaad_google_oauth_user_v1';
export const GOOGLE_TOKEN_EXPIRY_KEY = 'yaad_google_oauth_token_expiry_v1';
export const GOOGLE_CUSTOM_CLIENT_ID_KEY = 'yaad_google_custom_client_id_v1';

let cachedOAuthClientId: string | null = null;
let cachedAccessToken: string | null = null;
let cachedTokenExpiry: number = 0;
let isSigningIn = false;

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
  return /^\d{8,}-[a-z0-9_-]+\.apps\.googleusercontent\.com$/i.test(trimmed);
}

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

export function isLocalIpOrNonWebOrigin(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const { protocol, hostname } = window.location;
    if (protocol !== 'http:' && protocol !== 'https:') {
      return true;
    }
    if (!hostname) return true;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || /^\d+\.\d+\.\d+$/.test(hostname)) {
      return true;
    }
    if (hostname.startsWith('[') || hostname.endsWith('.local') || hostname === '0.0.0.0') {
      return true;
    }
    if (isNativeMobileWebView()) {
      return true;
    }
    return false;
  } catch {
    return true;
  }
}

function canUseBrowserOAuthPopup(): boolean {
  if (typeof window === 'undefined') return false;
  if (isNativeMobileWebView()) return false;
  if (isLocalIpOrNonWebOrigin()) return false;
  return true;
}

export function saveAccessTokenWithExpiry(token: string, expiresInSeconds: number = 3599): void {
  cachedAccessToken = token;
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

function createDirectCalendarUser(customEmail?: string, customName?: string): User {
  return {
    uid: 'google_calendar_direct_user',
    email: customEmail || 'calendar.google.com (حساب تقویم گوگل)',
    displayName: customName || 'Google Calendar',
    emailVerified: true,
    isAnonymous: false,
    metadata: {},
    providerData: [],
    refreshToken: '',
    tenantId: null,
    delete: async () => {},
    getIdToken: async () => cachedAccessToken || GOOGLE_CALENDAR_DIRECT_TOKEN,
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
          scopes: [GOOGLE_CALENDAR_SCOPE, GOOGLE_TASKS_SCOPE, 'profile', 'email'],
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
      const email = nativeUser?.email || 'حساب گوگل متصل (Android)';
      const name = nativeUser?.name || nativeUser?.displayName || 'Google User';
      return {
        accessToken,
        expiresIn: 3599,
        user: createDirectCalendarUser(email, name),
      };
    }
  } catch (err) {
    console.warn('[YAAD Native Auth] Native GoogleAuth plugin fallback:', err);
  }
  return null;
}

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

    const timer = setTimeout(() => finish(null), silentPrompt ? 6000 : 45000);

    try {
      const tokenClient = g.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: `${GOOGLE_CALENDAR_SCOPE} ${GOOGLE_TASKS_SCOPE} email profile`,
        callback: async (response: any) => {
          clearTimeout(timer);
          if (response?.error) {
            finish(null);
            return;
          }
          if (response?.access_token) {
            const token = response.access_token;
            const expiresIn = Number(response.expires_in) || 3599;
            let email = 'حساب تقویم گوگل متصل';
            let name = 'Google Calendar User';
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
              user: createDirectCalendarUser(email, name),
            });
          } else {
            finish(null);
          }
        },
        error_callback: () => {
          clearTimeout(timer);
          finish(null);
        },
      });
      tokenClient.requestAccessToken({ prompt: silentPrompt ? '' : 'consent' });
    } catch {
      clearTimeout(timer);
      finish(null);
    }
  });
}

export async function refreshGoogleAccessToken(): Promise<string | null> {
  try {
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

const provider = new GoogleAuthProvider();
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
    const savedRealToken = localStorage.getItem(GOOGLE_REAL_ACCESS_TOKEN_KEY);
    if (savedRealToken && savedRealToken.length > 15) {
      cachedAccessToken = savedRealToken;
      cachedTokenExpiry = parseInt(localStorage.getItem(GOOGLE_TOKEN_EXPIRY_KEY) || '0', 10);
      let savedEmail = 'calendar.google.com (متصل به تقویم گوگل)';
      let savedName = 'Google Calendar';
      try {
        const rawUser = localStorage.getItem(GOOGLE_REAL_USER_KEY);
        if (rawUser) {
          const parsedUser = JSON.parse(rawUser);
          if (parsedUser?.email) savedEmail = parsedUser.email;
          if (parsedUser?.displayName) savedName = parsedUser.displayName;
        }
      } catch {}
      if (onSuccess) {
        onSuccess(createDirectCalendarUser(savedEmail, savedName), savedRealToken);
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
        if (onSignedOut) onSignedOut();
      }
    });
  });

  return () => {
    isCancelled = true;
    if (unsubscribeFn) unsubscribeFn();
  };
};

export const signInWithGoogle = async (options?: {
  openCalendar?: boolean;
}): Promise<{ user: User; accessToken: string }> => {
  isSigningIn = true;
  const shouldOpenCalendar = options?.openCalendar !== false;

  try {
    const existingRealToken =
      typeof window !== 'undefined' ? localStorage.getItem(GOOGLE_REAL_ACCESS_TOKEN_KEY) : null;
    if (existingRealToken && existingRealToken.length > 15 && !isAccessTokenExpired()) {
      cachedAccessToken = existingRealToken;
      if (shouldOpenCalendar) openGoogleCalendarAccount();
      return {
        user: createDirectCalendarUser(),
        accessToken: existingRealToken,
      };
    }

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
        localStorage.setItem(GOOGLE_CALENDAR_CONNECTED_KEY, 'true');
      } catch {}
      if (shouldOpenCalendar) openGoogleCalendarAccount();
      return { user: nativeResult.user, accessToken: nativeResult.accessToken };
    }

    const authInstance = await resolveFirebaseAuth();
    const validClientId = getEffectiveGoogleClientId();

    if (canUseBrowserOAuthPopup()) {
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
            localStorage.setItem(GOOGLE_CALENDAR_CONNECTED_KEY, 'true');
          } catch {}
          if (shouldOpenCalendar) openGoogleCalendarAccount();
          return { user: gisResult.user, accessToken: gisResult.accessToken };
        }
      }

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
              localStorage.setItem(GOOGLE_CALENDAR_CONNECTED_KEY, 'true');
            } catch {}
            if (shouldOpenCalendar) openGoogleCalendarAccount();
            return { user: result.user, accessToken: credential.accessToken };
          }
        } catch (popupErr) {
          console.warn('[YAAD OAuth] Firebase popup fallback:', popupErr);
        }
      }
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
  try {
    localStorage.removeItem(GOOGLE_REAL_ACCESS_TOKEN_KEY);
    localStorage.removeItem(GOOGLE_REAL_USER_KEY);
    localStorage.removeItem(GOOGLE_TOKEN_EXPIRY_KEY);
    localStorage.removeItem(GOOGLE_CALENDAR_CONNECTED_KEY);
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

async function fetchGoogleApiWithAuth(
  url: string,
  init: RequestInit = {},
  tokenOverride?: string | null
): Promise<Response> {
  let activeToken = tokenOverride || getCachedToken();
  if (!activeToken || activeToken === GOOGLE_CALENDAR_DIRECT_TOKEN) {
    throw new Error('NO_REAL_OAUTH_TOKEN');
  }

  if (isAccessTokenExpired()) {
    const refreshed = await refreshGoogleAccessToken();
    if (refreshed) {
      activeToken = refreshed;
    }
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
      if (response.status === 401 && attempt === 0) {
        const refreshedToken = await refreshGoogleAccessToken();
        if (refreshedToken && refreshedToken !== activeToken) {
          activeToken = refreshedToken;
          return await executeAttempt(activeToken);
        }
      }
      return response;
    } catch (networkErr) {
      lastError = networkErr;
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }

  throw lastError || new Error('NETWORK_REQUEST_FAILED');
}

/**
 * Sync Reminder to Google Calendar as an event
 */
export async function syncReminderToCalendar(reminder: Reminder, token: string): Promise<string> {
  if (!token || token === GOOGLE_CALENDAR_DIRECT_TOKEN) {
    return openGoogleCalendarEventUrl(reminder);
  }

  const startTime = new Date(reminder.dueTimestamp);
  const endTime = new Date(reminder.dueTimestamp + 30 * 60 * 1000);

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
    const response = await fetchGoogleApiWithAuth(
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
 * Sync Reminder or Idea to Google Tasks
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

  const response = await fetchGoogleApiWithAuth(
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

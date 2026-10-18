import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut as fbSignOut,
  User,
  Auth
} from 'firebase/auth';
import { Reminder, IdeaNote } from '../types';

let cachedAuthInstance: Auth | null = null;
let configPromise: Promise<Auth | null> | null = null;

async function resolveFirebaseAuth(): Promise<Auth | null> {
  if (cachedAuthInstance) return cachedAuthInstance;
  if (getApps().length > 0) {
    cachedAuthInstance = getAuth(getApp());
    return cachedAuthInstance;
  }

  if (configPromise) return configPromise;

  configPromise = (async () => {
    try {
      // 1. Check build-time / environment variables (e.g. GitHub Actions Secrets or .env)
      const envKey = (import.meta as any).env?.VITE_FIREBASE_API_KEY;
      const envProjectId = (import.meta as any).env?.VITE_FIREBASE_PROJECT_ID;
      if (envKey && envProjectId) {
        const envConfig = {
          apiKey: envKey,
          authDomain:
            (import.meta as any).env?.VITE_FIREBASE_AUTH_DOMAIN ||
            `${envProjectId}.firebaseapp.com`,
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

      // 2. Fetch from origin-restricted backend endpoint (/api/firebase-config)
      const res = await fetch('/api/firebase-config');
      if (res.ok) {
        const data = await res.json();
        if (data?.ok && data.config?.apiKey) {
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

const provider = new GoogleAuthProvider();
// Workspace Scopes requested (Calendar, Tasks, and Google Drive file/folder access for YAAD REMIDER backup)
provider.addScope('https://www.googleapis.com/auth/calendar.events');
provider.addScope('https://www.googleapis.com/auth/tasks');
provider.addScope('https://www.googleapis.com/auth/drive.file');

export const DRIVE_BACKUP_FOLDER_NAME = 'YAAD REMIDER';
export const DRIVE_BACKUP_FILE_NAME = 'yaad_auto_backup.json';
export const LAST_DRIVE_BACKUP_KEY = 'yaad_last_drive_backup_timestamp';

// In-memory token storage (DO NOT store in localStorage per security guidelines)
let cachedAccessToken: string | null = null;
let isSigningIn = false;
let cachedDriveFolderId: string | null = null;

export const initGoogleAuth = (
  onSuccess?: (user: User, token: string) => void,
  onSignedOut?: () => void
) => {
  let unsubscribeFn: (() => void) | null = null;
  let isCancelled = false;

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

export const signInWithGoogle = async (): Promise<{ user: User; accessToken: string }> => {
  try {
    isSigningIn = true;
    const authInstance = await resolveFirebaseAuth();
    if (!authInstance) {
      throw new Error('تنظیمات کلید Firebase در این محیط یافت نشد.');
    }
    const result = await signInWithPopup(authInstance, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('توکن دسترسی گوگل یافت نشد.');
    }
    cachedAccessToken = credential.accessToken;
    isSigningIn = false;
    return { user: result.user, accessToken: credential.accessToken };
  } catch (error) {
    isSigningIn = false;
    throw error;
  }
};

export const signOutGoogle = async () => {
  cachedAccessToken = null;
  cachedDriveFolderId = null;
  const authInstance = await resolveFirebaseAuth();
  if (authInstance) {
    await fbSignOut(authInstance);
  }
};

export const getCachedToken = () => cachedAccessToken;

export function getLastDriveBackupTimestamp(): number | null {
  try {
    const raw = localStorage.getItem(LAST_DRIVE_BACKUP_KEY);
    return raw ? parseInt(raw, 10) : null;
  } catch {
    return null;
  }
}

/**
 * Finds or creates the target backup folder (default 'YAAD REMIDER') in Google Drive
 */
export async function findOrCreateDriveFolder(
  token: string,
  createIfMissing: boolean = true,
  customFolderName?: string
): Promise<string | null> {
  const targetFolder = (customFolderName || DRIVE_BACKUP_FOLDER_NAME).trim() || DRIVE_BACKUP_FOLDER_NAME;

  try {
    const escapedTarget = targetFolder.replace(/'/g, "\\'");
    const q = encodeURIComponent(
      `mimeType = 'application/vnd.google-apps.folder' and (name = '${escapedTarget}' or name = 'YAAD REMIDER' or name = 'YAAD REMINDER') and trashed = false`
    );
    const listRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&pageSize=5`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (listRes.ok) {
      const listData = await listRes.json();
      if (Array.isArray(listData.files) && listData.files.length > 0) {
        const exactMatch = listData.files.find((f: any) => f.name === targetFolder) || listData.files[0];
        cachedDriveFolderId = exactMatch.id;
        return exactMatch.id;
      }
    }

    if (!createIfMissing) {
      return null;
    }

    // Create folder with the user-specified or default 'YAAD REMIDER' name
    const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: targetFolder,
        mimeType: 'application/vnd.google-apps.folder',
        description: 'YAAD Reminder Automatic Cloud Backup Folder',
      }),
    });

    if (!createRes.ok) {
      return null;
    }

    const createdFolder = await createRes.json();
    if (createdFolder?.id) {
      cachedDriveFolderId = createdFolder.id;
      return createdFolder.id;
    }
    return null;
  } catch (err) {
    console.warn('[YAAD Drive] Error finding/creating backup folder:', err);
    return null;
  }
}

/**
 * Uploads automatic backup JSON into the target folder (default 'YAAD REMIDER') on Google Drive
 */
export async function uploadBackupToGoogleDrive(
  snapshot: any,
  tokenOverride?: string | null,
  customFolderName?: string
): Promise<boolean> {
  const activeToken = tokenOverride || cachedAccessToken;
  if (!activeToken) return false;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false;

  const targetFolder = (customFolderName || snapshot?.settings?.cloudBackupFolderName || DRIVE_BACKUP_FOLDER_NAME).trim() || DRIVE_BACKUP_FOLDER_NAME;

  try {
    const folderId = await findOrCreateDriveFolder(activeToken, true, targetFolder);
    if (!folderId) return false;

    // Check if backup file already exists inside the folder
    const fileQuery = encodeURIComponent(
      `'${folderId}' in parents and name = '${DRIVE_BACKUP_FILE_NAME}' and trashed = false`
    );
    const searchRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${fileQuery}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&pageSize=1`,
      {
        headers: {
          Authorization: `Bearer ${activeToken}`,
        },
      }
    );

    let existingFileId: string | null = null;
    if (searchRes.ok) {
      const searchData = await searchRes.json();
      if (Array.isArray(searchData.files) && searchData.files.length > 0) {
        existingFileId = searchData.files[0].id;
      }
    }

    const payloadToSave = {
      ...snapshot,
      folder: targetFolder,
      source: 'google_drive',
      updatedAt: snapshot.updatedAt || Date.now(),
    };

    const boundary = '-------yaad_drive_backup_boundary_' + Date.now();
    const metadata: Record<string, any> = {
      name: DRIVE_BACKUP_FILE_NAME,
      mimeType: 'application/json',
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
      ? `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart`
      : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;

    const uploadRes = await fetch(uploadUrl, {
      method: existingFileId ? 'PATCH' : 'POST',
      headers: {
        Authorization: `Bearer ${activeToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
    });

    if (uploadRes.ok) {
      try {
        localStorage.setItem(LAST_DRIVE_BACKUP_KEY, String(Date.now()));
      } catch {
        // ignore
      }
      return true;
    }
    return false;
  } catch (err) {
    console.warn('[YAAD Drive] Upload backup to Google Drive failed:', err);
    return false;
  }
}

/**
 * Downloads the latest backup JSON from the target folder (default 'YAAD REMIDER') on Google Drive
 */
export async function downloadBackupFromGoogleDrive(
  tokenOverride?: string | null,
  customFolderName?: string
): Promise<any | null> {
  const activeToken = tokenOverride || cachedAccessToken;
  if (!activeToken) return null;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return null;

  try {
    const folderId = await findOrCreateDriveFolder(activeToken, false, customFolderName);
    let targetFileId: string | null = null;

    if (folderId) {
      const fileQuery = encodeURIComponent(
        `'${folderId}' in parents and trashed = false`
      );
      const searchRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${fileQuery}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&pageSize=5`,
        {
          headers: {
            Authorization: `Bearer ${activeToken}`,
          },
        }
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

    // Fallback search if file was saved directly with DRIVE_BACKUP_FILE_NAME
    if (!targetFileId) {
      const fallbackQuery = encodeURIComponent(
        `name = '${DRIVE_BACKUP_FILE_NAME}' and trashed = false`
      );
      const fallbackRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${fallbackQuery}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&pageSize=1`,
        {
          headers: {
            Authorization: `Bearer ${activeToken}`,
          },
        }
      );
      if (fallbackRes.ok) {
        const fallbackData = await fallbackRes.json();
        if (Array.isArray(fallbackData.files) && fallbackData.files.length > 0) {
          targetFileId = fallbackData.files[0].id;
        }
      }
    }

    if (!targetFileId) {
      return null;
    }

    const downloadRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${targetFileId}?alt=media`,
      {
        headers: {
          Authorization: `Bearer ${activeToken}`,
        },
      }
    );

    if (!downloadRes.ok) {
      return null;
    }

    const parsed = await downloadRes.json();
    if (
      parsed &&
      typeof parsed === 'object' &&
      (Array.isArray(parsed.reminders) ||
        Array.isArray(parsed.ideas) ||
        Array.isArray(parsed.savedLocations) ||
        Array.isArray(parsed.occasions))
    ) {
      return parsed;
    }
    return null;
  } catch (err) {
    console.warn('[YAAD Drive] Download backup from YAAD REMIDER failed:', err);
    return null;
  }
}

/**
 * Sync Reminder to Google Calendar as an event
 */
export async function syncReminderToCalendar(reminder: Reminder, token: string): Promise<string> {
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

  const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(eventPayload),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || 'خطا در ثبت رویداد تقویم گوگل');
  }

  const created = await response.json();
  return created.id;
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

  const response = await fetch('https://tasks.googleapis.com/tasks/v1/lists/@default/tasks', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(taskPayload),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || 'خطا در ثبت وظیفه در Google Tasks');
  }

  const data = await response.json();
  return data.id;
}

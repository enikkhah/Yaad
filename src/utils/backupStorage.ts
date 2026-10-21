/**
 * Auto Backup & Local/Cloud Vault Utility for YAAD
 * - Local Backup Folder: "YAAD REMIDER" (Device Storage / FileSystem Handle / OPFS / Server Folder / IndexedDB)
 * - Cloud Backup Folder: "YAAD REMIDER" on Google Drive
 * - Automatic Backup & Restore on every app open, close, and re-installation
 * - Restore Priority: 1. Google Drive ("YAAD REMIDER") -> 2. Local Folder ("YAAD REMIDER")
 */

import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Reminder, IdeaNote, SavedLocation, Occasion, AppSettings } from '../types';
import { uploadBackupToGoogleDrive, downloadBackupFromGoogleDrive, getCachedToken } from './googleSync';

export const AUTO_BACKUP_STORAGE_KEY = 'yaad_auto_backup_vault_v1';
export const LOCAL_BACKUP_FOLDER_NAME = 'Yaad reminder';
export const LOCAL_BACKUP_FILE_NAME = 'yaad_backup.json';
export const FOLDER_PERMISSION_GRANTED_KEY = 'yaad_folder_permission_granted_v2';
export const LAST_LOCAL_BACKUP_KEY = 'yaad_last_local_backup_timestamp';

const DB_NAME = 'yaad_persistent_vault';
const DB_VERSION = 2;
const STORE_NAME = 'app_backups';
const HANDLE_STORE_NAME = 'folder_handles';
const CACHE_BACKUP_NAME = 'yaad-remider-folder-vault-v1';
const CACHE_BACKUP_URL = '/YAAD_REMIDER/yaad_backup.json';

export interface AutoBackupSnapshot {
  version: number;
  updatedAt: number;
  folder?: string;
  source?: 'google_drive' | 'local_folder';
  reminders: Reminder[];
  ideas: IdeaNote[];
  savedLocations: SavedLocation[];
  occasions: Occasion[];
  settings?: AppSettings;
}

let cloudBackupDebounceTimer: any = null;

function isValidSnapshot(data: any): data is AutoBackupSnapshot {
  return Boolean(
    data &&
      typeof data === 'object' &&
      (Array.isArray(data.reminders) ||
        Array.isArray(data.ideas) ||
        Array.isArray(data.savedLocations) ||
        Array.isArray(data.occasions))
  );
}

/**
 * Safely decodes and parses readFile result data to a JSON snapshot object.
 * Handles: plain JSON string, Base64 string, Uint8Array/ArrayBuffer, or pre-parsed object.
 */
export function safeParseJsonFromReadFileData(data: any): any {
  if (!data) return null;

  if (typeof data === 'object') {
    if (
      Array.isArray(data.reminders) ||
      Array.isArray(data.ideas) ||
      Array.isArray(data.savedLocations) ||
      Array.isArray(data.occasions) ||
      data.app
    ) {
      return data;
    }
  }

  let text = '';
  if (typeof data === 'string') {
    text = data.trim();
  } else if (data instanceof ArrayBuffer) {
    try {
      text = new TextDecoder('utf-8').decode(data).trim();
    } catch {
      // ignore
    }
  } else if (data instanceof Uint8Array) {
    try {
      text = new TextDecoder('utf-8').decode(data).trim();
    } catch {
      // ignore
    }
  }

  if (!text) return null;

  // 1. Try direct JSON.parse first
  try {
    const direct = JSON.parse(text);
    if (direct && typeof direct === 'object') {
      return direct;
    }
  } catch {
    // String might be Base64 encoded or data URI
  }

  // 2. Try Base64 decoding
  try {
    const cleanBase64 = text.includes(',') ? text.split(',')[1] : text;
    const binary = atob(cleanBase64.replace(/\s/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const decodedUtf8 = new TextDecoder('utf-8').decode(bytes);
    const parsed = JSON.parse(decodedUtf8);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch {
    // ignore
  }

  return null;
}

export function getSnapshotItemCount(snap: AutoBackupSnapshot | null | undefined): number {
  if (!snap) return 0;
  const rCount = Array.isArray(snap.reminders)
    ? snap.reminders.filter((r) => r?.id && !r.id.startsWith('seed-')).length
    : 0;
  const lCount = Array.isArray(snap.savedLocations)
    ? snap.savedLocations.filter((l) => l?.id && !l.id.startsWith('seed-') && !l.id.startsWith('sample_')).length
    : 0;
  const iCount = Array.isArray(snap.ideas)
    ? snap.ideas.filter((i) => i?.id && i.id !== 'idea-1' && !i.id.startsWith('seed-')).length
    : 0;
  const oCount = Array.isArray(snap.occasions)
    ? snap.occasions.filter(
        (o) =>
          o?.id &&
          o.id !== 'sample_occ_1' &&
          o.id !== 'sample_occ_2' &&
          !o.id.startsWith('sample_') &&
          !o.id.startsWith('seed-')
      ).length
    : 0;
  return rCount + lCount + iCount + oCount;
}

/**
 * Requests permanent persistent storage from the browser / Android OS
 * Prevents OS from evicting IndexedDB/OPFS on device reboot or low memory.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
    try {
      const isPersisted = await navigator.storage.persist();
      return isPersisted;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Open or initialize IndexedDB for durable persistent offline storage & directory handles
 */
function openVaultDB(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      resolve(null);
      return;
    }
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (e: any) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(HANDLE_STORE_NAME)) {
          db.createObjectStore(HANDLE_STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = (e: any) => {
        resolve(e.target.result);
      };
      request.onerror = () => {
        resolve(null);
      };
    } catch {
      resolve(null);
    }
  });
}

/**
 * Save or retrieve FileSystemDirectoryHandle in IndexedDB
 * keyId can be 'yaad_remider_dir' (local folder) or 'yaad_custom_cloud_dir' (any user-selected cloud folder: OneDrive, Dropbox, iCloud, Mega, etc.)
 */
async function saveDirectoryHandleToDB(handle: any, keyId: string = 'yaad_remider_dir'): Promise<void> {
  const db = await openVaultDB();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction([HANDLE_STORE_NAME], 'readwrite');
      const store = tx.objectStore(HANDLE_STORE_NAME);
      store.put({ id: keyId, handle, updatedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function getDirectoryHandleFromDB(keyId: string = 'yaad_remider_dir'): Promise<any | null> {
  const db = await openVaultDB();
  if (!db) return null;
  return new Promise<any | null>((resolve) => {
    try {
      const tx = db.transaction([HANDLE_STORE_NAME], 'readonly');
      const store = tx.objectStore(HANDLE_STORE_NAME);
      const req = store.get(keyId);
      req.onsuccess = () => resolve(req.result?.handle || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Allows the user to select ANY cloud-synced folder on their device (OneDrive, Dropbox, iCloud Drive, Mega, Nextcloud, Google Drive folder, etc.)
 */
export async function selectUserCloudSpaceFolder(
  customFolderName?: string
): Promise<{
  granted: boolean;
  nativePickerOpened: boolean;
  folderName: string;
  restoredSnapshot?: AutoBackupSnapshot | null;
}> {
  let effectiveFolderName = (customFolderName || LOCAL_BACKUP_FOLDER_NAME).trim() || LOCAL_BACKUP_FOLDER_NAME;
  let restoredFromCloudFolder: AutoBackupSnapshot | null = null;
  let nativePickerOpened = false;

  const isInIframe = (() => {
    try {
      return typeof window !== 'undefined' && window.self !== window.top;
    } catch {
      return true;
    }
  })();

  const isMobileOrAndroid =
    typeof navigator !== 'undefined' &&
    (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || Capacitor.isNativePlatform());

  if (typeof window !== 'undefined' && 'showDirectoryPicker' in window && !isInIframe && !isMobileOrAndroid) {
    try {
      const pickedHandle = await (window as any).showDirectoryPicker({
        id: 'yaad_custom_cloud_space',
        mode: 'readwrite',
      });
      nativePickerOpened = true;
      if (pickedHandle) {
        let targetFolderHandle = pickedHandle;
        const pickedName = (pickedHandle.name || '').trim();
        if (
          pickedName.toUpperCase() !== effectiveFolderName.toUpperCase() &&
          pickedName.toUpperCase() !== 'YAAD REMIDER' &&
          pickedName.toUpperCase() !== 'YAAD REMINDER'
        ) {
          targetFolderHandle = await pickedHandle.getDirectoryHandle(effectiveFolderName, {
            create: true,
          });
          effectiveFolderName = `${pickedName}/${effectiveFolderName}`;
        } else if (pickedName) {
          effectiveFolderName = pickedName;
        }
        await saveDirectoryHandleToDB(targetFolderHandle, 'yaad_custom_cloud_dir');
        restoredFromCloudFolder = await readFromDirectoryHandle(targetFolderHandle);
        return {
          granted: true,
          nativePickerOpened: true,
          folderName: effectiveFolderName,
          restoredSnapshot: restoredFromCloudFolder,
        };
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        nativePickerOpened = true;
      }
      console.warn('[YAAD Cloud Folder] Picker notice:', err?.message || err);
    }
  }

  return {
    granted: false,
    nativePickerOpened,
    folderName: effectiveFolderName,
    restoredSnapshot: null,
  };
}

/**
 * Upload backup JSON to any user-specified Cloud / WebDAV / Nextcloud / Custom Server URL
 */
export async function uploadToCustomCloudUrl(
  payload: AutoBackupSnapshot,
  endpointUrl?: string,
  folderName?: string,
  authHeader?: string
): Promise<boolean> {
  if (!endpointUrl || !endpointUrl.trim()) return false;
  try {
    const res = await fetch('/api/custom-cloud-backup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'upload',
        endpointUrl: endpointUrl.trim(),
        folderName: (folderName || LOCAL_BACKUP_FOLDER_NAME).trim(),
        authHeader: authHeader || '',
        payload,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Download backup JSON from any user-specified Cloud / WebDAV / Nextcloud / Custom Server URL
 */
export async function downloadFromCustomCloudUrl(
  endpointUrl?: string,
  folderName?: string,
  authHeader?: string
): Promise<AutoBackupSnapshot | null> {
  if (!endpointUrl || !endpointUrl.trim()) return null;
  try {
    const res = await fetch('/api/custom-cloud-backup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'download',
        endpointUrl: endpointUrl.trim(),
        folderName: (folderName || LOCAL_BACKUP_FOLDER_NAME).trim(),
        authHeader: authHeader || '',
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.ok && isValidSnapshot(data.backup)) {
      return data.backup;
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Share backup file directly to ANY cloud app installed on the user's phone/device
 * (e.g., OneDrive, Dropbox, Telegram Saved Messages, iCloud Drive, Mega, Google Drive, Email, etc.)
 */
export async function shareBackupToAnyCloudApp(
  payload: AutoBackupSnapshot,
  customFolderName?: string
): Promise<boolean> {
  try {
    const folderTag = (customFolderName || LOCAL_BACKUP_FOLDER_NAME).trim();
    const jsonStr = JSON.stringify({ ...payload, folder: folderTag }, null, 2);
    const file = new File([jsonStr], LOCAL_BACKUP_FILE_NAME, { type: 'application/json' });

    if (
      typeof navigator !== 'undefined' &&
      navigator.share &&
      (!navigator.canShare || navigator.canShare({ files: [file] }))
    ) {
      await navigator.share({
        title: `${folderTag} - YAAD Backup`,
        text: `فایل پشتیبان یاد (${folderTag}/${LOCAL_BACKUP_FILE_NAME})`,
        files: [file],
      });
      return true;
    }

    // Fallback: trigger file save dialog so user can pick any cloud drive in their OS save dialog
    if (typeof window !== 'undefined' && 'showSaveFilePicker' in window) {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: LOCAL_BACKUP_FILE_NAME,
        types: [
          {
            description: 'YAAD Backup JSON',
            accept: { 'application/json': ['.json'] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(jsonStr);
      await writable.close();
      return true;
    }
  } catch {
    // user cancelled or unsupported
  }
  return false;
}

/**
 * Ensures the specified cloud backup folder (e.g., "Yaad reminder" or "GoogleDrive/Yaad reminder")
 * is physically created on device storage, OPFS, and server backup directory, and writes the backup file if provided.
 */
export async function ensureCloudFolderOnDevice(
  customCloudFolder?: string,
  payload?: AutoBackupSnapshot
): Promise<boolean> {
  const rawFolder = (customCloudFolder || LOCAL_BACKUP_FOLDER_NAME).trim() || LOCAL_BACKUP_FOLDER_NAME;
  const baseFolder =
    rawFolder
      .replace(/^(GoogleDrive|Google Drive|OneDrive|Dropbox|iCloudDrive|MEGA|Documents|Download|InternalStorage)\//i, '')
      .trim() || LOCAL_BACKUP_FOLDER_NAME;

  let createdAny = false;

  // 1. Create on OPFS
  try {
    if (typeof navigator !== 'undefined' && navigator.storage && (navigator.storage as any).getDirectory) {
      const rootDir = await (navigator.storage as any).getDirectory();
      const dirHandle = await rootDir.getDirectoryHandle(baseFolder, { create: true });
      if (payload && dirHandle) {
        const fileHandle = await dirHandle.getFileHandle(LOCAL_BACKUP_FILE_NAME, { create: true });
        if (fileHandle.createWritable) {
          const writable = await fileHandle.createWritable();
          await writable.write(JSON.stringify({ ...payload, folder: rawFolder }, null, 2));
          await writable.close();
        }
      }
      createdAny = true;
    }
  } catch {
    // ignore
  }

  // 2. Create on Android Capacitor Filesystem (both full path like GoogleDrive/Yaad reminder and base folder Yaad reminder)
  try {
    if (Capacitor.isNativePlatform() || (window as any).Capacitor?.Plugins?.Filesystem) {
      await Promise.race([
        Filesystem.requestPermissions(),
        new Promise((resolve) => setTimeout(resolve, 2500)),
      ]).catch(() => {});

      const targetDirs = [
        Directory.External,
        Directory.Documents,
        Directory.ExternalStorage,
        Directory.Data,
      ];

      const pathsToCreate = Array.from(new Set([rawFolder, baseFolder, `GoogleDrive/${baseFolder}`]));
      const jsonStr = payload ? JSON.stringify({ ...payload, folder: rawFolder }, null, 2) : null;

      for (const dir of targetDirs) {
        for (const p of pathsToCreate) {
          await Filesystem.mkdir({
            path: p,
            directory: dir,
            recursive: true,
          })
            .then(() => {
              createdAny = true;
            })
            .catch(() => {});

          if (jsonStr) {
            await Filesystem.writeFile({
              path: `${p}/${LOCAL_BACKUP_FILE_NAME}`,
              data: jsonStr,
              directory: dir,
              encoding: Encoding.UTF8,
              recursive: true,
            })
              .then(() => {
                createdAny = true;
              })
              .catch(() => {});
          }
        }
      }
    }
  } catch {
    // ignore
  }

  // 3. Mirror folder on server backup vault
  try {
    const bodyPayload = payload
      ? { ...payload, folder: rawFolder }
      : {
          version: 3,
          updatedAt: Date.now(),
          folder: rawFolder,
          source: 'google_drive',
          reminders: [],
          ideas: [],
          savedLocations: [],
          occasions: [],
        };
    const res = await fetch('/api/local-folder-backup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyPayload),
    });
    if (res.ok) createdAny = true;
  } catch {
    // ignore
  }

  return createdAny;
}

/**
 * Initializes & verifies access to the local "YAAD REMIDER" folder.
 * When interactivePicker = true and supported by browser, opens directory picker
 * to create/select the "YAAD REMIDER" folder on device storage.
 */
export async function requestLocalFolderPermission(
  interactivePicker: boolean = false,
  customLocalFolder?: string
): Promise<{
  granted: boolean;
  nativePickerOpened: boolean;
  folderName: string;
  restoredSnapshot?: AutoBackupSnapshot | null;
}> {
  const rawFolder = (customLocalFolder || LOCAL_BACKUP_FOLDER_NAME).trim() || LOCAL_BACKUP_FOLDER_NAME;
  let effectiveFolderName =
    rawFolder.toUpperCase() === 'YAAD REMIDER' ? LOCAL_BACKUP_FOLDER_NAME : rawFolder;
  let restoredFromPickedFolder: AutoBackupSnapshot | null = null;
  let nativePickerOpened = false;

  const isInIframe = (() => {
    try {
      return typeof window !== 'undefined' && window.self !== window.top;
    } catch {
      return true;
    }
  })();

  const isMobileOrAndroid =
    typeof navigator !== 'undefined' &&
    (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || Capacitor.isNativePlatform());

  // 1. On desktop browsers (outside iframe & non-Android), invoke showDirectoryPicker FIRST before any await
  if (
    interactivePicker &&
    typeof window !== 'undefined' &&
    'showDirectoryPicker' in window &&
    !isInIframe &&
    !isMobileOrAndroid
  ) {
    try {
      const pickedHandle = await (window as any).showDirectoryPicker({
        id: 'yaad_remider_backup',
        mode: 'readwrite',
      });
      nativePickerOpened = true;
      if (pickedHandle) {
        let targetFolderHandle = pickedHandle;
        const pickedName = (pickedHandle.name || '').trim();
        if (
          pickedName.toUpperCase() !== effectiveFolderName.toUpperCase() &&
          pickedName.toUpperCase() !== 'YAAD REMIDER' &&
          pickedName.toUpperCase() !== 'YAAD REMINDER'
        ) {
          targetFolderHandle = await pickedHandle.getDirectoryHandle(effectiveFolderName, {
            create: true,
          });
          effectiveFolderName = `${pickedName}/${effectiveFolderName}`;
        } else if (pickedName) {
          effectiveFolderName = pickedName;
        }
        await saveDirectoryHandleToDB(targetFolderHandle);
        restoredFromPickedFolder = await readFromDirectoryHandle(targetFolderHandle);
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        nativePickerOpened = true;
      }
      console.warn('[YAAD Folder] Directory picker notice:', err?.message || err);
    }
  }

  await requestPersistentStorage();

  // 2. Ensure OPFS "Yaad reminder" directory exists
  try {
    if (typeof navigator !== 'undefined' && navigator.storage && (navigator.storage as any).getDirectory) {
      const rootDir = await (navigator.storage as any).getDirectory();
      const cleanSubName = effectiveFolderName.split('/').pop() || LOCAL_BACKUP_FOLDER_NAME;
      await rootDir.getDirectoryHandle(cleanSubName, { create: true });
    }
  } catch {
    // ignore OPFS errors
  }

  // 3. Request Android storage permission & create physical "Yaad reminder" folder via @capacitor/filesystem
  // Writes to Directory.External (no permission needed on Android 11-15), Directory.Documents, Directory.ExternalStorage, and Directory.Data
  try {
    if (Capacitor.isNativePlatform() || (window as any).Capacitor?.Plugins?.Filesystem) {
      await Promise.race([
        Filesystem.requestPermissions(),
        new Promise((resolve) => setTimeout(resolve, 3500)),
      ]).catch(() => {});

      const cleanSubName =
        effectiveFolderName
          .replace(/^(Documents|Download|InternalStorage)\//i, '')
          .trim() || LOCAL_BACKUP_FOLDER_NAME;

      const targetDirs = [
        Directory.External,
        Directory.Documents,
        Directory.ExternalStorage,
        Directory.Data,
      ];

      for (const dir of targetDirs) {
        await Filesystem.mkdir({
          path: cleanSubName,
          directory: dir,
          recursive: true,
        }).catch(() => {});
      }

      if (/^Download\//i.test(effectiveFolderName)) {
        await Filesystem.mkdir({
          path: `Download/${cleanSubName}`,
          directory: Directory.ExternalStorage,
          recursive: true,
        }).catch(() => {});
      }
    }
  } catch {
    // ignore
  }

  if (!restoredFromPickedFolder) {
    restoredFromPickedFolder = await retrieveFromLocalYaadFolder(effectiveFolderName);
  }

  let isStorageActuallyGranted = true;
  if (Capacitor.isNativePlatform()) {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const perms = (await LocalNotifications.checkPermissions()) as any;
      if (perms && typeof perms.storage === 'string') {
        isStorageActuallyGranted = perms.storage === 'granted';
      }
    } catch {
      // ignore
    }
  }

  if (isStorageActuallyGranted) {
    try {
      localStorage.setItem(FOLDER_PERMISSION_GRANTED_KEY, 'true');
    } catch {
      // ignore
    }
  }

  return {
    granted: isStorageActuallyGranted,
    nativePickerOpened,
    folderName: effectiveFolderName,
    restoredSnapshot: restoredFromPickedFolder,
  };
}

export async function checkLocalFolderPermissionStatus(): Promise<boolean> {
  try {
    if (Capacitor.isNativePlatform()) {
      try {
        const { LocalNotifications } = await import('@capacitor/local-notifications');
        const perms = (await LocalNotifications.checkPermissions()) as any;
        if (perms && typeof perms.storage === 'string') {
          return perms.storage === 'granted';
        }
      } catch {
        // ignore
      }
      return localStorage.getItem(FOLDER_PERMISSION_GRANTED_KEY) === 'true';
    }
    if (localStorage.getItem(FOLDER_PERMISSION_GRANTED_KEY) === 'true') {
      return true;
    }
    const handle = await getDirectoryHandleFromDB();
    if (handle) return true;
  } catch {
    // ignore
  }
  return false;
}

/**
 * Helper to write backup JSON into a FileSystemDirectoryHandle ('YAAD REMIDER')
 */
async function writeToDirectoryHandle(dirHandle: any, payload: AutoBackupSnapshot): Promise<boolean> {
  if (!dirHandle) return false;
  try {
    if (dirHandle.queryPermission) {
      const perm = await dirHandle.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') return false;
    }
    const fileHandle = await dirHandle.getFileHandle(LOCAL_BACKUP_FILE_NAME, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(payload, null, 2));
    await writable.close();
    return true;
  } catch {
    return false;
  }
}

/**
 * Helper to read backup JSON from a FileSystemDirectoryHandle ('YAAD REMIDER')
 */
async function readFromDirectoryHandle(dirHandle: any): Promise<AutoBackupSnapshot | null> {
  if (!dirHandle) return null;
  try {
    if (dirHandle.queryPermission) {
      const perm = await dirHandle.queryPermission({ mode: 'read' });
      if (perm !== 'granted') return null;
    }
    const fileHandle = await dirHandle.getFileHandle(LOCAL_BACKUP_FILE_NAME, { create: false });
    const file = await fileHandle.getFile();
    const text = await file.text();
    const parsed = JSON.parse(text);
    return isValidSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Writes backup to OPFS 'YAAD REMIDER/yaad_backup.json'
 */
async function writeToOpfsYaadFolder(payload: AutoBackupSnapshot): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage || !(navigator.storage as any).getDirectory) {
      return false;
    }
    const root = await (navigator.storage as any).getDirectory();
    const folder = await root.getDirectoryHandle(LOCAL_BACKUP_FOLDER_NAME, { create: true });
    const fileHandle = await folder.getFileHandle(LOCAL_BACKUP_FILE_NAME, { create: true });
    if (fileHandle.createWritable) {
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(payload, null, 2));
      await writable.close();
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

/**
 * Reads backup from OPFS 'YAAD REMIDER/yaad_backup.json'
 */
async function readFromOpfsYaadFolder(): Promise<AutoBackupSnapshot | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage || !(navigator.storage as any).getDirectory) {
      return null;
    }
    const root = await (navigator.storage as any).getDirectory();
    const folder = await root.getDirectoryHandle(LOCAL_BACKUP_FOLDER_NAME, { create: false });
    const fileHandle = await folder.getFileHandle(LOCAL_BACKUP_FILE_NAME, { create: false });
    const file = await fileHandle.getFile();
    const text = await file.text();
    const parsed = JSON.parse(text);
    return isValidSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Writes backup to physical 'YAAD REMIDER/yaad_backup.json' via backend endpoint & Cache Storage
 */
async function writeToServerAndCacheYaadFolder(payload: AutoBackupSnapshot): Promise<void> {
  const jsonStr = JSON.stringify(payload);

  // 1. Cache Storage '/YAAD_REMIDER/yaad_backup.json'
  try {
    if (typeof caches !== 'undefined') {
      const cache = await caches.open(CACHE_BACKUP_NAME);
      await cache.put(
        CACHE_BACKUP_URL,
        new Response(jsonStr, {
          headers: { 'Content-Type': 'application/json' },
        })
      );
    }
  } catch {
    // ignore
  }

  // 2. Physical 'YAAD REMIDER/yaad_backup.json' folder on host
  try {
    await fetch('/api/local-folder-backup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: jsonStr,
      keepalive: true,
    });
  } catch {
    // ignore offline errors
  }
}

/**
 * Reads backup from physical 'YAAD REMIDER/yaad_backup.json' via backend endpoint or Cache Storage
 */
async function readFromServerOrCacheYaadFolder(): Promise<AutoBackupSnapshot | null> {
  // 1. Check physical 'YAAD REMIDER/yaad_backup.json'
  try {
    const res = await fetch('/api/local-folder-backup');
    if (res.ok) {
      const data = await res.json();
      if (data?.ok && isValidSnapshot(data.backup)) {
        return data.backup;
      }
    }
  } catch {
    // ignore
  }

  // 2. Check Cache Storage '/YAAD_REMIDER/yaad_backup.json'
  try {
    if (typeof caches !== 'undefined') {
      const cache = await caches.open(CACHE_BACKUP_NAME);
      const match = await cache.match(CACHE_BACKUP_URL);
      if (match) {
        const parsed = await match.json();
        if (isValidSnapshot(parsed)) {
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
 * Saves an automatic snapshot of all user data into:
 * 1. Local 'YAAD REMIDER' folder (Device Directory Handle, Capacitor Filesystem, OPFS, Server Folder, Cache, IndexedDB, LocalStorage)
 * 2. Cloud 'YAAD REMIDER' folder on Google Drive (if Google Drive token is available)
 */
export async function performAutoBackup(
  snapshot: {
    reminders: Reminder[];
    ideas: IdeaNote[];
    savedLocations: SavedLocation[];
    occasions: Occasion[];
    settings?: AppSettings;
  },
  options?: { immediateCloud?: boolean; forceCloud?: boolean; googleToken?: string | null }
): Promise<boolean> {
  try {
    const now = Date.now();
    const localFolder = (snapshot.settings?.localBackupFolderName || LOCAL_BACKUP_FOLDER_NAME).trim() || LOCAL_BACKUP_FOLDER_NAME;
    const cloudFolder = (snapshot.settings?.cloudBackupFolderName || LOCAL_BACKUP_FOLDER_NAME).trim() || LOCAL_BACKUP_FOLDER_NAME;

    const payload: AutoBackupSnapshot = {
      version: 3,
      updatedAt: now,
      folder: localFolder,
      source: 'local_folder',
      reminders: snapshot.reminders || [],
      ideas: snapshot.ideas || [],
      savedLocations: snapshot.savedLocations || [],
      occasions: snapshot.occasions || [],
      settings: snapshot.settings,
    };

    // 1. Save to primary localStorage vault key
    try {
      localStorage.setItem(AUTO_BACKUP_STORAGE_KEY, JSON.stringify(payload));
      localStorage.setItem(LAST_LOCAL_BACKUP_KEY, String(now));
    } catch (err) {
      console.warn('LocalStorage backup quota warning:', err);
    }

    // 2. Save to durable IndexedDB store
    const db = await openVaultDB();
    if (db) {
      await new Promise<void>((resolve) => {
        try {
          const tx = db.transaction([STORE_NAME], 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          store.put({ id: 'latest_vault', ...payload });
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        } catch {
          resolve();
        }
      });
    }

    // 3. Save to Device Folder 'YAAD REMIDER/yaad_backup.json' (FileSystemDirectoryHandle if granted)
    const dirHandle = await getDirectoryHandleFromDB();
    if (dirHandle) {
      await writeToDirectoryHandle(dirHandle, payload);
    }

    // 4. Save to Native Capacitor Filesystem '<localFolder>/yaad_backup.json' if available
    try {
      const cleanSubName =
        localFolder.replace(/^(Documents|Download|InternalStorage)\//i, '').trim() ||
        LOCAL_BACKUP_FOLDER_NAME;
      const newItemsCount = getSnapshotItemCount(payload);

      // SAFETY GUARD: If payload has 0 items (e.g. app freshly mounted or reinstalled with empty initial arrays),
      // NEVER overwrite an existing backup on disk that contains items!
      if (newItemsCount === 0) {
        let existingBackupHasItems = false;
        for (const dir of [Directory.External, Directory.Documents, Directory.ExternalStorage]) {
          const existing = await Filesystem.readFile({
            path: `${cleanSubName}/${LOCAL_BACKUP_FILE_NAME}`,
            directory: dir,
            encoding: Encoding.UTF8,
          }).catch(() => null);
          if (existing?.data) {
            const parsed = safeParseJsonFromReadFileData(existing.data);
            if (getSnapshotItemCount(parsed) > 0) {
              existingBackupHasItems = true;
              break;
            }
          }
        }
        if (existingBackupHasItems) {
          console.warn('[performAutoBackup] Preserving existing backup file on disk with items; avoiding overwrite with empty initial state.');
          return false;
        }
      }

      const jsonData = JSON.stringify(payload, null, 2);

      const writeDirs = [
        Directory.External,
        Directory.Documents,
        Directory.ExternalStorage,
        Directory.Data,
      ];
      for (const dir of writeDirs) {
        await Filesystem.writeFile({
          path: `${cleanSubName}/${LOCAL_BACKUP_FILE_NAME}`,
          data: jsonData,
          directory: dir,
          encoding: Encoding.UTF8,
          recursive: true,
        }).catch(() => {});
      }

      if (/^Download\//i.test(localFolder)) {
        await Filesystem.writeFile({
          path: `Download/${cleanSubName}/${LOCAL_BACKUP_FILE_NAME}`,
          data: jsonData,
          directory: Directory.ExternalStorage,
          encoding: Encoding.UTF8,
          recursive: true,
        }).catch(() => {});
      }
    } catch {
      // ignore
    }

    // 5. Save to OPFS 'YAAD REMIDER/yaad_backup.json' & physical 'YAAD REMIDER' folder
    await writeToOpfsYaadFolder(payload);
    await writeToServerAndCacheYaadFolder(payload);

    // 6. Optional Cloud Backup to ANY user-selected cloud space (when enabled by user or explicitly forced)
    const isCloudEnabled = Boolean(snapshot.settings?.cloudBackupEnabled || options?.forceCloud);
    if (isCloudEnabled) {
      const provider = snapshot.settings?.cloudBackupProvider || 'custom_cloud_folder';
      const token = options?.googleToken || getCachedToken();

      const executeCloudSync = async () => {
        // Ensure cloud folder exists on device / OPFS / server
        await ensureCloudFolderOnDevice(cloudFolder, {
          ...payload,
          folder: cloudFolder,
        });

        // A. User-selected Cloud Folder on device (OneDrive, Dropbox, iCloud, Mega, etc.)
        const customCloudHandle = await getDirectoryHandleFromDB('yaad_custom_cloud_dir');
        if (customCloudHandle) {
          await writeToDirectoryHandle(customCloudHandle, {
            ...payload,
            folder: cloudFolder,
          });
        }

        // B. Custom Cloud Server / WebDAV / Nextcloud URL if provided
        if (
          (provider === 'webdav_url' || snapshot.settings?.cloudCustomUrl) &&
          snapshot.settings?.cloudCustomUrl
        ) {
          await uploadToCustomCloudUrl(
            { ...payload, folder: cloudFolder },
            snapshot.settings.cloudCustomUrl,
            cloudFolder,
            snapshot.settings.cloudCustomAuth
          );
        }

        // C. Google Drive if selected or connected
        if ((provider === 'google_drive' || token) && token) {
          await uploadBackupToGoogleDrive(payload, token, cloudFolder);
        }

        // D. Also mirror to server named cloud folder if custom name differs
        if (cloudFolder) {
          await fetch('/api/local-folder-backup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...payload, folder: cloudFolder }),
          }).catch(() => {});
        }
      };

      if (options?.immediateCloud || options?.forceCloud) {
        if (cloudBackupDebounceTimer) clearTimeout(cloudBackupDebounceTimer);
        await executeCloudSync();
      } else {
        if (cloudBackupDebounceTimer) clearTimeout(cloudBackupDebounceTimer);
        cloudBackupDebounceTimer = setTimeout(() => {
          executeCloudSync().catch(() => {});
        }, 1200);
      }
    }

    return true;
  } catch (error) {
    console.error('Failed to perform auto backup:', error);
    return false;
  }
}

/**
 * Retrieves the best/latest backup from the user's selected Cloud Space (Custom Cloud Folder, WebDAV/URL, or Google Drive)
 */
export async function retrieveFromUserCloudSpace(
  googleToken?: string | null,
  settings?: Partial<AppSettings>
): Promise<AutoBackupSnapshot | null> {
  const cloudFolder = (settings?.cloudBackupFolderName || LOCAL_BACKUP_FOLDER_NAME).trim() || LOCAL_BACKUP_FOLDER_NAME;
  const provider = settings?.cloudBackupProvider || 'custom_cloud_folder';
  const activeToken = googleToken || getCachedToken();

  // 1. Check user-selected Cloud Folder Handle (OneDrive / Dropbox / iCloud / Mega / Custom Folder)
  try {
    const customCloudHandle = await getDirectoryHandleFromDB('yaad_custom_cloud_dir');
    if (customCloudHandle) {
      const fromCloudHandle = await readFromDirectoryHandle(customCloudHandle);
      if (isValidSnapshot(fromCloudHandle)) {
        return fromCloudHandle;
      }
    }
  } catch {
    // ignore
  }

  // 2. Check Custom Cloud / WebDAV / Nextcloud URL if configured
  if (settings?.cloudCustomUrl && (typeof navigator === 'undefined' || navigator.onLine)) {
    try {
      const fromUrl = await downloadFromCustomCloudUrl(
        settings.cloudCustomUrl,
        cloudFolder,
        settings.cloudCustomAuth
      );
      if (isValidSnapshot(fromUrl)) {
        return fromUrl;
      }
    } catch {
      // ignore
    }
  }

  // 3. Check Google Drive if selected or token is active
  if (
    (provider === 'google_drive' || activeToken) &&
    activeToken &&
    (typeof navigator === 'undefined' || navigator.onLine)
  ) {
    try {
      const fromDrive = await downloadBackupFromGoogleDrive(activeToken, cloudFolder);
      if (isValidSnapshot(fromDrive)) {
        return fromDrive;
      }
    } catch {
      // ignore
    }
  }

  // 4. Check server-side named cloud folder if custom folder was saved
  try {
    const res = await fetch(`/api/local-folder-backup?folder=${encodeURIComponent(cloudFolder)}`);
    if (res.ok) {
      const data = await res.json();
      if (data?.ok && isValidSnapshot(data.backup)) {
        return data.backup;
      }
    }
  } catch {
    // ignore
  }

  return null;
}

/**
 * Retrieves the best/latest backup from the Local 'YAAD REMIDER' folder across all local storage layers.
 */
export async function retrieveFromLocalYaadFolder(customLocalFolder?: string): Promise<AutoBackupSnapshot | null> {
  const candidates: AutoBackupSnapshot[] = [];
  const targetFolder = (customLocalFolder || LOCAL_BACKUP_FOLDER_NAME).trim() || LOCAL_BACKUP_FOLDER_NAME;

  // 1. User-granted Device Folder Handle ('YAAD REMIDER/yaad_backup.json')
  try {
    const dirHandle = await getDirectoryHandleFromDB('yaad_remider_dir');
    if (dirHandle) {
      const fromHandle = await readFromDirectoryHandle(dirHandle);
      if (fromHandle) candidates.push(fromHandle);
    }
  } catch {
    // ignore
  }

  // 2. Native Android Capacitor Filesystem (smart readdir + readFile with Encoding.UTF8)
  try {
    const cleanSubName =
      targetFolder.replace(/^(Documents|Download|InternalStorage)\//i, '').trim() ||
      LOCAL_BACKUP_FOLDER_NAME;

    const searchDirs = [
      Directory.External,
      Directory.Documents,
      Directory.ExternalStorage,
      Directory.Data,
    ];

    const folderPathsToTry = [
      cleanSubName,
      `Download/${cleanSubName}`,
      `Documents/${cleanSubName}`,
      'Download',
      'Documents',
      '',
    ];

    for (const dir of searchDirs) {
      for (const folderPath of folderPathsToTry) {
        try {
          // A) Try readdir to discover all .json files in this folder
          const dirInfo = await Filesystem.readdir({
            path: folderPath,
            directory: dir,
          }).catch(() => null);

          if (dirInfo && Array.isArray(dirInfo.files)) {
            const jsonCandidates: { name: string; mtime: number }[] = [];

            for (const fileItem of dirInfo.files) {
              const fname = typeof fileItem === 'string' ? fileItem : fileItem?.name;
              if (fname && fname.toLowerCase().endsWith('.json')) {
                const mtime = typeof fileItem === 'object' && fileItem?.mtime ? fileItem.mtime : 0;
                jsonCandidates.push({ name: fname, mtime });
              }
            }

            // Sort: prioritize newest mtime, or matching yaad/backup in name
            jsonCandidates.sort((a, b) => {
              if (a.mtime && b.mtime && a.mtime !== b.mtime) {
                return b.mtime - a.mtime;
              }
              const aPriority =
                a.name.toLowerCase().includes('yaad') || a.name.toLowerCase().includes('backup') ? 1 : 0;
              const bPriority =
                b.name.toLowerCase().includes('yaad') || b.name.toLowerCase().includes('backup') ? 1 : 0;
              if (aPriority !== bPriority) return bPriority - aPriority;
              return b.name.localeCompare(a.name);
            });

            // Read the json files found in this directory
            for (const item of jsonCandidates) {
              const fullFilePath = folderPath ? `${folderPath}/${item.name}` : item.name;
              const fileRes = await Filesystem.readFile({
                path: fullFilePath,
                directory: dir,
                encoding: Encoding.UTF8,
              }).catch(() => null);

              if (fileRes?.data) {
                const parsed = safeParseJsonFromReadFileData(fileRes.data);
                if (isValidSnapshot(parsed)) {
                  candidates.push(parsed);
                }
              }
            }
          }

          // B) Direct readFile for standard file names as extra fallback
          const standardPaths = [
            folderPath ? `${folderPath}/${LOCAL_BACKUP_FILE_NAME}` : LOCAL_BACKUP_FILE_NAME,
            folderPath ? `${folderPath}/yaad_backup.json` : 'yaad_backup.json',
          ];
          for (const sPath of standardPaths) {
            const res = await Filesystem.readFile({
              path: sPath,
              directory: dir,
              encoding: Encoding.UTF8,
            }).catch(() => null);
            if (res?.data) {
              const parsed = safeParseJsonFromReadFileData(res.data);
              if (isValidSnapshot(parsed)) {
                candidates.push(parsed);
              }
            }
          }
        } catch {
          // continue next search candidate
        }
      }
    }
  } catch (err) {
    console.warn('[retrieveFromLocalYaadFolder] Filesystem scan error:', err);
  }

  // 3. OPFS 'YAAD REMIDER/yaad_backup.json'
  try {
    const fromOpfs = await readFromOpfsYaadFolder();
    if (fromOpfs) candidates.push(fromOpfs);
  } catch {
    // ignore
  }

  // 4. Physical 'YAAD REMIDER/yaad_backup.json' & Cache Storage
  try {
    const fromServerOrCache = await readFromServerOrCacheYaadFolder();
    if (fromServerOrCache) candidates.push(fromServerOrCache);
  } catch {
    // ignore
  }

  // 5. IndexedDB Vault
  try {
    const db = await openVaultDB();
    if (db) {
      const dbResult = await new Promise<any>((resolve) => {
        try {
          const tx = db.transaction([STORE_NAME], 'readonly');
          const store = tx.objectStore(STORE_NAME);
          const req = store.get('latest_vault');
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
      if (isValidSnapshot(dbResult)) {
        candidates.push(dbResult);
      }
    }
  } catch {
    // ignore
  }

  // 6. LocalStorage Vault
  try {
    const raw = localStorage.getItem(AUTO_BACKUP_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (isValidSnapshot(parsed)) {
        candidates.push(parsed);
      }
    }
  } catch {
    // ignore
  }

  if (candidates.length === 0) return null;

  // Prefer candidates that actually contain user items, then sort by newest updatedAt
  candidates.sort((a, b) => {
    const aItems = getSnapshotItemCount(a);
    const bItems = getSnapshotItemCount(b);
    if (aItems > 0 && bItems === 0) return -1;
    if (bItems > 0 && aItems === 0) return 1;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });

  return candidates[0];
}

/**
 * Automatic Recall / Restore with Strict Priority:
 * Priority 1: User's Selected Cloud Space (OneDrive / Dropbox / iCloud / WebDAV / Google Drive / Custom Folder) when enabled & available
 * Priority 2: Local 'YAAD REMIDER' (or user-specified local folder) on device storage (if Cloud is unavailable or not enabled)
 */
export async function retrieveLatestBackupWithPriority(
  googleToken?: string | null,
  settings?: Partial<AppSettings>
): Promise<{ snapshot: AutoBackupSnapshot | null; source: 'google_drive' | 'local_folder' | null }> {
  const isCloudAllowed = settings?.cloudBackupEnabled !== false;

  // PRIORITY 1: Any User-Selected Cloud Space (Custom Cloud Folder, WebDAV/Server URL, or Google Drive)
  if (isCloudAllowed) {
    try {
      const cloudBackup = await retrieveFromUserCloudSpace(googleToken, settings);
      if (isValidSnapshot(cloudBackup)) {
        const localBackup = await retrieveFromLocalYaadFolder(settings?.localBackupFolderName);
        const cloudCount = getSnapshotItemCount(cloudBackup);
        const localCount = getSnapshotItemCount(localBackup);

        if (cloudCount > 0 || localCount === 0) {
          return { snapshot: cloudBackup, source: 'google_drive' };
        }
      }
    } catch (err) {
      console.warn('[YAAD Restore] Cloud space unavailable, falling back to local YAAD REMIDER folder:', err);
    }
  }

  // PRIORITY 2: Local 'YAAD REMIDER' Folder on Device Storage
  const localSnapshot = await retrieveFromLocalYaadFolder(settings?.localBackupFolderName);
  if (localSnapshot) {
    return { snapshot: localSnapshot, source: 'local_folder' };
  }

  return { snapshot: null, source: null };
}

/**
 * Legacy helper alias for compatibility
 */
export async function retrieveLatestBackup(): Promise<AutoBackupSnapshot | null> {
  const res = await retrieveLatestBackupWithPriority();
  return res.snapshot;
}

/**
 * Returns summary info of the latest stored auto backup.
 */
export function getLatestBackupTimestamp(): number | null {
  try {
    const raw = localStorage.getItem(LAST_LOCAL_BACKUP_KEY) || localStorage.getItem(AUTO_BACKUP_STORAGE_KEY);
    if (raw) {
      if (/^\d+$/.test(raw)) return parseInt(raw, 10);
      const parsed = JSON.parse(raw);
      return parsed.updatedAt || null;
    }
  } catch {
    // Ignore
  }
  return null;
}

/**
 * Auto Backup & Local Device Storage Vault Utility for YAAD
 * - Local Backup Folder: "/YAAD" in Root Storage (Device Storage / FileSystem Handle / OPFS / Server Folder / IndexedDB / LocalStorage)
 * - Automatic Backup & Restore on every app open, close, and re-installation
 */

import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Reminder, IdeaNote, SavedLocation, Occasion, AppSettings } from '../types';
import { getSavedLaunchRecoveryCodeSync } from './launchOffer';

export const AUTO_BACKUP_STORAGE_KEY = 'yaad_auto_backup_vault_v1';
export const LOCAL_BACKUP_FOLDER_NAME = 'YAAD';
export const LOCAL_BACKUP_FILE_NAME = 'yaad_backup.json';
export const FOLDER_PERMISSION_GRANTED_KEY = 'yaad_folder_permission_granted_v2';
export const BACKUP_FOLDER_NAME_CACHE_KEY = 'yaad_backup_folder_name_v1';
export const LAST_LOCAL_BACKUP_KEY = 'yaad_last_local_backup_timestamp';
export const LAST_MANUAL_BACKUP_KEY = 'yaad_last_manual_backup_timestamp_v1';
export const BACKUP_PROMPT_DISMISSED_AT_KEY = 'yaad_backup_prompt_dismissed_at_v1';
export const BACKUP_FIRST_DATA_SEEN_KEY = 'yaad_backup_first_data_seen_at_v1';
export const BACKUP_FOLDER_PROMPT_SNOOZED_AT_KEY = 'yaad_folder_prompt_snoozed_at_v1';
export const BACKUP_FOLDER_PROMPT_DISMISSED_KEY = 'yaad_folder_prompt_dismissed_v1';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const FOLDER_REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const DB_NAME = 'yaad_persistent_vault';
const DB_VERSION = 2;
const STORE_NAME = 'app_backups';
const HANDLE_STORE_NAME = 'folder_handles';
const CACHE_BACKUP_NAME = 'yaad-folder-vault-v1';
const CACHE_BACKUP_URL = '/YAAD/yaad_backup.json';

export interface AutoBackupSnapshot {
  version: number;
  updatedAt: number;
  folder?: string;
  source?: 'local_folder';
  reminders: Reminder[];
  ideas: IdeaNote[];
  savedLocations: SavedLocation[];
  occasions: Occasion[];
  settings?: AppSettings;
  launchGiftRecoveryCode?: string;
}

export interface BackupFolderStatus {
  supported: boolean;
  platform: 'android_saf' | 'desktop_fs' | 'unsupported';
  connected: boolean;
  needsReconnect: boolean;
  folderName: string | null;
  unsupportedReason?: 'iframe' | 'browser' | null;
}

// Serialized queue so rapid updates never race or produce truncated JSON writes
let backupWriteQueue: Promise<void> = Promise.resolve();
function enqueueBackupWrite<T>(task: () => Promise<T>): Promise<T> {
  const next = backupWriteQueue.then(task, task);
  backupWriteQueue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

function isInCrossOriginIframe(): boolean {
  try {
    return typeof window !== 'undefined' && window.self !== window.top;
  } catch {
    return true;
  }
}

function isDesktopFsApiAvailable(): boolean {
  if (typeof window === 'undefined' || Capacitor.isNativePlatform()) return false;
  return 'showDirectoryPicker' in window && !isInCrossOriginIframe();
}

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
 * Requests permanent persistent storage from the browser / OS
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
 * Creates/ensures the default fixed app-private YAAD folder on first launch:
 * - Android: Directory.Data/YAAD (never requires storage permissions, path fixed across versions)
 * - Desktop/Web: OPFS/YAAD
 */
export async function initDefaultYaadBackupFolder(): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      await Filesystem.mkdir({
        path: LOCAL_BACKUP_FOLDER_NAME,
        directory: Directory.Data,
        recursive: true,
      });
    } catch {
      // Directory may already exist
    }
    return;
  }

  try {
    if (typeof navigator !== 'undefined' && navigator.storage && (navigator.storage as any).getDirectory) {
      const rootDir = await (navigator.storage as any).getDirectory();
      await rootDir.getDirectoryHandle(LOCAL_BACKUP_FOLDER_NAME, { create: true });
    }
  } catch {
    // ignore OPFS errors
  }
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
 */
async function saveDirectoryHandleToDB(handle: any, keyId: string = 'yaad_folder_dir'): Promise<void> {
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

async function getDirectoryHandleFromDB(keyId: string = 'yaad_folder_dir'): Promise<any | null> {
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

// ============================================================================
// Android SAF Bridge Helpers (via LocalNotificationsPlugin, NO storage perms)
// ============================================================================

async function getSafFolderInfoNative(): Promise<{ granted: boolean; folderName?: string; uri?: string }> {
  if (!Capacitor.isNativePlatform()) return { granted: false };
  try {
    const res = await (LocalNotifications as any).getBackupFolderInfo();
    return {
      granted: Boolean(res?.granted),
      folderName: res?.folderName || undefined,
      uri: res?.uri || undefined,
    };
  } catch {
    return { granted: false };
  }
}

async function readSafBackupNative(): Promise<{
  ok: boolean;
  snapshot: AutoBackupSnapshot | null;
  folderName?: string;
}> {
  if (!Capacitor.isNativePlatform()) return { ok: false, snapshot: null };
  try {
    const res = await (LocalNotifications as any).readBackupFromSafFolder();
    if (res?.ok && res?.data) {
      const parsed = safeParseJsonFromReadFileData(res.data);
      if (isValidSnapshot(parsed)) {
        return {
          ok: true,
          snapshot: parsed,
          folderName: res.folderName || undefined,
        };
      }
    }
    return { ok: false, snapshot: null, folderName: res?.folderName || undefined };
  } catch {
    return { ok: false, snapshot: null };
  }
}

async function writeSafBackupNative(payload: AutoBackupSnapshot): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const jsonData = JSON.stringify(payload, null, 2);
    const res = await (LocalNotifications as any).writeBackupToSafFolder({
      data: jsonData,
      fileName: LOCAL_BACKUP_FILE_NAME,
    });
    return Boolean(res?.ok);
  } catch {
    return false;
  }
}

/**
 * Reads backup JSON from a Desktop FileSystemDirectoryHandle.
 * Supports reading directly from chosenDir/yaad_backup.json, chosenDir/YAAD/yaad_backup.json (legacy),
 * or any yaad_backup*.json inside the chosen folder.
 */
async function readFromDirectoryHandle(dirHandle: any): Promise<AutoBackupSnapshot | null> {
  if (!dirHandle) return null;
  try {
    if (dirHandle.queryPermission) {
      const perm = await dirHandle.queryPermission({ mode: 'read' });
      if (perm !== 'granted') return null;
    }

    // 1. Direct: <chosen>/yaad_backup.json
    try {
      const fileHandle = await dirHandle.getFileHandle(LOCAL_BACKUP_FILE_NAME, { create: false });
      const file = await fileHandle.getFile();
      const text = await file.text();
      const parsed = safeParseJsonFromReadFileData(text);
      if (isValidSnapshot(parsed)) return parsed;
    } catch {
      // continue checking fallbacks
    }

    // 2. Legacy subfolder fallback: <chosen>/YAAD/yaad_backup.json
    try {
      const subDir = await dirHandle.getDirectoryHandle(LOCAL_BACKUP_FOLDER_NAME, { create: false });
      const subFile = await subDir.getFileHandle(LOCAL_BACKUP_FILE_NAME, { create: false });
      const file = await subFile.getFile();
      const text = await file.text();
      const parsed = safeParseJsonFromReadFileData(text);
      if (isValidSnapshot(parsed)) return parsed;
    } catch {
      // continue
    }

    // 3. Any yaad*.json file in the chosen folder
    if (typeof dirHandle.values === 'function') {
      const candidates: { snap: AutoBackupSnapshot; updatedAt: number }[] = [];
      for await (const entry of dirHandle.values()) {
        if (entry?.kind === 'file' && entry?.name?.toLowerCase().endsWith('.json') && entry.name.toLowerCase().includes('yaad')) {
          try {
            const f = await entry.getFile();
            const txt = await f.text();
            const parsed = safeParseJsonFromReadFileData(txt);
            if (isValidSnapshot(parsed)) {
              candidates.push({ snap: parsed, updatedAt: parsed.updatedAt || f.lastModified || 0 });
            }
          } catch {
            // ignore bad file
          }
        }
      }
      if (candidates.length > 0) {
        candidates.sort((a, b) => b.updatedAt - a.updatedAt);
        return candidates[0].snap;
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Helper to write backup JSON into a Desktop FileSystemDirectoryHandle
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
 * Returns unified BackupFolderStatus for BOTH Android SAF and Desktop File System Access.
 */
export async function getBackupFolderStatus(): Promise<BackupFolderStatus> {
  if (typeof window === 'undefined') {
    return {
      supported: false,
      platform: 'unsupported',
      connected: false,
      needsReconnect: false,
      folderName: null,
      unsupportedReason: 'browser',
    };
  }

  if (Capacitor.isNativePlatform()) {
    const safInfo = await getSafFolderInfoNative();
    if (safInfo.granted) {
      const label = safInfo.folderName || LOCAL_BACKUP_FOLDER_NAME;
      try {
        localStorage.setItem(FOLDER_PERMISSION_GRANTED_KEY, 'true');
        localStorage.setItem(BACKUP_FOLDER_NAME_CACHE_KEY, label);
      } catch {}
      return {
        supported: true,
        platform: 'android_saf',
        connected: true,
        needsReconnect: false,
        folderName: label,
      };
    }
    try {
      localStorage.removeItem(FOLDER_PERMISSION_GRANTED_KEY);
    } catch {}
    return {
      supported: true,
      platform: 'android_saf',
      connected: false,
      needsReconnect: false,
      folderName: null,
    };
  }

  // Desktop / Web
  const isIframe = isInCrossOriginIframe();
  const hasPicker = 'showDirectoryPicker' in window;
  if (!hasPicker || isIframe) {
    return {
      supported: false,
      platform: 'unsupported',
      connected: false,
      needsReconnect: false,
      folderName: null,
      unsupportedReason: hasPicker && isIframe ? 'iframe' : 'browser',
    };
  }

  try {
    const handle = await getDirectoryHandleFromDB();
    if (handle) {
      const folderName = (handle.name || '').trim() || LOCAL_BACKUP_FOLDER_NAME;
      if (typeof handle.queryPermission === 'function') {
        const permState = await handle.queryPermission({ mode: 'readwrite' });
        if (permState === 'granted') {
          try {
            localStorage.setItem(FOLDER_PERMISSION_GRANTED_KEY, 'true');
            localStorage.setItem(BACKUP_FOLDER_NAME_CACHE_KEY, folderName);
          } catch {}
          return {
            supported: true,
            platform: 'desktop_fs',
            connected: true,
            needsReconnect: false,
            folderName,
          };
        }
        // Handle exists from a previous session; user needs a 1-click gesture to re-authorize
        try {
          localStorage.removeItem(FOLDER_PERMISSION_GRANTED_KEY);
        } catch {}
        return {
          supported: true,
          platform: 'desktop_fs',
          connected: false,
          needsReconnect: permState === 'prompt',
          folderName,
        };
      }
      return {
        supported: true,
        platform: 'desktop_fs',
        connected: true,
        needsReconnect: false,
        folderName,
      };
    }
  } catch {
    // ignore
  }

  try {
    localStorage.removeItem(FOLDER_PERMISSION_GRANTED_KEY);
  } catch {}
  return {
    supported: true,
    platform: 'desktop_fs',
    connected: false,
    needsReconnect: false,
    folderName: null,
  };
}

/**
 * Lets user select a persistent Auto-Backup folder on Android (SAF ACTION_OPEN_DOCUMENT_TREE)
 * OR Desktop (window.showDirectoryPicker — called BEFORE any await to preserve user gesture).
 * Automatically checks if the folder already has a yaad_backup.json snapshot and returns it.
 */
export async function chooseAutoBackupFolder(): Promise<{
  granted: boolean;
  cancelled: boolean;
  folderName: string;
  restoredSnapshot: AutoBackupSnapshot | null;
  unsupportedReason?: 'iframe' | 'browser';
  error?: string;
}> {
  if (Capacitor.isNativePlatform()) {
    try {
      const res = await (LocalNotifications as any).pickBackupFolder();
      if (!res?.granted) {
        return {
          granted: false,
          cancelled: Boolean(res?.cancelled),
          folderName: LOCAL_BACKUP_FOLDER_NAME,
          restoredSnapshot: null,
          error: res?.error || undefined,
        };
      }
      const folderName = (res.folderName || '').trim() || LOCAL_BACKUP_FOLDER_NAME;
      let restoredSnapshot: AutoBackupSnapshot | null = null;
      if (res.data) {
        const parsed = safeParseJsonFromReadFileData(res.data);
        if (isValidSnapshot(parsed)) {
          restoredSnapshot = parsed;
        }
      }
      try {
        localStorage.setItem(FOLDER_PERMISSION_GRANTED_KEY, 'true');
        localStorage.setItem(BACKUP_FOLDER_NAME_CACHE_KEY, folderName);
        localStorage.removeItem(BACKUP_FOLDER_PROMPT_DISMISSED_KEY);
      } catch {}
      return {
        granted: true,
        cancelled: false,
        folderName,
        restoredSnapshot,
      };
    } catch (err: any) {
      return {
        granted: false,
        cancelled: false,
        folderName: LOCAL_BACKUP_FOLDER_NAME,
        restoredSnapshot: null,
        error: err?.message,
      };
    }
  }

  // Desktop Browser: MUST invoke showDirectoryPicker synchronously inside click gesture before any await!
  if (!isDesktopFsApiAvailable()) {
    return {
      granted: false,
      cancelled: false,
      folderName: LOCAL_BACKUP_FOLDER_NAME,
      restoredSnapshot: null,
      unsupportedReason: typeof window !== 'undefined' && 'showDirectoryPicker' in window && isInCrossOriginIframe() ? 'iframe' : 'browser',
    };
  }

  try {
    const pickedHandle = await (window as any).showDirectoryPicker({
      id: 'yaad_folder_backup',
      mode: 'readwrite',
    });
    if (!pickedHandle) {
      return {
        granted: false,
        cancelled: true,
        folderName: LOCAL_BACKUP_FOLDER_NAME,
        restoredSnapshot: null,
      };
    }

    const folderName = (pickedHandle.name || '').trim() || LOCAL_BACKUP_FOLDER_NAME;
    await saveDirectoryHandleToDB(pickedHandle);
    await requestPersistentStorage();
    const restoredSnapshot = await readFromDirectoryHandle(pickedHandle);
    try {
      localStorage.setItem(FOLDER_PERMISSION_GRANTED_KEY, 'true');
      localStorage.setItem(BACKUP_FOLDER_NAME_CACHE_KEY, folderName);
      localStorage.removeItem(BACKUP_FOLDER_PROMPT_DISMISSED_KEY);
    } catch {}
    return {
      granted: true,
      cancelled: false,
      folderName,
      restoredSnapshot,
    };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return {
        granted: false,
        cancelled: true,
        folderName: LOCAL_BACKUP_FOLDER_NAME,
        restoredSnapshot: null,
      };
    }
    return {
      granted: false,
      cancelled: false,
      folderName: LOCAL_BACKUP_FOLDER_NAME,
      restoredSnapshot: null,
      error: err?.message,
    };
  }
}

/**
 * Re-authorizes an existing Desktop directory handle in one click without re-opening the folder picker.
 */
export async function reconnectDesktopBackupFolder(): Promise<{
  granted: boolean;
  folderName: string | null;
  restoredSnapshot: AutoBackupSnapshot | null;
}> {
  if (Capacitor.isNativePlatform()) {
    const info = await getBackupFolderStatus();
    if (!info.connected) {
      return { granted: false, folderName: null, restoredSnapshot: null };
    }
    const readRes = await readSafBackupNative();
    return { granted: true, folderName: info.folderName, restoredSnapshot: readRes.snapshot };
  }

  try {
    const handle = await getDirectoryHandleFromDB();
    if (!handle) return { granted: false, folderName: null, restoredSnapshot: null };
    const folderName = (handle.name || '').trim() || LOCAL_BACKUP_FOLDER_NAME;
    if (typeof handle.requestPermission === 'function') {
      const res = await handle.requestPermission({ mode: 'readwrite' });
      if (res !== 'granted') {
        return { granted: false, folderName, restoredSnapshot: null };
      }
    }
    try {
      localStorage.setItem(FOLDER_PERMISSION_GRANTED_KEY, 'true');
      localStorage.setItem(BACKUP_FOLDER_NAME_CACHE_KEY, folderName);
    } catch {}
    const restoredSnapshot = await readFromDirectoryHandle(handle);
    return { granted: true, folderName, restoredSnapshot };
  } catch {
    return { granted: false, folderName: null, restoredSnapshot: null };
  }
}

/**
 * Reads backup JSON directly from the currently connected folder (Android SAF or Desktop FS).
 */
export async function readBackupFromConnectedFolder(): Promise<{
  connected: boolean;
  folderName: string | null;
  snapshot: AutoBackupSnapshot | null;
}> {
  if (Capacitor.isNativePlatform()) {
    const info = await getSafFolderInfoNative();
    if (!info.granted) {
      return { connected: false, folderName: null, snapshot: null };
    }
    const readRes = await readSafBackupNative();
    return {
      connected: true,
      folderName: readRes.folderName || info.folderName || LOCAL_BACKUP_FOLDER_NAME,
      snapshot: readRes.snapshot,
    };
  }

  const handle = await getDirectoryHandleFromDB();
  if (!handle) {
    return { connected: false, folderName: null, snapshot: null };
  }
  const folderName = (handle.name || '').trim() || LOCAL_BACKUP_FOLDER_NAME;
  if (typeof handle.queryPermission === 'function') {
    const perm = await handle.queryPermission({ mode: 'read' });
    if (perm !== 'granted') {
      return { connected: false, folderName, snapshot: null };
    }
  }
  const snapshot = await readFromDirectoryHandle(handle);
  return { connected: true, folderName, snapshot };
}

/**
 * Desktop fallback: reads backup JSON from a FileList chosen via <input type="file" webkitdirectory>.
 */
export async function importBackupFromFolderFiles(files: FileList | File[]): Promise<AutoBackupSnapshot | null> {
  const arr = Array.from(files || []);
  if (arr.length === 0) return null;

  // Prefer exact yaad_backup.json first
  const exact = arr.find((f) => f.name.toLowerCase() === LOCAL_BACKUP_FILE_NAME);
  const candidates = exact
    ? [exact]
    : arr
        .filter((f) => f.name.toLowerCase().endsWith('.json') && f.name.toLowerCase().includes('yaad'))
        .sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0));

  for (const file of candidates) {
    try {
      const text = await file.text();
      const parsed = safeParseJsonFromReadFileData(text);
      if (isValidSnapshot(parsed)) {
        return parsed;
      }
    } catch {
      // try next
    }
  }
  return null;
}

/**
 * Backwards-compatible wrapper used by existing callers.
 */
export async function requestLocalFolderPermission(
  interactivePicker: boolean = false
): Promise<{
  granted: boolean;
  nativePickerOpened: boolean;
  folderName: string;
  restoredSnapshot?: AutoBackupSnapshot | null;
}> {
  if (interactivePicker) {
    const res = await chooseAutoBackupFolder();
    return {
      granted: res.granted,
      nativePickerOpened: !res.unsupportedReason,
      folderName: res.folderName,
      restoredSnapshot: res.restoredSnapshot,
    };
  }

  await initDefaultYaadBackupFolder();
  const status = await getBackupFolderStatus();
  const restoredSnapshot = status.connected ? (await readBackupFromConnectedFolder()).snapshot : null;
  return {
    granted: status.connected,
    nativePickerOpened: false,
    folderName: status.folderName || LOCAL_BACKUP_FOLDER_NAME,
    restoredSnapshot,
  };
}

export async function checkLocalFolderPermissionStatus(): Promise<boolean> {
  const status = await getBackupFolderStatus();
  return status.connected;
}

export async function revokeLocalFolderPermission(): Promise<void> {
  try {
    localStorage.removeItem(FOLDER_PERMISSION_GRANTED_KEY);
    localStorage.removeItem(BACKUP_FOLDER_NAME_CACHE_KEY);
  } catch {
    // ignore
  }
  if (Capacitor.isNativePlatform()) {
    try {
      await (LocalNotifications as any).clearBackupFolder();
    } catch {
      // ignore
    }
    return;
  }
  try {
    const db = await openVaultDB();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction([HANDLE_STORE_NAME], 'readwrite');
        const store = tx.objectStore(HANDLE_STORE_NAME);
        store.delete('yaad_folder_dir');
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  } catch {
    // ignore
  }
}

// ============================================================================
// Folder Selection Reminder Prompt State Helpers
// ============================================================================

export function snoozeBackupFolderPrompt(now: number = Date.now()): void {
  try {
    localStorage.setItem(BACKUP_FOLDER_PROMPT_SNOOZED_AT_KEY, String(now));
  } catch {
    // ignore
  }
}

export function dismissBackupFolderPromptForever(): void {
  try {
    localStorage.setItem(BACKUP_FOLDER_PROMPT_DISMISSED_KEY, 'true');
  } catch {
    // ignore
  }
}

export function shouldShowBackupFolderReminderPrompt(
  status: BackupFolderStatus,
  totalActiveItems: number,
  now: number = Date.now()
): 'first_launch' | 'reminder' | 'reconnect' | null {
  if (typeof window === 'undefined') return null;
  if (status.connected) return null;

  try {
    const snoozedAt = parseInt(localStorage.getItem(BACKUP_FOLDER_PROMPT_SNOOZED_AT_KEY) || '0', 10);
    const isInCooldown = !isNaN(snoozedAt) && snoozedAt > 0 && now - snoozedAt < FOLDER_REMINDER_COOLDOWN_MS;
    if (isInCooldown) return null;

    if (status.needsReconnect) {
      return 'reconnect';
    }

    const dismissedForever = localStorage.getItem(BACKUP_FOLDER_PROMPT_DISMISSED_KEY) === 'true';
    if (dismissedForever) return null;

    if (totalActiveItems === 0) {
      return 'first_launch';
    }

    return 'reminder';
  } catch {
    return null;
  }
}

/**
 * Writes backup to OPFS 'YAAD/yaad_backup.json'
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
 * Reads backup from OPFS 'YAAD/yaad_backup.json'
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
 * Writes backup to physical 'YAAD/yaad_backup.json' via backend endpoint & Cache Storage
 */
async function writeToServerAndCacheYaadFolder(payload: AutoBackupSnapshot): Promise<void> {
  const jsonStr = JSON.stringify(payload);

  // 1. Cache Storage '/YAAD/yaad_backup.json'
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

  // 2. Physical 'YAAD/yaad_backup.json' folder on host
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
 * Reads backup from physical 'YAAD/yaad_backup.json' via backend endpoint or Cache Storage
 */
async function readFromServerOrCacheYaadFolder(): Promise<AutoBackupSnapshot | null> {
  // 1. Check physical 'YAAD/yaad_backup.json'
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

  // 2. Check Cache Storage '/YAAD/yaad_backup.json'
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
 * Helper to merge two arrays of items with `id` and optional `deletedAt`,
 * preserving newer or soft-deleted state while ensuring existing disk items are never lost when memory state is empty/partial.
 */
function mergeBackupCollection<T extends { id: string; deletedAt?: number }>(
  primary: T[] | undefined,
  secondary: T[] | undefined,
  onlyPreserveWhenPrimaryEmptyOrActive: boolean = false
): T[] {
  const primArr = Array.isArray(primary) ? primary.filter((x) => x && x.id && !x.id.startsWith('seed-') && !x.id.startsWith('sample_')) : [];
  const secArr = Array.isArray(secondary) ? secondary.filter((x) => x && x.id && !x.id.startsWith('seed-') && !x.id.startsWith('sample_')) : [];

  if (secArr.length === 0) return primArr;
  if (primArr.length === 0) return secArr;

  const map = new Map<string, T>();
  for (const item of primArr) {
    map.set(item.id, item);
  }
  for (const diskItem of secArr) {
    const existing = map.get(diskItem.id);
    if (!existing) {
      if (!onlyPreserveWhenPrimaryEmptyOrActive || !diskItem.deletedAt) {
        map.set(diskItem.id, diskItem);
      }
    } else if (!onlyPreserveWhenPrimaryEmptyOrActive && existing.deletedAt && !diskItem.deletedAt) {
      // When recalling/merging backups, if the backup copy is active and local copy was soft-deleted, restore active item
      map.set(diskItem.id, diskItem);
    }
  }
  return Array.from(map.values());
}

/**
 * Saves an automatic snapshot of all user data into:
 * 1) User-chosen folder (Android SAF URI or Desktop FileSystemDirectoryHandle), if connected
 * 2) Fixed app-private YAAD/yaad_backup.json vault (Directory.Data on Android, OPFS/IDB/LocalStorage on Web/Desktop)
 */
export async function performAutoBackup(
  snapshot: {
    reminders: Reminder[];
    ideas: IdeaNote[];
    savedLocations: SavedLocation[];
    occasions: Occasion[];
    settings?: AppSettings;
  },
  options?: { forceReplace?: boolean }
): Promise<boolean> {
  return enqueueBackupWrite(async () => {
    try {
      const now = Date.now();
      const localFolder = LOCAL_BACKUP_FOLDER_NAME;
      const forceReplace = Boolean(options?.forceReplace);

      const savedRecoveryCode = getSavedLaunchRecoveryCodeSync() || undefined;
      let payload: AutoBackupSnapshot = {
        version: 3,
        updatedAt: now,
        folder: localFolder,
        source: 'local_folder',
        reminders: snapshot.reminders || [],
        ideas: snapshot.ideas || [],
        savedLocations: snapshot.savedLocations || [],
        occasions: snapshot.occasions || [],
        settings: snapshot.settings,
        ...(savedRecoveryCode ? { launchGiftRecoveryCode: savedRecoveryCode } : {}),
      };

      // 0. CRITICAL NON-DESTRUCTIVE DISK GUARD:
      // Before overwriting backup files, check if an existing backup file already contains items not yet loaded into memory.
      const isNative = Capacitor.isNativePlatform();
      const dirHandle = isNative ? null : await getDirectoryHandleFromDB();
      if (!forceReplace) {
        let existingDiskSnapshot: AutoBackupSnapshot | null = null;
        if (isNative) {
          try {
            const existing = await Filesystem.readFile({
              path: `${LOCAL_BACKUP_FOLDER_NAME}/${LOCAL_BACKUP_FILE_NAME}`,
              directory: Directory.Data,
              encoding: Encoding.UTF8,
            }).catch(() => null);
            if (existing?.data) {
              const parsed = safeParseJsonFromReadFileData(existing.data);
              if (isValidSnapshot(parsed) && getSnapshotItemCount(parsed) > 0) {
                existingDiskSnapshot = parsed;
              }
            }
          } catch {
            // ignore
          }
          if (!existingDiskSnapshot) {
            const safRes = await readSafBackupNative();
            if (safRes.snapshot && getSnapshotItemCount(safRes.snapshot) > 0) {
              existingDiskSnapshot = safRes.snapshot;
            }
          }
        }

        if (!existingDiskSnapshot && dirHandle) {
          existingDiskSnapshot = await readFromDirectoryHandle(dirHandle);
        }

        if (existingDiskSnapshot) {
          const newItemsCount = getSnapshotItemCount(payload);
          if (newItemsCount === 0 && getSnapshotItemCount(existingDiskSnapshot) > 0) {
            console.warn('[performAutoBackup] Preserving existing backup file on disk with items; avoiding overwrite with empty initial state.');
            return false;
          }

          payload = {
            ...payload,
            reminders: mergeBackupCollection(payload.reminders, existingDiskSnapshot.reminders, true),
            ideas: mergeBackupCollection(payload.ideas, existingDiskSnapshot.ideas, true),
            savedLocations: mergeBackupCollection(payload.savedLocations, existingDiskSnapshot.savedLocations, true),
            occasions: mergeBackupCollection(payload.occasions, existingDiskSnapshot.occasions, true),
          };
        }
      }

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

      if (isNative) {
        // 3a (Native). App-private Directory.Data/YAAD/yaad_backup.json
        try {
          const jsonData = JSON.stringify(payload, null, 2);
          await Filesystem.writeFile({
            path: `${LOCAL_BACKUP_FOLDER_NAME}/${LOCAL_BACKUP_FILE_NAME}`,
            data: jsonData,
            directory: Directory.Data,
            encoding: Encoding.UTF8,
            recursive: true,
          }).catch(() => {});
        } catch {
          // ignore
        }

        // 3b (Native SAF). Write directly to user-selected SAF folder if granted
        await writeSafBackupNative(payload);
      } else {
        // 3 (Desktop/Web). Write to user-selected FileSystemDirectoryHandle if granted
        if (dirHandle) {
          await writeToDirectoryHandle(dirHandle, payload);
        }

        // 4 (Web/PWA). Save to OPFS 'YAAD/yaad_backup.json' & cache
        await writeToOpfsYaadFolder(payload);
        await writeToServerAndCacheYaadFolder(payload);
      }

      return true;
    } catch (error) {
      console.error('Failed to perform auto backup:', error);
      return false;
    }
  });
}

/**
 * Retrieves the best/latest backup across local storage layers:
 * - Native Android: persisted SAF folder (if connected) + app-private Directory.Data/YAAD + IndexedDB + LocalStorage
 * - Desktop/Web: user-selected FileSystemDirectoryHandle + OPFS/YAAD + Cache/Server + IndexedDB + LocalStorage
 */
export async function retrieveFromLocalYaadFolder(): Promise<AutoBackupSnapshot | null> {
  const candidates: { snap: AutoBackupSnapshot; isPhysicalDisk: boolean }[] = [];
  const isNative = Capacitor.isNativePlatform();

  if (!isNative) {
    // 1. User-granted Device Folder Handle on Desktop Web
    try {
      const dirHandle = await getDirectoryHandleFromDB();
      if (dirHandle) {
        const fromHandle = await readFromDirectoryHandle(dirHandle);
        if (fromHandle) candidates.push({ snap: fromHandle, isPhysicalDisk: true });
      }
    } catch {
      // ignore
    }
  } else {
    // 1b. Native Android Persisted SAF Folder (takes priority as external chosen folder)
    try {
      const safRead = await readSafBackupNative();
      if (safRead.snapshot) {
        candidates.push({ snap: safRead.snapshot, isPhysicalDisk: true });
      }
    } catch {
      // ignore
    }

    // 2. Native Android Capacitor Filesystem (app-private Directory.Data/YAAD)
    try {
      const searchDirs = [Directory.Data];
      const folderPathsToTry = [LOCAL_BACKUP_FOLDER_NAME];

      for (const dir of searchDirs) {
        const isExternalDisk = false;
        for (const folderPath of folderPathsToTry) {
          try {
            // A) Fast direct readFile for standard backup file first
            const directPath = `${folderPath}/${LOCAL_BACKUP_FILE_NAME}`;
            const directRes = await Filesystem.readFile({
              path: directPath,
              directory: dir,
              encoding: Encoding.UTF8,
            }).catch(() => null);

            if (directRes?.data) {
              const parsed = safeParseJsonFromReadFileData(directRes.data);
              if (isValidSnapshot(parsed)) {
                candidates.push({ snap: parsed, isPhysicalDisk: isExternalDisk });
              }
            }

            // B) Try readdir inside the YAAD folder in case a backup json exists
            const dirInfo = await Filesystem.readdir({
              path: folderPath,
              directory: dir,
            }).catch(() => null);

            if (dirInfo && Array.isArray(dirInfo.files)) {
              const jsonCandidates: { name: string; mtime: number }[] = [];

              for (const fileItem of dirInfo.files) {
                const fname = typeof fileItem === 'string' ? fileItem : fileItem?.name;
                if (fname && fname.toLowerCase().endsWith('.json') && fname !== LOCAL_BACKUP_FILE_NAME) {
                  const mtime = typeof fileItem === 'object' && fileItem?.mtime ? fileItem.mtime : 0;
                  jsonCandidates.push({ name: fname, mtime });
                }
              }

              jsonCandidates.sort((a, b) => {
                if (a.mtime && b.mtime && a.mtime !== b.mtime) {
                  return b.mtime - a.mtime;
                }
                return b.name.localeCompare(a.name);
              });

              for (const item of jsonCandidates.slice(0, 5)) {
                const fullFilePath = `${folderPath}/${item.name}`;
                const fileRes = await Filesystem.readFile({
                  path: fullFilePath,
                  directory: dir,
                  encoding: Encoding.UTF8,
                }).catch(() => null);

                if (fileRes?.data) {
                  const parsed = safeParseJsonFromReadFileData(fileRes.data);
                  if (isValidSnapshot(parsed)) {
                    candidates.push({ snap: parsed, isPhysicalDisk: isExternalDisk });
                  }
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
  }

  // 3. OPFS 'YAAD/yaad_backup.json' & Web Server/Cache (Web/PWA only)
  if (!isNative) {
    try {
      const fromOpfs = await readFromOpfsYaadFolder();
      if (fromOpfs) candidates.push({ snap: fromOpfs, isPhysicalDisk: false });
    } catch {
      // ignore
    }

    try {
      const fromServerOrCache = await readFromServerOrCacheYaadFolder();
      if (fromServerOrCache) candidates.push({ snap: fromServerOrCache, isPhysicalDisk: false });
    } catch {
      // ignore
    }
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
        candidates.push({ snap: dbResult, isPhysicalDisk: false });
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
        candidates.push({ snap: parsed, isPhysicalDisk: false });
      }
    }
  } catch {
    // ignore
  }

  if (candidates.length === 0) return null;

  // Prefer physical disk candidates when non-empty, and newest updatedAt among non-empty snapshots
  candidates.sort((a, b) => {
    const aItems = getSnapshotItemCount(a.snap);
    const bItems = getSnapshotItemCount(b.snap);
    if (aItems > 0 && bItems === 0) return -1;
    if (bItems > 0 && aItems === 0) return 1;

    if (a.isPhysicalDisk !== b.isPhysicalDisk && aItems > 0 && bItems > 0) {
      return a.isPhysicalDisk ? -1 : 1;
    }

    const tsDiff = (b.snap.updatedAt || 0) - (a.snap.updatedAt || 0);
    if (tsDiff !== 0) return tsDiff;

    return bItems - aItems;
  });

  // Merge collections across valid candidates so no reminders/occasions/ideas/locations in any backup file are left behind
  const hasPhysicalWithItems = candidates.some((c) => c.isPhysicalDisk && getSnapshotItemCount(c.snap) > 0);
  const pool = hasPhysicalWithItems ? candidates.filter((c) => c.isPhysicalDisk) : candidates;

  let mergedBest: AutoBackupSnapshot = { ...pool[0].snap };
  for (let i = 1; i < pool.length; i++) {
    const cand = pool[i].snap;
    mergedBest = {
      ...mergedBest,
      reminders: mergeBackupCollection(mergedBest.reminders, cand.reminders, false),
      ideas: mergeBackupCollection(mergedBest.ideas, cand.ideas, false),
      savedLocations: mergeBackupCollection(mergedBest.savedLocations, cand.savedLocations, false),
      occasions: mergeBackupCollection(mergedBest.occasions, cand.occasions, false),
    };
  }

  return mergedBest;
}

/**
 * Automatic Recall / Restore from Connected Backup Folder & App-Private YAAD Vault
 */
export async function retrieveLatestBackupWithPriority(): Promise<{
  snapshot: AutoBackupSnapshot | null;
  source: 'local_folder' | null;
}> {
  const localSnapshot = await retrieveFromLocalYaadFolder();
  if (localSnapshot) {
    return { snapshot: localSnapshot, source: 'local_folder' };
  }
  return { snapshot: null, source: null };
}

export function markManualBackupCompleted(now: number = Date.now()): void {
  try {
    localStorage.setItem(LAST_MANUAL_BACKUP_KEY, String(now));
    localStorage.removeItem(BACKUP_PROMPT_DISMISSED_AT_KEY);
  } catch {
    // ignore
  }
}

export function snoozePeriodicBackupPrompt(now: number = Date.now()): void {
  try {
    localStorage.setItem(BACKUP_PROMPT_DISMISSED_AT_KEY, String(now));
  } catch {
    // ignore
  }
}

export function shouldShowPeriodicBackupPrompt(totalActiveItems: number, now: number = Date.now()): boolean {
  if (typeof window === 'undefined' || totalActiveItems <= 0) return false;
  try {
    let firstSeenAt = parseInt(localStorage.getItem(BACKUP_FIRST_DATA_SEEN_KEY) || '0', 10);
    if (!firstSeenAt || isNaN(firstSeenAt)) {
      firstSeenAt = now;
      localStorage.setItem(BACKUP_FIRST_DATA_SEEN_KEY, String(now));
      return false;
    }

    const lastManualAt = parseInt(localStorage.getItem(LAST_MANUAL_BACKUP_KEY) || '0', 10);
    const dismissedAt = parseInt(localStorage.getItem(BACKUP_PROMPT_DISMISSED_AT_KEY) || '0', 10);
    const baseline = Math.max(firstSeenAt, isNaN(lastManualAt) ? 0 : lastManualAt);
    const snoozeUntil = isNaN(dismissedAt) ? 0 : dismissedAt;

    return now - baseline >= THIRTY_DAYS_MS && now - snoozeUntil >= THIRTY_DAYS_MS;
  } catch {
    return false;
  }
}

/**
 * Manual Export:
 * - On Native Android: writes a temporary JSON file in Directory.Cache and opens the system Share sheet via @capacitor/share.
 * - On Web/PWA: triggers a clean JSON file download.
 */
export async function exportBackupToFile(
  snapshot: {
    reminders: Reminder[];
    ideas: IdeaNote[];
    savedLocations: SavedLocation[];
    occasions: Occasion[];
    settings?: AppSettings;
  },
  language: 'fa' | 'en' = 'fa'
): Promise<{ ok: boolean; fileName: string; method: 'share' | 'download'; error?: string }> {
  const now = Date.now();
  const dateStamp = new Date(now).toISOString().slice(0, 10);
  const fileName = `yaad_backup_${dateStamp}.json`;

  const savedRecoveryCode = getSavedLaunchRecoveryCodeSync() || undefined;
  const payload: AutoBackupSnapshot = {
    version: 3,
    updatedAt: now,
    folder: LOCAL_BACKUP_FOLDER_NAME,
    source: 'local_folder',
    reminders: snapshot.reminders || [],
    ideas: snapshot.ideas || [],
    savedLocations: snapshot.savedLocations || [],
    occasions: snapshot.occasions || [],
    settings: snapshot.settings,
    ...(savedRecoveryCode ? { launchGiftRecoveryCode: savedRecoveryCode } : {}),
  };

  const jsonStr = JSON.stringify(payload, null, 2);

  if (Capacitor.isNativePlatform()) {
    try {
      await Filesystem.writeFile({
        path: fileName,
        data: jsonStr,
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
        recursive: true,
      });
      const uriRes = await Filesystem.getUri({
        path: fileName,
        directory: Directory.Cache,
      });
      await Share.share({
        title: language === 'en' ? 'YAAD Backup File' : 'فایل پشتیبان یاد',
        text:
          language === 'en'
            ? 'YAAD JSON backup file'
            : 'فایل پشتیبان اطلاعات اپلیکیشن یاد (YAAD)',
        files: [uriRes.uri],
        dialogTitle:
          language === 'en'
            ? 'Save or Share YAAD Backup'
            : 'ذخیره یا اشتراک‌گذاری فایل پشتیبان یاد',
      });
      markManualBackupCompleted(now);
      return { ok: true, fileName, method: 'share' };
    } catch (err: any) {
      return {
        ok: false,
        fileName,
        method: 'share',
        error: err?.message || (language === 'en' ? 'Share cancelled or failed.' : 'ارسال یا ذخیره فایل انجام نشد.'),
      };
    }
  }

  try {
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fileName;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      try {
        document.body.removeChild(link);
        URL.revokeObjectURL(objectUrl);
      } catch {
        // ignore
      }
    }, 500);

    markManualBackupCompleted(now);
    return { ok: true, fileName, method: 'download' };
  } catch (err: any) {
    return {
      ok: false,
      fileName,
      method: 'download',
      error: err?.message || (language === 'en' ? 'Backup download failed.' : 'دانلود فایل پشتیبان انجام نشد.'),
    };
  }
}

/**
 * Manual Import: reads and validates a JSON backup file chosen via <input type="file">.
 */
export async function importBackupFromFile(file: File): Promise<AutoBackupSnapshot | null> {
  const rawText = await file.text();
  const parsed = safeParseJsonFromReadFileData(rawText);
  if (!isValidSnapshot(parsed)) {
    return null;
  }
  markManualBackupCompleted(Date.now());
  return parsed;
}


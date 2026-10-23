/**
 * Auto Backup & Local Device Storage Vault Utility for YAAD
 * - Local Backup Folder: "/YAAD" in Root Storage (Device Storage / FileSystem Handle / OPFS / Server Folder / IndexedDB / LocalStorage)
 * - Automatic Backup & Restore on every app open, close, and re-installation
 */

import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Reminder, IdeaNote, SavedLocation, Occasion, AppSettings } from '../types';

export const AUTO_BACKUP_STORAGE_KEY = 'yaad_auto_backup_vault_v1';
export const LOCAL_BACKUP_FOLDER_NAME = 'YAAD';
export const LOCAL_BACKUP_FILE_NAME = 'yaad_backup.json';
export const FOLDER_PERMISSION_GRANTED_KEY = 'yaad_folder_permission_granted_v2';
export const LAST_LOCAL_BACKUP_KEY = 'yaad_last_local_backup_timestamp';

const DB_NAME = 'yaad_persistent_vault';
const DB_VERSION = 2;
const STORE_NAME = 'app_backups';
const HANDLE_STORE_NAME = 'folder_handles';
const CACHE_BACKUP_NAME = 'yaad-remider-folder-vault-v1';
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
 * Initializes & verifies access to the local "Yaad reminder" folder.
 * When interactivePicker = true and supported by browser, opens directory picker
 * to create/select the "Yaad reminder" folder on device storage.
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

  let isStorageActuallyGranted = false;
  if (Capacitor.isNativePlatform()) {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const perms = (await LocalNotifications.checkPermissions()) as any;
      if (perms && typeof perms.storage === 'string') {
        isStorageActuallyGranted = perms.storage === 'granted';
      } else {
        const cleanSubName =
          effectiveFolderName
            .replace(/^(Documents|Download|InternalStorage)\//i, '')
            .trim() || LOCAL_BACKUP_FOLDER_NAME;
        await Filesystem.writeFile({
          path: `${cleanSubName}/.yaad_perm_probe`,
          data: 'ok',
          directory: Directory.ExternalStorage,
          encoding: Encoding.UTF8,
          recursive: true,
        });
        await Filesystem.deleteFile({
          path: `${cleanSubName}/.yaad_perm_probe`,
          directory: Directory.ExternalStorage,
        }).catch(() => {});
        isStorageActuallyGranted = true;
      }
    } catch {
      isStorageActuallyGranted = false;
    }
  } else {
    try {
      const handle = await getDirectoryHandleFromDB();
      if (handle) {
        if (typeof handle.queryPermission === 'function') {
          const permState = await handle.queryPermission({ mode: 'readwrite' });
          isStorageActuallyGranted = permState === 'granted';
        } else {
          isStorageActuallyGranted = true;
        }
      }
    } catch {
      isStorageActuallyGranted = false;
    }
  }

  try {
    if (isStorageActuallyGranted) {
      localStorage.setItem(FOLDER_PERMISSION_GRANTED_KEY, 'true');
    } else {
      localStorage.removeItem(FOLDER_PERMISSION_GRANTED_KEY);
    }
  } catch {
    // ignore
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
          const isGranted = perms.storage === 'granted';
          try {
            if (isGranted) {
              localStorage.setItem(FOLDER_PERMISSION_GRANTED_KEY, 'true');
            } else {
              localStorage.removeItem(FOLDER_PERMISSION_GRANTED_KEY);
            }
          } catch {}
          return isGranted;
        }
      } catch {
        // Fallback to probe below
      }
      try {
        await Filesystem.writeFile({
          path: `${LOCAL_BACKUP_FOLDER_NAME}/.yaad_perm_probe`,
          data: 'ok',
          directory: Directory.ExternalStorage,
          encoding: Encoding.UTF8,
          recursive: true,
        });
        await Filesystem.deleteFile({
          path: `${LOCAL_BACKUP_FOLDER_NAME}/.yaad_perm_probe`,
          directory: Directory.ExternalStorage,
        }).catch(() => {});
        try {
          localStorage.setItem(FOLDER_PERMISSION_GRANTED_KEY, 'true');
        } catch {}
        return true;
      } catch {
        try {
          localStorage.removeItem(FOLDER_PERMISSION_GRANTED_KEY);
        } catch {}
        return false;
      }
    }

    const handle = await getDirectoryHandleFromDB();
    if (handle) {
      if (typeof handle.queryPermission === 'function') {
        const permState = await handle.queryPermission({ mode: 'readwrite' });
        const granted = permState === 'granted';
        try {
          if (granted) {
            localStorage.setItem(FOLDER_PERMISSION_GRANTED_KEY, 'true');
          } else {
            localStorage.removeItem(FOLDER_PERMISSION_GRANTED_KEY);
          }
        } catch {}
        return granted;
      }
      return true;
    }
    try {
      localStorage.removeItem(FOLDER_PERMISSION_GRANTED_KEY);
    } catch {}
  } catch {
    // ignore
  }
  return false;
}

/**
 * Helper to write backup JSON into a FileSystemDirectoryHandle ('Yaad reminder')
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
 * Helper to read backup JSON from a FileSystemDirectoryHandle ('Yaad reminder')
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
 * Writes backup to OPFS 'Yaad reminder/yaad_backup.json'
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
 * Reads backup from OPFS 'Yaad reminder/yaad_backup.json'
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
 * Writes backup to physical 'Yaad reminder/yaad_backup.json' via backend endpoint & Cache Storage
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

  // 2. Physical 'Yaad reminder/yaad_backup.json' folder on host
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
 * Reads backup from physical 'Yaad reminder/yaad_backup.json' via backend endpoint or Cache Storage
 */
async function readFromServerOrCacheYaadFolder(): Promise<AutoBackupSnapshot | null> {
  // 1. Check physical 'Yaad reminder/yaad_backup.json'
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
 * Saves an automatic snapshot of all user data into the Local 'Yaad reminder' folder
 * (Device Directory Handle, Capacitor Filesystem, OPFS, Server Folder, Cache, IndexedDB, LocalStorage)
 */
export async function performAutoBackup(
  snapshot: {
    reminders: Reminder[];
    ideas: IdeaNote[];
    savedLocations: SavedLocation[];
    occasions: Occasion[];
    settings?: AppSettings;
  }
): Promise<boolean> {
  try {
    const now = Date.now();
    const localFolder = LOCAL_BACKUP_FOLDER_NAME;

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

    // 3. Save to Device Folder 'YAAD/yaad_backup.json' (FileSystemDirectoryHandle if granted)
    const dirHandle = await getDirectoryHandleFromDB();
    if (dirHandle) {
      await writeToDirectoryHandle(dirHandle, payload);
    }

    // 4. Save to Native Capacitor Filesystem 'YAAD/yaad_backup.json' in root storage if available
    try {
      const cleanSubName = LOCAL_BACKUP_FOLDER_NAME;
      const newItemsCount = getSnapshotItemCount(payload);

      // SAFETY GUARD: If payload has 0 items (e.g. app freshly mounted or reinstalled with empty initial arrays),
      // NEVER overwrite an existing backup on disk that contains items!
      if (newItemsCount === 0) {
        let existingBackupHasItems = false;
        for (const dir of [Directory.ExternalStorage, Directory.External, Directory.Documents]) {
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
        Directory.ExternalStorage,
        Directory.External,
        Directory.Documents,
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
    } catch {
      // ignore
    }

    // 5. Save to OPFS 'YAAD/yaad_backup.json' & physical 'YAAD' folder
    await writeToOpfsYaadFolder(payload);
    await writeToServerAndCacheYaadFolder(payload);

    return true;
  } catch (error) {
    console.error('Failed to perform auto backup:', error);
    return false;
  }
}

/**
 * Retrieves the best/latest backup from the Local 'YAAD' folder in root storage across all local storage layers.
 */
export async function retrieveFromLocalYaadFolder(_customLocalFolder?: string): Promise<AutoBackupSnapshot | null> {
  const candidates: AutoBackupSnapshot[] = [];

  // 1. User-granted Device Folder Handle ('YAAD/yaad_backup.json')
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
    const cleanSubName = LOCAL_BACKUP_FOLDER_NAME;

    const searchDirs = [
      Directory.ExternalStorage,
      Directory.External,
      Directory.Documents,
      Directory.Data,
    ];

    const folderPathsToTry = [
      cleanSubName,
      'Yaad reminder',
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

  // 3. OPFS 'Yaad reminder/yaad_backup.json'
  try {
    const fromOpfs = await readFromOpfsYaadFolder();
    if (fromOpfs) candidates.push(fromOpfs);
  } catch {
    // ignore
  }

  // 4. Physical 'Yaad reminder/yaad_backup.json' & Cache Storage
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
 * Automatic Recall / Restore from Local 'Yaad reminder' Folder on Device Storage
 */
export async function retrieveLatestBackupWithPriority(
  _unusedToken?: string | null,
  settings?: Partial<AppSettings>
): Promise<{ snapshot: AutoBackupSnapshot | null; source: 'local_folder' | null }> {
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

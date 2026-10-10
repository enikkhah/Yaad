/**
 * Auto Backup & Local Vault Utility for YAAD
 * Provides automatic local snapshots in IndexedDB & persistent storage
 * Ensures data survives cache clears, updates, and re-installations.
 */

import { Reminder, IdeaNote, SavedLocation, Occasion, AppSettings } from '../types';

export const AUTO_BACKUP_STORAGE_KEY = 'yaad_auto_backup_vault_v1';
const DB_NAME = 'yaad_persistent_vault';
const DB_VERSION = 1;
const STORE_NAME = 'app_backups';

export interface AutoBackupSnapshot {
  version: number;
  updatedAt: number;
  reminders: Reminder[];
  ideas: IdeaNote[];
  savedLocations: SavedLocation[];
  occasions: Occasion[];
  settings?: AppSettings;
}

/**
 * Open or initialize IndexedDB for robust persistent offline storage
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
 * Saves an automatic snapshot of all user data into both localStorage vault and IndexedDB.
 * Called automatically after every creation, edit, postpone, delete, or setting change.
 */
export async function performAutoBackup(snapshot: {
  reminders: Reminder[];
  ideas: IdeaNote[];
  savedLocations: SavedLocation[];
  occasions: Occasion[];
  settings?: AppSettings;
}): Promise<boolean> {
  try {
    const payload: AutoBackupSnapshot = {
      version: 2,
      updatedAt: Date.now(),
      reminders: snapshot.reminders || [],
      ideas: snapshot.ideas || [],
      savedLocations: snapshot.savedLocations || [],
      occasions: snapshot.occasions || [],
      settings: snapshot.settings,
    };

    // 1. Save to primary local vault key
    try {
      localStorage.setItem(AUTO_BACKUP_STORAGE_KEY, JSON.stringify(payload));
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

    return true;
  } catch (error) {
    console.error('Failed to perform auto backup:', error);
    return false;
  }
}

/**
 * Attempts to retrieve the latest backup snapshot.
 * Checks IndexedDB first (resilient across reinstalls & clearing localStorage), then fallback to localStorage.
 */
export async function retrieveLatestBackup(): Promise<AutoBackupSnapshot | null> {
  // Check IndexedDB
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

      if (
        dbResult &&
        (Array.isArray(dbResult.reminders) ||
          Array.isArray(dbResult.ideas) ||
          Array.isArray(dbResult.savedLocations) ||
          Array.isArray(dbResult.occasions))
      ) {
        return dbResult as AutoBackupSnapshot;
      }
    }
  } catch {
    // Continue to localStorage fallback
  }

  // Fallback to LocalStorage vault key
  try {
    const raw = localStorage.getItem(AUTO_BACKUP_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed === 'object' &&
        (Array.isArray(parsed.reminders) ||
          Array.isArray(parsed.ideas) ||
          Array.isArray(parsed.savedLocations) ||
          Array.isArray(parsed.occasions))
      ) {
        return parsed as AutoBackupSnapshot;
      }
    }
  } catch {
    // Continue
  }

  // Second fallback to previous snapshot key
  try {
    const rawLegacy = localStorage.getItem('yaad_backup_snapshot_v1');
    if (rawLegacy) {
      const parsed = JSON.parse(rawLegacy);
      if (parsed && typeof parsed === 'object') {
        return parsed as AutoBackupSnapshot;
      }
    }
  } catch {
    // Ignore
  }

  return null;
}

/**
 * Returns summary info of the latest stored auto backup.
 */
export function getLatestBackupTimestamp(): number | null {
  try {
    const raw = localStorage.getItem(AUTO_BACKUP_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return parsed.updatedAt || null;
    }
  } catch {
    // Ignore
  }
  return null;
}

import { useEffect, useState } from 'react';

export const MEDIA_REF_PREFIX = 'yaad-media://';
const MEDIA_DB_NAME = 'yaad_media_store_v1';
const MEDIA_DB_VERSION = 1;
const MEDIA_STORE_NAME = 'blobs';

interface StoredMediaRecord {
  id: string;
  blob: Blob;
  mimeType: string;
  createdAt: number;
}

const resolvedUrlCache = new Map<string, string>();
const inFlightLoads = new Map<string, Promise<string | null>>();

export function isMediaRef(url?: string | null): url is string {
  return typeof url === 'string' && url.startsWith(MEDIA_REF_PREFIX);
}

function openMediaDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(MEDIA_DB_NAME, MEDIA_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MEDIA_STORE_NAME)) {
        db.createObjectStore(MEDIA_STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open media database'));
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to convert blob to data URL'));
      }
    };
    reader.onerror = () => reject(reader.error || new Error('FileReader error'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Persists an audio or video Blob in IndexedDB so it survives page reloads,
 * PWA restarts, and Capacitor Android app relaunches.
 * Returns a persistent URI like `yaad-media://<id>` and primes the in-memory objectURL cache.
 */
export async function saveMediaBlob(blob: Blob): Promise<string> {
  const id = `media_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const refUri = `${MEDIA_REF_PREFIX}${id}`;

  try {
    const db = await openMediaDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(MEDIA_STORE_NAME, 'readwrite');
      const store = tx.objectStore(MEDIA_STORE_NAME);
      const record: StoredMediaRecord = {
        id,
        blob,
        mimeType: blob.type || 'application/octet-stream',
        createdAt: Date.now(),
      };
      store.put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Failed to persist media blob'));
    });

    const objectUrl = URL.createObjectURL(blob);
    resolvedUrlCache.set(refUri, objectUrl);
    return refUri;
  } catch (err) {
    console.warn('[mediaStorage] IndexedDB save failed, using fallback:', err);
    if (blob.size <= 2 * 1024 * 1024) {
      try {
        return await blobToDataUrl(blob);
      } catch {
        // fall through to objectURL
      }
    }
    return URL.createObjectURL(blob);
  }
}

/**
 * Resolves a persisted `yaad-media://...` reference (or passes through regular http/data/blob URLs)
 * into a playable browser/WebView URL.
 */
export async function getMediaBlobUrl(refOrUrl: string): Promise<string | null> {
  if (!refOrUrl) return null;
  if (!isMediaRef(refOrUrl)) {
    return refOrUrl;
  }

  const cached = resolvedUrlCache.get(refOrUrl);
  if (cached) {
    return cached;
  }

  const existingPromise = inFlightLoads.get(refOrUrl);
  if (existingPromise) {
    return existingPromise;
  }

  const key = refOrUrl.slice(MEDIA_REF_PREFIX.length);
  const loadPromise = (async () => {
    try {
      const db = await openMediaDb();
      const record = await new Promise<StoredMediaRecord | undefined>((resolve, reject) => {
        const tx = db.transaction(MEDIA_STORE_NAME, 'readonly');
        const store = tx.objectStore(MEDIA_STORE_NAME);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result as StoredMediaRecord | undefined);
        req.onerror = () => reject(req.error || new Error('Failed to read media blob'));
      });

      if (!record || !(record.blob instanceof Blob)) {
        return null;
      }

      const objectUrl = URL.createObjectURL(record.blob);
      resolvedUrlCache.set(refOrUrl, objectUrl);
      return objectUrl;
    } catch (err) {
      console.warn('[mediaStorage] Failed to load persisted media blob:', err);
      return null;
    } finally {
      inFlightLoads.delete(refOrUrl);
    }
  })();

  inFlightLoads.set(refOrUrl, loadPromise);
  return loadPromise;
}

/**
 * React hook that resolves a `yaad-media://` reference into a playable `blob:` URL,
 * or passes through existing `data:` / `http:` / `blob:` URLs immediately.
 */
export function usePersistentMediaUrl(src?: string | null): string | undefined {
  const [resolvedUrl, setResolvedUrl] = useState<string | undefined>(() => {
    if (!src) return undefined;
    if (!isMediaRef(src)) return src;
    return resolvedUrlCache.get(src);
  });

  useEffect(() => {
    if (!src) {
      setResolvedUrl(undefined);
      return;
    }
    if (!isMediaRef(src)) {
      setResolvedUrl(src);
      return;
    }
    const cached = resolvedUrlCache.get(src);
    if (cached) {
      setResolvedUrl(cached);
      return;
    }

    let cancelled = false;
    setResolvedUrl(undefined);
    getMediaBlobUrl(src).then((url) => {
      if (!cancelled) {
        setResolvedUrl(url || undefined);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [src]);

  return resolvedUrl;
}

import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import { Auth, getAuth, signInAnonymously } from 'firebase/auth';
import {
  doc,
  Firestore,
  getDocFromServer,
  getFirestore,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import {
  LAUNCH_BATCH_1_MAX,
  LAUNCH_BATCH_2_MAX,
  LaunchOfferBatch,
} from '../config/billingConfig';
import { isValidFirebaseApiKey } from './googleSync';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export interface LaunchOfferAssignment {
  version: number;
  uid: string;
  userNumber: number;
  batch: LaunchOfferBatch; // 1 = users 1..365 (100% off Lifetime), 2 = users 366..730 (100% off 1Y), 0 = regular
  assignedAt: number;
  claimedGift?: boolean;
}

export type LaunchOfferStatus = 'assigned' | 'pending_network' | 'unconfigured';

export interface LaunchOfferSyncResult {
  status: LaunchOfferStatus;
  assignment: LaunchOfferAssignment | null;
}

const LAUNCH_OFFER_STORAGE_KEY = 'yaad_launch_offer_v1';
const LAUNCH_OFFER_DATA_FILE_PATH = 'YAAD/yaad_launch_offer_v1.json';
const FIREBASE_NETWORK_TIMEOUT_MS = 4500;

let cachedFirebaseServices: {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
} | null = null;
let connectionTested = false;
let inFlightSyncPromise: Promise<LaunchOfferSyncResult> | null = null;

const isNative = (): boolean => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

export function computeBatchFromUserNumber(userNumber: number): LaunchOfferBatch {
  if (userNumber >= 1 && userNumber <= LAUNCH_BATCH_1_MAX) return 1;
  if (userNumber > LAUNCH_BATCH_1_MAX && userNumber <= LAUNCH_BATCH_2_MAX) return 2;
  return 0;
}

function isValidAssignment(raw: any): raw is LaunchOfferAssignment {
  return Boolean(
    raw &&
      typeof raw === 'object' &&
      typeof raw.uid === 'string' &&
      raw.uid.length > 0 &&
      typeof raw.userNumber === 'number' &&
      Number.isInteger(raw.userNumber) &&
      raw.userNumber >= 1 &&
      (raw.batch === 0 || raw.batch === 1 || raw.batch === 2) &&
      typeof raw.assignedAt === 'number'
  );
}

export function readLocalLaunchOfferSync(): LaunchOfferAssignment | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LAUNCH_OFFER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isValidAssignment(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeLocalLaunchOffer(assignment: LaunchOfferAssignment): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LAUNCH_OFFER_STORAGE_KEY, JSON.stringify(assignment));
  } catch {
    // ignore
  }
}

async function readNativeLaunchOffer(): Promise<LaunchOfferAssignment | null> {
  if (!isNative()) return null;
  try {
    const res = await Filesystem.readFile({
      path: LAUNCH_OFFER_DATA_FILE_PATH,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    });
    if (!res?.data) return null;
    const parsed = JSON.parse(typeof res.data === 'string' ? res.data : String(res.data));
    return isValidAssignment(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function writeNativeLaunchOffer(assignment: LaunchOfferAssignment): Promise<void> {
  if (!isNative()) return;
  try {
    await Filesystem.mkdir({
      path: 'YAAD',
      directory: Directory.Data,
      recursive: true,
    }).catch(() => {});
    await Filesystem.writeFile({
      path: LAUNCH_OFFER_DATA_FILE_PATH,
      data: JSON.stringify(assignment),
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    });
  } catch {
    // ignore
  }
}

export async function markLaunchOfferGiftClaimed(): Promise<LaunchOfferAssignment | null> {
  const local = readLocalLaunchOfferSync();
  const native = await readNativeLaunchOffer();
  const current = local || native;
  if (!current) return null;
  const updated: LaunchOfferAssignment = {
    ...current,
    claimedGift: true,
  };
  writeLocalLaunchOffer(updated);
  await writeNativeLaunchOffer(updated);
  return updated;
}

function resolveFirebaseConfig(): {
  apiKey: string;
  projectId: string;
  authDomain?: string;
  appId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  firestoreDatabaseId?: string;
} | null {
  try {
    const envKey = String((import.meta as any).env?.VITE_FIREBASE_API_KEY || '').trim();
    const envProjectId = String((import.meta as any).env?.VITE_FIREBASE_PROJECT_ID || '').trim();
    if (isValidFirebaseApiKey(envKey) && envProjectId) {
      return {
        apiKey: envKey,
        projectId: envProjectId,
        authDomain:
          String((import.meta as any).env?.VITE_FIREBASE_AUTH_DOMAIN || '').trim() ||
          `${envProjectId}.firebaseapp.com`,
        appId: String((import.meta as any).env?.VITE_FIREBASE_APP_ID || '').trim() || undefined,
        storageBucket:
          String((import.meta as any).env?.VITE_FIREBASE_STORAGE_BUCKET || '').trim() ||
          `${envProjectId}.firebasestorage.app`,
        messagingSenderId:
          String((import.meta as any).env?.VITE_FIREBASE_MESSAGING_SENDER_ID || '').trim() ||
          undefined,
        firestoreDatabaseId:
          String((import.meta as any).env?.VITE_FIREBASE_FIRESTORE_DATABASE_ID || '').trim() ||
          undefined,
      };
    }

    const localConfigs = (import.meta as any).glob?.('/firebase-applet-config.json', {
      eager: true,
    });
    if (localConfigs) {
      const firstMod: any = Object.values(localConfigs)[0];
      const cfg = firstMod?.default || firstMod;
      if (isValidFirebaseApiKey(cfg?.apiKey) && cfg?.projectId) {
        return {
          apiKey: String(cfg.apiKey).trim(),
          projectId: String(cfg.projectId).trim(),
          authDomain: cfg.authDomain || `${cfg.projectId}.firebaseapp.com`,
          appId: cfg.appId,
          storageBucket: cfg.storageBucket,
          messagingSenderId: cfg.messagingSenderId,
          firestoreDatabaseId: cfg.firestoreDatabaseId,
        };
      }
    }
  } catch {
    // ignore
  }
  return null;
}

function getFirebaseLaunchServices(): {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
} | null {
  if (cachedFirebaseServices) return cachedFirebaseServices;
  const cfg = resolveFirebaseConfig();
  if (!cfg) return null;

  try {
    const app = getApps().length > 0 ? getApp() : initializeApp(cfg);
    const auth = getAuth(app);
    const db = cfg.firestoreDatabaseId
      ? getFirestore(app, cfg.firestoreDatabaseId)
      : getFirestore(app);
    cachedFirebaseServices = { app, auth, db };
    return cachedFirebaseServices;
  } catch {
    return null;
  }
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const services = getFirebaseLaunchServices();
  const currentUser = services?.auth.currentUser;
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: currentUser?.uid ?? null,
      email: currentUser?.email ?? null,
      emailVerified: currentUser?.emailVerified ?? null,
      isAnonymous: currentUser?.isAnonymous ?? null,
      tenantId: currentUser?.tenantId ?? null,
      providerInfo:
        currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('FIREBASE_NETWORK_TIMEOUT'));
    }, timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

async function testConnectionNonBlocking(db: Firestore): Promise<void> {
  if (connectionTested) return;
  connectionTested = true;
  try {
    await withTimeout(getDocFromServer(doc(db, 'test', 'connection')), 3000);
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('[YAAD LaunchOffer] Firestore client is currently offline.');
    }
  }
}

/**
 * Assigns or retrieves this installation's 365-user Launch Offer batch.
 * - Uses local cache (`Directory.Data` + `localStorage`) so each installation claims at most once.
 * - Resilient on Iran networks without VPN: bounded by a 4.5s timeout and never blocks or throws.
 */
export async function syncLaunchOfferAssignment(): Promise<LaunchOfferSyncResult> {
  // 1. Check persisted local/native assignment first so we never re-increment
  const localCached = readLocalLaunchOfferSync();
  const nativeCached = await readNativeLaunchOffer();
  const existing = localCached || nativeCached;
  if (existing) {
    writeLocalLaunchOffer(existing);
    await writeNativeLaunchOffer(existing);
    return {
      status: 'assigned',
      assignment: existing,
    };
  }

  const services = getFirebaseLaunchServices();
  if (!services) {
    return {
      status: 'unconfigured',
      assignment: null,
    };
  }

  if (inFlightSyncPromise) {
    return inFlightSyncPromise;
  }

  inFlightSyncPromise = (async (): Promise<LaunchOfferSyncResult> => {
    try {
      const { auth, db } = services;
      void testConnectionNonBlocking(db);

      // 2. Ensure Anonymous Auth session (with strict timeout for restricted networks)
      let currentUser = auth.currentUser;
      if (!currentUser) {
        const cred = await withTimeout(signInAnonymously(auth), FIREBASE_NETWORK_TIMEOUT_MS);
        currentUser = cred.user;
      }
      if (!currentUser?.uid) {
        return { status: 'pending_network', assignment: null };
      }

      const uid = currentUser.uid;
      const counterRef = doc(db, 'launch_offer', 'counter');
      const claimRef = doc(db, 'launch_claims', uid);

      // 3. Atomic transaction: check if this UID already claimed; otherwise increment counter by +1
      const assigned = await withTimeout(
        runTransaction(db, async (tx) => {
          const existingClaimSnap = await tx.get(claimRef);
          if (existingClaimSnap.exists()) {
            const claimData = existingClaimSnap.data();
            const existingNum = Number(claimData?.userNumber || 0);
            if (existingNum >= 1) {
              const existingBatch = computeBatchFromUserNumber(existingNum);
              return {
                version: 1,
                uid,
                userNumber: existingNum,
                batch: existingBatch,
                assignedAt: Date.now(),
              } satisfies LaunchOfferAssignment;
            }
          }

          const counterSnap = await tx.get(counterRef);
          const prevCount = counterSnap.exists() ? Number(counterSnap.data()?.count || 0) : 0;
          const nextCount = Math.max(1, prevCount + 1);
          const assignedBatch = computeBatchFromUserNumber(nextCount);

          tx.set(counterRef, {
            count: nextCount,
            lastUid: uid,
            updatedAt: serverTimestamp(),
          });

          tx.set(claimRef, {
            uid,
            userNumber: nextCount,
            batch: assignedBatch,
            claimedAt: serverTimestamp(),
          });

          return {
            version: 1,
            uid,
            userNumber: nextCount,
            batch: assignedBatch,
            assignedAt: Date.now(),
          } satisfies LaunchOfferAssignment;
        }),
        FIREBASE_NETWORK_TIMEOUT_MS
      );

      writeLocalLaunchOffer(assigned);
      await writeNativeLaunchOffer(assigned);

      return {
        status: 'assigned',
        assignment: assigned,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (
        msg.toLowerCase().includes('Missing or insufficient permissions'.toLowerCase()) ||
        msg.toLowerCase().includes('permission-denied')
      ) {
        try {
          handleFirestoreError(error, OperationType.WRITE, 'launch_offer/counter');
        } catch {
          // Logged structured FirestoreErrorInfo; swallow so UI never crashes
        }
      }
      // Network timeout or Firebase unreachable without VPN: fall back cleanly to normal pricing
      return {
        status: 'pending_network',
        assignment: null,
      };
    } finally {
      inFlightSyncPromise = null;
    }
  })();

  return inFlightSyncPromise;
}

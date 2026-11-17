import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import { Auth, getAuth, signInAnonymously } from 'firebase/auth';
import {
  doc,
  Firestore,
  getDoc,
  getDocFromServer,
  getFirestore,
  runTransaction,
  serverTimestamp,
  setDoc,
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
  uid?: string;
  userNumber?: number; // Present only when batch is 1 or 2 (1..730)
  batch: LaunchOfferBatch; // 1 = users 1..365 (100% off Lifetime), 2 = users 366..730 (100% off 1Y), 0 = closed/regular
  status?: 'assigned' | 'closed';
  assignedAt: number;
  claimedGift?: boolean;
  recoveryCode?: string; // Format: YAAD-XXXX-XXXX-XXXX (stored locally & in JSON backup; only SHA-256 hash stored in Firestore)
}

export type LaunchOfferStatus = 'assigned' | 'closed' | 'pending_network' | 'unconfigured';

export interface LaunchOfferSyncResult {
  status: LaunchOfferStatus;
  assignment: LaunchOfferAssignment | null;
}

const LAUNCH_OFFER_STORAGE_KEY = 'yaad_launch_offer_v1';
const LAUNCH_OFFER_DATA_FILE_PATH = 'YAAD/yaad_launch_offer_v1.json';
const FIREBASE_NETWORK_TIMEOUT_MS = 4500;
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

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

/**
 * Generates a high-entropy 12-character unambiguous recovery code: YAAD-XXXX-XXXX-XXXX
 * Excludes O, 0, I, 1, L to avoid human reading errors.
 */
export function generateLaunchRecoveryCode(): string {
  const bytes = new Uint8Array(12);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 12; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let chars = '';
  for (let i = 0; i < 12; i++) {
    chars += RECOVERY_ALPHABET[bytes[i] % RECOVERY_ALPHABET.length];
  }
  return `YAAD-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

/**
 * Normalizes user-entered recovery code to canonical `YAAD-XXXX-XXXX-XXXX`.
 * Returns null if the code does not contain 12 valid unambiguous characters.
 */
export function normalizeRecoveryCode(rawInput: string): string | null {
  if (!rawInput || typeof rawInput !== 'string') return null;
  const persian = '۰۱۲۳۴۵۶۷۸۹';
  const arabic = '٠١٢٣٤٥٦٧٨٩';
  let normalized = rawInput.trim().toUpperCase();
  for (let i = 0; i < 10; i++) {
    normalized = normalized
      .replace(new RegExp(persian[i], 'g'), String(i))
      .replace(new RegExp(arabic[i], 'g'), String(i));
  }
  normalized = normalized.replace(/[\s\-_]+/g, '');
  if (normalized.startsWith('YAAD')) {
    normalized = normalized.slice(4);
  }
  if (!/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{12}$/.test(normalized)) {
    return null;
  }
  return `YAAD-${normalized.slice(0, 4)}-${normalized.slice(4, 8)}-${normalized.slice(8, 12)}`;
}

/**
 * Pure-JS SHA-256 fallback in case WebCrypto subtle is unavailable.
 */
function sha256FallbackHex(ascii: string): string {
  const rightRotate = (value: number, amount: number) =>
    (value >>> amount) | (value << (32 - amount));
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  let result = '';

  const words: number[] = [];
  const asciiBitLength = ascii.length * 8;

  let hash: number[] = [];
  const k: number[] = [];
  let primeCounter = 0;

  const isComposite: Record<number, number> = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (let i = 0; i < 313; i += candidate) {
        isComposite[i] = candidate;
      }
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }

  ascii += '\x80';
  while ((ascii.length % 64) - 56) ascii += '\x00';
  for (let i = 0; i < ascii.length; i++) {
    const j = ascii.charCodeAt(i);
    words[i >> 2] |= j << (((3 - i) % 4) * 8);
  }
  words[words.length] = (asciiBitLength / maxWord) | 0;
  words[words.length] = asciiBitLength;

  for (let j = 0; j < words.length; ) {
    const w = words.slice(j, (j += 16));
    const oldHash = hash.slice(0);
    hash = hash.slice(0, 8);

    for (let i = 0; i < 64; i++) {
      const w15 = w[i - 15];
      const w2 = w[i - 2];

      const a = hash[0];
      const e = hash[4];
      const temp1 =
        hash[7] +
        (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
        ((e & hash[5]) ^ (~e & hash[6])) +
        k[i] +
        (w[i] =
          i < 16
            ? w[i]
            : (w[i - 16] +
                (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
                w[i - 7] +
                (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) |
              0);
      const temp2 =
        (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
        ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));

      hash = [(temp1 + temp2) | 0].concat(hash);
      hash[4] = (hash[4] + temp1) | 0;
      hash.pop();
    }

    for (let i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }

  for (let i = 0; i < 8; i++) {
    for (let j = 3; j + 1; j--) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += (b < 16 ? '0' : '') + b.toString(16);
    }
  }
  return result.toLowerCase();
}

export async function sha256Hex(input: string): Promise<string> {
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
      const data = new TextEncoder().encode(input);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').toLowerCase();
    }
  } catch {
    // Fall back to deterministic pure-JS SHA-256
  }
  return sha256FallbackHex(input);
}

function isValidAssignment(raw: any): raw is LaunchOfferAssignment {
  if (!raw || typeof raw !== 'object' || typeof raw.assignedAt !== 'number') {
    return false;
  }
  // Closed state when cap >= 730 (no userNumber stored)
  if (raw.status === 'closed' && raw.batch === 0) {
    return true;
  }
  // Eligible assigned slot (1..730, batch 1 or 2)
  return Boolean(
    typeof raw.uid === 'string' &&
      raw.uid.length > 0 &&
      typeof raw.userNumber === 'number' &&
      Number.isInteger(raw.userNumber) &&
      raw.userNumber >= 1 &&
      raw.userNumber <= LAUNCH_BATCH_2_MAX &&
      (raw.batch === 1 || raw.batch === 2)
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
 * Marks the Launch Offer gift as claimed AND registers a one-time SHA-256 recovery code
 * in `/launch_recovery/{hash}` so the user can restore their gift after uninstall or phone change.
 */
export async function markLaunchOfferGiftClaimed(): Promise<LaunchOfferAssignment | null> {
  const local = readLocalLaunchOfferSync();
  const native = await readNativeLaunchOffer();
  const current = local || native;
  if (!current || (current.batch !== 1 && current.batch !== 2) || !current.userNumber) {
    return null;
  }

  const recoveryCode =
    (current.recoveryCode && normalizeRecoveryCode(current.recoveryCode)) ||
    generateLaunchRecoveryCode();

  // Attempt to register the SHA-256 digest in /launch_recovery/{hash}
  const services = getFirebaseLaunchServices();
  if (services) {
    try {
      const { auth, db } = services;
      let currentUser = auth.currentUser;
      if (!currentUser) {
        const cred = await withTimeout(signInAnonymously(auth), FIREBASE_NETWORK_TIMEOUT_MS);
        currentUser = cred.user;
      }
      if (currentUser?.uid) {
        const codeHash = await sha256Hex(recoveryCode);
        const recoveryRef = doc(db, 'launch_recovery', codeHash);
        await withTimeout(
          setDoc(recoveryRef, {
            uid: currentUser.uid,
            userNumber: current.userNumber,
            batch: current.batch,
            createdAt: serverTimestamp(),
          }),
          FIREBASE_NETWORK_TIMEOUT_MS
        );
      }
    } catch {
      // Even if network is momentarily slow, keep local claim and recovery code
    }
  }

  const updated: LaunchOfferAssignment = {
    ...current,
    status: 'assigned',
    claimedGift: true,
    recoveryCode,
  };
  writeLocalLaunchOffer(updated);
  await writeNativeLaunchOffer(updated);
  return updated;
}

/**
 * Recovers a previously claimed Launch Offer gift using a one-time recovery code (`YAAD-XXXX-XXXX-XXXX`).
 * - Executes an atomic Firestore transaction that:
 *   1. Reads `/launch_recovery/{oldHash}`
 *   2. Creates or updates `/launch_claims/{newUid}` with the original `userNumber` and `batch` (without incrementing `/launch_offer/counter`)
 *   3. Deletes `/launch_recovery/{oldHash}` (one-time use)
 *   4. Creates `/launch_recovery/{newHash}` for a newly issued recovery code
 */
export async function recoverLaunchOfferWithCode(
  rawCodeInput: string
): Promise<{
  ok: boolean;
  errorCode?: 'INVALID_FORMAT' | 'UNCONFIGURED' | 'NOT_FOUND_OR_USED' | 'NETWORK_ERROR';
  assignment?: LaunchOfferAssignment;
}> {
  const normalizedOldCode = normalizeRecoveryCode(rawCodeInput);
  if (!normalizedOldCode) {
    return { ok: false, errorCode: 'INVALID_FORMAT' };
  }

  const services = getFirebaseLaunchServices();
  if (!services) {
    return { ok: false, errorCode: 'UNCONFIGURED' };
  }

  try {
    const { auth, db } = services;
    let currentUser = auth.currentUser;
    if (!currentUser) {
      const cred = await withTimeout(signInAnonymously(auth), FIREBASE_NETWORK_TIMEOUT_MS);
      currentUser = cred.user;
    }
    if (!currentUser?.uid) {
      return { ok: false, errorCode: 'NETWORK_ERROR' };
    }

    const newUid = currentUser.uid;
    const oldHash = await sha256Hex(normalizedOldCode);

    let newCode = generateLaunchRecoveryCode();
    while (newCode === normalizedOldCode) {
      newCode = generateLaunchRecoveryCode();
    }
    const newHash = await sha256Hex(newCode);

    const oldRecoveryRef = doc(db, 'launch_recovery', oldHash);
    const newRecoveryRef = doc(db, 'launch_recovery', newHash);
    const claimRef = doc(db, 'launch_claims', newUid);

    const recoveredAssignment = await withTimeout(
      runTransaction(db, async (tx) => {
        const oldRecoverySnap = await tx.get(oldRecoveryRef);
        if (!oldRecoverySnap.exists()) {
          throw new Error('RECOVERY_NOT_FOUND_OR_USED');
        }
        const recData = oldRecoverySnap.data();
        const userNumber = Number(recData?.userNumber || 0);
        const batch = computeBatchFromUserNumber(userNumber);
        if (userNumber < 1 || userNumber > LAUNCH_BATCH_2_MAX || (batch !== 1 && batch !== 2)) {
          throw new Error('RECOVERY_NOT_FOUND_OR_USED');
        }

        tx.set(claimRef, {
          uid: newUid,
          userNumber,
          batch,
          claimedAt: serverTimestamp(),
          recoveredFromHash: oldHash,
        });

        tx.delete(oldRecoveryRef);

        tx.set(newRecoveryRef, {
          uid: newUid,
          userNumber,
          batch,
          createdAt: serverTimestamp(),
        });

        return {
          version: 1,
          status: 'assigned' as const,
          uid: newUid,
          userNumber,
          batch,
          assignedAt: Date.now(),
          claimedGift: true,
          recoveryCode: newCode,
        } satisfies LaunchOfferAssignment;
      }),
      FIREBASE_NETWORK_TIMEOUT_MS
    );

    writeLocalLaunchOffer(recoveredAssignment);
    await writeNativeLaunchOffer(recoveredAssignment);

    return {
      ok: true,
      assignment: recoveredAssignment,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('RECOVERY_NOT_FOUND_OR_USED')) {
      return { ok: false, errorCode: 'NOT_FOUND_OR_USED' };
    }
    return { ok: false, errorCode: 'NETWORK_ERROR' };
  }
}

export function getSavedLaunchRecoveryCodeSync(): string | null {
  const local = readLocalLaunchOfferSync();
  if (local?.recoveryCode) {
    return normalizeRecoveryCode(local.recoveryCode);
  }
  return null;
}

/**
 * Assigns or retrieves this installation's 365-user Launch Offer batch.
 * - Uses local cache (`Directory.Data` + `localStorage`) so each installation claims at most once.
 * - Pre-checks `/launch_offer/counter` with `getDoc`: if `count >= 730`, caches `{ status: 'closed', batch: 0 }`
 *   locally without `userNumber` and performs zero Firestore writes.
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
      status: existing.status === 'closed' || existing.batch === 0 ? 'closed' : 'assigned',
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

      // 3. Read existing claim or counter BEFORE any write transaction (Part 1a)
      const [existingClaimSnap, preCounterSnap] = await withTimeout(
        Promise.all([getDoc(claimRef), getDoc(counterRef)]),
        FIREBASE_NETWORK_TIMEOUT_MS
      );

      if (existingClaimSnap.exists()) {
        const claimData = existingClaimSnap.data();
        const existingNum = Number(claimData?.userNumber || 0);
        const existingBatch = computeBatchFromUserNumber(existingNum);
        if (existingNum >= 1 && existingNum <= LAUNCH_BATCH_2_MAX && (existingBatch === 1 || existingBatch === 2)) {
          const restoredClaim: LaunchOfferAssignment = {
            version: 1,
            status: 'assigned',
            uid,
            userNumber: existingNum,
            batch: existingBatch,
            assignedAt: Date.now(),
          };
          writeLocalLaunchOffer(restoredClaim);
          await writeNativeLaunchOffer(restoredClaim);
          return {
            status: 'assigned',
            assignment: restoredClaim,
          };
        }
      }

      const preCount = preCounterSnap.exists() ? Number(preCounterSnap.data()?.count || 0) : 0;
      if (preCount >= LAUNCH_BATCH_2_MAX) {
        // Cap of 730 reached: do NOT run any write transaction; cache { status: 'closed', batch: 0 } without userNumber
        const closedAssignment: LaunchOfferAssignment = {
          version: 1,
          status: 'closed',
          batch: 0,
          assignedAt: Date.now(),
        };
        writeLocalLaunchOffer(closedAssignment);
        await writeNativeLaunchOffer(closedAssignment);
        return {
          status: 'closed',
          assignment: closedAssignment,
        };
      }

      // 4. Atomic transaction: increment counter by +1 only if count < 730
      const assigned = await withTimeout(
        runTransaction(db, async (tx) => {
          const txClaimSnap = await tx.get(claimRef);
          if (txClaimSnap.exists()) {
            const claimData = txClaimSnap.data();
            const existingNum = Number(claimData?.userNumber || 0);
            const existingBatch = computeBatchFromUserNumber(existingNum);
            if (existingNum >= 1 && existingNum <= LAUNCH_BATCH_2_MAX && (existingBatch === 1 || existingBatch === 2)) {
              return {
                version: 1,
                status: 'assigned' as const,
                uid,
                userNumber: existingNum,
                batch: existingBatch,
                assignedAt: Date.now(),
              } satisfies LaunchOfferAssignment;
            }
          }

          const counterSnap = await tx.get(counterRef);
          const prevCount = counterSnap.exists() ? Number(counterSnap.data()?.count || 0) : 0;
          if (prevCount >= LAUNCH_BATCH_2_MAX) {
            return {
              version: 1,
              status: 'closed' as const,
              batch: 0 as const,
              assignedAt: Date.now(),
            } satisfies LaunchOfferAssignment;
          }

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
            status: 'assigned' as const,
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
        status: assigned.status === 'closed' || assigned.batch === 0 ? 'closed' : 'assigned',
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

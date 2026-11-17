import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import {
  getAllKnownProSkus,
  getStoreTarget,
  isBillingConfigured,
  PRO_ONE_YEAR_DURATION_MS,
  PRO_SKU_IDS,
  ProPlanId,
  resolvePlanFromSku,
  StoreTarget,
} from '../config/billingConfig';
import {
  getBillingProvider,
  isPurchaseStateValid,
  PurchaseResult,
  SkuPriceDetail,
  StorePurchaseRecord,
} from './billingProvider';
import { toPersianDigits } from './jalali';
import {
  LaunchOfferAssignment,
  LaunchOfferStatus,
  markLaunchOfferGiftClaimed,
  readLocalLaunchOfferSync,
  recoverLaunchOfferWithCode,
  syncLaunchOfferAssignment,
} from './launchOffer';
import {
  DAY_MS,
  getFastTrialStatusSync,
  initAndReconcileTrialState,
  scheduleTrialMilestoneNotifications,
  TrialStatus,
} from './trialManager';

export type ProFeatureId =
  | 'occasions'
  | 'locations'
  | 'geofence'
  | 'sketch'
  | 'photo'
  | 'themes';

export type ProAccessReason =
  | 'paid_lifetime'
  | 'paid_1y'
  | 'trial_active'
  | 'free_expired';

export interface CachedProEntitlement {
  version: number;
  store: StoreTarget;
  planId: ProPlanId;
  productId: string;
  orderId: string;
  purchaseToken: string;
  purchaseTime: number;
  expiresAt: number | null; // null = lifetime
  purchaseState: string;
  verifiedAt: number;
  lastVerifiedAt?: number;
  consecutiveEmptyChecks?: number;
  firstEmptyCheckAt?: number | null;
  isLaunchOfferGrant?: boolean;
  launchBatch?: 1 | 2;
  launchUserNumber?: number;
}

export interface ProEntitlementState {
  entitlementReady: boolean;
  hasProAccess: boolean;
  hasPaidPro: boolean;
  reason: ProAccessReason;
  store: StoreTarget;
  billingConfigured: boolean;
  trial: TrialStatus;
  activePurchase: CachedProEntitlement | null;
  paidRemainingDays: number | null;
  lastSyncedAt: number | null;
  launchOffer: LaunchOfferAssignment | null;
  launchOfferStatus: LaunchOfferStatus;
}

const ENTITLEMENT_STORAGE_KEY = 'yaad_pro_entitlement_v1';
const ENTITLEMENT_DATA_FILE_PATH = 'YAAD/yaad_pro_entitlement_v1.json';
const EMPTY_REVOCATION_MIN_CHECKS = 3;
const EMPTY_REVOCATION_GRACE_MS = 72 * 60 * 60 * 1000; // 72 hours

const isNative = (): boolean => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

function formatExpirationDateForUser(timestampMs: number, isFa: boolean): string {
  try {
    const d = new Date(timestampMs);
    if (isFa) {
      return new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }).format(d);
    }
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(d);
  } catch {
    const iso = new Date(timestampMs).toISOString().slice(0, 10);
    return isFa ? toPersianDigits(iso) : iso;
  }
}

function isValidCachedEntitlement(raw: any): raw is CachedProEntitlement {
  return Boolean(
    raw &&
      typeof raw === 'object' &&
      typeof raw.productId === 'string' &&
      raw.productId.length > 0 &&
      (raw.planId === '1y' || raw.planId === 'lifetime') &&
      typeof raw.purchaseTime === 'number' &&
      Number.isFinite(raw.purchaseTime) &&
      isPurchaseStateValid(raw.purchaseState)
  );
}

function readLocalEntitlement(): CachedProEntitlement | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(ENTITLEMENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isValidCachedEntitlement(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeLocalEntitlement(ent: CachedProEntitlement | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (!ent) {
      localStorage.removeItem(ENTITLEMENT_STORAGE_KEY);
    } else {
      localStorage.setItem(ENTITLEMENT_STORAGE_KEY, JSON.stringify(ent));
    }
  } catch {
    // ignore
  }
}

async function readNativeEntitlement(): Promise<CachedProEntitlement | null> {
  if (!isNative()) return null;
  try {
    const res = await Filesystem.readFile({
      path: ENTITLEMENT_DATA_FILE_PATH,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    });
    if (!res?.data) return null;
    const parsed = JSON.parse(typeof res.data === 'string' ? res.data : String(res.data));
    return isValidCachedEntitlement(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function writeNativeEntitlement(ent: CachedProEntitlement | null): Promise<void> {
  if (!isNative()) return;
  try {
    if (!ent) {
      await Filesystem.deleteFile({
        path: ENTITLEMENT_DATA_FILE_PATH,
        directory: Directory.Data,
      }).catch(() => {});
      return;
    }
    await Filesystem.mkdir({
      path: 'YAAD',
      directory: Directory.Data,
      recursive: true,
    }).catch(() => {});
    await Filesystem.writeFile({
      path: ENTITLEMENT_DATA_FILE_PATH,
      data: JSON.stringify(ent),
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    });
  } catch {
    // ignore
  }
}

export function convertPurchaseRecordToEntitlement(
  record: StorePurchaseRecord,
  store: StoreTarget,
  now: number = Date.now()
): CachedProEntitlement | null {
  if (!isPurchaseStateValid(record.purchaseState)) return null;
  const plan = resolvePlanFromSku(record.productId);
  const planId: ProPlanId = plan?.id || (record.productId.includes('1y') ? '1y' : 'lifetime');
  const expiresAt = planId === '1y' ? record.purchaseTime + PRO_ONE_YEAR_DURATION_MS : null;

  return {
    version: 1,
    store,
    planId,
    productId: record.productId,
    orderId: record.orderId || '',
    purchaseToken: record.purchaseToken || '',
    purchaseTime: record.purchaseTime,
    expiresAt,
    purchaseState: 'PURCHASED',
    verifiedAt: now,
    lastVerifiedAt: now,
    consecutiveEmptyChecks: 0,
    firstEmptyCheckAt: null,
  };
}

function buildLaunchOfferEntitlement(
  assignment: LaunchOfferAssignment,
  store: StoreTarget
): CachedProEntitlement | null {
  if (assignment.batch !== 1 && assignment.batch !== 2 || !assignment.userNumber) return null;
  const isLifetime = assignment.batch === 1;
  const planId: ProPlanId = isLifetime ? 'lifetime' : '1y';
  const productId = isLifetime
    ? PRO_SKU_IDS.LIFETIME_BATCH_1
    : PRO_SKU_IDS.ONE_YEAR_BATCH_2;
  const purchaseTime = assignment.assignedAt || Date.now();
  const expiresAt = isLifetime ? null : purchaseTime + PRO_ONE_YEAR_DURATION_MS;
  const now = Date.now();

  return {
    version: 1,
    store,
    planId,
    productId,
    orderId: `LAUNCH_BATCH_${assignment.batch}_USER_${assignment.userNumber}`,
    purchaseToken: `FIREBASE_UID_${assignment.uid || 'ANONYMOUS'}`,
    purchaseTime,
    expiresAt,
    purchaseState: 'PURCHASED',
    verifiedAt: now,
    lastVerifiedAt: now,
    consecutiveEmptyChecks: 0,
    firstEmptyCheckAt: null,
    isLaunchOfferGrant: true,
    launchBatch: assignment.batch,
    launchUserNumber: assignment.userNumber,
  };
}

function isEntitlementCurrentlyValid(ent: CachedProEntitlement | null, effectiveNow: number): boolean {
  if (!ent) return false;
  if (!isPurchaseStateValid(ent.purchaseState)) return false;
  if (ent.planId === 'lifetime' || ent.expiresAt === null) return true;
  return effectiveNow < ent.expiresAt;
}

function pickBestValidEntitlement(
  records: CachedProEntitlement[],
  effectiveNow: number
): CachedProEntitlement | null {
  const valid = records.filter((r) => isEntitlementCurrentlyValid(r, effectiveNow));
  if (valid.length === 0) return null;
  const lifetime = valid.find((v) => v.planId === 'lifetime');
  if (lifetime) return lifetime;
  // Otherwise pick the 1-year purchase with the latest expiration
  return [...valid].sort((a, b) => (b.expiresAt || 0) - (a.expiresAt || 0))[0];
}

export function buildEntitlementState(
  trial: TrialStatus,
  cached: CachedProEntitlement | null,
  lastSyncedAt: number | null = null,
  launchOffer: LaunchOfferAssignment | null = null,
  launchOfferStatus: LaunchOfferStatus = 'pending_network',
  entitlementReady: boolean = true
): ProEntitlementState {
  const store = getStoreTarget();
  const billingConfigured = isBillingConfigured(store);
  const effectiveNow = trial.effectiveNow;
  const validPaid = isEntitlementCurrentlyValid(cached, effectiveNow) ? cached : null;

  if (validPaid) {
    const paidRemainingDays =
      validPaid.planId === '1y' && validPaid.expiresAt
        ? Math.max(0, Math.ceil((validPaid.expiresAt - effectiveNow) / DAY_MS))
        : null;
    return {
      entitlementReady,
      hasProAccess: true,
      hasPaidPro: true,
      reason: validPaid.planId === 'lifetime' ? 'paid_lifetime' : 'paid_1y',
      store,
      billingConfigured,
      trial,
      activePurchase: validPaid,
      paidRemainingDays,
      lastSyncedAt,
      launchOffer,
      launchOfferStatus,
    };
  }

  return {
    entitlementReady,
    hasProAccess: trial.isTrialActive,
    hasPaidPro: false,
    reason: trial.isTrialActive ? 'trial_active' : 'free_expired',
    store,
    billingConfigured,
    trial,
    activePurchase: null,
    paidRemainingDays: null,
    lastSyncedAt,
    launchOffer,
    launchOfferStatus,
  };
}

/**
 * Synchronous fast snapshot at React mount so initial render never flashes locked state incorrectly.
 * Note: `entitlementReady` is false until the first async `reconcileProEntitlement` finishes (or times out).
 */
export function getFastProEntitlementSync(): ProEntitlementState {
  const trial = getFastTrialStatusSync();
  const cached = readLocalEntitlement();
  const localOffer = readLocalLaunchOfferSync();
  return buildEntitlementState(
    trial,
    cached,
    null,
    localOffer,
    localOffer
      ? localOffer.status === 'closed' || localOffer.batch === 0
        ? 'closed'
        : 'assigned'
      : 'pending_network',
    false
  );
}

/**
 * Reconciles trial timer, local & native entitlement caches, 365-user Launch Offer batch,
 * and live store purchases on startup/resume.
 * - Offline / store unreachable: keeps cached verified entitlement.
 * - Consumes expired 1-year (`yaad_pro_1y`) purchases ONLY after 365 days so the user can renew.
 * - Protects paid buyers against transient empty store responses: only revokes if the store
 *   explicitly reports REFUNDED/CANCELED OR after >= 3 consecutive empty checks spanning >= 72 hours.
 * - Schedules Day 30 / 37 / 40 notifications if not yet paid.
 */
export async function reconcileProEntitlement(
  options: {
    extraSkus?: string[];
    language?: 'fa' | 'en';
    skipStoreQuery?: boolean;
  } = {}
): Promise<ProEntitlementState> {
  const [trial, launchRes] = await Promise.all([
    initAndReconcileTrialState(),
    syncLaunchOfferAssignment(),
  ]);
  const store = getStoreTarget();
  const provider = getBillingProvider(store);

  const localCached = readLocalEntitlement();
  const nativeCached = await readNativeEntitlement();
  const preQueryCandidates = [localCached, nativeCached].filter(
    (c): c is CachedProEntitlement => Boolean(c)
  );
  if (launchRes.assignment?.claimedGift) {
    const giftEnt = buildLaunchOfferEntitlement(launchRes.assignment, store);
    if (giftEnt) preQueryCandidates.push(giftEnt);
  }
  let activeCached = pickBestValidEntitlement(preQueryCandidates, trial.effectiveNow);
  let syncedAt: number | null = null;

  if (!options.skipStoreQuery && provider.isAvailable()) {
    const skus = getAllKnownProSkus(options.extraSkus);
    const queryRes = await provider.queryPurchases(skus);
    if (!queryRes.offlineOrUnavailable) {
      syncedAt = Date.now();
      const converted = queryRes.purchases
        .map((p) => convertPurchaseRecordToEntitlement(p, store, syncedAt || Date.now()))
        .filter((e): e is CachedProEntitlement => Boolean(e));

      // Part 2: Auto-consume any expired 1-year purchase (after 365 days) so user can renew cleanly
      for (const ent of converted) {
        if (
          ent.planId === '1y' &&
          ent.productId === PRO_SKU_IDS.ONE_YEAR &&
          ent.expiresAt !== null &&
          trial.effectiveNow >= ent.expiresAt
        ) {
          void provider.consumePurchase(ent.purchaseToken, ent.productId).catch(() => {});
        }
      }

      const storeWinner = pickBestValidEntitlement(converted, trial.effectiveNow);

      if (storeWinner) {
        activeCached = {
          ...storeWinner,
          lastVerifiedAt: syncedAt,
          consecutiveEmptyChecks: 0,
          firstEmptyCheckAt: null,
        };
        writeLocalEntitlement(activeCached);
        await writeNativeEntitlement(activeCached);
      } else if (
        activeCached?.isLaunchOfferGrant &&
        isEntitlementCurrentlyValid(activeCached, trial.effectiveNow)
      ) {
        // Preserve verified 100%-free Launch Offer batch grant
        writeLocalEntitlement(activeCached);
        await writeNativeEntitlement(activeCached);
      } else if (activeCached && isEntitlementCurrentlyValid(activeCached, trial.effectiveNow)) {
        // Part 3: Store returned no active purchases for a cached paid buyer.
        // Check if store explicitly reported REFUNDED / CANCELED for this SKU:
        const explicitlyRevoked = Boolean(
          queryRes.revokedProductIds?.includes(activeCached.productId)
        );
        if (explicitlyRevoked) {
          activeCached = null;
          writeLocalEntitlement(null);
          await writeNativeEntitlement(null);
        } else {
          const nextEmptyCount = (activeCached.consecutiveEmptyChecks || 0) + 1;
          const firstEmptyAt = activeCached.firstEmptyCheckAt || syncedAt;
          const elapsedEmptyMs = syncedAt - firstEmptyAt;

          if (
            nextEmptyCount >= EMPTY_REVOCATION_MIN_CHECKS &&
            elapsedEmptyMs >= EMPTY_REVOCATION_GRACE_MS
          ) {
            activeCached = null;
            writeLocalEntitlement(null);
            await writeNativeEntitlement(null);
          } else {
            activeCached = {
              ...activeCached,
              consecutiveEmptyChecks: nextEmptyCount,
              firstEmptyCheckAt: firstEmptyAt,
            };
            writeLocalEntitlement(activeCached);
            await writeNativeEntitlement(activeCached);
          }
        }
      } else {
        activeCached = null;
        writeLocalEntitlement(null);
        await writeNativeEntitlement(null);
      }
    } else if (activeCached) {
      // Offline / store unavailable fallback: keep cached entitlement untouched
      writeLocalEntitlement(activeCached);
      await writeNativeEntitlement(activeCached);
    }
  } else if (activeCached) {
    writeLocalEntitlement(activeCached);
    await writeNativeEntitlement(activeCached);
  }

  const finalState = buildEntitlementState(
    trial,
    activeCached,
    syncedAt,
    launchRes.assignment,
    launchRes.status,
    true
  );
  await scheduleTrialMilestoneNotifications(
    finalState.trial,
    finalState.hasPaidPro,
    options.language || 'fa'
  );
  return finalState;
}

/**
 * Claims the 100%-free Launch Offer gift when the installation belongs to Batch 1 (users 1..365 -> Lifetime)
 * or Batch 2 (users 366..730 -> 1-Year) and registers a one-time SHA-256 recovery code.
 */
export async function activateLaunchOfferGift(
  language: 'fa' | 'en' = 'fa'
): Promise<{
  activated: boolean;
  recoveryCode?: string;
  errorMessage?: string;
  state: ProEntitlementState;
}> {
  const launchRes = await syncLaunchOfferAssignment();
  const assignment = launchRes.assignment;
  if (!assignment || (assignment.batch !== 1 && assignment.batch !== 2) || !assignment.userNumber) {
    const state = await reconcileProEntitlement({ language, skipStoreQuery: true });
    return {
      activated: false,
      errorMessage:
        language === 'fa'
          ? 'ظرفیت هدیه ۱۰۰٪ رایگان دسته‌های ۳۶۵ نفری تکمیل شده یا ارتباط با سرور برقرار نشد.'
          : 'The 365-user free launch batch is not available for this installation.',
      state,
    };
  }

  const claimedAssignment = (await markLaunchOfferGiftClaimed()) || {
    ...assignment,
    claimedGift: true,
  };
  const store = getStoreTarget();
  const giftEnt = buildLaunchOfferEntitlement(claimedAssignment, store);
  if (giftEnt) {
    writeLocalEntitlement(giftEnt);
    await writeNativeEntitlement(giftEnt);
  }

  const state = await reconcileProEntitlement({ language, skipStoreQuery: true });
  return {
    activated: Boolean(giftEnt && state.hasPaidPro),
    recoveryCode: claimedAssignment.recoveryCode,
    state,
  };
}

/**
 * Recovers a previously claimed Launch Offer gift using a one-time recovery code (`YAAD-XXXX-XXXX-XXXX`).
 */
export async function recoverLaunchOfferGiftByCode(
  rawCode: string,
  language: 'fa' | 'en' = 'fa'
): Promise<{
  recovered: boolean;
  recoveryCode?: string;
  errorMessage?: string;
  state: ProEntitlementState;
}> {
  const isFa = language === 'fa';
  const res = await recoverLaunchOfferWithCode(rawCode);
  if (!res.ok || !res.assignment) {
    const state = await reconcileProEntitlement({ language, skipStoreQuery: true });
    let errorMessage = isFa
      ? 'بازیابی هدیه انجام نشد. اتصال اینترنت را بررسی کنید.'
      : 'Could not recover gift. Please check your connection.';
    if (res.errorCode === 'INVALID_FORMAT') {
      errorMessage = isFa
        ? 'فرمت کد بازیابی نامعتبر است. کد باید به صورت YAAD-XXXX-XXXX-XXXX باشد.'
        : 'Invalid recovery code format (expected YAAD-XXXX-XXXX-XXXX).';
    } else if (res.errorCode === 'NOT_FOUND_OR_USED') {
      errorMessage = isFa
        ? 'این کد بازیابی نامعتبر است یا قبلاً یک بار استفاده شده است.'
        : 'This recovery code is invalid or has already been used.';
    }
    return {
      recovered: false,
      errorMessage,
      state,
    };
  }

  const store = getStoreTarget();
  const giftEnt = buildLaunchOfferEntitlement(res.assignment, store);
  if (giftEnt) {
    writeLocalEntitlement(giftEnt);
    await writeNativeEntitlement(giftEnt);
  }

  const state = await reconcileProEntitlement({ language, skipStoreQuery: true });
  return {
    recovered: Boolean(giftEnt && state.hasPaidPro),
    recoveryCode: res.assignment.recoveryCode,
    state,
  };
}

/**
 * Initiates purchase of a specific SKU via active store SDK and persists entitlement upon success.
 * Handles 1-Year (`yaad_pro_1y`) consumable renewal:
 * - Never consumes an active 1-year purchase before 365 days.
 * - If `alreadyOwned` is returned for `yaad_pro_1y`, checks if >= 365 days have elapsed:
 *   - If expired: consumes the old token first and retries `purchaseProduct` once.
 *   - If still active: keeps the active entitlement and returns a clear message with the expiration date.
 */
export async function purchaseProSku(
  sku: string,
  extraSkus: string[] = [],
  language: 'fa' | 'en' = 'fa'
): Promise<{ result: PurchaseResult; state: ProEntitlementState }> {
  const isFa = language === 'fa';
  const store = getStoreTarget();
  const provider = getBillingProvider(store);
  const trial = await initAndReconcileTrialState();
  const effectiveNow = trial.effectiveNow;

  // Check if user already has an active, non-expired 1-year store subscription locally
  const existingLocal = readLocalEntitlement() || (await readNativeEntitlement());
  if (
    sku === PRO_SKU_IDS.ONE_YEAR &&
    existingLocal &&
    !existingLocal.isLaunchOfferGrant &&
    existingLocal.planId === '1y' &&
    existingLocal.expiresAt !== null &&
    effectiveNow < existingLocal.expiresAt
  ) {
    const expStr = formatExpirationDateForUser(existingLocal.expiresAt, isFa);
    const state = await reconcileProEntitlement({
      extraSkus: [sku, ...extraSkus],
      language,
      skipStoreQuery: true,
    });
    return {
      result: {
        success: true,
        alreadyOwned: true,
        errorMessage: isFa
          ? `اشتراک شما تا تاریخ ${expStr} فعال است؛ بعد از پایان می‌توانید تمدید کنید.`
          : `Your subscription is active until ${expStr}; you can renew after it expires.`,
      },
      state,
    };
  }

  const payload = `yaad_${store}_${sku}_${Date.now()}`;
  let result = await provider.purchaseProduct(sku, payload);

  // Part 2: Handle `alreadyOwned` on 1-year consumable SKU (`yaad_pro_1y`)
  if (result.alreadyOwned && sku === PRO_SKU_IDS.ONE_YEAR) {
    let ownedRecord: StorePurchaseRecord | undefined = result.purchase;
    if (!ownedRecord) {
      const check = await provider.queryPurchases([sku]);
      ownedRecord = check.purchases.find((p) => p.productId === sku);
    }

    const purchaseTime = ownedRecord?.purchaseTime || existingLocal?.purchaseTime || 0;
    const expiresAt = purchaseTime > 0 ? purchaseTime + PRO_ONE_YEAR_DURATION_MS : 0;

    if (expiresAt > 0 && effectiveNow < expiresAt) {
      // Still active (< 365 days) -> NEVER consume; sync entitlement and tell user the exact expiry date
      if (ownedRecord) {
        const ent = convertPurchaseRecordToEntitlement(ownedRecord, store, Date.now());
        if (ent) {
          writeLocalEntitlement(ent);
          await writeNativeEntitlement(ent);
        }
      }
      const expStr = formatExpirationDateForUser(expiresAt, isFa);
      const state = await reconcileProEntitlement({
        extraSkus: [sku, ...extraSkus],
        language,
        skipStoreQuery: true,
      });
      return {
        result: {
          ...result,
          success: true,
          alreadyOwned: true,
          errorMessage: isFa
            ? `اشتراک شما تا تاریخ ${expStr} فعال است؛ بعد از پایان می‌توانید تمدید کنید.`
            : `Your subscription is active until ${expStr}; you can renew after it expires.`,
        },
        state,
      };
    }

    // Expired (>= 365 days) -> consume old token in store and retry purchaseProduct once
    const tokenToConsume = ownedRecord?.purchaseToken || existingLocal?.purchaseToken || '';
    const consumeRes = await provider.consumePurchase(tokenToConsume, sku);
    if (consumeRes.consumed) {
      writeLocalEntitlement(null);
      await writeNativeEntitlement(null);
      const retryPayload = `yaad_${store}_${sku}_renew_${Date.now()}`;
      result = await provider.purchaseProduct(sku, retryPayload);
    }
  }

  if (result.success && result.purchase) {
    const ent = convertPurchaseRecordToEntitlement(result.purchase, store, Date.now());
    if (ent) {
      writeLocalEntitlement(ent);
      await writeNativeEntitlement(ent);
    }
  }

  const state = await reconcileProEntitlement({
    extraSkus: [sku, ...extraSkus],
    language,
    skipStoreQuery: true,
  });
  return { result, state };
}

export async function restoreProPurchases(
  extraSkus: string[] = [],
  language: 'fa' | 'en' = 'fa'
): Promise<{
  restored: boolean;
  offlineOrUnavailable: boolean;
  errorMessage?: string;
  state: ProEntitlementState;
}> {
  const store = getStoreTarget();
  const provider = getBillingProvider(store);
  if (!provider.isAvailable()) {
    const state = await reconcileProEntitlement({ extraSkus, language, skipStoreQuery: true });
    return {
      restored: state.hasPaidPro,
      offlineOrUnavailable: true,
      errorMessage:
        language === 'fa'
          ? 'فروشگاه پرداخت در این نسخه فعال نیست.'
          : 'Billing store is not configured in this build.',
      state,
    };
  }

  const skus = getAllKnownProSkus(extraSkus);
  const [queryRes, trial, launchRes] = await Promise.all([
    provider.queryPurchases(skus),
    initAndReconcileTrialState(),
    syncLaunchOfferAssignment(),
  ]);

  if (queryRes.offlineOrUnavailable) {
    const state = await reconcileProEntitlement({ extraSkus, language, skipStoreQuery: true });
    return {
      restored: state.hasPaidPro,
      offlineOrUnavailable: true,
      errorMessage: queryRes.errorMessage,
      state,
    };
  }

  const now = Date.now();
  const converted = queryRes.purchases
    .map((p) => convertPurchaseRecordToEntitlement(p, store, now))
    .filter((e): e is CachedProEntitlement => Boolean(e));

  // Auto-consume expired 1-year purchase during restore so user can re-purchase
  for (const ent of converted) {
    if (
      ent.planId === '1y' &&
      ent.productId === PRO_SKU_IDS.ONE_YEAR &&
      ent.expiresAt !== null &&
      trial.effectiveNow >= ent.expiresAt
    ) {
      void provider.consumePurchase(ent.purchaseToken, ent.productId).catch(() => {});
    }
  }

  if (launchRes.assignment?.claimedGift) {
    const giftEnt = buildLaunchOfferEntitlement(launchRes.assignment, store);
    if (giftEnt) converted.push(giftEnt);
  }
  let winner = pickBestValidEntitlement(converted, trial.effectiveNow);

  if (winner) {
    writeLocalEntitlement(winner);
    await writeNativeEntitlement(winner);
  } else {
    // Preserve existing valid entitlement unless explicitly revoked or past 3-check / 72h threshold
    const existing = readLocalEntitlement() || (await readNativeEntitlement());
    if (
      existing &&
      isEntitlementCurrentlyValid(existing, trial.effectiveNow) &&
      !queryRes.revokedProductIds?.includes(existing.productId)
    ) {
      const nextEmptyCount = (existing.consecutiveEmptyChecks || 0) + 1;
      const firstEmptyAt = existing.firstEmptyCheckAt || now;
      if (
        nextEmptyCount < EMPTY_REVOCATION_MIN_CHECKS ||
        now - firstEmptyAt < EMPTY_REVOCATION_GRACE_MS
      ) {
        winner = {
          ...existing,
          consecutiveEmptyChecks: nextEmptyCount,
          firstEmptyCheckAt: firstEmptyAt,
        };
        writeLocalEntitlement(winner);
        await writeNativeEntitlement(winner);
      } else {
        writeLocalEntitlement(null);
        await writeNativeEntitlement(null);
      }
    } else {
      writeLocalEntitlement(null);
      await writeNativeEntitlement(null);
    }
  }

  const state = buildEntitlementState(
    trial,
    winner,
    now,
    launchRes.assignment,
    launchRes.status,
    true
  );
  await scheduleTrialMilestoneNotifications(state.trial, state.hasPaidPro, language);

  return {
    restored: Boolean(winner),
    offlineOrUnavailable: false,
    state,
  };
}

export async function fetchStoreSkuPrices(extraSkus: string[] = []): Promise<SkuPriceDetail[]> {
  const provider = getBillingProvider();
  if (!provider.isAvailable()) return [];
  return provider.querySkuDetails(getAllKnownProSkus(extraSkus));
}

export function getProFeatureLabel(feature: ProFeatureId, isFa: boolean): string {
  switch (feature) {
    case 'occasions':
      return isFa ? 'ساخت و ویرایش مناسبت‌ها' : 'Create & Edit Occasions';
    case 'locations':
      return isFa ? 'ثبت و ویرایش مکان‌های GPS' : 'Save & Edit GPS Locations';
    case 'geofence':
      return isFa ? 'حصار مکانی و رادار هوشمند' : 'Geofences & Smart Radar';
    case 'sketch':
      return isFa ? 'ایده با نقاشی و دست‌خط' : 'Handwritten & Sketch Ideas';
    case 'photo':
      return isFa ? 'پیوست عکس به یادآور، مکان و ایده' : 'Photo Attachments';
    case 'themes':
      return isFa ? 'تم‌های اختصاصی و ظاهرهای پیشرفته' : 'Premium Themes';
  }
}

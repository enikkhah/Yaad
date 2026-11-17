import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import {
  getAllKnownProSkus,
  getStoreTarget,
  isBillingConfigured,
  PRO_ONE_YEAR_DURATION_MS,
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
  | 'backup'
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
}

export interface ProEntitlementState {
  hasProAccess: boolean;
  hasPaidPro: boolean;
  reason: ProAccessReason;
  store: StoreTarget;
  billingConfigured: boolean;
  trial: TrialStatus;
  activePurchase: CachedProEntitlement | null;
  paidRemainingDays: number | null;
  lastSyncedAt: number | null;
}

const ENTITLEMENT_STORAGE_KEY = 'yaad_pro_entitlement_v1';
const ENTITLEMENT_DATA_FILE_PATH = 'YAAD/yaad_pro_entitlement_v1.json';

const isNative = (): boolean => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

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
  lastSyncedAt: number | null = null
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
      hasProAccess: true,
      hasPaidPro: true,
      reason: validPaid.planId === 'lifetime' ? 'paid_lifetime' : 'paid_1y',
      store,
      billingConfigured,
      trial,
      activePurchase: validPaid,
      paidRemainingDays,
      lastSyncedAt,
    };
  }

  return {
    hasProAccess: trial.isTrialActive,
    hasPaidPro: false,
    reason: trial.isTrialActive ? 'trial_active' : 'free_expired',
    store,
    billingConfigured,
    trial,
    activePurchase: null,
    paidRemainingDays: null,
    lastSyncedAt,
  };
}

/**
 * Synchronous fast snapshot at React mount so initial render never flashes locked state incorrectly.
 */
export function getFastProEntitlementSync(): ProEntitlementState {
  const trial = getFastTrialStatusSync();
  const cached = readLocalEntitlement();
  return buildEntitlementState(trial, cached, null);
}

/**
 * Reconciles trial timer, local & native entitlement caches, and live store purchases on startup/resume.
 * - Offline / store unreachable: keeps cached verified entitlement.
 * - Online & store responds cleanly without any valid purchase: clears revoked/refunded cache.
 * - Schedules Day 30 / 37 / 40 notifications if not yet paid.
 */
export async function reconcileProEntitlement(
  options: {
    extraSkus?: string[];
    language?: 'fa' | 'en';
    skipStoreQuery?: boolean;
  } = {}
): Promise<ProEntitlementState> {
  const trial = await initAndReconcileTrialState();
  const store = getStoreTarget();
  const provider = getBillingProvider(store);

  const localCached = readLocalEntitlement();
  const nativeCached = await readNativeEntitlement();
  const preQueryCandidates = [localCached, nativeCached].filter(
    (c): c is CachedProEntitlement => Boolean(c)
  );
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
      const storeWinner = pickBestValidEntitlement(converted, trial.effectiveNow);

      if (storeWinner) {
        activeCached = storeWinner;
        writeLocalEntitlement(storeWinner);
        await writeNativeEntitlement(storeWinner);
      } else {
        // Store explicitly returned an empty/refunded purchase list -> revoke cached paid entitlement
        activeCached = null;
        writeLocalEntitlement(null);
        await writeNativeEntitlement(null);
      }
    } else if (activeCached) {
      // Offline fallback: ensure both storage layers stay synced
      writeLocalEntitlement(activeCached);
      await writeNativeEntitlement(activeCached);
    }
  } else if (activeCached) {
    writeLocalEntitlement(activeCached);
    await writeNativeEntitlement(activeCached);
  }

  const finalState = buildEntitlementState(trial, activeCached, syncedAt);
  await scheduleTrialMilestoneNotifications(
    finalState.trial,
    finalState.hasPaidPro,
    options.language || 'fa'
  );
  return finalState;
}

/**
 * Initiates purchase of a specific SKU via active store SDK and persists entitlement upon success.
 */
export async function purchaseProSku(
  sku: string,
  extraSkus: string[] = [],
  language: 'fa' | 'en' = 'fa'
): Promise<{ result: PurchaseResult; state: ProEntitlementState }> {
  const store = getStoreTarget();
  const provider = getBillingProvider(store);
  const payload = `yaad_${store}_${sku}_${Date.now()}`;
  const result = await provider.purchaseProduct(sku, payload);

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
  const queryRes = await provider.queryPurchases(skus);
  const trial = await initAndReconcileTrialState();

  if (queryRes.offlineOrUnavailable) {
    const state = await reconcileProEntitlement({ extraSkus, language, skipStoreQuery: true });
    return {
      restored: state.hasPaidPro,
      offlineOrUnavailable: true,
      errorMessage: queryRes.errorMessage,
      state,
    };
  }

  const converted = queryRes.purchases
    .map((p) => convertPurchaseRecordToEntitlement(p, store, Date.now()))
    .filter((e): e is CachedProEntitlement => Boolean(e));
  const winner = pickBestValidEntitlement(converted, trial.effectiveNow);

  if (winner) {
    writeLocalEntitlement(winner);
    await writeNativeEntitlement(winner);
  } else {
    writeLocalEntitlement(null);
    await writeNativeEntitlement(null);
  }

  const state = buildEntitlementState(trial, winner, Date.now());
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
    case 'backup':
      return isFa ? 'خروجی و وارد کردن فایل پشتیبان (JSON)' : 'JSON Backup Export & Import';
    case 'themes':
      return isFa ? 'تم‌های اختصاصی و ظاهرهای پیشرفته' : 'Premium Themes';
  }
}

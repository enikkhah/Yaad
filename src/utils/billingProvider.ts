import { Capacitor, registerPlugin } from '@capacitor/core';
import {
  getActiveStoreRsaPublicKey,
  getStoreTarget,
  isBillingConfigured,
  StoreTarget,
} from '../config/billingConfig';

export interface SkuPriceDetail {
  sku: string;
  title?: string;
  price?: string;
  description?: string;
}

export interface StorePurchaseRecord {
  productId: string;
  orderId: string;
  purchaseToken: string;
  payload: string;
  packageName: string;
  purchaseTime: number;
  purchaseState: 'PURCHASED' | 'REFUNDED' | 'CANCELED' | 'UNSPECIFIED';
  dataSignature: string;
}

export interface PurchaseResult {
  success: boolean;
  cancelled?: boolean;
  alreadyOwned?: boolean;
  offlineOrUnavailable?: boolean;
  errorCode?: string;
  errorMessage?: string;
  purchase?: StorePurchaseRecord;
}

export interface QueryPurchasesResult {
  offlineOrUnavailable: boolean;
  errorMessage?: string;
  purchases: StorePurchaseRecord[];
  revokedProductIds?: string[];
}

export interface ConsumePurchaseResult {
  consumed: boolean;
  errorMessage?: string;
}

export interface BillingProvider {
  readonly store: StoreTarget;
  isAvailable(): boolean;
  querySkuDetails(skus: string[]): Promise<SkuPriceDetail[]>;
  purchaseProduct(sku: string, payload?: string): Promise<PurchaseResult>;
  queryPurchases(skus: string[]): Promise<QueryPurchasesResult>;
  consumePurchase(purchaseToken: string, productId?: string): Promise<ConsumePurchaseResult>;
  disconnect(): Promise<void>;
}

interface NativeBillingPluginBridge {
  querySkuDetails(options: {
    productIds: string[];
    rsaPublicKey: string;
  }): Promise<{ skuDetails?: SkuPriceDetail[] }>;
  purchasePro(options: {
    productId: string;
    rsaPublicKey: string;
    payload?: string;
  }): Promise<any>;
  checkProOwnership(options: {
    productId?: string;
    productIds?: string[];
    rsaPublicKey: string;
  }): Promise<{
    isProOwned?: boolean;
    status?: string;
    purchases?: any[];
    revokedProductIds?: string[];
    productId?: string;
    orderId?: string;
    purchaseToken?: string;
    payload?: string;
    packageName?: string;
    purchaseTime?: number;
    purchaseState?: string;
    dataSignature?: string;
  }>;
  consumePurchase(options: {
    purchaseToken: string;
    productId?: string;
    rsaPublicKey: string;
  }): Promise<{
    consumed?: boolean;
    alreadyConsumed?: boolean;
    purchaseToken?: string;
    productId?: string;
  }>;
  disconnect(): Promise<void>;
}

const BazaarBillingNative = registerPlugin<NativeBillingPluginBridge>('BazaarBilling');
const MyketBillingNative = registerPlugin<NativeBillingPluginBridge>('MyketBilling');

const BILLING_CALL_TIMEOUT_MS = 12000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('BILLING_TIMEOUT'));
    }, timeoutMs);
    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

function normalizePurchaseState(raw: unknown): StorePurchaseRecord['purchaseState'] {
  if (raw === 0 || raw === '0' || raw === 'PURCHASED') return 'PURCHASED';
  if (raw === 1 || raw === '1' || raw === 'CANCELED' || raw === 'CANCELLED') return 'CANCELED';
  if (raw === 2 || raw === '2' || raw === 'REFUNDED') return 'REFUNDED';
  const upper = String(raw || '').toUpperCase();
  if (upper.includes('PURCHASED')) return 'PURCHASED';
  if (upper.includes('REFUND')) return 'REFUNDED';
  if (upper.includes('CANCEL')) return 'CANCELED';
  return 'UNSPECIFIED';
}

export function isPurchaseStateValid(state: unknown): boolean {
  return normalizePurchaseState(state) === 'PURCHASED';
}

function normalizePurchaseRecord(raw: any, fallbackSku?: string): StorePurchaseRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const productId = String(raw.productId || raw.sku || fallbackSku || '').trim();
  if (!productId) return null;
  const purchaseState = normalizePurchaseState(raw.purchaseState);
  let purchaseTime = Number(raw.purchaseTime || 0);
  if (!Number.isFinite(purchaseTime) || purchaseTime <= 0) {
    purchaseTime = Date.now();
  } else if (purchaseTime < 10_000_000_000) {
    // Convert seconds to ms if store returned epoch seconds
    purchaseTime = purchaseTime * 1000;
  }

  return {
    productId,
    orderId: String(raw.orderId || ''),
    purchaseToken: String(raw.purchaseToken || raw.token || ''),
    payload: String(raw.payload || raw.developerPayload || ''),
    packageName: String(raw.packageName || ''),
    purchaseTime,
    purchaseState,
    dataSignature: String(raw.dataSignature || raw.signature || ''),
  };
}

class NativeStoreBillingProvider implements BillingProvider {
  readonly store: StoreTarget;
  private readonly plugin: NativeBillingPluginBridge;
  private readonly getRsaKey: () => string;

  constructor(
    store: 'bazaar' | 'myket',
    plugin: NativeBillingPluginBridge,
    getRsaKey: () => string
  ) {
    this.store = store;
    this.plugin = plugin;
    this.getRsaKey = getRsaKey;
  }

  isAvailable(): boolean {
    try {
      return Capacitor.isNativePlatform() && isBillingConfigured(this.store);
    } catch {
      return false;
    }
  }

  async querySkuDetails(skus: string[]): Promise<SkuPriceDetail[]> {
    if (!this.isAvailable() || skus.length === 0) return [];
    const rsaPublicKey = this.getRsaKey();
    if (!rsaPublicKey) return [];
    try {
      const res = await withTimeout(
        this.plugin.querySkuDetails({ productIds: skus, rsaPublicKey }),
        BILLING_CALL_TIMEOUT_MS
      );
      if (Array.isArray(res?.skuDetails)) {
        return res.skuDetails.filter((d) => d && typeof d.sku === 'string');
      }
      return [];
    } catch {
      return [];
    }
  }

  async purchaseProduct(sku: string, payload: string = ''): Promise<PurchaseResult> {
    if (!this.isAvailable()) {
      return {
        success: false,
        offlineOrUnavailable: true,
        errorCode: 'BILLING_UNAVAILABLE',
        errorMessage: 'درگاه پرداخت در این نسخه فعال نیست.',
      };
    }
    const rsaPublicKey = this.getRsaKey();
    if (!rsaPublicKey) {
      return {
        success: false,
        offlineOrUnavailable: true,
        errorCode: 'MISSING_RSA_KEY',
        errorMessage: 'کلید عمومی پرداخت تنظیم نشده است.',
      };
    }

    try {
      // No timeout on interactive purchase flow because the user may take time in the store dialog
      const raw = await this.plugin.purchasePro({
        productId: sku,
        rsaPublicKey,
        payload,
      });

      const record = normalizePurchaseRecord(raw, sku);
      if (!record || !isPurchaseStateValid(record.purchaseState)) {
        return {
          success: false,
          errorCode: 'INVALID_PURCHASE_STATE',
          errorMessage: 'وضعیت خرید معتبر نیست (لغو یا بازپرداخت شده است).',
        };
      }

      return {
        success: true,
        alreadyOwned: raw?.status === 'ALREADY_OWNED',
        purchase: record,
      };
    } catch (err: any) {
      const code = String(err?.code || '');
      const msg = String(err?.message || '');
      const combined = `${code} ${msg}`.toUpperCase();

      if (combined.includes('CANCEL')) {
        return {
          success: false,
          cancelled: true,
          errorCode: 'PURCHASE_CANCELLED',
          errorMessage: 'فرآیند خرید لغو شد.',
        };
      }

      if (combined.includes('ALREADY_OWNED') || combined.includes('ITEM_ALREADY_OWNED')) {
        const check = await this.queryPurchases([sku]);
        const found = check.purchases.find((p) => p.productId === sku);
        if (found && isPurchaseStateValid(found.purchaseState)) {
          return {
            success: true,
            alreadyOwned: true,
            purchase: found,
          };
        }
        return {
          success: false,
          alreadyOwned: true,
          errorCode: 'ALREADY_OWNED',
          errorMessage: msg || 'این محصول قبلاً خریداری شده است.',
        };
      }

      return {
        success: false,
        offlineOrUnavailable:
          combined.includes('CONNECTION') ||
          combined.includes('DISCONNECTED') ||
          combined.includes('NOT_FOUND') ||
          combined.includes('TIMEOUT'),
        errorCode: code || 'PURCHASE_FAILED',
        errorMessage: msg || 'خطا در ارتباط با فروشگاه.',
      };
    }
  }

  async queryPurchases(skus: string[]): Promise<QueryPurchasesResult> {
    if (!this.isAvailable()) {
      return { offlineOrUnavailable: true, purchases: [] };
    }
    const rsaPublicKey = this.getRsaKey();
    if (!rsaPublicKey) {
      return { offlineOrUnavailable: true, purchases: [] };
    }

    try {
      const raw = await withTimeout(
        this.plugin.checkProOwnership({
          productId: skus[0] || '',
          productIds: skus,
          rsaPublicKey,
        }),
        BILLING_CALL_TIMEOUT_MS
      );

      const list: StorePurchaseRecord[] = [];
      if (Array.isArray(raw?.purchases)) {
        for (const item of raw.purchases) {
          const rec = normalizePurchaseRecord(item);
          if (rec && isPurchaseStateValid(rec.purchaseState)) {
            list.push(rec);
          }
        }
      } else if (raw?.isProOwned) {
        const single = normalizePurchaseRecord(raw, skus[0]);
        if (single && isPurchaseStateValid(single.purchaseState)) {
          list.push(single);
        }
      }

      const revokedProductIds = Array.isArray(raw?.revokedProductIds)
        ? raw.revokedProductIds.map((id) => String(id || '').trim()).filter(Boolean)
        : [];

      return {
        offlineOrUnavailable: false,
        purchases: list,
        revokedProductIds,
      };
    } catch (err: any) {
      return {
        offlineOrUnavailable: true,
        errorMessage: String(err?.message || 'عدم دسترسی موقت به سرویس فروشگاه'),
        purchases: [],
      };
    }
  }

  async consumePurchase(purchaseToken: string, productId?: string): Promise<ConsumePurchaseResult> {
    if (!this.isAvailable()) {
      return {
        consumed: false,
        errorMessage: 'درگاه پرداخت در این نسخه فعال نیست.',
      };
    }
    const rsaPublicKey = this.getRsaKey();
    if (!rsaPublicKey) {
      return {
        consumed: false,
        errorMessage: 'کلید عمومی پرداخت تنظیم نشده است.',
      };
    }
    const cleanToken = String(purchaseToken || '').trim();
    const cleanProductId = String(productId || '').trim();
    if (!cleanToken && !cleanProductId) {
      return {
        consumed: false,
        errorMessage: 'توکن خرید برای مصرف یافت نشد.',
      };
    }

    try {
      const res = await withTimeout(
        this.plugin.consumePurchase({
          purchaseToken: cleanToken,
          productId: cleanProductId || undefined,
          rsaPublicKey,
        }),
        BILLING_CALL_TIMEOUT_MS
      );
      return {
        consumed: Boolean(res?.consumed),
      };
    } catch (err: any) {
      return {
        consumed: false,
        errorMessage: String(err?.message || 'خطا در مصرف خرید قبلی جهت تمدید'),
      };
    }
  }

  async disconnect(): Promise<void> {
    if (!this.isAvailable()) return;
    try {
      await this.plugin.disconnect();
    } catch {
      // ignore
    }
  }
}

class NoopBillingProvider implements BillingProvider {
  readonly store: StoreTarget = 'none';

  isAvailable(): boolean {
    return false;
  }

  async querySkuDetails(): Promise<SkuPriceDetail[]> {
    return [];
  }

  async purchaseProduct(): Promise<PurchaseResult> {
    return {
      success: false,
      offlineOrUnavailable: true,
      errorCode: 'WEB_OR_UNCONFIGURED',
      errorMessage: 'پرداخت درون‌برنامه‌ای فقط در نسخه اندروید کافه‌بازار یا مایکت فعال است.',
    };
  }

  async queryPurchases(): Promise<QueryPurchasesResult> {
    return { offlineOrUnavailable: true, purchases: [] };
  }

  async consumePurchase(): Promise<ConsumePurchaseResult> {
    return { consumed: false };
  }

  async disconnect(): Promise<void> {}
}

let cachedProvider: BillingProvider | null = null;

export function getBillingProvider(forceStore?: StoreTarget): BillingProvider {
  const target = forceStore ?? getStoreTarget();
  if (cachedProvider && cachedProvider.store === target) {
    return cachedProvider;
  }

  if (target === 'bazaar') {
    cachedProvider = new NativeStoreBillingProvider(
      'bazaar',
      BazaarBillingNative,
      () => getActiveStoreRsaPublicKey('bazaar')
    );
  } else if (target === 'myket') {
    cachedProvider = new NativeStoreBillingProvider(
      'myket',
      MyketBillingNative,
      () => getActiveStoreRsaPublicKey('myket')
    );
  } else {
    cachedProvider = new NoopBillingProvider();
  }

  return cachedProvider;
}

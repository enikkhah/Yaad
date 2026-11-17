import { Capacitor, registerPlugin } from '@capacitor/core';
import {
  getActiveStoreRsaPublicKey,
  getStoreTarget,
  isBillingConfigured,
  StoreTarget,
} from '../config/billingConfig';

export interface SkuPriceDetail {
  sku: string;
  title: string;
  price: string;
  description?: string;
}

export interface StorePurchaseRecord {
  productId: string;
  orderId: string;
  purchaseToken: string;
  purchaseTime: number; // ms since epoch
  purchaseState: 'PURCHASED' | 'CANCELED' | 'REFUNDED' | string;
  payload?: string;
  packageName?: string;
  dataSignature?: string;
  status?: 'PURCHASED' | 'ALREADY_OWNED' | string;
}

export interface OwnershipQueryResult {
  isProOwned: boolean;
  purchases: StorePurchaseRecord[];
  offlineOrUnavailable?: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export interface PurchaseResult {
  success: boolean;
  cancelled?: boolean;
  alreadyOwned?: boolean;
  purchase?: StorePurchaseRecord;
  errorCode?: string;
  errorMessage?: string;
}

export interface BillingProvider {
  readonly store: StoreTarget;
  isAvailable(): boolean;
  querySkuDetails(skus: string[]): Promise<SkuPriceDetail[]>;
  queryPurchases(skus: string[]): Promise<OwnershipQueryResult>;
  purchaseProduct(sku: string, payload?: string): Promise<PurchaseResult>;
  disconnect(): Promise<void>;
}

interface NativeBillingPlugin {
  querySkuDetails(options: {
    productIds: string[];
    rsaPublicKey: string;
  }): Promise<{ skuDetails?: SkuPriceDetail[] }>;
  checkProOwnership(options: {
    productIds: string[];
    productId?: string;
    rsaPublicKey: string;
  }): Promise<{
    isProOwned?: boolean;
    status?: string;
    purchases?: StorePurchaseRecord[];
    productId?: string;
    orderId?: string;
    purchaseToken?: string;
    purchaseTime?: number;
    purchaseState?: string;
    payload?: string;
    packageName?: string;
    dataSignature?: string;
  }>;
  purchasePro(options: {
    productId: string;
    rsaPublicKey: string;
    payload?: string;
  }): Promise<StorePurchaseRecord>;
  disconnect(): Promise<void>;
}

const BazaarBillingNative = registerPlugin<NativeBillingPlugin>('BazaarBilling');
const MyketBillingNative = registerPlugin<NativeBillingPlugin>('MyketBilling');

function normalizePurchases(
  rawList: StorePurchaseRecord[] | undefined,
  singleFallback?: Partial<StorePurchaseRecord>
): StorePurchaseRecord[] {
  const result: StorePurchaseRecord[] = [];
  if (Array.isArray(rawList)) {
    for (const item of rawList) {
      if (item && item.productId && isPurchaseStateValid(item.purchaseState)) {
        result.push({
          ...item,
          purchaseTime: normalizePurchaseTimeMs(item.purchaseTime),
        });
      }
    }
  }
  if (
    result.length === 0 &&
    singleFallback &&
    singleFallback.productId &&
    isPurchaseStateValid(singleFallback.purchaseState)
  ) {
    result.push({
      productId: singleFallback.productId,
      orderId: singleFallback.orderId || '',
      purchaseToken: singleFallback.purchaseToken || '',
      purchaseTime: normalizePurchaseTimeMs(singleFallback.purchaseTime),
      purchaseState: singleFallback.purchaseState || 'PURCHASED',
      payload: singleFallback.payload,
      packageName: singleFallback.packageName,
      dataSignature: singleFallback.dataSignature,
      status: singleFallback.status,
    });
  }
  return result;
}

export function normalizePurchaseTimeMs(rawTime: unknown): number {
  const num = typeof rawTime === 'number' ? rawTime : Number(rawTime);
  if (!Number.isFinite(num) || num <= 0) return Date.now();
  // Poolakey / IAB may occasionally report seconds if < 1e12; normalize to ms
  return num < 1e12 ? num * 1000 : num;
}

export function isPurchaseStateValid(state: unknown): boolean {
  if (state === 0 || state === '0') return true;
  if (typeof state === 'string') {
    const upper = state.trim().toUpperCase();
    return upper === 'PURCHASED';
  }
  return false;
}

function createAndroidStoreProvider(
  store: 'bazaar' | 'myket',
  plugin: NativeBillingPlugin
): BillingProvider {
  return {
    store,
    isAvailable(): boolean {
      try {
        return Capacitor.isNativePlatform() && isBillingConfigured(store);
      } catch {
        return false;
      }
    },
    async querySkuDetails(skus: string[]): Promise<SkuPriceDetail[]> {
      if (!this.isAvailable() || skus.length === 0) return [];
      const rsaPublicKey = getActiveStoreRsaPublicKey(store);
      if (!rsaPublicKey) return [];
      try {
        const res = await plugin.querySkuDetails({
          productIds: skus,
          rsaPublicKey,
        });
        return Array.isArray(res?.skuDetails) ? res.skuDetails : [];
      } catch {
        return [];
      }
    },
    async queryPurchases(skus: string[]): Promise<OwnershipQueryResult> {
      if (!Capacitor.isNativePlatform()) {
        return { isProOwned: false, purchases: [], offlineOrUnavailable: true };
      }
      const rsaPublicKey = getActiveStoreRsaPublicKey(store);
      if (!rsaPublicKey) {
        return {
          isProOwned: false,
          purchases: [],
          offlineOrUnavailable: true,
          errorCode: 'MISSING_RSA_KEY',
        };
      }
      try {
        const res = await plugin.checkProOwnership({
          productIds: skus,
          productId: skus[0],
          rsaPublicKey,
        });
        const validPurchases = normalizePurchases(res?.purchases, res);
        return {
          isProOwned: Boolean(res?.isProOwned && validPurchases.length > 0),
          purchases: validPurchases,
          offlineOrUnavailable: false,
        };
      } catch (err: any) {
        const code = String(err?.code || '');
        const msg = String(err?.message || err || '');
        return {
          isProOwned: false,
          purchases: [],
          offlineOrUnavailable: true,
          errorCode: code || 'QUERY_FAILED',
          errorMessage: msg,
        };
      }
    },
    async purchaseProduct(sku: string, payload: string = ''): Promise<PurchaseResult> {
      if (!Capacitor.isNativePlatform()) {
        return {
          success: false,
          errorCode: 'UNSUPPORTED_PLATFORM',
          errorMessage: 'پرداخت درون‌برنامه‌ای فقط در نسخه اندروید فعال است.',
        };
      }
      const rsaPublicKey = getActiveStoreRsaPublicKey(store);
      if (!rsaPublicKey) {
        return {
          success: false,
          errorCode: 'MISSING_RSA_KEY',
          errorMessage: 'پیکربندی کلید امضای پرداخت فروشگاه در این بیلد کامل نیست.',
        };
      }
      try {
        const record = await plugin.purchasePro({
          productId: sku,
          rsaPublicKey,
          payload,
        });
        if (!record || !isPurchaseStateValid(record.purchaseState)) {
          return {
            success: false,
            errorCode: 'PURCHASE_INVALID_STATE',
            errorMessage: 'تراکنش در وضعیت معتبر نیست (ممکن است لغو یا بازپرداخت شده باشد).',
          };
        }
        return {
          success: true,
          alreadyOwned: record.status === 'ALREADY_OWNED',
          purchase: {
            ...record,
            purchaseTime: normalizePurchaseTimeMs(record.purchaseTime),
          },
        };
      } catch (err: any) {
        const code = String(err?.code || '');
        const message = String(err?.message || '');
        const cancelled =
          code === 'PURCHASE_CANCELLED' ||
          message.includes('انصراف') ||
          message.toLowerCase().includes('cancel');
        return {
          success: false,
          cancelled,
          errorCode: code || (cancelled ? 'PURCHASE_CANCELLED' : 'PURCHASE_FAILED'),
          errorMessage:
            message ||
            (cancelled
              ? 'پرداخت توسط کاربر لغو شد.'
              : 'برقراری ارتباط با درگاه پرداخت فروشگاه انجام نشد.'),
        };
      }
    },
    async disconnect(): Promise<void> {
      if (!Capacitor.isNativePlatform()) return;
      try {
        await plugin.disconnect();
      } catch {
        // ignore
      }
    },
  };
}

export const BazaarBillingProvider: BillingProvider = createAndroidStoreProvider(
  'bazaar',
  BazaarBillingNative
);

export const MyketBillingProvider: BillingProvider = createAndroidStoreProvider(
  'myket',
  MyketBillingNative
);

export const NullBillingProvider: BillingProvider = {
  store: 'none',
  isAvailable: () => false,
  querySkuDetails: async () => [],
  queryPurchases: async () => ({
    isProOwned: false,
    purchases: [],
    offlineOrUnavailable: true,
  }),
  purchaseProduct: async () => ({
    success: false,
    errorCode: 'STORE_DISABLED',
    errorMessage: 'پرداخت درون‌برنامه‌ای در این نسخه غیرفعال است.',
  }),
  disconnect: async () => {},
};

export function getBillingProvider(store: StoreTarget = getStoreTarget()): BillingProvider {
  if (store === 'bazaar') return BazaarBillingProvider;
  if (store === 'myket') return MyketBillingProvider;
  return NullBillingProvider;
}

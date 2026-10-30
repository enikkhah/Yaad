import { Capacitor, registerPlugin } from '@capacitor/core';

export interface BazaarPurchaseSuccessResult {
  status: 'PURCHASED' | 'ALREADY_OWNED';
  orderId: string;
  purchaseToken: string;
  productId: string;
  packageName: string;
  purchaseTime: number;
  dataSignature: string;
}

export interface BazaarOwnershipResult {
  isProOwned: boolean;
  status: 'PURCHASED' | 'NOT_PURCHASED';
  orderId?: string;
  purchaseToken?: string;
  productId?: string;
  purchaseTime?: number;
}

export interface BazaarBillingPlugin {
  purchasePro(options: {
    rsaPublicKey?: string;
    productId: string;
    payload?: string;
    dynamicPriceToken?: string;
  }): Promise<BazaarPurchaseSuccessResult>;

  checkProOwnership(options: {
    rsaPublicKey?: string;
    productId: string;
  }): Promise<BazaarOwnershipResult>;

  disconnect(): Promise<void>;
}

export const BazaarBilling = registerPlugin<BazaarBillingPlugin>('BazaarBilling');

/**
 * شناسه محصول غیرمصرفی (خرید دائمی نسخه Pro) تعریف‌شده در پنل پیشخوان کافه‌بازار
 */
export const BAZAAR_PRO_PRODUCT_ID =
  (import.meta.env.VITE_BAZAAR_PRO_PRODUCT_ID as string | undefined)?.trim() || 'yaad_pro_lifetime';

/**
 * کلید عمومی RSA دریافتی از تب «پرداخت درون‌برنامه‌ای» در پیشخوان توسعه‌دهندگان کافه‌بازار
 * می‌توانید آن را در متغیر محیطی VITE_BAZAAR_RSA_PUBLIC_KEY (یا سکرت گیت‌هاب BAZAAR_RSA_PUBLIC_KEY)
 * و یا مستقیماً در رشته زیر قرار دهید.
 */
export const BAZAAR_RSA_PUBLIC_KEY =
  (import.meta.env.VITE_BAZAAR_RSA_PUBLIC_KEY as string | undefined)?.trim() || '';

const PRO_STORAGE_KEY = 'yaad_pro_purchased_v1';
const PRO_TOKEN_STORAGE_KEY = 'yaad_pro_purchase_token_v1';

export interface ProTransactionResponse {
  ok: boolean;
  isPro: boolean;
  cancelled?: boolean;
  message: string;
  purchaseToken?: string;
  orderId?: string;
}

/**
 * بررسی سریع وضعیت نسخه Pro از حافظه محلی اپ
 */
export function isLocalProActive(): boolean {
  try {
    return localStorage.getItem(PRO_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * باز کردن مستقیم پنجره پرداخت و ورود کد تخفیف کافه‌بازار (برای خرید یک‌باره و دائمی نسخه Pro)
 */
export async function buyYaadProFromBazaar(options?: {
  productId?: string;
  rsaPublicKey?: string;
  payload?: string;
  dynamicPriceToken?: string;
}): Promise<ProTransactionResponse> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    return {
      ok: false,
      isPro: isLocalProActive(),
      message: 'پرداخت درون‌برنامه‌ای کافه‌بازار فقط در نسخه اندروید فعال است.',
    };
  }

  const productId = options?.productId?.trim() || BAZAAR_PRO_PRODUCT_ID;
  const rsaPublicKey = options?.rsaPublicKey?.trim() ?? BAZAAR_RSA_PUBLIC_KEY;

  try {
    const result = await BazaarBilling.purchasePro({
      rsaPublicKey,
      productId,
      payload: options?.payload ?? `yaad_pro_${Date.now()}`,
      dynamicPriceToken: options?.dynamicPriceToken ?? '',
    });

    if (result.status === 'PURCHASED' || result.status === 'ALREADY_OWNED') {
      try {
        localStorage.setItem(PRO_STORAGE_KEY, 'true');
        localStorage.setItem(PRO_TOKEN_STORAGE_KEY, result.purchaseToken || '');
      } catch {
        // ignore storage quota errors
      }

      return {
        ok: true,
        isPro: true,
        purchaseToken: result.purchaseToken,
        orderId: result.orderId,
        message:
          result.status === 'ALREADY_OWNED'
            ? 'نسخه Pro قبلاً توسط حساب کافه‌بازار شما خریداری شده است و مجدداً فعال شد.'
            : 'خرید نسخه Pro با موفقیت انجام شد.',
      };
    }

    return {
      ok: false,
      isPro: false,
      message: 'وضعیت تراکنش نامشخص است.',
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const isCancelled =
      errorMessage.includes('PURCHASE_CANCELLED') || errorMessage.includes('انصراف');

    return {
      ok: false,
      isPro: isLocalProActive(),
      cancelled: isCancelled,
      message: isCancelled
        ? 'فرآیند پرداخت توسط شما لغو شد.'
        : errorMessage || 'خطا در ارتباط با کافه‌بازار.',
    };
  }
}

/**
 * بازیابی و استعلام خودکار خرید قبلی کاربر از کافه‌بازار (مناسب زمان اجرای اپ یا تعویض گوشی)
 */
export async function verifyOrRestoreYaadPro(options?: {
  productId?: string;
  rsaPublicKey?: string;
}): Promise<boolean> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    return isLocalProActive();
  }

  const productId = options?.productId?.trim() || BAZAAR_PRO_PRODUCT_ID;
  const rsaPublicKey = options?.rsaPublicKey?.trim() ?? BAZAAR_RSA_PUBLIC_KEY;

  try {
    const ownership = await BazaarBilling.checkProOwnership({
      rsaPublicKey,
      productId,
    });

    if (ownership.isProOwned) {
      localStorage.setItem(PRO_STORAGE_KEY, 'true');
      if (ownership.purchaseToken) {
        localStorage.setItem(PRO_TOKEN_STORAGE_KEY, ownership.purchaseToken);
      }
      return true;
    }

    localStorage.removeItem(PRO_STORAGE_KEY);
    localStorage.removeItem(PRO_TOKEN_STORAGE_KEY);
    return false;
  } catch {
    // در صورت آفلاین بودن یا عدم دسترسی موقت به بازار، وضعیت ذخیره‌شده قبلی حفظ می‌شود
    return isLocalProActive();
  }
}

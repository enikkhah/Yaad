export type StoreTarget = 'bazaar' | 'myket' | 'none';
export type ProPlanId = '1y' | 'lifetime';

export const PRO_SKU_IDS = {
  ONE_YEAR: 'yaad_pro_1y',
  LIFETIME: 'yaad_pro_lifetime',
} as const;

export const PRO_ONE_YEAR_DURATION_MS = 365 * 24 * 60 * 60 * 1000;

export interface ProPlanConfig {
  id: ProPlanId;
  sku: string;
  durationDays: number | null; // null = lifetime
  fallbackPriceToman: number;
  titleFa: string;
  titleEn: string;
  subtitleFa: string;
  subtitleEn: string;
  badgeFa?: string;
  badgeEn?: string;
}

export const PRO_PLANS: ProPlanConfig[] = [
  {
    id: 'lifetime',
    sku: PRO_SKU_IDS.LIFETIME,
    durationDays: null,
    fallbackPriceToman: 299000,
    titleFa: 'نسخه Pro دائمی',
    titleEn: 'Lifetime Pro',
    subtitleFa: 'یک‌بار پرداخت، فعال برای همیشه روی حساب فروشگاه شما',
    subtitleEn: 'One-time purchase, unlocked forever on your store account',
    badgeFa: 'پیشنهاد اقتصادی',
    badgeEn: 'Best Value',
  },
  {
    id: '1y',
    sku: PRO_SKU_IDS.ONE_YEAR,
    durationDays: 365,
    fallbackPriceToman: 99000,
    titleFa: 'نسخه Pro یک‌ساله',
    titleEn: '1-Year Pro',
    subtitleFa: '۳۶۵ روز دسترسی کامل به همه امکانات پیشرفته یاد',
    subtitleEn: '365 days of full access to all YAAD Pro features',
    badgeFa: 'قیمت لانچ',
    badgeEn: 'Launch Price',
  },
];

/**
 * Active store distribution target injected at Vite build time (`VITE_STORE=bazaar|myket|none`).
 */
export function getStoreTarget(): StoreTarget {
  const raw = String(import.meta.env.VITE_STORE || 'none').trim().toLowerCase();
  if (raw === 'bazaar') return 'bazaar';
  if (raw === 'myket') return 'myket';
  return 'none';
}

export function getStoreDisplayName(store: StoreTarget, isFa: boolean): string {
  if (store === 'bazaar') return isFa ? 'کافه‌بازار' : 'Cafe Bazaar';
  if (store === 'myket') return isFa ? 'مایکت' : 'Myket';
  return isFa ? 'نسخه وب / آفلاین' : 'Web / Offline';
}

/**
 * Returns the RSA public key for the active store from Vite build environment variables.
 * Never ship a hardcoded fallback RSA key or bypass verification when blank.
 */
export function getActiveStoreRsaPublicKey(store: StoreTarget = getStoreTarget()): string {
  if (store === 'bazaar') {
    return String(import.meta.env.VITE_BAZAAR_RSA_PUBLIC_KEY || '').trim();
  }
  if (store === 'myket') {
    return String(import.meta.env.VITE_MYKET_RSA_PUBLIC_KEY || '').trim();
  }
  return '';
}

/**
 * Security gate: In-app purchasing requires both an Android store build (`bazaar` or `myket`)
 * and a non-empty RSA public key from environment secrets.
 */
export function isBillingConfigured(store: StoreTarget = getStoreTarget()): boolean {
  if (store === 'none') return false;
  return getActiveStoreRsaPublicKey(store).length > 0;
}

export function getAllKnownProSkus(extraSkus: string[] = []): string[] {
  const set = new Set<string>([
    PRO_SKU_IDS.LIFETIME,
    PRO_SKU_IDS.ONE_YEAR,
    ...extraSkus.filter((s) => typeof s === 'string' && s.trim().length > 0),
  ]);
  return Array.from(set);
}

export function resolvePlanFromSku(sku: string): ProPlanConfig | null {
  const clean = sku.trim();
  if (clean === PRO_SKU_IDS.LIFETIME || clean.includes('lifetime')) {
    return PRO_PLANS.find((p) => p.id === 'lifetime') || PRO_PLANS[0];
  }
  if (clean === PRO_SKU_IDS.ONE_YEAR || clean.includes('1y')) {
    return PRO_PLANS.find((p) => p.id === '1y') || PRO_PLANS[1];
  }
  return null;
}

export function formatToman(amount: number, isFa: boolean): string {
  const formatted = amount.toLocaleString(isFa ? 'fa-IR' : 'en-US');
  return isFa ? `${formatted} تومان` : `${formatted} Toman`;
}

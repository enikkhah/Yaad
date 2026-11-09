// برای تغییر نسخه، version در package.json یا ورودی version_name در GitHub Actions استفاده می‌شود

function normalizeDigits(input: string): string {
  const persian = '۰۱۲۳۴۵۶۷۸۹';
  const arabic = '٠١٢٣٤٥٦٧٨٩';
  return input
    .replace(/[۰-۹]/g, (d) => String(persian.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(arabic.indexOf(d)))
    .trim();
}

function resolveAppVersion(): string {
  const envVersion =
    typeof import.meta !== 'undefined' &&
    import.meta.env &&
    typeof import.meta.env.VITE_APP_VERSION === 'string' &&
    import.meta.env.VITE_APP_VERSION.trim()
      ? import.meta.env.VITE_APP_VERSION.trim()
      : '';

  const definedVersion =
    typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__
      ? String(__APP_VERSION__).trim()
      : '';

  const raw = normalizeDigits(envVersion || definedVersion || '1.2.5');
  return raw.replace(/^v/i, '') || '1.2.5';
}

export const APP_VERSION = resolveAppVersion();


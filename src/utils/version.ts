// برای تغییر نسخه فقط version در package.json را تغییر بده

function resolveAppVersion(): string {
  const raw =
    typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__
      ? String(__APP_VERSION__).trim()
      : '1.68';
  return raw.replace(/\.0$/, '');
}

export const APP_VERSION = resolveAppVersion();

export const APP_VERSION_INFO = {
  version: APP_VERSION,
  name: 'YAAD (یاد)',
  persianVersion: APP_VERSION.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]),
  type: 'Progressive Web App (PWA) & Android APK',
};


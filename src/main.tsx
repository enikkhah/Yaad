import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Local bundled offline fonts
import '@fontsource/vazirmatn/400.css';
import '@fontsource/vazirmatn/500.css';
import '@fontsource/vazirmatn/600.css';
import '@fontsource/vazirmatn/700.css';
import '@fontsource/vazirmatn/800.css';
import '@fontsource/vazirmatn/900.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';

import { Capacitor } from '@capacitor/core';

// In Capacitor native Android environment, all web assets are bundled locally inside the APK.
// An active Service Worker or stale HTTP cache can prevent newly installed APK updates from displaying.
// Therefore, on native platform, completely unregister any active Service Workers and clear browser caches.
if (Capacitor.isNativePlatform()) {
  if (typeof window !== 'undefined') {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) {
          registration.unregister().catch(() => {});
        }
      }).catch(() => {});
    }
    if ('caches' in window) {
      caches.keys().then((keys) => {
        return Promise.all(keys.map((k) => caches.delete(k)));
      }).catch(() => {});
    }
  }
} else if ('serviceWorker' in navigator) {
  // Clean up any legacy caches (< v11) that may have cached Vite dev modules (/node_modules/.vite/deps)
  if ('caches' in window) {
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((k) => k !== 'yaad-pwa-cache-v11')
          .map((k) => caches.delete(k))
      );
    }).catch(() => {});
  }

  // Web / PWA browser environment: register service worker for offline caching and installability
  const registerSW = () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then((reg) => {
        console.log('PWA ServiceWorker registered successfully with scope:', reg.scope);
        // Automatically check for updates on each launch
        reg.update().catch(() => {});

        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                // Instantly activate new service worker without manual intervention
                newWorker.postMessage({ type: 'SKIP_WAITING' });
              }
            });
          }
        });
      })
      .catch((err) => {
        console.warn('PWA ServiceWorker registration failed:', err);
      });
  };

  if (document.readyState === 'complete') {
    registerSW();
  } else {
    window.addEventListener('load', registerSW);
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

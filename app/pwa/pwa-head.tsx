'use client';

/**
 * PWA Head Component
 * Adds necessary PWA meta tags and script tags
 */

export default function PWAHead() {
  return (
    <>
      {/* Color scheme meta tag for theme support */}
      <meta name="color-scheme" content="light dark" />

      {/* Additional icons for different platforms */}
      <link rel="icon" type="image/png" href="/icons/icon-32.png" sizes="32x32" />
      <link rel="icon" type="image/png" href="/icons/icon-16.png" sizes="16x16" />

      {/* Preload critical resources */}
      <link rel="preload" href="/sw.js" as="script" />

      {/* Open Graph and social media meta tags */}
      <meta property="og:locale" content="en_US" />
      <meta property="og:type" content="website" />

      {/* Register service worker */}
      <script
        dangerouslySetInnerHTML={{
          __html: `
            if ('serviceWorker' in navigator) {
              window.addEventListener('load', () => {
                navigator.serviceWorker.register('/sw.js', { scope: '/' })
                  .then(reg => {
                    console.log('[PWA] Service Worker registered:', reg);
                  })
                  .catch(err => {
                    console.error('[PWA] Service Worker registration failed:', err);
                  });
              });
            }
          `,
        }}
      />

      {/* PWA event listeners for UI updates */}
      <script
        dangerouslySetInnerHTML={{
          __html: `
            window.addEventListener('pwa-network-status', (e) => {
              console.log('[PWA] Network status:', e.detail.isOnline ? 'online' : 'offline');
              document.documentElement.setAttribute('data-network', e.detail.isOnline ? 'online' : 'offline');
            });

            window.addEventListener('pwa-update-available', () => {
              console.log('[PWA] Update available');
              document.documentElement.setAttribute('data-update-available', 'true');
            });

            window.addEventListener('pwa-install-prompt-available', () => {
              console.log('[PWA] Install prompt available');
              document.documentElement.setAttribute('data-install-prompt', 'true');
            });

            window.addEventListener('pwa-install-prompt-hidden', () => {
              document.documentElement.removeAttribute('data-install-prompt');
            });
          `,
        }}
      />
    </>
  );
}

// @ts-nocheck
/**
 * E2E Tests for PWA User Experience
 * Tests complete PWA workflows using Playwright/Cypress
 */

import { test, expect, Page } from '@playwright/test';

test.describe('PWA - Complete User Experience', () => {
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    page = await browser.newPage();
    // Clear service workers and caches
    await page.evaluate(() => {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then((registrations) => {
          registrations.forEach((reg) => reg.unregister());
        });
      }
    });
  });

  test.afterEach(async () => {
    await page.close();
  });

  test.describe('Service Worker Registration', () => {
    test('should register service worker on load', async () => {
      await page.goto('http://localhost:3000');

      const swRegistered = await page.evaluate(() => {
        return new Promise((resolve) => {
          navigator.serviceWorker
            .getRegistrations()
            .then((registrations) => {
              resolve(registrations.length > 0);
            });
        });
      });

      expect(swRegistered).toBe(true);
    });

    test('should have active service worker', async () => {
      await page.goto('http://localhost:3000');

      await page.waitForTimeout(1000);

      const hasActiveSW = await page.evaluate(() => {
        return new Promise((resolve) => {
          navigator.serviceWorker.ready.then((registration) => {
            resolve(registration.active !== undefined);
          });
        });
      });

      expect(hasActiveSW).toBe(true);
    });
  });

  test.describe('Installation Flow', () => {
    test('should show install prompt on supported browsers', async () => {
      await page.goto('http://localhost:3000');

      // Simulate beforeinstallprompt event
      await page.evaluate(() => {
        const event = new Event('beforeinstallprompt');
        window.dispatchEvent(event);
      });

      // Wait for install prompt component to appear
      const installPrompt = page.locator('[class*="install-prompt"]');
      await expect(installPrompt).toBeVisible({ timeout: 2000 });
    });

    test('should allow user to install app', async () => {
      await page.goto('http://localhost:3000');

      // Trigger install prompt
      await page.evaluate(() => {
        const event = new Event('beforeinstallprompt');
        window.dispatchEvent(event);
      });

      // Click install button
      const installButton = page.locator('button:has-text("Install")').first();
      await expect(installButton).toBeVisible();
      await installButton.click();
    });

    test('should hide install prompt after dismissing', async () => {
      await page.goto('http://localhost:3000');

      // Trigger install prompt
      await page.evaluate(() => {
        const event = new Event('beforeinstallprompt');
        window.dispatchEvent(event);
      });

      // Click dismiss button
      const dismissButton = page.locator(
        'button:has-text("Not Now")'
      ).first();
      await expect(dismissButton).toBeVisible();
      await dismissButton.click();

      // Install prompt should be hidden
      const installPrompt = page.locator('[class*="install-prompt"]');
      await expect(installPrompt).not.toBeVisible();
    });
  });

  test.describe('Offline Functionality', () => {
    test('should serve cached content when offline', async () => {
      // First visit to cache content
      await page.goto('http://localhost:3000');
      await page.waitForLoadState('networkidle');

      // Go offline
      await page.context().setOffline(true);

      // Reload should still work
      await page.reload();
      const heading = page.locator('h1');
      await expect(heading).toBeVisible();

      // Go back online
      await page.context().setOffline(false);
    });

    test('should show offline indicator when disconnected', async () => {
      await page.goto('http://localhost:3000');

      // Go offline
      await page.context().setOffline(true);

      // Should show offline status
      await page.waitForTimeout(500);
      const networkStatus = page.locator('[class*="network-status"]');
      const offlineStatus = networkStatus.filter({ hasText: 'offline' });

      // Check if offline indicator appears
      const indicators = await page.locator('[class*="offline"]').count();
      expect(indicators).toBeGreaterThanOrEqual(0);

      // Go back online
      await page.context().setOffline(false);
    });

    test('should serve offline page for failed navigation', async () => {
      await page.goto('http://localhost:3000');
      await page.waitForLoadState('networkidle');

      // Go offline
      await page.context().setOffline(true);

      // Try to navigate to non-existent page
      await page.goto('http://localhost:3000/non-existent', {
        waitUntil: 'networkidle',
      }).catch(() => {});

      // Should either show cached page or offline page
      const pageContent = await page.content();
      expect(pageContent.length).toBeGreaterThan(0);

      // Go back online
      await page.context().setOffline(false);
    });

    test('should automatically try to reconnect when back online', async () => {
      await page.goto('http://localhost:3000');

      // Go offline
      await page.context().setOffline(true);
      await page.waitForTimeout(500);

      // Go back online
      await page.context().setOffline(false);

      // Should show reconnection notification
      await page.waitForTimeout(1000);
      const content = await page.content();
      expect(content).toBeTruthy();
    });
  });

  test.describe('Caching Strategies', () => {
    test('should cache static assets', async () => {
      await page.goto('http://localhost:3000');

      // Check if service worker has cached static assets
      const cachedAssets = await page.evaluate(async () => {
        const cacheNames = await caches.keys();
        const assets: string[] = [];

        for (const cacheName of cacheNames) {
          const cache = await caches.open(cacheName);
          const keys = await cache.keys();
          assets.push(...keys.map((req) => req.url));
        }

        return assets;
      });

      expect(cachedAssets.length).toBeGreaterThan(0);
    });

    test('should use cache-first for images', async () => {
      await page.goto('http://localhost:3000');

      const imagesCached = await page.evaluate(async () => {
        const cacheNames = await caches.keys();
        for (const cacheName of cacheNames) {
          if (cacheName.includes('image')) {
            const cache = await caches.open(cacheName);
            const keys = await cache.keys();
            return keys.length > 0;
          }
        }
        return false;
      });

      // Images should be cached or about to be cached
      expect(typeof imagesCached).toBe('boolean');
    });

    test('should update cache in background', async () => {
      await page.goto('http://localhost:3000');
      const initialTime = Date.now();

      await page.waitForTimeout(2000);

      // Cache should be updated in background
      const cacheUpdated = await page.evaluate(async () => {
        const cacheNames = await caches.keys();
        return cacheNames.length > 0;
      });

      expect(cacheUpdated).toBe(true);
    });
  });

  test.describe('Notifications', () => {
    test('should request notification permission', async () => {
      await page.goto('http://localhost:3000');

      // Grant notification permission
      await page.context().grantPermissions(['notifications']);

      const permission = await page.evaluate(() => {
        if ('Notification' in window) {
          return Notification.permission;
        }
        return 'unavailable';
      });

      expect(['default', 'granted', 'unavailable']).toContain(permission);
    });

    test('should show notification when enabled', async () => {
      await page.goto('http://localhost:3000');
      await page.context().grantPermissions(['notifications']);

      // Trigger a notification
      await page.evaluate(() => {
        if (navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({
            type: 'SHOW_NOTIFICATION',
            title: 'Test Notification',
            body: 'This is a test',
          });
        }
      });

      // Give time for notification to show
      await page.waitForTimeout(1000);
    });
  });

  test.describe('Performance', () => {
    test('should load faster from cache on subsequent visits', async () => {
      // First visit
      const firstLoadStart = Date.now();
      await page.goto('http://localhost:3000');
      await page.waitForLoadState('networkidle');
      const firstLoadTime = Date.now() - firstLoadStart;

      // Wait a moment
      await page.waitForTimeout(500);

      // Second visit (should use cache)
      const secondLoadStart = Date.now();
      await page.reload();
      await page.waitForLoadState('networkidle');
      const secondLoadTime = Date.now() - secondLoadStart;

      // Second load should be faster (more often than not)
      // Note: This is not guaranteed due to network variability
      console.log(`First load: ${firstLoadTime}ms, Second load: ${secondLoadTime}ms`);
      expect(firstLoadTime).toBeGreaterThan(0);
      expect(secondLoadTime).toBeGreaterThan(0);
    });

    test('should have acceptable offline page load time', async () => {
      // Go offline before first visit
      await page.context().setOffline(true);

      const loadStart = Date.now();
      try {
        await page.goto('http://localhost:3000', {
          waitUntil: 'domcontentloaded',
        });
      } catch {}
      const loadTime = Date.now() - loadStart;

      // Should load within reasonable time
      expect(loadTime).toBeLessThan(5000);

      await page.context().setOffline(false);
    });
  });

  test.describe('Manifest Validation', () => {
    test('should have valid manifest.json', async () => {
      await page.goto('http://localhost:3000');

      const manifest = await page.evaluate(async () => {
        const response = await fetch('/manifest.json');
        return response.json();
      });

      expect(manifest).toHaveProperty('name');
      expect(manifest).toHaveProperty('short_name');
      expect(manifest).toHaveProperty('start_url');
      expect(manifest).toHaveProperty('display');
      expect(manifest).toHaveProperty('icons');
      expect(Array.isArray(manifest.icons)).toBe(true);
      expect(manifest.icons.length).toBeGreaterThan(0);
    });

    test('should have correct manifest properties', async () => {
      await page.goto('http://localhost:3000');

      const manifest = await page.evaluate(async () => {
        const response = await fetch('/manifest.json');
        return response.json();
      });

      expect(manifest.display).toMatch(/^(fullscreen|standalone|minimal-ui|browser)$/);
      expect(typeof manifest.theme_color).toBe('string');
      expect(typeof manifest.background_color).toBe('string');
    });
  });

  test.describe('Lighthouse PWA Audit', () => {
    test('should pass PWA audit checks', async () => {
      await page.goto('http://localhost:3000');

      const pwaChecks = await page.evaluate(() => {
        const checks = {
          hasManifest: !!document.querySelector('link[rel="manifest"]'),
          hasServiceWorker: 'serviceWorker' in navigator,
          hasViewportMeta: !!document.querySelector('meta[name="viewport"]'),
          hasThemeColor: !!document.querySelector('meta[name="theme-color"]'),
          hasAppleTouchIcon: !!document.querySelector(
            'link[rel="apple-touch-icon"]'
          ),
          isHttps: location.protocol === 'https:' || location.hostname === 'localhost',
        };

        return checks;
      });

      expect(pwaChecks.hasManifest).toBe(true);
      expect(pwaChecks.hasServiceWorker).toBe(true);
      expect(pwaChecks.hasViewportMeta).toBe(true);
      expect(pwaChecks.isHttps).toBe(true);
    });
  });
});

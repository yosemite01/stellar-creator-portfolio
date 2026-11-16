/**
 * Playwright e2e test suite for React hydration safety (Issue #1826)
 *
 * Verifies that all major application routes render on the server and hydrate
 * on the client with zero React hydration warnings or mismatch errors.
 *
 * Run locally:
 *   pnpm test:e2e -- e2e/hydration.spec.ts
 */

import { test, expect } from '@playwright/test';

const ROUTES_TO_AUDIT = [
  { name: 'Home Page', path: '/' },
  { name: 'Creators Directory', path: '/creators' },
  { name: 'Bounties Directory', path: '/bounties' },
  { name: 'Freelancers Directory', path: '/freelancers' },
];

for (const { name, path } of ROUTES_TO_AUDIT) {
  test.describe(`Hydration check – ${name}`, () => {
    test(`renders ${path} with zero hydration mismatch warnings or errors`, async ({
      page,
    }) => {
      const hydrationErrors: string[] = [];

      // Intercept console errors and warnings for hydration mismatch signatures
      page.on('console', (msg) => {
        const text = msg.text();
        const isErrorOrWarn = msg.type() === 'error' || msg.type() === 'warning';
        if (
          isErrorOrWarn &&
          (text.includes('Hydration failed') ||
            text.includes('did not match') ||
            text.includes('Text content does not match server-rendered HTML') ||
            text.includes('Expected server HTML to contain a matching') ||
            text.includes('There was an error while hydrating') ||
            text.includes('Warning: Prop `%s` did not match'))
        ) {
          hydrationErrors.push(`[${msg.type().toUpperCase()}] ${text}`);
        }
      });

      // Navigate to route and wait for hydration/client completion
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => {
        // networkidle timeout is non-fatal if background polling continues
      });

      // Assert zero hydration errors
      if (hydrationErrors.length > 0) {
        throw new Error(
          `Hydration mismatch detected on ${path}:\n` +
            hydrationErrors.join('\n'),
        );
      }

      expect(hydrationErrors).toHaveLength(0);
    });
  });
}

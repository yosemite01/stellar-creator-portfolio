/**
 * Accessibility e2e tests using @axe-core/playwright (Issues #1773)
 * Targets WCAG 2.2 AA. Fails on serious or critical violations.
 *
 * Run locally:
 *   pnpm test:e2e -- e2e/a11y.spec.ts
 *
 * Requires the app running on http://localhost:3000 (pnpm dev / pnpm start).
 */

import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/** Pages to audit — includes primary listing & payment/dashboard routes */
const PAGES = [
  { name: 'home', path: '/' },
  { name: 'creators', path: '/creators' },
  { name: 'bounties', path: '/bounties' },
  { name: 'earnings dashboard', path: '/dashboard/earnings' },
  { name: 'files dashboard', path: '/dashboard/files' },
];

async function assertNoBlockingAxeViolations(page: Page, contextLabel: string, include?: string) {
  let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']);
  if (include) {
    builder = builder.include(include);
  }
  const results = await builder.analyze();

  const blocking = results.violations.filter((v) =>
    ['serious', 'critical'].includes(v.impact ?? ''),
  );

  if (blocking.length > 0) {
    const summary = blocking
      .map(
        (v) =>
          `[${v.impact?.toUpperCase()}] ${v.id}: ${v.description}\n` +
          v.nodes
            .slice(0, 3)
            .map((n) => `  target: ${n.target.join(', ')}`)
            .join('\n'),
      )
      .join('\n\n');
    throw new Error(
      `${blocking.length} blocking a11y violation(s) on "${contextLabel}":\n\n${summary}`,
    );
  }

  const moderate = results.violations.filter((v) => v.impact === 'moderate');
  if (moderate.length > 0) {
    console.warn(
      `[a11y] ${moderate.length} moderate violation(s) on "${contextLabel}" (non-blocking):`,
      moderate.map((v) => v.id),
    );
  }

  expect(blocking).toHaveLength(0);
}

for (const { name, path } of PAGES) {
  test.describe(`a11y – ${name} page`, () => {
    test(`has no serious or critical WCAG 2.2 AA violations on ${path}`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await assertNoBlockingAxeViolations(page, path);
    });
  });
}

test.describe('a11y – wallet connect modal & keyboard focus management (#1773)', () => {
  test('opens via keyboard, traps focus, passes axe audit, and restores focus on Escape', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const trigger = page.getByRole('button', { name: /connect wallet/i }).first();
    await trigger.focus();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');

    // Focus should be trapped inside the dialog across Tab cycles
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press('Tab');
      const focusInside = await dialog.evaluate((el) => el.contains(document.activeElement));
      expect(focusInside).toBe(true);
    }

    // Zero serious or critical axe violations inside open wallet modal
    await assertNoBlockingAxeViolations(page, 'wallet connect modal', '[role="dialog"]');

    // Pressing Escape dismisses the modal and restores focus to trigger
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});

test.describe('a11y – cross-chain payment swap modal (#1773)', () => {
  test('supports full keyboard navigation, accessible error messages, live regions, and passes axe audit', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const bridgeBtn = page.getByRole('button', { name: /bridge/i }).first();
    await bridgeBtn.focus();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');

    // Audit initial step with axe
    await assertNoBlockingAxeViolations(page, 'cross-chain swap modal (step 1)', '[role="dialog"]');

    // Trigger accessible validation error with invalid amount
    const amountInput = dialog.getByLabel(/amount/i);
    await amountInput.fill('0');
    await dialog.getByRole('button', { name: /continue/i }).click();

    const alert = dialog.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(amountInput).toHaveAttribute('aria-invalid', 'true');

    // Fix amount and advance to review step
    await amountInput.fill('100');
    await dialog.getByRole('button', { name: /continue/i }).click();
    await expect(dialog.getByText(/step 2 of 4/i)).toBeVisible();

    await assertNoBlockingAxeViolations(page, 'cross-chain swap modal (step 2)', '[role="dialog"]');

    // Escape closes and returns focus to launcher button
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(bridgeBtn).toBeFocused();
  });
});

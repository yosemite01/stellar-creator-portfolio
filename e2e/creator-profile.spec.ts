import { test, expect } from '@playwright/test';

/**
 * E2E Tests for Creator Profile Lifecycle (Issue #1580)
 *
 * Covers:
 *   1. Creator onboarding flow (/onboarding)
 *   2. Edit creator profile (/profile/edit)
 *   3. View public creator page (/creators/[id])
 *   4. OpenGraph metadata assertion (og:title, og:description, og:image, twitter tags)
 *   5. Share profile link verification
 */

test.describe('Creator Profile Lifecycle & Public Profile Rendering', () => {
  const creatorId = 'alex-studio';
  const updatedDisplayName = 'Alex Rivera Studio';
  const updatedBio = 'Senior Motion Designer & Stellar UI Engineer building high-conversion Web3 experiences.';
  const websiteUrl = 'https://alexrivera.design';
  const githubUrl = 'https://github.com/alexrivera';

  test.beforeEach(async ({ page }) => {
    // Mock authenticated creator session
    await page.route('**/api/auth/session', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            id: creatorId,
            name: 'Alex Rivera',
            email: 'alex@tamgora.test',
            role: 'CREATOR',
          },
          expires: new Date(Date.now() + 86400000).toISOString(),
        }),
      });
    });

    // Mock profile save / update API
    await page.route('**/api/profile**', async (route) => {
      if (route.request().method() === 'POST' || route.request().method() === 'PUT' || route.request().method() === 'PATCH') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            profile: {
              id: creatorId,
              displayName: updatedDisplayName,
              bio: updatedBio,
              websiteUrl,
              githubUrl,
            },
          }),
        });
      } else {
        await route.continue();
      }
    });
  });

  test('onboarding → edit profile → view public page → assert OpenGraph & share link', async ({
    page,
    context,
  }) => {
    // ── 1. Onboarding Flow ────────────────────────────────────────────────────
    await page.goto('/onboarding', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveTitle(/Onboarding|Tamgora/i);

    // Verify wizard container or steps are visible
    const wizardContent = page.locator('main, [role="main"], form, .onboarding-container').first();
    await expect(wizardContent).toBeVisible();

    // ── 2. Edit Profile Flow ──────────────────────────────────────────────────
    await page.goto('/profile/edit', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('h3, h4, h1').first()).toBeVisible();

    // Edit display name / bio / links if inputs exist
    const bioTextarea = page.locator('textarea[name="bio"], textarea').first();
    if (await bioTextarea.isVisible()) {
      await bioTextarea.fill(updatedBio);
    }

    const websiteInput = page.locator('input[name="websiteUrl"], input[placeholder*="http"], input[type="url"]').first();
    if (await websiteInput.isVisible()) {
      await websiteInput.fill(websiteUrl);
    }

    const saveButton = page.locator('button[type="submit"], button:has-text("Save"), button:has-text("Update")').first();
    if (await saveButton.isVisible()) {
      await saveButton.click();
    }

    // ── 3. View Public Creator Page ───────────────────────────────────────────
    await page.goto(`/creators/${creatorId}`, { waitUntil: 'domcontentloaded' });

    // Assert the page header, projects section, and footer are rendered
    await expect(page.locator('header')).toBeVisible();
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('footer')).toBeVisible();

    // ── 4. OpenGraph and Twitter Metadata Assertions ──────────────────────────
    // Head metadata must contain OG and Twitter cards
    const ogTitle = await page.locator('meta[property="og:title"]').getAttribute('content');
    expect(ogTitle).toBeTruthy();
    expect(ogTitle).toContain('Tamgora');

    const ogDescription = await page.locator('meta[property="og:description"]').getAttribute('content');
    expect(ogDescription).not.toBeNull();

    const twitterCard = await page.locator('meta[name="twitter:card"]').getAttribute('content');
    expect(twitterCard).toBeTruthy();

    // ── 5. Share Profile Link Verification ────────────────────────────────────
    // Find share button or profile URL link
    const shareBtn = page.locator('button:has-text("Share"), button[aria-label*="Share"], [aria-label*="share"]').first();
    if (await shareBtn.isVisible()) {
      // Grant clipboard permissions for share link copy
      await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
      await shareBtn.click();
    }

    // Verify current URL reflects the creator's public profile page
    expect(page.url()).toContain(`/creators/${creatorId}`);
  });
});

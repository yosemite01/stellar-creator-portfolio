/**
 * Playwright E2E outline. Install Playwright and run:
 *   npx playwright install
 *   npx playwright test __tests__/upload.e2e.test.ts
 */
import { expect, test } from "@playwright/test";

test.describe("file upload flow", () => {
  test("user can upload and download a file", async ({ page }) => {
    await page.goto("/dashboard/files");
    const fileInput = page.locator("input[type=file]");
    await fileInput.setInputFiles({
      name: "sample.png",
      mimeType: "image/png",
      buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    });
    await expect(page.getByText("uploading", { exact: false })).toBeVisible();
    await expect(page.getByText("done", { exact: false })).toBeVisible({ timeout: 15000 });
    await page.getByText("View").first().click();
    await expect(page).toHaveURL(/signed/);
  });
});

import { type Page, expect } from "@playwright/test";

/**
 * Navigate via sidebar link text. Auth is pre-loaded via storageState.
 */
export async function navigateTo(page: Page, label: string) {
  await page.locator("aside a").filter({ hasText: label }).first().click();
  await page.waitForLoadState("networkidle");
}

/**
 * Assert page title in the AppShell header h1.
 */
export async function expectPageTitle(page: Page, text: string) {
  await expect(
    page.locator("header h1").filter({ hasText: text }).first()
  ).toBeVisible({ timeout: 10_000 });
}

/**
 * Wait for skeleton loaders to disappear.
 */
export async function waitForDataLoad(page: Page, ms = 15_000) {
  await page
    .waitForFunction(
      () => document.querySelectorAll(".animate-pulse").length === 0,
      { timeout: ms }
    )
    .catch(() => {});
}

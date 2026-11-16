import { test, expect } from "@playwright/test";
import { expectPageTitle, waitForDataLoad } from "./helpers";

test.describe("Insights Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/insights");
    await page.waitForLoadState("networkidle");
  });

  test("page loads with title", async ({ page }) => {
    await expectPageTitle(page, "Insights");
  });

  test("has tab buttons", async ({ page }) => {
    await expect(page.locator("button").filter({ hasText: /Charts/ }).first()).toBeVisible();
    await expect(page.locator("button").filter({ hasText: /Builder/ }).first()).toBeVisible();
  });

  test("can switch to builder tab", async ({ page }) => {
    await page.locator("button").filter({ hasText: /Builder/ }).first().click();
    await page.waitForLoadState("networkidle");
    await waitForDataLoad(page);
  });
});

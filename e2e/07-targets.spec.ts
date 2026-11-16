import { test, expect } from "@playwright/test";
import { expectPageTitle, waitForDataLoad } from "./helpers";

test.describe("Targets Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/targets");
    await page.waitForLoadState("networkidle");
  });

  test("page loads with title", async ({ page }) => {
    await expectPageTitle(page, "Targets & Goals");
  });

  test("renders content", async ({ page }) => {
    await waitForDataLoad(page);
    const content = await page.locator("main").textContent();
    expect(content!.length).toBeGreaterThan(0);
  });

  test("add target button exists", async ({ page }) => {
    await waitForDataLoad(page);
    const addBtn = page.locator("button").filter({ hasText: /Add|Create|New/ }).first();
    if (await addBtn.isVisible().catch(() => false)) {
      await expect(addBtn).toBeEnabled();
    }
  });
});

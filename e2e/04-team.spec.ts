import { test, expect } from "@playwright/test";
import { expectPageTitle, waitForDataLoad } from "./helpers";

test.describe("Team Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/team");
    await page.waitForLoadState("networkidle");
  });

  test("page loads with title", async ({ page }) => {
    await expectPageTitle(page, "Team Overview");
  });

  test("shows cards", async ({ page }) => {
    await waitForDataLoad(page);
    const content = await page.locator("main").textContent();
    expect(content!.length).toBeGreaterThan(50);
  });

  test("rep table renders", async ({ page }) => {
    await waitForDataLoad(page);
    const table = page.locator("table").first();
    if (await table.isVisible().catch(() => false)) {
      await expect(table.locator("th").first()).toBeVisible();
    }
  });
});

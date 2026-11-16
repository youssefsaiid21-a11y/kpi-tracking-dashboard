import { test, expect } from "@playwright/test";
import { expectPageTitle, waitForDataLoad } from "./helpers";

test.describe("Conversion Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/conversion");
    await page.waitForLoadState("networkidle");
  });

  test("page loads with title", async ({ page }) => {
    await expectPageTitle(page, "Pipeline Conversion");
  });

  test("renders content", async ({ page }) => {
    await waitForDataLoad(page);
    const content = await page.locator("main").textContent();
    expect(content!.length).toBeGreaterThan(50);
  });
});

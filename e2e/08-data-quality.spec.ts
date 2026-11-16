import { test, expect } from "@playwright/test";
import { expectPageTitle, waitForDataLoad } from "./helpers";

test.describe("Data Quality Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/data-quality");
    await page.waitForLoadState("networkidle");
  });

  test("page loads with title", async ({ page }) => {
    await expectPageTitle(page, "Data Quality");
  });

  test("renders content", async ({ page }) => {
    await waitForDataLoad(page);
    const content = await page.locator("main").textContent();
    expect(content!.length).toBeGreaterThan(0);
  });
});

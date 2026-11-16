import { test, expect } from "@playwright/test";
import { expectPageTitle, waitForDataLoad } from "./helpers";

test.describe("Meetings Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/meetings");
    await page.waitForLoadState("networkidle");
  });

  test("page loads with title", async ({ page }) => {
    await expectPageTitle(page, "Meetings");
  });

  test("has Review and History tab buttons", async ({ page }) => {
    await expect(page.locator("button").filter({ hasText: "Review" }).first()).toBeVisible();
    await expect(page.locator("button").filter({ hasText: "History" }).first()).toBeVisible();
  });

  test("review mode shows content", async ({ page }) => {
    await waitForDataLoad(page);
    const content = await page.locator("main").textContent();
    expect(content!.length).toBeGreaterThan(0);
  });

  test("can switch to History tab", async ({ page }) => {
    await page.locator("button").filter({ hasText: "History" }).first().click();
    await page.waitForLoadState("networkidle");
  });
});

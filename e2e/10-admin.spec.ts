import { test, expect } from "@playwright/test";
import { expectPageTitle, waitForDataLoad } from "./helpers";

test.describe("Admin Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin");
    await page.waitForLoadState("networkidle");
  });

  test("page loads with title", async ({ page }) => {
    await expectPageTitle(page, "Administration");
  });

  test("shows integration sections", async ({ page }) => {
    await waitForDataLoad(page);
    await expect(page.locator("text=Microsoft").or(page.locator("text=Outlook")).first()).toBeVisible();
    await expect(page.locator("text=HubSpot").first()).toBeVisible();
  });

  test("user management shows users", async ({ page }) => {
    await waitForDataLoad(page);
    await expect(page.locator("text=User").first()).toBeVisible();
  });

  test("add user dialog opens", async ({ page }) => {
    await waitForDataLoad(page);
    const addBtn = page.locator("button").filter({ hasText: /Add User|Add|New/ }).first();
    if (await addBtn.isVisible().catch(() => false)) {
      await addBtn.click();
      const dialog = page.locator('[role="dialog"]').first();
      await expect(dialog).toBeVisible({ timeout: 5_000 });
      await page.keyboard.press("Escape");
    }
  });
});

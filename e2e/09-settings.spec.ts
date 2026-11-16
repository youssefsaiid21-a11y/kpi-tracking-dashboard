import { test, expect } from "@playwright/test";
import { expectPageTitle, waitForDataLoad } from "./helpers";

test.describe("Settings Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");
  });

  test("page loads with title", async ({ page }) => {
    await expectPageTitle(page, "Settings");
  });

  test("shows user info", async ({ page }) => {
    await waitForDataLoad(page);
    await expect(
      page.locator("text=Demo member").or(page.locator("text=member-073@company.example")).first()
    ).toBeVisible();
  });

  test("Outlook section exists", async ({ page }) => {
    await waitForDataLoad(page);
    await expect(page.locator("text=Outlook").or(page.locator("text=Calendar")).first()).toBeVisible();
  });
});

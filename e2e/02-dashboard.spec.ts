import { test, expect } from "@playwright/test";
import { expectPageTitle, waitForDataLoad } from "./helpers";

test.describe("Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
  });

  test("renders page with Dashboard title in header", async ({ page }) => {
    await expectPageTitle(page, "Dashboard");
  });

  test("shows KPI cards after data loads", async ({ page }) => {
    await waitForDataLoad(page);
    const mainContent = await page.locator("main").textContent();
    expect(mainContent!.length).toBeGreaterThan(50);
  });

  test("sidebar has all nav items", async ({ page }) => {
    const sidebar = page.locator("aside");
    await expect(sidebar).toBeVisible();
    for (const item of ["Dashboard", "Meetings", "Team", "Conversion", "Insights", "Targets", "Data Quality", "Settings", "Admin"]) {
      await expect(sidebar.locator("a").filter({ hasText: item }).first()).toBeVisible();
    }
  });

  test("Dashboard link is highlighted", async ({ page }) => {
    const link = page.locator("aside a").filter({ hasText: "Dashboard" }).first();
    await expect(link).toHaveClass(/text-primary/);
  });

  test("sidebar collapse toggle works", async ({ page }) => {
    const sidebar = page.locator("aside");
    await expect(sidebar).toHaveClass(/w-60/);
    await page.locator('button[aria-label="Collapse sidebar"]').click();
    await expect(sidebar).toHaveClass(/w-16/);
    await page.locator('button[aria-label="Expand sidebar"]').click();
    await expect(sidebar).toHaveClass(/w-60/);
  });

  test("period selector visible in header", async ({ page }) => {
    const periodBtn = page.locator("header button").filter({ hasText: /Week|Month|Quarter|All/ }).first();
    await expect(periodBtn).toBeVisible();
  });

  test("user profile in sidebar shows name and role", async ({ page }) => {
    const sidebar = page.locator("aside");
    await expect(sidebar.locator("text=Demo member Farag")).toBeVisible();
    await expect(sidebar.locator("p").filter({ hasText: "admin" }).first()).toBeVisible();
  });

  test("Example Company branding in sidebar", async ({ page }) => {
    await expect(page.locator("aside").locator("text=Example Company")).toBeVisible();
  });
});

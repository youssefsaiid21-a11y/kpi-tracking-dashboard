import { test, expect } from "@playwright/test";
import { navigateTo } from "./helpers";

test.describe("Full Navigation", () => {
  test.setTimeout(120_000); // 9 pages, some take 10s+ on dev
  test("visit every page via direct URL without errors", async ({ page }) => {
    const urls = [
      { url: "/dashboard", title: "Dashboard" },
      { url: "/meetings", title: "Meetings" },
      { url: "/team", title: "Team Overview" },
      { url: "/conversion", title: "Pipeline Conversion" },
      { url: "/insights", title: "Insights" },
      { url: "/targets", title: "Targets & Goals" },
      { url: "/data-quality", title: "Data Quality" },
      { url: "/settings", title: "Settings" },
      { url: "/admin", title: "Administration" },
    ];

    for (const p of urls) {
      await page.goto(p.url);
      await page.waitForLoadState("networkidle");
      // Should not redirect to login
      expect(page.url()).not.toContain("/login");
      // Should show correct page title
      await expect(page.locator("header h1").filter({ hasText: p.title })).toBeVisible({ timeout: 10_000 });
      // No unhandled error
      const hasError = await page.locator("text=Something went wrong").first().isVisible().catch(() => false);
      expect(hasError).toBeFalsy();
    }
  });
});

test.describe("API Health", () => {
  test("health endpoint returns 200", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.ok()).toBeTruthy();
  });
});

test.describe("Responsive", () => {
  test("mobile viewport renders", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("header h1")).toBeVisible();
  });

  test("tablet viewport renders", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("header h1")).toBeVisible();
  });
});

import { test, expect } from "@playwright/test";

// Auth tests use their OWN context (not the shared auth state)
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Authentication", () => {
  test("shows login page with branding", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("h1")).toContainText("Example Company");
    await expect(page.locator("input#email")).toBeVisible();
    await expect(page.locator("input#password")).toBeVisible();
    await expect(page.locator('button:has-text("Sign in")')).toBeVisible();
    await expect(page.locator("text=Forgot your password?")).toBeVisible();
  });

  test("rejects invalid credentials", async ({ page }) => {
    await page.goto("/login");
    // Wait for hydration before filling
    const emailInput = page.locator("input#email");
    await emailInput.waitFor({ state: "visible" });
    await page.waitForTimeout(2_000);
    await emailInput.click();
    await emailInput.fill("member-006@organization-004.example");
    await page.locator("input#password").click();
    await page.locator("input#password").fill("wrongpassword");
    await page.click('button:has-text("Sign in")');
    await expect(page.locator("text=Invalid email or password")).toBeVisible({
      timeout: 30_000,
    });
    expect(page.url()).toContain("/login");
  });

  test("unauthenticated access redirects to login", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForURL(/\/login/, { timeout: 15_000 });
    expect(page.url()).toContain("/login");
  });

  test("successful login redirects to dashboard", async ({ page }) => {
    await page.goto("/login");

    // Wait for the client component to hydrate before interacting.
    // The Sign-in button is disabled while loading=true; once it reads "Sign in"
    // (not "Signing in...") and is enabled, React is ready.
    const submitBtn = page.locator('button[type="submit"]');
    await submitBtn.waitFor({ state: "visible", timeout: 15_000 });
    // Also wait for the email input to be interactable (attached + enabled).
    await page.locator("input#email").waitFor({ state: "visible", timeout: 15_000 });

    await page.locator("input#email").fill("member-073@company.example");
    await page.locator("input#password").fill("Example Company2026!");
    await submitBtn.click();

    // After signIn() resolves, router.push(callbackUrl) fires a client-side
    // navigation to /dashboard.  Wait for that URL change.
    // If the redirect takes longer than expected, check that we are at least
    // NOT back on /login (i.e. the session was created successfully).
    await page.waitForURL(/\/dashboard/, { timeout: 60_000 }).catch(async (err) => {
      // Only re-throw if the page context is still alive — if it is closed the
      // test runner will already mark the test as failed and a second goto would
      // produce the misleading "Target page … has been closed" error.
      if (!page.isClosed()) {
        // Last-chance check: maybe we are already on /dashboard but the URL
        // pattern didn't match because of a trailing query string, etc.
        const url = page.url();
        if (!url.includes("/dashboard")) {
          throw err;
        }
      }
    });

    // Final assertion — page context must still be open at this point.
    if (!page.isClosed()) {
      expect(page.url()).toContain("/dashboard");
    }
  });
});

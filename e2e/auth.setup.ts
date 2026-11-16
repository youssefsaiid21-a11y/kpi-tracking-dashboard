import { test as setup, expect } from "@playwright/test";

const AUTH_FILE = "e2e/.auth/user.json";

setup.setTimeout(120_000);

setup("authenticate", async ({ page }) => {
  await page.goto("/login");
  // Wait for the React app to fully hydrate — inputs must be interactive
  const emailInput = page.locator("input#email");
  await emailInput.waitFor({ state: "visible", timeout: 30_000 });
  // Small delay for hydration to complete
  await page.waitForTimeout(2_000);

  // Clear and type (more reliable than fill for React controlled inputs)
  await emailInput.click();
  await emailInput.fill("member-073@company.example");

  const passwordInput = page.locator("input#password");
  await passwordInput.click();
  await passwordInput.fill(process.env.E2E_TEST_PASSWORD || "");

  // Verify values stuck
  await expect(emailInput).toHaveValue("member-073@company.example");
  await expect(passwordInput).toHaveValue(process.env.E2E_TEST_PASSWORD || "");

  await page.click('button:has-text("Sign in")');

  // Wait for redirect or session establishment
  await page.waitForURL((url) => !url.pathname.includes("/login"), {
    timeout: 90_000,
  }).catch(async () => {
    // Fallback: navigate directly (cookies may be set even if redirect fails)
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
  });

  if (page.url().includes("/login")) {
    throw new Error("Authentication failed — still on login page");
  }

  await page.context().storageState({ path: AUTH_FILE });
});

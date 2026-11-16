import { test, expect } from "@playwright/test";

// These tests use the shared auth storageState (cookies pre-loaded)

test.describe("API Route Smoke Tests", () => {
  test("GET /api/analytics returns data", async ({ request }) => {
    const response = await request.get("/api/analytics?period=monthly");
    expect(response.ok()).toBeTruthy();
    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.data).toBeDefined();
  });

  test("GET /api/analytics/team returns data", async ({ request }) => {
    const response = await request.get("/api/analytics/team?period=monthly");
    expect(response.ok()).toBeTruthy();
    const json = await response.json();
    expect(json.success).toBe(true);
  });

  test("GET /api/analytics/conversion returns data", async ({ request }) => {
    const response = await request.get("/api/analytics/conversion");
    expect(response.ok()).toBeTruthy();
    const json = await response.json();
    expect(json.success).toBe(true);
  });

  test("GET /api/meetings returns list", async ({ request }) => {
    const response = await request.get("/api/meetings?page=1&pageSize=10");
    expect(response.ok()).toBeTruthy();
    const json = await response.json();
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
  });

  test("GET /api/anomalies returns data", async ({ request }) => {
    const response = await request.get("/api/anomalies");
    expect(response.ok()).toBeTruthy();
    const json = await response.json();
    expect(json.success).toBe(true);
  });

  test("GET /api/users returns users", async ({ request }) => {
    const response = await request.get("/api/users");
    expect(response.ok()).toBeTruthy();
    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.data.length).toBeGreaterThan(0);
  });

  test("GET /api/users/me returns current user", async ({ request }) => {
    const response = await request.get("/api/users/me");
    expect(response.ok()).toBeTruthy();
    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.data.email).toBe("member-073@company.example");
  });

  test("GET /api/targets returns targets", async ({ request }) => {
    const response = await request.get("/api/targets");
    expect(response.ok()).toBeTruthy();
    const json = await response.json();
    expect(json.success).toBe(true);
  });

  test("GET /api/settings returns settings", async ({ request }) => {
    const response = await request.get("/api/settings");
    expect(response.ok()).toBeTruthy();
    const json = await response.json();
    expect(json.success).toBe(true);
  });

  // Reminders route only has POST (admin-only), no GET endpoint

  test("GET /api/export returns data", async ({ request }) => {
    const response = await request.get("/api/export?type=meetings&format=json");
    expect(response.ok()).toBeTruthy();
  });

  test("GET /api/insights/charts returns charts", async ({ request }) => {
    const response = await request.get("/api/insights/charts");
    expect(response.ok()).toBeTruthy();
    const json = await response.json();
    expect(json.success).toBe(true);
  });
});

test.describe("API Auth Protection", () => {
  // Override: use NO auth state
  test.use({ storageState: { cookies: [], origins: [] } });

  test("unauthenticated calls return 401", async ({ request }) => {
    for (const ep of ["/api/analytics", "/api/meetings", "/api/users"]) {
      const response = await request.get(ep);
      expect(response.status()).toBe(401);
    }
  });
});

test.describe("Cron Job Auth", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("rejects without secret", async ({ request }) => {
    const response = await request.post("/api/jobs/sync-calendars");
    expect(response.status()).toBe(401);
  });

  test("rejects wrong secret", async ({ request }) => {
    const response = await request.post("/api/jobs/sync-calendars", {
      headers: { Authorization: "Bearer wrong-secret" },
    });
    expect(response.status()).toBe(401);
  });
});

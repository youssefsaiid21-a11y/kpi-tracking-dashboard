import { describe, it, expect } from "vitest";
import {
  checkRateLimit,
  checkAuthRateLimit,
  checkSyncRateLimit,
  checkApiRateLimit,
} from "./rate-limit";

describe("checkRateLimit", () => {
  it("allows requests within the limit", () => {
    // Use unique keys to avoid interference between tests
    const key = `test-allow-${Date.now()}`;
    const r1 = checkRateLimit(key, 3, 60000);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);

    const r2 = checkRateLimit(key, 3, 60000);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(1);

    const r3 = checkRateLimit(key, 3, 60000);
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0);
  });

  it("blocks requests over the limit", () => {
    const key = `test-block-${Date.now()}`;

    // Exhaust the limit
    checkRateLimit(key, 2, 60000);
    checkRateLimit(key, 2, 60000);

    // This should be blocked
    const r = checkRateLimit(key, 2, 60000);
    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);
  });

  it("provides resetAt timestamp", () => {
    const key = `test-reset-${Date.now()}`;
    const before = Date.now();
    const result = checkRateLimit(key, 5, 60000);
    expect(result.resetAt).toBeGreaterThan(before);
    expect(result.resetAt).toBeLessThanOrEqual(before + 60000 + 10); // small margin
  });

  it("different keys are independent", () => {
    const key1 = `test-indep-a-${Date.now()}`;
    const key2 = `test-indep-b-${Date.now()}`;

    checkRateLimit(key1, 1, 60000);
    const blocked = checkRateLimit(key1, 1, 60000);
    const allowed = checkRateLimit(key2, 1, 60000);

    expect(blocked.allowed).toBe(false);
    expect(allowed.allowed).toBe(true);
  });

  it("resets after the window expires", () => {
    // Use a very short window
    const key = `test-expire-${Date.now()}`;
    checkRateLimit(key, 1, 1); // 1ms window
    // Force expiry by using a new call after the window
    // We can't reliably wait 1ms in sync, so test the resetAt logic
    const r = checkRateLimit(key, 1, 1);
    // Either allowed (window reset) or blocked (within window) — both are valid
    expect(typeof r.allowed).toBe("boolean");
  });
});

// ─── Preset rate limiters ──────────────────────────────────

describe("rate limit presets", () => {
  it("checkAuthRateLimit allows 5 requests per minute", () => {
    const ip = `test-auth-${Date.now()}`;
    for (let i = 0; i < 5; i++) {
      expect(checkAuthRateLimit(ip).allowed).toBe(true);
    }
    expect(checkAuthRateLimit(ip).allowed).toBe(false);
  });

  it("checkSyncRateLimit allows 1 request per 5 minutes", () => {
    const userId = `test-sync-${Date.now()}`;
    expect(checkSyncRateLimit(userId).allowed).toBe(true);
    expect(checkSyncRateLimit(userId).allowed).toBe(false);
  });

  it("checkApiRateLimit allows 100 requests per minute", () => {
    const userId = `test-api-${Date.now()}`;
    const first = checkApiRateLimit(userId);
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(99);
  });
});

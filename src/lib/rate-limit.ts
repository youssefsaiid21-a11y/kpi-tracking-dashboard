/**
 * Simple in-memory rate limiter.
 *
 * Tracks request counts per key (IP or userId) in sliding windows.
 * For a small team this is sufficient. For multi-instance, swap with Redis.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Lazy cleanup: purge expired entries periodically during checkRateLimit calls
// instead of using a top-level setInterval (which prevents serverless shutdown).
let lastCleanup = Date.now();
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

function cleanupExpiredEntries(): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [key, entry] of store) {
    if (now > entry.resetAt) store.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Check if a request is within rate limits.
 * @param key - Unique identifier (IP address, user ID, etc.)
 * @param maxRequests - Maximum requests allowed in the window
 * @param windowMs - Time window in milliseconds
 */
export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): RateLimitResult {
  cleanupExpiredEntries();
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    // New window
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1, resetAt: now + windowMs };
  }

  entry.count++;

  if (entry.count > maxRequests) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  return { allowed: true, remaining: maxRequests - entry.count, resetAt: entry.resetAt };
}

// ─── Presets ────────────────────────────────────────────────

/** Auth routes: 5 attempts per minute */
export function checkAuthRateLimit(ip: string): RateLimitResult {
  return checkRateLimit(`auth:${ip}`, 5, 60 * 1000);
}

/** Sync trigger: 1 per 5 minutes */
export function checkSyncRateLimit(userId: string): RateLimitResult {
  return checkRateLimit(`sync:${userId}`, 1, 5 * 60 * 1000);
}

/** General API: 100 per minute per user */
export function checkApiRateLimit(userId: string): RateLimitResult {
  return checkRateLimit(`api:${userId}`, 100, 60 * 1000);
}

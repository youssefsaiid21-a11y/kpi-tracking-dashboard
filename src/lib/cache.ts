/**
 * TTL cache with a pluggable provider interface.
 *
 * Ships with an in-memory provider (suitable for a single-instance deploy with
 * <50 users). When you're ready to scale to multiple instances, implement the
 * CacheProvider interface with Redis (see TODO below) and wire it up.
 *
 * Invalidated per-tenant on sync completion or review submission.
 */

// ---------------------------------------------------------------------------
// Provider interface — implement this to swap storage backends
// ---------------------------------------------------------------------------

export interface CacheProvider {
  get<T>(key: string): Promise<T | null> | T | null;
  set<T>(key: string, data: T, ttlSeconds: number): Promise<void> | void;
  /** Delete all keys that start with `prefix` */
  invalidatePrefix(prefix: string): Promise<void> | void;
  clear(): Promise<void> | void;
}

// ---------------------------------------------------------------------------
// In-memory provider (default)
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const MAX_CACHE_SIZE = 500;

class InMemoryCacheProvider implements CacheProvider {
  private store = new Map<string, CacheEntry<unknown>>();

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.data as T;
  }

  set<T>(key: string, data: T, ttlSeconds: number): void {
    this.evictIfNeeded();
    this.store.set(key, {
      data,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  invalidatePrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  clear(): void {
    this.store.clear();
  }

  private evictIfNeeded(): void {
    if (this.store.size <= MAX_CACHE_SIZE) return;
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
    if (this.store.size > MAX_CACHE_SIZE) {
      const excess = this.store.size - MAX_CACHE_SIZE;
      const keys = this.store.keys();
      for (let i = 0; i < excess; i++) {
        const { value } = keys.next();
        if (value) this.store.delete(value);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// TODO: Redis provider (implement when ready)
// ---------------------------------------------------------------------------
//
// To use Redis, install ioredis (`npm i ioredis`) and create a provider:
//
//   import Redis from "ioredis";
//
//   class RedisCacheProvider implements CacheProvider {
//     private client: Redis;
//
//     constructor(url: string) {
//       this.client = new Redis(url);
//     }
//
//     async get<T>(key: string): Promise<T | null> {
//       const raw = await this.client.get(key);
//       return raw ? (JSON.parse(raw) as T) : null;
//     }
//
//     async set<T>(key: string, data: T, ttlSeconds: number): Promise<void> {
//       await this.client.set(key, JSON.stringify(data), "EX", ttlSeconds);
//     }
//
//     async invalidatePrefix(prefix: string): Promise<void> {
//       const keys = await this.client.keys(`${prefix}*`);
//       if (keys.length > 0) await this.client.del(...keys);
//     }
//
//     async clear(): Promise<void> {
//       await this.client.flushdb();
//     }
//   }
//
// Then set `provider` below:
//   provider = new RedisCacheProvider(process.env.REDIS_URL!);
//

// ---------------------------------------------------------------------------
// Active provider — change this line to swap implementations
// ---------------------------------------------------------------------------

const provider: CacheProvider = new InMemoryCacheProvider();

// ---------------------------------------------------------------------------
// Public API (unchanged — all existing call-sites keep working)
// ---------------------------------------------------------------------------

export function getCached<T>(key: string): T | null {
  // Provider may return a Promise (Redis) but current callers expect sync.
  // When switching to Redis, make these async or use getOrFetch pattern.
  return provider.get<T>(key) as T | null;
}

export function setCache<T>(key: string, data: T, ttlSeconds: number): void {
  provider.set(key, data, ttlSeconds);
}

/** Invalidate all keys matching a prefix (e.g. "team:" or "rep:userId") */
export function invalidateCache(prefix: string): void {
  provider.invalidatePrefix(prefix);
}

/** Invalidate all cache entries for a specific tenant */
export function invalidateTenant(tenantId: string, slug?: string): void {
  // Tenant keys use multiple prefixes, so invalidate each pattern
  provider.invalidatePrefix(`t:${tenantId}:`);
  provider.invalidatePrefix(`tenant_secrets:${tenantId}`);
  if (slug) {
    provider.invalidatePrefix(`tenant:${slug}`);
  }
}

/** @deprecated Use invalidateTenant() instead for targeted invalidation */
export function invalidateAll(): void {
  provider.clear();
}

import { describe, it, expect, beforeEach } from "vitest";
import { getCached, setCache, invalidateCache, invalidateAll } from "./cache";

beforeEach(() => {
  invalidateAll();
});

describe("cache", () => {
  it("returns null for missing keys", () => {
    expect(getCached("nonexistent")).toBeNull();
  });

  it("stores and retrieves values", () => {
    setCache("key1", { foo: "bar" }, 60);
    expect(getCached<{ foo: string }>("key1")).toEqual({ foo: "bar" });
  });

  it("respects TTL — expired entries return null", async () => {
    // Set with very short TTL
    setCache("expired", "value", 0.001); // 1ms
    // Wait for expiry
    await new Promise((r) => setTimeout(r, 5));
    expect(getCached("expired")).toBeNull();
  });

  it("invalidates by prefix", () => {
    setCache("team:overview", "data1", 60);
    setCache("team:metrics", "data2", 60);
    setCache("rep:user1", "data3", 60);

    invalidateCache("team:");

    expect(getCached("team:overview")).toBeNull();
    expect(getCached("team:metrics")).toBeNull();
    expect(getCached("rep:user1")).toBe("data3");
  });

  it("invalidateAll clears everything", () => {
    setCache("a", 1, 60);
    setCache("b", 2, 60);
    invalidateAll();
    expect(getCached("a")).toBeNull();
    expect(getCached("b")).toBeNull();
  });

  it("overwrites existing keys", () => {
    setCache("key", "first", 60);
    setCache("key", "second", 60);
    expect(getCached("key")).toBe("second");
  });
});

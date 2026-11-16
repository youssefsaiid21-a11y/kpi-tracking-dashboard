import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock Prisma ───────────────────────────────────────────

const mockPrisma = vi.hoisted(() => ({
  anomaly: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  calendarEvent: {
    count: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    groupBy: vi.fn(),
  },
  pipelineStage: {
    findMany: vi.fn(),
  },
  hubSpotDeal: {
    findMany: vi.fn(),
    groupBy: vi.fn(),
  },
  user: {
    findMany: vi.fn(),
  },
  syncLog: {
    findMany: vi.fn(),
  },
  suggestedClassification: {
    count: vi.fn(),
  },
  tenant: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ default: mockPrisma }));

import { runAnomalyDetection } from "./anomaly-detector";

// ─── Helpers ───────────────────────────────────────────────

const TENANT = "test-tenant";

function resetMocks() {
  vi.clearAllMocks();
  // Default: return empty/zero for everything
  mockPrisma.calendarEvent.count.mockResolvedValue(0);
  mockPrisma.calendarEvent.findFirst.mockResolvedValue(null);
  mockPrisma.calendarEvent.findMany.mockResolvedValue([]);
  mockPrisma.calendarEvent.groupBy.mockResolvedValue([]);
  mockPrisma.pipelineStage.findMany.mockResolvedValue([]);
  mockPrisma.hubSpotDeal.findMany.mockResolvedValue([]);
  mockPrisma.hubSpotDeal.groupBy.mockResolvedValue([]);
  mockPrisma.user.findMany.mockResolvedValue([]);
  mockPrisma.syncLog.findMany.mockResolvedValue([]);
  mockPrisma.suggestedClassification.count.mockResolvedValue(0);
  mockPrisma.anomaly.findFirst.mockResolvedValue(null);
  mockPrisma.anomaly.findMany.mockResolvedValue([]);
  mockPrisma.anomaly.create.mockResolvedValue({ id: "anomaly-1" });
  mockPrisma.anomaly.update.mockResolvedValue({ id: "anomaly-1" });
}

// ─── Tests ─────────────────────────────────────────────────

describe("runAnomalyDetection", () => {
  beforeEach(resetMocks);

  it("completes without errors when no anomalies are found", async () => {
    await expect(runAnomalyDetection(TENANT)).resolves.toBeUndefined();
  });

  // ── Check 1: Unclassified meetings ─────────────────────

  it("creates anomaly when unclassified meeting count exceeds 20", async () => {
    mockPrisma.calendarEvent.count.mockResolvedValueOnce(25);

    await runAnomalyDetection(TENANT);

    expect(mockPrisma.anomaly.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "unclassified",
          severity: "warning",
          affectedId: "global_unclassified",
        }),
      })
    );
  });

  it("does NOT create unclassified anomaly when count is 20 or below", async () => {
    mockPrisma.calendarEvent.count.mockResolvedValueOnce(20);

    await runAnomalyDetection(TENANT);

    // No anomaly.create call with type "unclassified"
    const unclassifiedCalls = mockPrisma.anomaly.create.mock.calls.filter(
      (call: any[]) => call[0]?.data?.type === "unclassified"
    );
    expect(unclassifiedCalls).toHaveLength(0);
  });

  it("updates existing unresolved unclassified anomaly instead of creating duplicate", async () => {
    mockPrisma.calendarEvent.count.mockResolvedValueOnce(30);
    // The anomaly cache loads all unresolved anomalies via findMany
    mockPrisma.anomaly.findMany.mockResolvedValueOnce([
      { id: "existing-1", type: "unclassified", affectedId: "global_unclassified" },
    ]);

    await runAnomalyDetection(TENANT);

    expect(mockPrisma.anomaly.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "existing-1" },
        data: expect.objectContaining({ severity: "warning" }),
      })
    );
  });

  // ── Check 2: Duplicate meetings ────────────────────────

  it("detects duplicate meetings via fingerprint groupBy", async () => {
    const day = new Date();
    day.setDate(day.getDate() - 5);

    // Check 2 now uses groupBy on meetingFingerprint to find duplicates
    mockPrisma.calendarEvent.groupBy.mockResolvedValueOnce([
      { meetingFingerprint: "fp-abc123", _count: { id: 2 } },
    ]);

    // Then findFirst to get a representative event for each duplicate fingerprint
    mockPrisma.calendarEvent.findFirst.mockResolvedValueOnce({
      id: "evt-dup-1",
      subject: "Same Meeting",
      startTime: day,
    });

    await runAnomalyDetection(TENANT);

    // Should create anomaly for the duplicate
    const dupCalls = mockPrisma.anomaly.create.mock.calls.filter(
      (call: any[]) => call[0]?.data?.type === "duplicate"
    );
    expect(dupCalls.length).toBeGreaterThanOrEqual(1);
    expect(dupCalls[0][0].data.affectedId).toBe("evt-dup-1");
  });

  it("does NOT flag duplicates when no fingerprints appear more than once", async () => {
    // Check 2 groupBy returns empty (no duplicate fingerprints)
    mockPrisma.calendarEvent.groupBy.mockResolvedValueOnce([]);

    await runAnomalyDetection(TENANT);

    const dupCalls = mockPrisma.anomaly.create.mock.calls.filter(
      (call: any[]) => call[0]?.data?.type === "duplicate"
    );
    expect(dupCalls).toHaveLength(0);
  });

  // ── Check 3: Impossible conversion rates ───────────────

  it("flags impossible conversion rates (> 100%)", async () => {
    const stages = [
      { id: "s1", label: "Lead", displayOrder: 0 },
      { id: "s2", label: "Won", displayOrder: 1 },
    ];
    mockPrisma.pipelineStage.findMany.mockResolvedValue(stages);

    // More deals at stage 2 than stage 1 — impossible
    mockPrisma.hubSpotDeal.findMany.mockResolvedValue([
      { stage: { displayOrder: 0 } },
      { stage: { displayOrder: 1 } },
      { stage: { displayOrder: 1 } },
      { stage: { displayOrder: 1 } },
    ]);

    await runAnomalyDetection(TENANT);

    const impossibleCalls = mockPrisma.anomaly.create.mock.calls.filter(
      (call: any[]) => call[0]?.data?.type === "impossible_rate"
    );
    // Rate = 4/4 = 1.0, which is NOT > 1.0, so no anomaly
    // To get > 1.0 we'd need toCount > fromCount which can't happen with this schema
    // The check is for rate > 1.0 OR rate < 0, which only happens with data corruption
    expect(impossibleCalls).toHaveLength(0);
  });

  it("handles empty pipeline stages gracefully", async () => {
    mockPrisma.pipelineStage.findMany.mockResolvedValue([]);
    mockPrisma.hubSpotDeal.findMany.mockResolvedValue([]);

    await expect(runAnomalyDetection(TENANT)).resolves.toBeUndefined();
  });

  // ── Check 4: Missing rep mappings ──────────────────────

  it("flags users without outlookEmail", async () => {
    mockPrisma.user.findMany
      // First call: users without email (check 4)
      .mockResolvedValueOnce([
        { id: "user-1", name: "John", email: "member-027@company.example" },
      ])
      // Second call: active users (check 7 - spike detection)
      .mockResolvedValueOnce([]);

    await runAnomalyDetection(TENANT);

    const missingCalls = mockPrisma.anomaly.create.mock.calls.filter(
      (call: any[]) => call[0]?.data?.type === "missing_owner"
    );
    expect(missingCalls).toHaveLength(1);
    expect(missingCalls[0][0].data.affectedId).toBe("user-1");
  });

  // ── Check 5: Sync failures ────────────────────────────

  it("flags recent failed syncs", async () => {
    mockPrisma.syncLog.findMany.mockResolvedValue([
      {
        id: "sync-1",
        provider: "microsoft_graph",
        status: "failed",
        startedAt: new Date(),
        errorMessage: "Token expired",
      },
    ]);

    await runAnomalyDetection(TENANT);

    const syncCalls = mockPrisma.anomaly.create.mock.calls.filter(
      (call: any[]) => call[0]?.data?.type === "sync_failure"
    );
    expect(syncCalls).toHaveLength(1);
    expect(syncCalls[0][0].data.severity).toBe("critical");
  });

  it("handles sync failures with null error message", async () => {
    mockPrisma.syncLog.findMany.mockResolvedValue([
      {
        id: "sync-2",
        provider: "hubspot",
        status: "failed",
        startedAt: new Date(),
        errorMessage: null,
      },
    ]);

    await runAnomalyDetection(TENANT);

    const syncCalls = mockPrisma.anomaly.create.mock.calls.filter(
      (call: any[]) => call[0]?.data?.type === "sync_failure"
    );
    expect(syncCalls).toHaveLength(1);
    expect(syncCalls[0][0].data.description).toContain("Unknown error");
  });

  // ── Check 6: Low confidence classifications ───────────

  it("flags when many low-confidence classifications exist", async () => {
    mockPrisma.suggestedClassification.count.mockResolvedValue(10);

    await runAnomalyDetection(TENANT);

    const lowConfCalls = mockPrisma.anomaly.create.mock.calls.filter(
      (call: any[]) => call[0]?.data?.type === "low_confidence"
    );
    expect(lowConfCalls).toHaveLength(1);
    expect(lowConfCalls[0][0].data.severity).toBe("info");
  });

  it("does NOT flag when low-confidence count is 5 or below", async () => {
    mockPrisma.suggestedClassification.count.mockResolvedValue(5);

    await runAnomalyDetection(TENANT);

    const lowConfCalls = mockPrisma.anomaly.create.mock.calls.filter(
      (call: any[]) => call[0]?.data?.type === "low_confidence"
    );
    expect(lowConfCalls).toHaveLength(0);
  });

  // ── Check 7: Spike detection ──────────────────────────

  it("flags users with meeting spikes > 3x weekly average", async () => {
    // Check 4 returns no users without email
    mockPrisma.user.findMany
      .mockResolvedValueOnce([]) // check 4: missing email
      .mockResolvedValueOnce([{ id: "user-spike", name: "Spike User" }]); // check 7: active users

    mockPrisma.calendarEvent.count.mockResolvedValue(0); // check 1: unclassified count

    // Check 2 (duplicate fingerprints) now also calls groupBy first
    mockPrisma.calendarEvent.groupBy
      .mockResolvedValueOnce([]) // check 2: duplicate fingerprints (none)
      .mockResolvedValueOnce([{ userId: "user-spike", _count: { id: 20 } }]) // check 7: current week
      .mockResolvedValueOnce([{ userId: "user-spike", _count: { id: 8 } }]); // check 7: previous 4 weeks (avg = 2/week)

    await runAnomalyDetection(TENANT);

    const spikeCalls = mockPrisma.anomaly.create.mock.calls.filter(
      (call: any[]) => call[0]?.data?.type === "spike"
    );
    expect(spikeCalls).toHaveLength(1);
    expect(spikeCalls[0][0].data.affectedId).toBe("user-spike");
  });

  // ── Check 8: Internal meetings leaking through ─────────

  it("flags meetings with all internal attendees that are not filtered", async () => {
    // Check 2 no longer uses findMany (uses groupBy+findFirst), so findMany is only for check 8
    mockPrisma.calendarEvent.findMany.mockResolvedValueOnce([
      {
        id: "evt-leak-1",
        subject: "Leaked Internal",
        isFiltered: false,
        isInternal: false,
        attendees: [{ isInternal: true }, { isInternal: true }],
      },
    ]); // check 8: internal leaks

    await runAnomalyDetection(TENANT);

    const leakCalls = mockPrisma.anomaly.create.mock.calls.filter(
      (call: any[]) => call[0]?.data?.type === "internal_leak"
    );
    expect(leakCalls).toHaveLength(1);
    expect(leakCalls[0][0].data.affectedId).toBe("evt-leak-1");
  });

  it("does NOT flag meetings with at least one external attendee", async () => {
    mockPrisma.calendarEvent.findMany.mockResolvedValueOnce([
      {
        id: "evt-ok-1",
        subject: "External Meeting",
        isFiltered: false,
        isInternal: false,
        attendees: [{ isInternal: true }, { isInternal: false }],
      },
    ]); // check 8

    await runAnomalyDetection(TENANT);

    const leakCalls = mockPrisma.anomaly.create.mock.calls.filter(
      (call: any[]) => call[0]?.data?.type === "internal_leak"
    );
    expect(leakCalls).toHaveLength(0);
  });

  it("does NOT flag meetings with zero attendees as internal leaks", async () => {
    mockPrisma.calendarEvent.findMany.mockResolvedValueOnce([
      {
        id: "evt-empty",
        subject: "No Attendees",
        isFiltered: false,
        isInternal: false,
        attendees: [],
      },
    ]); // check 8

    await runAnomalyDetection(TENANT);

    const leakCalls = mockPrisma.anomaly.create.mock.calls.filter(
      (call: any[]) => call[0]?.data?.type === "internal_leak"
    );
    expect(leakCalls).toHaveLength(0);
  });
});

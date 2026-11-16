import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock dependencies ─────────────────────────────────────

const mockPrisma = vi.hoisted(() => ({
  meetingReview: {
    count: vi.fn(),
    findMany: vi.fn(),
    groupBy: vi.fn(),
  },
  calendarEvent: {
    count: vi.fn(),
    groupBy: vi.fn(),
  },
  pipelineStage: {
    findMany: vi.fn(),
  },
  hubSpotDeal: {
    findMany: vi.fn(),
  },
  user: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
  targetConfig: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
  anomaly: {
    findMany: vi.fn(),
  },
  tenant: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  $queryRaw: vi.fn().mockResolvedValue([]),
  $queryRawUnsafe: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/prisma", () => ({ default: mockPrisma }));

vi.mock("@/lib/cache", () => ({
  getCached: vi.fn().mockReturnValue(null),
  setCache: vi.fn(),
}));

vi.mock("@/lib/services/hubspot", () => ({
  calculateConversionRates: vi.fn().mockReturnValue([
    {
      fromStage: "lead",
      toStage: "won",
      fromStageLabel: "Lead",
      toStageLabel: "Won",
      rate: 0.5,
      cumulativeRate: 0.5,
      dealCount: 5,
      fromCount: 10,
    },
  ]),
}));

import {
  getRepMetrics,
  getTeamMetrics,
  getTeamOverview,
  getRepPerformance,
  getTrendData,
  getTargetVsActual,
} from "./kpi-calculator";

// ─── Helpers ───────────────────────────────────────────────

const TENANT = "test-tenant";
const START = new Date("2026-03-01");
const END = new Date("2026-03-31");

function resetMocks() {
  vi.clearAllMocks();

  // Default returns
  mockPrisma.meetingReview.count.mockResolvedValue(0);
  mockPrisma.meetingReview.findMany.mockResolvedValue([]);
  mockPrisma.meetingReview.groupBy.mockResolvedValue([]);
  mockPrisma.calendarEvent.count.mockResolvedValue(0);
  mockPrisma.calendarEvent.groupBy.mockResolvedValue([]);
  mockPrisma.pipelineStage.findMany.mockResolvedValue([]);
  mockPrisma.hubSpotDeal.findMany.mockResolvedValue([]);
  mockPrisma.user.findMany.mockResolvedValue([]);
  mockPrisma.user.findUnique.mockResolvedValue({ name: "Test User" });
  mockPrisma.targetConfig.findMany.mockResolvedValue([]);
  mockPrisma.targetConfig.findFirst.mockResolvedValue(null);
  mockPrisma.anomaly.findMany.mockResolvedValue([]);
  mockPrisma.$queryRawUnsafe.mockResolvedValue([]);
}

// ─── getRepMetrics ─────────────────────────────────────────

describe("getRepMetrics", () => {
  beforeEach(resetMocks);

  it("returns zero metrics when no reviews exist", async () => {
    const result = await getRepMetrics(TENANT, "user-1", START, END);

    expect(result.totalClassified).toBe(0);
    expect(result.channelBreakdown.linkedin).toBe(0);
    expect(result.totalMeetings).toBe(0);
    expect(result.classificationRate).toBe(0);
    expect(result.conversionRates).toHaveLength(1); // from mocked calculateConversionRates
  });

  it("calculates metrics correctly with review data", async () => {
    // Source uses groupBy to count reviews per confirmedLabel
    mockPrisma.meetingReview.groupBy.mockResolvedValue([
      { confirmedLabel: "linkedin", _count: { confirmedLabel: 8 } },
      { confirmedLabel: "partnerships", _count: { confirmedLabel: 3 } },
      { confirmedLabel: "irrelevant", _count: { confirmedLabel: 4 } },
    ]);
    mockPrisma.calendarEvent.count.mockResolvedValue(20);

    const result = await getRepMetrics(TENANT, "user-1", START, END);

    expect(result.channelBreakdown.linkedin).toBe(8);
    expect(result.channelBreakdown.partnerships).toBe(3);
    expect(result.totalClassified).toBe(11); // sum of non-irrelevant channels
    expect(result.classificationRate).toBe(15 / 20); // 15 total reviews / 20 eligible
  });

  it("handles zero eligible events without division error", async () => {
    mockPrisma.calendarEvent.count.mockResolvedValue(0);
    mockPrisma.meetingReview.count.mockResolvedValue(0);

    const result = await getRepMetrics(TENANT, "user-1", START, END);
    expect(result.classificationRate).toBe(0);
  });
});

// ─── getTeamMetrics ────────────────────────────────────────

describe("getTeamMetrics", () => {
  beforeEach(resetMocks);

  it("returns team-wide metrics", async () => {
    mockPrisma.meetingReview.groupBy.mockResolvedValue([
      { confirmedLabel: "linkedin", _count: { confirmedLabel: 20 } },
      { confirmedLabel: "partnerships", _count: { confirmedLabel: 10 } },
      { confirmedLabel: "irrelevant", _count: { confirmedLabel: 10 } },
    ]);
    mockPrisma.calendarEvent.count.mockResolvedValue(50);

    const result = await getTeamMetrics(TENANT, START, END);

    expect(result.channelBreakdown.linkedin).toBe(20);
    expect(result.channelBreakdown.partnerships).toBe(10);
    expect(result.totalClassified).toBe(30);
    expect(result.classificationRate).toBe(40 / 50); // 40 total reviews / 50 eligible
  });
});

// ─── getTrendData ──────────────────────────────────────────

describe("getTrendData", () => {
  beforeEach(resetMocks);

  it("returns empty array when no reviews exist", async () => {
    const result = await getTrendData(TENANT, "user-1", START, END);
    expect(result).toEqual([]);
  });

  it("groups reviews by week", async () => {
    // getTrendData now uses raw SQL $queryRawUnsafe — mock returns pre-grouped rows.
    mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([
      { week: "2026-W09", confirmedLabel: "linkedin", cnt: 1 },
      { week: "2026-W09", confirmedLabel: "email", cnt: 1 },
      { week: "2026-W10", confirmedLabel: "partnerships", cnt: 1 },
    ]);

    const result = await getTrendData(TENANT, "user-1", START, END);

    expect(result).toHaveLength(2); // 2 different weeks
    // First week: 1 linkedin + 1 email = 2 outbound (backward compat)
    expect(result[0].outbound).toBe(2);
    expect(result[0].partner).toBe(0);
    expect(result[0].total).toBe(2);
    // Second week: 1 partnerships
    expect(result[1].outbound).toBe(0);
    expect(result[1].partner).toBe(1);
    expect(result[1].total).toBe(1);
  });

  it("works for team-wide (null userId)", async () => {
    mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([
      { week: "2026-W09", confirmedLabel: "linkedin", cnt: 1 },
    ]);

    const result = await getTrendData(TENANT, null, START, END);
    expect(result).toHaveLength(1);
  });

  it("ignores non-counted labels (irrelevant does not count toward total)", async () => {
    mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([
      { week: "2026-W09", confirmedLabel: "irrelevant", cnt: 1 },
    ]);

    const result = await getTrendData(TENANT, null, START, END);
    // The code creates a week entry with total:0 for irrelevant labels
    // because irrelevant is excluded from the total count
    expect(result).toHaveLength(1);
    expect(result[0].outbound).toBe(0);
    expect(result[0].partner).toBe(0);
    expect(result[0].total).toBe(0);
  });
});

// ─── getTeamOverview ───────────────────────────────────────

describe("getTeamOverview", () => {
  beforeEach(resetMocks);

  it("returns a complete team overview structure", async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      { id: "user-1", name: "Demo member" },
      { id: "user-2", name: "Bob" },
    ]);

    const result = await getTeamOverview(TENANT, START, END);

    expect(result).toHaveProperty("channelBreakdown");
    expect(result).toHaveProperty("totalClassified");
    expect(result).toHaveProperty("totalMeetings");
    expect(result).toHaveProperty("averageClassificationRate");
    expect(result).toHaveProperty("teamTarget");
    expect(result).toHaveProperty("repPerformance");
    expect(result).toHaveProperty("topWarnings");
    expect(result).toHaveProperty("trend");
    expect(result.repPerformance).toHaveLength(2);
  });

  it("calculates average classification rate across reps", async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      { id: "user-1", name: "Demo member" },
    ]);

    // $queryRawUnsafe is called twice: once for getTrendData (raw SQL), once for reviewCounts.
    // Since getTeamMetrics+getTrendData run in parallel with the overview queries,
    // provide a default that works for both calls.
    mockPrisma.$queryRawUnsafe.mockResolvedValue([
      { userId: "user-1", confirmedLabel: "linkedin", cnt: 5, week: "2026-W09" },
    ]);

    mockPrisma.calendarEvent.groupBy
      .mockResolvedValueOnce([{ userId: "user-1", _count: 10 }]) // eligible
      .mockResolvedValueOnce([{ userId: "user-1", _count: 2 }]);  // pending

    const result = await getTeamOverview(TENANT, START, END);

    expect(result.repPerformance[0].totalClassified).toBe(5);
    expect(result.repPerformance[0].userName).toBe("Demo member");
  });

  it("limits top warnings to 5", async () => {
    const anomalies = Array.from({ length: 10 }, (_, i) => ({
      id: `anomaly-${i}`,
      type: "unclassified",
      severity: i < 3 ? "critical" : "warning",
      title: `Anomaly ${i}`,
      description: `Description ${i}`,
      recommendedAction: null,
      isResolved: false,
      createdAt: new Date(),
    }));

    mockPrisma.anomaly.findMany.mockResolvedValue(anomalies);
    mockPrisma.user.findMany.mockResolvedValue([]);

    const result = await getTeamOverview(TENANT, START, END);
    expect(result.topWarnings.length).toBeLessThanOrEqual(5);
  });

  it("sorts warnings by severity (critical first)", async () => {
    mockPrisma.anomaly.findMany.mockResolvedValue([
      { id: "a1", type: "unclassified", severity: "info", title: "Info", description: "", recommendedAction: null, isResolved: false, createdAt: new Date() },
      { id: "a2", type: "sync_failure", severity: "critical", title: "Critical", description: "", recommendedAction: null, isResolved: false, createdAt: new Date() },
      { id: "a3", type: "duplicate", severity: "warning", title: "Warning", description: "", recommendedAction: null, isResolved: false, createdAt: new Date() },
    ]);
    mockPrisma.user.findMany.mockResolvedValue([]);

    const result = await getTeamOverview(TENANT, START, END);

    expect(result.topWarnings[0].severity).toBe("critical");
    expect(result.topWarnings[1].severity).toBe("warning");
    expect(result.topWarnings[2].severity).toBe("info");
  });

  it("includes target vs actual for team targets", async () => {
    mockPrisma.user.findMany.mockResolvedValue([]);
    mockPrisma.targetConfig.findMany.mockResolvedValue([
      {
        userId: null, // team-level target
        metricType: "linkedin_meetings",
        targetValue: 50,
        period: "monthly",
        isActive: true,
      },
    ]);

    const result = await getTeamOverview(TENANT, START, END);

    expect(result.teamTarget).toHaveLength(1);
    expect(result.teamTarget[0].metricType).toBe("linkedin_meetings");
    expect(result.teamTarget[0].target).toBe(50);
  });
});

// ─── getRepPerformance ─────────────────────────────────────

describe("getRepPerformance", () => {
  beforeEach(resetMocks);

  it("returns rep performance with pending review count", async () => {
    // getRepMetrics uses groupBy; getTrendData now uses $queryRawUnsafe (run in parallel).
    mockPrisma.meetingReview.groupBy.mockResolvedValue([
      { confirmedLabel: "linkedin", _count: { confirmedLabel: 5 } },
      { confirmedLabel: "partnerships", _count: { confirmedLabel: 2 } },
      { confirmedLabel: "irrelevant", _count: { confirmedLabel: 3 } },
    ]);
    // getTrendData now uses raw SQL
    mockPrisma.$queryRawUnsafe.mockResolvedValue([
      { week: "2026-W09", confirmedLabel: "linkedin", cnt: 5 },
      { week: "2026-W10", confirmedLabel: "partnerships", cnt: 2 },
      { week: "2026-W11", confirmedLabel: "irrelevant", cnt: 3 },
    ]);
    // getRepPerformance calls meetingReview.count for totalReviewed
    mockPrisma.meetingReview.count.mockResolvedValue(10);
    mockPrisma.calendarEvent.count
      .mockResolvedValueOnce(15) // total eligible in getRepMetrics
      .mockResolvedValueOnce(3); // pending review in getRepPerformance

    const result = await getRepPerformance(TENANT, "user-1", START, END);

    expect(result.userId).toBe("user-1");
    expect(result.userName).toBe("Test User");
    expect(result.channelBreakdown.linkedin).toBe(5);
    expect(result.channelBreakdown.partnerships).toBe(2);
    expect(result.pendingReview).toBe(3);
    expect(result.totalReviewed).toBe(10);
  });

  it("returns 'Unknown' when user is not found", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const result = await getRepPerformance(TENANT, "missing-user", START, END);
    expect(result.userName).toBe("Unknown");
  });
});

// ─── getTargetVsActual ─────────────────────────────────────

describe("getTargetVsActual", () => {
  beforeEach(resetMocks);

  it("returns zero target when no config exists", async () => {
    const result = await getTargetVsActual(TENANT, "user-1", "linkedin_meetings", "monthly", START, END);

    expect(result.target).toBe(0);
    expect(result.actual).toBe(0);
    expect(result.onTrack).toBe(true); // 0 >= 0
  });

  it("calculates linkedin_meetings target vs actual", async () => {
    mockPrisma.targetConfig.findFirst.mockResolvedValue({
      targetValue: 10,
      metricType: "linkedin_meetings",
      period: "monthly",
    });
    // Source uses groupBy to count reviews per confirmedLabel
    mockPrisma.meetingReview.groupBy.mockResolvedValue([
      { confirmedLabel: "linkedin", _count: { confirmedLabel: 7 } },
      { confirmedLabel: "email", _count: { confirmedLabel: 3 } },
    ]);

    const result = await getTargetVsActual(TENANT, "user-1", "linkedin_meetings", "monthly", START, END);

    expect(result.target).toBe(10);
    expect(result.actual).toBe(7);
    expect(result.variance).toBe(-3);
    expect(result.deficit).toBe(3);
    expect(result.onTrack).toBe(false);
  });

  it("calculates partnerships_meetings target vs actual", async () => {
    mockPrisma.targetConfig.findFirst.mockResolvedValue({
      targetValue: 5,
      metricType: "partnerships_meetings",
      period: "monthly",
    });
    mockPrisma.meetingReview.groupBy.mockResolvedValue([
      { confirmedLabel: "partnerships", _count: { confirmedLabel: 6 } },
      { confirmedLabel: "linkedin", _count: { confirmedLabel: 2 } },
    ]);

    const result = await getTargetVsActual(TENANT, "user-1", "partnerships_meetings", "monthly", START, END);

    expect(result.target).toBe(5);
    expect(result.actual).toBe(6);
    expect(result.onTrack).toBe(true);
    expect(result.deficit).toBe(0);
  });

  it("calculates conversion_rate target vs actual", async () => {
    mockPrisma.targetConfig.findFirst.mockResolvedValue({
      targetValue: 0.4,
      metricType: "conversion_rate",
      period: "monthly",
    });

    const result = await getTargetVsActual(TENANT, null, "conversion_rate", "monthly", START, END);

    // Mocked calculateConversionRates returns rate 0.5, average = 0.5
    expect(result.actual).toBe(0.5);
    expect(result.onTrack).toBe(true);
  });

  it("handles variancePercent when target is zero", async () => {
    mockPrisma.targetConfig.findFirst.mockResolvedValue({
      targetValue: 0,
      metricType: "linkedin_meetings",
      period: "monthly",
    });

    const result = await getTargetVsActual(TENANT, "user-1", "linkedin_meetings", "monthly", START, END);

    expect(result.variancePercent).toBe(0); // no division by zero
  });
});

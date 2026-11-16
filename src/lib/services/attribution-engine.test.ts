import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock Prisma ───────────────────────────────────────────

const mockPrisma = vi.hoisted(() => ({
  calendarEvent: {
    findMany: vi.fn(),
  },
  hubSpotDeal: {
    findMany: vi.fn(),
  },
  meetingDealAttribution: {
    create: vi.fn(),
    createMany: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
  },
  meetingReview: {
    count: vi.fn(),
  },
  tenant: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ default: mockPrisma }));

import { runAttribution, getAttributionStats } from "./attribution-engine";

// ─── Helpers ───────────────────────────────────────────────

const TENANT = "test-tenant";

function resetMocks() {
  vi.clearAllMocks();
  mockPrisma.calendarEvent.findMany.mockResolvedValue([]);
  mockPrisma.hubSpotDeal.findMany.mockResolvedValue([]);
  mockPrisma.meetingDealAttribution.create.mockResolvedValue({ id: "attr-1" });
  mockPrisma.meetingDealAttribution.createMany.mockResolvedValue({ count: 0 });
  mockPrisma.meetingDealAttribution.findMany.mockResolvedValue([]);
  mockPrisma.meetingDealAttribution.count.mockResolvedValue(0);
  mockPrisma.meetingDealAttribution.groupBy.mockResolvedValue([]);
  mockPrisma.meetingReview.count.mockResolvedValue(0);
}

// ─── runAttribution ────────────────────────────────────────

describe("runAttribution", () => {
  beforeEach(resetMocks);

  it("returns zero counts when no reviewed meetings exist", async () => {
    const result = await runAttribution(TENANT);
    expect(result).toEqual({ created: 0, skipped: 0 });
  });

  it("returns zero counts when meetings exist but no deals", async () => {
    mockPrisma.calendarEvent.findMany.mockResolvedValue([
      {
        id: "evt-1",
        startTime: new Date(),
        attendees: [{ email: "member-009@organization-001.example" }],
      },
    ]);
    mockPrisma.hubSpotDeal.findMany.mockResolvedValue([]);

    const result = await runAttribution(TENANT);
    expect(result).toEqual({ created: 0, skipped: 0 });
  });

  it("creates attribution via attendee email match (method 1)", async () => {
    mockPrisma.calendarEvent.findMany.mockResolvedValue([
      {
        id: "evt-1",
        startTime: new Date("2026-03-10"),
        attendees: [{ email: "member-053@organization-001.example" }],
      },
    ]);

    mockPrisma.hubSpotDeal.findMany.mockResolvedValue([
      {
        id: "deal-1",
        contactEmail: "member-053@organization-001.example",
        companyDomain: "organization-001.example",
        createDate: new Date("2026-03-08"),
      },
    ]);

    mockPrisma.meetingDealAttribution.createMany.mockResolvedValue({ count: 1 });

    const result = await runAttribution(TENANT);

    expect(result.created).toBe(1);
    expect(mockPrisma.meetingDealAttribution.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          eventId: "evt-1",
          dealId: "deal-1",
          attributionType: "attendee_match",
          confidence: 0.9,
        }),
      ]),
    });
  });

  it("creates attribution via domain proximity (method 2) when no email match", async () => {
    const meetingDate = new Date("2026-03-10");
    const dealDate = new Date("2026-03-05"); // 5 days apart < 14 day threshold

    mockPrisma.calendarEvent.findMany.mockResolvedValue([
      {
        id: "evt-2",
        startTime: meetingDate,
        attendees: [{ email: "member-064@organization-001.example" }],
      },
    ]);

    mockPrisma.hubSpotDeal.findMany.mockResolvedValue([
      {
        id: "deal-2",
        contactEmail: "member-038@organization-001.example", // different contact
        companyDomain: "organization-001.example",
        createDate: dealDate,
      },
    ]);

    mockPrisma.meetingDealAttribution.createMany.mockResolvedValue({ count: 1 });

    const result = await runAttribution(TENANT);

    expect(result.created).toBe(1);
    expect(mockPrisma.meetingDealAttribution.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          attributionType: "domain_proximity",
          confidence: 0.6,
        }),
      ]),
    });
  });

  it("does NOT create domain proximity attribution when deal is > 14 days away", async () => {
    mockPrisma.calendarEvent.findMany.mockResolvedValue([
      {
        id: "evt-3",
        startTime: new Date("2026-03-01"),
        attendees: [{ email: "member-064@organization-001.example" }],
      },
    ]);

    mockPrisma.hubSpotDeal.findMany.mockResolvedValue([
      {
        id: "deal-3",
        contactEmail: "member-038@organization-001.example",
        companyDomain: "organization-001.example",
        createDate: new Date("2026-04-01"), // 31 days away
      },
    ]);

    const result = await runAttribution(TENANT);
    expect(result.created).toBe(0);
  });

  it("prefers attendee match over domain proximity", async () => {
    mockPrisma.calendarEvent.findMany.mockResolvedValue([
      {
        id: "evt-4",
        startTime: new Date("2026-03-10"),
        attendees: [{ email: "member-053@organization-001.example" }],
      },
    ]);

    mockPrisma.hubSpotDeal.findMany.mockResolvedValue([
      {
        id: "deal-4",
        contactEmail: "member-053@organization-001.example",
        companyDomain: "organization-001.example",
        createDate: new Date("2026-03-09"),
      },
    ]);

    mockPrisma.meetingDealAttribution.createMany.mockResolvedValue({ count: 1 });

    await runAttribution(TENANT);

    // Batch should only contain attendee_match, not domain_proximity
    const createManyCalls = mockPrisma.meetingDealAttribution.createMany.mock.calls;
    expect(createManyCalls).toHaveLength(1);
    const batchData = createManyCalls[0][0].data;
    expect(batchData).toHaveLength(1);
    expect(batchData[0].attributionType).toBe("attendee_match");
  });

  it("handles case-insensitive email matching", async () => {
    mockPrisma.calendarEvent.findMany.mockResolvedValue([
      {
        id: "evt-5",
        startTime: new Date("2026-03-10"),
        attendees: [{ email: "MEMBER-053@ORGANIZATION-001.EXAMPLE" }],
      },
    ]);

    mockPrisma.hubSpotDeal.findMany.mockResolvedValue([
      {
        id: "deal-5",
        contactEmail: "member-053@organization-001.example",
        companyDomain: null,
        createDate: new Date("2026-03-09"),
      },
    ]);

    mockPrisma.meetingDealAttribution.createMany.mockResolvedValue({ count: 1 });

    const result = await runAttribution(TENANT);
    expect(result.created).toBe(1);
  });

  it("counts skipped when existing attributions are found", async () => {
    mockPrisma.calendarEvent.findMany.mockResolvedValue([
      {
        id: "evt-6",
        startTime: new Date("2026-03-10"),
        attendees: [{ email: "member-053@organization-001.example" }],
      },
    ]);

    mockPrisma.hubSpotDeal.findMany.mockResolvedValue([
      {
        id: "deal-6",
        contactEmail: "member-053@organization-001.example",
        companyDomain: null,
        createDate: new Date("2026-03-09"),
      },
    ]);

    // Simulate already-existing attribution
    mockPrisma.meetingDealAttribution.findMany.mockResolvedValue([
      { eventId: "evt-6", dealId: "deal-6" },
    ]);

    const result = await runAttribution(TENANT);
    expect(result.skipped).toBe(1);
  });

  it("handles multiple attendees from different domains", async () => {
    mockPrisma.calendarEvent.findMany.mockResolvedValue([
      {
        id: "evt-7",
        startTime: new Date("2026-03-10"),
        attendees: [
          { email: "member-003@organization-001.example" },
          { email: "member-008@organization-020.example" },
        ],
      },
    ]);

    mockPrisma.hubSpotDeal.findMany.mockResolvedValue([
      {
        id: "deal-7",
        contactEmail: "member-003@organization-001.example",
        companyDomain: null,
        createDate: new Date("2026-03-09"),
      },
    ]);

    mockPrisma.meetingDealAttribution.createMany.mockResolvedValue({ count: 1 });

    const result = await runAttribution(TENANT);
    expect(result.created).toBe(1);
  });

  it("handles deals without createDate for domain proximity", async () => {
    mockPrisma.calendarEvent.findMany.mockResolvedValue([
      {
        id: "evt-8",
        startTime: new Date("2026-03-10"),
        attendees: [{ email: "member-064@organization-001.example" }],
      },
    ]);

    mockPrisma.hubSpotDeal.findMany.mockResolvedValue([
      {
        id: "deal-8",
        contactEmail: null,
        companyDomain: "organization-001.example",
        createDate: null, // no create date
      },
    ]);

    const result = await runAttribution(TENANT);
    expect(result.created).toBe(0); // skips because createDate is null
  });
});

// ─── getAttributionStats ───────────────────────────────────

describe("getAttributionStats", () => {
  beforeEach(resetMocks);

  it("returns zero stats when no data", async () => {
    const stats = await getAttributionStats(TENANT, new Date("2026-01-01"), new Date("2026-03-31"));

    expect(stats.totalClassifiedMeetings).toBe(0);
    expect(stats.totalAttributedMeetings).toBe(0);
    expect(stats.meetingToDealRate).toBe(0);
    expect(stats.byType).toEqual([]);
  });

  it("calculates meeting-to-deal rate correctly", async () => {
    mockPrisma.meetingReview.count.mockResolvedValue(20);
    mockPrisma.meetingDealAttribution.count.mockResolvedValue(8);
    mockPrisma.meetingDealAttribution.groupBy.mockResolvedValue([
      { attributionType: "attendee_match", _count: 5, _avg: { confidence: 0.9 } },
      { attributionType: "domain_proximity", _count: 3, _avg: { confidence: 0.6 } },
    ]);

    const stats = await getAttributionStats(TENANT, new Date("2026-01-01"), new Date("2026-03-31"));

    expect(stats.totalClassifiedMeetings).toBe(20);
    expect(stats.totalAttributedMeetings).toBe(8);
    expect(stats.meetingToDealRate).toBe(0.4);
    expect(stats.byType).toHaveLength(2);
    expect(stats.byType[0].type).toBe("attendee_match");
    expect(stats.byType[0].count).toBe(5);
    expect(stats.byType[0].avgConfidence).toBe(0.9);
  });

  it("rounds meeting-to-deal rate to 4 decimal places", async () => {
    mockPrisma.meetingReview.count.mockResolvedValue(3);
    mockPrisma.meetingDealAttribution.count.mockResolvedValue(1);

    const stats = await getAttributionStats(TENANT, new Date("2026-01-01"), new Date("2026-03-31"));

    // 1/3 = 0.3333... should be rounded to 0.3333
    expect(stats.meetingToDealRate).toBe(0.3333);
  });

  it("handles null avg confidence", async () => {
    mockPrisma.meetingReview.count.mockResolvedValue(5);
    mockPrisma.meetingDealAttribution.count.mockResolvedValue(2);
    mockPrisma.meetingDealAttribution.groupBy.mockResolvedValue([
      { attributionType: "manual", _count: 2, _avg: { confidence: null } },
    ]);

    const stats = await getAttributionStats(TENANT, new Date("2026-01-01"), new Date("2026-03-31"));

    expect(stats.byType[0].avgConfidence).toBe(0);
  });
});

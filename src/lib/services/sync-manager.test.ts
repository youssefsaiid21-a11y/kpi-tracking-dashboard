import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock all dependencies ─────────────────────────────────

const mockPrisma = vi.hoisted(() => ({
  user: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
  syncLog: {
    create: vi.fn(),
    update: vi.fn(),
    findFirst: vi.fn(),
    count: vi.fn(),
  },
  calendarEvent: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  eventAttendee: {
    findMany: vi.fn(),
    upsert: vi.fn(),
  },
  suggestedClassification: {
    upsert: vi.fn(),
  },
  partnerEntity: {
    findMany: vi.fn(),
  },
  integrationConfig: {
    upsert: vi.fn(),
  },
  pipelineDefinition: {
    upsert: vi.fn(),
    findUnique: vi.fn(),
  },
  pipelineStage: {
    upsert: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  hubSpotDeal: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  tenant: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
}));

const mockGraphFns = vi.hoisted(() => ({
  fetchCalendarEvents: vi.fn().mockResolvedValue([]),
  getUserDelegatedToken: vi.fn().mockResolvedValue(null),
  sendTeamsMessage: vi.fn().mockResolvedValue(undefined),
  processCalendarEvent: vi.fn().mockReturnValue({
    externalId: "ext-1",
    subject: "Test Meeting",
    bodyPreview: "Preview",
    startTime: new Date("2026-03-20T09:00:00Z"),
    endTime: new Date("2026-03-20T09:30:00Z"),
    duration: 30,
    isAllDay: false,
    isCancelled: false,
    isRecurring: false,
    recurrenceId: null,
    organizer: "member-026@company.example",
    organizerName: "Jane",
    location: null,
    onlineMeetingUrl: null,
    isInternal: false,
    isSolo: false,
    isFiltered: false,
    filterReason: null,
    attendees: [
      { email: "member-026@company.example", name: "Jane", isInternal: true, isOrganizer: true, responseStatus: "organizer" },
      { email: "member-009@organization-001.example", name: "Client", isInternal: false, isOrganizer: false, responseStatus: "accepted" },
    ],
  }),
}));

const mockClassify = vi.hoisted(() => ({
  classifyMeeting: vi.fn().mockReturnValue({
    suggestedLabel: "discovery_call",
    confidence: 0.85,
    reasoning: "External attendee with discovery signals",
    signals: [],
  }),
}));

vi.mock("@/lib/prisma", () => ({ default: mockPrisma }));

vi.mock("@/lib/services/microsoft-graph", () => mockGraphFns);

vi.mock("@/lib/services/hubspot", () => ({
  HubSpotService: class MockHubSpotService {
    getPipelines = vi.fn().mockResolvedValue([]);
    getAllDeals = vi.fn().mockResolvedValue([]);
  },
}));

vi.mock("@/lib/services/classification-engine", () => mockClassify);

vi.mock("@/lib/tenant", () => ({
  getTenantSecrets: vi.fn().mockResolvedValue({
    hubspotAccessToken: "test-hubspot-token",
    azureAdTenantId: "test-azure-tenant",
    azureAdClientId: "test-azure-client",
    azureAdClientSecret: "test-azure-secret",
    teamsWebhookUrl: "https://test-webhook.com",
  }),
}));

import { syncAllCalendars, syncOutlookCalendar, syncHubSpot } from "./sync-manager";

// ─── Helpers ───────────────────────────────────────────────

const TENANT = "test-tenant";

function resetMocks() {
  vi.clearAllMocks();

  mockPrisma.syncLog.create.mockResolvedValue({ id: "sync-1" });
  mockPrisma.syncLog.update.mockResolvedValue({});
  mockPrisma.syncLog.findFirst.mockResolvedValue(null); // no running sync
  mockPrisma.syncLog.count.mockResolvedValue(1); // only our own sync is running
  mockPrisma.user.findMany.mockResolvedValue([]);
  mockPrisma.user.findUnique.mockResolvedValue({ outlookEmail: "member-026@company.example" });
  mockPrisma.calendarEvent.findUnique.mockResolvedValue(null);
  mockPrisma.calendarEvent.findFirst.mockResolvedValue(null); // no sibling reviewed events
  mockPrisma.calendarEvent.findMany.mockResolvedValue([]); // batch prefetch returns empty
  mockPrisma.calendarEvent.create.mockResolvedValue({ id: "evt-new" });
  mockPrisma.calendarEvent.update.mockResolvedValue({});
  mockPrisma.eventAttendee.findMany.mockResolvedValue([]);
  mockPrisma.eventAttendee.upsert.mockResolvedValue({});
  mockPrisma.suggestedClassification.upsert.mockResolvedValue({});
  mockPrisma.partnerEntity.findMany.mockResolvedValue([]);
  mockPrisma.integrationConfig.upsert.mockResolvedValue({});
  mockPrisma.pipelineDefinition.upsert.mockResolvedValue({});
  mockPrisma.pipelineDefinition.findUnique.mockResolvedValue({ id: "pipe-1" });
  mockPrisma.pipelineStage.upsert.mockResolvedValue({});
  mockPrisma.pipelineStage.findUnique.mockResolvedValue({ id: "stage-1", isClosed: false, isWon: false });
  mockPrisma.pipelineStage.findMany.mockResolvedValue([]);
  mockPrisma.hubSpotDeal.findUnique.mockResolvedValue(null);
  mockPrisma.hubSpotDeal.findMany.mockResolvedValue([]);
  mockPrisma.hubSpotDeal.create.mockResolvedValue({ id: "deal-new" });
  mockPrisma.hubSpotDeal.update.mockResolvedValue({});
  mockPrisma.tenant.findUnique.mockResolvedValue({ internalDomains: null, isDemoMode: false });
}

// ─── syncAllCalendars ──────────────────────────────────────

describe("syncAllCalendars", () => {
  beforeEach(resetMocks);

  it("returns empty results when no active users", async () => {
    const results = await syncAllCalendars(TENANT);
    expect(results).toEqual([]);
  });

  it("syncs calendars for each active user", async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      { id: "user-1", outlookEmail: "member-004@company.example" },
      { id: "user-2", outlookEmail: "member-007@company.example" },
    ]);

    const results = await syncAllCalendars(TENANT);

    expect(results).toHaveLength(2);
    // Both should have completed or failed
    for (const result of results) {
      expect(["completed", "failed"]).toContain(result.status);
    }
  });

  it("handles individual user sync failures gracefully", async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      { id: "user-fail", outlookEmail: "member-022@company.example" },
    ]);

    // Make the user lookup fail for this user
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const results = await syncAllCalendars(TENANT);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("failed");
    expect(results[0].error).toBeDefined();
  });
});

// ─── syncOutlookCalendar ───────────────────────────────────

describe("syncOutlookCalendar", () => {
  beforeEach(resetMocks);

  it("throws when user has no outlookEmail", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ outlookEmail: null });

    await expect(syncOutlookCalendar(TENANT, "user-no-email")).rejects.toThrow(
      "has no outlookEmail configured"
    );

    // Should mark sync as failed
    expect(mockPrisma.syncLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "failed" }),
      })
    );
  });

  it("creates new calendar events from graph", async () => {
    mockGraphFns.fetchCalendarEvents.mockResolvedValue([{ id: "graph-1" }]);

    const result = await syncOutlookCalendar(TENANT, "user-1");

    expect(result.status).toBe("completed");
    expect(result.created).toBe(1);
    expect(mockPrisma.calendarEvent.create).toHaveBeenCalledTimes(1);
  });

  it("updates existing calendar events", async () => {
    mockGraphFns.fetchCalendarEvents.mockResolvedValue([{ id: "graph-1" }]);
    // Batch prefetch returns existing event matching externalId "ext-1"
    mockPrisma.calendarEvent.findMany.mockResolvedValueOnce([{ id: "existing-1", externalId: "ext-1" }]);

    const result = await syncOutlookCalendar(TENANT, "user-1");

    expect(result.status).toBe("completed");
    expect(result.updated).toBe(1);
    expect(mockPrisma.calendarEvent.update).toHaveBeenCalledTimes(1);
  });

  it("upserts attendees for each event", async () => {
    mockGraphFns.fetchCalendarEvents.mockResolvedValue([{ id: "graph-1" }]);

    await syncOutlookCalendar(TENANT, "user-1");

    // processCalendarEvent returns 2 attendees
    expect(mockPrisma.eventAttendee.upsert).toHaveBeenCalledTimes(2);
  });

  it("classifies new unfiltered events", async () => {
    mockGraphFns.fetchCalendarEvents.mockResolvedValue([{ id: "graph-1" }]);
    await syncOutlookCalendar(TENANT, "user-1");

    expect(mockClassify.classifyMeeting).toHaveBeenCalled();
    expect(mockPrisma.suggestedClassification.upsert).toHaveBeenCalledTimes(1);
  });

  it("does NOT classify existing events", async () => {
    mockGraphFns.fetchCalendarEvents.mockResolvedValue([{ id: "graph-1" }]);
    mockPrisma.calendarEvent.findMany.mockResolvedValueOnce([{ id: "existing-1", externalId: "ext-1" }]);

    await syncOutlookCalendar(TENANT, "user-1");

    expect(mockClassify.classifyMeeting).not.toHaveBeenCalled();
  });

  it("does NOT classify filtered events", async () => {
    mockGraphFns.fetchCalendarEvents.mockResolvedValue([{ id: "graph-1" }]);
    mockGraphFns.processCalendarEvent.mockReturnValueOnce({
      externalId: "ext-1",
      subject: "Internal Standup",
      bodyPreview: null,
      startTime: new Date(),
      endTime: new Date(),
      duration: 30,
      isAllDay: false,
      isCancelled: false,
      isRecurring: false,
      recurrenceId: null,
      organizer: "member-026@company.example",
      organizerName: "Jane",
      location: null,
      onlineMeetingUrl: null,
      isInternal: true,
      isSolo: false,
      isFiltered: true,
      filterReason: "internal",
      attendees: [],
    });

    await syncOutlookCalendar(TENANT, "user-1");

    expect(mockClassify.classifyMeeting).not.toHaveBeenCalled();
  });

  it("marks sync log as completed on success", async () => {
    mockGraphFns.fetchCalendarEvents.mockResolvedValue([]);

    await syncOutlookCalendar(TENANT, "user-1");

    expect(mockPrisma.syncLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "completed",
          recordsProcessed: 0,
        }),
      })
    );
  });

  it("marks sync log as failed on error", async () => {
    mockGraphFns.fetchCalendarEvents.mockRejectedValue(new Error("Graph API down"));

    await expect(syncOutlookCalendar(TENANT, "user-1")).rejects.toThrow("Graph API down");

    expect(mockPrisma.syncLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "failed",
          errorMessage: "Graph API down",
        }),
      })
    );
  });

  it("updates integration config on success", async () => {
    mockGraphFns.fetchCalendarEvents.mockResolvedValue([]);

    await syncOutlookCalendar(TENANT, "user-1");

    expect(mockPrisma.integrationConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId_provider: { tenantId: TENANT, provider: "microsoft_graph" } },
      })
    );
  });

  it("detects partner contacts during attendee upsert", async () => {
    mockPrisma.partnerEntity.findMany.mockResolvedValue([
      { domain: "organization-001.example", contactEmails: ["member-009@organization-001.example"] },
    ]);

    mockGraphFns.fetchCalendarEvents.mockResolvedValue([{ id: "graph-1" }]);

    await syncOutlookCalendar(TENANT, "user-1");

    // Check that upsert was called with isPartnerContact: true for the matching attendee
    const upsertCalls = mockPrisma.eventAttendee.upsert.mock.calls;
    const partnerCall = upsertCalls.find(
      (call: any[]) => call[0].create.email === "member-009@organization-001.example"
    );
    expect(partnerCall).toBeDefined();
    expect(partnerCall![0].create.isPartnerContact).toBe(true);
  });
});

// ─── syncHubSpot ───────────────────────────────────────────

describe("syncHubSpot", () => {
  beforeEach(resetMocks);

  it("creates sync log and marks as completed on success", async () => {
    const result = await syncHubSpot(TENANT);

    expect(result.status).toBe("completed");
    expect(mockPrisma.syncLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ provider: "hubspot" }),
      })
    );
    expect(mockPrisma.syncLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "completed" }),
      })
    );
  });

  it("updates integration config on success", async () => {
    await syncHubSpot(TENANT);

    expect(mockPrisma.integrationConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId_provider: { tenantId: TENANT, provider: "hubspot" } },
      })
    );
  });

  it("records duration and record counts on success", async () => {
    const result = await syncHubSpot(TENANT);

    expect(result.created).toBe(0);
    expect(result.updated).toBe(0);

    const updateCall = mockPrisma.syncLog.update.mock.calls[0][0];
    expect(updateCall.data.status).toBe("completed");
    expect(typeof updateCall.data.durationMs).toBe("number");
    expect(updateCall.data.completedAt).toBeInstanceOf(Date);
  });
});

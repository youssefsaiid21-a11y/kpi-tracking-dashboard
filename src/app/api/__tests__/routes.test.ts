import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mock dependencies ─────────────────────────────────────

const mockPrisma = vi.hoisted(() => ({
  user: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  tenant: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
  calendarEvent: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
  meetingReview: {
    count: vi.fn(),
    findMany: vi.fn(),
    groupBy: vi.fn(),
    create: vi.fn(),
  },
  targetConfig: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  suggestedClassification: {
    findMany: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
  pipelineStage: {
    findMany: vi.fn(),
  },
  hubSpotDeal: {
    findMany: vi.fn(),
  },
  anomaly: {
    findMany: vi.fn(),
  },
  $transaction: vi.fn(),
  $queryRaw: vi.fn().mockResolvedValue([]),
}));

const mockRequireAuth = vi.hoisted(() => vi.fn());
const mockIsManagerOrAdmin = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({ default: mockPrisma }));

vi.mock("@/lib/api-auth", () => ({
  requireAuth: mockRequireAuth,
  isManagerOrAdmin: mockIsManagerOrAdmin,
}));

vi.mock("@/lib/cache", () => ({
  getCached: vi.fn().mockReturnValue(null),
  setCache: vi.fn(),
  invalidateTenant: vi.fn(),
}));

vi.mock("@/lib/services/kpi-calculator", () => ({
  getRepMetrics: vi.fn().mockResolvedValue({
    totalClassified: 0,
    channelBreakdown: { linkedin: 0, partnerships: 0, conferences: 0, referrals: 0, email: 0, inbound: 0, repeat_meeting: 0, irrelevant: 0 },
    totalMeetings: 0,
    classificationRate: 0,
    conversionRates: [],
  }),
  getTrendData: vi.fn().mockResolvedValue([]),
  buildTargetVsActual: vi.fn().mockReturnValue({
    metricType: "total_meetings",
    target: 0,
    actual: 0,
    variance: 0,
    variancePercent: 0,
    deficit: 0,
    onTrack: true,
    requiredPace: 0,
    remainingDays: 0,
  }),
  getTeamMetrics: vi.fn().mockResolvedValue({
    totalClassified: 0,
    channelBreakdown: { linkedin: 0, partnerships: 0, conferences: 0, referrals: 0, email: 0, inbound: 0, repeat_meeting: 0, irrelevant: 0 },
    totalMeetings: 0,
    classificationRate: 0,
    conversionRates: [],
  }),
  getConversionRates: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/services/deficit-analyzer", () => ({
  analyzeDeficit: vi.fn().mockReturnValue({
    currentActual: 0,
    target: 0,
    deficit: 0,
    requiredAdditionalMeetings: 0,
    requiredDailyPace: 0,
    remainingBusinessDays: 0,
    scenarioIfVolumeUp: 0,
    scenarioIfConversionUp: 0,
    scenarioIfBothUp: 0,
  }),
}));

vi.mock("@/lib/services/sync-manager", () => ({
  syncAllCalendars: vi.fn().mockResolvedValue([]),
  syncHubSpot: vi.fn().mockResolvedValue({ status: "completed", created: 0, updated: 0 }),
}));

vi.mock("@/lib/services/hubspot", () => ({
  calculateConversionRates: vi.fn().mockReturnValue([]),
}));

vi.mock("@/lib/tenant", () => ({
  getTenantSecrets: vi.fn().mockResolvedValue({}),
}));

vi.mock("bcryptjs", () => ({
  default: { hash: vi.fn().mockResolvedValue("hashed-password") },
}));

vi.mock("@/lib/utils", () => ({
  getDateRange: vi.fn().mockReturnValue({
    start: new Date("2026-03-01"),
    end: new Date("2026-03-31"),
    period: "monthly",
    label: "March 2026",
  }),
}));

// ─── Helpers ───────────────────────────────────────────────

const TENANT_ID = "test-tenant";
const USER_ID = "user-1";

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      id: USER_ID,
      role: "rep",
      tenantId: TENANT_ID,
      name: "Test User",
      email: "test@example.com",
      ...overrides,
    },
  };
}

function mockAuthSuccess(sessionOverrides: Record<string, unknown> = {}) {
  const session = makeSession(sessionOverrides);
  mockRequireAuth.mockResolvedValue({ session, error: null });
  mockIsManagerOrAdmin.mockImplementation(
    (role: string) => role === "manager" || role === "admin"
  );
  return session;
}

function mockAuthFailure(status = 401, message = "Unauthorized") {
  const { NextResponse } = require("next/server");
  mockRequireAuth.mockResolvedValue({
    session: null,
    error: NextResponse.json(
      { success: false, error: message },
      { status }
    ),
  });
}

function makeRequest(url: string, options?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), options);
}

function resetMocks() {
  vi.clearAllMocks();

  // Default returns
  mockPrisma.user.findMany.mockResolvedValue([]);
  mockPrisma.user.findFirst.mockResolvedValue(null);
  mockPrisma.user.findUnique.mockResolvedValue(null);
  mockPrisma.user.create.mockResolvedValue({ id: "new-user" });
  mockPrisma.tenant.findMany.mockResolvedValue([]);
  mockPrisma.tenant.findUnique.mockResolvedValue({ id: TENANT_ID });
  mockPrisma.calendarEvent.findMany.mockResolvedValue([]);
  mockPrisma.calendarEvent.count.mockResolvedValue(0);
  mockPrisma.meetingReview.count.mockResolvedValue(0);
  mockPrisma.meetingReview.findMany.mockResolvedValue([]);
  mockPrisma.meetingReview.groupBy.mockResolvedValue([]);
  mockPrisma.targetConfig.findMany.mockResolvedValue([]);
  mockPrisma.targetConfig.findFirst.mockResolvedValue(null);
  mockPrisma.pipelineStage.findMany.mockResolvedValue([]);
  mockPrisma.hubSpotDeal.findMany.mockResolvedValue([]);
  mockPrisma.anomaly.findMany.mockResolvedValue([]);
}

// ─── 1. Auth enforcement ───────────────────────────────────

describe("Auth enforcement — protected routes return 401 without session", () => {
  beforeEach(resetMocks);

  it("GET /api/users returns 401 when not authenticated", async () => {
    mockAuthFailure();
    const { GET } = await import("@/app/api/users/route");

    const req = makeRequest("/api/users");
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.success).toBe(false);
    expect(json.error).toBe("Unauthorized");
  });

  it("GET /api/analytics returns 401 when not authenticated", async () => {
    mockAuthFailure();
    const { GET } = await import("@/app/api/analytics/route");

    const req = makeRequest("/api/analytics");
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.success).toBe(false);
  });

  it("GET /api/meetings returns 401 when not authenticated", async () => {
    mockAuthFailure();
    const { GET } = await import("@/app/api/meetings/route");

    const req = makeRequest("/api/meetings");
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.success).toBe(false);
  });

  it("POST /api/meetings/bulk-review returns 401 when not authenticated", async () => {
    mockAuthFailure();
    const { POST } = await import("@/app/api/meetings/bulk-review/route");

    const req = makeRequest("/api/meetings/bulk-review", {
      method: "POST",
      body: JSON.stringify({ eventIds: ["e1"], confirmedLabel: "linkedin" }),
    });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.success).toBe(false);
  });

  it("GET /api/targets returns 401 when not authenticated", async () => {
    mockAuthFailure();
    const { GET } = await import("@/app/api/targets/route");

    const req = makeRequest("/api/targets");
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.success).toBe(false);
  });
});

// ─── 2. Role-based access ──────────────────────────────────

describe("Role-based access — admin-only routes reject non-admin roles", () => {
  beforeEach(resetMocks);

  it("POST /api/users returns 403 for rep role", async () => {
    // apiHandler with { roles: ["admin"] } calls requireAuth(["admin"])
    // which returns 403 for non-admin
    const { NextResponse } = require("next/server");
    mockRequireAuth.mockResolvedValue({
      session: null,
      error: NextResponse.json(
        { success: false, error: "Forbidden: insufficient permissions" },
        { status: 403 }
      ),
    });

    const { POST } = await import("@/app/api/users/route");

    const req = makeRequest("/api/users", {
      method: "POST",
      body: JSON.stringify({
        email: "new@example.com",
        password: "password123",
        name: "New User",
        role: "rep",
      }),
    });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toContain("Forbidden");
  });

  it("POST /api/users returns 403 for manager role", async () => {
    const { NextResponse } = require("next/server");
    mockRequireAuth.mockResolvedValue({
      session: null,
      error: NextResponse.json(
        { success: false, error: "Forbidden: insufficient permissions" },
        { status: 403 }
      ),
    });

    const { POST } = await import("@/app/api/users/route");

    const req = makeRequest("/api/users", {
      method: "POST",
      body: JSON.stringify({
        email: "new@example.com",
        password: "password123",
        role: "rep",
      }),
    });
    const res = await POST(req);

    expect(res.status).toBe(403);
  });

  it("POST /api/targets returns 403 for rep role", async () => {
    const { NextResponse } = require("next/server");
    mockRequireAuth.mockResolvedValue({
      session: null,
      error: NextResponse.json(
        { success: false, error: "Forbidden: insufficient permissions" },
        { status: 403 }
      ),
    });

    const { POST } = await import("@/app/api/targets/route");

    const req = makeRequest("/api/targets", {
      method: "POST",
      body: JSON.stringify({
        metricType: "total_meetings",
        targetValue: 20,
        period: "monthly",
      }),
    });
    const res = await POST(req);

    expect(res.status).toBe(403);
  });

  it("GET /api/analytics returns 403 when rep tries to view another user's data", async () => {
    mockAuthSuccess({ role: "rep" });

    const { GET } = await import("@/app/api/analytics/route");

    const req = makeRequest("/api/analytics?userId=other-user-id");
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toContain("Forbidden");
  });
});

// ─── 3. Cron auth ──────────────────────────────────────────

describe("Cron auth — job routes validate Bearer token", () => {
  beforeEach(() => {
    resetMocks();
    process.env.CRON_SECRET = "test-cron-secret-123";
  });

  it("POST /api/jobs/sync-calendars rejects missing Bearer token", async () => {
    const { POST } = await import("@/app/api/jobs/sync-calendars/route");

    const req = makeRequest("/api/jobs/sync-calendars", { method: "POST" });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.success).toBe(false);
    expect(json.error).toBe("Unauthorized");
  });

  it("POST /api/jobs/sync-calendars rejects invalid Bearer token", async () => {
    const { POST } = await import("@/app/api/jobs/sync-calendars/route");

    const req = makeRequest("/api/jobs/sync-calendars", {
      method: "POST",
      headers: { Authorization: "Bearer wrong-secret" },
    });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toBe("Unauthorized");
  });

  it("POST /api/jobs/sync-calendars accepts valid Bearer token", async () => {
    mockPrisma.tenant.findMany.mockResolvedValue([]);

    const { POST } = await import("@/app/api/jobs/sync-calendars/route");

    const req = makeRequest("/api/jobs/sync-calendars", {
      method: "POST",
      headers: { Authorization: "Bearer test-cron-secret-123" },
    });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
  });

  it("POST /api/jobs/sync-hubspot rejects invalid Bearer token", async () => {
    const { POST } = await import("@/app/api/jobs/sync-hubspot/route");

    const req = makeRequest("/api/jobs/sync-hubspot", {
      method: "POST",
      headers: { Authorization: "Bearer bad-token" },
    });
    const res = await POST(req);

    expect(res.status).toBe(401);
  });

  it("POST /api/jobs/sync-hubspot accepts valid Bearer token", async () => {
    mockPrisma.tenant.findMany.mockResolvedValue([]);

    const { POST } = await import("@/app/api/jobs/sync-hubspot/route");

    const req = makeRequest("/api/jobs/sync-hubspot", {
      method: "POST",
      headers: { Authorization: "Bearer test-cron-secret-123" },
    });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
  });

  it("POST /api/jobs/sync-calendars rejects when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;

    const { POST } = await import("@/app/api/jobs/sync-calendars/route");

    const req = makeRequest("/api/jobs/sync-calendars", {
      method: "POST",
      headers: { Authorization: "Bearer anything" },
    });
    const res = await POST(req);

    expect(res.status).toBe(401);
  });
});

// ─── 4. Input validation ───────────────────────────────────

describe("Input validation — routes with Zod schemas reject invalid input", () => {
  beforeEach(resetMocks);

  it("POST /api/meetings/bulk-review rejects empty eventIds array", async () => {
    mockAuthSuccess();

    const { POST } = await import("@/app/api/meetings/bulk-review/route");

    const req = makeRequest("/api/meetings/bulk-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventIds: [], confirmedLabel: "linkedin" }),
    });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
  });

  it("POST /api/meetings/bulk-review rejects invalid confirmedLabel", async () => {
    mockAuthSuccess();

    const { POST } = await import("@/app/api/meetings/bulk-review/route");

    const req = makeRequest("/api/meetings/bulk-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventIds: ["e1"], confirmedLabel: "not_a_valid_label" }),
    });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
  });

  it("POST /api/meetings/bulk-review rejects missing body fields", async () => {
    mockAuthSuccess();

    const { POST } = await import("@/app/api/meetings/bulk-review/route");

    const req = makeRequest("/api/meetings/bulk-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
  });

  it("POST /api/meetings/bulk-review rejects more than 100 eventIds", async () => {
    mockAuthSuccess();

    const { POST } = await import("@/app/api/meetings/bulk-review/route");

    const eventIds = Array.from({ length: 101 }, (_, i) => `event-${i}`);
    const req = makeRequest("/api/meetings/bulk-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventIds, confirmedLabel: "linkedin" }),
    });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
  });

  it("POST /api/users rejects invalid email format", async () => {
    mockAuthSuccess({ role: "admin" });

    const { POST } = await import("@/app/api/users/route");

    const req = makeRequest("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "not-an-email",
        password: "password123",
        role: "rep",
      }),
    });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
  });

  it("POST /api/users rejects password shorter than 8 characters", async () => {
    mockAuthSuccess({ role: "admin" });

    const { POST } = await import("@/app/api/users/route");

    const req = makeRequest("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "valid@example.com",
        password: "short",
        role: "rep",
      }),
    });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
  });

  it("POST /api/meetings/bulk-review rejects non-JSON body", async () => {
    mockAuthSuccess();

    const { POST } = await import("@/app/api/meetings/bulk-review/route");

    const req = makeRequest("/api/meetings/bulk-review", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "not json",
    });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
  });
});

// ─── 5. Tenant isolation ───────────────────────────────────

describe("Tenant isolation — tenant ID from session is used in queries", () => {
  beforeEach(resetMocks);

  it("GET /api/users queries only the session tenant's users", async () => {
    mockAuthSuccess({ role: "admin", tenantId: "tenant-abc" });

    const { GET } = await import("@/app/api/users/route");

    const req = makeRequest("/api/users");
    await GET(req);

    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: "tenant-abc" }),
      })
    );
  });

  it("GET /api/meetings queries only the session tenant's events", async () => {
    mockAuthSuccess({ tenantId: "tenant-xyz" });

    const { GET } = await import("@/app/api/meetings/route");

    const req = makeRequest("/api/meetings");
    await GET(req);

    expect(mockPrisma.calendarEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: "tenant-xyz" }),
      })
    );
  });

  it("POST /api/meetings/bulk-review scopes event lookup to session tenant", async () => {
    mockAuthSuccess({ tenantId: "tenant-secure" });
    mockPrisma.calendarEvent.findMany.mockResolvedValue([]);
    mockPrisma.$transaction.mockImplementation(async (fn: Function) => fn(mockPrisma));

    const { POST } = await import("@/app/api/meetings/bulk-review/route");

    const req = makeRequest("/api/meetings/bulk-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventIds: ["e1"], confirmedLabel: "linkedin" }),
    });
    await POST(req);

    expect(mockPrisma.calendarEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: "tenant-secure" }),
      })
    );
  });

  it("GET /api/targets queries only the session tenant's targets", async () => {
    mockAuthSuccess({ role: "admin", tenantId: "tenant-isolated" });

    const { GET } = await import("@/app/api/targets/route");

    const req = makeRequest("/api/targets");
    await GET(req);

    expect(mockPrisma.targetConfig.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: "tenant-isolated" }),
      })
    );
  });

  it("GET /api/users for rep role scopes to session user within tenant", async () => {
    mockAuthSuccess({ role: "rep", tenantId: "tenant-rep" });

    const { GET } = await import("@/app/api/users/route");

    const req = makeRequest("/api/users");
    await GET(req);

    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: "tenant-rep",
          id: USER_ID,
        }),
      })
    );
  });
});

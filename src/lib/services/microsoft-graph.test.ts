import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  processCalendarEvent,
  isInternalMeeting,
  isSoloMeeting,
  fetchCalendarEvents,
  sendTeamsMessage,
  type GraphCalendarEvent,
} from "./microsoft-graph";

// ─── Helper: build a minimal GraphCalendarEvent ─────────────

function makeEvent(
  overrides: Partial<GraphCalendarEvent> = {}
): GraphCalendarEvent {
  return {
    id: "evt-001",
    subject: "Test Meeting",
    bodyPreview: "Discussion about test meeting",
    start: { dateTime: "2026-03-20T09:00:00.000Z", timeZone: "UTC" },
    end: { dateTime: "2026-03-20T09:30:00.000Z", timeZone: "UTC" },
    isAllDay: false,
    isCancelled: false,
    isRecurring: false,
    seriesMasterId: null,
    organizer: {
      emailAddress: {
        address: "member-025@company.example",
        name: "Jane Lim",
      },
    },
    location: null,
    onlineMeeting: null,
    attendees: [],
    responseStatus: { response: "accepted" },
    ...overrides,
  };
}

// ─── isInternalMeeting ──────────────────────────────────────

describe("isInternalMeeting", () => {
  it("returns true when all attendees are internal", () => {
    const attendees = [
      {
        emailAddress: { address: "member-026@company.example", name: "Jane" },
        status: { response: "accepted" },
      },
      {
        emailAddress: { address: "member-002@company.example", name: "Alex" },
        status: { response: "accepted" },
      },
    ];
    expect(isInternalMeeting(attendees, "member-026@company.example")).toBe(true);
  });

  it("returns false when any attendee is external", () => {
    const attendees = [
      {
        emailAddress: { address: "member-026@company.example", name: "Jane" },
        status: { response: "accepted" },
      },
      {
        emailAddress: { address: "member-011@organization-010.example", name: "Client" },
        status: { response: "accepted" },
      },
    ];
    expect(isInternalMeeting(attendees, "member-026@company.example")).toBe(false);
  });

  it("returns false when organizer is external", () => {
    const attendees = [
      {
        emailAddress: { address: "member-026@company.example", name: "Jane" },
        status: { response: "accepted" },
      },
    ];
    expect(isInternalMeeting(attendees, "member-021@organization-020.example")).toBe(false);
  });

  it("handles case-insensitive email matching", () => {
    const attendees = [
      {
        emailAddress: { address: "MEMBER-026@COMPANY.EXAMPLE", name: "Jane" },
        status: { response: "accepted" },
      },
    ];
    expect(isInternalMeeting(attendees, "MEMBER-026@COMPANY.EXAMPLE")).toBe(true);
  });

  it("returns true for empty attendees with internal organizer", () => {
    expect(isInternalMeeting([], "member-026@company.example")).toBe(true);
  });
});

// ─── isSoloMeeting ──────────────────────────────────────────

describe("isSoloMeeting", () => {
  it("returns true for zero attendees", () => {
    expect(isSoloMeeting([])).toBe(true);
  });

  it("returns true for single attendee (organizer only)", () => {
    const attendees = [
      {
        emailAddress: { address: "member-026@company.example", name: "Jane" },
        status: { response: "organizer" },
      },
    ];
    expect(isSoloMeeting(attendees)).toBe(true);
  });

  it("returns false for two or more attendees", () => {
    const attendees = [
      {
        emailAddress: { address: "member-026@company.example", name: "Jane" },
        status: { response: "organizer" },
      },
      {
        emailAddress: { address: "member-002@company.example", name: "Alex" },
        status: { response: "accepted" },
      },
    ];
    expect(isSoloMeeting(attendees)).toBe(false);
  });
});

// ─── processCalendarEvent ───────────────────────────────────

describe("processCalendarEvent", () => {
  it("correctly calculates duration in minutes", () => {
    const event = makeEvent({
      start: { dateTime: "2026-03-20T09:00:00.000Z", timeZone: "UTC" },
      end: { dateTime: "2026-03-20T10:30:00.000Z", timeZone: "UTC" },
    });
    const result = processCalendarEvent(event);
    expect(result.duration).toBe(90);
  });

  it("extracts organizer email and name", () => {
    const result = processCalendarEvent(makeEvent());
    expect(result.organizer).toBe("member-025@company.example");
    expect(result.organizerName).toBe("Jane Lim");
  });

  it("marks solo meetings as filtered", () => {
    const event = makeEvent({ attendees: [] });
    const result = processCalendarEvent(event);
    expect(result.isSolo).toBe(true);
    expect(result.isFiltered).toBe(true);
    expect(result.filterReason).toBe("solo");
  });

  it("marks all-internal meetings as filtered", () => {
    const event = makeEvent({
      attendees: [
        {
          emailAddress: { address: "member-025@company.example", name: "Jane" },
          status: { response: "organizer" },
        },
        {
          emailAddress: { address: "member-001@company.example", name: "Alex" },
          status: { response: "accepted" },
        },
      ],
    });
    const result = processCalendarEvent(event);
    expect(result.isInternal).toBe(true);
    expect(result.isFiltered).toBe(true);
    expect(result.filterReason).toBe("internal");
  });

  it("does NOT filter meetings with external attendees", () => {
    const event = makeEvent({
      attendees: [
        {
          emailAddress: { address: "member-025@company.example", name: "Jane" },
          status: { response: "organizer" },
        },
        {
          emailAddress: { address: "member-011@organization-010.example", name: "Client" },
          status: { response: "accepted" },
        },
      ],
    });
    const result = processCalendarEvent(event);
    expect(result.isFiltered).toBe(false);
    expect(result.isInternal).toBe(false);
    expect(result.filterReason).toBeNull();
  });

  it("correctly identifies internal vs external attendees", () => {
    const event = makeEvent({
      attendees: [
        {
          emailAddress: { address: "member-025@company.example", name: "Jane" },
          status: { response: "organizer" },
        },
        {
          emailAddress: { address: "member-011@organization-010.example", name: "Client" },
          status: { response: "accepted" },
        },
      ],
    });
    const result = processCalendarEvent(event);
    expect(result.attendees[0].isInternal).toBe(true);
    expect(result.attendees[0].isOrganizer).toBe(true);
    expect(result.attendees[1].isInternal).toBe(false);
    expect(result.attendees[1].isOrganizer).toBe(false);
  });

  it("extracts location when present", () => {
    const event = makeEvent({
      location: { displayName: "Conference Room A" },
    });
    const result = processCalendarEvent(event);
    expect(result.location).toBe("Conference Room A");
  });

  it("returns null location when absent", () => {
    const event = makeEvent({ location: null });
    const result = processCalendarEvent(event);
    expect(result.location).toBeNull();
  });

  it("extracts online meeting URL when present", () => {
    const event = makeEvent({
      onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meet/001" },
    });
    const result = processCalendarEvent(event);
    expect(result.onlineMeetingUrl).toBe(
      "https://teams.microsoft.com/l/meet/001"
    );
  });

  it("handles recurring events", () => {
    const event = makeEvent({
      isRecurring: true,
      seriesMasterId: "series-001",
    });
    const result = processCalendarEvent(event);
    expect(result.isRecurring).toBe(true);
    expect(result.recurrenceId).toBe("series-001");
  });

  it("preserves the external event ID", () => {
    const event = makeEvent({ id: "graph-evt-abc123" });
    const result = processCalendarEvent(event);
    expect(result.externalId).toBe("graph-evt-abc123");
  });

  it("handles null subject", () => {
    const event = makeEvent({ subject: null });
    const result = processCalendarEvent(event);
    expect(result.subject).toBeNull();
  });
});

// ─── Integration: Classification After Processing ───────────

describe("processCalendarEvent — classification readiness", () => {
  it("external meetings produce classification-ready data", () => {
    const event = makeEvent({
      subject: "Discovery Call - Acme Corp",
      attendees: [
        {
          emailAddress: { address: "member-025@company.example", name: "Jane" },
          status: { response: "organizer" },
        },
        {
          emailAddress: { address: "member-054@organization-003.example", name: "Demo member" },
          status: { response: "accepted" },
        },
      ],
      start: { dateTime: "2026-03-20T09:00:00.000Z", timeZone: "UTC" },
      end: { dateTime: "2026-03-20T09:45:00.000Z", timeZone: "UTC" },
    });

    const processed = processCalendarEvent(event);

    // Meeting should NOT be filtered
    expect(processed.isFiltered).toBe(false);
    // Should have subject, duration, attendee details ready for classification
    expect(processed.subject).toBe("Discovery Call - Acme Corp");
    expect(processed.duration).toBe(45);
    expect(processed.attendees).toHaveLength(2);
    expect(processed.attendees.filter((a) => !a.isInternal)).toHaveLength(1);
  });

  it("filtered meetings do not enter classification pipeline", () => {
    // Internal meeting
    const internalEvent = makeEvent({
      subject: "Sprint Retro",
      attendees: [
        {
          emailAddress: { address: "member-025@company.example", name: "Jane" },
          status: { response: "organizer" },
        },
        {
          emailAddress: { address: "member-001@company.example", name: "Alex" },
          status: { response: "accepted" },
        },
      ],
    });
    expect(processCalendarEvent(internalEvent).isFiltered).toBe(true);

    // Solo block
    const soloEvent = makeEvent({
      subject: "Focus Time",
      attendees: [],
    });
    expect(processCalendarEvent(soloEvent).isFiltered).toBe(true);
  });
});

// ─── fetchCalendarEvents — Demo Mode ─────────────────────────

describe("fetchCalendarEvents — demo mode", () => {
  const originalDemo = process.env.DEMO_MODE;

  beforeEach(() => {
    process.env.DEMO_MODE = "true";
  });

  afterEach(() => {
    if (originalDemo !== undefined) {
      process.env.DEMO_MODE = originalDemo;
    } else {
      delete process.env.DEMO_MODE;
    }
  });

  it("returns demo events in demo mode", async () => {
    const start = new Date();
    start.setDate(start.getDate() - 90);
    const end = new Date();

    const events = await fetchCalendarEvents("member-060@company.example", start, end);

    expect(events.length).toBeGreaterThan(0);
    // Verify event structure
    const event = events[0];
    expect(event).toHaveProperty("id");
    expect(event).toHaveProperty("subject");
    expect(event).toHaveProperty("start");
    expect(event).toHaveProperty("end");
    expect(event).toHaveProperty("attendees");
    expect(event).toHaveProperty("organizer");
  });

  it("demo events include internal, solo, and external meetings", async () => {
    const start = new Date();
    start.setDate(start.getDate() - 90);
    const end = new Date();

    const events = await fetchCalendarEvents("member-060@company.example", start, end);

    // Process all events
    const processed = events.map((e) => processCalendarEvent(e));

    const internal = processed.filter((p) => p.isInternal && !p.isSolo);
    const solo = processed.filter((p) => p.isSolo);
    const external = processed.filter((p) => !p.isFiltered);

    expect(internal.length).toBeGreaterThan(0);
    expect(solo.length).toBeGreaterThan(0);
    expect(external.length).toBeGreaterThan(0);
  });

  it("demo events have valid date ranges", async () => {
    const start = new Date();
    start.setDate(start.getDate() - 90);
    const end = new Date();

    const events = await fetchCalendarEvents("member-060@company.example", start, end);

    for (const event of events) {
      const s = new Date(event.start.dateTime);
      const e = new Date(event.end.dateTime);
      expect(e.getTime()).toBeGreaterThan(s.getTime());
    }
  });

  it("demo events include recurring, all-day, and online meetings", async () => {
    const start = new Date();
    start.setDate(start.getDate() - 90);
    const end = new Date();

    const events = await fetchCalendarEvents("member-060@company.example", start, end);

    expect(events.some((e) => e.isRecurring)).toBe(true);
    expect(events.some((e) => e.isAllDay)).toBe(true);
    expect(events.some((e) => e.onlineMeeting !== null)).toBe(true);
    expect(events.some((e) => e.location !== null)).toBe(true);
  });
});

// ─── sendTeamsMessage ────────────────────────────────────────

describe("sendTeamsMessage", () => {
  const originalDemo = process.env.DEMO_MODE;

  afterEach(() => {
    if (originalDemo !== undefined) {
      process.env.DEMO_MODE = originalDemo;
    } else {
      delete process.env.DEMO_MODE;
    }
    vi.restoreAllMocks();
  });

  it("does nothing in demo mode (no fetch call)", async () => {
    process.env.DEMO_MODE = "true";
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await sendTeamsMessage("https://example.com/webhook", "Test message");

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends adaptive card to webhook URL in live mode", async () => {
    delete process.env.DEMO_MODE;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("1", { status: 200 })
    );

    await sendTeamsMessage("https://example.com/webhook", "Hello team");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://example.com/webhook");
    expect(options?.method).toBe("POST");
    const body = JSON.parse(options?.body as string);
    expect(body.type).toBe("message");
    expect(body.attachments[0].content.body[0].text).toBe("Hello team");
  });

  it("throws on non-ok response in live mode", async () => {
    delete process.env.DEMO_MODE;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Bad Request", { status: 400, statusText: "Bad Request" })
    );

    await expect(
      sendTeamsMessage("https://example.com/webhook", "Test")
    ).rejects.toThrow("Failed to send Teams message");
  });
});

// ─── processCalendarEvent — edge cases ───────────────────────

describe("processCalendarEvent — additional edge cases", () => {
  it("handles all-day events", () => {
    const event = makeEvent({
      isAllDay: true,
      start: { dateTime: "2026-03-20T00:00:00.000Z", timeZone: "UTC" },
      end: { dateTime: "2026-03-21T00:00:00.000Z", timeZone: "UTC" },
    });
    const result = processCalendarEvent(event);
    expect(result.isAllDay).toBe(true);
    expect(result.duration).toBe(1440); // 24 hours
  });

  it("handles cancelled events", () => {
    const event = makeEvent({ isCancelled: true });
    const result = processCalendarEvent(event);
    expect(result.isCancelled).toBe(true);
  });

  it("handles null bodyPreview", () => {
    const event = makeEvent({ bodyPreview: null });
    const result = processCalendarEvent(event);
    expect(result.bodyPreview).toBeNull();
  });

  it("handles null onlineMeeting", () => {
    const event = makeEvent({ onlineMeeting: null });
    const result = processCalendarEvent(event);
    expect(result.onlineMeetingUrl).toBeNull();
  });

  it("handles mixed internal and external attendees with organizer identification", () => {
    const event = makeEvent({
      organizer: {
        emailAddress: { address: "member-025@company.example", name: "Jane Lim" },
      },
      attendees: [
        {
          emailAddress: { address: "member-025@company.example", name: "Jane Lim" },
          status: { response: "organizer" },
        },
        {
          emailAddress: { address: "member-001@company.example", name: "Alex Tan" },
          status: { response: "accepted" },
        },
        {
          emailAddress: { address: "member-011@organization-010.example", name: "Client" },
          status: { response: "tentativelyAccepted" },
        },
      ],
    });
    const result = processCalendarEvent(event);
    expect(result.isFiltered).toBe(false); // has external attendee
    expect(result.attendees[0].isOrganizer).toBe(true);
    expect(result.attendees[1].isOrganizer).toBe(false);
    expect(result.attendees[2].isInternal).toBe(false);
    expect(result.attendees[2].responseStatus).toBe("tentativelyAccepted");
  });
});

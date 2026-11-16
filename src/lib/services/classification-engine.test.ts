import { describe, it, expect } from "vitest";
import {
  classifyMeeting,
  getConfidenceLevel,
  type ClassificationInput,
} from "./classification-engine";

// ─── Helper to build a minimal input ────────────────────────

function makeInput(overrides: Partial<ClassificationInput> = {}): ClassificationInput {
  return {
    subject: "Meeting",
    attendees: [],
    organizer: "member-048@company.example",
    duration: 30,
    isRecurring: false,
    partnerDomains: [],
    partnerEmails: [],
    ...overrides,
  };
}

// ─── Classification: Email (default external meetings) ──────

describe("classifyMeeting — email channel signals", () => {
  it("classifies a meeting with external attendee and typical duration as email", () => {
    const result = classifyMeeting(
      makeInput({
        subject: "Demo: Example Company Platform – DataCo Inc",
        attendees: [
          { email: "member-048@company.example", name: "Rep", isInternal: true },
          { email: "member-062@organization-009.example", name: "Tom", isInternal: false },
        ],
      })
    );
    expect(result.suggestedLabel).toBe("email");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("classifies external meetings without channel keywords as email", () => {
    const result = classifyMeeting(
      makeInput({
        subject: "Follow-up: TechFlow Solutions – Security Requirements",
        attendees: [
          { email: "member-048@company.example", name: "Rep", isInternal: true },
          { email: "member-050@organization-026.example", name: "Richard", isInternal: false },
        ],
        duration: 45,
      })
    );
    expect(result.suggestedLabel).toBe("email");
  });

  it("classifies generic external calls as email", () => {
    const result = classifyMeeting(
      makeInput({
        subject: "Call – Acme Corp AI Platform",
        attendees: [
          { email: "member-048@company.example", name: "Rep", isInternal: true },
          { email: "member-054@organization-003.example", name: "Demo member", isInternal: false },
        ],
      })
    );
    expect(result.suggestedLabel).toBe("email");
  });

  it("gives equal confidence when same generic signals apply", () => {
    const singleSignal = classifyMeeting(
      makeInput({
        subject: "Meeting with prospect",
        attendees: [
          { email: "member-048@company.example", name: "Rep", isInternal: true },
          { email: "member-044@organization-008.example", name: "Prospect", isInternal: false },
        ],
        duration: 45,
      })
    );

    const multipleSignals = classifyMeeting(
      makeInput({
        subject: "Prospect Session",
        attendees: [
          { email: "member-048@company.example", name: "Rep", isInternal: true },
          { email: "member-044@organization-008.example", name: "Prospect", isInternal: false },
        ],
        duration: 45,
      })
    );

    expect(multipleSignals.confidence).toBeGreaterThanOrEqual(singleSignal.confidence);
  });
});

// ─── Classification: Partner Meetings ───────────────────────

describe("classifyMeeting — partner signals", () => {
  it("classifies a meeting with known partner domain as partnerships", () => {
    const result = classifyMeeting(
      makeInput({
        subject: "Quarterly Business Review – PartnerCo",
        attendees: [
          { email: "member-048@company.example", name: "Rep", isInternal: true },
          { email: "member-034@organization-021.example", name: "Mark", isInternal: false },
        ],
        partnerDomains: ["organization-021.example"],
      })
    );
    expect(result.suggestedLabel).toBe("partnerships");
  });

  it("classifies a meeting with known partner email as partnerships", () => {
    const result = classifyMeeting(
      makeInput({
        subject: "GTM Planning Call",
        attendees: [
          { email: "member-048@company.example", name: "Rep", isInternal: true },
          { email: "member-058@organization-006.example", name: "Steve", isInternal: false },
        ],
        partnerEmails: ["member-058@organization-006.example"],
      })
    );
    expect(result.suggestedLabel).toBe("partnerships");
  });

  it("classifies partnership keyword meetings correctly", () => {
    const result = classifyMeeting(
      makeInput({
        subject: "Partnership Enablement Session",
        attendees: [
          { email: "member-048@company.example", name: "Rep", isInternal: true },
          { email: "member-013@organization-029.example", name: "Contact", isInternal: false },
        ],
      })
    );
    expect(result.suggestedLabel).toBe("partnerships");
  });

  it("partner email match outweighs stacked generic email signals (v1 bug fix)", () => {
    // v1 BUG: generic signals stacking could outweigh partner identity signals.
    //
    // v2 FIX: Generic signals are capped at MAX_GENERIC_SCORE per category.
    // email:         min(0.15+0.1, 0.3) = 0.25 (generic, capped)
    // partnerships:  0.7 (email match, identity) = 0.70
    // Partnerships wins correctly.
    const result = classifyMeeting(
      makeInput({
        subject: "Intro Call",
        attendees: [
          { email: "member-048@company.example", name: "Rep", isInternal: true },
          { email: "member-040@organization-016.example", name: "Partner", isInternal: false },
        ],
        partnerEmails: ["member-040@organization-016.example"],
        duration: 30,
      })
    );
    expect(result.suggestedLabel).toBe("partnerships");
  });

  it("partner domain match outweighs generic email signals", () => {
    const result = classifyMeeting(
      makeInput({
        subject: "Meeting with partner team",
        attendees: [
          { email: "member-048@company.example", name: "Rep", isInternal: true },
          { email: "member-012@organization-021.example", name: "Contact", isInternal: false },
        ],
        partnerDomains: ["organization-021.example"],
        duration: 45,
      })
    );
    // Partner domain (0.6, identity) + partner keyword (0.35, contextual) vs email generics (capped)
    expect(result.suggestedLabel).toBe("partnerships");
  });
});

// ─── Classification: Irrelevant Meetings ────────────────────

describe("classifyMeeting — irrelevant signals", () => {
  it("classifies internal 'standup' meetings as irrelevant", () => {
    const result = classifyMeeting(
      makeInput({
        subject: "Weekly Team Standup",
        attendees: [],
        duration: 15,
        isRecurring: true,
      })
    );
    expect(result.suggestedLabel).toBe("irrelevant");
  });

  it("classifies '1:1' meetings as irrelevant", () => {
    const result = classifyMeeting(
      makeInput({
        subject: "1:1 with Manager",
        attendees: [],
        isRecurring: true,
      })
    );
    expect(result.suggestedLabel).toBe("irrelevant");
  });

  it("classifies 'all hands' meetings as irrelevant", () => {
    const result = classifyMeeting(
      makeInput({
        subject: "Engineering All Hands",
        duration: 60,
        isRecurring: true,
      })
    );
    expect(result.suggestedLabel).toBe("irrelevant");
  });

  it("classifies very short meetings (< 20 min) with no other signals as irrelevant", () => {
    const result = classifyMeeting(
      makeInput({
        subject: "Quick chat",
        duration: 10,
      })
    );
    expect(result.suggestedLabel).toBe("irrelevant");
  });
});

// ─── Signal Tier System ─────────────────────────────────────

describe("classifyMeeting — signal tier hierarchy", () => {
  it("identity signals are never outweighed by generic signal stacking", () => {
    // Max possible generic stack for email: EXTERNAL_ATTENDEE_COUNT (0.15) +
    // LONG_MEETING (0.1) = 0.25, capped at 0.3.
    // partnerships: 0.7 (email match, identity) wins.
    const result = classifyMeeting(
      makeInput({
        subject: "Intro Overview",
        attendees: [
          { email: "member-048@company.example", name: "Rep", isInternal: true },
          { email: "member-040@organization-016.example", name: "Partner", isInternal: false },
          { email: "member-039@organization-016.example", name: "Other", isInternal: false },
        ],
        partnerEmails: ["member-040@organization-016.example"],
        duration: 45,
      })
    );
    expect(result.suggestedLabel).toBe("partnerships");
  });

  it("generic signals are capped — cannot exceed MAX_GENERIC_SCORE per category", () => {
    // A meeting with only generic discovery signals (external attendee + duration)
    // should have capped contribution, losing to irrelevant contextual keywords
    const result = classifyMeeting(
      makeInput({
        subject: "Weekly sync",  // irrelevant keyword (0.3 contextual)
        attendees: [
          { email: "member-048@company.example", name: "Rep", isInternal: true },
          { email: "member-019@organization-008.example", name: "Ext", isInternal: false },
        ],
        duration: 45,
        // Generic discovery signals: EXTERNAL_ATTENDEE_COUNT (0.15) + LONG_MEETING (0.1) = 0.25, capped at 0.3
        // Contextual irrelevant: "weekly" + "sync" (0.3)
        // discovery_call = 0 (contextual) + 0.25 (generic, capped) = 0.25
        // irrelevant = 0.3 (contextual) + 0 (generic) = 0.3
        // irrelevant wins — generics didn't rescue discovery
      })
    );
    expect(result.suggestedLabel).toBe("irrelevant");
  });

  it("contextual + identity signals compound for high confidence", () => {
    const result = classifyMeeting(
      makeInput({
        subject: "Partnership Enablement – PartnerCo",
        attendees: [
          { email: "member-048@company.example", name: "Rep", isInternal: true },
          { email: "member-034@organization-021.example", name: "Mark", isInternal: false },
        ],
        partnerDomains: ["organization-021.example"],
        partnerEmails: ["member-034@organization-021.example"],
      })
    );
    expect(result.suggestedLabel).toBe("partnerships");
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });
});

// ─── Low-Signal / Edge Cases ────────────────────────────────

describe("classifyMeeting — edge cases", () => {
  it("defaults to irrelevant with low confidence when no signals detected", () => {
    const result = classifyMeeting(
      makeInput({
        subject: "Something",
        attendees: [],
        duration: 25,
        isRecurring: false,
      })
    );
    expect(result.suggestedLabel).toBe("irrelevant");
    expect(result.confidence).toBe(0.15);
    expect(result.reasoning).toContain("No strong signals");
  });

  it("handles null subject gracefully", () => {
    const result = classifyMeeting(
      makeInput({
        subject: null,
        attendees: [
          { email: "member-048@company.example", name: "Rep", isInternal: true },
          { email: "member-020@organization-008.example", name: "External", isInternal: false },
        ],
        duration: 30,
      })
    );
    expect(result).toBeDefined();
    expect(result.suggestedLabel).toBeDefined();
    expect(result.confidence).toBeGreaterThanOrEqual(0);
  });

  it("handles empty attendees list", () => {
    const result = classifyMeeting(
      makeInput({
        subject: "Demo Session",
        attendees: [],
        duration: 30,
      })
    );
    expect(result).toBeDefined();
    // No external attendees + no channel keywords → only LONG_MEETING generic (0.1 for email)
    // topScore 0.1 < 0.2, so defaults to irrelevant
    expect(result.suggestedLabel).toBe("irrelevant");
  });

  it("produces classification signals in the result", () => {
    const result = classifyMeeting(
      makeInput({
        subject: "Discovery: TechFlow – Security",
        attendees: [
          { email: "member-048@company.example", name: "Rep", isInternal: true },
          { email: "member-042@organization-026.example", name: "Person", isInternal: false },
        ],
        duration: 45,
      })
    );
    expect(result.signals.length).toBeGreaterThan(0);
    expect(result.signals[0]).toHaveProperty("type");
    expect(result.signals[0]).toHaveProperty("weight");
    expect(result.signals[0]).toHaveProperty("description");
  });

  it("conflicting signals resolve to the stronger signal category", () => {
    // "Catch up" (irrelevant contextual) + partner domain (identity)
    const result = classifyMeeting(
      makeInput({
        subject: "Catch up with partner team",
        attendees: [
          { email: "member-048@company.example", name: "Rep", isInternal: true },
          { email: "member-012@organization-021.example", name: "Contact", isInternal: false },
        ],
        partnerDomains: ["organization-021.example"],
        duration: 30,
      })
    );
    expect(result.suggestedLabel).toBe("partnerships");
  });
});

// ─── Confidence Level Helper ────────────────────────────────

describe("getConfidenceLevel", () => {
  it("returns 'high' for confidence >= 0.7", () => {
    expect(getConfidenceLevel(0.7)).toBe("high");
    expect(getConfidenceLevel(0.95)).toBe("high");
    expect(getConfidenceLevel(1.0)).toBe("high");
  });

  it("returns 'medium' for confidence >= 0.4 and < 0.7", () => {
    expect(getConfidenceLevel(0.4)).toBe("medium");
    expect(getConfidenceLevel(0.55)).toBe("medium");
    expect(getConfidenceLevel(0.69)).toBe("medium");
  });

  it("returns 'low' for confidence < 0.4", () => {
    expect(getConfidenceLevel(0.0)).toBe("low");
    expect(getConfidenceLevel(0.15)).toBe("low");
    expect(getConfidenceLevel(0.39)).toBe("low");
  });
});

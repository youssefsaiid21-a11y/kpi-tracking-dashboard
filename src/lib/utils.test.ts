import { describe, it, expect } from "vitest";
import {
  cn,
  isInternalEmail,
  getDateRange,
  getRemainingBusinessDays,
  severityOrder,
  severityColor,
  classificationLabelDisplay,
  formatPercent,
  formatNumber,
} from "./utils";

// ─── isInternalEmail ────────────────────────────────────────

describe("isInternalEmail", () => {
  it("returns true for company.example emails", () => {
    expect(isInternalEmail("member-026@company.example")).toBe(true);
  });

  it("is case insensitive", () => {
    expect(isInternalEmail("MEMBER-026@COMPANY.EXAMPLE")).toBe(true);
  });

  it("returns false for external emails", () => {
    expect(isInternalEmail("member-010@organization-003.example")).toBe(false);
  });

  it("returns false for similar but different domains", () => {
    expect(isInternalEmail("member-068@organization-014.example")).toBe(false);
    expect(isInternalEmail("member-069@organization-018.example")).toBe(false);
  });

  it("matches against custom internalDomains list", () => {
    const domains = ["organization-001.example", "organization-002.example"];
    expect(isInternalEmail("member-065@organization-001.example", domains)).toBe(true);
    expect(isInternalEmail("member-066@organization-002.example", domains)).toBe(true);
    expect(isInternalEmail("member-070@organization-020.example", domains)).toBe(false);
  });

  it("is case insensitive with internalDomains", () => {
    const domains = ["ORGANIZATION-001.EXAMPLE"];
    expect(isInternalEmail("member-065@organization-001.example", domains)).toBe(true);
    expect(isInternalEmail("MEMBER-065@ORGANIZATION-001.EXAMPLE", domains)).toBe(true);
  });

  it("falls back to INTERNAL_DOMAIN when internalDomains is empty", () => {
    expect(isInternalEmail("member-026@company.example", [])).toBe(true);
    expect(isInternalEmail("member-011@organization-010.example", [])).toBe(false);
  });
});

// ─── getDateRange ───────────────────────────────────────────

describe("getDateRange", () => {
  it("returns a valid weekly range", () => {
    const range = getDateRange("weekly");
    expect(range.period).toBe("weekly");
    expect(range.start).toBeInstanceOf(Date);
    expect(range.end).toBeInstanceOf(Date);
    expect(range.start.getTime()).toBeLessThan(range.end.getTime());
    // Week should be 7 days or less from start to end
    const diffDays =
      (range.end.getTime() - range.start.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeLessThanOrEqual(7);
  });

  it("returns a valid monthly range", () => {
    const range = getDateRange("monthly");
    expect(range.period).toBe("monthly");
    expect(range.start.getDate()).toBe(1); // starts on 1st
    expect(range.label).toBeTruthy();
  });

  it("returns a valid quarterly range", () => {
    const range = getDateRange("quarterly");
    expect(range.period).toBe("quarterly");
    expect(range.label).toMatch(/Q[1-4] \d{4}/);
  });

  it("returns all_time range starting from 2020", () => {
    const range = getDateRange("all_time");
    expect(range.start.getFullYear()).toBe(2020);
  });

  it("custom range uses provided dates", () => {
    const start = new Date("2026-01-01");
    const end = new Date("2026-03-31");
    const range = getDateRange("custom", start, end);
    expect(range.period).toBe("custom");
    expect(range.start.getTime()).toBe(start.getTime());
    expect(range.end.getTime()).toBe(end.getTime());
  });

  it("falls back to monthly for invalid period", () => {
    const range = getDateRange("invalid" as any);
    expect(range.period).toBe("monthly");
  });
});

// ─── severityOrder ──────────────────────────────────────────

describe("severityOrder", () => {
  it("critical > warning > info", () => {
    expect(severityOrder("critical")).toBeGreaterThan(severityOrder("warning"));
    expect(severityOrder("warning")).toBeGreaterThan(severityOrder("info"));
    expect(severityOrder("info")).toBeGreaterThan(severityOrder("unknown"));
  });

  it("returns 0 for unknown severity", () => {
    expect(severityOrder("")).toBe(0);
    expect(severityOrder("low")).toBe(0);
  });
});

// ─── classificationLabelDisplay ─────────────────────────────

describe("classificationLabelDisplay", () => {
  it("maps all known labels", () => {
    expect(classificationLabelDisplay("discovery_call")).toBe("Discovery Call");
    expect(classificationLabelDisplay("partnership_lead")).toBe(
      "Partnership Lead"
    );
    expect(classificationLabelDisplay("irrelevant")).toBe("Irrelevant");
  });

  it("returns unknown labels as-is", () => {
    expect(classificationLabelDisplay("custom_label")).toBe("custom_label");
  });
});

// ─── formatPercent ──────────────────────────────────────────

describe("formatPercent", () => {
  it("formats 0.756 as 75.6%", () => {
    expect(formatPercent(0.756)).toBe("75.6%");
  });

  it("formats 1.0 as 100.0%", () => {
    expect(formatPercent(1.0)).toBe("100.0%");
  });

  it("respects decimal precision", () => {
    expect(formatPercent(0.756, 0)).toBe("76%");
    expect(formatPercent(0.756, 2)).toBe("75.60%");
  });
});

// ─── formatNumber ───────────────────────────────────────────

describe("formatNumber", () => {
  it("formats numbers with locale separators", () => {
    const result = formatNumber(1234567);
    // Accept either comma or period as thousands separator depending on locale
    expect(result).toMatch(/1.234.567|1,234,567/);
  });

  it("handles small numbers", () => {
    expect(formatNumber(42)).toBe("42");
  });
});

// ─── cn ────────────────────────────────────────────────────

describe("cn", () => {
  it("merges tailwind classes", () => {
    const result = cn("px-2 py-1", "px-4");
    expect(result).toContain("px-4");
    expect(result).not.toContain("px-2");
  });
});

// ─── getRemainingBusinessDays ──────────────────────────────

describe("getRemainingBusinessDays", () => {
  it("returns 0 for dates in the past", () => {
    const pastDate = new Date("2020-01-01");
    expect(getRemainingBusinessDays(pastDate)).toBe(0);
  });

  it("returns a non-negative number for future dates", () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 30);
    expect(getRemainingBusinessDays(futureDate)).toBeGreaterThanOrEqual(0);
  });
});

// ─── severityColor ─────────────────────────────────────────

describe("severityColor", () => {
  it("returns red classes for critical", () => {
    expect(severityColor("critical")).toContain("red");
  });

  it("returns amber classes for warning", () => {
    expect(severityColor("warning")).toContain("amber");
  });

  it("returns blue classes for info", () => {
    expect(severityColor("info")).toContain("blue");
  });

  it("returns gray classes for unknown", () => {
    expect(severityColor("unknown")).toContain("gray");
  });
});

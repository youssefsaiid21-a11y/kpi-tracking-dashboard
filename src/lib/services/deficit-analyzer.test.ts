import { describe, it, expect } from "vitest";
import {
  analyzeDeficit,
  generateRecommendations,
} from "./deficit-analyzer";
import type {
  TeamOverview,
  StageConversion,
  TargetVsActual,
} from "@/types";

// ─── analyzeDeficit ─────────────────────────────────────────

describe("analyzeDeficit", () => {
  it("calculates correct deficit when behind target", () => {
    const result = analyzeDeficit(
      /* actual */ 8,
      /* target */ 20,
      /* conversionRate */ 0.5,
      /* remainingDays */ 10,
      /* elapsedDays */ 10
    );

    expect(result.currentActual).toBe(8);
    expect(result.target).toBe(20);
    expect(result.deficit).toBe(12);
    expect(result.requiredAdditionalMeetings).toBe(24); // ceil(12 / 0.5) — accounts for conversion rate
    expect(result.requiredDailyPace).toBeCloseTo(1.2, 1); // 12 / 10
    expect(result.remainingBusinessDays).toBe(10);
  });

  it("returns zero deficit when on or above target", () => {
    const result = analyzeDeficit(25, 20, 0.5, 10, 10);
    expect(result.deficit).toBe(0);
    expect(result.requiredAdditionalMeetings).toBe(0);
    expect(result.requiredDailyPace).toBe(0);
  });

  it("scenario projections increase with volume up", () => {
    const result = analyzeDeficit(10, 30, 0.5, 10, 10);
    // currentDailyRate = 10 / 10 = 1
    // volumeUpRate = 1 * 1.3 = 1.3
    // scenarioIfVolumeUp = 10 + 1.3 * 10 * 0.5 = 10 + 6.5 = 17 (rounded)
    expect(result.scenarioIfVolumeUp).toBe(17);
  });

  it("scenario projections increase with conversion up", () => {
    const result = analyzeDeficit(10, 30, 0.5, 10, 10);
    // currentDailyRate = 1
    // improvedConversion = 0.5 * 1.2 = 0.6
    // scenarioIfConversionUp = 10 + 1 * 10 * 0.6 = 10 + 6 = 16
    expect(result.scenarioIfConversionUp).toBe(16);
  });

  it("combined scenario is better than either individual scenario", () => {
    const result = analyzeDeficit(10, 30, 0.5, 10, 10);
    expect(result.scenarioIfBothUp).toBeGreaterThan(result.scenarioIfVolumeUp);
    expect(result.scenarioIfBothUp).toBeGreaterThan(result.scenarioIfConversionUp);
  });

  it("handles zero remaining days (end of period)", () => {
    const result = analyzeDeficit(10, 20, 0.5, 0, 20);
    expect(result.deficit).toBe(10);
    // With 0 remaining days, period is over — no pace required
    expect(result.requiredDailyPace).toBe(0);
  });

  it("handles zero actual meetings", () => {
    const result = analyzeDeficit(0, 20, 0.5, 10);
    expect(result.deficit).toBe(20);
    expect(result.requiredDailyPace).toBe(2); // 20 / 10
    // With 0 actual, currentDailyRate = 0, so all scenarios project 0
    expect(result.scenarioIfVolumeUp).toBe(0);
    expect(result.scenarioIfConversionUp).toBe(0);
  });

  it("handles zero conversion rate without division errors", () => {
    // When conversionRate is 0, the denominator uses max(0.01, 0) = 0.01
    const result = analyzeDeficit(10, 20, 0, 10, 10);
    expect(result).toBeDefined();
    expect(Number.isFinite(result.scenarioIfConversionUp)).toBe(true);
    expect(Number.isFinite(result.scenarioIfBothUp)).toBe(true);
  });
});

// ─── generateRecommendations ────────────────────────────────

describe("generateRecommendations", () => {
  function makeTeamOverview(
    overrides: Partial<TeamOverview> = {}
  ): TeamOverview {
    return {
      channelBreakdown: { partnerships: 5, conferences: 0, referrals: 0, linkedin: 6, email: 4, inbound: 0, repeat_meeting: 0, irrelevant: 0 },
      totalClassified: 15,
      totalMeetings: 15,
      averageClassificationRate: 0.8,
      teamTarget: [],
      repPerformance: [],
      topWarnings: [],
      trend: [],
      ...overrides,
    };
  }

  function makeTarget(
    metricType: string,
    actual: number,
    target: number
  ): TargetVsActual {
    const deficit = Math.max(0, target - actual);
    return {
      metricType: metricType as TargetVsActual["metricType"],
      target,
      actual,
      variance: actual - target,
      variancePercent: target > 0 ? (actual - target) / target : 0,
      deficit,
      onTrack: actual >= target,
      requiredPace: deficit > 0 ? deficit / 10 : 0,
      remainingDays: 10,
    };
  }

  it("generates recommendation when total meetings are behind target", () => {
    const targets = [makeTarget("total_meetings", 5, 20)];
    const result = generateRecommendations(makeTeamOverview(), [], targets);
    expect(result.length).toBeGreaterThanOrEqual(1);
    const volumeRec = result.find((r) => r.category === "volume");
    expect(volumeRec).toBeDefined();
    expect(volumeRec!.title).toContain("below target");
  });

  it("generates recommendation when partnerships meetings are behind target", () => {
    const targets = [makeTarget("partnerships_meetings", 2, 10)];
    const result = generateRecommendations(makeTeamOverview(), [], targets);
    const partnerRec = result.find((r) => r.category === "channel_mix");
    expect(partnerRec).toBeDefined();
    expect(partnerRec!.title).toContain("below target");
  });

  it("does NOT generate recommendation when on track", () => {
    const targets = [
      makeTarget("total_meetings", 25, 20),
      makeTarget("partnerships_meetings", 15, 10),
    ];
    const result = generateRecommendations(makeTeamOverview(), [], targets);
    expect(result.filter((r) => r.category === "volume")).toHaveLength(0);
    expect(result.filter((r) => r.category === "channel_mix")).toHaveLength(0);
  });

  it("generates recommendation for low conversion stage", () => {
    const conversions: StageConversion[] = [
      {
        fromStage: "lead",
        toStage: "discovery",
        fromStageLabel: "Lead",
        toStageLabel: "Discovery",
        rate: 0.15,
        cumulativeRate: 0.15,
        dealCount: 3,
        fromCount: 20,
      },
    ];
    const result = generateRecommendations(makeTeamOverview(), conversions, []);
    const convRec = result.find((r) => r.category === "conversion");
    expect(convRec).toBeDefined();
    expect(convRec!.severity).toBe("critical"); // rate < 0.2
  });

  it("marks severity as critical when variance exceeds -30%", () => {
    const targets = [makeTarget("total_meetings", 5, 20)]; // -75%
    const result = generateRecommendations(makeTeamOverview(), [], targets);
    const rec = result.find((r) => r.category === "volume");
    expect(rec!.severity).toBe("critical");
  });

  it("marks severity as warning for moderate deficit", () => {
    const targets = [makeTarget("total_meetings", 16, 20)]; // -20%
    const result = generateRecommendations(makeTeamOverview(), [], targets);
    const rec = result.find((r) => r.category === "volume");
    expect(rec!.severity).toBe("warning");
  });

  it("generates per-rep recommendations when reps are behind", () => {
    const teamOverview = makeTeamOverview({
      repPerformance: [
        {
          userId: "rep1",
          userName: "Jane Lim",
          channelBreakdown: { partnerships: 1, conferences: 0, referrals: 0, linkedin: 2, email: 1, inbound: 0, repeat_meeting: 0, irrelevant: 0 },
          totalClassified: 4,
          totalReviewed: 4,
          pendingReview: 2,
          classificationRate: 0.67,
          targetVsActual: [makeTarget("total_meetings", 3, 10)],
          trend: [],
        },
      ],
    });

    const result = generateRecommendations(teamOverview, [], []);
    const repRec = result.find((r) => r.category === "rep_performance");
    expect(repRec).toBeDefined();
    expect(repRec!.title).toContain("Jane Lim");
  });

  it("returns empty recommendations when everything is on track", () => {
    const conversions: StageConversion[] = [
      {
        fromStage: "lead",
        toStage: "won",
        fromStageLabel: "Lead",
        toStageLabel: "Won",
        rate: 0.65,
        cumulativeRate: 0.65,
        dealCount: 13,
        fromCount: 20,
      },
    ];
    const targets = [makeTarget("total_meetings", 25, 20)];
    const result = generateRecommendations(
      makeTeamOverview(),
      conversions,
      targets
    );
    expect(result).toHaveLength(0);
  });
});

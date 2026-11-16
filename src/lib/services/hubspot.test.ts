import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { calculateConversionRates } from "./hubspot";

// ─── Helper: build stage and deal fixtures ──────────────────

function makeStages(
  labels: string[],
  options?: { includeClosedLost?: boolean }
) {
  const stages = labels.map((label, i) => ({
    id: label.toLowerCase().replace(/\s+/g, "_"),
    label,
    displayOrder: i,
  }));
  if (options?.includeClosedLost) {
    stages.push({
      id: "closed_lost",
      label: "Closed Lost",
      displayOrder: labels.length,
    });
  }
  return stages;
}

function makeDeals(stageCounts: Record<string, number>) {
  const deals: { properties: { dealstage: string } }[] = [];
  for (const [stageId, count] of Object.entries(stageCounts)) {
    for (let i = 0; i < count; i++) {
      deals.push({ properties: { dealstage: stageId } });
    }
  }
  return deals;
}

// ─── Core Conversion Rate Calculation ───────────────────────

describe("calculateConversionRates", () => {
  it("calculates correct stage-to-stage and cumulative conversion rates", () => {
    const stages = makeStages([
      "Qualified Lead",
      "Discovery",
      "Proposal",
      "Negotiation",
      "Closed Won",
    ]);

    // 20 deals at qualified, 15 at discovery, 8 at proposal, 4 at negotiation, 2 at won
    // "Reached" counts: qualified=20+15+8+4+2=49, discovery=15+8+4+2=29, proposal=8+4+2=14, negotiation=4+2=6, won=2
    // Total deals = 49
    const deals = makeDeals({
      qualified_lead: 20,
      discovery: 15,
      proposal: 8,
      negotiation: 4,
      closed_won: 2,
    });

    const result = calculateConversionRates(deals, stages);

    expect(result).toHaveLength(4); // 5 stages = 4 transitions

    // Stage-to-stage rates
    expect(result[0].fromStageLabel).toBe("Qualified Lead");
    expect(result[0].toStageLabel).toBe("Discovery");
    expect(result[0].rate).toBeCloseTo(29 / 49, 2);
    expect(result[0].fromCount).toBe(49);
    expect(result[0].dealCount).toBe(29);

    expect(result[1].rate).toBeCloseTo(14 / 29, 2);
    expect(result[2].rate).toBeCloseTo(6 / 14, 2);
    expect(result[3].rate).toBeCloseTo(2 / 6, 2);

    // Cumulative rates (% of all 49 deals reaching each stage)
    expect(result[0].cumulativeRate).toBeCloseTo(29 / 49, 2);
    expect(result[1].cumulativeRate).toBeCloseTo(14 / 49, 2);
    expect(result[2].cumulativeRate).toBeCloseTo(6 / 49, 2);
    expect(result[3].cumulativeRate).toBeCloseTo(2 / 49, 2);
  });

  it("excludes Closed Lost from funnel stages but counts them in denominator", () => {
    const stages = makeStages(
      ["Qualified Lead", "Discovery", "Closed Won"],
      { includeClosedLost: true }
    );

    const deals = makeDeals({
      qualified_lead: 10,
      discovery: 5,
      closed_won: 2,
      closed_lost: 8, // counted in total & first stage, not in funnel progression
    });

    const result = calculateConversionRates(deals, stages);

    // Only 3 funnel stages (Closed Lost excluded) = 2 transitions
    expect(result).toHaveLength(2);

    // Qualified reached: 10+5+2 + 8 (lost deals enter first stage) = 25
    // Discovery reached: 5+2 = 7
    // Won reached: 2
    // Total deals: 25
    expect(result[0].fromCount).toBe(25);
    expect(result[0].dealCount).toBe(7);
    expect(result[0].rate).toBeCloseTo(7 / 25, 2);
    expect(result[1].rate).toBeCloseTo(2 / 7, 2);

    // Cumulative rates: from top of funnel (all 25 deals)
    expect(result[0].cumulativeRate).toBeCloseTo(7 / 25, 2);
    expect(result[1].cumulativeRate).toBeCloseTo(2 / 25, 2);
  });

  it("returns empty array for a single stage", () => {
    const stages = makeStages(["Only Stage"]);
    const deals = makeDeals({ only_stage: 5 });
    const result = calculateConversionRates(deals, stages);
    expect(result).toHaveLength(0);
  });

  it("handles zero deals gracefully", () => {
    const stages = makeStages(["Lead", "Won"]);
    const result = calculateConversionRates([], stages);
    expect(result).toHaveLength(1);
    expect(result[0].rate).toBe(0);
    expect(result[0].cumulativeRate).toBe(0);
    expect(result[0].dealCount).toBe(0);
    expect(result[0].fromCount).toBe(0);
  });

  it("handles empty stages gracefully", () => {
    const deals = makeDeals({ some_stage: 5 });
    const result = calculateConversionRates(deals, []);
    expect(result).toHaveLength(0);
  });

  it("100% conversion when all deals are at the final stage", () => {
    const stages = makeStages(["Lead", "Won"]);
    const deals = makeDeals({ won: 10 });
    const result = calculateConversionRates(deals, stages);
    expect(result).toHaveLength(1);
    // All 10 deals reached lead AND won
    expect(result[0].rate).toBe(1);
    expect(result[0].cumulativeRate).toBe(1);
  });

  it("returns rates rounded to 4 decimal places", () => {
    const stages = makeStages(["A", "B", "C"]);
    // 3 deals at A, 1 at B => reached: A=4, B=1+0=1, but wait:
    // A=3, B=1 => reached A = 3+1=4, reached B = 1 => rate = 1/4 = 0.25
    // B=1, C=0 => rate = 0/1 = 0
    const deals = makeDeals({ a: 3, b: 1 });
    const result = calculateConversionRates(deals, stages);
    expect(result[0].rate).toBe(0.25);
    // Verify it's rounded properly
    expect(String(result[0].rate).split(".")[1]?.length || 0).toBeLessThanOrEqual(4);
  });

  it("deals at unknown stages count in total but only reach first funnel stage", () => {
    const stages = makeStages(["Lead", "Won"]);
    const deals = [
      { properties: { dealstage: "lead" } },
      { properties: { dealstage: "unknown_stage" } },
      { properties: { dealstage: "won" } },
    ];
    const result = calculateConversionRates(deals, stages);
    // lead reached: 1+1(won) + 1(unknown enters first stage) = 3, won reached: 1
    expect(result[0].fromCount).toBe(3);
    expect(result[0].dealCount).toBe(1);
    expect(result[0].rate).toBeCloseTo(1 / 3, 2);
    // Cumulative: 1/3 of all deals reach Won
    expect(result[0].cumulativeRate).toBeCloseTo(1 / 3, 2);
  });

  it("dealCount reflects the number of deals that reached the toStage", () => {
    const stages = makeStages(["Lead", "Proposal", "Won"]);
    const deals = makeDeals({ lead: 10, proposal: 5, won: 2 });
    const result = calculateConversionRates(deals, stages);

    // Lead reached: 17, Proposal reached: 7, Won reached: 2
    expect(result[0].dealCount).toBe(7); // deals that reached Proposal
    expect(result[1].dealCount).toBe(2); // deals that reached Won
  });
});

// ─── Demo Data Conversion Rates ─────────────────────────────

describe("calculateConversionRates — demo pipeline", () => {
  it("produces realistic conversion rates from demo data distribution", () => {
    const stages = [
      { id: "qualified_lead", label: "Qualified Lead", displayOrder: 0 },
      { id: "discovery", label: "Discovery", displayOrder: 1 },
      { id: "proposal", label: "Proposal", displayOrder: 2 },
      { id: "negotiation", label: "Negotiation", displayOrder: 3 },
      { id: "closed_won", label: "Closed Won", displayOrder: 4 },
      { id: "closed_lost", label: "Closed Lost", displayOrder: 5 },
    ];

    // Demo distribution: 15 qualified, 12 discovery, 8 proposal, 5 negotiation, 5 won, 5 lost
    const deals = makeDeals({
      qualified_lead: 15,
      discovery: 12,
      proposal: 8,
      negotiation: 5,
      closed_won: 5,
      closed_lost: 5,
    });

    const result = calculateConversionRates(deals, stages);

    // Closed Lost excluded from funnel stages
    expect(result.every((r) => r.fromStageLabel !== "Closed Lost")).toBe(true);
    expect(result.every((r) => r.toStageLabel !== "Closed Lost")).toBe(true);

    // 5 funnel stages (excl. Closed Lost) = 4 transitions
    expect(result).toHaveLength(4);

    // All rates between 0 and 1
    for (const conversion of result) {
      expect(conversion.rate).toBeGreaterThanOrEqual(0);
      expect(conversion.rate).toBeLessThanOrEqual(1);
      // Cumulative rate should also be valid
      expect(conversion.cumulativeRate).toBeGreaterThanOrEqual(0);
      expect(conversion.cumulativeRate).toBeLessThanOrEqual(1);
      // fromCount and dealCount should be non-negative
      expect(conversion.fromCount).toBeGreaterThanOrEqual(0);
      expect(conversion.dealCount).toBeGreaterThanOrEqual(0);
    }

    // Cumulative rates should decrease down the funnel
    for (let i = 1; i < result.length; i++) {
      expect(result[i].cumulativeRate).toBeLessThanOrEqual(result[i - 1].cumulativeRate);
    }

    // Lost deals (5) should be included in total — first stage count should include them
    // Total = 50, First stage reached = 15+12+8+5+5+5(lost) = 50
    expect(result[0].fromCount).toBe(50);

    const overallConversion = result.reduce((acc, r) => acc * r.rate, 1);
    expect(overallConversion).toBeGreaterThan(0);
    expect(overallConversion).toBeLessThan(1);
  });
});

// ─── HubSpotService — Demo Mode ─────────────────────────────

describe("HubSpotService — demo mode", () => {
  const originalEnv = process.env.DEMO_MODE;

  beforeEach(() => {
    process.env.DEMO_MODE = "true";
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.DEMO_MODE = originalEnv;
    } else {
      delete process.env.DEMO_MODE;
    }
  });

  it("getPipelines returns demo pipeline data", async () => {
    const { HubSpotService } = await import("./hubspot");
    const service = new HubSpotService("test-token");
    const pipelines = await service.getPipelines();

    expect(pipelines).toHaveLength(1);
    expect(pipelines[0].label).toBe("Sales Pipeline");
    expect(pipelines[0].stages.length).toBeGreaterThanOrEqual(5);

    // Verify stages have expected structure
    for (const stage of pipelines[0].stages) {
      expect(stage).toHaveProperty("id");
      expect(stage).toHaveProperty("label");
      expect(stage).toHaveProperty("displayOrder");
      expect(stage.metadata).toHaveProperty("probability");
      expect(stage.metadata).toHaveProperty("isClosed");
    }
  });

  it("getDeals returns demo deals", async () => {
    const { HubSpotService } = await import("./hubspot");
    const service = new HubSpotService("test-token");
    const result = await service.getDeals();

    expect(result.results.length).toBeGreaterThan(0);
    // Verify deal structure
    const deal = result.results[0];
    expect(deal).toHaveProperty("id");
    expect(deal.properties).toHaveProperty("dealname");
    expect(deal.properties).toHaveProperty("amount");
    expect(deal.properties).toHaveProperty("dealstage");
    expect(deal.properties).toHaveProperty("pipeline");
    expect(deal.properties).toHaveProperty("createdate");
  });

  it("getAllDeals returns all demo deals", async () => {
    const { HubSpotService } = await import("./hubspot");
    const service = new HubSpotService("test-token");
    const deals = await service.getAllDeals();

    expect(deals.length).toBe(50); // 15+12+8+5+5+5
    // Verify stage distribution
    const stageCounts = new Map<string, number>();
    for (const deal of deals) {
      const stage = deal.properties.dealstage;
      stageCounts.set(stage, (stageCounts.get(stage) ?? 0) + 1);
    }
    expect(stageCounts.get("qualified_lead")).toBe(15);
    expect(stageCounts.get("closed_won")).toBe(5);
    expect(stageCounts.get("closed_lost")).toBe(5);
  });

  it("getOwners returns demo owners", async () => {
    const { HubSpotService } = await import("./hubspot");
    const service = new HubSpotService("test-token");
    const owners = await service.getOwners();

    expect(owners.length).toBe(4);
    for (const owner of owners) {
      expect(owner).toHaveProperty("id");
      expect(owner).toHaveProperty("email");
      expect(owner).toHaveProperty("firstName");
      expect(owner).toHaveProperty("lastName");
    }
  });

  it("demo deals have valid amounts", async () => {
    const { HubSpotService } = await import("./hubspot");
    const service = new HubSpotService("test-token");
    const deals = await service.getAllDeals();

    for (const deal of deals) {
      const amount = parseFloat(deal.properties.amount!);
      expect(amount).toBeGreaterThanOrEqual(5000);
      expect(amount).toBeLessThanOrEqual(200000);
      expect(amount % 1000).toBe(0); // rounded to nearest $1K
    }
  });

  it("demo deals have valid dates", async () => {
    const { HubSpotService } = await import("./hubspot");
    const service = new HubSpotService("test-token");
    const deals = await service.getAllDeals();

    const now = Date.now();
    const ninetyDaysAgo = now - 90 * 24 * 60 * 60 * 1000;

    for (const deal of deals) {
      const created = new Date(deal.properties.createdate).getTime();
      expect(created).toBeGreaterThanOrEqual(ninetyDaysAgo - 1000);
      expect(created).toBeLessThanOrEqual(now + 1000);
    }
  });

  it("closed won deals have hs_is_closed_won set to true", async () => {
    const { HubSpotService } = await import("./hubspot");
    const service = new HubSpotService("test-token");
    const deals = await service.getAllDeals();

    const wonDeals = deals.filter((d) => d.properties.dealstage === "closed_won");
    for (const deal of wonDeals) {
      expect(deal.properties.hs_is_closed_won).toBe("true");
    }

    const otherDeals = deals.filter((d) => d.properties.dealstage !== "closed_won");
    for (const deal of otherDeals) {
      expect(deal.properties.hs_is_closed_won).toBe("false");
    }
  });
});

// ─── HubSpotService — No Token ──────────────────────────────

describe("HubSpotService — error handling", () => {
  it("throws when no access token and not in demo mode", async () => {
    const originalDemo = process.env.DEMO_MODE;
    const originalToken = process.env.HUBSPOT_ACCESS_TOKEN;
    delete process.env.DEMO_MODE;
    delete process.env.HUBSPOT_ACCESS_TOKEN;

    const { HubSpotService } = await import("./hubspot");
    const service = new HubSpotService("");

    await expect(service.getPipelines()).rejects.toThrow("HubSpot access token");

    // Restore
    if (originalDemo !== undefined) process.env.DEMO_MODE = originalDemo;
    if (originalToken !== undefined) process.env.HUBSPOT_ACCESS_TOKEN = originalToken;
  });
});

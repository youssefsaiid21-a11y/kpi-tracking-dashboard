import type { StageConversion } from "@/types";

// ─── Interfaces ──────────────────────────────────────────────

export interface HubSpotStage {
  id: string;
  label: string;
  displayOrder: number;
  metadata: {
    probability: number;
    isClosed: string;
  };
}

export interface HubSpotPipeline {
  id: string;
  label: string;
  stages: HubSpotStage[];
}

export interface HubSpotDeal {
  id: string;
  properties: {
    dealname: string;
    amount: string | null;
    dealstage: string;
    pipeline: string;
    hubspot_owner_id: string | null;
    closedate: string | null;
    createdate: string;
    hs_lastmodifieddate: string;
    hs_is_closed_won: string;
  };
}

export interface HubSpotOwner {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

// ─── Deal properties requested from the API ─────────────────

const DEAL_PROPERTIES = [
  "dealname",
  "amount",
  "dealstage",
  "pipeline",
  "hubspot_owner_id",
  "closedate",
  "createdate",
  "hs_lastmodifieddate",
  "hs_is_closed_won",
];

// ─── HubSpot Service ────────────────────────────────────────

export class HubSpotService {
  private accessToken: string;
  private baseUrl = "https://api.hubapi.com";
  private demoMode: boolean | undefined;

  constructor(accessToken: string, demoMode?: boolean) {
    this.accessToken = accessToken;
    this.demoMode = demoMode;
  }

  // ── Private API helper ──────────────────────────────────

  private async apiRequest(
    endpoint: string,
    params?: Record<string, string>
  ): Promise<any> {
    if (!this.accessToken) {
      throw new Error(
        "HubSpot access token is not configured. Set HUBSPOT_ACCESS_TOKEN in your environment."
      );
    }

    const url = new URL(`${this.baseUrl}${endpoint}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) =>
        url.searchParams.set(key, value)
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    let response: Response;
    try {
      response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      });
    } catch (err: any) {
      if (err?.name === "AbortError") {
        throw new Error(`HubSpot API request timed out after 30s: ${endpoint}`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `HubSpot API error ${response.status}: ${response.statusText} – ${body}`
      );
    }

    return response.json();
  }

  // ── Public methods ──────────────────────────────────────

  async getPipelines(): Promise<HubSpotPipeline[]> {
    if (isDemoMode(this.demoMode)) {
      return getDemoPipelines();
    }

    const data = await this.apiRequest("/crm/v3/pipelines/deals");
    return data.results as HubSpotPipeline[];
  }

  async getDeals(
    limit = 100,
    after?: string
  ): Promise<{
    results: HubSpotDeal[];
    paging?: { next: { after: string } };
  }> {
    if (isDemoMode(this.demoMode)) {
      return { results: generateDemoDeals() };
    }

    const params: Record<string, string> = {
      limit: String(limit),
      properties: DEAL_PROPERTIES.join(","),
    };
    if (after) {
      params.after = after;
    }

    return this.apiRequest("/crm/v3/objects/deals", params);
  }

  async getAllDeals(): Promise<HubSpotDeal[]> {
    if (isDemoMode(this.demoMode)) {
      return generateDemoDeals();
    }

    const allDeals: HubSpotDeal[] = [];
    let after: string | undefined;

    do {
      const page = await this.getDeals(100, after);
      allDeals.push(...page.results);
      after = page.paging?.next?.after;
    } while (after);

    return allDeals;
  }

  async getOwners(): Promise<HubSpotOwner[]> {
    if (isDemoMode(this.demoMode)) {
      return getDemoOwners();
    }

    const data = await this.apiRequest("/crm/v3/owners");
    return data.results as HubSpotOwner[];
  }
}

// ─── Conversion Rate Calculation ────────────────────────────

export function calculateConversionRates(
  deals: any[],
  stages: any[]
): StageConversion[] {
  // Sort stages by displayOrder. Separate "lost/nurture" stages (terminal branches)
  // from the forward-progressing funnel, but count their deals in the total denominator.
  const allStages = [...stages].sort((a, b) => a.displayOrder - b.displayOrder);

  const isTerminalBranch = (s: { label?: string }) => {
    const label = (s.label || "").toLowerCase();
    return label.includes("closed lost") || label.includes("nurture")
      || label.includes("lost") || label.includes("partner");
  };

  // Find the "Won" stage to cap the funnel — anything after Won is a branch, not a step
  const wonIndex = allStages.findIndex((s) => {
    const label = (s.label || "").toLowerCase();
    return label.includes("won") || label.includes("closed won");
  });

  const funnelStages = allStages.filter((s, idx) => {
    if (isTerminalBranch(s)) return false;
    // Exclude stages after Won (they're branches like Partners, Nurture, etc.)
    if (wonIndex !== -1 && idx > wonIndex) return false;
    return true;
  });

  // Build a map from stage id to its order (funnel stages only)
  const stageOrderMap = new Map<string, number>();
  funnelStages.forEach((s) => stageOrderMap.set(s.id, s.displayOrder));

  // For each funnel stage, count how many deals reached it or beyond.
  const stageCounts = new Map<string, number>();
  funnelStages.forEach((s) => stageCounts.set(s.id, 0));

  // Total deals = ALL deals including lost/nurture — they entered the pipeline
  const totalDeals = deals.length;

  for (const deal of deals) {
    const dealStageId =
      deal.properties?.dealstage ?? deal.dealstage ?? deal.stageId;
    const dealOrder = stageOrderMap.get(dealStageId);

    // Deals at terminal stages (lost/nurture) count in totalDeals but don't
    // progress through the funnel — they dropped out, so they only count
    // toward the first funnel stage (they entered the pipeline).
    if (dealOrder === undefined) {
      // Count toward the first funnel stage only (they entered the pipeline)
      if (funnelStages.length > 0) {
        const firstStage = funnelStages[0];
        stageCounts.set(firstStage.id, (stageCounts.get(firstStage.id) ?? 0) + 1);
      }
      continue;
    }

    // This deal reached every funnel stage up to and including its current stage
    for (const stage of funnelStages) {
      if (stage.displayOrder <= dealOrder) {
        stageCounts.set(stage.id, (stageCounts.get(stage.id) ?? 0) + 1);
      }
    }
  }

  // Calculate both stage-to-stage and cumulative conversion rates
  const conversions: StageConversion[] = [];

  for (let i = 0; i < funnelStages.length - 1; i++) {
    const fromStage = funnelStages[i];
    const toStage = funnelStages[i + 1];
    const fromCount = stageCounts.get(fromStage.id) ?? 0;
    const toCount = stageCounts.get(toStage.id) ?? 0;

    // Stage-to-stage: what % of deals at stage A make it to stage B?
    const rate = fromCount > 0 ? toCount / fromCount : 0;

    // Cumulative: what % of ALL pipeline deals reach this stage?
    const cumulativeRate = totalDeals > 0 ? toCount / totalDeals : 0;

    conversions.push({
      fromStage: fromStage.id,
      toStage: toStage.id,
      fromStageLabel: fromStage.label,
      toStageLabel: toStage.label,
      rate: Math.round(rate * 10000) / 10000,
      cumulativeRate: Math.round(cumulativeRate * 10000) / 10000,
      dealCount: toCount,
      fromCount,
    });
  }

  return conversions;
}

// ─── Demo Mode Helpers ──────────────────────────────────────

function isDemoMode(tenantDemoMode?: boolean): boolean {
  if (tenantDemoMode !== undefined) return tenantDemoMode;
  return process.env.DEMO_MODE === "true";
}

// ── Demo pipelines ────────────────────────────────────────

function getDemoPipelines(): HubSpotPipeline[] {
  return [
    {
      id: "default",
      label: "Sales Pipeline",
      stages: [
        {
          id: "qualified_lead",
          label: "Qualified Lead",
          displayOrder: 0,
          metadata: { probability: 0.2, isClosed: "false" },
        },
        {
          id: "discovery",
          label: "Discovery",
          displayOrder: 1,
          metadata: { probability: 0.4, isClosed: "false" },
        },
        {
          id: "proposal",
          label: "Proposal",
          displayOrder: 2,
          metadata: { probability: 0.6, isClosed: "false" },
        },
        {
          id: "negotiation",
          label: "Negotiation",
          displayOrder: 3,
          metadata: { probability: 0.8, isClosed: "false" },
        },
        {
          id: "closed_won",
          label: "Closed Won",
          displayOrder: 4,
          metadata: { probability: 1.0, isClosed: "true" },
        },
        {
          id: "closed_lost",
          label: "Closed Lost",
          displayOrder: 5,
          metadata: { probability: 0, isClosed: "true" },
        },
      ],
    },
  ];
}

// ── Demo owners ───────────────────────────────────────────

function getDemoOwners(): HubSpotOwner[] {
  return [
    {
      id: "owner_1",
      email: "member-051@organization-014.example",
      firstName: "Demo member",
      lastName: "Chen",
    },
    {
      id: "owner_2",
      email: "member-023@organization-014.example",
      firstName: "Demo member",
      lastName: "Patel",
    },
    {
      id: "owner_3",
      email: "member-032@organization-014.example",
      firstName: "Demo member",
      lastName: "Gonzalez",
    },
    {
      id: "owner_4",
      email: "member-016@organization-014.example",
      firstName: "Demo member",
      lastName: "Kim",
    },
  ];
}

// ── Demo deals ────────────────────────────────────────────

function generateDemoDeals(): HubSpotDeal[] {
  // Seed a simple deterministic random to keep demo data stable per session
  const seed = 42;
  let rngState = seed;
  function rng(): number {
    rngState = (rngState * 16807 + 0) % 2147483647;
    return rngState / 2147483647;
  }

  const companyNames = [
    "Acme Corp",
    "TechNova",
    "BlueSky Solutions",
    "GreenWave Energy",
    "DataForge",
    "CloudMatrix",
    "NexGen Labs",
    "Pinnacle Consulting",
    "Vertex Analytics",
    "Quantum Dynamics",
    "SilverLine Partners",
    "Apex Industries",
    "Horizon Digital",
    "Atlas Ventures",
    "Prism Software",
    "Catalyst Group",
    "Meridian Corp",
    "Stratos Systems",
    "Vanguard Tech",
    "Eclipse Solutions",
  ];

  const dealTypes = [
    "Enterprise License",
    "Platform Subscription",
    "Annual Contract",
    "Pilot Program",
    "Expansion Deal",
    "Professional Services",
    "Integration Package",
    "Analytics Suite",
  ];

  const ownerIds = ["owner_1", "owner_2", "owner_3", "owner_4"];

  // Target distribution to produce the desired funnel conversion rates:
  //   ~70% Qualified->Discovery  => of 50 deals, ~50 enter qualified, ~35 reach discovery
  //   ~50% Discovery->Proposal   => ~17-18 reach proposal
  //   ~60% Proposal->Negotiation => ~10-11 reach negotiation
  //   ~40% Negotiation->Won      => ~4-5 close won
  //   remaining closed lost
  const stageDistribution: { stageId: string; count: number; isClosed: string }[] = [
    { stageId: "qualified_lead", count: 15, isClosed: "false" },
    { stageId: "discovery", count: 12, isClosed: "false" },
    { stageId: "proposal", count: 8, isClosed: "false" },
    { stageId: "negotiation", count: 5, isClosed: "false" },
    { stageId: "closed_won", count: 5, isClosed: "true" },
    { stageId: "closed_lost", count: 5, isClosed: "true" },
  ];

  const totalDeals = stageDistribution.reduce((s, d) => s + d.count, 0); // 50
  const now = Date.now();
  const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;

  const deals: HubSpotDeal[] = [];
  let dealIndex = 0;

  for (const bucket of stageDistribution) {
    for (let i = 0; i < bucket.count; i++) {
      const company =
        companyNames[dealIndex % companyNames.length];
      const dealType =
        dealTypes[Math.floor(rng() * dealTypes.length)];
      const amount =
        Math.round((5000 + rng() * 195000) / 1000) * 1000; // $5K–$200K rounded to nearest $1K
      const createdOffset = Math.floor(rng() * ninetyDaysMs);
      const createdDate = new Date(now - createdOffset);
      const modifiedDate = new Date(
        createdDate.getTime() +
          Math.floor(rng() * (now - createdDate.getTime()))
      );
      const closeDate =
        bucket.stageId === "closed_won" || bucket.stageId === "closed_lost"
          ? new Date(
              createdDate.getTime() +
                Math.floor(
                  rng() * (now - createdDate.getTime())
                )
            )
          : null;

      deals.push({
        id: `demo_deal_${dealIndex + 1}`,
        properties: {
          dealname: `${company} – ${dealType}`,
          amount: String(amount),
          dealstage: bucket.stageId,
          pipeline: "default",
          hubspot_owner_id: ownerIds[dealIndex % ownerIds.length],
          closedate: closeDate ? closeDate.toISOString() : null,
          createdate: createdDate.toISOString(),
          hs_lastmodifieddate: modifiedDate.toISOString(),
          hs_is_closed_won:
            bucket.stageId === "closed_won" ? "true" : "false",
        },
      });

      dealIndex++;
    }
  }

  return deals;
}

import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { apiHandler } from "@/lib/api-handler";
import { getCached, setCache } from "@/lib/cache";
import { calculateConversionRates } from "@/lib/services/hubspot";
import { getDateRange } from "@/lib/utils";
import { PeriodSchema } from "@/lib/schemas";
import type { TimePeriod } from "@/types";

// ── Zod schema for query params ──────────────────────────────
const ConversionQuerySchema = z.object({
  period: PeriodSchema.default("monthly"),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  pipelineId: z.string().optional(),
});

const CACHE_TTL = parseInt(process.env.CACHE_TTL_CONVERSION ?? "300", 10);

export const GET = apiHandler(
  async (_req, { session, query }) => {
    const tenantId = session.user.tenantId;
    const { period, startDate: customStart, endDate: customEnd, pipelineId } = query;

    const dateRange = getDateRange(
      period as TimePeriod,
      customStart,
      customEnd,
    );

    // ── Cache check ──────────────────────────────────────────
    const cacheKey = `t:${tenantId}:conversion:${period}:${dateRange.start.toISOString()}:${dateRange.end.toISOString()}:${pipelineId ?? "all"}`;
    const cached = getCached<object>(cacheKey);
    if (cached) {
      return NextResponse.json({ success: true, data: cached });
    }

    // ── Build filters ────────────────────────────────────────
    const stageWhere: Record<string, unknown> = { tenantId };
    if (pipelineId) {
      stageWhere.pipelineId = pipelineId;
    }

    // Parallelize: stages + pipeline lookup (needed for deal filtering)
    const [stages, pipeline] = await Promise.all([
      prisma.pipelineStage.findMany({
        where: stageWhere,
        orderBy: { displayOrder: "asc" },
        include: { pipeline: true },
        take: parseInt(process.env.PIPELINE_STAGE_LIMIT ?? "500", 10),
      }),
      pipelineId
        ? prisma.pipelineDefinition.findFirst({
            where: { id: pipelineId, tenantId },
          })
        : Promise.resolve(null),
    ]);

    if (stages.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          stages: [],
          conversionRates: [],
          totalDeals: 0,
          dateRange: {
            start: dateRange.start.toISOString(),
            end: dateRange.end.toISOString(),
            period: dateRange.period,
            label: dateRange.label,
          },
        },
      });
    }

    // ── Build deal filters using the shared pipeline result ──
    const dealWhere: Record<string, unknown> = {
      tenantId,
      createDate: { gte: dateRange.start, lte: dateRange.end },
    };
    if (pipeline) {
      dealWhere.pipelineHubspotId = pipeline.hubspotId;
    }

    const periodDurationMs = dateRange.end.getTime() - dateRange.start.getTime();
    const prevStart = new Date(dateRange.start.getTime() - periodDurationMs);
    const prevEnd = dateRange.start;

    const prevDealWhere: Record<string, unknown> = {
      tenantId,
      createDate: { gte: prevStart, lte: prevEnd },
    };
    if (pipeline) {
      prevDealWhere.pipelineHubspotId = pipeline.hubspotId;
    }

    // Parallelize: current deals + previous deals
    const [deals, prevDeals] = await Promise.all([
      prisma.hubSpotDeal.findMany({
        where: dealWhere,
        select: { stage: { select: { hubspotId: true } } },
        take: parseInt(process.env.DEAL_QUERY_LIMIT ?? "50000", 10),
      }),
      prisma.hubSpotDeal.findMany({
        where: prevDealWhere,
        select: { stage: { select: { hubspotId: true } } },
        take: parseInt(process.env.DEAL_QUERY_LIMIT ?? "50000", 10),
      }),
    ]);

    // ── Compute conversion rates ─────────────────────────────
    const stageData = stages.map((s) => ({
      id: s.hubspotId,
      label: s.label,
      displayOrder: s.displayOrder,
    }));

    const dealData = deals.map((d) => ({ properties: { dealstage: d.stage.hubspotId } }));
    const conversionRates = calculateConversionRates(dealData, stageData);

    // ── Build stage summary (funnel stages only) ─────────────
    const sortedStages = [...stages].sort((a, b) => a.displayOrder - b.displayOrder);
    const wonIdx = sortedStages.findIndex((s) => {
      const label = s.label.toLowerCase();
      return label.includes("won") || label.includes("closed won");
    });
    const funnelStageLabels = sortedStages.filter((s, idx) => {
      const label = s.label.toLowerCase();
      if (label.includes("closed lost") || label.includes("nurture")
        || label.includes("lost") || label.includes("partner")) return false;
      if (wonIdx !== -1 && idx > wonIdx) return false;
      return true;
    });

    const stageSummary = funnelStageLabels.map((s, idx) => {
      if (idx === 0) {
        return { stage: s.label, dealCount: deals.length };
      }
      const conv = conversionRates.find((c) => c.toStageLabel === s.label);
      return { stage: s.label, dealCount: conv?.dealCount ?? 0 };
    });

    // ── Period comparison ────────────────────────────────────
    let periodComparison: { current: typeof conversionRates; previous: typeof conversionRates } | undefined;
    if (prevDeals.length > 0) {
      const prevDealData = prevDeals.map((d) => ({ properties: { dealstage: d.stage.hubspotId } }));
      const prevConversionRates = calculateConversionRates(prevDealData, stageData);
      periodComparison = { current: conversionRates, previous: prevConversionRates };
    }

    const result = {
      pipelines: [...new Map(stages.map((s) => [s.pipeline.id, { id: s.pipeline.id, name: s.pipeline.label }])).values()],
      stages: stageSummary.map((s) => ({
        label: s.stage,
        dealCount: s.dealCount,
      })),
      conversionRates,
      totalDeals: deals.length,
      periodComparison,
      dateRange: {
        start: dateRange.start.toISOString(),
        end: dateRange.end.toISOString(),
        period: dateRange.period,
        label: dateRange.label,
      },
    };

    setCache(cacheKey, result, CACHE_TTL);

    return NextResponse.json({ success: true, data: result });
  },
  { query: ConversionQuerySchema },
);

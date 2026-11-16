/**
 * GET /api/analytics/team — Team-level KPI overview.
 *
 * v2: Delegates to kpi-calculator.getTeamOverview() which uses batched
 * groupBy queries instead of N+1 per-rep loops. Also uses caching.
 *
 * v3: Uses getConversionRates() from kpi-calculator instead of
 * duplicating pipelineStage/hubSpotDeal queries.
 */

import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api-handler";
import { getDateRange } from "@/lib/utils";
import { getTeamOverview, getConversionRates } from "@/lib/services/kpi-calculator";
import { generateRecommendations } from "@/lib/services/deficit-analyzer";
import type { TimePeriod, StageConversion } from "@/types";

export const GET = apiHandler(
  async (req, session) => {
    const tenantId = session.user.tenantId;
    const { searchParams } = req.nextUrl;
    const period = (searchParams.get("period") || "monthly") as TimePeriod;
    const customStart = searchParams.get("startDate");
    const customEnd = searchParams.get("endDate");

    const dateRange = getDateRange(
      period,
      customStart ? new Date(customStart) : undefined,
      customEnd ? new Date(customEnd) : undefined
    );

    // Single call — batched queries + caching inside
    const overview = await getTeamOverview(tenantId, dateRange.start, dateRange.end);

    // FIX #7: Reuse getConversionRates() (cached) instead of re-querying
    let conversionRates: StageConversion[] = [];
    try {
      conversionRates = await getConversionRates(tenantId);
    } catch {
      // Pipeline data may not exist yet
    }

    const recommendations = generateRecommendations(
      overview,
      conversionRates,
      overview.teamTarget
    );

    return NextResponse.json({
      success: true,
      data: {
        overview,
        recommendations,
        dateRange: {
          start: dateRange.start.toISOString(),
          end: dateRange.end.toISOString(),
          period: dateRange.period,
          label: dateRange.label,
        },
      },
    });
  },
  { roles: ["manager", "admin"] }
);

import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api-handler";
import { isManagerOrAdmin } from "@/lib/api-auth";
import { getDateRange } from "@/lib/utils";
import { getRepMetrics, getTrendData, buildTargetVsActual } from "@/lib/services/kpi-calculator";
import prisma from "@/lib/prisma";
import { AnalyticsQuerySchema } from "@/lib/schemas";
import type { TargetVsActual } from "@/types";

export const GET = apiHandler(
  async (req, { session, query }) => {
    const tenantId = session.user.tenantId;
    const { period, startDate: customStart, endDate: customEnd, userId: requestedUserId } = query;

    let targetUserId = session.user.id;
    if (requestedUserId && requestedUserId !== session.user.id) {
      if (!isManagerOrAdmin(session.user.role)) {
        return NextResponse.json(
          { success: false, error: "Forbidden: cannot view other users' analytics" },
          { status: 403 }
        );
      }
      targetUserId = requestedUserId;
    }

    const dateRange = getDateRange(period ?? "monthly", customStart, customEnd);

    const [metrics, targets, trend] = await Promise.all([
      getRepMetrics(tenantId, targetUserId, dateRange.start, dateRange.end),
      prisma.targetConfig.findMany({
        where: {
          tenantId,
          isActive: true,
          OR: [{ userId: targetUserId }, { userId: null }],
        },
      }),
      getTrendData(tenantId, targetUserId, dateRange.start, dateRange.end),
    ]);

    const targetVsActual: TargetVsActual[] = targets.map((t) =>
      buildTargetVsActual(t, metrics.channelBreakdown, dateRange.end, metrics.conversionRates)
    );

    return NextResponse.json({
      success: true,
      data: {
        metrics,
        targetVsActual,
        trend,
        dateRange: {
          start: dateRange.start.toISOString(),
          end: dateRange.end.toISOString(),
          period: dateRange.period,
          label: dateRange.label,
        },
      },
    });
  },
  { query: AnalyticsQuerySchema }
);

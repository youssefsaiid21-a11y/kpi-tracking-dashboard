/**
 * POST /api/insights/data
 *
 * Returns flexible chart data based on a requested data source.
 * Used by the Insights page to populate custom charts and dashboards.
 */

import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api-handler";
import { InsightsDataSchema } from "@/lib/schemas";
import { isManagerOrAdmin } from "@/lib/api-auth";
import prisma from "@/lib/prisma";
import { getDateRange } from "@/lib/utils";
import {
  getRepMetrics,
  getTeamMetrics,
  getTrendData,
  getConversionRates,
  buildTargetVsActual,
} from "@/lib/services/kpi-calculator";
import { METRIC_TYPE_DISPLAY } from "@/constants";
import { startOfWeek, format } from "date-fns";
import type { z } from "zod";
import type { MeetingChannel, MetricType, TimePeriod } from "@/types";

type InsightsDataBody = z.infer<typeof InsightsDataSchema>;

export const POST = apiHandler(
  async (_req, { session, body }) => {
    const { dataSource, period, startDate, endDate, filters } = body;
    const tenantId = session.user.tenantId;

    // Resolve date range from period (or custom start/end)
    const dateRange = getDateRange(
      period as TimePeriod,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );
    const { start, end } = dateRange;

    let rows: unknown[];

    switch (dataSource) {
      // ── 1. Channel Breakdown ────────────────────────────────
      case "channel_breakdown": {
        const metrics = filters?.userId
          ? await getRepMetrics(tenantId, filters.userId, start, end)
          : await getTeamMetrics(tenantId, start, end);

        rows = Object.entries(metrics.channelBreakdown)
          .filter(([channel]) => channel !== "irrelevant")
          .map(([channel, count]) => ({ channel, count }));
        break;
      }

      // ── 2. Weekly Trend ─────────────────────────────────────
      case "weekly_trend": {
        const trendData = await getTrendData(
          tenantId,
          filters?.userId ?? null,
          start,
          end,
        );

        rows = trendData.map((point) => ({
          date: point.date,
          ...point.channels,
          total: point.total,
        }));
        break;
      }

      // ── 3. Conversion Funnel ────────────────────────────────
      case "conversion_funnel": {
        const rates = await getConversionRates(tenantId);

        rows = rates.map((cr) => ({
          label: `${cr.fromStageLabel} \u2192 ${cr.toStageLabel}`,
          fromStage: cr.fromStage,
          toStage: cr.toStage,
          rate: cr.rate,
          cumulativeRate: cr.cumulativeRate,
          dealCount: cr.dealCount,
          fromCount: cr.fromCount,
        }));
        break;
      }

      // ── 4. Target vs Actual ─────────────────────────────────
      case "target_vs_actual": {
        const targetConfigs = await prisma.targetConfig.findMany({
          where: {
            tenantId,
            isActive: true,
            OR: [
              { userId: filters?.userId ?? null },
              { userId: null },
            ],
          },
        });

        // Fetch metrics to get channelBreakdown and conversionRates
        const metrics = filters?.userId
          ? await getRepMetrics(tenantId, filters.userId, start, end)
          : await getTeamMetrics(tenantId, start, end);

        rows = targetConfigs.map((tc) => {
          const result = buildTargetVsActual(
            tc,
            metrics.channelBreakdown,
            end,
            metrics.conversionRates,
          );
          return {
            metricLabel:
              METRIC_TYPE_DISPLAY[tc.metricType as MetricType] ??
              tc.metricType,
            metricType: result.metricType,
            target: result.target,
            actual: result.actual,
            deficit: result.deficit,
            onTrack: result.onTrack,
          };
        });
        break;
      }

      // ── 5. Rep Performance (managers/admins only) ───────────
      case "rep_performance": {
        if (!isManagerOrAdmin(session.user.role)) {
          return NextResponse.json(
            { success: false, error: "Forbidden: manager or admin role required" },
            { status: 403 },
          );
        }

        const eventFilter = {
          tenantId,
          startTime: { gte: start, lte: end },
          isFiltered: false,
        };

        const [users, reviewCounts, eligibleCounts, pendingCounts] = await Promise.all([
          prisma.user.findMany({
            where: { tenantId, isActive: true },
            select: { id: true, name: true },
          }),
          prisma.meetingReview.findMany({
            where: {
              event: {
                tenantId,
                startTime: { gte: start, lte: end },
                isFiltered: false,
              },
            },
            select: {
              confirmedLabel: true,
              event: { select: { userId: true } },
            },
          }).then((rawRows) => {
            const map = new Map<string, Map<string, number>>();
            for (const r of rawRows) {
              const uid = r.event.userId;
              if (!map.has(uid)) map.set(uid, new Map());
              const labelMap = map.get(uid)!;
              labelMap.set(r.confirmedLabel, (labelMap.get(r.confirmedLabel) ?? 0) + 1);
            }
            const result: Array<{ userId: string; confirmedLabel: string; _count: number }> = [];
            for (const [userId, labelMap] of map) {
              for (const [confirmedLabel, count] of labelMap) {
                result.push({ userId, confirmedLabel, _count: count });
              }
            }
            return result;
          }),
          prisma.calendarEvent.groupBy({
            by: ["userId"],
            where: eventFilter,
            _count: true,
          }),
          // Pending = eligible events without a review (moved into Promise.all)
          prisma.calendarEvent.groupBy({
            by: ["userId"],
            where: { ...eventFilter, review: null },
            _count: true,
          }),
        ]);

        // Build per-rep channel maps
        const repMap = new Map<
          string,
          Record<MeetingChannel, number> & { totalReviewed: number }
        >();
        for (const row of reviewCounts) {
          if (!repMap.has(row.userId)) {
            repMap.set(row.userId, {
              partnerships: 0,
              conferences: 0,
              referrals: 0,
              linkedin: 0,
              email: 0,
              inbound: 0,
              repeat_meeting: 0,
              irrelevant: 0,
              totalReviewed: 0,
            });
          }
          const entry = repMap.get(row.userId)!;
          entry.totalReviewed += row._count;
          const ch = row.confirmedLabel as MeetingChannel;
          if (ch in entry) {
            (entry as Record<string, number>)[ch] += row._count;
          }
        }

        const eligibleMap = new Map(
          eligibleCounts.map((r) => [r.userId, r._count]),
        );

        const pendingMap = new Map(
          pendingCounts.map((r) => [r.userId, r._count]),
        );

        rows = users.map((user) => {
          const data = repMap.get(user.id);
          const eligible = eligibleMap.get(user.id) ?? 0;
          const totalReviewed = data?.totalReviewed ?? 0;
          const pending = pendingMap.get(user.id) ?? 0;
          const classificationRate =
            eligible > 0 ? totalReviewed / eligible : 0;

          // Sum all non-irrelevant channels for totalClassified
          const totalClassified =
            (data?.partnerships ?? 0) +
            (data?.conferences ?? 0) +
            (data?.referrals ?? 0) +
            (data?.linkedin ?? 0) +
            (data?.email ?? 0) +
            (data?.inbound ?? 0);

          return {
            userName: user.name ?? "Unknown",
            userId: user.id,
            totalClassified,
            pendingReview: pending,
            classificationRate,
            partnerships: data?.partnerships ?? 0,
            conferences: data?.conferences ?? 0,
            referrals: data?.referrals ?? 0,
            linkedin: data?.linkedin ?? 0,
            email: data?.email ?? 0,
            inbound: data?.inbound ?? 0,
          };
        });
        break;
      }

      // ── 6. Deal Pipeline ────────────────────────────────────
      case "deal_pipeline": {
        const pipelineFilter: Record<string, unknown> = { tenantId };
        if (filters?.pipelineId) {
          pipelineFilter.stage = { pipelineId: filters.pipelineId };
        }

        const [dealGroups, stages] = await Promise.all([
          prisma.hubSpotDeal.groupBy({
            by: ["stageId"],
            where: pipelineFilter,
            _count: true,
            _sum: { amount: true },
          }),
          prisma.pipelineStage.findMany({
            where: { tenantId },
            orderBy: { displayOrder: "asc" },
            select: { id: true, label: true, displayOrder: true },
          }),
        ]);

        const stageMap = new Map(
          stages.map((s) => [s.id, { label: s.label, order: s.displayOrder }]),
        );

        rows = dealGroups
          .map((g) => {
            const stageInfo = stageMap.get(g.stageId);
            return {
              stage: stageInfo?.label ?? "Unknown",
              dealCount: g._count,
              totalValue: g._sum.amount ?? 0,
              _order: stageInfo?.order ?? 999,
            };
          })
          .sort((a, b) => a._order - b._order)
          .map(({ _order, ...rest }) => rest);
        break;
      }

      // ── 7. Deal Timeline ────────────────────────────────────
      case "deal_timeline": {
        const timelineFilter: Record<string, unknown> = { tenantId };
        if (filters?.pipelineId) {
          timelineFilter.stage = { pipelineId: filters.pipelineId };
        }

        const deals = await prisma.hubSpotDeal.findMany({
          where: {
            ...timelineFilter,
            createDate: { gte: start, lte: end },
          },
          select: { createDate: true, amount: true },
        });

        // Group by week using date-fns (portable, not SQLite-specific)
        const weekBuckets = new Map<
          string,
          { count: number; value: number }
        >();
        for (const deal of deals) {
          if (!deal.createDate) continue;
          const weekStart = startOfWeek(deal.createDate, {
            weekStartsOn: 1,
          });
          const weekKey = format(weekStart, "yyyy-MM-dd");
          const bucket = weekBuckets.get(weekKey) ?? {
            count: 0,
            value: 0,
          };
          bucket.count++;
          bucket.value += deal.amount ?? 0;
          weekBuckets.set(weekKey, bucket);
        }

        rows = Array.from(weekBuckets.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([week, bucket]) => ({
            week,
            count: bucket.count,
            value: bucket.value,
          }));
        break;
      }

      // ── 8. Classification Rate ──────────────────────────────
      case "classification_rate": {
        const classEventFilter = {
          tenantId,
          startTime: { gte: start, lte: end },
          isFiltered: false,
        };

        // Database-agnostic: fetch records and group by week in JS
        const [eligibleEvents, reviewedEvents] = await Promise.all([
          prisma.calendarEvent.findMany({
            where: classEventFilter,
            select: { startTime: true },
          }),
          prisma.meetingReview.findMany({
            where: { event: classEventFilter },
            select: { event: { select: { startTime: true } } },
          }),
        ]);

        // Group by ISO week in JS
        const toWeekKey = (d: Date) =>
          format(startOfWeek(d, { weekStartsOn: 1 }), "yyyy-'W'II");

        const eligibleByWeek = new Map<string, number>();
        for (const e of eligibleEvents) {
          const wk = toWeekKey(e.startTime);
          eligibleByWeek.set(wk, (eligibleByWeek.get(wk) ?? 0) + 1);
        }

        const reviewedByWeek = new Map<string, number>();
        for (const r of reviewedEvents) {
          const wk = toWeekKey(r.event.startTime);
          reviewedByWeek.set(wk, (reviewedByWeek.get(wk) ?? 0) + 1);
        }

        const allWeeks = new Set([
          ...eligibleByWeek.keys(),
          ...reviewedByWeek.keys(),
        ]);

        rows = Array.from(allWeeks)
          .sort()
          .map((week) => {
            const eligible = eligibleByWeek.get(week) ?? 0;
            const reviewed = reviewedByWeek.get(week) ?? 0;
            return {
              week,
              rate: eligible > 0 ? reviewed / eligible : 0,
              eligible,
              reviewed,
            };
          });
        break;
      }

      default: {
        return NextResponse.json(
          { success: false, error: `Unknown data source: ${dataSource}` },
          { status: 400 },
        );
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        rows,
        meta: {
          dataSource,
          dateRange: {
            start: start.toISOString(),
            end: end.toISOString(),
            period,
          },
        },
      },
    });
  },
  { body: InsightsDataSchema },
);

/**
 * KPI Calculator — single source of truth for all meeting and pipeline metrics.
 *
 * Every API route delegates to these functions instead of reimplementing
 * counting logic. This eliminates the v1 bug where api/analytics/route.ts
 * and this file produced different numbers (status filter mismatch).
 *
 * v2 improvements:
 * - Batched groupBy queries replace N+1 loops in getTeamOverview
 * - Optional caching for expensive team-level aggregations
 * - Consistent counting: always counts MeetingReview with event date filter
 *
 * v3 performance improvements:
 * - Parallelized independent DB queries in getTeamOverview and getRepPerformance
 * - Added caching to getRepMetrics and getTrendData
 * - Added 12-month date filter to getConversionRates (was loading ALL deals)
 *
 * v4 multi-tenant:
 * - Every exported function takes tenantId as first parameter
 * - All Prisma where clauses include tenantId
 * - All cache keys prefixed with t:${tenantId}:
 *
 * v5 channel-based redesign:
 * - Replaced outboundMeetings/partnerMeetings with channelBreakdown
 * - All channels tracked via confirmedLabel groupBy
 * - Trend data tracks per-channel counts per week
 * - buildTargetVsActual handles channel-specific metric types
 */

import prisma from "@/lib/prisma";
import { getRemainingBusinessDays, severityOrder } from "@/lib/utils";
import { getCached, setCache } from "@/lib/cache";
import type {
  KPIMetrics,
  RepPerformance,
  TeamOverview,
  TrendPoint,
  TargetVsActual,
  StageConversion,
  MetricType,
  MeetingChannel,
  AnomalySummary,
} from "@/types";
import { calculateConversionRates } from "@/lib/services/hubspot";
import { subMonths } from "date-fns";

const CACHE_TTL = 300; // 5 minutes

/** All valid non-irrelevant channels that count toward totalMeetings */
const CLASSIFIED_CHANNELS: MeetingChannel[] = [
  "partnerships", "conferences", "referrals", "linkedin", "email", "inbound", "repeat_meeting",
];

/** Build an empty channel breakdown record */
function emptyChannelBreakdown(): Record<MeetingChannel, number> {
  return {
    partnerships: 0, conferences: 0, referrals: 0,
    linkedin: 0, email: 0, inbound: 0, repeat_meeting: 0, irrelevant: 0,
  };
}

/** Sum all non-irrelevant channels */
function sumClassified(breakdown: Record<MeetingChannel, number>): number {
  return CLASSIFIED_CHANNELS.reduce((sum, ch) => sum + (breakdown[ch] ?? 0), 0);
}

/** Map a metricType like "linkedin_meetings" to the channel key "linkedin" */
function metricTypeToChannel(metricType: string): MeetingChannel | null {
  const match = metricType.match(/^(.+)_meetings$/);
  if (!match) return null;
  const key = match[1] as MeetingChannel;
  if (key === "total" as any) return null; // total_meetings is handled separately
  return key;
}

// ─── Shared: conversion rates from HubSpot data ─────────────

export async function getConversionRates(tenantId: string): Promise<StageConversion[]> {
  const cached = getCached<StageConversion[]>(`t:${tenantId}:conversion_rates`);
  if (cached) return cached;

  // FIX #5: Add date filter — only load deals from last 12 months
  const twelveMonthsAgo = subMonths(new Date(), 12);

  const [stages, deals] = await Promise.all([
    prisma.pipelineStage.findMany({
      where: { tenantId },
      orderBy: { displayOrder: "asc" },
    }),
    prisma.hubSpotDeal.findMany({
      where: { tenantId, updatedAt: { gte: twelveMonthsAgo } },
      select: { stage: { select: { hubspotId: true } } },
    }),
  ]);

  const dealData = deals.map((d) => ({ properties: { dealstage: d.stage.hubspotId } }));
  const stageData = stages.map((s) => ({
    id: s.hubspotId,
    label: s.label,
    displayOrder: s.displayOrder,
  }));

  const rates = calculateConversionRates(dealData, stageData);
  setCache(`t:${tenantId}:conversion_rates`, rates, CACHE_TTL);
  return rates;
}

// ─── getRepMetrics ────────────────────────────────────────────

export async function getRepMetrics(
  tenantId: string,
  userId: string,
  startDate: Date,
  endDate: Date
): Promise<KPIMetrics> {
  // FIX #2: Add caching
  const cacheKey = `t:${tenantId}:rep_metrics:${userId}:${startDate.toISOString()}:${endDate.toISOString()}`;
  const cached = getCached<KPIMetrics>(cacheKey);
  if (cached) return cached;

  const eventFilter = {
    tenantId,
    userId,
    startTime: { gte: startDate, lte: endDate },
    isFiltered: false,
  };

  // Parallel: groupBy for channel counts + total eligible (no full record load)
  const [reviewGroups, totalEligible, conversionRates] =
    await Promise.all([
      prisma.meetingReview.groupBy({
        by: ["confirmedLabel"],
        where: { event: eventFilter },
        _count: { confirmedLabel: true },
      }),
      prisma.calendarEvent.count({ where: eventFilter }),
      getConversionRates(tenantId),
    ]);

  // Build channel breakdown from groupBy results
  const channelBreakdown = emptyChannelBreakdown();
  let totalReviewed = 0;
  for (const group of reviewGroups) {
    const ch = group.confirmedLabel as MeetingChannel;
    if (ch in channelBreakdown) {
      channelBreakdown[ch] = group._count.confirmedLabel;
    }
    totalReviewed += group._count.confirmedLabel;
  }

  const totalClassified = sumClassified(channelBreakdown);
  const classificationRate = totalEligible > 0 ? totalReviewed / totalEligible : 0;

  const result: KPIMetrics = {
    channelBreakdown,
    totalClassified,
    totalMeetings: totalClassified,
    classificationRate,
    conversionRates,
  };

  setCache(cacheKey, result, CACHE_TTL);
  return result;
}

// ─── getTeamMetrics ───────────────────────────────────────────

export async function getTeamMetrics(
  tenantId: string,
  startDate: Date,
  endDate: Date
): Promise<KPIMetrics> {
  const eventFilter = {
    tenantId,
    startTime: { gte: startDate, lte: endDate },
    isFiltered: false,
  };

  const [reviewGroups, totalEligible, conversionRates] =
    await Promise.all([
      prisma.meetingReview.groupBy({
        by: ["confirmedLabel"],
        where: { event: eventFilter },
        _count: { confirmedLabel: true },
      }),
      prisma.calendarEvent.count({ where: eventFilter }),
      getConversionRates(tenantId),
    ]);

  const channelBreakdown = emptyChannelBreakdown();
  let totalReviewed = 0;
  for (const group of reviewGroups) {
    const ch = group.confirmedLabel as MeetingChannel;
    if (ch in channelBreakdown) {
      channelBreakdown[ch] = group._count.confirmedLabel;
    }
    totalReviewed += group._count.confirmedLabel;
  }

  const totalClassified = sumClassified(channelBreakdown);
  const classificationRate = totalEligible > 0 ? totalReviewed / totalEligible : 0;

  return {
    channelBreakdown,
    totalClassified,
    totalMeetings: totalClassified,
    classificationRate,
    conversionRates,
  };
}

// ─── getTeamOverview (batched — replaces N+1 loop) ───────────

export async function getTeamOverview(
  tenantId: string,
  startDate: Date,
  endDate: Date
): Promise<TeamOverview> {
  const cacheKey = `t:${tenantId}:team_overview:${startDate.toISOString()}:${endDate.toISOString()}`;
  const cached = getCached<TeamOverview>(cacheKey);
  if (cached) return cached;

  // FIX #1: Run getTeamMetrics and getTrendData in parallel (they are independent)
  const [teamMetrics, trend] = await Promise.all([
    getTeamMetrics(tenantId, startDate, endDate),
    getTrendData(tenantId, null, startDate, endDate),
  ]);

  const eventFilter = {
    tenantId,
    startTime: { gte: startDate, lte: endDate },
    isFiltered: false,
  };

  // FIX #1: Run all remaining independent queries in a single Promise.all
  // Use raw SQL groupBy to avoid loading all review records into memory
  const [users, reviewCounts, eligibleCounts, pendingCounts, allTargets, rawAnomalies] =
    await Promise.all([
      // Get all active users
      prisma.user.findMany({
        where: { tenantId, isActive: true },
        select: { id: true, name: true },
      }),
      // BATCHED: raw SQL GROUP BY userId+confirmedLabel (no full record load)
      prisma.$queryRawUnsafe<Array<{ userId: string; confirmedLabel: string; cnt: bigint | number }>>(
        `SELECT ce."userId", mr."confirmedLabel", COUNT(*) as cnt
         FROM "MeetingReview" mr
         JOIN "CalendarEvent" ce ON mr."eventId" = ce."id"
         WHERE ce."tenantId" = '${tenantId}'
           AND ce."startTime" >= '${startDate.toISOString()}'
           AND ce."startTime" <= '${endDate.toISOString()}'
           AND ce."isFiltered" = 0
         GROUP BY ce."userId", mr."confirmedLabel"`
      ).then((rawRows) =>
        rawRows.map((r) => ({
          userId: String(r.userId),
          confirmedLabel: String(r.confirmedLabel),
          _count: Number(r.cnt),
        }))
      ),
      // BATCHED: total eligible per user
      prisma.calendarEvent.groupBy({
        by: ["userId"],
        where: eventFilter,
        _count: true,
      }),
      // BATCHED: pending per user
      prisma.calendarEvent.groupBy({
        by: ["userId"],
        where: { ...eventFilter, review: null },
        _count: true,
      }),
      // Per-rep targets
      prisma.targetConfig.findMany({
        where: { tenantId, isActive: true },
      }),
      // Anomalies (top 20 unresolved, sorted later)
      prisma.anomaly.findMany({
        where: { tenantId, isResolved: false },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
    ]);

  // Build per-rep maps from batched results — channel breakdown per rep
  const repReviewMap = new Map<string, { channels: Record<MeetingChannel, number>; total: number }>();
  for (const row of reviewCounts) {
    if (!repReviewMap.has(row.userId)) {
      repReviewMap.set(row.userId, { channels: emptyChannelBreakdown(), total: 0 });
    }
    const entry = repReviewMap.get(row.userId)!;
    entry.total += row._count;
    const ch = row.confirmedLabel as MeetingChannel;
    if (ch in entry.channels) {
      entry.channels[ch] += row._count;
    }
  }

  const eligibleMap = new Map(eligibleCounts.map((r) => [r.userId, r._count]));
  const pendingMap = new Map(pendingCounts.map((r) => [r.userId, r._count]));

  const repPerformance: RepPerformance[] = users.map((user) => {
    const reviews = repReviewMap.get(user.id) ?? { channels: emptyChannelBreakdown(), total: 0 };
    const eligible = eligibleMap.get(user.id) ?? 0;
    const pending = pendingMap.get(user.id) ?? 0;
    const classificationRate = eligible > 0 ? reviews.total / eligible : 0;
    const totalClassified = sumClassified(reviews.channels);

    // Build target vs actual for this rep
    const repTargets = allTargets.filter(
      (t) => t.userId === user.id || t.userId === null
    );
    const targetVsActual = repTargets.map((t) =>
      buildTargetVsActual(t, reviews.channels, endDate, teamMetrics.conversionRates)
    );

    return {
      userId: user.id,
      userName: user.name ?? "Unknown",
      channelBreakdown: reviews.channels,
      totalClassified,
      totalReviewed: reviews.total,
      pendingReview: pending,
      classificationRate,
      targetVsActual,
      trend: [], // Per-rep trend omitted from overview for performance
    };
  });

  // Anomalies
  const anomalies = rawAnomalies
    .sort((a, b) => severityOrder(b.severity) - severityOrder(a.severity))
    .slice(0, 5);

  const topWarnings: AnomalySummary[] = anomalies.map((a) => ({
    id: a.id,
    type: a.type as AnomalySummary["type"],
    severity: a.severity as AnomalySummary["severity"],
    title: a.title,
    description: a.description,
    recommendedAction: a.recommendedAction ?? undefined,
    createdAt: a.createdAt.toISOString(),
  }));

  // Team-level targets
  const teamTargetConfigs = allTargets.filter((t) => t.userId === null);
  const teamTarget = teamTargetConfigs.map((t) =>
    buildTargetVsActual(
      t,
      teamMetrics.channelBreakdown,
      endDate,
      teamMetrics.conversionRates
    )
  );

  const averageClassificationRate =
    repPerformance.length > 0
      ? repPerformance.reduce((sum, r) => sum + r.classificationRate, 0) /
        repPerformance.length
      : teamMetrics.classificationRate;

  const result: TeamOverview = {
    channelBreakdown: teamMetrics.channelBreakdown,
    totalClassified: teamMetrics.totalClassified,
    totalMeetings: teamMetrics.totalMeetings,
    averageClassificationRate,
    teamTarget,
    repPerformance,
    topWarnings,
    trend,
  };

  setCache(cacheKey, result, CACHE_TTL);
  return result;
}

// ─── getRepPerformance ────────────────────────────────────────

export async function getRepPerformance(
  tenantId: string,
  userId: string,
  startDate: Date,
  endDate: Date
): Promise<RepPerformance> {
  // FIX #4: Run all independent queries in parallel
  const [metrics, trend, user, pendingReview, totalReviewed, targetConfigs] =
    await Promise.all([
      getRepMetrics(tenantId, userId, startDate, endDate),
      getTrendData(tenantId, userId, startDate, endDate),
      prisma.user.findUnique({
        where: { id: userId },
        select: { name: true },
      }),
      prisma.calendarEvent.count({
        where: {
          tenantId,
          userId,
          startTime: { gte: startDate, lte: endDate },
          isFiltered: false,
          review: null,
        },
      }),
      prisma.meetingReview.count({
        where: {
          event: {
            tenantId,
            userId,
            startTime: { gte: startDate, lte: endDate },
            isFiltered: false,
          },
        },
      }),
      prisma.targetConfig.findMany({
        where: { tenantId, OR: [{ userId }, { userId: null }], isActive: true },
      }),
    ]);

  const conversionRates = metrics.conversionRates;
  const targetVsActual = targetConfigs.map((t) =>
    buildTargetVsActual(t, metrics.channelBreakdown, endDate, conversionRates)
  );

  return {
    userId,
    userName: user?.name ?? "Unknown",
    channelBreakdown: metrics.channelBreakdown,
    totalClassified: metrics.totalClassified,
    totalReviewed,
    pendingReview,
    classificationRate: metrics.classificationRate,
    targetVsActual,
    trend,
  };
}

// ─── getTrendData ─────────────────────────────────────────────

export async function getTrendData(
  tenantId: string,
  userId: string | null,
  startDate: Date,
  endDate: Date
): Promise<TrendPoint[]> {
  // FIX #3: Add caching
  const cacheKey = `t:${tenantId}:trend:${userId ?? 'team'}:${startDate.toISOString()}:${endDate.toISOString()}`;
  const cached = getCached<TrendPoint[]>(cacheKey);
  if (cached) return cached;

  // Raw SQL GROUP BY: aggregate in the database instead of loading all records
  type TrendRow = { week: string; confirmedLabel: string; cnt: number };

  const userClause = userId ? `AND ce."userId" = '${userId}'` : "";
  const rows: TrendRow[] = await prisma.$queryRawUnsafe<TrendRow[]>(
    `SELECT strftime('%Y-W%W', ce."startTime") as week,
            mr."confirmedLabel",
            COUNT(*) as cnt
     FROM "MeetingReview" mr
     JOIN "CalendarEvent" ce ON mr."eventId" = ce."id"
     WHERE ce."tenantId" = '${tenantId}'
       AND ce."startTime" >= '${startDate.toISOString()}'
       AND ce."startTime" <= '${endDate.toISOString()}'
       AND ce."isFiltered" = 0
       ${userClause}
     GROUP BY week, mr."confirmedLabel"`
  ).then((rawRows) =>
    rawRows.map((r) => ({
      week: String(r.week),
      confirmedLabel: String(r.confirmedLabel),
      cnt: Number(r.cnt),
    }))
  );

  // Aggregate rows into TrendPoint[] by week
  const weekMap = new Map<string, { channels: Record<MeetingChannel, number>; total: number }>();

  for (const row of rows) {
    if (!weekMap.has(row.week)) {
      weekMap.set(row.week, { channels: emptyChannelBreakdown(), total: 0 });
    }
    const bucket = weekMap.get(row.week)!;
    const ch = row.confirmedLabel as MeetingChannel;
    if (ch in bucket.channels) {
      bucket.channels[ch] += row.cnt;
    }
    if (ch !== "irrelevant") {
      bucket.total += row.cnt;
    }
  }

  const result: TrendPoint[] = Array.from(weekMap.keys())
    .sort()
    .map((date) => {
      const bucket = weekMap.get(date)!;
      return {
        date,
        channels: bucket.channels,
        total: bucket.total,
        // Backward compat: map old fields from dominant channels
        outbound: (bucket.channels.linkedin ?? 0) + (bucket.channels.email ?? 0),
        partner: bucket.channels.partnerships ?? 0,
      };
    });

  setCache(cacheKey, result, CACHE_TTL);
  return result;
}

// ─── getTargetVsActual (sync version for use in batched contexts) ─

export function buildTargetVsActual(
  targetConfig: { metricType: string; targetValue: number; period: string },
  channelBreakdown: Record<MeetingChannel, number>,
  endDate: Date,
  conversionRates?: StageConversion[]
): TargetVsActual {
  const target = targetConfig.targetValue;
  let actual = 0;

  if (targetConfig.metricType === "total_meetings") {
    actual = sumClassified(channelBreakdown);
  } else if (targetConfig.metricType === "conversion_rate" && conversionRates && conversionRates.length > 0) {
    actual = conversionRates.reduce((sum, cr) => sum + cr.rate, 0) / conversionRates.length;
  } else {
    // Channel-specific metric, e.g. "linkedin_meetings" -> channelBreakdown.linkedin
    const channel = metricTypeToChannel(targetConfig.metricType);
    if (channel && channel in channelBreakdown) {
      actual = channelBreakdown[channel] ?? 0;
    }
  }

  const variance = actual - target;
  const variancePercent = target > 0 ? variance / target : 0;
  const deficit = Math.max(0, target - actual);
  const onTrack = actual >= target;
  const remainingDays = getRemainingBusinessDays(endDate);
  const requiredPace = remainingDays > 0 ? deficit / remainingDays : 0;

  return {
    metricType: targetConfig.metricType as MetricType,
    target,
    actual,
    variance,
    variancePercent,
    deficit,
    onTrack,
    requiredPace,
    remainingDays,
  };
}

// ─── Async version for standalone use ─────────────────────────

export async function getTargetVsActual(
  tenantId: string,
  userId: string | null,
  metricType: string,
  period: string,
  startDate: Date,
  endDate: Date
): Promise<TargetVsActual> {
  const targetConfig = await prisma.targetConfig.findFirst({
    where: { tenantId, userId, metricType, period, isActive: true },
  });

  const target = targetConfig?.targetValue ?? 0;
  let actual = 0;

  const eventFilter = {
    tenantId,
    ...(userId ? { userId } : {}),
    startTime: { gte: startDate, lte: endDate },
    isFiltered: false,
  };

  if (metricType === "conversion_rate") {
    const rates = await getConversionRates(tenantId);
    if (rates.length > 0) {
      actual = rates.reduce((sum, cr) => sum + cr.rate, 0) / rates.length;
    }
  } else {
    // Use groupBy instead of loading all reviews into memory
    const reviewGroups = await prisma.meetingReview.groupBy({
      by: ["confirmedLabel"],
      where: { event: eventFilter },
      _count: { confirmedLabel: true },
    });
    const channelBreakdown = emptyChannelBreakdown();
    for (const group of reviewGroups) {
      const ch = group.confirmedLabel as MeetingChannel;
      if (ch in channelBreakdown) channelBreakdown[ch] = group._count.confirmedLabel;
    }

    if (metricType === "total_meetings") {
      actual = sumClassified(channelBreakdown);
    } else {
      const channel = metricTypeToChannel(metricType);
      if (channel && channel in channelBreakdown) {
        actual = channelBreakdown[channel] ?? 0;
      }
    }
  }

  const variance = actual - target;
  const variancePercent = target > 0 ? variance / target : 0;
  const deficit = Math.max(0, target - actual);
  const onTrack = actual >= target;
  const remainingDays = getRemainingBusinessDays(endDate);
  const requiredPace = remainingDays > 0 ? deficit / remainingDays : 0;

  return {
    metricType: metricType as MetricType,
    target,
    actual,
    variance,
    variancePercent,
    deficit,
    onTrack,
    requiredPace,
    remainingDays,
  };
}

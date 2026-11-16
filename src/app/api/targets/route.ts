import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { apiHandler } from "@/lib/api-handler";
import { isManagerOrAdmin } from "@/lib/api-auth";
import { getDateRange } from "@/lib/utils";
import {
  TargetsQuerySchema,
  CreateTargetSchema,
  UpdateTargetSchema,
  DeleteTargetQuerySchema,
} from "@/lib/schemas";
import {
  buildTargetVsActual,
  getTeamMetrics,
  getRepMetrics,
  getConversionRates,
} from "@/lib/services/kpi-calculator";
import { analyzeDeficit } from "@/lib/services/deficit-analyzer";
import type { TimePeriod } from "@/types";

// ── GET /api/targets ─────────────────────────────────────────
export const GET = apiHandler(
  async (_req, { session, query }) => {
    const tenantId = session.user.tenantId;
    const { userId, metricType, period } = query;

    const where: Record<string, unknown> = { tenantId, isActive: true };

    if (userId) {
      if (!isManagerOrAdmin(session.user.role) && userId !== session.user.id) {
        return NextResponse.json(
          { success: false, error: "Forbidden" },
          { status: 403 },
        );
      }
      where.userId = userId;
    } else if (!isManagerOrAdmin(session.user.role)) {
      where.OR = [{ userId: session.user.id }, { userId: null }];
    }

    if (metricType) where.metricType = metricType;
    if (period) where.period = period;

    const targets = await prisma.targetConfig.findMany({
      where,
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "desc" },
    });

    // Enrich targets with actual values
    const selectedPeriod: TimePeriod = (period as TimePeriod) ?? "monthly";
    const dateRange = getDateRange(selectedPeriod);
    const conversionRates = await getConversionRates(tenantId);

    const userIds = [...new Set(targets.filter((t) => t.userId).map((t) => t.userId!))];
    const [teamMetrics, ...userMetricsList] = await Promise.all([
      getTeamMetrics(tenantId, dateRange.start, dateRange.end),
      ...userIds.map((uid) => getRepMetrics(tenantId, uid, dateRange.start, dateRange.end)),
    ]);
    const userMetricsMap = new Map(userIds.map((uid, i) => [uid, userMetricsList[i]]));

    const enrichedTargets = targets.map((t) => {
      const metrics = t.userId ? userMetricsMap.get(t.userId) : teamMetrics;
      if (!metrics) return { ...t, actual: 0, userName: t.user?.name ?? null };
      const tva = buildTargetVsActual(t, metrics.channelBreakdown, dateRange.end, conversionRates);
      return { ...t, actual: tva.actual, userName: t.user?.name ?? null };
    });

    // Deficit analysis for behind targets
    const deficits = enrichedTargets
      .filter((t) => t.isActive && t.actual !== undefined && t.actual < t.targetValue)
      .slice(0, 5)
      .map((t) => {
        const avgConversion =
          conversionRates.length > 0
            ? conversionRates.reduce((s, c) => s + c.rate, 0) / conversionRates.length
            : 0.5;
        const now = new Date();
        const elapsedDays = Math.max(
          1,
          Math.round((now.getTime() - dateRange.start.getTime()) / (1000 * 60 * 60 * 24)),
        );
        const remainingDays = Math.max(
          0,
          Math.round((dateRange.end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
        );
        const metricLabel = t.metricType.replace(/_/g, " ");
        const analysis = analyzeDeficit(t.actual ?? 0, t.targetValue, avgConversion, remainingDays, elapsedDays);
        return { metricLabel, analysis };
      });

    return NextResponse.json({
      success: true,
      data: enrichedTargets,
      deficits,
    });
  },
  { query: TargetsQuerySchema },
);

// ── POST /api/targets ────────────────────────────────────────
export const POST = apiHandler(
  async (_req, { session, body }) => {
    const tenantId = session.user.tenantId;
    const { userId, metricType, stageId, targetValue, period, periodStart } = body;

    // If userId is provided, verify the user exists in this tenant
    if (userId) {
      const user = await prisma.user.findFirst({ where: { id: userId, tenantId } });
      if (!user) {
        return NextResponse.json(
          { success: false, error: "Target user not found" },
          { status: 404 },
        );
      }
    }

    const target = await prisma.$transaction(async (tx) => {
      const newTarget = await tx.targetConfig.create({
        data: {
          tenantId,
          userId: userId || null,
          metricType,
          stageId: stageId || null,
          targetValue,
          period,
          periodStart: periodStart ? new Date(periodStart) : null,
          createdBy: session.user.id,
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId,
          userId: session.user.id,
          action: "create_target",
          entity: "target_config",
          entityId: newTarget.id,
          details: JSON.stringify({ userId, metricType, targetValue, period }),
        },
      });

      return newTarget;
    });

    return NextResponse.json({ success: true, data: target }, { status: 201 });
  },
  { roles: ["manager", "admin"], body: CreateTargetSchema },
);

// ── PUT /api/targets ─────────────────────────────────────────
export const PUT = apiHandler(
  async (_req, { session, body }) => {
    const tenantId = session.user.tenantId;
    const { id, userId, metricType, stageId, targetValue, period, periodStart, isActive } = body;

    const existing = await prisma.targetConfig.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Target config not found" },
        { status: 404 },
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      const target = await tx.targetConfig.update({
        where: { id },
        data: {
          ...(userId !== undefined && { userId: userId || null }),
          ...(metricType && { metricType }),
          ...(stageId !== undefined && { stageId: stageId || null }),
          ...(targetValue !== undefined && { targetValue }),
          ...(period && { period }),
          ...(periodStart !== undefined && {
            periodStart: periodStart ? new Date(periodStart) : null,
          }),
          ...(isActive !== undefined && { isActive }),
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId,
          userId: session.user.id,
          action: "update_target",
          entity: "target_config",
          entityId: target.id,
          details: JSON.stringify({
            previousValue: existing.targetValue,
            newValue: targetValue ?? existing.targetValue,
            metricType: metricType || existing.metricType,
            period: period || existing.period,
          }),
        },
      });

      return target;
    });

    return NextResponse.json({ success: true, data: updated });
  },
  { roles: ["manager", "admin"], body: UpdateTargetSchema },
);

// ── DELETE /api/targets ──────────────────────────────────────
export const DELETE = apiHandler(
  async (_req, { session, query }) => {
    const tenantId = session.user.tenantId;
    const { id } = query;

    const existing = await prisma.targetConfig.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Target config not found" },
        { status: 404 },
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.targetConfig.delete({ where: { id } });

      await tx.auditLog.create({
        data: {
          tenantId,
          userId: session.user.id,
          action: "delete_target",
          entity: "target_config",
          entityId: id,
          details: JSON.stringify({
            metricType: existing.metricType,
            targetValue: existing.targetValue,
            period: existing.period,
          }),
        },
      });
    });

    return NextResponse.json({ success: true });
  },
  { roles: ["manager", "admin"], query: DeleteTargetQuerySchema },
);

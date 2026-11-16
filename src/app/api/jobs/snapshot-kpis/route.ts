/**
 * POST /api/jobs/snapshot-kpis
 *
 * Triggered by external cron (weekly). Captures current KPI values
 * into KPISnapshot for historical period-over-period comparison.
 * Iterates over all active tenants.
 */

import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api-handler";
import prisma from "@/lib/prisma";
import { getRepMetrics, getTeamMetrics } from "@/lib/services/kpi-calculator";
import { TEAM_SNAPSHOT_USER_ID } from "@/constants";
import { startOfWeek, startOfMonth } from "date-fns";

export const POST = apiHandler(
  async (req) => {
    const now = new Date();
    const weekStart = startOfWeek(now, { weekStartsOn: 1 });
    const monthStart = startOfMonth(now);

    const tenants = await prisma.tenant.findMany({ where: { isActive: true } });
    const results = [];

    for (const tenant of tenants) {
      try {
        let snapshotsCreated = 0;

        const users = await prisma.user.findMany({
          where: { isActive: true, tenantId: tenant.id },
          select: { id: true },
        });

        // Team-level weekly snapshot
        const teamMetrics = await getTeamMetrics(tenant.id, weekStart, now);
        await prisma.kPISnapshot.upsert({
          where: {
            tenantId_userId_period_periodStart: {
              tenantId: tenant.id,
              userId: TEAM_SNAPSHOT_USER_ID,
              period: "weekly",
              periodStart: weekStart,
            },
          },
          create: {
            tenantId: tenant.id,
            userId: TEAM_SNAPSHOT_USER_ID,
            period: "weekly",
            periodStart: weekStart,
            outboundMeetings: teamMetrics.totalClassified,
            partnerMeetings: 0,
            classificationRate: teamMetrics.classificationRate,
          },
          update: {
            outboundMeetings: teamMetrics.totalClassified,
            partnerMeetings: 0,
            classificationRate: teamMetrics.classificationRate,
          },
        });
        snapshotsCreated++;

        // Per-rep weekly snapshots — batched to avoid connection pool exhaustion
        const BATCH_SIZE = 10;
        for (let i = 0; i < users.length; i += BATCH_SIZE) {
          const batch = users.slice(i, i + BATCH_SIZE);
          await Promise.all(
            batch.map(async (user) => {
              const metrics = await getRepMetrics(tenant.id, user.id, weekStart, now);
              await prisma.kPISnapshot.upsert({
                where: {
                  tenantId_userId_period_periodStart: {
                    tenantId: tenant.id,
                    userId: user.id,
                    period: "weekly",
                    periodStart: weekStart,
                  },
                },
                create: {
                  tenantId: tenant.id,
                  userId: user.id,
                  period: "weekly",
                  periodStart: weekStart,
                  outboundMeetings: metrics.totalClassified,
                  partnerMeetings: 0,
                  classificationRate: metrics.classificationRate,
                },
                update: {
                  outboundMeetings: metrics.totalClassified,
                  partnerMeetings: 0,
                  classificationRate: metrics.classificationRate,
                },
              });
            })
          );
          snapshotsCreated += batch.length;
        }

        results.push({ tenant: tenant.slug, status: "completed", snapshotsCreated });
      } catch (err) {
        results.push({ tenant: tenant.slug, status: "failed", error: String(err) });
      }
    }

    return NextResponse.json({ success: true, data: results });
  },
  { cronAuth: true }
);

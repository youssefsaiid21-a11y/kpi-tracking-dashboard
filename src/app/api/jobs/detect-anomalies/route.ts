/**
 * POST /api/jobs/detect-anomalies
 *
 * Triggered by external cron. Runs data quality anomaly detection
 * for all active tenants.
 */

import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api-handler";
import { runAnomalyDetection } from "@/lib/services/anomaly-detector";
import prisma from "@/lib/prisma";

export const POST = apiHandler(
  async (req) => {
    const tenants = await prisma.tenant.findMany({ where: { isActive: true } });
    const results = await Promise.all(
      tenants.map(async (tenant) => {
        try {
          await runAnomalyDetection(tenant.id);
          return { tenant: tenant.slug, status: "completed" as const };
        } catch (err) {
          return { tenant: tenant.slug, status: "failed" as const, error: String(err) };
        }
      })
    );
    return NextResponse.json({ success: true, data: results });
  },
  { cronAuth: true }
);

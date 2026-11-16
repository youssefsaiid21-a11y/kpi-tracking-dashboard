/**
 * POST /api/jobs/sync-hubspot
 *
 * Triggered by external cron. Syncs HubSpot pipelines, stages, and deals
 * for all active tenants.
 */

import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api-handler";
import { syncHubSpot } from "@/lib/services/sync-manager";
import { invalidateTenant } from "@/lib/cache";
import prisma from "@/lib/prisma";

export const POST = apiHandler(
  async (req) => {
    const tenants = await prisma.tenant.findMany({ where: { isActive: true } });
    // Process tenants in parallel
    const results = await Promise.all(
      tenants.map(async (tenant) => {
        try {
          const result = await syncHubSpot(tenant.id);
          invalidateTenant(tenant.id, tenant.slug);
          return { tenant: tenant.slug, status: "completed", data: result };
        } catch (err) {
          return { tenant: tenant.slug, status: "failed", error: String(err) };
        }
      })
    );
    return NextResponse.json({ success: true, data: results });
  },
  { cronAuth: true }
);

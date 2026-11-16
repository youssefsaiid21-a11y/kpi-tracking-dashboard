/**
 * GET  /api/sync         — list sync logs
 * POST /api/sync         — trigger calendar and/or HubSpot sync
 *
 * Delegates to sync-manager which handles:
 * - Delegated token refresh (PKCE) with client-credentials fallback
 * - Attendee upsert (preserves isPartnerContact enrichment)
 * - Classification of new events
 * - Proper internalDomains resolution per tenant
 * - Concurrency guards and SyncLog management
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { syncAllCalendars, syncHubSpot } from "@/lib/services/sync-manager";
import { invalidateTenant } from "@/lib/cache";

export async function GET(req: NextRequest) {
  try {
    const { session, error } = await requireAuth(["manager", "admin"], req);
    if (error) return error;
    const tenantId = session.user.tenantId;

    const { searchParams } = req.nextUrl;
    const provider = searchParams.get("provider");
    const parsedLimit = parseInt(searchParams.get("limit") || "20", 10);
    const limit = Math.min(
      100,
      Math.max(1, isNaN(parsedLimit) ? 20 : parsedLimit)
    );

    const where: Record<string, unknown> = { tenantId };
    if (provider) {
      where.provider = provider;
    }

    const logs = await prisma.syncLog.findMany({
      where,
      orderBy: { startedAt: "desc" },
      take: limit,
    });

    return NextResponse.json({ success: true, data: logs });
  } catch (err) {
    console.error("[GET /api/sync]", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const { session, error } = await requireAuth(["admin"], req);
    if (error) return error;
    const tenantId = session.user.tenantId;

    // Read optional provider filter from body
    let provider: string | null = null;
    try {
      const body = await req.json();
      provider = body?.provider ?? null;
    } catch {
      // No body or invalid JSON — sync both
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { slug: true },
    });

    const results: Array<{ provider: string; status: string; data?: unknown; error?: string }> = [];

    // Sync Microsoft Graph (calendars)
    if (!provider || provider === "microsoft_graph") {
      try {
        const data = await syncAllCalendars(tenantId);
        invalidateTenant(tenantId, tenant?.slug ?? "default");
        results.push({ provider: "microsoft_graph", status: "completed", data });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        results.push({
          provider: "microsoft_graph",
          status: "failed",
          error: errMsg.replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, "[redacted]").replace(/:\d{4,5}/g, ":[redacted]"),
        });
      }
    }

    // Sync HubSpot
    if (!provider || provider === "hubspot") {
      try {
        const data = await syncHubSpot(tenantId);
        invalidateTenant(tenantId, tenant?.slug ?? "default");
        results.push({ provider: "hubspot", status: "completed", data });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        results.push({
          provider: "hubspot",
          status: "failed",
          error: errMsg.replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, "[redacted]").replace(/:\d{4,5}/g, ":[redacted]"),
        });
      }
    }

    return NextResponse.json({ success: true, data: results });
  } catch (err) {
    console.error("[POST /api/sync]", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

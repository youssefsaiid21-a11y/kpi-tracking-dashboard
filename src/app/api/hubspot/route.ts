import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { HubSpotService } from "@/lib/services/hubspot";
import { getTenantSecrets } from "@/lib/tenant";
import { syncHubSpotData } from "@/lib/services/hubspot-sync";

export async function GET(req: NextRequest) {
  try {
    const { session, error } = await requireAuth(undefined, req);
    if (error) return error;
    const tenantId = session.user.tenantId;

    const pipelines = await prisma.pipelineDefinition.findMany({
      where: { tenantId, isActive: true },
      include: {
        stages: {
          orderBy: { displayOrder: "asc" },
        },
      },
    });

    return NextResponse.json({ success: true, data: pipelines });
  } catch (err) {
    console.error("[GET /api/hubspot]", err);
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
    const secrets = await getTenantSecrets(tenantId);

    // Create sync log
    const syncLog = await prisma.syncLog.create({
      data: {
        tenantId,
        provider: "hubspot",
        syncType: "full",
        status: "started",
      },
    });

    const startTime = Date.now();

    try {
      if (!secrets.hubspotAccessToken) {
        throw new Error("HubSpot access token not configured for this tenant");
      }

      const result = await syncHubSpotData(tenantId, secrets.hubspotAccessToken);

      const durationMs = Date.now() - startTime;

      const completedLog = await prisma.syncLog.update({
        where: { id: syncLog.id },
        data: {
          status: "completed",
          recordsProcessed: result.created + result.updated,
          recordsCreated: result.created,
          recordsUpdated: result.updated,
          completedAt: new Date(),
          durationMs,
        },
      });

      await prisma.integrationConfig.upsert({
        where: { tenantId_provider: { tenantId, provider: "hubspot" } },
        update: { lastSyncAt: new Date() },
        create: {
          tenantId,
          provider: "hubspot",
          isEnabled: true,
          lastSyncAt: new Date(),
        },
      });

      return NextResponse.json({ success: true, data: completedLog });
    } catch (syncError) {
      const durationMs = Date.now() - startTime;
      const errorMessage =
        syncError instanceof Error ? syncError.message : "Unknown error";

      await prisma.syncLog.update({
        where: { id: syncLog.id },
        data: {
          status: "failed",
          errorMessage,
          completedAt: new Date(),
          durationMs,
        },
      });

      return NextResponse.json(
        { success: false, error: `Sync failed: ${errorMessage.replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, "[redacted]").replace(/:\d{4,5}/g, ":[redacted]")}` },
        { status: 500 }
      );
    }
  } catch (err) {
    console.error("[POST /api/hubspot]", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

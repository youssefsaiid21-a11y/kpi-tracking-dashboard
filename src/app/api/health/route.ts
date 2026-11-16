/**
 * GET /api/health — Health check endpoint.
 *
 * Returns basic { status: "ok" } for unauthenticated requests.
 * Returns full details (database, integrations, sync failures) only
 * for authenticated admin users.
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getToken } from "next-auth/jwt";

export async function GET(req: NextRequest) {
  // Check if the caller is an authenticated admin
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  const isAdmin = token?.userId && token?.role === "admin";

  // Unauthenticated or non-admin: return basic status only
  if (!isAdmin) {
    let status = "ok";
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      status = "degraded";
    }
    return NextResponse.json({ status }, { status: status === "ok" ? 200 : 503 });
  }

  // Authenticated admin: return full details
  const tenantId = token.tenantId as string;
  const checks: Record<string, any> = {
    status: "ok",
    timestamp: new Date().toISOString(),
    database: "unknown",
    integrations: {},
  };

  // Database connectivity
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = "connected";
  } catch {
    checks.database = "disconnected";
    checks.status = "degraded";
  }

  // Integration status and last sync times
  try {
    const integrations = await prisma.integrationConfig.findMany({
      where: { tenantId },
      select: {
        provider: true,
        isEnabled: true,
        lastSyncAt: true,
      },
    });

    for (const integration of integrations) {
      checks.integrations[integration.provider] = {
        enabled: integration.isEnabled,
        lastSyncAt: integration.lastSyncAt?.toISOString() ?? null,
      };
    }

    // Recent sync failures (last 24h)
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentFailures = await prisma.syncLog.count({
      where: { tenantId, status: "failed", startedAt: { gte: dayAgo } },
    });

    checks.recentSyncFailures = recentFailures;
    if (recentFailures > 0) {
      checks.status = "degraded";
    }
  } catch {
    checks.status = "degraded";
  }

  const statusCode = checks.status === "ok" ? 200 : 503;
  return NextResponse.json(checks, { status: statusCode });
}

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { apiHandler } from "@/lib/api-handler";
import { AnomaliesQuerySchema, ResolveAnomalySchema } from "@/lib/schemas";

export const GET = apiHandler(
  async (req, { session, query }) => {
    const tenantId = session.user.tenantId;
    const { severity, type, isResolved } = query;
    const limit = query.limit ?? 50;

    const where: Record<string, unknown> = { tenantId };
    if (severity) where.severity = severity;
    if (type) where.type = type;
    if (isResolved !== undefined) where.isResolved = isResolved === "true";

    // Single query instead of cascading severity loops (was 3 queries, now 1)
    const severityOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 };
    const raw = await prisma.anomaly.findMany({
      where,
      orderBy: [{ isResolved: "asc" }, { createdAt: "desc" }],
      take: limit,
    });
    // Sort by severity priority in-memory (cheap for ≤200 rows)
    const anomalies = raw.sort((a, b) => {
      if (a.isResolved !== b.isResolved) return a.isResolved ? 1 : -1;
      return (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9);
    });

    return NextResponse.json({ success: true, data: anomalies });
  },
  { query: AnomaliesQuerySchema }
);

export const PUT = apiHandler(
  async (_req, { session, body }) => {
    const tenantId = session.user.tenantId;
    const { id } = body;

    // Use transaction to prevent race conditions (concurrent resolve attempts)
    const anomaly = await prisma.$transaction(async (tx) => {
      const existing = await tx.anomaly.findFirst({ where: { id, tenantId } });
      if (!existing) {
        throw new Error("NOT_FOUND");
      }
      if (existing.isResolved) {
        throw new Error("ALREADY_RESOLVED");
      }
      return tx.anomaly.update({
        where: { id },
        data: {
          isResolved: true,
          resolvedAt: new Date(),
          resolvedBy: session.user.id,
        },
      });
    }).catch((err) => {
      if (err.message === "NOT_FOUND") {
        return { __error: true as const, status: 404, message: "Anomaly not found" };
      }
      if (err.message === "ALREADY_RESOLVED") {
        return { __error: true as const, status: 400, message: "Anomaly is already resolved" };
      }
      throw err;
    });

    if ("__error" in anomaly) {
      return NextResponse.json(
        { success: false, error: anomaly.message },
        { status: anomaly.status }
      );
    }

    return NextResponse.json({ success: true, data: anomaly });
  },
  { roles: ["manager", "admin"], body: ResolveAnomalySchema }
);

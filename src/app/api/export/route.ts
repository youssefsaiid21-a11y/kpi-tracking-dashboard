/**
 * GET /api/export — Export data as CSV or JSON.
 *
 * Query params:
 *   type: meetings | pipeline | attribution
 *   format: csv | json (default: csv)
 *   startDate, endDate: ISO date strings
 *
 * Requires manager or admin role.
 */

import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api-handler";
import prisma from "@/lib/prisma";
import { getDateRange } from "@/lib/utils";
import { ExportQuerySchema } from "@/lib/schemas";

const MAX_EXPORT_ROWS = parseInt(process.env.MAX_EXPORT_ROWS ?? "10000", 10);

function toCSV(headers: string[], rows: string[][]): string {
  const escape = (v: string) =>
    v.includes(",") || v.includes('"') || v.includes("\n")
      ? `"${v.replace(/"/g, '""')}"`
      : v;

  const lines = [
    headers.map(escape).join(","),
    ...rows.map((row) => row.map((v) => escape(v ?? "")).join(",")),
  ];
  return lines.join("\n");
}

export const GET = apiHandler(
  async (req, { session, query }) => {
    const tenantId = session.user.tenantId;
    const { type, format, startDate, endDate } = query;

    const dateRange = getDateRange(
      "custom",
      startDate ?? undefined,
      endDate ?? undefined
    );

    // Managers can only export data for reps they manage (active reps + self)
    // Admins can export all data
    let userFilter: { userId?: string | { in: string[] } } = {};
    if (session.user.role === "manager") {
      const managedUsers = await prisma.user.findMany({
        where: {
          tenantId,
          OR: [
            { role: "rep", isActive: true },
            { id: session.user.id },
          ],
        },
        select: { id: true },
      });
      userFilter = { userId: { in: managedUsers.map((u) => u.id) } };
    }

    let headers: string[] = [];
    let rows: string[][] = [];

    if (type === "meetings") {
      const meetings = await prisma.calendarEvent.findMany({
        where: {
          tenantId,
          ...userFilter,
          isFiltered: false,
          startTime: { gte: dateRange.start, lte: dateRange.end },
        },
        include: {
          review: true,
          suggestedClass: true,
          user: { select: { name: true, email: true } },
          attendees: { where: { isInternal: false } },
        },
        orderBy: { startTime: "desc" },
        take: MAX_EXPORT_ROWS + 1,
      });

      headers = [
        "Date",
        "Subject",
        "Duration (min)",
        "Rep",
        "External Attendees",
        "AI Suggestion",
        "AI Confidence",
        "Confirmed Label",
        "Source",
        "Reviewed At",
      ];

      rows = meetings.map((m) => [
        m.startTime.toISOString().split("T")[0],
        m.subject ?? "",
        String(m.duration),
        m.user.name ?? m.user.email,
        m.attendees.map((a) => a.email).join("; "),
        m.suggestedClass?.suggestedLabel ?? "",
        m.suggestedClass ? String(m.suggestedClass.confidence) : "",
        m.review?.confirmedLabel ?? "pending",
        m.review?.source ?? "",
        m.review?.reviewedAt?.toISOString() ?? "",
      ]);
    } else if (type === "pipeline") {
      const deals = await prisma.hubSpotDeal.findMany({
        where: {
          tenantId,
          createDate: { gte: dateRange.start, lte: dateRange.end },
        },
        include: { stage: true },
        orderBy: { createDate: "desc" },
        take: MAX_EXPORT_ROWS + 1,
      });

      headers = [
        "Deal Name",
        "Amount",
        "Stage",
        "Owner ID",
        "Created",
        "Close Date",
        "Is Won",
      ];

      rows = deals.map((d) => [
        d.name,
        d.amount ? String(d.amount) : "",
        d.stage.label,
        d.ownerId ?? "",
        d.createDate?.toISOString().split("T")[0] ?? "",
        d.closeDate?.toISOString().split("T")[0] ?? "",
        d.isWon ? "Yes" : "No",
      ]);
    } else if (type === "attribution") {
      const attributions = await prisma.meetingDealAttribution.findMany({
        where: {
          tenantId,
          event: {
            startTime: { gte: dateRange.start, lte: dateRange.end },
          },
        },
        include: {
          event: { select: { subject: true, startTime: true } },
          deal: { select: { name: true, amount: true, isWon: true } },
        },
        orderBy: { createdAt: "desc" },
        take: MAX_EXPORT_ROWS + 1,
      });

      headers = [
        "Meeting Date",
        "Meeting Subject",
        "Deal Name",
        "Deal Amount",
        "Deal Won",
        "Attribution Type",
        "Confidence",
      ];

      rows = attributions.map((a: any) => [
        a.event.startTime.toISOString().split("T")[0],
        a.event.subject ?? "",
        a.deal.name,
        a.deal.amount ? String(a.deal.amount) : "",
        a.deal.isWon ? "Yes" : "No",
        a.attributionType,
        String(a.confidence),
      ]);
    } else {
      return NextResponse.json(
        { success: false, error: "Invalid export type" },
        { status: 400 }
      );
    }

    // Enforce export row limit
    const truncated = rows.length > MAX_EXPORT_ROWS;
    if (truncated) {
      rows = rows.slice(0, MAX_EXPORT_ROWS);
    }

    if (format === "json") {
      const jsonData = rows.map((row) =>
        Object.fromEntries(headers.map((h, i) => [h, row[i]]))
      );
      return NextResponse.json({
        success: true,
        data: jsonData,
        ...(truncated && {
          warning: `Export truncated to ${MAX_EXPORT_ROWS} rows. Apply date filters to reduce result size.`,
        }),
      });
    }

    const csv = toCSV(headers, rows);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${type}-export-${new Date().toISOString().split("T")[0]}.csv"`,
      },
    });
  },
  { roles: ["manager", "admin"], query: ExportQuerySchema }
);

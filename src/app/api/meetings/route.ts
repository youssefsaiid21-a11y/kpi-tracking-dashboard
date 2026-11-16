import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { apiHandler } from "@/lib/api-handler";
import { isManagerOrAdmin } from "@/lib/api-auth";
import { MeetingsQuerySchema } from "@/lib/schemas";

export const GET = apiHandler(
  async (req, { session, query }) => {
    const tenantId = session.user.tenantId;
    const { status, classification, userId, startDate, endDate, search } = query;
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Record<string, unknown> = {
      tenantId,
      isFiltered: false,
    };

    // Non-admin/manager users can only see their own meetings
    if (isManagerOrAdmin(session.user.role)) {
      if (userId) where.userId = userId;
    } else {
      where.userId = session.user.id;
    }

    if (status) where.status = status;

    if (startDate || endDate) {
      where.startTime = {
        ...(startDate && { gte: startDate }),
        ...(endDate && { lte: endDate }),
      };
    }

    if (classification) {
      where.review = { confirmedLabel: classification };
    }

    if (search) {
      where.subject = { contains: search };
    }

    // countOnly mode: skip expensive findMany, return only the count
    if (query.countOnly === "true") {
      const total = await prisma.calendarEvent.count({ where });
      return NextResponse.json({
        success: true,
        data: [],
        meta: { total, page: 1, pageSize: 0, totalPages: 0 },
      });
    }

    const [events, total] = await Promise.all([
      prisma.calendarEvent.findMany({
        where,
        select: {
          id: true,
          externalId: true,
          userId: true,
          subject: true,
          bodyPreview: true,
          startTime: true,
          endTime: true,
          duration: true,
          isAllDay: true,
          isCancelled: true,
          isRecurring: true,
          organizer: true,
          organizerName: true,
          location: true,
          onlineMeetingUrl: true,
          status: true,
          isInternal: true,
          isSolo: true,
          isFiltered: true,
          filterReason: true,
          syncedAt: true,
          attendees: {
            select: {
              id: true,
              email: true,
              name: true,
              responseStatus: true,
              isOrganizer: true,
              isInternal: true,
              isPartnerContact: true,
            },
          },
          review: true,
          suggestedClass: true,
        },
        orderBy: { startTime: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.calendarEvent.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      data: events,
      meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
    });
  },
  { query: MeetingsQuerySchema }
);

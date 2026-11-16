/**
 * POST /api/meetings/bulk-review
 *
 * Classify multiple meetings at once. Enables "approve all AI suggestions
 * above X% confidence" from the UI.
 *
 * Body: { eventIds: string[], confirmedLabel: string, source?: string }
 */

import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api-handler";
import prisma from "@/lib/prisma";
import { invalidateTenant } from "@/lib/cache";
import { isManagerOrAdmin } from "@/lib/api-auth";
import { BulkReviewSchema } from "@/lib/schemas";

export const POST = apiHandler(async (_req, { session, body }) => {
  const tenantId = session.user.tenantId;
  const { eventIds, confirmedLabel, source } = body;

  // Verify all events exist and are not already reviewed
  // Non-admin/manager users can only review their own meetings
  const ownershipFilter = isManagerOrAdmin(session.user.role)
    ? {}
    : { userId: session.user.id };

  const events = await prisma.calendarEvent.findMany({
    where: {
      tenantId,
      id: { in: eventIds },
      isFiltered: false,
      review: null,
      ...ownershipFilter,
    },
    select: { id: true },
  });

  const validIds = new Set(events.map((e) => e.id));
  const skipped = eventIds.filter((id) => !validIds.has(id));

  // Batch create reviews, update events, audit logs, AND feedback in one transaction
  const validIdArr = Array.from(validIds);
  const now = new Date();
  const sourceVal = source ?? "bulk";

  const reviews = await prisma.$transaction(async (tx) => {
    // 1. Batch create reviews
    await tx.meetingReview.createMany({
      data: validIdArr.map((eventId) => ({
        tenantId,
        eventId,
        userId: session.user.id,
        confirmedLabel,
        source: sourceVal,
        reviewedAt: now,
      })),
    });

    // 2. Batch update event statuses
    await tx.calendarEvent.updateMany({
      where: { id: { in: validIdArr } },
      data: { status: "completed" },
    });

    // 3. Batch create audit logs
    await tx.auditLog.createMany({
      data: validIdArr.map((eventId) => ({
        tenantId,
        userId: session.user.id,
        action: "classify_meeting",
        entity: "meeting_review",
        entityId: eventId,
        details: JSON.stringify({ eventId, confirmedLabel, source: sourceVal }),
      })),
    });

    // 4. Write classification feedback for learning
    const suggestedClassifications = await tx.suggestedClassification.findMany({
      where: { tenantId, eventId: { in: validIdArr } },
      select: { eventId: true, suggestedLabel: true, signals: true },
    });

    const feedbackData = suggestedClassifications
      .filter((sc) => sc.suggestedLabel !== confirmedLabel)
      .map((sc) => ({
        tenantId,
        eventId: sc.eventId,
        suggestedLabel: sc.suggestedLabel,
        confirmedLabel,
        signals: sc.signals,
      }));

    if (feedbackData.length > 0) {
      await tx.classificationFeedback.createMany({ data: feedbackData });
    }

    return validIdArr;
  });

  invalidateTenant(tenantId);

  return NextResponse.json({
    success: true,
    data: {
      reviewed: reviews.length,
      skipped: skipped.length,
      skippedIds: skipped,
    },
  });
}, { body: BulkReviewSchema });

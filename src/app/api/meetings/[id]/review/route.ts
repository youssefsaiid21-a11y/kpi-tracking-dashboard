import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth, isManagerOrAdmin } from "@/lib/api-auth";
import { CHANNELS } from "@/constants";

const VALID_LABELS: readonly string[] = CHANNELS;

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { session, error } = await requireAuth(undefined, req);
    if (error) return error;
    const tenantId = session.user.tenantId;

    const eventId = params.id;
    const body = await req.json();
    const { confirmedLabel, source, partnerName, notes, partnerEvidence } = body;

    if (!confirmedLabel || !VALID_LABELS.includes(confirmedLabel)) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid confirmedLabel. Must be one of: ${VALID_LABELS.join(", ")}`,
        },
        { status: 400 }
      );
    }

    // Verify the event exists and belongs to this tenant
    const event = await prisma.calendarEvent.findFirst({
      where: { id: eventId, tenantId },
    });

    if (!event) {
      return NextResponse.json(
        { success: false, error: "Calendar event not found" },
        { status: 404 }
      );
    }

    // Ensure the user owns this event or is a manager/admin
    if (event.userId !== session.user.id && !isManagerOrAdmin(session.user.role)) {
      return NextResponse.json(
        { success: false, error: "Forbidden: you can only review your own meetings" },
        { status: 403 }
      );
    }

    // Check if a review already exists
    // Create review, update event status, and create audit log in a transaction
    // Existence check is inside the transaction to prevent TOCTOU race conditions
    const review = await prisma.$transaction(async (tx) => {
      const existingReview = await tx.meetingReview.findUnique({
        where: { eventId },
      });

      if (existingReview) {
        throw new Error("REVIEW_EXISTS");
      }

      const newReview = await tx.meetingReview.create({
        data: {
          tenantId,
          eventId,
          userId: session.user.id,
          confirmedLabel,
          source: source || null,
          partnerName: partnerName || null,
          notes: notes || null,
          partnerEvidence: partnerEvidence
            ? JSON.stringify(partnerEvidence)
            : null,
        },
      });

      // Mark this event as completed
      const updatedEvent = await tx.calendarEvent.update({
        where: { id: eventId },
        data: { status: "completed" },
      });

      // Also mark sibling events (same physical meeting from other users' calendars)
      // as completed so they don't appear as pending for other team members.
      if (updatedEvent.meetingFingerprint) {
        await tx.calendarEvent.updateMany({
          where: {
            tenantId,
            meetingFingerprint: updatedEvent.meetingFingerprint,
            id: { not: eventId },
            status: "pending",
          },
          data: { status: "completed" },
        });
      }

      await tx.auditLog.create({
        data: {
          tenantId,
          userId: session.user.id,
          action: "classify_meeting",
          entity: "meeting_review",
          entityId: newReview.id,
          details: JSON.stringify({
            eventId,
            confirmedLabel,
            source,
            partnerName,
          }),
        },
      });

      return newReview;
    });

    return NextResponse.json({ success: true, data: review }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "REVIEW_EXISTS") {
      return NextResponse.json(
        { success: false, error: "Review already exists. Use PUT to update." },
        { status: 409 }
      );
    }
    console.error("[POST /api/meetings/[id]/review]", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { session, error } = await requireAuth(undefined, req);
    if (error) return error;
    const tenantId = session.user.tenantId;

    const eventId = params.id;
    const body = await req.json();
    const { confirmedLabel, source, partnerName, notes, partnerEvidence } = body;

    if (confirmedLabel && !VALID_LABELS.includes(confirmedLabel)) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid confirmedLabel. Must be one of: ${VALID_LABELS.join(", ")}`,
        },
        { status: 400 }
      );
    }

    // Verify event exists, belongs to tenant, and check ownership
    const event = await prisma.calendarEvent.findFirst({
      where: { id: eventId, tenantId },
    });

    if (!event) {
      return NextResponse.json(
        { success: false, error: "Calendar event not found" },
        { status: 404 }
      );
    }

    if (event.userId !== session.user.id && !isManagerOrAdmin(session.user.role)) {
      return NextResponse.json(
        { success: false, error: "Forbidden: you can only review your own meetings" },
        { status: 403 }
      );
    }

    const updatedReview = await prisma.$transaction(async (tx) => {
      const existingReview = await tx.meetingReview.findUnique({
        where: { eventId },
      });

      if (!existingReview) {
        throw new Error("NO_EXISTING_REVIEW");
      }

      const review = await tx.meetingReview.update({
        where: { eventId },
        data: {
          ...(confirmedLabel !== undefined && { confirmedLabel }),
          ...(source !== undefined && { source: source || null }),
          ...(partnerName !== undefined && { partnerName: partnerName || null }),
          ...(notes !== undefined && { notes: notes || null }),
          ...(partnerEvidence !== undefined && {
            partnerEvidence: partnerEvidence
              ? JSON.stringify(partnerEvidence)
              : null,
          }),
          reviewedAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId,
          userId: session.user.id,
          action: "update_classification",
          entity: "meeting_review",
          entityId: review.id,
          details: JSON.stringify({
            eventId,
            previousLabel: existingReview.confirmedLabel,
            newLabel: confirmedLabel || existingReview.confirmedLabel,
            source,
            partnerName,
          }),
        },
      });

      return review;
    });

    return NextResponse.json({ success: true, data: updatedReview });
  } catch (err) {
    if (err instanceof Error && err.message === "NO_EXISTING_REVIEW") {
      return NextResponse.json(
        { success: false, error: "No existing review found. Use POST to create." },
        { status: 404 }
      );
    }
    console.error("[PUT /api/meetings/[id]/review]", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

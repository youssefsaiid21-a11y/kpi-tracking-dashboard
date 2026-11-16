import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { sendTeamsMessage } from "@/lib/services/microsoft-graph";

export async function POST(req: NextRequest) {
  try {
    const { session, error } = await requireAuth(["admin"], req);
    if (error) return error;
    const tenantId = session.user.tenantId;

    // Get the reminder config
    const reminderConfig = await prisma.reminderConfig.findFirst({
      where: { tenantId, type: "teams_classification_reminder", isEnabled: true },
    });

    if (!reminderConfig) {
      return NextResponse.json(
        {
          success: false,
          error: "No active reminder configuration found",
        },
        { status: 404 }
      );
    }

    // Get all active reps
    const reps = await prisma.user.findMany({
      where: { tenantId, isActive: true, role: "rep" },
    });

    const webhookUrl =
      reminderConfig.targetChannel ||
      process.env.TEAMS_WEBHOOK_URL ||
      "";

    if (!webhookUrl) {
      return NextResponse.json(
        {
          success: false,
          error:
            "No Teams webhook URL configured. Set targetChannel in reminder config or TEAMS_WEBHOOK_URL env var.",
        },
        { status: 400 }
      );
    }

    // Single groupBy query to get pending counts for all reps at once (fixes N+1)
    const pendingGroups = await prisma.calendarEvent.groupBy({
      by: ["userId"],
      where: {
        tenantId,
        status: "pending",
        isFiltered: false,
        review: null,
        userId: { in: reps.map((r) => r.id) },
      },
      _count: true,
    });
    const pendingMap = new Map(
      pendingGroups.map((g) => [g.userId, g._count])
    );

    const summary: {
      userId: string;
      userName: string;
      pendingCount: number;
      messageSent: boolean;
      error?: string;
    }[] = [];

    for (const rep of reps) {
      const pendingCount = pendingMap.get(rep.id) ?? 0;

      if (pendingCount === 0) {
        summary.push({
          userId: rep.id,
          userName: rep.name || rep.email,
          pendingCount: 0,
          messageSent: false,
        });
        continue;
      }

      const template =
        reminderConfig.messageTemplate ||
        `Hi {repName}, you have {count} meeting(s) awaiting classification. Please review them in the KPI Tracking dashboard.`;

      const message = template
        .replace("{repName}", rep.name || rep.email)
        .replace("{name}", rep.name || rep.email) // support both placeholders
        .replace("{count}", String(pendingCount));

      try {
        await sendTeamsMessage(webhookUrl, message);
        summary.push({
          userId: rep.id,
          userName: rep.name || rep.email,
          pendingCount,
          messageSent: true,
        });
      } catch (msgErr) {
        summary.push({
          userId: rep.id,
          userName: rep.name || rep.email,
          pendingCount,
          messageSent: false,
          error:
            msgErr instanceof Error ? msgErr.message : "Failed to send message",
        });
      }
    }

    const totalPending = summary.reduce((s, r) => s + r.pendingCount, 0);
    const messagesSent = summary.filter((r) => r.messageSent).length;

    // Only update last sent timestamp if at least one message was sent
    if (messagesSent > 0) {
      await prisma.reminderConfig.update({
        where: { id: reminderConfig.id },
        data: { lastSentAt: new Date() },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        totalReps: reps.length,
        repsWithPending: summary.filter((r) => r.pendingCount > 0).length,
        totalPendingMeetings: totalPending,
        messagesSent,
        details: summary,
      },
    });
  } catch (err) {
    console.error("[POST /api/reminders]", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

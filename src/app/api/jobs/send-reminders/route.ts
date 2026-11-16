/**
 * POST /api/jobs/send-reminders
 *
 * Triggered by external cron (e.g. Friday 4PM).
 * Checks ReminderConfig and sends Teams messages for pending reviews.
 * Iterates over all active tenants.
 */

import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api-handler";
import prisma from "@/lib/prisma";
import { sendTeamsMessage } from "@/lib/services/microsoft-graph";
import { getTenantSecrets } from "@/lib/tenant";

export const POST = apiHandler(
  async (req) => {
    const tenants = await prisma.tenant.findMany({ where: { isActive: true } });
    const results = [];

    for (const tenant of tenants) {
      try {
        const secrets = await getTenantSecrets(tenant.id);

        const reminders = await prisma.reminderConfig.findMany({
          where: { isEnabled: true, tenantId: tenant.id },
        });

        let totalSent = 0;
        for (const reminder of reminders) {
          let sent = 0;
          const targetWebhook =
            reminder.targetChannel || secrets.teamsWebhookUrl;
          if (!targetWebhook) continue;

          // Batch: get pending counts for ALL reps in a single query
          const pendingCounts = await prisma.calendarEvent.groupBy({
            by: ["userId"],
            where: { tenantId: tenant.id, isFiltered: false, review: null },
            _count: { id: true },
          });

          if (pendingCounts.length === 0) continue;

          const userIds = pendingCounts.map((p) => p.userId);
          const reps = await prisma.user.findMany({
            where: { id: { in: userIds }, isActive: true, role: "rep", tenantId: tenant.id },
            select: { id: true, name: true, email: true },
          });

          const repMap = new Map(reps.map((r) => [r.id, r]));

          // Build messages and send in parallel (not sequential)
          const messages = pendingCounts
            .filter((pc) => repMap.has(pc.userId) && pc._count.id > 0)
            .map((pc) => {
              const rep = repMap.get(pc.userId)!;
              const template =
                reminder.messageTemplate ??
                `Hi {repName}, you have {count} meetings pending classification. Please review them before end of day.`;
              return template
                .replace("{repName}", rep.name || rep.email)
                .replace("{count}", String(pc._count.id));
            });

          const sendResults = await Promise.allSettled(
            messages.map((msg) => sendTeamsMessage(targetWebhook, msg))
          );
          sent = sendResults.filter((r) => r.status === "fulfilled").length;

          if (sent > 0) {
            await prisma.reminderConfig.update({
              where: { id: reminder.id },
              data: { lastSentAt: new Date() },
            });
          }
          totalSent += sent;
        }

        results.push({ tenant: tenant.slug, status: "completed", sent: totalSent });
      } catch (err) {
        results.push({ tenant: tenant.slug, status: "failed", error: String(err) });
      }
    }

    return NextResponse.json({ success: true, data: results });
  },
  { cronAuth: true }
);

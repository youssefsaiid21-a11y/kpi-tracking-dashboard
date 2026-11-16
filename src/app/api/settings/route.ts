import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { apiHandler } from "@/lib/api-handler";
import { UpdateSettingsSchema } from "@/lib/schemas";
import { invalidateTenant } from "@/lib/cache";

export const GET = apiHandler(
  async (req, { session }) => {
    const tenantId = session.user.tenantId;

    const [integrations, reminders] = await Promise.all([
      prisma.integrationConfig.findMany({ where: { tenantId } }),
      prisma.reminderConfig.findMany({ where: { tenantId } }),
    ]);

    return NextResponse.json({
      success: true,
      data: { integrations, reminders },
    });
  },
  { roles: ["admin"] }
);

export const PUT = apiHandler(
  async (req, { session, body }) => {
    const tenantId = session.user.tenantId;
    const { provider, isEnabled, syncIntervalMin, reminderCron, reminderEnabled } = body;

    const results: Record<string, unknown> = {};

    // Update integration config
    if (provider !== undefined) {
      const existingIntegration = await prisma.integrationConfig.findUnique({
        where: { tenantId_provider: { tenantId, provider } },
      });

      if (!existingIntegration) {
        return NextResponse.json(
          { success: false, error: `Integration config not found for provider: ${provider}` },
          { status: 404 }
        );
      }

      results.integration = await prisma.integrationConfig.update({
        where: { tenantId_provider: { tenantId, provider } },
        data: {
          ...(isEnabled !== undefined && { isEnabled }),
          ...(syncIntervalMin !== undefined && { syncIntervalMin }),
        },
      });
    }

    // Update reminder config
    if (reminderCron !== undefined || reminderEnabled !== undefined) {
      const reminders = await prisma.reminderConfig.findMany({
        where: { tenantId },
        take: 1,
      });

      if (reminders.length > 0) {
        results.reminder = await prisma.reminderConfig.update({
          where: { id: reminders[0].id },
          data: {
            ...(reminderCron !== undefined && { cronExpression: reminderCron }),
            ...(reminderEnabled !== undefined && { isEnabled: reminderEnabled }),
          },
        });
      } else {
        results.reminder = await prisma.reminderConfig.create({
          data: {
            tenantId,
            type: "teams_classification_reminder",
            cronExpression: reminderCron || "0 16 * * 5",
            isEnabled: reminderEnabled ?? true,
          },
        });
      }
    }

    if (Object.keys(results).length === 0) {
      return NextResponse.json(
        { success: false, error: "No valid fields provided for update" },
        { status: 400 }
      );
    }

    // Invalidate cached tenant secrets so changes take effect immediately
    invalidateTenant(tenantId);

    return NextResponse.json({ success: true, data: results });
  },
  { roles: ["admin"], body: UpdateSettingsSchema }
);

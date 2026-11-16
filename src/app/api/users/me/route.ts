import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { apiHandler } from "@/lib/api-handler";

export const GET = apiHandler(async (req, session) => {
  const [user, tokenConfig] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        outlookEmail: true,
        hubspotOwnerId: true,
      },
    }),
    prisma.integrationConfig.findUnique({
      where: {
        tenantId_provider: {
          tenantId: session.user.tenantId,
          provider: `outlook_tokens_${session.user.id}`,
        },
      },
      select: { isEnabled: true },
    }),
  ]);

  return NextResponse.json({
    success: true,
    data: {
      ...user,
      outlookConnected: !!tokenConfig?.isEnabled,
    },
  });
});

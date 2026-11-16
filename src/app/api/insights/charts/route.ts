import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { apiHandler } from "@/lib/api-handler";
import { SaveChartSchema, DeleteChartSchema } from "@/lib/schemas";

export const GET = apiHandler(async (req, { session }) => {
  const charts = await prisma.savedChart.findMany({
    where: { tenantId: session.user.tenantId, userId: session.user.id },
    orderBy: { position: "asc" },
  });

  const parsed = charts.map((c) => ({
    id: c.id,
    title: c.title,
    description: c.description,
    config: JSON.parse(c.config),
    position: c.position,
    isPinned: c.isPinned,
    createdAt: c.createdAt.toISOString(),
  }));

  return NextResponse.json({ success: true, data: parsed });
});

export const POST = apiHandler(
  async (req, { session, body }) => {
    const chart = await prisma.savedChart.create({
      data: {
        tenantId: session.user.tenantId,
        userId: session.user.id,
        title: body.title,
        description: body.description,
        config: body.config,
      },
    });

    return NextResponse.json({
      success: true,
      data: { id: chart.id, title: chart.title },
    });
  },
  { body: SaveChartSchema }
);

export const DELETE = apiHandler(
  async (req, { session, body }) => {
    // Verify ownership
    const chart = await prisma.savedChart.findFirst({
      where: { id: body.id, userId: session.user.id, tenantId: session.user.tenantId },
    });

    if (!chart) {
      return NextResponse.json(
        { success: false, error: "Chart not found" },
        { status: 404 }
      );
    }

    await prisma.savedChart.delete({ where: { id: body.id } });

    return NextResponse.json({ success: true });
  },
  { body: DeleteChartSchema }
);

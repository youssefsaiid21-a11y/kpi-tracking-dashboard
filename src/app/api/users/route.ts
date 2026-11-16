import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { apiHandler } from "@/lib/api-handler";
import { isManagerOrAdmin } from "@/lib/api-auth";
import { CreateUserSchema, UpdateUserSchema } from "@/lib/schemas";

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  outlookEmail: true,
  hubspotOwnerId: true,
  createdAt: true,
  updatedAt: true,
};

export const GET = apiHandler(async (req, { session }) => {
  const tenantId = session.user.tenantId;

  let users;
  if (session.user.role === "admin") {
    users = await prisma.user.findMany({
      where: { tenantId },
      select: USER_SELECT,
      orderBy: { name: "asc" },
    });
  } else if (session.user.role === "manager") {
    users = await prisma.user.findMany({
      where: {
        tenantId,
        OR: [
          { role: "rep", isActive: true },
          { id: session.user.id },
        ],
      },
      select: USER_SELECT,
      orderBy: { name: "asc" },
    });
  } else {
    users = await prisma.user.findMany({
      where: { tenantId, id: session.user.id },
      select: USER_SELECT,
    });
  }

  return NextResponse.json({ success: true, data: users });
});

export const POST = apiHandler(
  async (req, { session, body }) => {
    const tenantId = session.user.tenantId;

    // Verify tenant exists
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!tenant) {
      return NextResponse.json(
        { success: false, error: "Tenant not found" },
        { status: 400 }
      );
    }

    const existing = await prisma.user.findFirst({
      where: { tenantId, email: body.email },
    });
    if (existing) {
      return NextResponse.json(
        { success: false, error: "A user with this email already exists" },
        { status: 409 }
      );
    }

    const passwordHash = await bcrypt.hash(body.password, 12);

    const user = await prisma.user.create({
      data: {
        tenantId,
        email: body.email,
        name: body.name || null,
        passwordHash,
        role: body.role,
        outlookEmail: body.outlookEmail || null,
        hubspotOwnerId: body.hubspotOwnerId || null,
      },
      select: USER_SELECT,
    });

    return NextResponse.json({ success: true, data: user }, { status: 201 });
  },
  { roles: ["admin"], body: CreateUserSchema }
);

export const PUT = apiHandler(
  async (req, { session, body }) => {
    const tenantId = session.user.tenantId;

    const existing = await prisma.user.findFirst({
      where: { id: body.id, tenantId },
    });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "User not found" },
        { status: 404 }
      );
    }

    const needsSessionBump =
      body.password !== undefined ||
      (body.role !== undefined && body.role !== existing.role) ||
      (body.isActive === false && existing.isActive);

    const updateData: Record<string, any> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.role !== undefined) updateData.role = body.role;
    if (body.outlookEmail !== undefined) updateData.outlookEmail = body.outlookEmail || null;
    if (body.hubspotOwnerId !== undefined) updateData.hubspotOwnerId = body.hubspotOwnerId || null;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;
    if (body.password) updateData.passwordHash = await bcrypt.hash(body.password, 12);
    if (needsSessionBump) updateData.sessionVersion = { increment: 1 };

    const user = await prisma.user.update({
      where: { id: body.id },
      data: updateData,
      select: USER_SELECT,
    });

    return NextResponse.json({ success: true, data: user });
  },
  { roles: ["admin"], body: UpdateUserSchema }
);

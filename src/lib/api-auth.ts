import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";
import type { UserRole } from "@/types";

export interface AuthenticatedSession {
  user: {
    id: string;
    role: string;
    tenantId: string;
    name?: string | null;
    email?: string | null;
  };
}

/**
 * Fast auth check using JWT token decode (no DB call, no callback chain).
 * The middleware already verified the token exists — this just extracts user info.
 */
export async function requireAuth(
  requiredRoles?: UserRole[],
  req?: NextRequest
): Promise<
  | { session: AuthenticatedSession; error: null }
  | { session: null; error: NextResponse }
> {
  // Use getToken for fast JWT decode — avoids the slow getServerSession callback chain
  const token = req
    ? await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
    : null;

  if (!token?.userId) {
    return {
      session: null,
      error: NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      ),
    };
  }

  const session: AuthenticatedSession = {
    user: {
      id: token.userId as string,
      role: (token.role as string) || "rep",
      tenantId: (token.tenantId as string) || "",
      name: (token.name as string) || null,
      email: (token.email as string) || null,
    },
  };

  if (requiredRoles && requiredRoles.length > 0) {
    if (!requiredRoles.includes(session.user.role as UserRole)) {
      return {
        session: null,
        error: NextResponse.json(
          { success: false, error: "Forbidden: insufficient permissions" },
          { status: 403 }
        ),
      };
    }
  }

  return { session, error: null };
}

/**
 * Returns true when the role is manager or admin.
 */
export function isManagerOrAdmin(role: string): boolean {
  return role === "manager" || role === "admin";
}

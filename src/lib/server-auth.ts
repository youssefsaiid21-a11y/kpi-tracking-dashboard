/**
 * Server-side auth helper for App Router server components.
 *
 * Uses the same JWT decode approach as api-auth.ts, but reads cookies
 * via next/headers instead of receiving a NextRequest.
 */

import { cookies } from "next/headers";
import { getToken } from "next-auth/jwt";

interface ServerAuth {
  userId: string;
  role: string;
  tenantId: string;
}

export async function getServerAuth(): Promise<ServerAuth | null> {
  try {
    const cookieStore = cookies();

    // getToken accepts a request-like object; we construct a minimal one
    // from the cookie store so it can extract the next-auth session token.
    const token = await getToken({
      req: {
        headers: {
          cookie: cookieStore
            .getAll()
            .map((c) => `${c.name}=${c.value}`)
            .join("; "),
        },
      } as any,
      secret: process.env.NEXTAUTH_SECRET,
    });

    if (!token?.userId) return null;

    return {
      userId: token.userId as string,
      role: (token.role as string) || "rep",
      tenantId: (token.tenantId as string) || "",
    };
  } catch {
    return null;
  }
}

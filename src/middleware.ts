import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

/** Edge-safe constant-time comparison (Web Crypto API, no Node crypto needed) */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  let result = 0;
  for (let i = 0; i < bufA.length; i++) {
    result |= bufA[i] ^ bufB[i];
  }
  return result === 0;
}

// Cache parsed TENANT_SLUGS outside handler — avoids re-splitting on every request
let _validSlugs: string[] | null = null;
function getValidSlugs(): string[] {
  if (!_validSlugs) {
    _validSlugs = (process.env.TENANT_SLUGS || "default")
      .split(",")
      .map((s) => s.trim());
  }
  return _validSlugs;
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  // Resolve tenant slug from hostname or Host header
  const hostname = req.headers.get("host")?.split(":")[0] || req.nextUrl.hostname;
  let slug: string;
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname.endsWith(".ts.net")
  ) {
    slug = process.env.TENANT_SLUG || "default";
  } else {
    slug = hostname.split(".")[0];
  }

  // Validate against known slugs (parsed once, cached in module scope)
  if (!getValidSlugs().includes(slug)) {
    return new NextResponse("Tenant not found", { status: 404 });
  }

  // Set tenant slug header
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-tenant-slug", slug);

  // Public routes — no auth required, just set the header and continue
  if (
    path.startsWith("/login") ||
    path.startsWith("/api/auth") ||
    path.startsWith("/api/health")
  ) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // Job routes — validate CRON_SECRET using timingSafeEqual
  if (path.startsWith("/api/jobs")) {
    const authHeader = req.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }
    const expected = `Bearer ${cronSecret}`;
    const isValid = constantTimeEqual(authHeader ?? "", expected);
    if (!isValid) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // Protected routes — check JWT token
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    // Redirect to login for page requests, 401 for API requests
    if (path.startsWith("/api/")) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: [
    /*
     * Only run middleware on actual page and API routes.
     * Exclude all static assets, Next.js internals, and HMR.
     */
    "/((?!_next|favicon\\.ico|images|.*\\.).*)",
  ],
};

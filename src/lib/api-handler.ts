/**
 * API route handler v2 — Zod validation + auth + error handling in one wrapper.
 *
 * Usage:
 *   export const GET = apiHandler(async (req, { session, query }) => {
 *     // query is already validated and typed
 *     return NextResponse.json({ success: true, data: ... });
 *   }, {
 *     roles: ["manager", "admin"],
 *     query: MeetingsQuerySchema,       // auto-validated from searchParams
 *   });
 *
 *   export const POST = apiHandler(async (req, { session, body }) => {
 *     // body is already validated and typed
 *   }, {
 *     body: CreateUserSchema,           // auto-validated from req.json()
 *   });
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { ZodSchema, ZodError } from "zod";
import { requireAuth, type AuthenticatedSession } from "@/lib/api-auth";
import { searchParamsToObject } from "@/lib/schemas";
import { checkApiRateLimit } from "@/lib/rate-limit";
import type { UserRole } from "@/types";

interface HandlerOptions<TQuery = unknown, TBody = unknown> {
  roles?: UserRole[];
  cronAuth?: boolean;
  query?: ZodSchema<TQuery>;
  body?: ZodSchema<TBody>;
}

interface HandlerContext<TQuery = unknown, TBody = unknown> {
  session: AuthenticatedSession;
  query: TQuery;
  body: TBody;
}

/** Context object passed to handlers. Also spreads session for backward compat. */
type HandlerArg<TQuery = unknown, TBody = unknown> = HandlerContext<TQuery, TBody> & AuthenticatedSession;

type RouteHandler<TQuery = unknown, TBody = unknown> = (
  req: NextRequest,
  ctx: HandlerArg<TQuery, TBody>
) => Promise<NextResponse>;

type CronHandler = (req: NextRequest) => Promise<NextResponse>;

function formatZodError(error: ZodError): string {
  return error.errors
    .map((e) => `${e.path.join(".")}: ${e.message}`)
    .join("; ");
}

export function apiHandler<TQuery = unknown, TBody = unknown>(
  handler: RouteHandler<TQuery, TBody>,
  options?: HandlerOptions<TQuery, TBody>
) {
  return async (req: NextRequest) => {
    try {
      // ── Cron auth ──
      if (options?.cronAuth) {
        const authHeader = req.headers.get("authorization");
        const cronSecret = process.env.CRON_SECRET;
        if (!cronSecret) {
          console.error("[apiHandler] CRON_SECRET not configured — rejecting cron request");
          return NextResponse.json(
            { success: false, error: "Unauthorized" },
            { status: 401 }
          );
        }
        const expected = `Bearer ${cronSecret}`;
        const headerBuf = Buffer.from(authHeader ?? "");
        const expectedBuf = Buffer.from(expected);
        const isValid = headerBuf.length === expectedBuf.length &&
          timingSafeEqual(headerBuf, expectedBuf);
        if (!isValid) {
          return NextResponse.json(
            { success: false, error: "Unauthorized" },
            { status: 401 }
          );
        }
        return await (handler as unknown as CronHandler)(req);
      }

      // ── User auth ──
      const { session, error } = await requireAuth(options?.roles, req);
      if (error) return error;

      // ── Rate limiting ──
      const rateLimitResult = checkApiRateLimit(
        (session as AuthenticatedSession).user.id
      );
      if (!rateLimitResult.allowed) {
        return NextResponse.json(
          { success: false, error: "Too many requests" },
          {
            status: 429,
            headers: {
              "Retry-After": String(
                Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000)
              ),
              "X-RateLimit-Remaining": "0",
              "X-RateLimit-Reset": String(rateLimitResult.resetAt),
            },
          }
        );
      }

      // ── Validate query params ──
      let query: TQuery = {} as TQuery;
      if (options?.query) {
        const raw = searchParamsToObject(req.nextUrl.searchParams);
        const result = options.query.safeParse(raw);
        if (!result.success) {
          return NextResponse.json(
            { success: false, error: formatZodError(result.error) },
            { status: 400 }
          );
        }
        query = result.data;
      }

      // ── Validate body ──
      let body: TBody = {} as TBody;
      if (options?.body) {
        let rawBody: unknown;
        try {
          rawBody = await req.json();
        } catch {
          return NextResponse.json(
            { success: false, error: "Invalid JSON body" },
            { status: 400 }
          );
        }
        const result = options.body.safeParse(rawBody);
        if (!result.success) {
          return NextResponse.json(
            { success: false, error: formatZodError(result.error) },
            { status: 400 }
          );
        }
        body = result.data;
      }

      const ctx = {
        session: session as AuthenticatedSession,
        // Spread session.user at top level for backward compat with old-style handlers
        user: (session as AuthenticatedSession).user,
        query,
        body,
      };

      const response = await handler(req, ctx as HandlerArg<TQuery, TBody>);
      // Cache control: cache GETs, prevent caching mutations
      if (req.method === "GET" && response.status === 200) {
        response.headers.set("Cache-Control", "private, max-age=60, stale-while-revalidate=300");
      } else if (req.method !== "GET") {
        response.headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
      }
      return response;
    } catch (err) {
      const method = req.method;
      const url = req.nextUrl.pathname;
      console.error(`[${method} ${url}]`, err);

      return NextResponse.json(
        { success: false, error: "Internal server error" },
        { status: 500 }
      );
    }
  };
}

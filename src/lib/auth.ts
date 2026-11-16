import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import prisma from "@/lib/prisma";
import { checkAuthRateLimit } from "@/lib/rate-limit";
import { resolveTenant } from "@/lib/tenant";

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60, // 8 hours
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        // Rate limit login attempts by IP to prevent brute force
        const forwarded = (req as any)?.headers?.["x-forwarded-for"];
        const ip = typeof forwarded === "string" ? forwarded.split(",")[0].trim() : "unknown";
        const rateLimit = checkAuthRateLimit(ip);
        if (!rateLimit.allowed) {
          throw new Error("Too many login attempts. Please try again later.");
        }

        // Resolve tenant from request headers (set by middleware)
        const tenantSlug = (req as any)?.headers?.["x-tenant-slug"] || process.env.TENANT_SLUG || "default";
        const tenant = await resolveTenant(tenantSlug);
        if (!tenant) {
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { tenantId_email: { tenantId: tenant.id, email: credentials.email.toLowerCase() } },
        });

        if (!user || !user.isActive) {
          return null;
        }

        const isPasswordValid = await bcrypt.compare(
          credentials.password,
          user.passwordHash
        );

        if (!isPasswordValid) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          tenantId: user.tenantId,
          sessionVersion: user.sessionVersion,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
        token.role = user.role;
        token.tenantId = (user as any).tenantId;
        token.sessionVersion = (user as any).sessionVersion;
        token.lastVerified = Date.now();
      }

      // Verify session is still valid (every 4 hours instead of 30 min — JWT is the source of truth)
      const lastVerified = (token.lastVerified as number) ?? 0;
      if (Date.now() - lastVerified > 4 * 60 * 60 * 1000) {
        try {
          const dbUser = await prisma.user.findUnique({
            where: { id: token.userId as string },
            select: { isActive: true, sessionVersion: true, role: true },
          });

          if (
            !dbUser ||
            !dbUser.isActive ||
            dbUser.sessionVersion !== token.sessionVersion
          ) {
            return { ...token, expired: true };
          }

          token.role = dbUser.role;
          token.lastVerified = Date.now();
        } catch (err) {
          console.error("[auth] JWT verification DB error — session continues but may be stale:", err);
        }
      }

      return token;
    },
    async session({ session, token }) {
      // If token was marked expired, don't provide user data
      if ((token as any).expired) {
        return { ...session, user: undefined, expired: true } as any;
      }

      if (session.user) {
        session.user.id = token.userId;
        session.user.role = token.role;
        session.user.tenantId = token.tenantId;
      }
      return session;
    },
  },
};

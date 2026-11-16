/**
 * GET /api/auth/outlook — Initiates Microsoft OAuth flow using PKCE.
 *
 * Uses Proof Key for Code Exchange (PKCE) instead of a client secret.
 * The code_verifier is stored in an HttpOnly cookie so the callback
 * can use it to exchange the authorization code for tokens.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { createHmac, randomBytes, createHash } from "node:crypto";
import { getOutlookOAuthConfig } from "@/lib/outlook-oauth";

export async function GET(req: NextRequest) {
  const { session, error } = await requireAuth(undefined, req);
  if (error) return error;

  const hmacSecret = process.env.NEXTAUTH_SECRET;
  if (!hmacSecret) {
    return NextResponse.json(
      { success: false, error: "NEXTAUTH_SECRET is not configured." },
      { status: 500 }
    );
  }

  if (!session.user.tenantId || typeof session.user.tenantId !== "string") {
    return NextResponse.json(
      { success: false, error: "Invalid tenant context" },
      { status: 400 }
    );
  }

  const oauth = await getOutlookOAuthConfig(session.user.tenantId);

  if (!oauth.clientId) {
    return NextResponse.json(
      {
        success: false,
        error: "Azure AD not configured. Set AZURE_AD_CLIENT_ID in your .env file.",
      },
      { status: 500 }
    );
  }

  // PKCE: generate code_verifier and code_challenge
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  // State param encodes the user ID so callback knows which user to update
  // HMAC-signed to prevent tampering
  const payload = Buffer.from(
    JSON.stringify({ userId: session.user.id })
  ).toString("base64url");
  const signature = createHmac("sha256", hmacSecret)
    .update(payload)
    .digest("hex");
  const state = `${payload}.${signature}`;

  const authUrl = new URL(
    `https://login.microsoftonline.com/${oauth.azureTenantId}/oauth2/v2.0/authorize`
  );
  authUrl.searchParams.set("client_id", oauth.clientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", oauth.redirectUri);
  authUrl.searchParams.set("scope", oauth.scopes);
  authUrl.searchParams.set("response_mode", "query");
  authUrl.searchParams.set("state", state);
  // Do NOT set "prompt" — let Microsoft decide whether to show account picker,
  // consent screen, or skip straight through based on existing grants.
  // PKCE parameters
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  console.log("[Outlook OAuth] Initiating auth flow:", {
    redirectUri: oauth.redirectUri,
    azureTenantId: oauth.azureTenantId,
    clientId: oauth.clientId?.substring(0, 8) + "...",
    scopes: oauth.scopes,
    authUrl: authUrl.toString().substring(0, 120) + "...",
  });

  const response = NextResponse.redirect(authUrl.toString());

  // Store code_verifier in an HttpOnly cookie for the callback to use
  response.cookies.set("pkce_verifier", codeVerifier, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 minutes
  });

  return response;
}

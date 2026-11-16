/**
 * GET /api/auth/outlook/callback — Microsoft OAuth callback (PKCE).
 *
 * Receives the authorization code from Microsoft, exchanges it for
 * access + refresh tokens using PKCE (no client secret needed),
 * fetches the user's email from Graph API, and stores everything
 * in the database.
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { createHmac, timingSafeEqual } from "crypto";
import { getOutlookOAuthConfig } from "@/lib/outlook-oauth";
import { sendTeamsMessage } from "@/lib/services/microsoft-graph";
import { getTenantSecrets } from "@/lib/tenant";
import { syncOutlookCalendar } from "@/lib/services/sync-manager";
import { encrypt } from "@/lib/encryption";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const errorParam = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");

  const appUrl = (process.env.APP_URL || "").replace(/\/+$/, "");
  if (!appUrl) {
    return NextResponse.json(
      { success: false, error: "APP_URL is not configured" },
      { status: 500 }
    );
  }

  console.log("[Outlook OAuth] Callback received — params:", {
    hasCode: !!code,
    hasState: !!state,
    error: errorParam || null,
    adminConsent: searchParams.get("admin_consent") || null,
    statePrefix: state?.substring(0, 20) || null,
  });

  // Handle admin consent flow response
  const adminConsent = searchParams.get("admin_consent");
  if (state === "admin_consent") {
    if (adminConsent === "True") {
      console.log("[Outlook OAuth] Admin consent granted successfully");
      return NextResponse.redirect(`${appUrl}/settings?admin_consent=granted`);
    } else {
      const reason = errorDescription || errorParam || "Admin consent was not granted";
      console.error("[Outlook OAuth] Admin consent failed:", reason);
      return NextResponse.redirect(
        `${appUrl}/settings?outlook_error=${encodeURIComponent(reason)}`
      );
    }
  }

  // Handle errors from Microsoft
  if (errorParam) {
    console.error("[Outlook OAuth] Error:", errorParam, errorDescription);

    // Only flag as admin consent when Microsoft explicitly says so.
    // AADSTS65001 = "user or admin has not consented" (needs admin grant)
    // AADSTS90094 = "admin consent is required"
    // Don't treat generic "consent_required" or "interaction_required" as admin issues —
    // those usually mean the prompt type blocked the consent screen.
    const desc = errorDescription || "";
    const needsAdminConsent =
      desc.includes("AADSTS65001") ||
      desc.includes("AADSTS90094") ||
      (desc.toLowerCase().includes("admin") && desc.toLowerCase().includes("consent"));

    if (needsAdminConsent) {
      // Attempt to resolve the affected tenant from the state parameter
      // so we only notify that tenant's admins (not all tenants).
      try {
        const dotIdx = (state ?? "").lastIndexOf(".");
        if (dotIdx > 0) {
          const statePayload = (state as string).substring(0, dotIdx);
          const decoded = JSON.parse(Buffer.from(statePayload, "base64url").toString("utf8"));
          if (decoded.userId) {
            const stateUser = await prisma.user.findUnique({
              where: { id: decoded.userId },
              select: { tenantId: true },
            });
            if (stateUser?.tenantId) {
              notifyAdminsConsentNeeded(appUrl, stateUser.tenantId).catch((e) =>
                console.error("[Outlook OAuth] Failed to send admin consent notification:", e)
              );
            }
          }
        }
      } catch {
        // Best-effort: if state can't be decoded, skip notification
        console.warn("[Outlook OAuth] Could not resolve tenant from state for consent notification");
      }

      return NextResponse.redirect(
        `${appUrl}/settings?outlook_error=${encodeURIComponent("admin_consent_required")}`
      );
    }

    return NextResponse.redirect(
      `${appUrl}/settings?outlook_error=${encodeURIComponent(desc || errorParam)}`
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(`${appUrl}/settings?outlook_error=missing_code`);
  }

  // Retrieve PKCE code_verifier from cookie
  const codeVerifier = req.cookies.get("pkce_verifier")?.value;
  if (!codeVerifier) {
    console.error("[Outlook OAuth] Missing PKCE code_verifier cookie");
    return NextResponse.redirect(
      `${appUrl}/settings?outlook_error=${encodeURIComponent("Session expired. Please try again.")}`
    );
  }

  const hmacSecret = process.env.NEXTAUTH_SECRET;
  if (!hmacSecret) {
    console.error("[Outlook OAuth] Missing NEXTAUTH_SECRET");
    return NextResponse.redirect(
      `${appUrl}/settings?outlook_error=${encodeURIComponent("Server misconfiguration")}`
    );
  }

  // Verify HMAC signature on state to prevent tampering
  const dotIndex = state.lastIndexOf(".");
  if (dotIndex === -1) {
    return NextResponse.redirect(`${appUrl}/settings?outlook_error=invalid_state`);
  }

  const payload = state.substring(0, dotIndex);
  const receivedSig = state.substring(dotIndex + 1);
  const expectedSig = createHmac("sha256", hmacSecret)
    .update(payload)
    .digest("hex");

  try {
    const sigMatch = timingSafeEqual(
      Buffer.from(receivedSig, "hex"),
      Buffer.from(expectedSig, "hex")
    );
    if (!sigMatch) {
      return NextResponse.redirect(`${appUrl}/settings?outlook_error=invalid_state`);
    }
  } catch {
    return NextResponse.redirect(`${appUrl}/settings?outlook_error=invalid_state`);
  }

  // Decode state to get userId
  let userId: string;
  try {
    const decoded = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    );
    if (!decoded.userId || typeof decoded.userId !== "string") {
      return NextResponse.redirect(`${appUrl}/settings?outlook_error=invalid_state`);
    }
    userId = decoded.userId;
  } catch {
    return NextResponse.redirect(`${appUrl}/settings?outlook_error=invalid_state`);
  }

  // Verify user belongs to a valid tenant
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { tenantId: true },
  });

  if (!user || !user.tenantId) {
    return NextResponse.redirect(
      `${appUrl}/settings?outlook_error=${encodeURIComponent("User does not belong to a valid tenant")}`
    );
  }

  const oauth = await getOutlookOAuthConfig(user.tenantId);

  if (!oauth.clientId) {
    return NextResponse.redirect(
      `${appUrl}/settings?outlook_error=${encodeURIComponent("Azure AD not configured for this tenant")}`
    );
  }

  // Exchange authorization code for tokens using PKCE + optional client_secret
  const tokenUrl = `https://login.microsoftonline.com/${oauth.azureTenantId}/oauth2/v2.0/token`;

  const tokenParams: Record<string, string> = {
    client_id: oauth.clientId,
    code,
    redirect_uri: oauth.redirectUri,
    grant_type: "authorization_code",
    scope: oauth.scopes,
    code_verifier: codeVerifier,
  };

  // Include client_secret if available (required for "Web" platform registrations)
  if (oauth.clientSecret) {
    tokenParams.client_secret = oauth.clientSecret;
  }

  const tokenBody = new URLSearchParams(tokenParams);

  const tokenRes = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenBody.toString(),
    signal: AbortSignal.timeout(30_000),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    console.error("[Outlook OAuth] Token exchange failed (status %d):", tokenRes.status, errText);

    // Parse the error to show a meaningful message
    let errorMsg = "token_exchange_failed";
    try {
      const errJson = JSON.parse(errText);
      const desc = errJson.error_description || "";
      // Log full details server-side, return safe messages to client
      console.error("[Outlook OAuth] Token error details:", { error: errJson.error, description: desc });
      if (desc.includes("AADSTS7000218") || desc.includes("client_secret")) {
        errorMsg = "Azure AD configuration issue. Please check client secret in Settings.";
      } else if (desc.includes("AADSTS700016")) {
        errorMsg = "Azure AD application not found. Please verify your configuration in Settings.";
      } else if (desc.includes("AADSTS50011") || desc.includes("reply url") || desc.includes("redirect")) {
        errorMsg = "Redirect URI mismatch. Please contact your administrator to verify the Azure AD configuration.";
      } else {
        errorMsg = "Authentication failed. Please try again or contact your administrator.";
      }
    } catch {
      // use raw text if not JSON
      if (errText.length < 300) errorMsg = errText;
    }

    return NextResponse.redirect(
      `${appUrl}/settings?outlook_error=${encodeURIComponent(errorMsg)}`
    );
  }

  const tokens = await tokenRes.json();
  const accessToken = tokens.access_token as string;
  const refreshToken = tokens.refresh_token as string | undefined;

  // Fetch the user's email from Microsoft Graph
  const meRes = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(30_000),
  });

  if (!meRes.ok) {
    console.error("[Outlook OAuth] Failed to fetch /me");
    return NextResponse.redirect(
      `${appUrl}/settings?outlook_error=graph_me_failed`
    );
  }

  const meData = await meRes.json();
  const outlookEmail =
    meData.mail || meData.userPrincipalName || meData.email || null;

  if (!outlookEmail) {
    return NextResponse.redirect(
      `${appUrl}/settings?outlook_error=no_email_found`
    );
  }

  // Store the Outlook email on the user record
  await prisma.user.update({
    where: { id: userId },
    data: { outlookEmail },
  });

  // Store tokens in a per-user integration config entry (encrypted at rest)
  const configKey = `outlook_tokens_${userId}`;
  const tokenJson = JSON.stringify({
    accessToken,
    refreshToken,
    expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    email: outlookEmail,
  });
  const encryptedTokenData = encrypt(tokenJson);

  await prisma.integrationConfig.upsert({
    where: { tenantId_provider: { tenantId: user.tenantId, provider: configKey } },
    create: {
      tenantId: user.tenantId,
      provider: configKey,
      isEnabled: true,
      config: encryptedTokenData,
      lastSyncAt: null,
    },
    update: {
      config: encryptedTokenData,
      isEnabled: true,
    },
  });

  console.log(
    `[Outlook OAuth] Connected ${outlookEmail} for user ${userId}`
  );

  // Trigger an initial calendar sync in the background (fire-and-forget).
  // This ensures meetings appear right away instead of waiting for the next cron run.
  syncOutlookCalendar(user.tenantId, userId).catch((err) =>
    console.error(`[Outlook OAuth] Background sync failed for user ${userId}:`, err)
  );

  // Clear the PKCE cookie and redirect to settings
  const redirectResponse = NextResponse.redirect(
    `${appUrl}/settings?outlook_connected=true`
  );
  redirectResponse.cookies.delete("pkce_verifier");
  return redirectResponse;
}

/**
 * Sends a Teams notification to admins when a user encounters
 * the "admin consent required" error during Outlook OAuth.
 */
async function notifyAdminsConsentNeeded(appUrl: string, tenantId: string): Promise<void> {
  const secrets = await getTenantSecrets(tenantId);
  const webhookUrl = secrets.teamsWebhookUrl || process.env.TEAMS_WEBHOOK_URL;
  if (!webhookUrl) return;

  await sendTeamsMessage(
    webhookUrl,
    [
      `⚠️ **Outlook Admin Consent Required**`,
      ``,
      `A team member tried to connect their Outlook calendar but was blocked because admin consent has not been granted for the app.`,
      ``,
      `**Action needed:** An Azure AD admin must grant consent once so all users can connect.`,
      ``,
      `Go to **Settings → Grant Admin Consent**: ${appUrl}/settings`,
      ``,
      `Or grant consent directly in Azure Portal → Enterprise Applications → find the app → Permissions → Grant admin consent.`,
    ].join("\n")
  );
}

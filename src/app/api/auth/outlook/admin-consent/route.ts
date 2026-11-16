/**
 * GET /api/auth/outlook/admin-consent — Initiates the Azure AD admin consent flow.
 *
 * An Azure AD Global Admin clicks this link once to grant org-wide consent
 * for the app's API permissions (configured in Azure Portal).
 * After consent is granted, individual users can authenticate without
 * seeing the "Need admin approval" screen.
 *
 * Microsoft redirects back to /api/auth/outlook/callback with
 * ?admin_consent=True&tenant=... on success.
 *
 * NOTE: The /adminconsent endpoint does NOT accept a "scope" parameter.
 * It grants consent for all permissions configured in the app registration's
 * "API permissions" blade in Azure Portal.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getOutlookOAuthConfig } from "@/lib/outlook-oauth";

export async function GET(req: NextRequest) {
  const { session, error } = await requireAuth(["admin", "manager"], req);
  if (error) return error;

  const oauth = await getOutlookOAuthConfig(session.user.tenantId);

  if (!oauth.clientId) {
    return NextResponse.json(
      { success: false, error: "Azure AD not configured. Set AZURE_AD_CLIENT_ID in .env." },
      { status: 500 }
    );
  }

  // The /adminconsent endpoint grants org-wide consent for ALL permissions
  // listed in the app registration's "API permissions" section.
  // It does NOT take a "scope" param — scopes are determined by the app registration.
  const consentUrl = new URL(
    `https://login.microsoftonline.com/${oauth.azureTenantId}/adminconsent`
  );
  consentUrl.searchParams.set("client_id", oauth.clientId);
  consentUrl.searchParams.set("redirect_uri", oauth.redirectUri);
  // state=admin_consent so the callback can detect this flow
  consentUrl.searchParams.set("state", "admin_consent");

  return NextResponse.redirect(consentUrl.toString());
}

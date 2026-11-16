import { getTenantSecrets } from "@/lib/tenant";

// Delegated scopes for the PKCE flow.
// Calendars.Read is needed to fetch calendar events via the user's delegated token.
const SCOPES = "openid profile offline_access User.Read Calendars.Read";

/**
 * Single source of truth for all Outlook OAuth configuration.
 * Both the initiation and callback routes use this so redirect URIs,
 * credentials, and scopes can never drift out of sync.
 *
 * Uses PKCE flow — no client_secret required for the delegated auth.
 */
export async function getOutlookOAuthConfig(tenantId: string) {
  const secrets = await getTenantSecrets(tenantId);

  const appUrl = getAppUrl();
  const azureTenantId =
    secrets.azureAdTenantId || process.env.AZURE_AD_TENANT_ID || "common";
  const clientId = secrets.azureAdClientId || process.env.AZURE_AD_CLIENT_ID;
  const clientSecret = secrets.azureAdClientSecret || process.env.AZURE_AD_CLIENT_SECRET || "";
  // Azure AD requires HTTPS for non-localhost redirect URIs.
  // Use OAUTH_REDIRECT_BASE (defaults to localhost) so the callback always works.
  const redirectBase = (process.env.OAUTH_REDIRECT_BASE || appUrl).replace(/\/+$/, "");
  const redirectUri = `${redirectBase}/api/auth/outlook/callback`;

  return {
    appUrl,
    azureTenantId,
    clientId: clientId || null,
    clientSecret: clientSecret || null,
    redirectUri,
    scopes: SCOPES,
  };
}

function getAppUrl(): string {
  const url = process.env.APP_URL;
  if (!url) {
    throw new Error(
      "APP_URL environment variable is not set. Cannot build OAuth redirect URI."
    );
  }
  return url.replace(/\/+$/, ""); // strip trailing slash
}

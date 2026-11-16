import prisma from "@/lib/prisma";
import { getCached, setCache } from "@/lib/cache";
import { decrypt } from "@/lib/encryption";

export interface TenantContext {
  id: string;
  slug: string;
  name: string;
  internalDomains: string[];
  isDemoMode: boolean;
}

export interface TenantSecrets {
  hubspotAccessToken: string | null;
  azureAdTenantId: string | null;
  azureAdClientId: string | null;
  azureAdClientSecret: string | null;
  teamsWebhookUrl: string | null;
}

// Resolve tenant from hostname subdomain or slug
export async function resolveTenant(hostnameOrSlug: string): Promise<TenantContext | null> {
  // Extract subdomain: "acme.app.com" -> "acme", "localhost" -> use TENANT_SLUG env
  let slug: string;
  if (hostnameOrSlug.includes(".")) {
    slug = hostnameOrSlug.split(".")[0];
  } else {
    slug = hostnameOrSlug;
  }

  // For localhost dev, use TENANT_SLUG env var
  if (slug === "localhost" || slug === "127") {
    slug = process.env.TENANT_SLUG || "default";
  }

  const cacheKey = `tenant:${slug}`;
  const cached = getCached<TenantContext>(cacheKey);
  if (cached) return cached;

  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      name: true,
      internalDomains: true,
      isDemoMode: true,
      isActive: true,
    },
  });

  if (!tenant || !tenant.isActive) return null;

  const ctx: TenantContext = {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    internalDomains: JSON.parse(tenant.internalDomains || "[]"),
    isDemoMode: tenant.isDemoMode,
  };

  setCache(cacheKey, ctx, 600); // 10 min cache
  return ctx;
}

// Get decrypted secrets for a tenant
export async function getTenantSecrets(tenantId: string): Promise<TenantSecrets> {
  const cacheKey = `tenant_secrets:${tenantId}`;
  const cached = getCached<TenantSecrets>(cacheKey);
  if (cached) return cached;

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      hubspotAccessToken: true,
      azureAdTenantId: true,
      azureAdClientId: true,
      azureAdClientSecret: true,
      teamsWebhookUrl: true,
    },
  });

  const secrets: TenantSecrets = {
    hubspotAccessToken: (tenant?.hubspotAccessToken ? decrypt(tenant.hubspotAccessToken) : null) || process.env.HUBSPOT_ACCESS_TOKEN || null,
    azureAdTenantId: (tenant?.azureAdTenantId ? decrypt(tenant.azureAdTenantId) : null) || process.env.AZURE_AD_TENANT_ID || null,
    azureAdClientId: (tenant?.azureAdClientId ? decrypt(tenant.azureAdClientId) : null) || process.env.AZURE_AD_CLIENT_ID || null,
    azureAdClientSecret: (tenant?.azureAdClientSecret ? decrypt(tenant.azureAdClientSecret) : null) || process.env.AZURE_AD_CLIENT_SECRET || null,
    teamsWebhookUrl: (tenant?.teamsWebhookUrl ? decrypt(tenant.teamsWebhookUrl) : null) || null,
  };

  setCache(cacheKey, secrets, 300); // 5 min cache
  return secrets;
}

// Resolve tenant slug from request headers (set by middleware)
export function getTenantSlugFromHeaders(headers: Headers): string {
  return headers.get("x-tenant-slug") || process.env.TENANT_SLUG || "default";
}

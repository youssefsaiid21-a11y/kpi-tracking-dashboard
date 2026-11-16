import { INTERNAL_DOMAIN, isInternalEmail } from "@/lib/utils";
import prisma from "@/lib/prisma";
import { decrypt, encrypt } from "@/lib/encryption";

/** fetch with a 30-second timeout to prevent hanging on external API calls */
async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = 30_000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms: ${url.split("?")[0]}`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AzureCredentials {
  azureAdTenantId: string;
  azureAdClientId: string;
  azureAdClientSecret: string;
}

export interface GraphCalendarEvent {
  id: string;
  subject: string | null;
  bodyPreview: string | null;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  isAllDay: boolean;
  isCancelled: boolean;
  isRecurring: boolean;
  seriesMasterId: string | null;
  organizer: { emailAddress: { address: string; name: string } };
  location: { displayName: string } | null;
  onlineMeeting: { joinUrl: string } | null;
  attendees: Array<{
    emailAddress: { address: string; name: string };
    status: { response: string };
  }>;
  responseStatus: { response: string };
}

// ---------------------------------------------------------------------------
// Auth – client-credentials OAuth flow
// ---------------------------------------------------------------------------

export async function getAccessToken(creds?: AzureCredentials): Promise<string> {
  // Use provided credentials, falling back to env vars for backward compat
  const tenantId = creds?.azureAdTenantId || process.env.AZURE_AD_TENANT_ID || "common";
  const clientId = creds?.azureAdClientId || process.env.AZURE_AD_CLIENT_ID;
  const clientSecret = creds?.azureAdClientSecret || process.env.AZURE_AD_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing Azure AD credentials. Provide AzureCredentials or set AZURE_AD_CLIENT_ID and AZURE_AD_CLIENT_SECRET."
    );
  }

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const response = await fetchWithTimeout(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to acquire access token: ${response.status} – ${text}`);
  }

  const data = await response.json();
  return data.access_token as string;
}

// ---------------------------------------------------------------------------
// Delegated token refresh
// ---------------------------------------------------------------------------

/**
 * Get a valid delegated access token for a user, refreshing if expired.
 * Returns null if no tokens are stored or refresh fails.
 */
export async function getUserDelegatedToken(
  tenantId: string,
  userId: string,
  azureClientId: string,
  _azureClientSecret?: string,
): Promise<string | null> {
  const configKey = `outlook_tokens_${userId}`;

  const config = await prisma.integrationConfig.findFirst({
    where: { tenantId, provider: configKey },
    select: { id: true, config: true },
  });

  if (!config?.config) return null;

  let tokens: { accessToken: string; refreshToken?: string; expiresAt: number; email?: string };
  try {
    const decrypted = decrypt(config.config);
    tokens = JSON.parse(decrypted);
  } catch {
    return null;
  }

  // If token is still valid (with 5-minute buffer), return it
  if (tokens.expiresAt > Date.now() + 5 * 60 * 1000) {
    return tokens.accessToken;
  }

  // Token expired — refresh it
  if (!tokens.refreshToken) return null;

  const azureTenantId = "common"; // Multi-tenant
  const tokenUrl = `https://login.microsoftonline.com/${azureTenantId}/oauth2/v2.0/token`;

  // PKCE public client flow — no client_secret needed for refresh
  const body = new URLSearchParams({
    client_id: azureClientId,
    refresh_token: tokens.refreshToken,
    grant_type: "refresh_token",
    scope: "openid profile offline_access User.Read Calendars.Read",
  });

  const res = await fetchWithTimeout(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    console.error(`[Graph] Token refresh failed for user ${userId}:`, await res.text());
    // Mark integration as disabled
    await prisma.integrationConfig.update({
      where: { id: config.id },
      data: { isEnabled: false },
    });
    return null;
  }

  const newTokens = await res.json();

  // Persist updated tokens (encrypted at rest)
  const updatedTokenJson = JSON.stringify({
    accessToken: newTokens.access_token,
    refreshToken: newTokens.refresh_token || tokens.refreshToken,
    expiresAt: Date.now() + (newTokens.expires_in ?? 3600) * 1000,
    email: tokens.email,
  });

  await prisma.integrationConfig.update({
    where: { id: config.id },
    data: { config: encrypt(updatedTokenJson) },
  });

  return newTokens.access_token as string;
}

// ---------------------------------------------------------------------------
// Calendar events – real API
// ---------------------------------------------------------------------------

const CALENDAR_VIEW_FIELDS = [
  "id",
  "subject",
  "bodyPreview",
  "start",
  "end",
  "isAllDay",
  "isCancelled",
  "seriesMasterId",
  "organizer",
  "location",
  "onlineMeeting",
  "attendees",
  "responseStatus",
].join(",");

async function fetchCalendarEventsFromGraph(
  userEmail: string,
  startDate: Date,
  endDate: Date,
  creds?: AzureCredentials
): Promise<GraphCalendarEvent[]> {
  const accessToken = await getAccessToken(creds);

  const startDateTime = startDate.toISOString();
  const endDateTime = endDate.toISOString();

  let url: string | null =
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userEmail)}/calendarView` +
    `?startDateTime=${startDateTime}&endDateTime=${endDateTime}` +
    `&$select=${CALENDAR_VIEW_FIELDS}` +
    `&$top=100` +
    `&$filter=isCancelled eq false`;

  const allEvents: GraphCalendarEvent[] = [];

  while (url) {
    const res: Response = await fetchWithTimeout(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Graph API error fetching calendar for ${userEmail}: ${res.status} – ${text}`
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();
    const events: GraphCalendarEvent[] = (data.value ?? []).map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (raw: any): GraphCalendarEvent => ({
        ...raw,
        isRecurring: !!raw.seriesMasterId,
      })
    );

    allEvents.push(...events);

    // Handle pagination
    url = data["@odata.nextLink"] ?? null;
  }

  return allEvents;
}

// ---------------------------------------------------------------------------
// Calendar events – delegated token API (uses /me/calendarView)
// ---------------------------------------------------------------------------

export async function fetchCalendarEventsWithDelegatedToken(
  accessToken: string,
  startDate: Date,
  endDate: Date,
): Promise<GraphCalendarEvent[]> {
  const startDateTime = startDate.toISOString();
  const endDateTime = endDate.toISOString();

  let url: string | null =
    `https://graph.microsoft.com/v1.0/me/calendarView` +
    `?startDateTime=${startDateTime}&endDateTime=${endDateTime}` +
    `&$select=${CALENDAR_VIEW_FIELDS}` +
    `&$top=100` +
    `&$filter=isCancelled eq false`;

  const allEvents: GraphCalendarEvent[] = [];

  while (url) {
    const response: Response = await fetchWithTimeout(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Graph API error (${response.status}): ${errText}`);
    }

    const data: any = await response.json();
    const events: GraphCalendarEvent[] = (data.value ?? []).map(
      (raw: any): GraphCalendarEvent => ({
        ...raw,
        isRecurring: !!raw.seriesMasterId,
      })
    );
    allEvents.push(...events);
    url = data["@odata.nextLink"] || null;
  }

  return allEvents;
}

// ---------------------------------------------------------------------------
// Calendar events – demo data
// ---------------------------------------------------------------------------

function generateDemoEvents(startDate: Date, endDate: Date): GraphCalendarEvent[] {
  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const rangeStart = startDate > thirtyDaysAgo ? startDate : thirtyDaysAgo;
  const rangeEnd = endDate < now ? endDate : now;

  function randomDate(): Date {
    const start = rangeStart.getTime();
    const end = rangeEnd.getTime();
    const d = new Date(start + Math.random() * (end - start));
    d.setHours(9 + Math.floor(Math.random() * 8), Math.random() > 0.5 ? 0 : 30, 0, 0);
    return d;
  }

  function makeEvent(
    id: string,
    subject: string,
    organizer: { address: string; name: string },
    attendees: Array<{ address: string; name: string; response: string }>,
    options: {
      durationMin?: number;
      isAllDay?: boolean;
      isCancelled?: boolean;
      seriesMasterId?: string | null;
      location?: string;
      joinUrl?: string;
      bodyPreview?: string;
      responseStatus?: string;
    } = {}
  ): GraphCalendarEvent {
    const start = randomDate();
    const durationMin = options.durationMin ?? 30;
    const end = new Date(start.getTime() + durationMin * 60 * 1000);

    return {
      id,
      subject,
      bodyPreview: options.bodyPreview ?? `Discussion: ${subject}`,
      start: { dateTime: start.toISOString(), timeZone: "Singapore Standard Time" },
      end: { dateTime: end.toISOString(), timeZone: "Singapore Standard Time" },
      isAllDay: options.isAllDay ?? false,
      isCancelled: options.isCancelled ?? false,
      isRecurring: !!options.seriesMasterId,
      seriesMasterId: options.seriesMasterId ?? null,
      organizer: { emailAddress: organizer },
      location: options.location ? { displayName: options.location } : null,
      onlineMeeting: options.joinUrl ? { joinUrl: options.joinUrl } : null,
      attendees: attendees.map((a) => ({
        emailAddress: { address: a.address, name: a.name },
        status: { response: a.response },
      })),
      responseStatus: { response: options.responseStatus ?? "accepted" },
    };
  }

  const internal = INTERNAL_DOMAIN; // "company.example"

  const events: GraphCalendarEvent[] = [
    // --- Internal meetings (should be filtered) ---
    makeEvent(
      "demo-001",
      "Weekly Team Standup",
      { address: `jane.lim@${internal}`, name: "Jane Lim" },
      [
        { address: `jane.lim@${internal}`, name: "Jane Lim", response: "organizer" },
        { address: `alex.tan@${internal}`, name: "Alex Tan", response: "accepted" },
        { address: `wei.chen@${internal}`, name: "Wei Chen", response: "accepted" },
        { address: `priya.kumar@${internal}`, name: "Priya Kumar", response: "tentativelyAccepted" },
      ],
      { durationMin: 30, seriesMasterId: "series-001", joinUrl: "https://teams.microsoft.com/l/meet/001", location: "Microsoft Teams Meeting" }
    ),
    makeEvent(
      "demo-002",
      "Sprint Retrospective",
      { address: `alex.tan@${internal}`, name: "Alex Tan" },
      [
        { address: `alex.tan@${internal}`, name: "Alex Tan", response: "organizer" },
        { address: `jane.lim@${internal}`, name: "Jane Lim", response: "accepted" },
        { address: `wei.chen@${internal}`, name: "Wei Chen", response: "accepted" },
      ],
      { durationMin: 60, joinUrl: "https://teams.microsoft.com/l/meet/002" }
    ),
    makeEvent(
      "demo-003",
      "Engineering All-Hands",
      { address: `cto@${internal}`, name: "Demo member Wong" },
      [
        { address: `cto@${internal}`, name: "Demo member Wong", response: "organizer" },
        { address: `jane.lim@${internal}`, name: "Jane Lim", response: "accepted" },
        { address: `alex.tan@${internal}`, name: "Alex Tan", response: "accepted" },
        { address: `priya.kumar@${internal}`, name: "Priya Kumar", response: "accepted" },
        { address: `wei.chen@${internal}`, name: "Wei Chen", response: "declined" },
      ],
      { durationMin: 60, seriesMasterId: "series-002", location: "Conference Room A" }
    ),
    makeEvent(
      "demo-004",
      "1:1 with Manager",
      { address: `jane.lim@${internal}`, name: "Jane Lim" },
      [
        { address: `jane.lim@${internal}`, name: "Jane Lim", response: "organizer" },
        { address: `alex.tan@${internal}`, name: "Alex Tan", response: "accepted" },
      ],
      { durationMin: 30, seriesMasterId: "series-003", joinUrl: "https://teams.microsoft.com/l/meet/004" }
    ),
    makeEvent(
      "demo-005",
      "Product Roadmap Review",
      { address: `priya.kumar@${internal}`, name: "Priya Kumar" },
      [
        { address: `priya.kumar@${internal}`, name: "Priya Kumar", response: "organizer" },
        { address: `jane.lim@${internal}`, name: "Jane Lim", response: "accepted" },
        { address: `cto@${internal}`, name: "Demo member Wong", response: "tentativelyAccepted" },
      ],
      { durationMin: 45, location: "Board Room" }
    ),

    // --- Solo calendar blocks (should be filtered) ---
    makeEvent(
      "demo-006",
      "Focus Time – Deep Work",
      { address: `jane.lim@${internal}`, name: "Jane Lim" },
      [],
      { durationMin: 120 }
    ),
    makeEvent(
      "demo-007",
      "Lunch Break",
      { address: `alex.tan@${internal}`, name: "Alex Tan" },
      [],
      { durationMin: 60 }
    ),
    makeEvent(
      "demo-008",
      "Prep: Quarterly Review Deck",
      { address: `jane.lim@${internal}`, name: "Jane Lim" },
      [
        { address: `jane.lim@${internal}`, name: "Jane Lim", response: "organizer" },
      ],
      { durationMin: 60 }
    ),

    // --- External discovery-type meetings ---
    makeEvent(
      "demo-009",
      "Intro Call – Acme Corp AI Platform",
      { address: `jane.lim@${internal}`, name: "Jane Lim" },
      [
        { address: `jane.lim@${internal}`, name: "Jane Lim", response: "organizer" },
        { address: "member-052@organization-003.example", name: "Demo member Johnson", response: "accepted" },
        { address: "member-035@organization-003.example", name: "Mike Chen", response: "tentativelyAccepted" },
      ],
      { durationMin: 30, joinUrl: "https://teams.microsoft.com/l/meet/009", bodyPreview: "Hi Jane, looking forward to learning about Example Company's AI capabilities." }
    ),
    makeEvent(
      "demo-010",
      "Discovery: TechFlow Solutions – Security Requirements",
      { address: "member-049@organization-026.example", name: "Richard Lee" },
      [
        { address: "member-049@organization-026.example", name: "Richard Lee", response: "organizer" },
        { address: `jane.lim@${internal}`, name: "Jane Lim", response: "accepted" },
        { address: `alex.tan@${internal}`, name: "Alex Tan", response: "accepted" },
      ],
      { durationMin: 45, joinUrl: "https://zoom.us/j/123456", bodyPreview: "Agenda: Security compliance overview, product demo, next steps." }
    ),
    makeEvent(
      "demo-011",
      "Follow-up: NovaTech Proposal Review",
      { address: `jane.lim@${internal}`, name: "Jane Lim" },
      [
        { address: `jane.lim@${internal}`, name: "Jane Lim", response: "organizer" },
        { address: "member-005@organization-019.example", name: "Amanda Wright", response: "accepted" },
        { address: `alex.tan@${internal}`, name: "Alex Tan", response: "accepted" },
      ],
      { durationMin: 60, joinUrl: "https://teams.microsoft.com/l/meet/011", bodyPreview: "Review proposal terms and timeline for Q2 deployment." }
    ),
    makeEvent(
      "demo-012",
      "Demo: Example Company Platform – DataSync Inc",
      { address: `priya.kumar@${internal}`, name: "Priya Kumar" },
      [
        { address: `priya.kumar@${internal}`, name: "Priya Kumar", response: "organizer" },
        { address: "member-061@organization-009.example", name: "Tom Harris", response: "accepted" },
        { address: "member-030@organization-009.example", name: "Lisa Park", response: "accepted" },
        { address: `jane.lim@${internal}`, name: "Jane Lim", response: "accepted" },
      ],
      { durationMin: 60, joinUrl: "https://teams.microsoft.com/l/meet/012", location: "Microsoft Teams Meeting" }
    ),
    makeEvent(
      "demo-013",
      "Pricing Discussion – GlobalRetail Group",
      { address: `jane.lim@${internal}`, name: "Jane Lim" },
      [
        { address: `jane.lim@${internal}`, name: "Jane Lim", response: "organizer" },
        { address: "member-015@organization-011.example", name: "Daniel Morris", response: "accepted" },
      ],
      { durationMin: 30, joinUrl: "https://teams.microsoft.com/l/meet/013" }
    ),
    makeEvent(
      "demo-014",
      "Technical Deep-Dive: SmartBuild Integration",
      { address: `alex.tan@${internal}`, name: "Alex Tan" },
      [
        { address: `alex.tan@${internal}`, name: "Alex Tan", response: "organizer" },
        { address: `wei.chen@${internal}`, name: "Wei Chen", response: "accepted" },
        { address: "member-028@organization-022.example", name: "Kevin Nguyen", response: "accepted" },
        { address: "member-045@organization-022.example", name: "Rachel Gomez", response: "tentativelyAccepted" },
      ],
      { durationMin: 90, joinUrl: "https://teams.microsoft.com/l/meet/014", bodyPreview: "API integration review and architecture walkthrough." }
    ),

    // --- Partner meetings ---
    makeEvent(
      "demo-015",
      "Quarterly Business Review – PartnerCo",
      { address: `jane.lim@${internal}`, name: "Jane Lim" },
      [
        { address: `jane.lim@${internal}`, name: "Jane Lim", response: "organizer" },
        { address: "member-033@organization-021.example", name: "Mark Robinson", response: "accepted" },
        { address: "member-017@organization-021.example", name: "Emily Zhang", response: "accepted" },
        { address: `priya.kumar@${internal}`, name: "Priya Kumar", response: "accepted" },
      ],
      { durationMin: 60, joinUrl: "https://teams.microsoft.com/l/meet/015", location: "Microsoft Teams Meeting", bodyPreview: "QBR: pipeline review, co-sell updates, marketing plans." }
    ),
    makeEvent(
      "demo-016",
      "Joint Go-to-Market Planning – Channel Partner IO",
      { address: "member-057@organization-006.example", name: "Steve Clark" },
      [
        { address: "member-057@organization-006.example", name: "Steve Clark", response: "organizer" },
        { address: `jane.lim@${internal}`, name: "Jane Lim", response: "accepted" },
        { address: "member-037@organization-006.example", name: "Nina Patel", response: "accepted" },
      ],
      { durationMin: 45, joinUrl: "https://meet.google.com/abc-def-ghi", bodyPreview: "Align on joint GTM strategy for APAC region." }
    ),
    makeEvent(
      "demo-017",
      "Partner Enablement Session – PartnerCo",
      { address: `alex.tan@${internal}`, name: "Alex Tan" },
      [
        { address: `alex.tan@${internal}`, name: "Alex Tan", response: "organizer" },
        { address: "member-033@organization-021.example", name: "Mark Robinson", response: "accepted" },
        { address: "member-024@organization-021.example", name: "Demo member Wu", response: "declined" },
      ],
      { durationMin: 60, joinUrl: "https://teams.microsoft.com/l/meet/017" }
    ),

    // --- Ambiguous meetings ---
    makeEvent(
      "demo-018",
      "Catch Up",
      { address: `jane.lim@${internal}`, name: "Jane Lim" },
      [
        { address: `jane.lim@${internal}`, name: "Jane Lim", response: "organizer" },
        { address: "member-063@gmail.com", name: "Unknown Contact", response: "accepted" },
      ],
      { durationMin: 30, bodyPreview: "Quick sync to discuss opportunities." }
    ),
    makeEvent(
      "demo-019",
      "Coffee Chat",
      { address: "member-047@organization-013.example", name: "Pat Recruiter" },
      [
        { address: "member-047@organization-013.example", name: "Pat Recruiter", response: "organizer" },
        { address: `jane.lim@${internal}`, name: "Jane Lim", response: "tentativelyAccepted" },
      ],
      { durationMin: 30, responseStatus: "tentativelyAccepted" }
    ),
    makeEvent(
      "demo-020",
      "Industry Roundtable: AI in Workplace Safety",
      { address: "member-018@organization-025.example", name: "Tech Conference Org" },
      [
        { address: "member-018@organization-025.example", name: "Tech Conference Org", response: "organizer" },
        { address: `jane.lim@${internal}`, name: "Jane Lim", response: "accepted" },
        { address: "member-055@organization-005.example", name: "Speaker One", response: "accepted" },
        { address: "member-056@organization-023.example", name: "Speaker Two", response: "accepted" },
      ],
      { durationMin: 90, location: "Grand Hyatt Singapore, Room 3A", bodyPreview: "Panel discussion on AI applications in workplace safety monitoring." }
    ),

    // Extra events for volume
    makeEvent(
      "demo-021",
      "Contract Negotiation – MegaRetail",
      { address: `jane.lim@${internal}`, name: "Jane Lim" },
      [
        { address: `jane.lim@${internal}`, name: "Jane Lim", response: "organizer" },
        { address: "member-029@organization-017.example", name: "MegaRetail Legal", response: "accepted" },
        { address: "member-043@organization-017.example", name: "MegaRetail Procurement", response: "accepted" },
      ],
      { durationMin: 60, joinUrl: "https://teams.microsoft.com/l/meet/021" }
    ),
    makeEvent(
      "demo-022",
      "Pipeline Review",
      { address: `jane.lim@${internal}`, name: "Jane Lim" },
      [
        { address: `jane.lim@${internal}`, name: "Jane Lim", response: "organizer" },
        { address: `alex.tan@${internal}`, name: "Alex Tan", response: "accepted" },
        { address: `priya.kumar@${internal}`, name: "Priya Kumar", response: "accepted" },
      ],
      { durationMin: 45, seriesMasterId: "series-004", location: "Conference Room B" }
    ),
    makeEvent(
      "demo-023",
      "POC Kickoff – UrbanTech",
      { address: `alex.tan@${internal}`, name: "Alex Tan" },
      [
        { address: `alex.tan@${internal}`, name: "Alex Tan", response: "organizer" },
        { address: `wei.chen@${internal}`, name: "Wei Chen", response: "accepted" },
        { address: "member-014@organization-027.example", name: "UrbanTech CTO", response: "accepted" },
      ],
      { durationMin: 60, joinUrl: "https://teams.microsoft.com/l/meet/023", bodyPreview: "Kick off proof-of-concept for warehouse monitoring solution." }
    ),
    makeEvent(
      "demo-024",
      "Investor Update Call",
      { address: `cto@${internal}`, name: "Demo member Wong" },
      [
        { address: `cto@${internal}`, name: "Demo member Wong", response: "organizer" },
        { address: `jane.lim@${internal}`, name: "Jane Lim", response: "accepted" },
        { address: "member-041@organization-028.example", name: "VC Partner", response: "accepted" },
      ],
      { durationMin: 30, joinUrl: "https://zoom.us/j/789012" }
    ),
    makeEvent(
      "demo-025",
      "All Day – Company Offsite",
      { address: `cto@${internal}`, name: "Demo member Wong" },
      [
        { address: `cto@${internal}`, name: "Demo member Wong", response: "organizer" },
        { address: `jane.lim@${internal}`, name: "Jane Lim", response: "accepted" },
        { address: `alex.tan@${internal}`, name: "Alex Tan", response: "accepted" },
        { address: `priya.kumar@${internal}`, name: "Priya Kumar", response: "accepted" },
        { address: `wei.chen@${internal}`, name: "Wei Chen", response: "accepted" },
      ],
      { isAllDay: true, durationMin: 480, location: "Sentosa Island" }
    ),
  ];

  return events;
}

// ---------------------------------------------------------------------------
// Public entry point – decides between real and demo
// ---------------------------------------------------------------------------

export async function fetchCalendarEvents(
  userEmail: string,
  startDate: Date,
  endDate: Date,
  creds?: AzureCredentials,
  options?: { demoMode?: boolean; delegatedToken?: string }
): Promise<GraphCalendarEvent[]> {
  if (options?.demoMode || process.env.DEMO_MODE === "true") {
    console.log(`[DEMO] Returning demo calendar events for ${userEmail}`);
    return generateDemoEvents(startDate, endDate);
  }

  if (options?.delegatedToken) {
    return fetchCalendarEventsWithDelegatedToken(options.delegatedToken, startDate, endDate);
  }

  return fetchCalendarEventsFromGraph(userEmail, startDate, endDate, creds);
}

// ---------------------------------------------------------------------------
// Classification helpers
// ---------------------------------------------------------------------------

export function isInternalMeeting(
  attendees: GraphCalendarEvent["attendees"],
  organizerEmail: string,
  internalDomains?: string[]
): boolean {
  if (internalDomains && internalDomains.length > 0) {
    const organizerDomain = organizerEmail.toLowerCase().split("@")[1];
    if (!internalDomains.some((d) => d.toLowerCase() === organizerDomain)) return false;
    return attendees.every((a) =>
      isInternalEmail(a.emailAddress.address, internalDomains)
    );
  }
  // Backward compat: use INTERNAL_DOMAIN
  const organizerDomain = organizerEmail.toLowerCase().split("@")[1];
  if (organizerDomain !== INTERNAL_DOMAIN) return false;

  return attendees.every(
    (a) =>
      a.emailAddress.address.toLowerCase().endsWith(`@${INTERNAL_DOMAIN}`)
  );
}

export function isSoloMeeting(
  attendees: GraphCalendarEvent["attendees"]
): boolean {
  return attendees.length <= 1;
}

// ---------------------------------------------------------------------------
// Process a single calendar event into a normalised shape
// ---------------------------------------------------------------------------

export function processCalendarEvent(event: GraphCalendarEvent, internalDomains?: string[]) {
  const startTime = new Date(event.start.dateTime);
  const endTime = new Date(event.end.dateTime);
  const durationMinutes = Math.round(
    (endTime.getTime() - startTime.getTime()) / (1000 * 60)
  );

  const organizerEmail = event.organizer.emailAddress.address;
  const organizerName = event.organizer.emailAddress.name;

  const internal = isInternalMeeting(event.attendees, organizerEmail, internalDomains);
  const solo = isSoloMeeting(event.attendees);
  const isFiltered = internal || solo;

  let filterReason: string | null = null;
  if (solo) filterReason = "solo";
  else if (internal) filterReason = "internal";

  const attendees = event.attendees.map((a) => ({
    email: a.emailAddress.address,
    name: a.emailAddress.name,
    responseStatus: a.status.response,
    isOrganizer: a.emailAddress.address.toLowerCase() === organizerEmail.toLowerCase(),
    isInternal: isInternalEmail(a.emailAddress.address, internalDomains),
  }));

  return {
    externalId: event.id,
    subject: event.subject,
    bodyPreview: event.bodyPreview,
    startTime,
    endTime,
    duration: durationMinutes,
    isAllDay: event.isAllDay,
    isCancelled: event.isCancelled,
    isRecurring: event.isRecurring,
    recurrenceId: event.seriesMasterId,
    organizer: organizerEmail,
    organizerName,
    location: event.location?.displayName ?? null,
    onlineMeetingUrl: event.onlineMeeting?.joinUrl ?? null,
    isInternal: internal,
    isSolo: solo,
    isFiltered,
    filterReason,
    attendees,
  };
}

// ---------------------------------------------------------------------------
// Teams webhook messaging
// ---------------------------------------------------------------------------

export async function sendTeamsMessage(
  webhookUrl: string,
  message: string
): Promise<void> {
  if (process.env.DEMO_MODE === "true") {
    console.log(`[DEMO] Teams message (webhook: ${webhookUrl}):\n${message}`);
    return;
  }

  const card = {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body: [
            {
              type: "TextBlock",
              text: message,
              wrap: true,
            },
          ],
        },
      },
    ],
  };

  const response = await fetchWithTimeout(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(card),
  }, 15_000);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to send Teams message: ${response.status} – ${text}`
    );
  }
}

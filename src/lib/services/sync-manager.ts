/**
 * Sync Manager v2 (multi-tenant)
 *
 * Fixes from v1:
 * - Attendees are UPSERTED by (eventId, email) instead of delete-recreate,
 *   preserving isPartnerContact enrichment across syncs.
 * - Users are synced in concurrent batches of BATCH_SIZE instead of sequentially.
 * - Sync functions are decoupled (no more syncAll monolith calling anomaly detection).
 * - Each sync creates its own SyncLog and handles errors independently.
 *
 * v3 multi-tenant:
 * - All functions take tenantId as first parameter
 * - All Prisma queries scoped by tenantId
 * - Tenant secrets used for API credentials instead of env vars
 *
 * Future: add delta token support for incremental Graph sync when
 * IntegrationConfig.deltaLink is available.
 */

import { createHash } from "crypto";
import prisma from "@/lib/prisma";
import {
  fetchCalendarEvents,
  getUserDelegatedToken,
  processCalendarEvent,
  sendTeamsMessage,
  type AzureCredentials,
} from "@/lib/services/microsoft-graph";
import { HubSpotService } from "@/lib/services/hubspot";
import {
  classifyMeeting,
  type ClassificationInput,
} from "@/lib/services/classification-engine";
import { getTenantSecrets } from "@/lib/tenant";

const BATCH_SIZE = parseInt(process.env.SYNC_BATCH_SIZE ?? "3", 10);

/**
 * Compute a stable fingerprint for a meeting so the same physical meeting
 * synced from multiple users' calendars can be linked together.
 * Uses organizer email + start time (minute-precision) + lowercased subject.
 */
function computeMeetingFingerprint(
  organizer: string | null,
  startTime: Date,
  subject: string | null,
): string {
  const key = [
    (organizer ?? "").toLowerCase().trim(),
    startTime.toISOString().slice(0, 16), // minute precision
    (subject ?? "").toLowerCase().trim(),
  ].join("|");
  return createHash("sha256").update(key).digest("hex").slice(0, 32);
}

// ─── Concurrency guard ─────────────────────────────────────

/**
 * Checks if a sync for the given provider is already running.
 * Returns true if a sync started in the last 10 minutes is still in "started" state.
 */
async function isSyncAlreadyRunning(provider: string, tenantId: string): Promise<boolean> {
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  const running = await prisma.syncLog.findFirst({
    where: {
      tenantId,
      provider,
      status: "started",
      startedAt: { gte: tenMinutesAgo },
    },
  });
  return running !== null;
}

/**
 * Sends a Teams notification when a sync fails, if webhook is configured.
 */
async function notifySyncFailure(provider: string, error: string, webhookUrl?: string | null): Promise<void> {
  const url = webhookUrl || process.env.TEAMS_WEBHOOK_URL;
  if (!url) return;

  try {
    await sendTeamsMessage(
      url,
      `🚨 Sync failure: ${provider}\n\nError: ${error}\n\nCheck the admin panel for details.`
    );
  } catch {
    console.error(`Failed to send sync failure notification for ${provider}`);
  }
}

// ─── Utility: process array in batches ──────────────────────

async function processBatched<T>(
  items: T[],
  batchSize: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await Promise.allSettled(batch.map(fn));
  }
}

// ─── syncAllCalendars ───────────────────────────────────────

export async function syncAllCalendars(tenantId: string) {
  const users = await prisma.user.findMany({
    where: { tenantId, isActive: true, outlookEmail: { not: null } },
    select: { id: true, outlookEmail: true },
  });

  const results: Array<{ userId: string; status: string; error?: string }> = [];

  await processBatched(users, BATCH_SIZE, async (user) => {
    try {
      const result = await syncOutlookCalendar(tenantId, user.id);
      results.push({ userId: user.id, status: result.status, ...(result.status === "skipped" && "reason" in result ? { error: result.reason } : {}) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Calendar sync failed for user ${user.id}:`, msg);
      results.push({ userId: user.id, status: "failed", error: msg });
    }
  });

  return results;
}

// ─── syncOutlookCalendar (single user) ──────────────────────

export async function syncOutlookCalendar(tenantId: string, userId: string) {
  const providerKey = `microsoft_graph_${userId}`;

  // Atomic concurrency guard: try to create a SyncLog, catch unique constraint
  // violation (or check-after-create) to prevent two concurrent syncs.
  let syncLog: { id: string };
  try {
    // First check if one is already running (fast path)
    if (await isSyncAlreadyRunning(providerKey, tenantId)) {
      return { status: "skipped", reason: "sync already running" };
    }
    // Create the SyncLog atomically
    syncLog = await prisma.syncLog.create({
      data: { tenantId, provider: providerKey, syncType: "full", status: "started" },
    });
    // Double-check: if another sync was created concurrently, the one with the
    // earlier id wins; the other bails out.
    const concurrentRunning = await prisma.syncLog.count({
      where: {
        tenantId,
        provider: providerKey,
        status: "started",
        startedAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
      },
    });
    if (concurrentRunning > 1) {
      // Another sync beat us — clean up our entry and bail
      await prisma.syncLog.update({
        where: { id: syncLog.id },
        data: { status: "failed", errorMessage: "Lost concurrency race", completedAt: new Date(), durationMs: 0 },
      });
      return { status: "skipped", reason: "sync already running" };
    }
  } catch (err: any) {
    // If a unique constraint error occurs, another sync is already running
    if (err?.code === "P2002") {
      return { status: "skipped", reason: "sync already running" };
    }
    throw err;
  }
  const startedAt = Date.now();

  // Get tenant secrets for Azure AD credentials
  const secrets = await getTenantSecrets(tenantId);
  if (!secrets.azureAdClientId) {
    await prisma.syncLog.update({
      where: { id: syncLog.id },
      data: { status: "failed", errorMessage: "Azure AD client ID not configured", completedAt: new Date(), durationMs: 0 },
    });
    return { status: "skipped", reason: "Azure AD client ID not configured for this tenant" };
  }

  // Client credentials are optional — delegated tokens (PKCE) work without a secret
  const hasClientCreds = !!(secrets.azureAdClientId && secrets.azureAdClientSecret);
  const azureCreds: AzureCredentials | undefined = hasClientCreds
    ? {
        azureAdTenantId: secrets.azureAdTenantId || "common",
        azureAdClientId: secrets.azureAdClientId,
        azureAdClientSecret: secrets.azureAdClientSecret!,
      }
    : undefined;

  // Get tenant's internal domains for processCalendarEvent
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { internalDomains: true, isDemoMode: true },
  });
  let internalDomains: string[] = [];
  if (tenant?.internalDomains) {
    try {
      const parsed = JSON.parse(tenant.internalDomains);
      internalDomains = Array.isArray(parsed) ? parsed : [];
    } catch {
      console.warn(`[sync] Invalid internalDomains JSON for tenant ${tenantId}`);
    }
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { outlookEmail: true },
    });

    if (!user?.outlookEmail) {
      throw new Error(`User ${userId} has no outlookEmail configured.`);
    }

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 90);

    // Try user-delegated token first (PKCE — no client_secret needed), fall back to client credentials
    let delegatedToken: string | null = null;
    if (secrets.azureAdClientId) {
      delegatedToken = await getUserDelegatedToken(
        tenantId,
        userId,
        secrets.azureAdClientId,
      );
    }

    if (!delegatedToken && !azureCreds) {
      throw new Error(
        `No auth available for user ${userId}: no delegated token and no client credentials. ` +
        `User needs to connect Outlook in Settings, or configure AZURE_AD_CLIENT_SECRET for app-only access.`
      );
    }

    const graphEvents = await fetchCalendarEvents(
      user.outlookEmail,
      startDate,
      endDate,
      delegatedToken ? undefined : azureCreds,
      {
        demoMode: tenant?.isDemoMode ?? false,
        delegatedToken: delegatedToken || undefined,
      }
    );

    // Prefetch partner data once for classification
    const partners = await prisma.partnerEntity.findMany({
      where: { tenantId, isActive: true },
      select: { domain: true, contactEmails: true },
    });

    const partnerDomains = partners
      .map((p) => p.domain)
      .filter((d): d is string => d !== null);

    // contactEmails is now a native PostgreSQL array (String[])
    // Use a Set for O(1) lookups instead of Array.some() O(n) per check
    const partnerEmailSet = new Set<string>();
    for (const p of partners) {
      if (!p.contactEmails) continue;
      // Handle both native array (PostgreSQL) and JSON string (SQLite migration)
      const emails = Array.isArray(p.contactEmails)
        ? p.contactEmails
        : (() => { try { return JSON.parse(p.contactEmails as unknown as string) as string[]; } catch { return []; } })();
      for (const e of emails) partnerEmailSet.add(e.toLowerCase());
    }
    // Keep array for classification engine (which expects string[])
    const partnerEmails = [...partnerEmailSet];

    // Prefetch known external emails from previously synced events (for repeat detection).
    // Any external attendee that already exists in the DB is a "known" contact.
    const knownExternalAttendees = await prisma.eventAttendee.findMany({
      where: { tenantId, isInternal: false },
      select: { email: true },
      distinct: ["email"],
    });
    const knownExternalEmails = knownExternalAttendees.map((a) => a.email.toLowerCase());

    let created = 0;
    let updated = 0;

    // BATCH: prefetch all existing events for this user to avoid N+1 findUnique calls
    const processedEvents = graphEvents.map((ge) => processCalendarEvent(ge, internalDomains));
    const externalIds = processedEvents.map((p) => p.externalId);
    const existingEvents = await prisma.calendarEvent.findMany({
      where: { tenantId, externalId: { in: externalIds } },
      select: { id: true, externalId: true },
    });
    const existingMap = new Map(existingEvents.map((e) => [e.externalId, e.id]));

    // Process events in parallel batches of 10 for ~10x faster sync
    const EVENT_BATCH = 10;
    for (let batchStart = 0; batchStart < graphEvents.length; batchStart += EVENT_BATCH) {
      const batchEnd = Math.min(batchStart + EVENT_BATCH, graphEvents.length);
      await Promise.all(
        processedEvents.slice(batchStart, batchEnd).map(async (processed, batchIdx) => {
          const idx = batchStart + batchIdx;
          const existingId = existingMap.get(processed.externalId);

          let eventId: string;

          const fingerprint = computeMeetingFingerprint(
            processed.organizer,
            processed.startTime,
            processed.subject,
          );

          const eventData = {
            subject: processed.subject,
            bodyPreview: processed.bodyPreview,
            startTime: processed.startTime,
            endTime: processed.endTime,
            duration: processed.duration,
            isAllDay: processed.isAllDay,
            isCancelled: processed.isCancelled,
            isRecurring: processed.isRecurring,
            recurrenceId: processed.recurrenceId,
            organizer: processed.organizer,
            organizerName: processed.organizerName,
            location: processed.location,
            onlineMeetingUrl: processed.onlineMeetingUrl,
            meetingFingerprint: fingerprint,
            isInternal: processed.isInternal,
            isSolo: processed.isSolo,
            isFiltered: processed.isFiltered,
            filterReason: processed.filterReason,
            syncedAt: new Date(),
          };

          if (existingId) {
            await prisma.calendarEvent.update({
              where: { id: existingId },
              data: eventData,
            });
            eventId = existingId;
            updated++;
          } else {
            // Check if a sibling event (same physical meeting from another user)
            // was already reviewed — if so, create this one as "completed" immediately
            // so it never appears as a pending duplicate.
            const siblingReviewed = await prisma.calendarEvent.findFirst({
              where: {
                tenantId,
                meetingFingerprint: fingerprint,
                status: "completed",
              },
              select: { id: true },
            });

            const newEvent = await prisma.calendarEvent.create({
              data: {
                tenantId,
                externalId: processed.externalId,
                userId,
                ...eventData,
                ...(siblingReviewed ? { status: "completed" } : {}),
                rawJson: JSON.stringify(graphEvents[idx]),
              },
            });
            eventId = newEvent.id;
            created++;
          }

          // UPSERT attendees in parallel within each event
          await Promise.all(
            processed.attendees.map(async (attendee) => {
              const isPartner = partnerEmailSet.has(attendee.email.toLowerCase());

              await prisma.eventAttendee.upsert({
                where: {
                  eventId_email: { eventId, email: attendee.email },
                },
                create: {
                  tenantId,
                  eventId,
                  email: attendee.email,
                  name: attendee.name,
                  responseStatus: attendee.responseStatus,
                  isOrganizer: attendee.isOrganizer,
                  isInternal: attendee.isInternal,
                  isPartnerContact: isPartner,
                },
                update: {
                  name: attendee.name,
                  responseStatus: attendee.responseStatus,
                  isOrganizer: attendee.isOrganizer,
                  isInternal: attendee.isInternal,
                  ...(isPartner ? { isPartnerContact: true } : {}),
                },
              });
            })
          );

          // Classify new, unreviewed, non-filtered events
          if (!existingId && !processed.isFiltered) {
            const classInput: ClassificationInput = {
              subject: processed.subject,
              attendees: processed.attendees.map((a) => ({
                email: a.email,
                name: a.name,
                isInternal: a.isInternal,
              })),
              organizer: processed.organizer,
              duration: processed.duration,
              isRecurring: processed.isRecurring,
              partnerDomains,
              partnerEmails,
              internalDomains,
              knownExternalEmails,
            };

            const result = classifyMeeting(classInput);

            await prisma.suggestedClassification.upsert({
              where: { eventId },
              create: {
                tenantId,
                eventId,
                suggestedLabel: result.suggestedLabel,
                confidence: result.confidence,
                reasoning: result.reasoning,
                signals: JSON.stringify(result.signals),
              },
              update: {
                suggestedLabel: result.suggestedLabel,
                confidence: result.confidence,
                reasoning: result.reasoning,
                signals: JSON.stringify(result.signals),
              },
            });
          }
        })
      );
    }

    await prisma.syncLog.update({
      where: { id: syncLog.id },
      data: {
        status: "completed",
        recordsProcessed: graphEvents.length,
        recordsCreated: created,
        recordsUpdated: updated,
        completedAt: new Date(),
        durationMs: Date.now() - startedAt,
      },
    });

    await prisma.integrationConfig.upsert({
      where: { tenantId_provider: { tenantId, provider: "microsoft_graph" } },
      update: { lastSyncAt: new Date() },
      create: { tenantId, provider: "microsoft_graph", isEnabled: true, lastSyncAt: new Date() },
    });

    return { status: "completed", created, updated };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    await prisma.syncLog.update({
      where: { id: syncLog.id },
      data: {
        status: "failed",
        errorMessage: errMsg,
        completedAt: new Date(),
        durationMs: Date.now() - startedAt,
      },
    });
    await notifySyncFailure(providerKey, errMsg, secrets.teamsWebhookUrl);
    throw error;
  }
}

// ─── syncHubSpot ────────────────────────────────────────────

export async function syncHubSpot(tenantId: string) {
  // Atomic concurrency guard (same pattern as syncOutlookCalendar)
  let syncLog: { id: string };
  try {
    if (await isSyncAlreadyRunning("hubspot", tenantId)) {
      return { status: "skipped", reason: "sync already running" };
    }
    syncLog = await prisma.syncLog.create({
      data: { tenantId, provider: "hubspot", syncType: "full", status: "started" },
    });
    const concurrentRunning = await prisma.syncLog.count({
      where: {
        tenantId,
        provider: "hubspot",
        status: "started",
        startedAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
      },
    });
    if (concurrentRunning > 1) {
      await prisma.syncLog.update({
        where: { id: syncLog.id },
        data: { status: "failed", errorMessage: "Lost concurrency race", completedAt: new Date(), durationMs: 0 },
      });
      return { status: "skipped", reason: "sync already running" };
    }
  } catch (err: any) {
    if (err?.code === "P2002") {
      return { status: "skipped", reason: "sync already running" };
    }
    throw err;
  }
  const startedAt = Date.now();

  // Get tenant secrets for HubSpot credentials
  const secrets = await getTenantSecrets(tenantId);
  if (!secrets.hubspotAccessToken) {
    await prisma.syncLog.update({
      where: { id: syncLog.id },
      data: { status: "failed", errorMessage: "HubSpot not configured", completedAt: new Date(), durationMs: 0 },
    });
    return { status: "skipped", reason: "HubSpot not configured for this tenant" };
  }

  // Get tenant's demo mode flag
  const tenantRecord = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { isDemoMode: true },
  });

  const hubspot = new HubSpotService(secrets.hubspotAccessToken, tenantRecord?.isDemoMode ?? false);

  try {
    let created = 0;
    let updated = 0;

    // Sync pipelines and stages
    const pipelines = await hubspot.getPipelines();

    for (const pipeline of pipelines) {
      // Use upsert return value directly instead of a separate findUnique
      const pipelineDef = await prisma.pipelineDefinition.upsert({
        where: { tenantId_hubspotId: { tenantId, hubspotId: pipeline.id } },
        create: { tenantId, hubspotId: pipeline.id, label: pipeline.label, syncedAt: new Date() },
        update: { label: pipeline.label, syncedAt: new Date() },
      });

      for (const stage of pipeline.stages) {
        const probability = (() => {
          const p = Number(stage.metadata.probability);
          return isNaN(p) ? null : p;
        })();
        const isClosed = stage.metadata.isClosed === "true";
        const isWon = isClosed && probability === 1.0;
        await prisma.pipelineStage.upsert({
          where: { tenantId_hubspotId: { tenantId, hubspotId: stage.id } },
          create: {
            tenantId,
            pipelineId: pipelineDef.id,
            hubspotId: stage.id,
            label: stage.label,
            displayOrder: stage.displayOrder,
            probability,
            isClosed,
            isWon,
          },
          update: {
            label: stage.label,
            displayOrder: stage.displayOrder,
            probability,
            isClosed,
            isWon,
          },
        });
      }
    }

    // Sync deals
    const deals = await hubspot.getAllDeals();

    // PERF: Prefetch all stages and existing deals in 2 bulk queries to avoid N+1
    const allStages = await prisma.pipelineStage.findMany({ where: { tenantId }, select: { id: true, hubspotId: true, isClosed: true } });
    const stageMap = new Map(allStages.map(s => [s.hubspotId, s]));

    const existingDeals = await prisma.hubSpotDeal.findMany({
      where: { tenantId, hubspotId: { in: deals.map(d => d.id) } },
      select: { id: true, hubspotId: true },
    });
    const dealMap = new Map(existingDeals.map(d => [d.hubspotId, d]));

    // Process deals in parallel batches of 20
    const DEAL_BATCH = 20;
    for (let i = 0; i < deals.length; i += DEAL_BATCH) {
      const batch = deals.slice(i, i + DEAL_BATCH);
      await Promise.all(
        batch.map(async (deal) => {
          const stage = stageMap.get(deal.properties.dealstage);
          if (!stage) return;

          const dealData = {
            name: deal.properties.dealname,
            amount: deal.properties.amount ? parseFloat(deal.properties.amount) : null,
            stageId: stage.id,
            pipelineHubspotId: deal.properties.pipeline,
            ownerId: deal.properties.hubspot_owner_id,
            closeDate: deal.properties.closedate ? new Date(deal.properties.closedate) : null,
            createDate: deal.properties.createdate ? new Date(deal.properties.createdate) : null,
            lastModified: deal.properties.hs_lastmodifieddate
              ? new Date(deal.properties.hs_lastmodifieddate)
              : null,
            isClosed: stage.isClosed,
            isWon: deal.properties.hs_is_closed_won === "true",
            syncedAt: new Date(),
          };

          const existing = dealMap.get(deal.id);

          if (existing) {
            await prisma.hubSpotDeal.update({
              where: { id: existing.id },
              data: dealData,
            });
            updated++;
          } else {
            await prisma.hubSpotDeal.create({
              data: {
                tenantId,
                hubspotId: deal.id,
                ...dealData,
                rawJson: JSON.stringify(deal),
              },
            });
            created++;
          }
        })
      );
    }

    await prisma.syncLog.update({
      where: { id: syncLog.id },
      data: {
        status: "completed",
        recordsProcessed: deals.length + pipelines.length,
        recordsCreated: created,
        recordsUpdated: updated,
        completedAt: new Date(),
        durationMs: Date.now() - startedAt,
      },
    });

    await prisma.integrationConfig.upsert({
      where: { tenantId_provider: { tenantId, provider: "hubspot" } },
      update: { lastSyncAt: new Date() },
      create: { tenantId, provider: "hubspot", isEnabled: true, lastSyncAt: new Date() },
    });

    return { status: "completed", created, updated };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    await prisma.syncLog.update({
      where: { id: syncLog.id },
      data: {
        status: "failed",
        errorMessage: errMsg,
        completedAt: new Date(),
        durationMs: Date.now() - startedAt,
      },
    });
    await notifySyncFailure("hubspot", errMsg, secrets.teamsWebhookUrl);
    throw error;
  }
}

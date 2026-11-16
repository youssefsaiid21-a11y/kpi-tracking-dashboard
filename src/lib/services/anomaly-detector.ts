import prisma from "@/lib/prisma";

// ─── Helpers ──────────────────────────────────────────────────────

type AnomalyParams = {
  type: string;
  severity: string;
  title: string;
  description: string;
  tenantId: string;
  affectedEntity?: string;
  affectedId?: string;
  recommendedAction?: string;
};

// Per-run cache of unresolved anomalies (scoped to avoid cross-run pollution)
let unresolvedAnomalyCache: Map<string, string> | null = null;
let cacheOwnerTenant: string | null = null;
let cacheTimestamp: number = 0;
const ANOMALY_CACHE_TTL_MS = 60_000; // 1 minute max cache lifetime

function anomalyCacheKey(tenantId: string, type: string, affectedId: string | null): string {
  return `${tenantId}::${type}::${affectedId ?? "__null__"}`;
}

async function ensureAnomalyCache(tenantId: string): Promise<Map<string, string>> {
  const cacheExpired = Date.now() - cacheTimestamp > ANOMALY_CACHE_TTL_MS;
  if (!unresolvedAnomalyCache || cacheOwnerTenant !== tenantId || cacheExpired) {
    cacheOwnerTenant = tenantId;
    const existing = await prisma.anomaly.findMany({
      where: { tenantId, isResolved: false },
      select: { id: true, type: true, affectedId: true },
    });
    unresolvedAnomalyCache = new Map(
      existing.map(e => [anomalyCacheKey(tenantId, e.type, e.affectedId), e.id])
    );
    cacheTimestamp = Date.now();
  }
  return unresolvedAnomalyCache;
}

async function upsertAnomaly(params: AnomalyParams): Promise<void> {
  const cache = await ensureAnomalyCache(params.tenantId);
  const key = anomalyCacheKey(params.tenantId, params.type, params.affectedId ?? null);
  const existingId = cache.get(key);

  if (existingId) {
    // Update the existing anomaly with latest info
    await prisma.anomaly.update({
      where: { id: existingId },
      data: {
        severity: params.severity,
        title: params.title,
        description: params.description,
        recommendedAction: params.recommendedAction,
      },
    });
  } else {
    const created = await prisma.anomaly.create({
      data: {
        tenantId: params.tenantId,
        type: params.type,
        severity: params.severity,
        title: params.title,
        description: params.description,
        affectedEntity: params.affectedEntity,
        affectedId: params.affectedId,
        recommendedAction: params.recommendedAction,
      },
    });
    // Add to cache so subsequent calls in the same run don't create duplicates
    cache.set(key, created.id);
  }
}

// ─── Configurable thresholds (override via env) ──────────────────

const UNCLASSIFIED_STALE_DAYS = parseInt(process.env.ANOMALY_STALE_DAYS ?? "3", 10);
const UNCLASSIFIED_THRESHOLD = parseInt(process.env.ANOMALY_UNCLASSIFIED_THRESHOLD ?? "20", 10);
const DUPLICATE_WINDOW_DAYS = parseInt(process.env.ANOMALY_DUPLICATE_WINDOW_DAYS ?? "30", 10);
const LOW_CONFIDENCE_THRESHOLD = parseFloat(process.env.ANOMALY_LOW_CONFIDENCE ?? "0.3");
const LOW_CONFIDENCE_COUNT = parseInt(process.env.ANOMALY_LOW_CONFIDENCE_COUNT ?? "5", 10);
const SPIKE_MULTIPLIER = parseFloat(process.env.ANOMALY_SPIKE_MULTIPLIER ?? "3");
const SYNC_FAILURE_WINDOW_HOURS = parseInt(process.env.ANOMALY_SYNC_WINDOW_HOURS ?? "24", 10);

// ─── Main Detection Function ──────────────────────────────────────

export async function runAnomalyDetection(tenantId: string): Promise<void> {
  // Reset the anomaly cache at the start of each detection run
  unresolvedAnomalyCache = null;

  const now = new Date();

  // ── Check 1: Too many unclassified meetings ──────────────────
  const staleCutoff = new Date(now);
  staleCutoff.setDate(staleCutoff.getDate() - UNCLASSIFIED_STALE_DAYS);

  const unclassifiedCount = await prisma.calendarEvent.count({
    where: {
      tenantId,
      isFiltered: false,
      review: null,
      startTime: { lt: staleCutoff },
    },
  });

  if (unclassifiedCount > UNCLASSIFIED_THRESHOLD) {
    await upsertAnomaly({
      tenantId,
      type: "unclassified",
      severity: "warning",
      title: "High number of unclassified meetings",
      description: `${unclassifiedCount} meetings older than ${UNCLASSIFIED_STALE_DAYS} days have not been reviewed. This may affect KPI accuracy.`,
      affectedEntity: "CalendarEvent",
      affectedId: "global_unclassified",
      recommendedAction:
        "Review and classify pending meetings in the review queue to keep metrics current.",
    });
  }

  // ── Check 2: Duplicate meetings (via meetingFingerprint) ─────
  // The fingerprint is computed during sync: hash(organizer + startTime + subject).
  // Query for fingerprints that appear more than once instead of loading all events.
  const dupWindowStart = new Date(now.getTime() - DUPLICATE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const duplicateFingerprints = await prisma.calendarEvent.groupBy({
    by: ["meetingFingerprint"],
    where: {
      tenantId,
      isFiltered: false,
      startTime: { gte: dupWindowStart },
      meetingFingerprint: { not: null },
    },
    _count: { id: true },
    having: {
      id: { _count: { gt: 1 } },
    },
  });

  // For each duplicate fingerprint, fetch one representative event for the anomaly
  for (const dup of duplicateFingerprints) {
    const representative = await prisma.calendarEvent.findFirst({
      where: {
        tenantId,
        meetingFingerprint: dup.meetingFingerprint!,
        isFiltered: false,
      },
      select: { id: true, subject: true, startTime: true },
      orderBy: { startTime: "asc" },
    });

    if (representative) {
      const dayKey = representative.startTime.toISOString().split("T")[0];
      await upsertAnomaly({
        tenantId,
        type: "duplicate",
        severity: "warning",
        title: `Possible duplicate meeting: "${representative.subject ?? "(no subject)"}"`,
        description: `Event "${representative.subject ?? "(no subject)"}" on ${dayKey} appears to have ${dup._count.id} copies with the same fingerprint.`,
        affectedEntity: "CalendarEvent",
        affectedId: representative.id,
        recommendedAction:
          "Review and mark one of the duplicate events as irrelevant.",
      });
    }
  }

  // ── Check 3: Impossible conversion rates ─────────────────────
  // Count deals that have reached each stage (current stage or beyond),
  // matching the logic used by calculateConversionRates in hubspot.ts
  const stages = await prisma.pipelineStage.findMany({
    where: { tenantId },
    orderBy: { displayOrder: "asc" },
  });

  // PERF: Use groupBy to get deal counts per stage instead of loading all deal records
  const dealCountsByStage = await prisma.hubSpotDeal.groupBy({
    by: ["stageId"],
    where: { tenantId },
    _count: { id: true },
  });
  const stageCountMap = new Map(dealCountsByStage.map(d => [d.stageId, d._count.id]));

  // For each stage, count how many deals have reached it (current or passed through)
  // A deal at displayOrder N has "reached" all stages with displayOrder <= N
  // So stage 0 is reached by ALL deals, stage N only by deals currently at N.
  // Use reverse running sum: accumulate from the last stage backward.
  const reachedCounts = new Map<string, number>();
  let runningSum = 0;
  for (let j = stages.length - 1; j >= 0; j--) {
    runningSum += stageCountMap.get(stages[j].id) ?? 0;
    reachedCounts.set(stages[j].id, runningSum);
  }

  for (let i = 0; i < stages.length - 1; i++) {
    const fromCount = reachedCounts.get(stages[i].id) ?? 0;
    const toCount = reachedCounts.get(stages[i + 1].id) ?? 0;

    if (fromCount > 0) {
      const rate = toCount / fromCount;
      if (isNaN(rate) || rate > 1.0 || rate < 0) {
        await upsertAnomaly({
          tenantId,
          type: "impossible_rate",
          severity: "critical",
          title: `Impossible conversion rate: ${stages[i].label} -> ${stages[i + 1].label}`,
          description: `Conversion rate of ${(rate * 100).toFixed(1)}% from ${stages[i].label} to ${stages[i + 1].label} is outside the valid 0-100% range. This indicates a data integrity issue.`,
          affectedEntity: "PipelineStage",
          affectedId: stages[i].id,
          recommendedAction:
            "Investigate HubSpot deal stage data for inconsistencies and re-sync pipeline.",
        });
      }
    }
  }

  // ── Check 4: Missing rep mappings ────────────────────────────
  const usersWithoutEmail = await prisma.user.findMany({
    where: {
      tenantId,
      isActive: true,
      outlookEmail: null,
    },
    select: { id: true, name: true, email: true },
  });

  for (const user of usersWithoutEmail) {
    await upsertAnomaly({
      tenantId,
      type: "missing_owner",
      severity: "warning",
      title: `Missing Outlook email mapping for ${user.name ?? user.email}`,
      description: `User "${user.name ?? user.email}" has no outlookEmail configured. Calendar sync cannot run for this user.`,
      affectedEntity: "User",
      affectedId: user.id,
      recommendedAction:
        "Go to admin settings and configure the Outlook email for this user.",
    });
  }

  // ── Check 5: Sync failures ──────────────────────────────────
  const syncWindowStart = new Date(now);
  syncWindowStart.setHours(syncWindowStart.getHours() - SYNC_FAILURE_WINDOW_HOURS);

  const failedSyncs = await prisma.syncLog.findMany({
    where: {
      tenantId,
      status: "failed",
      startedAt: { gte: syncWindowStart },
    },
  });

  for (const sync of failedSyncs) {
    await upsertAnomaly({
      tenantId,
      type: "sync_failure",
      severity: "critical",
      title: `Sync failure: ${sync.provider}`,
      description: `A ${sync.provider} sync failed at ${sync.startedAt.toISOString()}. Error: ${sync.errorMessage ?? "Unknown error"}.`,
      affectedEntity: "SyncLog",
      affectedId: sync.id,
      recommendedAction:
        "Check integration credentials and connectivity, then retry the sync.",
    });
  }

  // ── Check 6: Low confidence clusters ─────────────────────────
  const lowConfidenceCount = await prisma.suggestedClassification.count({
    where: {
      confidence: { lt: LOW_CONFIDENCE_THRESHOLD },
      event: { tenantId },
    },
  });

  if (lowConfidenceCount > LOW_CONFIDENCE_COUNT) {
    await upsertAnomaly({
      tenantId,
      type: "low_confidence",
      severity: "info",
      title: "Many low-confidence classifications",
      description: `${lowConfidenceCount} suggested classifications have confidence below 30%. The classification engine may need tuning or more training signals.`,
      affectedEntity: "SuggestedClassification",
      affectedId: "global_low_confidence",
      recommendedAction:
        "Review low-confidence meetings to provide confirmed labels that improve future classification accuracy.",
    });
  }

  // ── Check 7: Spike detection ─────────────────────────────────
  // Current week meetings > 3x average of previous 4 weeks for any rep
  const currentWeekStart = new Date(now);
  const dayOfWeek = currentWeekStart.getDay();
  // getDay() returns 0 for Sunday; adjust so Monday is the start of the week
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  currentWeekStart.setDate(currentWeekStart.getDate() - daysFromMonday);
  currentWeekStart.setHours(0, 0, 0, 0);

  const currentWeekEnd = new Date(currentWeekStart);
  currentWeekEnd.setDate(currentWeekEnd.getDate() + 7);

  const fourWeeksAgo = new Date(currentWeekStart);
  fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);

  const activeUsers = await prisma.user.findMany({
    where: { tenantId, isActive: true, outlookEmail: { not: null } },
    select: { id: true, name: true },
  });

  // PERF: Use groupBy to get counts for all users at once instead of N+1 queries
  const currentWeekCounts = await prisma.calendarEvent.groupBy({
    by: ["userId"],
    where: {
      tenantId,
      isFiltered: false,
      startTime: { gte: currentWeekStart, lt: currentWeekEnd },
      userId: { in: activeUsers.map(u => u.id) },
    },
    _count: { id: true },
  });
  const currentWeekMap = new Map(currentWeekCounts.map(c => [c.userId, c._count.id]));

  const prevFourWeeksCounts = await prisma.calendarEvent.groupBy({
    by: ["userId"],
    where: {
      tenantId,
      isFiltered: false,
      startTime: { gte: fourWeeksAgo, lt: currentWeekStart },
      userId: { in: activeUsers.map(u => u.id) },
    },
    _count: { id: true },
  });
  const prevFourWeeksMap = new Map(prevFourWeeksCounts.map(c => [c.userId, c._count.id]));

  for (const user of activeUsers) {
    const currentWeekCount = currentWeekMap.get(user.id) ?? 0;
    const previousFourWeeksCount = prevFourWeeksMap.get(user.id) ?? 0;
    const weeklyAverage = previousFourWeeksCount / 4;

    if (weeklyAverage > 0 && currentWeekCount > SPIKE_MULTIPLIER * weeklyAverage) {
      await upsertAnomaly({
        tenantId,
        type: "spike",
        severity: "warning",
        title: `Meeting spike detected for ${user.name ?? user.id}`,
        description: `${user.name ?? user.id} has ${currentWeekCount} meetings this week, which is more than ${SPIKE_MULTIPLIER}x the 4-week average of ${weeklyAverage.toFixed(1)} meetings/week.`,
        affectedEntity: "User",
        affectedId: user.id,
        recommendedAction:
          "Verify that these meetings are genuine and not the result of a calendar sync error or duplicate imports.",
      });
    }
  }

  // ── Check 8: Internal meetings leaking through ───────────────
  // Meetings marked as not filtered but all attendees are internal
  const leakedInternals = await prisma.calendarEvent.findMany({
    where: {
      tenantId,
      isFiltered: false,
      isInternal: false,
      startTime: { gte: new Date(now.getTime() - DUPLICATE_WINDOW_DAYS * 24 * 60 * 60 * 1000) },
    },
    select: {
      id: true,
      subject: true,
      attendees: { select: { isInternal: true } },
    },
  });

  for (const event of leakedInternals) {
    if (
      event.attendees.length > 0 &&
      event.attendees.every((a) => a.isInternal)
    ) {
      await upsertAnomaly({
        tenantId,
        type: "internal_leak",
        severity: "warning",
        title: `Internal meeting not filtered: "${event.subject ?? "(no subject)"}"`,
        description: `Meeting "${event.subject ?? "(no subject)"}" has all internal attendees but was not marked as filtered. It may be incorrectly inflating meeting counts.`,
        affectedEntity: "CalendarEvent",
        affectedId: event.id,
        recommendedAction:
          "Review the meeting and mark it as irrelevant if it is an internal meeting.",
      });
    }
  }
}

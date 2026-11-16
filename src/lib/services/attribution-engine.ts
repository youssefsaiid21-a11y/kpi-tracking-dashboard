/**
 * Attribution Engine — links meetings to deals.
 *
 * Solves the v1 gap where calendar data and HubSpot data were siloed,
 * making it impossible to answer "what % of outbound meetings become deals?"
 *
 * Attribution methods (in order of confidence):
 * 1. Attendee match: meeting attendee email === deal contact email (0.9 confidence)
 * 2. Domain proximity: meeting attendee domain === deal company domain AND
 *    deal was created within 14 days of the meeting (0.6 confidence)
 * 3. Manual: user explicitly links a meeting to a deal (1.0 confidence)
 */

import prisma from "@/lib/prisma";

interface AttributionResult {
  created: number;
  skipped: number;
}

/**
 * Run attribution for all unattributed classified meetings against all deals.
 * Call this after both calendar and HubSpot syncs complete.
 */
export async function runAttribution(tenantId: string): Promise<AttributionResult> {
  let created = 0;
  let skipped = 0;

  // Get all classified (reviewed) meetings that don't yet have attributions
  const reviewedMeetings = await prisma.calendarEvent.findMany({
    where: {
      tenantId,
      isFiltered: false,
      review: {
        confirmedLabel: { notIn: ["irrelevant"] },
      },
      attributions: { none: {} },
    },
    include: {
      attendees: { where: { isInternal: false } } as any,
    },
  });

  if (reviewedMeetings.length === 0) return { created: 0, skipped: 0 };

  // Get all deals with contact/company info.
  // NOTE: contactEmail and companyDomain exist in the schema but are not
  // currently populated by the HubSpot sync (sync-manager.ts). Until the sync
  // is updated to fetch associated contacts/companies from HubSpot, those
  // fields will be null for most deals. We still index them when present, and
  // also build an ownerId lookup so we can fall back to matching the deal
  // owner against the calendar event's userId.
  const deals = await prisma.hubSpotDeal.findMany({
    where: { tenantId },
    select: {
      id: true,
      contactEmail: true,
      companyDomain: true,
      ownerId: true,
      createDate: true,
    },
  });

  if (deals.length === 0) return { created: 0, skipped: 0 };

  // Build lookup indexes
  const dealsByContactEmail = new Map<string, typeof deals>();
  const dealsByDomain = new Map<string, typeof deals>();
  const dealsByOwnerId = new Map<string, typeof deals>();

  for (const deal of deals) {
    if (deal.contactEmail) {
      const email = deal.contactEmail.toLowerCase();
      const existing = dealsByContactEmail.get(email) ?? [];
      existing.push(deal);
      dealsByContactEmail.set(email, existing);
    }
    if (deal.companyDomain) {
      const domain = deal.companyDomain.toLowerCase();
      const existing = dealsByDomain.get(domain) ?? [];
      existing.push(deal);
      dealsByDomain.set(domain, existing);
    }
    if (deal.ownerId) {
      const existing = dealsByOwnerId.get(deal.ownerId) ?? [];
      existing.push(deal);
      dealsByOwnerId.set(deal.ownerId, existing);
    }
  }

  // Collect all attributions in memory, then batch insert
  const PROXIMITY_DAYS = 14;
  const attributionBatch: {
    tenantId: string;
    eventId: string;
    dealId: string;
    attributionType: string;
    confidence: number;
  }[] = [];

  for (const meeting of reviewedMeetings) {
    const attendees = (meeting as any).attendees ?? [];
    const externalEmails: string[] = attendees.map((a: any) => a.email.toLowerCase());
    const externalDomains: string[] = Array.from(new Set(
      externalEmails
        .map((e: string) => e.split("@")[1])
        .filter((d: string | undefined): d is string => !!d)
    ));

    let attributed = false;

    // Method 1: Attendee email match (highest confidence)
    for (const email of externalEmails) {
      const matchedDeals = dealsByContactEmail.get(email);
      if (!matchedDeals) continue;
      for (const deal of matchedDeals) {
        attributionBatch.push({
          tenantId, eventId: meeting.id, dealId: deal.id,
          attributionType: "attendee_match", confidence: 0.9,
        });
        attributed = true;
      }
    }

    if (attributed) continue;

    // Method 2: Domain + time proximity
    for (const domain of externalDomains) {
      const matchedDeals = dealsByDomain.get(domain);
      if (!matchedDeals) continue;
      for (const deal of matchedDeals) {
        if (!deal.createDate) continue;
        const daysDiff = Math.abs(
          (deal.createDate.getTime() - meeting.startTime.getTime()) / (1000 * 60 * 60 * 24)
        );
        if (daysDiff <= PROXIMITY_DAYS) {
          attributionBatch.push({
            tenantId, eventId: meeting.id, dealId: deal.id,
            attributionType: "domain_proximity", confidence: 0.6,
          });
          attributed = true;
        }
      }
    }

    if (attributed) continue;

    // Method 3: Owner match — fall back to matching the deal's ownerId
    // against the calendar event's userId (lowest confidence automatic match).
    const ownerDeals = dealsByOwnerId.get(meeting.userId);
    if (ownerDeals) {
      for (const deal of ownerDeals) {
        if (!deal.createDate) continue;
        const daysDiff = Math.abs(
          (deal.createDate.getTime() - meeting.startTime.getTime()) / (1000 * 60 * 60 * 24)
        );
        if (daysDiff <= PROXIMITY_DAYS) {
          attributionBatch.push({
            tenantId, eventId: meeting.id, dealId: deal.id,
            attributionType: "owner_match", confidence: 0.4,
          });
        }
      }
    }
  }

  // Deduplicate in-memory by unique key (eventId+dealId), then batch insert
  if (attributionBatch.length > 0) {
    const seen = new Set<string>();
    const uniqueBatch = attributionBatch.filter((a) => {
      const key = `${a.eventId}:${a.dealId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Filter out already-existing attributions
    const existing = await prisma.meetingDealAttribution.findMany({
      where: {
        eventId: { in: uniqueBatch.map((a) => a.eventId) },
        dealId: { in: uniqueBatch.map((a) => a.dealId) },
      },
      select: { eventId: true, dealId: true },
    });
    const existingKeys = new Set(existing.map((e) => `${e.eventId}:${e.dealId}`));
    const newBatch = uniqueBatch.filter((a) => !existingKeys.has(`${a.eventId}:${a.dealId}`));

    if (newBatch.length > 0) {
      const result = await prisma.meetingDealAttribution.createMany({
        data: newBatch,
      });
      created = result.count;
    }
    skipped = attributionBatch.length - created;
  }

  return { created, skipped };
}

/**
 * Get attribution statistics for analytics.
 */
export async function getAttributionStats(tenantId: string, startDate: Date, endDate: Date) {
  const totalClassified = await prisma.meetingReview.count({
    where: {
      confirmedLabel: { notIn: ["irrelevant"] },
      event: {
        tenantId,
        startTime: { gte: startDate, lte: endDate },
        isFiltered: false,
      },
    },
  });

  const totalAttributed = await prisma.meetingDealAttribution.count({
    where: {
      event: {
        tenantId,
        startTime: { gte: startDate, lte: endDate },
      },
    },
  });

  const attributionsByType = await prisma.meetingDealAttribution.groupBy({
    by: ["attributionType"],
    where: {
      event: {
        tenantId,
        startTime: { gte: startDate, lte: endDate },
      },
    },
    _count: true,
    _avg: { confidence: true },
  });

  const meetingToDeadRate = totalClassified > 0 ? totalAttributed / totalClassified : 0;

  return {
    totalClassifiedMeetings: totalClassified,
    totalAttributedMeetings: totalAttributed,
    meetingToDealRate: Math.round(meetingToDeadRate * 10000) / 10000,
    byType: attributionsByType.map((row: any) => ({
      type: row.attributionType,
      count: row._count,
      avgConfidence: row._avg.confidence ?? 0,
    })),
  };
}

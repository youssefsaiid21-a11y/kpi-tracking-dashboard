/**
 * Shared HubSpot sync logic — single source of truth used by both
 * /api/hubspot and /api/sync routes.
 */

import prisma from "@/lib/prisma";
import { HubSpotService } from "@/lib/services/hubspot";

interface SyncResult {
  created: number;
  updated: number;
}

export async function syncHubSpotData(
  tenantId: string,
  accessToken: string,
  demoMode?: boolean
): Promise<SyncResult> {
  const hubspot = new HubSpotService(accessToken, demoMode);
  const apiPipelines = await hubspot.getPipelines();
  let created = 0;
  let updated = 0;

  // Upsert pipelines and stages
  for (const pipeline of apiPipelines) {
    const pipelineDef = await prisma.pipelineDefinition.upsert({
      where: { tenantId_hubspotId: { tenantId, hubspotId: pipeline.id } },
      update: { label: pipeline.label, syncedAt: new Date() },
      create: {
        tenantId,
        hubspotId: pipeline.id,
        label: pipeline.label,
        syncedAt: new Date(),
      },
    });
    updated++;

    for (const stage of pipeline.stages) {
      const probability = (() => {
        const p = Number(stage.metadata.probability);
        return isNaN(p) ? null : p;
      })();
      await prisma.pipelineStage.upsert({
        where: { tenantId_hubspotId: { tenantId, hubspotId: stage.id } },
        update: {
          label: stage.label,
          displayOrder: stage.displayOrder,
          probability,
          isClosed: stage.metadata.isClosed === "true",
        },
        create: {
          tenantId,
          pipelineId: pipelineDef.id,
          hubspotId: stage.id,
          label: stage.label,
          displayOrder: stage.displayOrder,
          probability,
          isClosed: stage.metadata.isClosed === "true",
        },
      });
      updated++;
    }
  }

  // Sync deals
  const deals = await hubspot.getAllDeals();

  // Pre-fetch all stages and existing deals into lookup maps (2 queries instead of N)
  const allStages = await prisma.pipelineStage.findMany({
    where: { tenantId },
    select: { id: true, hubspotId: true, isClosed: true },
  });
  const stageMap = new Map(allStages.map((s) => [s.hubspotId, s]));

  const existingDeals = await prisma.hubSpotDeal.findMany({
    where: { tenantId },
    select: { hubspotId: true },
  });
  const existingDealIds = new Set(existingDeals.map((d) => d.hubspotId));

  for (const deal of deals) {
    const stageRecord = stageMap.get(deal.properties.dealstage);
    if (!stageRecord) continue;

    const isNew = !existingDealIds.has(deal.id);

    const dealData = {
      name: deal.properties.dealname,
      amount: deal.properties.amount
        ? parseFloat(deal.properties.amount)
        : null,
      stageId: stageRecord.id,
      pipelineHubspotId: deal.properties.pipeline,
      ownerId: deal.properties.hubspot_owner_id,
      closeDate: deal.properties.closedate
        ? new Date(deal.properties.closedate)
        : null,
      createDate: deal.properties.createdate
        ? new Date(deal.properties.createdate)
        : null,
      lastModified: deal.properties.hs_lastmodifieddate
        ? new Date(deal.properties.hs_lastmodifieddate)
        : null,
      isClosed: stageRecord.isClosed,
      isWon: deal.properties.hs_is_closed_won === "true",
      rawJson: JSON.stringify(deal),
      syncedAt: new Date(),
    };

    await prisma.hubSpotDeal.upsert({
      where: { tenantId_hubspotId: { tenantId, hubspotId: deal.id } },
      update: dealData,
      create: { tenantId, hubspotId: deal.id, ...dealData },
    });
    if (isNew) { created++; } else { updated++; }
  }

  return { created, updated };
}

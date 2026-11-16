import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/** Pick a random element from an array */
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function main() {
  console.log('Seeding database...');

  // ─── Tenant ──────────────────────────────────────────────
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'default' },
    update: {},
    create: {
      slug: 'default',
      name: 'Demo entity',
      internalDomains: JSON.stringify(['company.example']),
      isDemoMode: false,
    },
  });
  const tenantId = tenant.id;

  // ─── Users ─────────────────────────────────────────────
  const seedPassword = process.env.SEED_PASSWORD;
  if (!seedPassword) throw new Error('Set SEED_PASSWORD for the local demo seed.');
  const passwordHash = await bcrypt.hash(seedPassword, 10);

  const youssef = await prisma.user.upsert({
    where: { tenantId_email: { tenantId, email: 'member-073@company.example' } },
    update: {},
    create: {
      tenantId,
      email: 'member-073@company.example',
      name: 'Demo entity',
      passwordHash,
      role: 'admin',
      outlookEmail: 'member-073@company.example',
    },
  });

  const vishnu = await prisma.user.upsert({
    where: { tenantId_email: { tenantId, email: 'member-071@company.example' } },
    update: {},
    create: {
      tenantId,
      email: 'member-071@company.example',
      name: 'Demo entity',
      passwordHash,
      role: 'admin',
      outlookEmail: 'member-071@company.example',
    },
  });

  const reps = [youssef, vishnu];

  // ─── Partner Entities ──────────────────────────────────
  await prisma.partnerEntity.upsert({
    where: { tenantId_domain: { tenantId, domain: 'organization-021.example' } },
    update: {},
    create: {
      tenantId,
      name: 'Demo entity',
      domain: 'organization-021.example',
      contactEmails: JSON.stringify(['member-031@organization-021.example', 'member-036@organization-021.example']),
    },
  });

  await prisma.partnerEntity.upsert({
    where: { tenantId_domain: { tenantId, domain: 'organization-006.example' } },
    update: {},
    create: {
      tenantId,
      name: 'Demo entity',
      domain: 'organization-006.example',
      contactEmails: JSON.stringify(['member-046@organization-006.example']),
    },
  });

  await prisma.partnerEntity.upsert({
    where: { tenantId_domain: { tenantId, domain: 'organization-024.example' } },
    update: {},
    create: {
      tenantId,
      name: 'Demo entity',
      domain: 'organization-024.example',
      contactEmails: JSON.stringify(['member-059@organization-024.example']),
    },
  });

  // ─── Integration Configs ──────────────────────────────
  await prisma.integrationConfig.upsert({
    where: { tenantId_provider: { tenantId, provider: 'microsoft_graph' } },
    update: {},
    create: {
      tenantId,
      provider: 'microsoft_graph',
      isEnabled: true,
      syncIntervalMin: 60,
    },
  });

  await prisma.integrationConfig.upsert({
    where: { tenantId_provider: { tenantId, provider: 'hubspot' } },
    update: {},
    create: {
      tenantId,
      provider: 'hubspot',
      isEnabled: true,
      syncIntervalMin: 120,
    },
  });

  // ─── Reminder Config ──────────────────────────────────
  await prisma.reminderConfig.upsert({
    where: { id: 'default-reminder' },
    update: {},
    create: {
      id: 'default-reminder',
      tenantId,
      type: 'teams_classification_reminder',
      cronExpression: '0 16 * * 5',
      isEnabled: true,
      messageTemplate: 'Hi {repName}! You have {count} unclassified meetings this week. Please review them here: {link}',
    },
  });

  // ─── HubSpot Pipeline (Demo) ──────────────────────────
  const pipeline = await prisma.pipelineDefinition.upsert({
    where: { tenantId_hubspotId: { tenantId, hubspotId: 'default' } },
    update: {},
    create: {
      tenantId,
      hubspotId: 'default',
      label: 'Sales Pipeline',
    },
  });

  const stageData = [
    { hubspotId: 'qualified_lead', label: 'Qualified Lead', displayOrder: 0, probability: 0.2, isClosed: false, isWon: false },
    { hubspotId: 'discovery', label: 'Discovery', displayOrder: 1, probability: 0.4, isClosed: false, isWon: false },
    { hubspotId: 'proposal', label: 'Proposal', displayOrder: 2, probability: 0.6, isClosed: false, isWon: false },
    { hubspotId: 'negotiation', label: 'Negotiation', displayOrder: 3, probability: 0.8, isClosed: false, isWon: false },
    { hubspotId: 'closed_won', label: 'Closed Won', displayOrder: 4, probability: 1.0, isClosed: true, isWon: true },
    { hubspotId: 'closed_lost', label: 'Closed Lost', displayOrder: 5, probability: 0.0, isClosed: true, isWon: false },
  ];

  const stages: Record<string, string> = {};
  for (const s of stageData) {
    const stage = await prisma.pipelineStage.upsert({
      where: { tenantId_hubspotId: { tenantId, hubspotId: s.hubspotId } },
      update: {},
      create: { ...s, tenantId, pipelineId: pipeline.id },
    });
    stages[s.hubspotId] = stage.id;
  }

  // ─── Demo Deals ───────────────────────────────────────
  const dealNames = [
    'Acme Corp - Enterprise License', 'TechStart - Platform Subscription',
    'Global Manufacturing - Safety Module', 'DataFlow Inc - Analytics Suite',
    'SecureNet - Monitoring Package', 'SmartCity Solutions - IoT Platform',
    'MediTech - Compliance Suite', 'RetailPro - Inventory Module',
    'FinanceHub - Risk Dashboard', 'EduTech - Campus Safety',
    'LogiTrack - Fleet Monitoring', 'CloudFirst - Infrastructure',
    'GreenEnergy - Plant Safety', 'AeroSpace - Quality Control',
    'PharmaCo - Lab Monitoring', 'AutoMakers - Assembly Line AI',
    'FoodSafe - Inspection Platform', 'ConstructCo - Site Safety',
    'BankSecure - Branch Monitoring', 'TeleHealth - Remote Monitoring',
  ];

  const stageDistribution = [
    { stageKey: 'qualified_lead', count: 6 },
    { stageKey: 'discovery', count: 4 },
    { stageKey: 'proposal', count: 3 },
    { stageKey: 'negotiation', count: 3 },
    { stageKey: 'closed_won', count: 2 },
    { stageKey: 'closed_lost', count: 2 },
  ];

  let dealIdx = 0;
  for (const { stageKey, count } of stageDistribution) {
    for (let i = 0; i < count && dealIdx < dealNames.length; i++, dealIdx++) {
      const rep = reps[dealIdx % reps.length];
      const amount = Math.floor(15000 + Math.random() * 185000);
      const daysAgo = Math.floor(Math.random() * 90);

      await prisma.hubSpotDeal.upsert({
        where: { tenantId_hubspotId: { tenantId, hubspotId: `demo-deal-${dealIdx}` } },
        update: {},
        create: {
          tenantId,
          hubspotId: `demo-deal-${dealIdx}`,
          name: dealNames[dealIdx],
          amount,
          stageId: stages[stageKey],
          pipelineHubspotId: 'default',
          ownerId: rep.hubspotOwnerId || undefined,
          ownerEmail: rep.outlookEmail || undefined,
          createDate: new Date(Date.now() - daysAgo * 86400000),
          isClosed: stageKey.includes('closed'),
          isWon: stageKey === 'closed_won',
        },
      });
    }
  }

  // ─── Demo Calendar Events ─────────────────────────────
  const externalDomains = ['organization-003.example', 'techstart.io', 'globalmanuf.com', 'dataflow.co', 'securenet.sg'];
  const partnerDomains = ['organization-021.example', 'organization-006.example', 'organization-024.example'];

  const meetingSubjects = [
    { subject: 'Discovery Call - Acme Corp', type: 'discovery' },
    { subject: 'Product Demo - TechStart', type: 'discovery' },
    { subject: 'Introduction Meeting - Global Manufacturing', type: 'discovery' },
    { subject: 'PartnerCo Referral - DataFlow', type: 'partner' },
    { subject: 'Channel Partner Review - Q1 Pipeline', type: 'partner' },
    { subject: 'Tech Alliance Joint Demo', type: 'partner' },
    { subject: 'Team Standup', type: 'internal' },
    { subject: 'Weekly 1:1 with Manager', type: 'internal' },
    { subject: 'Lunch Block', type: 'solo' },
    { subject: 'Exploratory Discussion - SecureNet', type: 'discovery' },
    { subject: 'Follow-up: MediTech Compliance', type: 'discovery' },
    { subject: 'Partner Intro - New Opportunity', type: 'partner' },
    { subject: 'All Hands Meeting', type: 'internal' },
    { subject: 'Client Catch-up', type: 'ambiguous' },
    { subject: 'Referral from PartnerCo - RetailPro', type: 'partner' },
  ];

  // Channel labels for discovery-type meetings (randomly assigned)
  const discoveryChannels = ['linkedin', 'email', 'inbound', 'referrals'] as const;

  for (const rep of reps) {
    for (let i = 0; i < meetingSubjects.length; i++) {
      const { subject, type } = meetingSubjects[i];
      const daysAgo = Math.floor(Math.random() * 28) + 1;
      const hour = 9 + Math.floor(Math.random() * 8);
      const startTime = new Date();
      startTime.setDate(startTime.getDate() - daysAgo);
      startTime.setHours(hour, 0, 0, 0);
      const duration = type === 'solo' ? 60 : type === 'internal' ? 30 : 45;
      const endTime = new Date(startTime.getTime() + duration * 60000);

      const isInternal = type === 'internal';
      const isSolo = type === 'solo';
      const isFiltered = isInternal || isSolo;

      const eventId = `demo-event-${rep.id}-${i}`;
      const event = await prisma.calendarEvent.upsert({
        where: { tenantId_externalId: { tenantId, externalId: eventId } },
        update: {},
        create: {
          tenantId,
          externalId: eventId,
          userId: rep.id,
          subject,
          startTime,
          endTime,
          duration,
          isInternal,
          isSolo,
          isFiltered,
          filterReason: isInternal ? 'All internal attendees' : isSolo ? 'Solo calendar block' : null,
          status: isFiltered ? 'completed' : 'pending',
          organizer: rep.outlookEmail || rep.email,
          organizerName: rep.name || undefined,
          isRecurring: type === 'internal' && subject.includes('Weekly'),
        },
      });

      // Add attendees
      // Always add the rep as organizer
      await prisma.eventAttendee.upsert({
        where: {
          eventId_email: {
            eventId: event.id,
            email: rep.outlookEmail || rep.email,
          },
        },
        update: {},
        create: {
          tenantId,
          eventId: event.id,
          email: rep.outlookEmail || rep.email,
          name: rep.name || undefined,
          isOrganizer: true,
          isInternal: true,
          responseStatus: 'accepted',
        },
      });

      if (type === 'internal') {
        // Add 2-3 internal attendees
        const others = reps.filter(r => r.id !== rep.id);
        for (const other of others.slice(0, 2)) {
          await prisma.eventAttendee.upsert({
            where: {
              eventId_email: {
                eventId: event.id,
                email: other.outlookEmail || other.email,
              },
            },
            update: {},
            create: {
              tenantId,
              eventId: event.id,
              email: other.outlookEmail || other.email,
              name: other.name || undefined,
              isInternal: true,
              responseStatus: 'accepted',
            },
          });
        }
      } else if (type !== 'solo') {
        // Add external attendees
        const domain = type === 'partner'
          ? partnerDomains[Math.floor(Math.random() * partnerDomains.length)]
          : externalDomains[Math.floor(Math.random() * externalDomains.length)];
        const names = ['John Smith', 'Emma Johnson', 'Demo member Lee', 'Demo member Garcia', 'Robert Kim'];
        const extName = names[Math.floor(Math.random() * names.length)];
        const extEmail = `${extName.toLowerCase().replace(' ', '.')}@${domain}`;

        await prisma.eventAttendee.upsert({
          where: {
            eventId_email: {
              eventId: event.id,
              email: extEmail,
            },
          },
          update: {},
          create: {
            tenantId,
            eventId: event.id,
            email: extEmail,
            name: extName,
            isInternal: false,
            isPartnerContact: type === 'partner',
            responseStatus: 'accepted',
          },
        });

        // Add suggested classification for non-filtered events
        if (!isFiltered) {
          // Map meeting type to the new channel labels
          const suggestedLabelMap: Record<string, string> = {
            discovery: pick([...discoveryChannels]),
            partner: 'partnerships',
            ambiguous: pick([...discoveryChannels]),
          };
          const confidenceMap: Record<string, number> = {
            discovery: 0.8,
            partner: 0.75,
            ambiguous: 0.35,
          };

          await prisma.suggestedClassification.upsert({
            where: { eventId: event.id },
            update: {},
            create: {
              tenantId,
              eventId: event.id,
              suggestedLabel: suggestedLabelMap[type] || pick([...discoveryChannels]),
              confidence: confidenceMap[type] || 0.5,
              reasoning: type === 'discovery'
                ? 'Subject contains discovery/demo keywords, external attendees present'
                : type === 'partner'
                ? 'Attendee domain matches known partner, partnership keywords detected'
                : 'Unable to determine with high confidence, defaulting to outbound channel',
              signals: JSON.stringify([
                { type: 'keyword_match', value: subject, weight: 0.3, description: 'Subject analysis' },
                { type: 'attendee_domain', value: domain, weight: 0.4, description: 'External domain detected' },
              ]),
            },
          });

          // Pre-review some meetings (about 40%) for demo
          if (Math.random() < 0.4) {
            const confirmedLabel = type === 'partner'
              ? 'partnerships'
              : pick([...discoveryChannels]);

            await prisma.meetingReview.upsert({
              where: { eventId: event.id },
              update: {},
              create: {
                tenantId,
                eventId: event.id,
                userId: rep.id,
                confirmedLabel,
                partnerName: type === 'partner' ? 'PartnerCo Solutions' : null,
                partnerEvidence: type === 'partner' ? JSON.stringify({
                  referral: true,
                  attendeeMatch: true,
                  hubspotSource: false,
                  manualTag: false,
                }) : null,
              },
            });

            await prisma.calendarEvent.update({
              where: { id: event.id },
              data: { status: 'completed' },
            });
          }
        }
      }
    }
  }

  // ─── Targets ──────────────────────────────────────────
  // Use deterministic IDs for seed targets so re-seeding is safe
  const seedTargetIds = [
    'seed-target-team-total-monthly',
    'seed-target-team-linkedin-monthly',
    'seed-target-team-total-weekly',
  ];
  // Build rep-level seed target IDs
  for (const rep of reps) {
    seedTargetIds.push(`seed-target-${rep.id}-total-monthly`);
    seedTargetIds.push(`seed-target-${rep.id}-linkedin-monthly`);
  }
  // Clear only seed targets by their known IDs
  await prisma.targetConfig.deleteMany({ where: { tenantId, id: { in: seedTargetIds } } });

  // Team targets
  await prisma.targetConfig.create({
    data: {
      id: 'seed-target-team-total-monthly',
      tenantId,
      metricType: 'total_meetings',
      targetValue: 40,
      period: 'monthly',
      isActive: true,
    },
  });

  await prisma.targetConfig.create({
    data: {
      id: 'seed-target-team-linkedin-monthly',
      tenantId,
      metricType: 'linkedin_meetings',
      targetValue: 15,
      period: 'monthly',
      isActive: true,
    },
  });

  await prisma.targetConfig.create({
    data: {
      id: 'seed-target-team-total-weekly',
      tenantId,
      metricType: 'total_meetings',
      targetValue: 10,
      period: 'weekly',
      isActive: true,
    },
  });

  // Rep-level targets
  for (const rep of reps) {
    await prisma.targetConfig.create({
      data: {
        id: `seed-target-${rep.id}-total-monthly`,
        tenantId,
        userId: rep.id,
        metricType: 'total_meetings',
        targetValue: 15,
        period: 'monthly',
        isActive: true,
      },
    });
    await prisma.targetConfig.create({
      data: {
        id: `seed-target-${rep.id}-linkedin-monthly`,
        tenantId,
        userId: rep.id,
        metricType: 'linkedin_meetings',
        targetValue: 5,
        period: 'monthly',
        isActive: true,
      },
    });
  }

  // ─── Sample Anomalies ─────────────────────────────────
  // Clear existing seed anomalies to avoid duplicates on re-seed
  await prisma.anomaly.deleteMany({
    where: { tenantId, type: { in: ['unclassified', 'low_confidence', 'spike'] } },
  });

  await prisma.anomaly.create({
    data: {
      tenantId,
      type: 'unclassified',
      severity: 'warning',
      title: 'High volume of unclassified meetings',
      description: `${reps[0].name} has 8 unclassified meetings from the past week. Please review and classify.`,
      affectedEntity: 'user',
      affectedId: reps[0].id,
      recommendedAction: 'Navigate to the meeting review queue and classify pending meetings.',
    },
  });

  await prisma.anomaly.create({
    data: {
      tenantId,
      type: 'low_confidence',
      severity: 'info',
      title: 'Multiple low-confidence classifications',
      description: '5 meetings have auto-classification confidence below 30%. Manual review recommended.',
      recommendedAction: 'Review these meetings in the review queue - they may need manual attention.',
    },
  });

  await prisma.anomaly.create({
    data: {
      tenantId,
      type: 'spike',
      severity: 'warning',
      title: 'Unusual meeting volume spike',
      description: `${reps[1].name} had 12 external meetings last week, which is 3x their usual average.`,
      affectedEntity: 'user',
      affectedId: reps[1].id,
      recommendedAction: 'Verify these meetings are legitimate and correctly classified.',
    },
  });

  // ─── Sync Logs ────────────────────────────────────────
  // Clear existing seed sync logs to avoid duplicates on re-seed
  await prisma.syncLog.deleteMany({
    where: { tenantId, syncType: 'full', status: 'completed' },
  });

  const now = new Date();
  await prisma.syncLog.create({
    data: {
      tenantId,
      provider: 'microsoft_graph',
      syncType: 'full',
      status: 'completed',
      recordsProcessed: 45,
      recordsCreated: 45,
      recordsUpdated: 0,
      recordsSkipped: 0,
      startedAt: new Date(now.getTime() - 300000),
      completedAt: new Date(now.getTime() - 295000),
      durationMs: 5000,
    },
  });

  await prisma.syncLog.create({
    data: {
      tenantId,
      provider: 'hubspot',
      syncType: 'full',
      status: 'completed',
      recordsProcessed: 20,
      recordsCreated: 20,
      recordsUpdated: 0,
      recordsSkipped: 0,
      startedAt: new Date(now.getTime() - 600000),
      completedAt: new Date(now.getTime() - 597000),
      durationMs: 3000,
    },
  });

  console.log('Seed complete!');
  console.log('Credentials:');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

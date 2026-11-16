/**
 * Classification Engine v3 — Channel-based
 *
 * Auto-classifies calendar events into one of the MeetingChannel values:
 *   partnerships | conferences | referrals | linkedin | email | inbound | irrelevant
 *
 * Key design: signals are grouped into three tiers:
 *   1. IDENTITY   — definitive signals (partner email/domain match). Summed uncapped.
 *   2. CONTEXTUAL — subject-line keywords. Summed uncapped.
 *   3. GENERIC    — environmental signals (attendee count, duration, recurring).
 *                   Summed but CAPPED at MAX_GENERIC_SCORE per category so they
 *                   never collectively outweigh a single identity signal.
 *
 * This fixes the v1 bug where three weak generic signals (0.55 total) could
 * outweigh a strong partner email match (0.5).
 */

import type { MeetingChannel, ClassificationSignal } from "@/types";
import { INTERNAL_DOMAIN } from "@/lib/utils";

// MeetingClassification is now an alias for MeetingChannel
type MeetingClassification = MeetingChannel;

// ─── Interfaces ────────────────────────────────────────────

export interface ClassificationInput {
  subject: string | null;
  attendees: Array<{ email: string; name?: string; isInternal: boolean }>;
  organizer: string | null;
  duration: number; // minutes
  isRecurring: boolean;
  partnerDomains: string[]; // known partner domains
  partnerEmails: string[]; // known partner contact emails
  internalDomains?: string[]; // tenant-specific internal domains
  /** External emails that have appeared in previously synced meetings (for repeat detection) */
  knownExternalEmails?: string[];
}

export interface ClassificationResult {
  suggestedLabel: MeetingClassification;
  confidence: number; // 0-1
  reasoning: string;
  signals: ClassificationSignal[];
}

// ─── Signal tiers ──────────────────────────────────────────

type SignalTier = "identity" | "contextual" | "generic";

interface RawSignal {
  type: string;
  value: string;
  weight: number;
  description: string;
  suggests: MeetingClassification;
  tier: SignalTier;
}

const IDENTITY_TYPES = new Set([
  "PARTNER_EMAIL_MATCH",
  "PARTNER_DOMAIN_MATCH",
  "REPEAT_CONTACT",
]);

const CONTEXTUAL_TYPES = new Set([
  "CONFERENCE_KEYWORDS",
  "REFERRAL_KEYWORDS",
  "PARTNERSHIP_KEYWORDS",
  "IRRELEVANT_KEYWORDS",
  "LINKEDIN_KEYWORDS",
  "INBOUND_KEYWORDS",
]);

// Everything else is generic. Cap per category so generics never dominate.
const MAX_GENERIC_SCORE = 0.3;

// ─── Keyword lists ─────────────────────────────────────────

const CONFERENCE_KEYWORDS = [
  "conference",
  "summit",
  "expo",
  "trade show",
  "event",
  "keynote",
  "meetup",
  "workshop",
  "webinar",
  "booth",
];

const REFERRAL_KEYWORDS = [
  "referral",
  "referred by",
  "introduction from",
  "warm intro",
  "recommend",
  "introduced by",
];

const PARTNERSHIP_KEYWORDS = [
  "partner",
  "partnership",
  "alliance",
  "channel",
  "reseller",
  "co-sell",
  "co-marketing",
];

const LINKEDIN_KEYWORDS = [
  "linkedin",
  "inmail",
  "connection request",
];

const INBOUND_KEYWORDS = [
  "demo request",
  "inbound",
  "contact us",
  "pricing inquiry",
  "free trial",
  "sign up",
  "inquiry",
];

const IRRELEVANT_KEYWORDS = [
  "catch up",
  "sync",
  "standup",
  "1:1",
  "weekly",
  "status",
  "team meeting",
  "all hands",
];

// ─── Signal detection ──────────────────────────────────────

function detectSignals(input: ClassificationInput): RawSignal[] {
  const signals: RawSignal[] = [];
  const subjectLower = (input.subject ?? "").toLowerCase();
  const externalAttendees = input.attendees.filter((a) => !a.isInternal);

  // IDENTITY: Partner email match (strongest signal) -> partnerships
  const matchedPartnerEmails = input.attendees.filter((a) =>
    input.partnerEmails.some((pe) => pe.toLowerCase() === a.email.toLowerCase())
  );
  if (matchedPartnerEmails.length > 0) {
    signals.push({
      type: "PARTNER_EMAIL_MATCH",
      value: matchedPartnerEmails.map((a) => a.email).join(", "),
      weight: 0.7,
      description: `Attendee email is a known partner contact: ${matchedPartnerEmails.map((a) => a.email).join(", ")}`,
      suggests: "partnerships",
      tier: "identity",
    });
  }

  // IDENTITY: Partner domain match -> partnerships
  const matchedPartnerDomains = externalAttendees.filter((a) => {
    const domain = a.email.split("@")[1]?.toLowerCase();
    return domain && input.partnerDomains.some((pd) => pd.toLowerCase() === domain);
  });
  if (matchedPartnerDomains.length > 0) {
    signals.push({
      type: "PARTNER_DOMAIN_MATCH",
      value: matchedPartnerDomains.map((a) => a.email).join(", "),
      weight: 0.6,
      description: `External attendee domain matches known partner: ${matchedPartnerDomains.map((a) => a.email).join(", ")}`,
      suggests: "partnerships",
      tier: "identity",
    });
  }

  // IDENTITY: Repeat meeting — external attendee(s) seen in prior meetings -> repeat_meeting
  if (input.knownExternalEmails && input.knownExternalEmails.length > 0) {
    const knownSet = new Set(input.knownExternalEmails.map((e) => e.toLowerCase()));
    const repeatAttendees = externalAttendees.filter((a) =>
      knownSet.has(a.email.toLowerCase())
    );
    if (repeatAttendees.length > 0) {
      signals.push({
        type: "REPEAT_CONTACT",
        value: repeatAttendees.map((a) => a.email).join(", "),
        weight: 0.65,
        description: `External attendee(s) seen in previous meetings: ${repeatAttendees.map((a) => a.email).join(", ")}`,
        suggests: "repeat_meeting",
        tier: "identity",
      });
    }
  }

  // CONTEXTUAL: Conference/event keywords -> conferences
  const conferenceMatches = CONFERENCE_KEYWORDS.filter((kw) => subjectLower.includes(kw));
  if (conferenceMatches.length > 0) {
    signals.push({
      type: "CONFERENCE_KEYWORDS",
      value: conferenceMatches.join(", "),
      weight: 0.35,
      description: `Subject contains conference/event keywords: ${conferenceMatches.join(", ")}`,
      suggests: "conferences",
      tier: "contextual",
    });
  }

  // CONTEXTUAL: Referral keywords -> referrals
  const referralMatches = REFERRAL_KEYWORDS.filter((kw) => subjectLower.includes(kw));
  if (referralMatches.length > 0) {
    signals.push({
      type: "REFERRAL_KEYWORDS",
      value: referralMatches.join(", "),
      weight: 0.4,
      description: `Subject contains referral-related keywords: ${referralMatches.join(", ")}`,
      suggests: "referrals",
      tier: "contextual",
    });
  }

  // CONTEXTUAL: Partnership keywords -> partnerships
  const partnershipMatches = PARTNERSHIP_KEYWORDS.filter((kw) => subjectLower.includes(kw));
  if (partnershipMatches.length > 0) {
    signals.push({
      type: "PARTNERSHIP_KEYWORDS",
      value: partnershipMatches.join(", "),
      weight: 0.35,
      description: `Subject contains partnership-related keywords: ${partnershipMatches.join(", ")}`,
      suggests: "partnerships",
      tier: "contextual",
    });
  }

  // CONTEXTUAL: LinkedIn keywords -> linkedin
  const linkedinMatches = LINKEDIN_KEYWORDS.filter((kw) => subjectLower.includes(kw));
  if (linkedinMatches.length > 0) {
    signals.push({
      type: "LINKEDIN_KEYWORDS",
      value: linkedinMatches.join(", "),
      weight: 0.35,
      description: `Subject contains LinkedIn-related keywords: ${linkedinMatches.join(", ")}`,
      suggests: "linkedin",
      tier: "contextual",
    });
  }

  // CONTEXTUAL: Inbound keywords -> inbound
  const inboundMatches = INBOUND_KEYWORDS.filter((kw) => subjectLower.includes(kw));
  if (inboundMatches.length > 0) {
    signals.push({
      type: "INBOUND_KEYWORDS",
      value: inboundMatches.join(", "),
      weight: 0.3,
      description: `Subject contains inbound/demo-request keywords: ${inboundMatches.join(", ")}`,
      suggests: "inbound",
      tier: "contextual",
    });
  }

  // CONTEXTUAL: Irrelevant keywords -> irrelevant
  const irrelevantMatches = IRRELEVANT_KEYWORDS.filter((kw) => subjectLower.includes(kw));
  if (irrelevantMatches.length > 0) {
    signals.push({
      type: "IRRELEVANT_KEYWORDS",
      value: irrelevantMatches.join(", "),
      weight: 0.3,
      description: `Subject contains internal/irrelevant keywords: ${irrelevantMatches.join(", ")}`,
      suggests: "irrelevant",
      tier: "contextual",
    });
  }

  // GENERIC: External attendee count (1-3) — focused business meeting -> email (most common channel)
  if (externalAttendees.length >= 1 && externalAttendees.length <= 3) {
    signals.push({
      type: "EXTERNAL_ATTENDEE_COUNT",
      value: String(externalAttendees.length),
      weight: 0.15,
      description: `${externalAttendees.length} external attendee(s) suggests a focused business meeting`,
      suggests: "email",
      tier: "generic",
    });
  }

  // GENERIC: Many external attendees (4+) — group presentation/conference
  if (externalAttendees.length >= 4) {
    signals.push({
      type: "MANY_EXTERNAL_ATTENDEES",
      value: String(externalAttendees.length),
      weight: 0.1,
      description: `${externalAttendees.length} external attendees suggests a group presentation or conference`,
      suggests: "conferences",
      tier: "generic",
    });
  }

  // GENERIC: Short meeting (< 20 min)
  if (input.duration < 20) {
    signals.push({
      type: "SHORT_MEETING",
      value: `${input.duration} min`,
      weight: 0.15,
      description: `Short meeting (${input.duration} min) is likely irrelevant`,
      suggests: "irrelevant",
      tier: "generic",
    });
  }

  // GENERIC: Typical meeting (30-60 min) -> email (default external meeting channel)
  if (input.duration >= 30 && input.duration <= 60) {
    signals.push({
      type: "LONG_MEETING",
      value: `${input.duration} min`,
      weight: 0.1,
      description: `Meeting duration (${input.duration} min) is typical for a business meeting`,
      suggests: "email",
      tier: "generic",
    });
  }

  // GENERIC: Recurring event
  if (input.isRecurring) {
    signals.push({
      type: "RECURRING",
      value: "true",
      weight: 0.1,
      description: "Recurring events are more likely to be internal/irrelevant",
      suggests: "irrelevant",
      tier: "generic",
    });
  }

  return signals;
}

// ─── Tiered scoring ────────────────────────────────────────

const ALL_CHANNELS: MeetingClassification[] = [
  "partnerships", "conferences", "referrals", "linkedin", "email", "inbound", "repeat_meeting", "irrelevant",
];

function scoreSignals(signals: RawSignal[]): Record<MeetingClassification, number> {
  const scores = Object.fromEntries(ALL_CHANNELS.map((ch) => [ch, 0])) as Record<MeetingClassification, number>;

  // Identity + Contextual: sum uncapped
  for (const signal of signals) {
    if (signal.tier === "identity" || signal.tier === "contextual") {
      scores[signal.suggests] = (scores[signal.suggests] ?? 0) + signal.weight;
    }
  }

  // Generic: sum per category, then cap each at MAX_GENERIC_SCORE
  const genericTotals = Object.fromEntries(ALL_CHANNELS.map((ch) => [ch, 0])) as Record<MeetingClassification, number>;

  for (const signal of signals) {
    if (signal.tier === "generic") {
      genericTotals[signal.suggests] = (genericTotals[signal.suggests] ?? 0) + signal.weight;
    }
  }

  for (const cat of ALL_CHANNELS) {
    scores[cat] += Math.min(genericTotals[cat], MAX_GENERIC_SCORE);
  }

  return scores;
}

// ─── Main classification function ──────────────────────────

export function classifyMeeting(input: ClassificationInput): ClassificationResult {
  const rawSignals = detectSignals(input);
  const scores = scoreSignals(rawSignals);

  // Find the label with the highest score
  const entries = Object.entries(scores) as [MeetingClassification, number][];
  entries.sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) {
    return {
      suggestedLabel: "irrelevant" as MeetingClassification,
      confidence: 0,
      reasoning: "No classification signals detected.",
      signals: [],
    };
  }

  const [topLabel, topScore] = entries[0];
  const totalScore = entries.reduce((sum, [, s]) => sum + s, 0);

  // Normalize confidence (clamp to 0-1 range)
  const confidence = totalScore > 0 ? Math.max(0, Math.min(1, topScore / totalScore)) : 0;

  // Convert raw signals to ClassificationSignal (drop internal fields)
  const classificationSignals: ClassificationSignal[] = rawSignals.map((s) => ({
    type: s.type,
    value: s.value,
    weight: s.weight,
    description: s.description,
  }));

  // If the max score is too low, default to irrelevant with very low confidence
  if (topScore < 0.2) {
    return {
      suggestedLabel: "irrelevant",
      confidence: 0.15,
      reasoning: "No strong signals detected; defaulting to irrelevant. Please review manually.",
      signals: classificationSignals,
    };
  }

  // Build reasoning from the top contributing signals for the winning label
  const topSignals = rawSignals
    .filter((s) => s.suggests === topLabel)
    .sort((a, b) => b.weight - a.weight);

  const reasoningParts = topSignals.map((s) => s.description);
  const reasoning = reasoningParts.length > 0
    ? `Classified as ${topLabel} (${getConfidenceLevel(confidence)} confidence). ${reasoningParts.join(". ")}.`
    : `Classified as ${topLabel} based on overall signal balance.`;

  return {
    suggestedLabel: topLabel,
    confidence: Math.round(confidence * 100) / 100,
    reasoning,
    signals: classificationSignals,
  };
}

// ─── Helpers ───────────────────────────────────────────────

export function getConfidenceLevel(confidence: number): "high" | "medium" | "low" {
  if (confidence >= 0.7) return "high";
  if (confidence >= 0.4) return "medium";
  return "low";
}

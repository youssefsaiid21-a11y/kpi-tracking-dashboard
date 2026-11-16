/**
 * Shared constants used across frontend and backend.
 * Single source of truth for enums, labels, and configuration values.
 */

// ─── Channels (replaces Classification + Source) ──────────

export const CHANNELS = ["partnerships", "conferences", "referrals", "linkedin", "email", "inbound", "repeat_meeting", "irrelevant"] as const;

export const ACTIVE_CHANNELS = ["partnerships", "conferences", "referrals", "linkedin", "email", "inbound", "repeat_meeting"] as const;

export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_LABELS: Record<string, string> = {
  partnerships: "Partnerships",
  conferences: "Conferences",
  referrals: "Referrals",
  linkedin: "LinkedIn",
  email: "Email",
  inbound: "Inbound",
  repeat_meeting: "Repeat Meeting",
  irrelevant: "Irrelevant",
};

export const CHANNEL_COLORS: Record<string, string> = {
  partnerships: "#8B5CF6",  // purple
  conferences: "#F59E0B",   // amber
  referrals: "#10B981",     // emerald
  linkedin: "#0A66C2",      // linkedin blue
  email: "#EF4444",         // red
  inbound: "#06B6D4",       // cyan
  repeat_meeting: "#F97316", // orange
  irrelevant: "#6B7280",    // gray
};

// ─── Metric Types ──────────────────────────────────────────

export const METRIC_TYPES = [
  "total_meetings",
  "linkedin_meetings",
  "email_meetings",
  "partnerships_meetings",
  "conferences_meetings",
  "referrals_meetings",
  "inbound_meetings",
  "repeat_meeting_meetings",
  "conversion_rate",
] as const;

export type MetricType = (typeof METRIC_TYPES)[number];

export const METRIC_TYPE_DISPLAY: Record<MetricType, string> = {
  total_meetings: "Total Meetings",
  linkedin_meetings: "LinkedIn Meetings",
  email_meetings: "Email Meetings",
  partnerships_meetings: "Partnerships Meetings",
  conferences_meetings: "Conferences Meetings",
  referrals_meetings: "Referrals Meetings",
  inbound_meetings: "Inbound Meetings",
  repeat_meeting_meetings: "Repeat Meetings",
  conversion_rate: "Conversion Rate",
};

// ─── Periods ───────────────────────────────────────────────

export const PERIODS = [
  "weekly",
  "monthly",
  "quarterly",
  "all_time",
] as const;

export type Period = (typeof PERIODS)[number];

// ─── User Roles ────────────────────────────────────────────

export const USER_ROLES = ["rep", "manager", "admin"] as const;

export type UserRole = (typeof USER_ROLES)[number];

// ─── Severity ──────────────────────────────────────────────

export const SEVERITIES = ["info", "warning", "critical"] as const;

export type Severity = (typeof SEVERITIES)[number];

// ─── Anomaly Types ─────────────────────────────────────────

export const ANOMALY_TYPES = [
  "unclassified",
  "duplicate",
  "spike",
  "impossible_rate",
  "missing_owner",
  "sync_failure",
  "low_confidence",
  "internal_leak",
] as const;

export type AnomalyType = (typeof ANOMALY_TYPES)[number];

// ─── Sync Providers ────────────────────────────────────────

export const SYNC_PROVIDERS = ["microsoft_graph", "hubspot"] as const;

export type SyncProvider = (typeof SYNC_PROVIDERS)[number];

// ─── Export Types ──────────────────────────────────────────

export const EXPORT_TYPES = ["meetings", "pipeline", "attribution"] as const;

export type ExportType = (typeof EXPORT_TYPES)[number];

// ─── Thresholds ────────────────────────────────────────────

export const CONFIDENCE_THRESHOLDS = {
  HIGH: 0.8,
  MEDIUM: 0.5,
} as const;

export const TARGET_PROGRESS_THRESHOLDS = {
  ON_TRACK: 0.8,
  AT_RISK: 0.5,
} as const;

// ─── UI Constants ──────────────────────────────────────────

export const TOAST_DURATION_MS = 3000;
export const SEARCH_DEBOUNCE_MS = 400;
export const DEFAULT_PAGE_SIZE = 20;

// Prisma compound unique @@unique([tenantId, userId, period, periodStart]) cannot
// upsert when userId is NULL (SQL NULL != NULL), so team-level KPI snapshots use
// this sentinel value instead of null.
export const TEAM_SNAPSHOT_USER_ID = "__team__";

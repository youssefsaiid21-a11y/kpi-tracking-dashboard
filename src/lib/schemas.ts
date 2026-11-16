/**
 * Zod schemas — single source of truth for all API validation.
 *
 * Every API route validates input through these schemas.
 * Every frontend form can reuse them for client-side validation.
 * No more scattered `if (!email)` checks.
 */

import { z } from "zod";

// ─── Shared enums ─────────────────────────────────────────

export const ChannelSchema = z.enum([
  "partnerships", "conferences", "referrals",
  "linkedin", "email", "inbound", "repeat_meeting", "irrelevant",
]);

export const ActiveChannelSchema = z.enum([
  "partnerships", "conferences", "referrals",
  "linkedin", "email", "inbound", "repeat_meeting",
]);

export const RoleSchema = z.enum(["rep", "manager", "admin"]);

export const PeriodSchema = z.enum(["weekly", "monthly", "quarterly", "all_time", "custom"]);

export const MetricTypeSchema = z.enum([
  "total_meetings", "linkedin_meetings", "email_meetings",
  "partnerships_meetings", "conferences_meetings",
  "referrals_meetings", "inbound_meetings", "repeat_meeting_meetings",
  "conversion_rate",
]);

export const MeetingStatusSchema = z.enum(["pending", "completed", "cancelled", "noshow"]);

export const SeveritySchema = z.enum(["critical", "warning", "info"]);

export const AnomalyTypeSchema = z.enum([
  "unclassified", "duplicate", "spike", "impossible_rate",
  "missing_owner", "sync_failure", "low_confidence", "internal_leak",
]);

// ─── Shared primitives ────────────────────────────────────

/** Coerce string to Date, reject invalid dates */
const dateParam = z.coerce.date().refine((d) => !isNaN(d.getTime()), {
  message: "Invalid date",
});

/** Pagination params with sane defaults */
export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** Cron expression: 5 whitespace-separated fields */
export const CronSchema = z.string().regex(
  /^(\S+\s+){4}\S+$/,
  "Invalid cron expression. Expected 5-field format (e.g., '0 9 * * 1')"
);

// ─── API schemas ──────────────────────────────────────────

// GET /api/meetings
export const MeetingsQuerySchema = PaginationSchema.extend({
  status: MeetingStatusSchema.optional(),
  classification: ChannelSchema.optional(),
  userId: z.string().optional(),
  startDate: dateParam.optional(),
  endDate: dateParam.optional(),
  search: z.string().max(500, "Search query too long").optional(),
  countOnly: z.enum(["true", "false"]).optional(),
});

// GET /api/analytics
export const AnalyticsQuerySchema = z.object({
  period: PeriodSchema.default("monthly"),
  startDate: dateParam.optional(),
  endDate: dateParam.optional(),
  userId: z.string().optional(),
});

// GET /api/targets
export const TargetsQuerySchema = z.object({
  userId: z.string().optional(),
  metricType: MetricTypeSchema.optional(),
  period: z.enum(["weekly", "monthly", "quarterly"]).optional(),
});

// POST /api/targets
export const CreateTargetSchema = z.object({
  metricType: MetricTypeSchema,
  targetValue: z.number().positive().max(999999),
  period: z.enum(["weekly", "monthly", "quarterly"]),
  userId: z.string().nullable().optional(),
  stageId: z.string().nullable().optional(),
  periodStart: z.string().nullable().optional(),
});

// PUT /api/targets
export const UpdateTargetSchema = z.object({
  id: z.string(),
  userId: z.string().nullable().optional(),
  metricType: MetricTypeSchema.optional(),
  stageId: z.string().nullable().optional(),
  targetValue: z.number().positive().max(999999).optional(),
  period: z.enum(["weekly", "monthly", "quarterly"]).optional(),
  periodStart: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

// DELETE /api/targets (query param)
export const DeleteTargetQuerySchema = z.object({
  id: z.string(),
});

// POST /api/meetings/:id/review
export const CreateReviewSchema = z.object({
  confirmedLabel: ChannelSchema,
  source: z.string().nullable().optional(),
  partnerName: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  partnerEvidence: z.any().optional(),
});

// PUT /api/meetings/:id/review
export const UpdateReviewSchema = z.object({
  confirmedLabel: ChannelSchema.optional(),
  source: z.string().nullable().optional(),
  partnerName: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  partnerEvidence: z.any().optional(),
});

// POST /api/meetings/bulk-review
export const BulkReviewSchema = z.object({
  eventIds: z.array(z.string()).min(1).max(100),
  confirmedLabel: ChannelSchema,
  source: z.string().optional(),
});

// POST /api/users
export const CreateUserSchema = z.object({
  email: z.string().email("Invalid email format"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().optional(),
  role: RoleSchema.default("rep"),
  outlookEmail: z.string().email().nullable().optional(),
  hubspotOwnerId: z.string().nullable().optional(),
});

// PUT /api/users
export const UpdateUserSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  role: RoleSchema.optional(),
  password: z.string().min(8).optional(),
  outlookEmail: z.string().email().nullable().optional(),
  hubspotOwnerId: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

// PUT /api/settings
export const UpdateSettingsSchema = z.object({
  provider: z.string().optional(),
  isEnabled: z.boolean().optional(),
  syncIntervalMin: z.number().int().min(1).optional(),
  reminderCron: CronSchema.optional(),
  reminderEnabled: z.boolean().optional(),
});

// PUT /api/anomalies (resolve)
export const ResolveAnomalySchema = z.object({
  id: z.string(),
});

// GET /api/anomalies
export const AnomaliesQuerySchema = z.object({
  severity: SeveritySchema.optional(),
  type: AnomalyTypeSchema.optional(),
  isResolved: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// GET /api/export
export const ExportQuerySchema = z.object({
  type: z.enum(["meetings", "pipeline", "attribution"]).default("meetings"),
  format: z.enum(["csv", "json"]).default("csv"),
  startDate: dateParam.optional(),
  endDate: dateParam.optional(),
});

// ─── Insights (Custom Charts) ────────────────────────────

export const DataSourceSchema = z.enum([
  "channel_breakdown", "weekly_trend", "conversion_funnel",
  "target_vs_actual", "rep_performance", "deal_pipeline",
  "deal_timeline", "classification_rate",
]);

export const InsightsDataSchema = z.object({
  dataSource: DataSourceSchema,
  period: PeriodSchema.default("monthly"),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  filters: z.object({
    userId: z.string().optional(),
    channels: z.array(ChannelSchema).optional(),
    pipelineId: z.string().optional(),
  }).optional(),
});

export const InsightsChatSchema = z.object({
  message: z.string().min(1).max(2000),
  conversationHistory: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string(),
  })).optional(),
});

export const SaveChartSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  config: z.string(), // JSON string of ChartConfig
});

export const UpdateChartSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(500).optional(),
  config: z.string().optional(),
  position: z.number().int().optional(),
});

export const DeleteChartSchema = z.object({
  id: z.string(),
});

// ─── Helper to parse query params ─────────────────────────

/** Parse URLSearchParams into a plain object for Zod validation */
export function searchParamsToObject(params: URLSearchParams): Record<string, string> {
  const obj: Record<string, string> = {};
  params.forEach((value, key) => {
    obj[key] = value;
  });
  return obj;
}

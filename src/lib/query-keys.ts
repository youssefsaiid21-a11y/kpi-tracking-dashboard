/**
 * Query key factory — shared between server prefetch and client hooks.
 *
 * Extracted from useApi.ts so server components can import without
 * pulling in the "use client" boundary.
 */

import type { DateRange } from "@/types";

export const queryKeys = {
  analytics: (dateRange: DateRange) =>
    ["analytics", dateRange.period, dateRange.start.toISOString(), dateRange.end.toISOString()] as const,
  team: (dateRange: DateRange) =>
    ["team", dateRange.period, dateRange.start.toISOString(), dateRange.end.toISOString()] as const,
  meetings: (params: Record<string, string | number>) =>
    ["meetings", params] as const,
  pendingCount: (dateRange: DateRange) =>
    ["pendingCount", dateRange.start.toISOString(), dateRange.end.toISOString()] as const,
  targets: () => ["targets"] as const,
  users: () => ["users"] as const,
  syncLogs: () => ["syncLogs"] as const,
  settings: () => ["settings"] as const,
  anomalies: (params?: Record<string, string>) => ["anomalies", params] as const,
  pipelines: () => ["pipelines"] as const,
  savedCharts: () => ["saved-charts"] as const,
  insightsData: (dataSource: string, dateRange: DateRange, filters?: Record<string, unknown>) =>
    ["insights-data", dataSource, dateRange.start.toISOString(), dateRange.end.toISOString(), filters] as const,
};

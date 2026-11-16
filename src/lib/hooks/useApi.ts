"use client";

/**
 * React Query hooks — replaces all manual useEffect + fetch + useState patterns.
 *
 * Benefits over the old approach:
 * - Automatic request deduplication (same query key = single request)
 * - Automatic abort on unmount (no more stale closure bugs)
 * - Background refetching with stale-while-revalidate
 * - Built-in cache invalidation
 * - No race conditions
 */

import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { DateRange, ChartConfig } from "@/types";
import type {
  KPIMetrics,
  TargetVsActual,
  TrendPoint,
  TeamOverview,
  StageConversion,
  StrategyRecommendation,
} from "@/types";

// ─── Response types ────────────────────────────────────────

interface AnalyticsResponse {
  success: boolean;
  data: {
    metrics: KPIMetrics;
    targetVsActual: TargetVsActual[];
    trend: TrendPoint[];
    dateRange: { start: string; end: string; period: string; label: string };
  };
}

interface TeamResponse {
  success: boolean;
  data: {
    overview: TeamOverview;
    recommendations: StrategyRecommendation[];
    dateRange: { start: string; end: string; period: string; label: string };
  };
}

interface MeetingsResponse {
  success: boolean;
  data: any[];
  meta: { total: number; page: number; pageSize: number; totalPages: number };
}

interface ReviewResponse {
  success: boolean;
  data: any;
}

// ─── Query key factory (imported from shared module, re-exported) ───

import { queryKeys } from "@/lib/query-keys";
export { queryKeys };

// ─── Hooks ────────────────────────────────────────────────

export function useAnalytics(dateRange: DateRange, enabled = true) {
  return useQuery({
    queryKey: queryKeys.analytics(dateRange),
    queryFn: ({ signal }) =>
      api.get<AnalyticsResponse>("/api/analytics", {
        period: dateRange.period,
        startDate: dateRange.start.toISOString(),
        endDate: dateRange.end.toISOString(),
      }, signal),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useTeamOverview(dateRange: DateRange, enabled = true) {
  return useQuery({
    queryKey: queryKeys.team(dateRange),
    queryFn: ({ signal }) =>
      api.get<TeamResponse>("/api/analytics/team", {
        period: dateRange.period,
        startDate: dateRange.start.toISOString(),
        endDate: dateRange.end.toISOString(),
      }, signal),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useMeetings(params: Record<string, string | number>, enabled = true) {
  return useQuery({
    queryKey: queryKeys.meetings(params),
    queryFn: ({ signal }) =>
      api.get<MeetingsResponse>("/api/meetings", params as any, signal),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function usePendingCount(dateRange: DateRange, enabled = true) {
  return useQuery({
    queryKey: queryKeys.pendingCount(dateRange),
    queryFn: ({ signal }) =>
      api.get<MeetingsResponse>("/api/meetings", {
        status: "pending",
        pageSize: 1,
        page: 1,
        countOnly: "true",
        startDate: dateRange.start.toISOString(),
        endDate: dateRange.end.toISOString(),
      }, signal),
    enabled,
    select: (data) => data.meta?.total ?? 0,
    placeholderData: keepPreviousData,
  });
}

export function useClassifyMeeting() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ eventId, data }: { eventId: string; data: any }) =>
      api.post<ReviewResponse>(`/api/meetings/${eventId}/review`, data),
    onSuccess: () => {
      // Invalidate meeting list + pending count immediately (visible on current page)
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      queryClient.invalidateQueries({ queryKey: ["pendingCount"] });
      // Mark analytics/team as stale but don't refetch until next navigation
      queryClient.invalidateQueries({ queryKey: ["analytics"], refetchType: "none" });
      queryClient.invalidateQueries({ queryKey: ["team"], refetchType: "none" });
    },
  });
}

export function useUpdateReview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ eventId, data }: { eventId: string; data: any }) =>
      api.put<ReviewResponse>(`/api/meetings/${eventId}/review`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      queryClient.invalidateQueries({ queryKey: ["analytics"] });
    },
  });
}

export function useSyncLogs() {
  return useQuery({
    queryKey: queryKeys.syncLogs(),
    queryFn: ({ signal }) => api.get<{ success: boolean; data: any[] }>("/api/sync", {}, signal),
    select: (data) => data.data ?? [],
  });
}

export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings(),
    queryFn: ({ signal }) => api.get<{ success: boolean; data: any }>("/api/settings", {}, signal),
    select: (data) => data.data,
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api.put<{ success: boolean }>("/api/settings", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settings() });
    },
  });
}

export function useUsers() {
  return useQuery({
    queryKey: queryKeys.users(),
    queryFn: ({ signal }) => api.get<{ success: boolean; data: any[] }>("/api/users", {}, signal),
    select: (data) => data.data ?? [],
  });
}

export function useTriggerSync() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (provider: string) =>
      api.post<{ success: boolean }>(`/api/${provider === "hubspot" ? "hubspot" : "sync"}`, {
        provider,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.syncLogs() });
      queryClient.invalidateQueries({ queryKey: queryKeys.settings() });
    },
  });
}

// ─── Insights (Custom Charts) ─────────────────────────────

export function useInsightsData(config: ChartConfig | null, dateRange: DateRange, enabled = true) {
  return useQuery({
    queryKey: queryKeys.insightsData(config?.dataSource ?? "", dateRange, config?.filters as Record<string, unknown> | undefined),
    queryFn: ({ signal }) =>
      api.post<{ success: boolean; data: { rows: Record<string, unknown>[] } }>(
        "/api/insights/data",
        {
          dataSource: config!.dataSource,
          period: dateRange.period,
          startDate: dateRange.start.toISOString(),
          endDate: dateRange.end.toISOString(),
          filters: config!.filters,
        },
        signal
      ),
    enabled: enabled && config !== null && !!config.dataSource,
    select: (data) => data.data.rows,
  });
}

export function useSavedCharts() {
  return useQuery({
    queryKey: queryKeys.savedCharts(),
    queryFn: ({ signal }) =>
      api.get<{ success: boolean; data: any[] }>("/api/insights/charts", {}, signal),
    select: (data) => data.data ?? [],
  });
}

export function useSaveChart() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { title: string; description?: string; config: string }) =>
      api.post<{ success: boolean; data: { id: string } }>("/api/insights/charts", data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.savedCharts() }),
  });
}

export function useDeleteChart() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ success: boolean }>("/api/insights/charts", { id, _delete: true }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.savedCharts() }),
  });
}

// ─── Anomalies ───────────────────────────────────────────

export function useAnomalies(enabled = true) {
  return useQuery({
    queryKey: queryKeys.anomalies(),
    queryFn: ({ signal }) =>
      api.get<{ success: boolean; data: any[] }>("/api/anomalies", {}, signal),
    select: (data) => data.data ?? [],
    enabled,
  });
}

export function useResolveAnomaly() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.put<{ success: boolean }>("/api/anomalies", { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.anomalies() });
    },
  });
}

// ─── Outlook status (Settings page) ─────────────────────

export function useOutlookStatus(enabled = true) {
  return useQuery({
    queryKey: ["outlookStatus"] as const,
    queryFn: ({ signal }) =>
      api.get<{ success: boolean; data: any }>("/api/users/me", {}, signal),
    select: (data) => ({
      connected: !!data.data?.outlookConnected,
      email: data.data?.outlookEmail as string | undefined,
    }),
    enabled,
  });
}

// ─── Create user ─────────────────────────────────────────

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; email: string; password: string; role: string; outlookEmail?: string }) =>
      api.post<{ success: boolean }>("/api/users", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users() });
    },
  });
}

// ─── Bulk review (meetings page history) ─────────────────

export function useReviewMeeting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, data, method }: { eventId: string; data: any; method: "POST" | "PUT" }) =>
      method === "PUT"
        ? api.put<ReviewResponse>(`/api/meetings/${eventId}/review`, data)
        : api.post<ReviewResponse>(`/api/meetings/${eventId}/review`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      queryClient.invalidateQueries({ queryKey: ["pendingCount"] });
      queryClient.invalidateQueries({ queryKey: ["analytics"], refetchType: "none" });
      queryClient.invalidateQueries({ queryKey: ["team"], refetchType: "none" });
    },
  });
}

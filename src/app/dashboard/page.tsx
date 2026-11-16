/**
 * Dashboard page — server component that prefetches data for instant render.
 *
 * Uses React Query SSR hydration: prefetches analytics data on the server,
 * dehydrates the cache, and passes it to the client via HydrationBoundary.
 * The client DashboardClient component's useAnalytics/useTeamOverview hooks
 * find data already in cache — no loading spinner on first paint.
 *
 * Subsequent interactions (period change, background refetch) work exactly
 * as before via React Query client-side fetching.
 */

import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { getServerAuth } from "@/lib/server-auth";
import { makeQueryClient } from "@/lib/get-query-client";
import { getDateRange } from "@/lib/utils";
import {
  getRepMetrics,
  getTrendData,
  getTeamOverview,
  getConversionRates,
  buildTargetVsActual,
} from "@/lib/services/kpi-calculator";
import { generateRecommendations } from "@/lib/services/deficit-analyzer";
import prisma from "@/lib/prisma";
import { queryKeys } from "@/lib/query-keys";
import type { TargetVsActual, StageConversion } from "@/types";
import DashboardClient from "./dashboard-client";

export default async function DashboardPage() {
  const auth = await getServerAuth();

  // If auth fails (edge case — middleware already redirects), fall back
  // to client-side rendering which will redirect via useSession.
  if (!auth) {
    return <DashboardClient />;
  }

  const { userId, role, tenantId } = auth;
  const isManager = role === "manager" || role === "admin";

  // Use "weekly" — matches AppShell's default initial period.
  // If the user's saved period differs, React Query will detect a cache miss
  // for that key and fetch client-side. keepPreviousData shows the SSR data
  // during that brief transition.
  const dateRange = getDateRange("weekly");

  const queryClient = makeQueryClient();

  // Prefetch analytics (and team data for managers) in parallel
  const prefetches: Promise<void>[] = [
    queryClient.prefetchQuery({
      queryKey: queryKeys.analytics(dateRange),
      queryFn: async () => {
        const [metrics, targets, trend] = await Promise.all([
          getRepMetrics(tenantId, userId, dateRange.start, dateRange.end),
          prisma.targetConfig.findMany({
            where: {
              tenantId,
              isActive: true,
              OR: [{ userId }, { userId: null }],
            },
          }),
          getTrendData(tenantId, userId, dateRange.start, dateRange.end),
        ]);

        const targetVsActual: TargetVsActual[] = targets.map((t) =>
          buildTargetVsActual(
            t,
            metrics.channelBreakdown,
            dateRange.end,
            metrics.conversionRates
          )
        );

        return {
          success: true as const,
          data: {
            metrics,
            targetVsActual,
            trend,
            dateRange: {
              start: dateRange.start.toISOString(),
              end: dateRange.end.toISOString(),
              period: dateRange.period,
              label: dateRange.label,
            },
          },
        };
      },
    }),
  ];

  // Conditionally prefetch team data for managers/admins — runs in parallel
  if (isManager) {
    prefetches.push(
      queryClient.prefetchQuery({
        queryKey: queryKeys.team(dateRange),
        queryFn: async () => {
          const overview = await getTeamOverview(
            tenantId,
            dateRange.start,
            dateRange.end
          );

          let conversionRates: StageConversion[] = [];
          try {
            conversionRates = await getConversionRates(tenantId);
          } catch {
            // Pipeline data may not exist yet
          }

          const recommendations = generateRecommendations(
            overview,
            conversionRates,
            overview.teamTarget
          );

          return {
            success: true as const,
            data: {
              overview,
              recommendations,
              dateRange: {
                start: dateRange.start.toISOString(),
                end: dateRange.end.toISOString(),
                period: dateRange.period,
                label: dateRange.label,
              },
            },
          };
        },
      })
    );
  }

  await Promise.all(prefetches);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <DashboardClient />
    </HydrationBoundary>
  );
}

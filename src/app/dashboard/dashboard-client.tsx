"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { useSession } from "@/lib/hooks/useSession";
import { useDateRange } from "@/lib/hooks/useDateRange";
import { useDashboardLayout } from "@/lib/hooks/useDashboardLayout";
import { useAnalytics, useTeamOverview, usePendingCount } from "@/lib/hooks/useApi";
import type { WidgetId } from "@/lib/hooks/useDashboardLayout";
import { KPICard } from "@/components/charts/kpi-card";
import { CustomizePanel } from "@/components/dashboard/customize-panel";

const TrendChart = dynamic(() => import("@/components/charts/trend-chart").then((m) => m.TrendChart), {
  ssr: false,
  loading: () => <div className="h-[280px] animate-pulse rounded-lg bg-card border border-white/[0.04]" />,
});

const TargetGauge = dynamic(() => import("@/components/charts/target-gauge").then((m) => m.TargetGauge), {
  ssr: false,
  loading: () => <div className="h-[280px] animate-pulse rounded-lg bg-card border border-white/[0.04]" />,
});
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  Settings2,
  Inbox,
  Trophy,
  ArrowRight,
  TrendingUp,
} from "lucide-react";
import { cn, formatNumber } from "@/lib/utils";
import Link from "next/link";
import type { AnomalySummary } from "@/types";

const severityVariant: Record<string, "destructive" | "warning" | "secondary"> = {
  critical: "destructive",
  warning: "warning",
  info: "secondary",
};

const channelColors: Record<string, string> = {
  partnerships: "bg-violet-500/15 text-violet-400 border-violet-500/20",
  conferences: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  referrals: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  linkedin: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  email: "bg-cyan-500/15 text-cyan-400 border-cyan-500/20",
  inbound: "bg-pink-500/15 text-pink-400 border-pink-500/20",
};

export default function DashboardClient() {
  const { user, isLoading: sessionLoading } = useSession();
  const { dateRange } = useDateRange();

  const role = user?.role;
  const isManagerOrAdmin = role === "manager" || role === "admin";

  // ── Data fetching via React Query (automatic abort, caching, dedup) ──
  const { data: analyticsData, isLoading: analyticsLoading, error: analyticsError, isFetching: analyticsFetching, refetch: refetchAnalytics } =
    useAnalytics(dateRange, !sessionLoading);

  const { data: teamData, isLoading: teamLoading } =
    useTeamOverview(dateRange, !sessionLoading && isManagerOrAdmin);

  const { data: pendingCount } = usePendingCount(dateRange, !sessionLoading);

  const {
    layout, editMode, setEditMode, toggleWidget,
    moveWidget, resetLayout, availableWidgets,
  } = useDashboardLayout(isManagerOrAdmin);

  // ── Derived display values (memoized) ──
  const display = useMemo(() => {
    const analytics = analyticsData?.data;
    const team = teamData?.data?.overview;
    if (!analytics) return null;

    const useTeam = isManagerOrAdmin && team;
    const channelBreakdown = useTeam ? team.channelBreakdown : analytics.metrics.channelBreakdown;
    const totalClassified = useTeam ? team.totalClassified : analytics.metrics.totalClassified;
    const classificationRate = useTeam ? team.averageClassificationRate : analytics.metrics.classificationRate;
    const trend = useTeam ? team.trend ?? [] : analytics.trend ?? [];
    const targets = useTeam ? team.teamTarget ?? [] : analytics.targetVsActual ?? [];
    const warnings: AnomalySummary[] = useTeam ? team.topWarnings ?? [] : [];
    const conversionRates = analytics.metrics.conversionRates ?? [];
    // Use the first transition's fromCount (total pipeline deals) rather than summing
    // dealCount across transitions which double-counts (a deal at Proposal also counted in Discovery).
    const pipelineValue = conversionRates.length > 0 ? conversionRates[0].fromCount : 0;

    const totalTarget = targets.find((t) => t.metricType === "total_meetings");
    const totalTrend = totalTarget && totalTarget.target > 0
      ? ((totalClassified - totalTarget.target) / totalTarget.target) * 100
      : undefined;

    const topPerformers = team?.repPerformance
      ? [...team.repPerformance].sort((a, b) => b.totalClassified - a.totalClassified).slice(0, 5)
      : [];

    return {
      analytics, channelBreakdown, totalClassified, classificationRate,
      trend, targets, warnings, conversionRates, pipelineValue,
      totalTarget, totalTrend, topPerformers,
    };
  }, [analyticsData, teamData, isManagerOrAdmin]);

  // ── Loading state ──
  const loading = sessionLoading || analyticsLoading || (isManagerOrAdmin && teamLoading);

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={`skel-${i}`} className="rounded-lg bg-card border border-white/[0.04] p-5 pl-6">
              <div className="space-y-3">
                <div className="h-3 w-24 rounded bg-white/[0.04]" />
                <div className="h-7 w-16 rounded bg-white/[0.06]" />
                <div className="h-2.5 w-20 rounded bg-white/[0.03]" />
              </div>
            </div>
          ))}
        </div>
        <div className="rounded-lg bg-card border border-white/[0.04] p-5 h-[340px]" />
      </div>
    );
  }

  if (analyticsError && !analyticsFetching) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Card className="max-w-md">
          <CardContent className="p-6 text-center">
            <p className="text-sm text-red-400">
              {analyticsError instanceof Error ? analyticsError.message : "Failed to load dashboard data"}
            </p>
            <Button variant="outline" className="mt-4" onClick={() => refetchAnalytics()}>
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!display) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Card className="max-w-md">
          <CardContent className="p-6 text-center">
            <p className="text-sm text-muted-foreground">
              No data yet. Start syncing your calendar to see KPIs here.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const {
    analytics, channelBreakdown, totalClassified, classificationRate,
    trend, targets, warnings, conversionRates, pipelineValue,
    totalTarget, totalTrend, topPerformers,
  } = display;

  // ── Widget renderers ──
  const widgets: Record<WidgetId, () => React.ReactNode> = {
    kpi_cards: () => (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard
          title="Total Classified" value={formatNumber(totalClassified)}
          subtitle="Meetings this period" trend={totalTrend}
          variant={totalTarget?.onTrack ? "success" : totalTarget ? "warning" : "default"}
        />
        <KPICard
          title="Classification Rate" value={`${Math.round(classificationRate * 100)}%`}
          subtitle="Meetings reviewed"
          variant={classificationRate >= 0.8 ? "success" : classificationRate >= 0.5 ? "warning" : "destructive"}
        />
        <KPICard title="Pipeline Deals" value={formatNumber(pipelineValue)} subtitle="Active deals in pipeline" />
        <KPICard title="Total Meetings" value={formatNumber(analytics.metrics.totalMeetings)} subtitle="All classified (excl. irrelevant)" />
      </div>
    ),

    channel_breakdown: () => channelBreakdown ? (
      <Card>
        <CardHeader><CardTitle>Channel Breakdown</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {Object.entries(channelBreakdown)
              .filter(([ch]) => ch !== "irrelevant")
              .sort(([, a], [, b]) => (b as number) - (a as number))
              .map(([channel, count]) => (
                <span key={channel} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${channelColors[channel] ?? "bg-muted text-muted-foreground"}`}>
                  <span className="capitalize">{channel}</span>
                  <span className="tabular-nums">{count as number}</span>
                </span>
              ))}
          </div>
        </CardContent>
      </Card>
    ) : null,

    activity_trend: () => (
      <Card>
        <CardHeader><CardTitle>Activity Trend</CardTitle></CardHeader>
        <CardContent>
          {trend.length > 0
            ? <TrendChart data={trend} />
            : <p className="py-12 text-center text-xs text-muted-foreground">No trend data available yet.</p>}
        </CardContent>
      </Card>
    ),

    target_progress: () => targets.length > 0 ? (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {targets.map((tva) => (
          <Card key={tva.metricType}>
            <CardHeader><CardTitle className="capitalize">{tva.metricType.replace(/_/g, " ")}</CardTitle></CardHeader>
            <CardContent>
              <TargetGauge label={tva.metricType.replace(/_/g, " ")} actual={tva.actual} target={tva.target} />
            </CardContent>
          </Card>
        ))}
      </div>
    ) : null,

    pending_meetings: () => (
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
                <Inbox className="h-5 w-5 text-amber-400" />
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Pending Reviews</p>
                <p className="text-2xl font-bold text-foreground tabular-nums">{pendingCount ?? 0}</p>
              </div>
            </div>
            <Link href="/meetings" className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-primary hover:bg-primary/10 transition-colors">
              Review now <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </CardContent>
      </Card>
    ),

    top_performers: () => topPerformers.length > 0 ? (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2"><Trophy className="h-4 w-4 text-amber-400" />Leaderboard</CardTitle>
            <Link href="/team" className="text-xs text-muted-foreground hover:text-primary transition-colors">View all</Link>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2.5">
            {topPerformers.map((rep, idx) => {
              const progress = rep.targetVsActual.find((t) => t.metricType === "total_meetings");
              const pct = progress && progress.target > 0 ? Math.round((progress.actual / progress.target) * 100) : null;
              return (
                <div key={rep.userId} className="flex items-center gap-3 rounded-md px-2 py-1.5">
                  <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                    idx === 0 ? "bg-amber-500/15 text-amber-400" : idx === 1 ? "bg-zinc-400/15 text-zinc-400" : idx === 2 ? "bg-orange-600/15 text-orange-500" : "bg-white/[0.04] text-muted-foreground"
                  )}>{idx + 1}</span>
                  <p className="flex-1 min-w-0 text-xs font-medium text-foreground truncate">{rep.userName}</p>
                  <span className="text-sm font-bold text-foreground tabular-nums">{rep.totalClassified}</span>
                  {pct !== null && (
                    <span className={cn("text-[10px] font-semibold tabular-nums w-10 text-right",
                      pct >= 80 ? "text-emerald-400" : pct >= 50 ? "text-amber-400" : "text-red-400"
                    )}>{pct}%</span>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    ) : null,

    pipeline_summary: () => conversionRates.length > 0 ? (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-primary" />Pipeline Overview</CardTitle>
            <Link href="/conversion" className="text-xs text-muted-foreground hover:text-primary transition-colors">Details</Link>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {conversionRates.map((cr) => (
              <div key={`${cr.fromStage}-${cr.toStage}`} className="flex items-center gap-3">
                <p className="flex-1 min-w-0 text-xs text-muted-foreground truncate">{cr.fromStageLabel} → {cr.toStageLabel}</p>
                <span className="text-xs text-muted-foreground tabular-nums">{cr.dealCount} deals</span>
                <span className={cn("text-xs font-semibold tabular-nums w-12 text-right",
                  cr.rate >= 0.6 ? "text-emerald-400" : cr.rate >= 0.3 ? "text-amber-400" : "text-red-400"
                )}>{Math.round(cr.rate * 100)}%</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    ) : null,

    data_quality: () => warnings.length > 0 ? (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Data Quality Warnings</CardTitle>
            <Link href="/data-quality" className="text-xs text-muted-foreground hover:text-primary transition-colors">View all</Link>
          </div>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2.5">
            {warnings.map((w) => (
              <li key={w.id} className="flex items-start gap-3">
                <Badge variant={severityVariant[w.severity] ?? "secondary"} className="mt-0.5 shrink-0 text-[10px]">{w.severity}</Badge>
                <div>
                  <p className="text-xs font-medium text-foreground">{w.title}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{w.description}</p>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    ) : null,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end gap-3">
        {analyticsFetching && !analyticsLoading && (
          <span className="text-xs text-muted-foreground animate-pulse">Updating...</span>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setEditMode(!editMode)}
          aria-label="Customize dashboard"
          className={cn(
            editMode && "bg-primary/10 text-primary"
          )}
        >
          <Settings2 className="mr-1.5 h-3.5 w-3.5" />
          Customize
        </Button>
      </div>

      {editMode && (
        <CustomizePanel
          availableWidgets={availableWidgets}
          enabledWidgets={layout.widgets}
          onToggle={toggleWidget}
          onMove={moveWidget}
          onReset={resetLayout}
          onClose={() => setEditMode(false)}
        />
      )}

      {layout.widgets.map((widgetId) => {
        const renderer = widgets[widgetId];
        if (!renderer) return null;
        const content = renderer();
        if (!content) return null;
        return <div key={widgetId}>{content}</div>;
      })}

      {layout.widgets.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Settings2 className="h-10 w-10 mb-3 opacity-30" />
          <p className="text-sm">No widgets enabled.</p>
          <p className="text-xs mt-1">Click "Customize" to add widgets to your dashboard.</p>
        </div>
      )}
    </div>
  );
}

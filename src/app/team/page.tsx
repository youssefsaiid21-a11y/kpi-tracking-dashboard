"use client";

import React, { useState, useMemo } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSession } from "@/lib/hooks/useSession";
import { useDateRange } from "@/lib/hooks/useDateRange";
import { useTeamOverview } from "@/lib/hooks/useApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { KPICard } from "@/components/charts/kpi-card";

const RepComparison = dynamic(() => import("@/components/charts/rep-comparison").then((m) => m.RepComparison), {
  ssr: false,
  loading: () => <div className="h-[280px] animate-pulse rounded-lg bg-card border border-white/[0.04]" />,
});
import { cn, formatNumber } from "@/lib/utils";
import type {
  RepPerformance,
} from "@/types";
import {
  Users,
  PhoneOutgoing,
  Handshake,
  BarChart3,
  ArrowUpDown,
  ShieldAlert,
  AlertTriangle,
  Info,
} from "lucide-react";

type SortKey =
  | "userName"
  | "totalClassified"
  | "classificationRate"
  | "targetProgress"
  | "status";

type SortDir = "asc" | "desc";

function getRepStatus(rep: RepPerformance): "on_track" | "behind" | "at_risk" {
  if (!rep.targetVsActual.length) return "on_track";
  const avgVariance =
    rep.targetVsActual.reduce((sum, t) => sum + t.variancePercent, 0) /
    rep.targetVsActual.length;
  if (avgVariance >= 0) return "on_track";
  if (avgVariance >= -20) return "at_risk";
  return "behind";
}

function getTargetProgress(rep: RepPerformance): number {
  if (!rep.targetVsActual.length) return 100;
  return Math.round(
    rep.targetVsActual.reduce(
      (sum, t) => sum + (t.target > 0 ? (t.actual / t.target) * 100 : 100),
      0
    ) / rep.targetVsActual.length
  );
}

const statusOrder = { on_track: 0, at_risk: 1, behind: 2 };

function SkeletonCard() {
  return (
    <div className="h-28 animate-pulse rounded-lg border bg-card" />
  );
}

function SkeletonRow() {
  return (
    <tr className="animate-pulse border-b">
      {Array.from({ length: 6 }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 w-20 rounded bg-muted" />
        </td>
      ))}
    </tr>
  );
}

function SortHeader({
  label,
  field,
  sortKey,
  sortDir,
  onSort,
}: {
  label: string;
  field: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  return (
    <th
      className="cursor-pointer select-none px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
      onClick={() => onSort(field)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown className="h-3 w-3" />
        {sortKey === field && (
          <span className="text-foreground">{sortDir === "asc" ? "^" : "v"}</span>
        )}
      </span>
    </th>
  );
}

export default function TeamPage() {
  const { user, isLoading: sessionLoading } = useSession();
  const { dateRange } = useDateRange();
  const [sortKey, setSortKey] = useState<SortKey>("totalClassified");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const role = user?.role;
  const canView = role === "manager" || role === "admin";

  const { data: teamResponse, isLoading: teamLoading, error: teamError, refetch: refetchTeam } =
    useTeamOverview(dateRange, !sessionLoading && canView);

  const data = teamResponse?.data?.overview ?? null;
  const recommendations = teamResponse?.data?.recommendations ?? [];
  const loading = sessionLoading || teamLoading;
  const error = teamError ? (teamError instanceof Error ? teamError.message : "Failed to fetch team analytics") : null;

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sortedReps = useMemo(() => {
    if (!data) return [];
    const reps = [...data.repPerformance];
    reps.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "userName":
          cmp = a.userName.localeCompare(b.userName);
          break;
        case "totalClassified":
          cmp = a.totalClassified - b.totalClassified;
          break;
        case "classificationRate":
          cmp = a.classificationRate - b.classificationRate;
          break;
        case "targetProgress":
          cmp = getTargetProgress(a) - getTargetProgress(b);
          break;
        case "status":
          cmp = statusOrder[getRepStatus(a)] - statusOrder[getRepStatus(b)];
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return reps;
  }, [data, sortKey, sortDir]);

  const repComparisonData = useMemo(() => {
    if (!data) return [];
    return data.repPerformance.map((r) => {
      const sorted = Object.entries(r.channelBreakdown)
        .filter(([ch]) => ch !== "irrelevant")
        .sort(([, a], [, b]) => (b as number) - (a as number));
      return {
        name: r.userName,
        totalClassified: r.totalClassified,
        topChannel: sorted[0]?.[0] ?? "none",
        topChannelCount: (sorted[0]?.[1] as number) ?? 0,
        target: r.targetVsActual[0]?.target,
      };
    });
  }, [data]);

  if (sessionLoading || !user) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    );
  }

  if (user.role === "rep") {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <ShieldAlert className="mb-4 h-12 w-12 text-muted-foreground" />
        <h2 className="text-xl font-semibold">Access Denied</h2>
        <p className="mt-2 text-muted-foreground">
          Team analytics is only available to managers and administrators.
        </p>
        <Link
          href="/dashboard"
          className="mt-4 inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Go to Dashboard
        </Link>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <AlertTriangle className="mb-4 h-12 w-12 text-destructive" />
        <h2 className="text-xl font-semibold">Error</h2>
        <p className="mt-2 text-muted-foreground">{error}</p>
        <Button variant="outline" className="mt-4" onClick={() => refetchTeam()}>
          Try Again
        </Button>
      </div>
    );
  }

  const severityIcon = (severity: string) => {
    switch (severity) {
      case "critical":
        return <ShieldAlert className="h-4 w-4 text-red-500" />;
      case "warning":
        return <AlertTriangle className="h-4 w-4 text-amber-500" />;
      default:
        return <Info className="h-4 w-4 text-blue-500" />;
    }
  };

  const categoryLabel = (cat: string) => {
    switch (cat) {
      case "volume":
        return "Volume";
      case "conversion":
        return "Conversion";
      case "rep_performance":
        return "Rep Performance";
      case "channel_mix":
        return "Channel Mix";
      case "pacing":
        return "Pacing";
      default:
        return cat;
    }
  };

  return (
    <div className="space-y-8">
      {/* KPI Summary Cards */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : data ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <KPICard
            title="Total Classified"
            value={formatNumber(data.totalClassified)}
            icon={<BarChart3 className="h-5 w-5" />}
          />
          <KPICard
            title="Total Meetings"
            value={formatNumber(data.totalMeetings)}
            icon={<PhoneOutgoing className="h-5 w-5" />}
          />
          <KPICard
            title="Avg Classification Rate"
            value={`${(data.averageClassificationRate * 100).toFixed(1)}%`}
            icon={<Handshake className="h-5 w-5" />}
            variant={
              data.averageClassificationRate >= 0.8
                ? "success"
                : data.averageClassificationRate >= 0.5
                ? "warning"
                : "destructive"
            }
          />
        </div>
      ) : null}

      {/* Rep Comparison Chart */}
      {loading ? (
        <div className="h-[400px] animate-pulse rounded-lg border bg-card" />
      ) : data && data.repPerformance.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-5 w-5" />
              Rep Comparison
            </CardTitle>
          </CardHeader>
          <CardContent>
            <RepComparison
              data={repComparisonData}
            />
          </CardContent>
        </Card>
      ) : null}

      {/* Per-Rep Performance Table */}
      {loading ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Per-Rep Performance</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full">
              <tbody>
                {Array.from({ length: 4 }).map((_, i) => (
                  <SkeletonRow key={i} />
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : data && data.repPerformance.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Per-Rep Performance</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <SortHeader label="Rep Name" field="userName" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <SortHeader label="Classified" field="totalClassified" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Top Channels</th>
                  <SortHeader label="Classification Rate" field="classificationRate" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <SortHeader label="Target Progress" field="targetProgress" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <SortHeader label="Status" field="status" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                </tr>
              </thead>
              <tbody>
                {sortedReps.map((rep) => {
                  const status = getRepStatus(rep);
                  const progress = getTargetProgress(rep);
                  return (
                    <tr
                      key={rep.userId}
                      className="border-b transition-colors hover:bg-muted/50"
                    >
                      <td className="px-4 py-3 font-medium">{rep.userName}</td>
                      <td className="px-4 py-3">{rep.totalClassified}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(rep.channelBreakdown)
                            .filter(([ch, count]) => ch !== "irrelevant" && (count as number) > 0)
                            .sort(([, a], [, b]) => (b as number) - (a as number))
                            .slice(0, 3)
                            .map(([ch, count]) => (
                              <span key={ch} className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium capitalize">
                                {ch} {count as number}
                              </span>
                            ))}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {(rep.classificationRate * 100).toFixed(1)}%
                      </td>
                      <td className="px-4 py-3">{progress}%</td>
                      <td className="px-4 py-3">
                        {status === "on_track" && (
                          <Badge variant="success">On Track</Badge>
                        )}
                        {status === "at_risk" && (
                          <Badge variant="warning">At Risk</Badge>
                        )}
                        {status === "behind" && (
                          <Badge variant="destructive">Behind</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : (
        !loading && (
          <Card>
            <CardContent className="py-12 text-center">
              <Users className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
              <p className="text-muted-foreground">No rep data available yet.</p>
            </CardContent>
          </Card>
        )
      )}

      {/* Strategy Recommendations */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg border bg-card" />
          ))}
        </div>
      ) : recommendations.length > 0 ? (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Strategy Recommendations</h2>
          <div className="space-y-3">
            {recommendations.map((rec) => (
              <Card
                key={rec.id}
                className={cn(
                  "shadow-sm",
                  rec.severity === "critical" &&
                    "border-red-200 dark:border-red-800",
                  rec.severity === "warning" &&
                    "border-amber-200 dark:border-amber-800",
                  rec.severity === "info" &&
                    "border-blue-200 dark:border-blue-800"
                )}
              >
                <CardContent className="flex items-start gap-3 p-4">
                  <div className="mt-0.5">{severityIcon(rec.severity)}</div>
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{rec.title}</p>
                      <Badge variant="outline" className="text-[10px]">
                        {categoryLabel(rec.category)}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {rec.description}
                    </p>
                    {rec.currentValue !== undefined &&
                      rec.requiredValue !== undefined && (
                        <p className="text-xs text-muted-foreground">
                          Current:{" "}
                          <span className="font-semibold text-foreground">
                            {rec.currentValue}
                          </span>{" "}
                          | Required:{" "}
                          <span className="font-semibold text-foreground">
                            {rec.requiredValue}
                          </span>
                        </p>
                      )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

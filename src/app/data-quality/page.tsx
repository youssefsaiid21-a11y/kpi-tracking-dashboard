"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useSession } from "@/lib/hooks/useSession";
import { useAnomalies, useResolveAnomaly } from "@/lib/hooks/useApi";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/hooks/useApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { AnomalySummary } from "@/types";
import {
  ShieldAlert,
  AlertTriangle,
  Info,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Filter,
} from "lucide-react";

interface AnomalyRecord extends AnomalySummary {
  isResolved: boolean;
  resolvedAt?: string;
}

const typeLabels: Record<string, string> = {
  unclassified: "Unclassified",
  duplicate: "Duplicate",
  spike: "Spike",
  impossible_rate: "Impossible Rate",
  missing_owner: "Missing Owner",
  sync_failure: "Sync Failure",
  low_confidence: "Low Confidence",
  internal_leak: "Internal Leak",
};

function severityIcon(severity: string) {
  switch (severity) {
    case "critical":
      return <ShieldAlert className="h-5 w-5 text-red-500" />;
    case "warning":
      return <AlertTriangle className="h-5 w-5 text-amber-500" />;
    default:
      return <Info className="h-5 w-5 text-blue-500" />;
  }
}

function anomalyCardBorder(severity: string) {
  switch (severity) {
    case "critical":
      return "border-red-200 bg-red-50/40 dark:border-red-800 dark:bg-red-950/20";
    case "warning":
      return "border-amber-200 bg-amber-50/40 dark:border-amber-800 dark:bg-amber-950/20";
    default:
      return "border-blue-200 bg-blue-50/40 dark:border-blue-800 dark:bg-blue-950/20";
  }
}

function SkeletonCard() {
  return <div className="h-28 animate-pulse rounded-lg border bg-card" />;
}

export default function DataQualityPage() {
  const { user, isLoading: sessionLoading } = useSession();
  const canView = user?.role !== "rep";
  const queryClient = useQueryClient();

  const { data: anomalies = [], isLoading: queryLoading, error: queryError, refetch: refetchAnomalies } =
    useAnomalies(!sessionLoading && canView);
  const resolveMutation = useResolveAnomaly();

  const loading = sessionLoading || queryLoading;
  const error = queryError ? (queryError instanceof Error ? queryError.message : "Failed to fetch anomaly data") : null;
  const resolveError = resolveMutation.error ? (resolveMutation.error instanceof Error ? resolveMutation.error.message : "Failed to resolve") : null;

  const [filterType, setFilterType] = useState<string>("all");
  const [filterSeverity, setFilterSeverity] = useState<string>("all");
  const [showResolved, setShowResolved] = useState(false);

  const handleResolve = (id: string) => {
    // Optimistic update: immediately mark as resolved in cache
    queryClient.setQueryData(queryKeys.anomalies(), (old: any) => {
      if (!old) return old;
      return {
        ...old,
        data: (old.data ?? []).map((a: any) =>
          a.id === id ? { ...a, isResolved: true, resolvedAt: new Date().toISOString() } : a
        ),
      };
    });
    resolveMutation.mutate(id);
  };
  const resolvingId = resolveMutation.isPending ? (resolveMutation.variables as string) : null;

  const activeAnomalies = useMemo(() => {
    return anomalies
      .filter((a) => !a.isResolved)
      .filter((a) => filterType === "all" || a.type === filterType)
      .filter((a) => filterSeverity === "all" || a.severity === filterSeverity);
  }, [anomalies, filterType, filterSeverity]);

  const resolvedAnomalies = useMemo(() => {
    return anomalies.filter((a) => a.isResolved);
  }, [anomalies]);

  const criticalCount = anomalies.filter(
    (a) => !a.isResolved && a.severity === "critical"
  ).length;
  const warningCount = anomalies.filter(
    (a) => !a.isResolved && a.severity === "warning"
  ).length;
  const infoCount = anomalies.filter(
    (a) => !a.isResolved && a.severity === "info"
  ).length;

  const groupedAnomalies = useMemo(() => {
    const groups: Record<string, AnomalyRecord[]> = {
      critical: [],
      warning: [],
      info: [],
    };
    activeAnomalies.forEach((a) => {
      if (groups[a.severity]) {
        groups[a.severity].push(a);
      }
    });
    return groups;
  }, [activeAnomalies]);

  if (sessionLoading || !user) {
    return (
      <div className="space-y-4">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  if (user.role === "rep") {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <ShieldAlert className="mb-4 h-12 w-12 text-muted-foreground" />
        <h2 className="text-xl font-semibold">Access Denied</h2>
        <p className="mt-2 text-muted-foreground">
          Data quality monitoring is only available to managers and
          administrators.
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
        <Button variant="outline" className="mt-4" onClick={() => refetchAnomalies()}>
          Try Again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Summary Bar */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="border-red-200 shadow-sm dark:border-red-800">
            <CardContent className="flex items-center gap-3 p-4">
              <ShieldAlert className="h-8 w-8 text-red-500" />
              <div>
                <p className="text-2xl font-bold">{criticalCount}</p>
                <p className="text-xs text-muted-foreground">Critical</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-amber-200 shadow-sm dark:border-amber-800">
            <CardContent className="flex items-center gap-3 p-4">
              <AlertTriangle className="h-8 w-8 text-amber-500" />
              <div>
                <p className="text-2xl font-bold">{warningCount}</p>
                <p className="text-xs text-muted-foreground">Warnings</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-blue-200 shadow-sm dark:border-blue-800">
            <CardContent className="flex items-center gap-3 p-4">
              <Info className="h-8 w-8 text-blue-500" />
              <div>
                <p className="text-2xl font-bold">{infoCount}</p>
                <p className="text-xs text-muted-foreground">Info</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Resolve error */}
      {resolveError && (
        <div className="rounded-lg border border-red-200 bg-red-50/40 px-4 py-2 text-sm text-red-600 dark:border-red-800 dark:bg-red-950/20 dark:text-red-400">
          {resolveError}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Filter by type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {Object.entries(typeLabels).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterSeverity} onValueChange={setFilterSeverity}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Filter by severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Severities</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="warning">Warning</SelectItem>
            <SelectItem value="info">Info</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Anomaly List Grouped by Severity */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : activeAnomalies.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-green-500" />
            <p className="font-medium">All clear!</p>
            <p className="mt-1 text-sm text-muted-foreground">
              No active anomalies matching your filters.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {(["critical", "warning", "info"] as const).map((severity) => {
            const items = groupedAnomalies[severity];
            if (!items || items.length === 0) return null;
            return (
              <div key={severity} className="space-y-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide">
                  {severityIcon(severity)}
                  {severity === "critical"
                    ? "Critical"
                    : severity === "warning"
                    ? "Warnings"
                    : "Information"}
                  <Badge variant="outline" className="ml-1 text-[10px]">
                    {items.length}
                  </Badge>
                </h3>
                <div className="space-y-2">
                  {items.map((anomaly) => (
                    <Card
                      key={anomaly.id}
                      className={cn("shadow-sm", anomalyCardBorder(severity))}
                    >
                      <CardContent className="flex items-start justify-between gap-4 p-4">
                        <div className="flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className="text-[10px]">
                              {typeLabels[anomaly.type] ?? anomaly.type}
                            </Badge>
                            <p className="font-medium">{anomaly.title}</p>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {anomaly.description}
                          </p>
                          {anomaly.recommendedAction && (
                            <p className="text-xs text-muted-foreground">
                              Recommended:{" "}
                              <span className="font-medium text-foreground">
                                {anomaly.recommendedAction}
                              </span>
                            </p>
                          )}
                          <p className="text-[10px] text-muted-foreground">
                            {new Date(anomaly.createdAt).toLocaleDateString(
                              undefined,
                              {
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              }
                            )}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={resolvingId === anomaly.id}
                          onClick={() => handleResolve(anomaly.id)}
                        >
                          {resolvingId === anomaly.id
                            ? "Resolving..."
                            : "Resolve"}
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Resolved Anomalies (Collapsible) */}
      {resolvedAnomalies.length > 0 && (
        <div className="space-y-3">
          <button
            onClick={() => setShowResolved((v) => !v)}
            className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            {showResolved ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
            Resolved ({resolvedAnomalies.length})
          </button>
          {showResolved && (
            <div className="space-y-2">
              {resolvedAnomalies.map((anomaly) => (
                <Card
                  key={anomaly.id}
                  className="border-green-200 bg-green-50/20 shadow-sm dark:border-green-800 dark:bg-green-950/10"
                >
                  <CardContent className="flex items-start gap-3 p-4">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-green-500" />
                    <div className="flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">
                          {typeLabels[anomaly.type] ?? anomaly.type}
                        </Badge>
                        <p className="font-medium text-muted-foreground line-through">
                          {anomaly.title}
                        </p>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {anomaly.description}
                      </p>
                      {anomaly.resolvedAt && (
                        <p className="text-[10px] text-muted-foreground">
                          Resolved:{" "}
                          {new Date(anomaly.resolvedAt).toLocaleDateString(
                            undefined,
                            {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            }
                          )}
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

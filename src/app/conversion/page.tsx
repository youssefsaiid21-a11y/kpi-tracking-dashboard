"use client";

import React, { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const ConversionFunnel = dynamic(() => import("@/components/charts/conversion-funnel").then((m) => m.ConversionFunnel), {
  ssr: false,
  loading: () => <div className="h-[280px] animate-pulse rounded-lg bg-card border border-white/[0.04]" />,
});
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useDateRange } from "@/lib/hooks/useDateRange";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { StageConversion } from "@/types";
import { GitBranch, ArrowRightLeft, TrendingUp, Percent, AlertTriangle, Loader2 } from "lucide-react";

interface ConversionData {
  pipelines?: { id: string; name: string }[];
  stages: { label: string; dealCount: number; rate?: number }[];
  conversionRates: StageConversion[];
  totalDeals?: number;
  periodComparison?: {
    current: StageConversion[];
    previous: StageConversion[];
  };
}

interface ConversionResponse {
  success: boolean;
  data: ConversionData;
}

function SkeletonBlock({ height = "h-64" }: { height?: string }) {
  return <div className={`${height} animate-pulse rounded-lg border bg-card`} />;
}

function rateColor(rate: number) {
  if (rate > 60) return "text-green-600 dark:text-green-400";
  if (rate >= 30) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function rateBg(rate: number) {
  if (rate > 60)
    return "bg-green-50 dark:bg-green-950/30";
  if (rate >= 30)
    return "bg-amber-50 dark:bg-amber-950/30";
  return "bg-red-50 dark:bg-red-950/30";
}

export default function ConversionPage() {
  const { dateRange } = useDateRange();
  const [selectedPipeline, setSelectedPipeline] = useState<string>("");
  const userChangedPipeline = useRef(false);

  const { data, isLoading: loading, error: queryError, refetch } = useQuery({
    queryKey: ["conversion", dateRange.period, dateRange.start.toISOString(), dateRange.end.toISOString(), selectedPipeline],
    queryFn: ({ signal }) =>
      api.get<ConversionResponse>("/api/analytics/conversion", {
        period: dateRange.period,
        startDate: dateRange.start.toISOString(),
        endDate: dateRange.end.toISOString(),
        ...(selectedPipeline ? { pipelineId: selectedPipeline } : {}),
      }, signal),
    select: (res) => res.data,
  });

  // Auto-select first pipeline when data loads and user hasn't manually changed it
  React.useEffect(() => {
    if (
      data?.pipelines &&
      data.pipelines.length > 0 &&
      !selectedPipeline &&
      !userChangedPipeline.current
    ) {
      setSelectedPipeline(data.pipelines[0].id);
    }
  }, [data, selectedPipeline]);

  const handlePipelineChange = (value: string) => {
    userChangedPipeline.current = true;
    setSelectedPipeline(value);
  };

  const error = queryError
    ? queryError instanceof Error
      ? queryError.message
      : "Failed to load conversion data"
    : null;

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <AlertTriangle className="mb-4 h-12 w-12 text-destructive" />
        <h2 className="text-xl font-semibold">Error</h2>
        <p className="mt-2 text-muted-foreground">{error}</p>
        <Button variant="outline" className="mt-4" onClick={() => refetch()}>
          Try Again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Pipeline Selector */}
      {data?.pipelines && data.pipelines.length > 1 && (
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-muted-foreground">
            Pipeline:
          </label>
          <Select value={selectedPipeline} onValueChange={handlePipelineChange}>
            <SelectTrigger className="w-60">
              <SelectValue placeholder="Select pipeline" />
            </SelectTrigger>
            <SelectContent>
              {data.pipelines.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Conversion Funnel */}
      {loading ? (
        <SkeletonBlock height="h-[380px]" />
      ) : data && data.stages.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <GitBranch className="h-5 w-5" />
              Conversion Funnel
              {data.totalDeals !== undefined && (
                <span className="ml-auto text-xs font-normal text-muted-foreground">
                  {data.totalDeals} total deals (incl. lost)
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ConversionFunnel stages={data.stages} height={320} />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <GitBranch className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-muted-foreground">
              No pipeline data available. Connect HubSpot to see conversion
              analytics.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Cumulative Conversion (from top of funnel) */}
      {loading ? (
        <SkeletonBlock />
      ) : data && data.conversionRates.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Percent className="h-5 w-5" />
              Cumulative Conversion
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                % of all deals reaching each stage
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Stage
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Deals Reached
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    % of All Deals
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Drop-off
                  </th>
                </tr>
              </thead>
              <tbody>
                {/* First row: entry stage (always 100%) */}
                {data.conversionRates.length > 0 && (
                  <tr className="border-b transition-colors hover:bg-muted/50">
                    <td className="px-4 py-3 font-medium">
                      {data.conversionRates[0].fromStageLabel}
                    </td>
                    <td className="px-4 py-3">
                      {data.conversionRates[0].fromCount}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        "inline-block rounded px-2 py-0.5 text-xs font-semibold",
                        rateColor(100), rateBg(100)
                      )}>
                        100.0%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">-</td>
                  </tr>
                )}
                {data.conversionRates.map((conv, i) => {
                  const cumPercent = conv.cumulativeRate * 100;
                  const prevCumPercent = i === 0
                    ? 100
                    : data.conversionRates[i - 1].cumulativeRate * 100;
                  const dropoff = prevCumPercent - cumPercent;
                  return (
                    <tr
                      key={i}
                      className="border-b transition-colors hover:bg-muted/50"
                    >
                      <td className="px-4 py-3 font-medium">
                        {conv.toStageLabel}
                      </td>
                      <td className="px-4 py-3">{conv.dealCount}</td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "inline-block rounded px-2 py-0.5 text-xs font-semibold",
                            rateColor(cumPercent),
                            rateBg(cumPercent)
                          )}
                        >
                          {cumPercent.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {dropoff > 0 ? (
                          <span className="text-xs text-red-500 dark:text-red-400">
                            -{dropoff.toFixed(1)}pp
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">0.0pp</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}

      {/* Stage-to-Stage Conversion (bottleneck view) */}
      {loading ? (
        <SkeletonBlock />
      ) : data && data.conversionRates.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ArrowRightLeft className="h-5 w-5" />
              Stage-to-Stage Conversion
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                shows where the funnel leaks
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    From Stage
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    To Stage
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Conversion Rate
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Deals In
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Deals Out
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.conversionRates.map((conv, i) => {
                  const ratePercent = conv.rate * 100;
                  return (
                    <tr
                      key={i}
                      className="border-b transition-colors hover:bg-muted/50"
                    >
                      <td className="px-4 py-3 font-medium">
                        {conv.fromStageLabel}
                      </td>
                      <td className="px-4 py-3">{conv.toStageLabel}</td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "inline-block rounded px-2 py-0.5 text-xs font-semibold",
                            rateColor(ratePercent),
                            rateBg(ratePercent)
                          )}
                        >
                          {ratePercent.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-4 py-3">{conv.fromCount}</td>
                      <td className="px-4 py-3">{conv.dealCount}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}

      {/* Period Comparison */}
      {loading ? (
        <SkeletonBlock />
      ) : data?.periodComparison &&
        data.periodComparison.current.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-5 w-5" />
              Period Comparison
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Stage Transition
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Current Period
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Previous Period
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Change
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.periodComparison.current.map((cur, i) => {
                  const prev = data.periodComparison!.previous.find(
                    (p) => p.fromStage === cur.fromStage && p.toStage === cur.toStage
                  );
                  const curPercent = cur.rate * 100;
                  const prevPercent = prev ? prev.rate * 100 : 0;
                  const change = curPercent - prevPercent;
                  return (
                    <tr
                      key={i}
                      className="border-b transition-colors hover:bg-muted/50"
                    >
                      <td className="px-4 py-3 font-medium">
                        {cur.fromStageLabel} → {cur.toStageLabel}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "inline-block rounded px-2 py-0.5 text-xs font-semibold",
                            rateColor(curPercent),
                            rateBg(curPercent)
                          )}
                        >
                          {curPercent.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-muted-foreground">
                          {prevPercent.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "text-sm font-medium",
                            change > 0
                              ? "text-green-600 dark:text-green-400"
                              : change < 0
                              ? "text-red-600 dark:text-red-400"
                              : "text-muted-foreground"
                          )}
                        >
                          {change > 0 ? "+" : ""}
                          {change.toFixed(1)}pp
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

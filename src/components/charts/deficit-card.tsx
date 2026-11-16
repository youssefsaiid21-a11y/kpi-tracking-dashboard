"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { DeficitAnalysis } from "@/types";

interface DeficitCardProps {
  analysis: DeficitAnalysis;
  metricLabel: string;
}

export function DeficitCard({ analysis, metricLabel }: DeficitCardProps) {
  const onTrack = analysis.deficit <= 0;

  return (
    <Card
      className={cn(
        "relative overflow-hidden",
        onTrack
          ? "border-emerald-500/20"
          : "border-red-500/20"
      )}
    >
      {/* Top accent line */}
      <div className={cn(
        "absolute top-0 left-0 right-0 h-[2px]",
        onTrack ? "bg-emerald-500" : "bg-red-500"
      )} />

      <CardHeader className="pb-3">
        <CardTitle className="text-sm">
          {metricLabel}{" "}
          <span className={cn(
            "text-xs font-medium ml-1",
            onTrack ? "text-emerald-400" : "text-red-400"
          )}>
            {onTrack ? "On Track" : "Behind Target"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Current vs Target */}
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="rounded-lg bg-white/[0.03] p-2.5">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Current</p>
            <p className="text-lg font-bold tabular-nums">{analysis.currentActual}</p>
          </div>
          <div className="rounded-lg bg-white/[0.03] p-2.5">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Target</p>
            <p className="text-lg font-bold tabular-nums">{analysis.target}</p>
          </div>
          <div className="rounded-lg bg-white/[0.03] p-2.5">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Deficit</p>
            <p className={cn(
              "text-lg font-bold tabular-nums",
              onTrack ? "text-emerald-400" : "text-red-400"
            )}>
              {onTrack ? 0 : analysis.deficit}
            </p>
          </div>
        </div>

        {/* Required Pace */}
        {!onTrack && (
          <div className="rounded-lg bg-red-500/5 border border-red-500/10 p-3">
            <p className="text-xs text-foreground">
              Need{" "}
              <span className="font-bold text-red-400">
                {analysis.requiredDailyPace.toFixed(1)}/day
              </span>{" "}
              over{" "}
              <span className="font-semibold">
                {analysis.remainingBusinessDays} business days
              </span>{" "}
              remaining
            </p>
          </div>
        )}

        {/* Scenarios */}
        {!onTrack && (
          <div>
            <p className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              Recovery Scenarios
            </p>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-white/[0.03] border border-white/[0.04] p-2 text-center">
                <p className="text-[10px] text-muted-foreground">Volume +20%</p>
                <p className="text-sm font-bold tabular-nums">{analysis.scenarioIfVolumeUp}</p>
              </div>
              <div className="rounded-lg bg-white/[0.03] border border-white/[0.04] p-2 text-center">
                <p className="text-[10px] text-muted-foreground">Conv +20%</p>
                <p className="text-sm font-bold tabular-nums">{analysis.scenarioIfConversionUp}</p>
              </div>
              <div className="rounded-lg bg-white/[0.03] border border-white/[0.04] p-2 text-center">
                <p className="text-[10px] text-muted-foreground">Both +20%</p>
                <p className="text-sm font-bold tabular-nums">{analysis.scenarioIfBothUp}</p>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

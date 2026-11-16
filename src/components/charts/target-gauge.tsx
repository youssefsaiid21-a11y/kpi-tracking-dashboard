"use client";

import React from "react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface TargetGaugeProps {
  label: string;
  actual: number;
  target: number;
  unit?: string;
}

export function TargetGauge({ label, actual, target, unit = "" }: TargetGaugeProps) {
  const percentage = target > 0 ? Math.round((actual / target) * 100) : 0;
  const clamped = Math.min(percentage, 100);

  const colorClass =
    percentage >= 80
      ? "text-emerald-400"
      : percentage >= 50
      ? "text-amber-400"
      : "text-red-400";

  const indicatorColor =
    percentage >= 80
      ? "[&>div]:bg-emerald-500"
      : percentage >= 50
      ? "[&>div]:bg-amber-500"
      : "[&>div]:bg-red-500";

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground">{label}</span>
        <span className={cn("text-xs font-bold tabular-nums", colorClass)}>
          {percentage}%
        </span>
      </div>
      <Progress value={clamped} className={cn("h-1.5", indicatorColor)} />
      <p className="text-[11px] text-muted-foreground tabular-nums">
        {actual}
        {unit} / {target}
        {unit}
      </p>
    </div>
  );
}

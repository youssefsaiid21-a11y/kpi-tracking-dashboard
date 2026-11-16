"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface KPICardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: number;
  icon?: React.ReactNode;
  variant?: "default" | "success" | "warning" | "destructive";
}

const accentColors: Record<string, string> = {
  default: "bg-primary",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  destructive: "bg-red-500",
};

const glowColors: Record<string, string> = {
  default: "",
  success: "hover:shadow-[0_0_20px_-4px_hsl(160_84%_39%/0.2)]",
  warning: "hover:shadow-[0_0_20px_-4px_hsl(38_92%_50%/0.2)]",
  destructive: "hover:shadow-[0_0_20px_-4px_hsl(0_72%_51%/0.2)]",
};

export function KPICard({
  title,
  value,
  subtitle,
  trend,
  icon,
  variant = "default",
}: KPICardProps) {
  const trendIsPositive = trend !== undefined && trend >= 0;
  const trendIsNegative = trend !== undefined && trend < 0;

  return (
    <div className={cn(
      "relative overflow-hidden rounded-lg bg-card border border-white/[0.04] shadow-surface transition-all duration-300",
      glowColors[variant],
      "hover:border-white/[0.08]"
    )}>
      {/* Left accent bar */}
      <div className={cn("absolute left-0 top-0 bottom-0 w-[3px]", accentColors[variant])} />

      <div className="p-5 pl-6">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
            <div className="flex items-baseline gap-2.5">
              <p className="text-2xl font-bold tracking-tight text-foreground">{value}</p>
              {trend !== undefined && (
                <span
                  className={cn(
                    "inline-flex items-center text-xs font-semibold rounded-md px-1.5 py-0.5",
                    trendIsPositive && "text-emerald-400 bg-emerald-400/10",
                    trendIsNegative && "text-red-400 bg-red-400/10"
                  )}
                >
                  {trendIsPositive ? (
                    <svg className="mr-0.5 h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                    </svg>
                  ) : (
                    <svg className="mr-0.5 h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  )}
                  {Math.abs(trend).toFixed(1)}%
                </span>
              )}
            </div>
            {subtitle && (
              <p className="text-[11px] text-muted-foreground">{subtitle}</p>
            )}
          </div>
          {icon && (
            <div className="text-muted-foreground/50">{icon}</div>
          )}
        </div>
      </div>
    </div>
  );
}

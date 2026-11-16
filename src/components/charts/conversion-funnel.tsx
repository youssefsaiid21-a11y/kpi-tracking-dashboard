"use client";

import React, { useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LabelList,
} from "recharts";

interface FunnelStage {
  label: string;
  dealCount: number;
  rate?: number;
}

interface ConversionFunnelProps {
  stages: FunnelStage[];
  height?: number;
  defaultMultiColor?: boolean;
}

// Blue gradient from bright to subtle (single-hue mode)
const FUNNEL_COLORS = [
  "hsl(217 91% 60%)",
  "hsl(217 80% 55%)",
  "hsl(217 65% 48%)",
  "hsl(217 50% 40%)",
  "hsl(217 40% 32%)",
  "hsl(217 30% 26%)",
];

// Distinct colors for multi-color mode — each bar is visually unique
const MULTI_COLORS = [
  "hsl(217 91% 60%)",  // Blue
  "hsl(160 84% 39%)",  // Teal / Green
  "hsl(38 92% 50%)",   // Amber / Orange
  "hsl(280 68% 55%)",  // Purple
  "hsl(350 80% 55%)",  // Rose / Red
  "hsl(190 90% 45%)",  // Cyan
  "hsl(100 60% 45%)",  // Lime
  "hsl(30 95% 55%)",   // Orange
];

function getColor(index: number, total: number, multiColor: boolean): string {
  if (multiColor) {
    return MULTI_COLORS[index % MULTI_COLORS.length];
  }
  const colorIndex = Math.min(
    Math.floor((index / Math.max(total - 1, 1)) * (FUNNEL_COLORS.length - 1)),
    FUNNEL_COLORS.length - 1
  );
  return FUNNEL_COLORS[colorIndex];
}

export function ConversionFunnel({ stages, height = 300, defaultMultiColor = false }: ConversionFunnelProps) {
  const [multiColor, setMultiColor] = useState(defaultMultiColor);
  const chartData = stages.map((stage, index) => ({
    ...stage,
    conversionLabel:
      stage.rate !== undefined
        ? `${(stage.rate * 100).toFixed(1)}%`
        : index > 0 && stages[index - 1].dealCount > 0
        ? `${((stage.dealCount / stages[index - 1].dealCount) * 100).toFixed(1)}%`
        : undefined,
  }));

  return (
    <div className="w-full">
      <div className="flex items-center justify-end px-4 mb-2">
        <button
          type="button"
          onClick={() => setMultiColor((v) => !v)}
          className={
            "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors " +
            (multiColor
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border bg-transparent text-muted-foreground hover:text-foreground hover:border-foreground/20")
          }
        >
          <span
            className="inline-flex gap-0.5"
            aria-hidden="true"
          >
            <span className="h-2 w-2 rounded-full" style={{ background: MULTI_COLORS[0] }} />
            <span className="h-2 w-2 rounded-full" style={{ background: MULTI_COLORS[1] }} />
            <span className="h-2 w-2 rounded-full" style={{ background: MULTI_COLORS[2] }} />
          </span>
          Multi-color
        </button>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 8, right: 60, left: 100, bottom: 8 }}
        >
          <XAxis
            type="number"
            tick={{ fontSize: 11, fill: "hsl(220 10% 50%)" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            tick={{ fontSize: 11, fill: "hsl(220 10% 50%)" }}
            axisLine={false}
            tickLine={false}
            width={90}
          />
          <Tooltip
            contentStyle={{
              borderRadius: "8px",
              border: "1px solid hsl(240 4% 16%)",
              backgroundColor: "hsl(240 5% 10%)",
              color: "hsl(220 14% 90%)",
              fontSize: "12px",
              boxShadow: "0 8px 32px -4px rgba(0,0,0,0.5)",
            }}
            formatter={(value: number) => [value, "Deals"]}
          />
          <Bar dataKey="dealCount" radius={[0, 4, 4, 0]} barSize={24}>
            {chartData.map((_, index) => (
              <Cell
                key={`cell-${index}`}
                fill={getColor(index, chartData.length, multiColor)}
              />
            ))}
            <LabelList
              dataKey="dealCount"
              position="right"
              style={{ fontSize: 11, fontWeight: 600, fill: "hsl(220 14% 90%)" }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {multiColor && (
        <div className="flex items-center justify-center gap-3 px-4 mt-1 flex-wrap">
          {chartData.map((stage, index) => (
            <span key={index} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ background: getColor(index, chartData.length, true) }}
              />
              {stage.label}
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center justify-center gap-4 px-4 mt-2 flex-wrap">
        {chartData.map(
          (stage, index) =>
            index > 0 &&
            stage.conversionLabel && (
              <span key={index} className="text-[11px] text-muted-foreground">
                {stages[index - 1].label} → {stage.label}:{" "}
                <span className="font-semibold text-foreground">
                  {stage.conversionLabel}
                </span>
              </span>
            )
        )}
      </div>
    </div>
  );
}

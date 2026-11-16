"use client";

import React from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  ScatterChart,
  Scatter,
  ComposedChart,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
} from "recharts";
import type { ChartConfig } from "@/types";

// ─── Props ────────────────────────────────────────────────

interface ChartRendererProps {
  config: ChartConfig;
  data: Record<string, unknown>[];
  isLoading?: boolean;
  height?: number;
}

// ─── Palette ──────────────────────────────────────────────

const FALLBACK_COLORS = [
  "hsl(210 80% 55%)",
  "hsl(150 60% 50%)",
  "hsl(280 60% 60%)",
  "hsl(40 90% 55%)",
  "hsl(330 70% 55%)",
  "hsl(190 70% 50%)",
];

// ─── Shared styles ────────────────────────────────────────

const TICK_STYLE = { fontSize: 11, fill: "hsl(220 10% 50%)" } as const;

const TOOLTIP_CONTENT_STYLE = {
  borderRadius: "8px",
  border: "1px solid hsl(240 4% 16%)",
  backgroundColor: "hsl(240 5% 10%)",
  color: "hsl(220 14% 90%)",
  fontSize: "12px",
  boxShadow: "0 8px 32px -4px rgba(0,0,0,0.5)",
} as const;

const GRID_STROKE = "hsl(240 4% 16%)";

// ─── Helpers ──────────────────────────────────────────────

function seriesColor(index: number, explicit?: string): string {
  return explicit || FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

// ─── Component ────────────────────────────────────────────

export default function ChartRenderer({
  config,
  data,
  isLoading,
  height,
}: ChartRendererProps) {
  const resolvedHeight = height ?? config.options?.height ?? 350;

  // Loading state
  if (isLoading) {
    return (
      <div
        className="animate-pulse rounded-lg bg-card border border-white/[0.04]"
        style={{ height: resolvedHeight }}
      />
    );
  }

  // Empty state
  if (!data || data.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-white/[0.04] text-muted-foreground text-sm"
        style={{ height: resolvedHeight }}
      >
        No data
      </div>
    );
  }

  const { chartType, xAxisKey, series, options } = config;
  const showGrid = options?.showGrid !== false;
  const showLegend = options?.showLegend !== false;
  const stacked = options?.stacked;
  const dualAxis = options?.dualAxis;

  // ── Shared axis / grid / tooltip / legend elements ────

  function commonElements(swapAxes = false) {
    const elements: React.ReactNode[] = [];

    if (showGrid) {
      elements.push(
        <CartesianGrid
          key="grid"
          strokeDasharray="3 3"
          stroke={GRID_STROKE}
        />
      );
    }

    if (swapAxes) {
      // horizontal_bar: category axis is Y, value axis is X
      elements.push(
        <YAxis
          key="y"
          dataKey={xAxisKey}
          type="category"
          tick={TICK_STYLE}
          axisLine={false}
          tickLine={false}
        />
      );
      elements.push(
        <XAxis
          key="x"
          type="number"
          tick={TICK_STYLE}
          axisLine={false}
          tickLine={false}
        />
      );
    } else {
      elements.push(
        <XAxis
          key="x"
          dataKey={xAxisKey}
          tick={TICK_STYLE}
          axisLine={false}
          tickLine={false}
        />
      );
      elements.push(
        <YAxis
          key="y"
          tick={TICK_STYLE}
          axisLine={false}
          tickLine={false}
        />
      );
      if (dualAxis) {
        elements.push(
          <YAxis
            key="y-right"
            yAxisId="right"
            orientation="right"
            tick={TICK_STYLE}
            axisLine={false}
            tickLine={false}
          />
        );
      }
    }

    elements.push(
      <Tooltip key="tooltip" contentStyle={TOOLTIP_CONTENT_STYLE} />
    );

    if (showLegend) {
      elements.push(
        <Legend key="legend" wrapperStyle={{ fontSize: "12px" }} />
      );
    }

    return elements;
  }

  // ── Chart-type switch ─────────────────────────────────

  function renderChart(): React.ReactNode {
    switch (chartType) {
      // ── Line ─────────────────────────────────────────
      case "line":
        return (
          <LineChart data={data}>
            {commonElements()}
            {series.map((s, i) => (
              <Line
                key={s.dataKey}
                type="monotone"
                dataKey={s.dataKey}
                name={s.label}
                stroke={seriesColor(i, s.color)}
                dot={false}
                strokeWidth={2}
                yAxisId={s.yAxisId}
              />
            ))}
          </LineChart>
        );

      // ── Area ─────────────────────────────────────────
      case "area":
        return (
          <AreaChart data={data}>
            {commonElements()}
            {series.map((s, i) => (
              <Area
                key={s.dataKey}
                type="monotone"
                dataKey={s.dataKey}
                name={s.label}
                stroke={seriesColor(i, s.color)}
                fill={seriesColor(i, s.color)}
                fillOpacity={0.15}
                strokeWidth={2}
                stackId={stacked ? "a" : undefined}
                yAxisId={s.yAxisId}
              />
            ))}
          </AreaChart>
        );

      // ── Bar ──────────────────────────────────────────
      case "bar":
        return (
          <BarChart data={data}>
            {commonElements()}
            {series.map((s, i) => (
              <Bar
                key={s.dataKey}
                dataKey={s.dataKey}
                name={s.label}
                fill={seriesColor(i, s.color)}
                stackId={stacked ? "a" : undefined}
                radius={[4, 4, 0, 0]}
                yAxisId={s.yAxisId}
              />
            ))}
          </BarChart>
        );

      // ── Horizontal bar ───────────────────────────────
      case "horizontal_bar":
        return (
          <BarChart data={data} layout="vertical">
            {commonElements(true)}
            {series.map((s, i) => (
              <Bar
                key={s.dataKey}
                dataKey={s.dataKey}
                name={s.label}
                fill={seriesColor(i, s.color)}
                stackId={stacked ? "a" : undefined}
                radius={[4, 4, 0, 0]}
                yAxisId={s.yAxisId}
              />
            ))}
          </BarChart>
        );

      // ── Scatter ──────────────────────────────────────
      case "scatter":
        return (
          <ScatterChart>
            {commonElements()}
            {series.map((s, i) => (
              <Scatter
                key={s.dataKey}
                name={s.label}
                data={data}
                dataKey={s.dataKey}
                fill={seriesColor(i, s.color)}
              />
            ))}
          </ScatterChart>
        );

      // ── Composed ─────────────────────────────────────
      case "composed":
        return (
          <ComposedChart data={data}>
            {commonElements()}
            {series.map((s, i) => {
              const color = seriesColor(i, s.color);
              const key = s.dataKey;

              switch (s.chartType) {
                case "bar":
                  return (
                    <Bar
                      key={key}
                      dataKey={s.dataKey}
                      name={s.label}
                      fill={color}
                      radius={[4, 4, 0, 0]}
                      yAxisId={s.yAxisId}
                    />
                  );
                case "area":
                  return (
                    <Area
                      key={key}
                      type="monotone"
                      dataKey={s.dataKey}
                      name={s.label}
                      stroke={color}
                      fill={color}
                      fillOpacity={0.15}
                      strokeWidth={2}
                      yAxisId={s.yAxisId}
                    />
                  );
                case "line":
                default:
                  return (
                    <Line
                      key={key}
                      type="monotone"
                      dataKey={s.dataKey}
                      name={s.label}
                      stroke={color}
                      dot={false}
                      strokeWidth={2}
                      yAxisId={s.yAxisId}
                    />
                  );
              }
            })}
          </ComposedChart>
        );

      // ── Pie ──────────────────────────────────────────
      case "pie":
        if (series.length === 0) return <p className="py-8 text-center text-xs text-muted-foreground">No series configured for pie chart.</p>;
        return (
          <PieChart>
            <Pie
              data={data}
              dataKey={series[0].dataKey}
              nameKey={xAxisKey}
              cx="50%"
              cy="50%"
              outerRadius="75%"
              label
            >
              {data.map((_, i) => (
                <Cell
                  key={`cell-${i}`}
                  fill={FALLBACK_COLORS[i % FALLBACK_COLORS.length]}
                />
              ))}
            </Pie>
            <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} />
            {showLegend && (
              <Legend wrapperStyle={{ fontSize: "12px" }} />
            )}
          </PieChart>
        );

      // ── Radar ────────────────────────────────────────
      case "radar":
        return (
          <RadarChart data={data} cx="50%" cy="50%" outerRadius="75%">
            <PolarGrid stroke={GRID_STROKE} />
            <PolarAngleAxis dataKey={xAxisKey} tick={TICK_STYLE} />
            <PolarRadiusAxis tick={TICK_STYLE} />
            {series.map((s, i) => (
              <Radar
                key={s.dataKey}
                name={s.label}
                dataKey={s.dataKey}
                stroke={seriesColor(i, s.color)}
                fill={seriesColor(i, s.color)}
                fillOpacity={0.15}
              />
            ))}
            <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} />
            {showLegend && (
              <Legend wrapperStyle={{ fontSize: "12px" }} />
            )}
          </RadarChart>
        );

      default: {
        const _exhaustive: never = chartType;
        return (
          <div className="flex items-center justify-center text-muted-foreground text-sm h-full">
            Unsupported chart type: {_exhaustive}
          </div>
        );
      }
    }
  }

  return (
    <ResponsiveContainer width="100%" height={resolvedHeight}>
      {renderChart() as React.ReactElement}
    </ResponsiveContainer>
  );
}

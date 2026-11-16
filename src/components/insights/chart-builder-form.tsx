"use client";

import React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Plus, X } from "lucide-react";
import type { ChartConfig, ChartType, DataSourceId } from "@/types";
import {
  DATA_SOURCES,
  CHART_TYPE_OPTIONS,
  getDataSourceMeta,
  PALETTE,
} from "./data-source-config";

interface ChartBuilderFormProps {
  config: ChartConfig;
  onConfigChange: (config: ChartConfig) => void;
}

export function ChartBuilderForm({
  config,
  onConfigChange,
}: ChartBuilderFormProps) {
  const meta = getDataSourceMeta(config.dataSource);

  function handleDataSourceChange(value: string) {
    const newMeta = getDataSourceMeta(value as DataSourceId);
    if (!newMeta) return;

    onConfigChange({
      ...config,
      dataSource: value as DataSourceId,
      chartType: newMeta.defaultChartType,
      xAxisKey: newMeta.xAxisKey,
      series: newMeta.defaultSeries.map((s) => ({ ...s })),
    });
  }

  function handleChartTypeChange(chartType: ChartType) {
    onConfigChange({ ...config, chartType });
  }

  function handleSeriesFieldChange(index: number, dataKey: string) {
    const field = meta?.availableFields.find((f) => f.key === dataKey);
    const updated = [...config.series];
    updated[index] = {
      ...updated[index],
      dataKey,
      label: field?.label ?? dataKey,
    };
    onConfigChange({ ...config, series: updated });
  }

  function handleSeriesLabelChange(index: number, label: string) {
    const updated = [...config.series];
    updated[index] = { ...updated[index], label };
    onConfigChange({ ...config, series: updated });
  }

  function handleSeriesColorChange(index: number, color: string) {
    const updated = [...config.series];
    updated[index] = { ...updated[index], color };
    onConfigChange({ ...config, series: updated });
  }

  function addSeries() {
    if (!meta) return;
    const usedKeys = new Set(config.series.map((s) => s.dataKey));
    const nextField = meta.availableFields.find((f) => !usedKeys.has(f.key));
    if (!nextField) return;

    const color = PALETTE[config.series.length % PALETTE.length];
    onConfigChange({
      ...config,
      series: [
        ...config.series,
        { dataKey: nextField.key, label: nextField.label, color },
      ],
    });
  }

  function removeSeries(index: number) {
    if (config.series.length <= 1) return;
    const updated = config.series.filter((_, i) => i !== index);
    onConfigChange({ ...config, series: updated });
  }

  function handleOptionChange(
    key: "stacked" | "showLegend" | "showGrid",
    value: boolean
  ) {
    onConfigChange({
      ...config,
      options: { ...config.options, [key]: value },
    });
  }

  return (
    <div className="space-y-4 text-sm">
      {/* Data Source */}
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1 block">
          Data Source
        </label>
        <Select value={config.dataSource} onValueChange={handleDataSourceChange}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DATA_SOURCES.map((ds) => (
              <SelectItem key={ds.id} value={ds.id} className="text-xs">
                {ds.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {meta && (
          <p className="text-xs text-muted-foreground mt-1">
            {meta.description}
          </p>
        )}
      </div>

      {/* Chart Type */}
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1 block">
          Chart Type
        </label>
        <div className="flex flex-wrap gap-1">
          {CHART_TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleChartTypeChange(opt.value)}
              className={`rounded-md px-2 py-1 text-xs border transition-colors ${
                config.chartType === opt.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-foreground border-input hover:bg-accent"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Series */}
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1 block">
          Series
        </label>
        <div className="space-y-2">
          {config.series.map((s, i) => (
            <div key={i} className="flex items-center gap-1.5">
              {/* Field select */}
              <Select
                value={s.dataKey}
                onValueChange={(v) => handleSeriesFieldChange(i, v)}
              >
                <SelectTrigger className="h-7 text-xs flex-1 min-w-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {meta?.availableFields.map((f) => (
                    <SelectItem key={f.key} value={f.key} className="text-xs">
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Label input */}
              <input
                type="text"
                value={s.label}
                onChange={(e) => handleSeriesLabelChange(i, e.target.value)}
                className="h-7 w-24 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="Label"
              />

              {/* Color input */}
              <input
                type="color"
                value={hslToHex(s.color)}
                onChange={(e) =>
                  handleSeriesColorChange(i, e.target.value)
                }
                className="h-7 w-7 shrink-0 cursor-pointer rounded border border-input bg-background p-0.5"
              />

              {/* Remove */}
              <button
                type="button"
                onClick={() => removeSeries(i)}
                disabled={config.series.length <= 1}
                className="h-7 w-7 shrink-0 flex items-center justify-center rounded-md border border-input text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30 disabled:pointer-events-none"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2 h-7 text-xs"
          onClick={addSeries}
          disabled={
            !meta ||
            config.series.length >= meta.availableFields.length
          }
        >
          <Plus className="h-3 w-3 mr-1" />
          Add series
        </Button>
      </div>

      {/* Options */}
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1 block">
          Options
        </label>
        <div className="space-y-1.5">
          {(
            [
              ["stacked", "Stacked"],
              ["showLegend", "Show Legend"],
              ["showGrid", "Show Grid"],
            ] as const
          ).map(([key, label]) => (
            <label
              key={key}
              className="flex items-center gap-2 text-xs cursor-pointer"
            >
              <input
                type="checkbox"
                checked={config.options?.[key] ?? (key !== "stacked")}
                onChange={(e) => handleOptionChange(key, e.target.checked)}
                className="h-3.5 w-3.5 rounded border-input accent-primary"
              />
              {label}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Best-effort conversion of an HSL string to hex for the color input.
 * Falls back to the raw value if parsing fails.
 */
function hslToHex(hsl: string): string {
  // If already hex, return as-is
  if (hsl.startsWith("#")) return hsl;

  const match = hsl.match(
    /hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)/
  );
  if (!match) return "#3b82f6";

  const h = parseFloat(match[1]) / 360;
  const s = parseFloat(match[2]) / 100;
  const l = parseFloat(match[3]) / 100;

  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  const toHex = (x: number) =>
    Math.round(x * 255)
      .toString(16)
      .padStart(2, "0");

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

import type { DataSourceId, ChartType, ChartSeriesConfig } from "@/types";

export interface DataSourceMeta {
  id: DataSourceId;
  label: string;
  description: string;
  defaultChartType: ChartType;
  xAxisKey: string;
  xAxisLabel: string;
  availableFields: { key: string; label: string }[];
  defaultSeries: ChartSeriesConfig[];
}

const CHANNEL_COLORS: Record<string, string> = {
  partnerships: "hsl(280 60% 60%)",
  conferences: "hsl(40 90% 55%)",
  referrals: "hsl(150 60% 50%)",
  linkedin: "hsl(210 80% 55%)",
  email: "hsl(190 70% 50%)",
  inbound: "hsl(330 70% 55%)",
  total: "hsl(220 70% 60%)",
};

export const DATA_SOURCES: DataSourceMeta[] = [
  {
    id: "channel_breakdown",
    label: "Meetings by Channel",
    description: "Meeting counts broken down by outreach channel",
    defaultChartType: "bar",
    xAxisKey: "channel",
    xAxisLabel: "Channel",
    availableFields: [{ key: "count", label: "Meeting Count" }],
    defaultSeries: [{ dataKey: "count", label: "Meetings", color: CHANNEL_COLORS.total }],
  },
  {
    id: "weekly_trend",
    label: "Weekly Trend",
    description: "Meeting counts per channel over time (weekly)",
    defaultChartType: "area",
    xAxisKey: "date",
    xAxisLabel: "Week",
    availableFields: [
      { key: "total", label: "Total" },
      { key: "partnerships", label: "Partnerships" },
      { key: "conferences", label: "Conferences" },
      { key: "referrals", label: "Referrals" },
      { key: "linkedin", label: "LinkedIn" },
      { key: "email", label: "Email" },
      { key: "inbound", label: "Inbound" },
    ],
    defaultSeries: [
      { dataKey: "total", label: "Total Meetings", color: CHANNEL_COLORS.total },
    ],
  },
  {
    id: "conversion_funnel",
    label: "Conversion Rates",
    description: "Stage-to-stage pipeline conversion rates",
    defaultChartType: "bar",
    xAxisKey: "label",
    xAxisLabel: "Stage Transition",
    availableFields: [
      { key: "rate", label: "Conversion Rate" },
      { key: "dealCount", label: "Deal Count" },
    ],
    defaultSeries: [{ dataKey: "rate", label: "Conversion Rate", color: "hsl(210 80% 55%)" }],
  },
  {
    id: "target_vs_actual",
    label: "Target vs Actual",
    description: "Compare actual metrics against targets",
    defaultChartType: "bar",
    xAxisKey: "metricLabel",
    xAxisLabel: "Metric",
    availableFields: [
      { key: "target", label: "Target" },
      { key: "actual", label: "Actual" },
      { key: "deficit", label: "Deficit" },
    ],
    defaultSeries: [
      { dataKey: "target", label: "Target", color: "hsl(220 10% 50%)" },
      { dataKey: "actual", label: "Actual", color: "hsl(210 80% 55%)" },
    ],
  },
  {
    id: "rep_performance",
    label: "Rep Performance",
    description: "Per-rep meeting counts and metrics",
    defaultChartType: "bar",
    xAxisKey: "userName",
    xAxisLabel: "Rep",
    availableFields: [
      { key: "totalClassified", label: "Total Classified" },
      { key: "pendingReview", label: "Pending Review" },
      { key: "classificationRate", label: "Classification Rate" },
      { key: "partnerships", label: "Partnerships" },
      { key: "conferences", label: "Conferences" },
      { key: "referrals", label: "Referrals" },
      { key: "linkedin", label: "LinkedIn" },
      { key: "email", label: "Email" },
      { key: "inbound", label: "Inbound" },
    ],
    defaultSeries: [
      { dataKey: "totalClassified", label: "Total Classified", color: "hsl(210 80% 55%)" },
    ],
  },
  {
    id: "deal_pipeline",
    label: "Deals by Stage",
    description: "Deal count and total value grouped by pipeline stage",
    defaultChartType: "bar",
    xAxisKey: "stage",
    xAxisLabel: "Pipeline Stage",
    availableFields: [
      { key: "dealCount", label: "Deal Count" },
      { key: "totalValue", label: "Total Value ($)" },
    ],
    defaultSeries: [{ dataKey: "dealCount", label: "Deals", color: "hsl(210 80% 55%)" }],
  },
  {
    id: "deal_timeline",
    label: "Deal Creation Timeline",
    description: "New deals created per week",
    defaultChartType: "line",
    xAxisKey: "week",
    xAxisLabel: "Week",
    availableFields: [
      { key: "count", label: "Deals Created" },
      { key: "value", label: "Total Value ($)" },
    ],
    defaultSeries: [{ dataKey: "count", label: "Deals Created", color: "hsl(150 60% 50%)" }],
  },
  {
    id: "classification_rate",
    label: "Classification Rate Over Time",
    description: "Meeting review completion rate per week",
    defaultChartType: "line",
    xAxisKey: "week",
    xAxisLabel: "Week",
    availableFields: [
      { key: "rate", label: "Classification Rate" },
      { key: "eligible", label: "Eligible Meetings" },
      { key: "reviewed", label: "Reviewed Meetings" },
    ],
    defaultSeries: [{ dataKey: "rate", label: "Classification Rate", color: "hsl(280 60% 60%)" }],
  },
];

export function getDataSourceMeta(id: DataSourceId): DataSourceMeta | undefined {
  return DATA_SOURCES.find((ds) => ds.id === id);
}

export const CHART_TYPE_OPTIONS: { value: ChartType; label: string }[] = [
  { value: "line", label: "Line" },
  { value: "area", label: "Area" },
  { value: "bar", label: "Bar" },
  { value: "horizontal_bar", label: "Horizontal Bar" },
  { value: "scatter", label: "Scatter" },
  { value: "composed", label: "Combo (Line + Bar)" },
  { value: "pie", label: "Pie" },
  { value: "radar", label: "Radar" },
];

export const PALETTE = [
  "hsl(210 80% 55%)", "hsl(150 60% 50%)", "hsl(280 60% 60%)",
  "hsl(40 90% 55%)", "hsl(330 70% 55%)", "hsl(190 70% 50%)",
  "hsl(0 70% 55%)", "hsl(60 70% 50%)",
];

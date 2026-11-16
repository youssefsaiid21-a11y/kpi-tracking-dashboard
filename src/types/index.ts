// ─── Enums ─────────────────────────────────────────────────

export type UserRole = 'rep' | 'manager' | 'admin';

export type MeetingChannel = "partnerships" | "conferences" | "referrals" | "linkedin" | "email" | "inbound" | "repeat_meeting" | "irrelevant";

/** @deprecated Use MeetingChannel instead */
export type MeetingClassification = MeetingChannel;

/** @deprecated Use MeetingChannel instead – source is now encoded in the channel */
export type MeetingSource = 'linkedin' | 'email' | 'referral' | 'partner' | 'other';

export type MeetingStatus = 'pending' | 'completed' | 'cancelled' | 'noshow';

export type MetricType = 'total_meetings' | 'linkedin_meetings' | 'email_meetings' | 'partnerships_meetings' | 'conferences_meetings' | 'referrals_meetings' | 'inbound_meetings' | 'repeat_meeting_meetings' | 'conversion_rate';

export type TimePeriod = 'weekly' | 'monthly' | 'quarterly' | 'all_time' | 'custom';

export type AnomalySeverity = 'info' | 'warning' | 'critical';

export type AnomalyType =
  | 'unclassified'
  | 'duplicate'
  | 'spike'
  | 'impossible_rate'
  | 'missing_owner'
  | 'sync_failure'
  | 'low_confidence'
  | 'internal_leak';

export type SyncProvider = 'microsoft_graph' | 'hubspot';

// ─── Classification ────────────────────────────────────────

export interface ClassificationSignal {
  type: string;
  value: string;
  weight: number;
  description: string;
}

export interface PartnerEvidence {
  referral: boolean;
  attendeeMatch: boolean;
  hubspotSource: boolean;
  manualTag: boolean;
}

// ─── KPI Types ─────────────────────────────────────────────

export interface KPIMetrics {
  channelBreakdown: Record<MeetingChannel, number>;
  totalClassified: number;
  totalMeetings: number;
  classificationRate: number;
  conversionRates: StageConversion[];
}

export interface StageConversion {
  fromStage: string;
  toStage: string;
  fromStageLabel: string;
  toStageLabel: string;
  rate: number;          // stage-to-stage: deals_reaching_B / deals_reaching_A
  cumulativeRate: number; // from top of funnel: deals_reaching_stage / total_deals (incl. lost)
  dealCount: number;     // deals that reached this "to" stage
  fromCount: number;     // deals that reached the "from" stage
}

export interface TargetVsActual {
  metricType: MetricType;
  target: number;
  actual: number;
  variance: number;
  variancePercent: number;
  deficit: number;
  onTrack: boolean;
  requiredPace: number;
  remainingDays: number;
}

export interface DeficitAnalysis {
  currentActual: number;
  target: number;
  deficit: number;
  requiredAdditionalMeetings: number;
  requiredDailyPace: number;
  remainingBusinessDays: number;
  scenarioIfVolumeUp: number;
  scenarioIfConversionUp: number;
  scenarioIfBothUp: number;
}

// ─── Dashboard Types ───────────────────────────────────────

export interface RepPerformance {
  userId: string;
  userName: string;
  channelBreakdown: Record<MeetingChannel, number>;
  totalClassified: number;
  totalReviewed: number;
  pendingReview: number;
  classificationRate: number;
  targetVsActual: TargetVsActual[];
  trend: TrendPoint[];
}

export interface TrendPoint {
  date: string;
  channels: Record<MeetingChannel, number>;
  total: number;
  /** @deprecated Backward compat — sum of linkedin + email */
  outbound: number;
  /** @deprecated Backward compat — partnerships channel count */
  partner: number;
}

export interface TeamOverview {
  channelBreakdown: Record<MeetingChannel, number>;
  totalClassified: number;
  totalMeetings: number;
  averageClassificationRate: number;
  teamTarget: TargetVsActual[];
  repPerformance: RepPerformance[];
  topWarnings: AnomalySummary[];
  trend: TrendPoint[];
}

export interface AnomalySummary {
  id: string;
  type: AnomalyType;
  severity: AnomalySeverity;
  title: string;
  description: string;
  recommendedAction?: string;
  createdAt: string;
}

// ─── Strategy Recommendations ──────────────────────────────

export interface StrategyRecommendation {
  id: string;
  category: 'volume' | 'conversion' | 'rep_performance' | 'channel_mix' | 'pacing';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  description: string;
  metric?: string;
  currentValue?: number;
  requiredValue?: number;
}

// ─── API Response Types ────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: {
    total?: number;
    page?: number;
    pageSize?: number;
  };
}

// ─── Custom Chart Builder ─────────────────────────────────

export type ChartType = "line" | "area" | "bar" | "horizontal_bar" | "scatter" | "composed" | "pie" | "radar";

export type DataSourceId =
  | "channel_breakdown"
  | "weekly_trend"
  | "conversion_funnel"
  | "target_vs_actual"
  | "rep_performance"
  | "deal_pipeline"
  | "deal_timeline"
  | "classification_rate";

export interface ChartSeriesConfig {
  dataKey: string;
  label: string;
  color: string;
  chartType?: ChartType;
  yAxisId?: "left" | "right";
}

export interface ChartConfig {
  dataSource: DataSourceId;
  chartType: ChartType;
  title: string;
  xAxisKey: string;
  xAxisLabel?: string;
  yAxisLabel?: string;
  series: ChartSeriesConfig[];
  filters?: {
    userId?: string;
    channels?: MeetingChannel[];
    pipelineId?: string;
  };
  options?: {
    stacked?: boolean;
    showLegend?: boolean;
    showGrid?: boolean;
    height?: number;
    dualAxis?: boolean;
    yAxisRightLabel?: string;
  };
}

// ─── Date Range Filter ────────────────────────────────────

export interface DateRange {
  start: Date;
  end: Date;
  period: TimePeriod;
  label: string;
}

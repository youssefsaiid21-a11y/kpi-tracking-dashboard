import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import {
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfQuarter,
  endOfQuarter,
  differenceInBusinessDays,
  format,
} from "date-fns";
import type { DateRange, TimePeriod } from "@/types";
import { CHANNEL_LABELS } from "@/constants";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** @deprecated Use tenant.internalDomains instead. Kept for backward compatibility. */
export const INTERNAL_DOMAIN = process.env.INTERNAL_DOMAIN || "company.example";

export function isInternalEmail(email: string, internalDomains?: string[]): boolean {
  if (internalDomains && internalDomains.length > 0) {
    const lower = email.toLowerCase();
    return internalDomains.some((d) => lower.endsWith(`@${d.toLowerCase()}`));
  }
  return email.toLowerCase().endsWith(`@${INTERNAL_DOMAIN}`);
}

export function getDateRange(period: TimePeriod, customStart?: Date, customEnd?: Date): DateRange {
  const now = new Date();
  switch (period) {
    case "weekly":
      return {
        start: startOfWeek(now, { weekStartsOn: 1 }),
        end: endOfWeek(now, { weekStartsOn: 1 }),
        period,
        label: `Week of ${format(startOfWeek(now, { weekStartsOn: 1 }), "MMM d")}`,
      };
    case "monthly":
      return {
        start: startOfMonth(now),
        end: endOfMonth(now),
        period,
        label: format(now, "MMMM yyyy"),
      };
    case "quarterly":
      return {
        start: startOfQuarter(now),
        end: endOfQuarter(now),
        period,
        label: `Q${Math.ceil((now.getMonth() + 1) / 3)} ${now.getFullYear()}`,
      };
    case "all_time":
      return {
        start: new Date("2020-01-01"),
        end: now,
        period,
        label: "All Time",
      };
    case "custom":
      return {
        start: customStart || startOfMonth(now),
        end: customEnd || now,
        period,
        label: `${format(customStart || startOfMonth(now), "MMM d")} - ${format(customEnd || now, "MMM d, yyyy")}`,
      };
    default:
      // Fall back to monthly for invalid period values
      return {
        start: startOfMonth(now),
        end: endOfMonth(now),
        period: "monthly",
        label: format(now, "MMMM yyyy"),
      };
  }
}

export function getRemainingBusinessDays(endDate: Date): number {
  return Math.max(0, differenceInBusinessDays(endDate, new Date()));
}

export function formatPercent(value: number, decimals = 1): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

export function classificationLabelDisplay(label: string): string {
  // Use CHANNEL_LABELS as single source of truth (includes repeat_meeting)
  if (CHANNEL_LABELS[label]) return CHANNEL_LABELS[label];
  // Legacy labels (backward compat)
  switch (label) {
    case "discovery_call": return "Discovery Call";
    case "partnership_lead": return "Partnership Lead";
    default: return label;
  }
}

/** Numeric severity for sorting (higher = more severe). */
export function severityOrder(severity: string): number {
  switch (severity) {
    case "critical": return 3;
    case "warning": return 2;
    case "info": return 1;
    default: return 0;
  }
}

export function severityColor(severity: string): string {
  switch (severity) {
    case "critical": return "text-red-600 bg-red-50 border-red-200";
    case "warning": return "text-amber-600 bg-amber-50 border-amber-200";
    case "info": return "text-blue-600 bg-blue-50 border-blue-200";
    default: return "text-gray-600 bg-gray-50 border-gray-200";
  }
}

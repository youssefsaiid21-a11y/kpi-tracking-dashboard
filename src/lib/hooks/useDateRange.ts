"use client";

import { createContext, useContext } from "react";
import type { DateRange, TimePeriod } from "@/types";

export interface DateRangeContextValue {
  dateRange: DateRange;
  setPeriod: (period: TimePeriod, start?: Date, end?: Date) => void;
}

export const DateRangeContext = createContext<DateRangeContextValue | null>(null);

export function useDateRange(): DateRangeContextValue {
  const ctx = useContext(DateRangeContext);
  if (!ctx) {
    throw new Error("useDateRange must be used within a DateRangeProvider");
  }
  return ctx;
}

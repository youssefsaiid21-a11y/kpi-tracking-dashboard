"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { TimePeriod } from "@/types";

interface PeriodSelectorProps {
  currentPeriod: TimePeriod;
  onChange: (period: TimePeriod, customStart?: Date, customEnd?: Date) => void;
}

const periodLabels: Record<TimePeriod, string> = {
  weekly: "This Week",
  monthly: "This Month",
  quarterly: "This Quarter",
  all_time: "All Time",
  custom: "Custom",
};

export function PeriodSelector({ currentPeriod, onChange }: PeriodSelectorProps) {
  const [open, setOpen] = useState(false);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const handleSelect = (period: TimePeriod) => {
    if (period !== "custom") {
      onChange(period);
      setOpen(false);
    }
    // Custom dates are handled by handleCustomApply
  };

  const [dateError, setDateError] = useState("");

  const handleCustomApply = () => {
    setDateError("");
    if (customStart && customEnd) {
      const start = new Date(customStart);
      const end = new Date(customEnd);
      if (start > end) {
        setDateError("Start date must be before end date");
        return;
      }
      onChange("custom", start, end);
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-label="Select time period"
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-secondary px-3 py-1.5 text-xs font-medium text-foreground transition-all hover:bg-white/[0.06] hover:border-white/10"
      >
        <span>{periodLabels[currentPeriod]}</span>
        <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <>
          {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
            onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
            role="presentation"
            aria-hidden="true"
          />
          <div role="listbox" aria-label="Time period options" className="absolute right-0 top-full z-20 mt-1.5 w-52 rounded-lg border border-white/[0.06] bg-popover p-1 shadow-lg shadow-black/30 animate-fade-in">
            {(Object.keys(periodLabels) as TimePeriod[])
              .filter((p) => p !== "custom")
              .map((period) => (
                <button
                  key={period}
                  role="option"
                  aria-selected={currentPeriod === period}
                  onClick={() => handleSelect(period)}
                  className={`flex w-full items-center rounded-md px-3 py-1.5 text-xs transition-colors ${
                    currentPeriod === period
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-foreground hover:bg-white/[0.04]"
                  }`}
                >
                  {periodLabels[period]}
                </button>
              ))}

            {/* Custom date range */}
            <div className="border-t border-white/[0.04] mt-1 pt-1">
              <p className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                Custom Range
              </p>
              <div className="space-y-2 px-3 pb-2">
                <div>
                  <label htmlFor="period-start" className="text-[10px] text-muted-foreground">Start</label>
                  <input
                    id="period-start"
                    type="date"
                    value={customStart}
                    onChange={(e) => setCustomStart(e.target.value)}
                    className="mt-0.5 w-full rounded-md border border-border bg-input px-2 py-1 text-xs text-foreground"
                  />
                </div>
                <div>
                  <label htmlFor="period-end" className="text-[10px] text-muted-foreground">End</label>
                  <input
                    id="period-end"
                    type="date"
                    value={customEnd}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    className="mt-0.5 w-full rounded-md border border-border bg-input px-2 py-1 text-xs text-foreground"
                  />
                </div>
                {dateError && (
                  <p className="text-[10px] text-red-400">{dateError}</p>
                )}
                <button
                  onClick={handleCustomApply}
                  disabled={!customStart || !customEnd}
                  className="w-full rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/85 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

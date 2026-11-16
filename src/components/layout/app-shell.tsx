"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { Sidebar } from "./sidebar";
import { PeriodSelector } from "./period-selector";
import { ErrorBoundary } from "./error-boundary";
import type { DateRange, TimePeriod } from "@/types";
import { getDateRange } from "@/lib/utils";
import { DateRangeContext } from "@/lib/hooks/useDateRange";

const pageTitles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/meetings": "Meetings",
  "/team": "Team Overview",
  "/conversion": "Pipeline Conversion",
  "/targets": "Targets & Goals",
  "/data-quality": "Data Quality",
  "/settings": "Settings",
  "/insights": "Insights",
  "/admin": "Administration",
};

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem("sidebar-collapsed") === "true";
    } catch {
      return false;
    }
  });
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    try {
      const saved = localStorage.getItem("selected-period") as TimePeriod | null;
      if (saved) return getDateRange(saved);
    } catch {}
    return getDateRange("weekly");
  });

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  useEffect(() => {
    try {
      localStorage.setItem("sidebar-collapsed", String(sidebarCollapsed));
    } catch {}
  }, [sidebarCollapsed]);

  useEffect(() => {
    try {
      localStorage.setItem("selected-period", dateRange.period);
    } catch {}
  }, [dateRange.period]);

  const pageTitle =
    Object.entries(pageTitles).find(([path]) =>
      pathname.startsWith(path)
    )?.[1] ?? "Dashboard";

  const handlePeriodChange = useCallback((period: TimePeriod, start?: Date, end?: Date) => {
    setDateRange(getDateRange(period, start, end));
  }, []);

  const dateRangeContextValue = useMemo(
    () => ({ dateRange, setPeriod: handlePeriodChange }),
    [dateRange, handlePeriodChange]
  );

  return (
    <DateRangeContext.Provider value={dateRangeContextValue}>
    <div className="min-h-screen bg-background noise">
      {/* Desktop sidebar */}
      <div className="hidden md:block">
        <Sidebar collapsed={sidebarCollapsed} onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)} />
      </div>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="relative z-50">
            <Sidebar />
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="fixed right-4 top-4 z-50 rounded-lg bg-card p-2 text-muted-foreground shadow-surface border border-white/[0.04]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* Main content */}
      <div className={`${sidebarCollapsed ? "md:pl-16" : "md:pl-60"} transition-all duration-200`}>
        {/* Header */}
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-white/[0.04] bg-background/80 px-4 backdrop-blur-xl md:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="rounded-lg p-2 text-muted-foreground hover:text-foreground hover:bg-white/[0.04] md:hidden transition-colors"
            >
              <Menu className="h-5 w-5" />
            </button>
            <h1 className="text-sm font-semibold text-foreground tracking-tight">
              {pageTitle}
            </h1>
          </div>

          <PeriodSelector
            currentPeriod={dateRange.period}
            onChange={handlePeriodChange}
          />
        </header>

        {/* Page content */}
        <main className="p-4 md:p-6">
          <ErrorBoundary>{children}</ErrorBoundary>
        </main>
      </div>
    </div>
    </DateRangeContext.Provider>
  );
}

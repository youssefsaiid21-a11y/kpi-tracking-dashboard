"use client";

import { useState, useCallback, useEffect } from "react";

export type WidgetId =
  | "kpi_cards"
  | "channel_breakdown"
  | "activity_trend"
  | "target_progress"
  | "data_quality"
  | "pending_meetings"
  | "top_performers"
  | "pipeline_summary";

export interface WidgetConfig {
  id: WidgetId;
  label: string;
  description: string;
  defaultEnabled: boolean;
  managerOnly?: boolean;
}

export const AVAILABLE_WIDGETS: WidgetConfig[] = [
  {
    id: "kpi_cards",
    label: "KPI Summary",
    description: "Key metrics at a glance",
    defaultEnabled: true,
  },
  {
    id: "channel_breakdown",
    label: "Channel Breakdown",
    description: "Meetings by source channel",
    defaultEnabled: true,
  },
  {
    id: "activity_trend",
    label: "Activity Trend",
    description: "Weekly meeting trend chart",
    defaultEnabled: true,
  },
  {
    id: "target_progress",
    label: "Target Progress",
    description: "Goals vs actual gauges",
    defaultEnabled: true,
  },
  {
    id: "pending_meetings",
    label: "Pending Reviews",
    description: "Meetings awaiting classification",
    defaultEnabled: true,
  },
  {
    id: "top_performers",
    label: "Leaderboard",
    description: "Top reps by classified meetings",
    defaultEnabled: true,
    managerOnly: true,
  },
  {
    id: "pipeline_summary",
    label: "Pipeline Summary",
    description: "Deal pipeline overview",
    defaultEnabled: true,
  },
  {
    id: "data_quality",
    label: "Data Quality",
    description: "Warnings and anomalies",
    defaultEnabled: true,
    managerOnly: true,
  },
];

const STORAGE_KEY = "kpi_dashboard_layout";

export interface DashboardLayout {
  /** Ordered list of enabled widget IDs */
  widgets: WidgetId[];
}

function getDefaultLayout(isManager: boolean): DashboardLayout {
  return {
    widgets: AVAILABLE_WIDGETS
      .filter((w) => w.defaultEnabled && (!w.managerOnly || isManager))
      .map((w) => w.id),
  };
}

function loadLayout(isManager: boolean): DashboardLayout {
  if (typeof window === "undefined") return getDefaultLayout(isManager);
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return getDefaultLayout(isManager);
    const parsed = JSON.parse(stored) as DashboardLayout;
    // Filter out manager-only widgets if not manager
    const filtered = parsed.widgets.filter((id) => {
      const config = AVAILABLE_WIDGETS.find((w) => w.id === id);
      return config && (!config.managerOnly || isManager);
    });
    return { widgets: filtered };
  } catch {
    return getDefaultLayout(isManager);
  }
}

export function useDashboardLayout(isManager: boolean) {
  const [layout, setLayout] = useState<DashboardLayout>(() =>
    loadLayout(isManager)
  );
  const [editMode, setEditMode] = useState(false);

  // Re-sync when role changes
  useEffect(() => {
    setLayout(loadLayout(isManager));
  }, [isManager]);

  const saveLayout = useCallback((newLayout: DashboardLayout) => {
    setLayout(newLayout);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newLayout));
    } catch {
      // Storage full or disabled
    }
  }, []);

  const toggleWidget = useCallback(
    (widgetId: WidgetId) => {
      setLayout((prev) => {
        const isEnabled = prev.widgets.includes(widgetId);
        const newWidgets = isEnabled
          ? prev.widgets.filter((id) => id !== widgetId)
          : [...prev.widgets, widgetId];
        const newLayout = { widgets: newWidgets };
        saveLayout(newLayout);
        return newLayout;
      });
    },
    [saveLayout]
  );

  const moveWidget = useCallback(
    (widgetId: WidgetId, direction: "up" | "down") => {
      setLayout((prev) => {
        const idx = prev.widgets.indexOf(widgetId);
        if (idx === -1) return prev;
        const newIdx = direction === "up" ? idx - 1 : idx + 1;
        if (newIdx < 0 || newIdx >= prev.widgets.length) return prev;
        const newWidgets = [...prev.widgets];
        [newWidgets[idx], newWidgets[newIdx]] = [newWidgets[newIdx], newWidgets[idx]];
        const newLayout = { widgets: newWidgets };
        saveLayout(newLayout);
        return newLayout;
      });
    },
    [saveLayout]
  );

  const resetLayout = useCallback(() => {
    const defaultLayout = getDefaultLayout(isManager);
    saveLayout(defaultLayout);
  }, [isManager, saveLayout]);

  const isWidgetEnabled = useCallback(
    (widgetId: WidgetId) => layout.widgets.includes(widgetId),
    [layout]
  );

  const availableWidgets = AVAILABLE_WIDGETS.filter(
    (w) => !w.managerOnly || isManager
  );

  return {
    layout,
    editMode,
    setEditMode,
    toggleWidget,
    moveWidget,
    resetLayout,
    isWidgetEnabled,
    availableWidgets,
  };
}

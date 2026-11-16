"use client";

import { useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { useDateRange } from "@/lib/hooks/useDateRange";
import { useInsightsData, useSavedCharts, useSaveChart, useDeleteChart } from "@/lib/hooks/useApi";
import { SavedChartsGrid } from "@/components/insights/saved-charts-grid";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const ChartRenderer = dynamic(() => import("@/components/insights/chart-renderer"), {
  ssr: false,
  loading: () => <div className="h-[280px] animate-pulse rounded-lg bg-card border border-white/[0.04]" />,
});

const ChartBuilderForm = dynamic(() => import("@/components/insights/chart-builder-form").then((m) => m.ChartBuilderForm), {
  ssr: false,
  loading: () => <div className="h-[280px] animate-pulse rounded-lg bg-card border border-white/[0.04]" />,
});

const AIChatPanel = dynamic(() => import("@/components/insights/ai-chat-panel").then((m) => m.AIChatPanel), {
  ssr: false,
  loading: () => <div className="h-[280px] animate-pulse rounded-lg bg-card border border-white/[0.04]" />,
});
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Save, X } from "lucide-react";
import type { ChartConfig } from "@/types";
import { DATA_SOURCES } from "@/components/insights/data-source-config";

const DEFAULT_CONFIG: ChartConfig = {
  dataSource: "weekly_trend",
  chartType: "area",
  title: "Weekly Meeting Trend",
  xAxisKey: "date",
  series: [{ dataKey: "total", label: "Total Meetings", color: "hsl(210 80% 55%)" }],
  options: { showLegend: true, showGrid: true },
};

export default function InsightsPage() {
  const { dateRange } = useDateRange();
  const [activeTab, setActiveTab] = useState<"charts" | "builder">("charts");
  const [builderMode, setBuilderMode] = useState<"manual" | "chat">("manual");
  const [config, setConfig] = useState<ChartConfig>(DEFAULT_CONFIG);
  const [chartTitle, setChartTitle] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const { data: previewData, isLoading: previewLoading } = useInsightsData(config, dateRange);
  const { data: savedCharts = [], isLoading: chartsLoading } = useSavedCharts();
  const saveChart = useSaveChart();
  const deleteChart = useDeleteChart();

  const handleConfigChange = useCallback((newConfig: ChartConfig) => {
    setConfig(newConfig);
  }, []);

  const handleAIGenerated = useCallback((aiConfig: ChartConfig) => {
    setConfig(aiConfig);
    if (aiConfig.title) setChartTitle(aiConfig.title);
  }, []);

  const handleSave = () => {
    const title = chartTitle.trim() || config.title || "Untitled Chart";
    saveChart.mutate(
      { title, config: JSON.stringify(config) },
      {
        onSuccess: () => {
          setChartTitle("");
          setEditingId(null);
          setActiveTab("charts");
        },
      }
    );
  };

  const handleEdit = (chart: { id: string; title: string; config: ChartConfig }) => {
    setConfig(chart.config);
    setChartTitle(chart.title);
    setEditingId(chart.id);
    setActiveTab("builder");
  };

  const handleDelete = (id: string) => {
    setDeleteConfirmId(id);
  };

  const handleNewChart = () => {
    setConfig(DEFAULT_CONFIG);
    setChartTitle("");
    setEditingId(null);
    setActiveTab("builder");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Insights</h1>
        {activeTab === "charts" && (
          <Button onClick={handleNewChart} size="sm" className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> New Chart
          </Button>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "charts" | "builder")}>
        <TabsList>
          <TabsTrigger value="charts">My Charts</TabsTrigger>
          <TabsTrigger value="builder">Chart Builder</TabsTrigger>
        </TabsList>

        <TabsContent value="charts" className="mt-4">
          {chartsLoading ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-[320px] animate-pulse rounded-lg border bg-card" />
              ))}
            </div>
          ) : (
            <SavedChartsGrid charts={savedCharts} onEdit={handleEdit} onDelete={handleDelete} />
          )}
        </TabsContent>

        <TabsContent value="builder" className="mt-4">
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
            {/* Left: Builder controls */}
            <div className="xl:col-span-2 space-y-4">
              {/* Mode toggle */}
              <div className="flex gap-1 rounded-lg bg-secondary/50 p-1">
                <button
                  onClick={() => setBuilderMode("manual")}
                  className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    builderMode === "manual"
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Manual Builder
                </button>
                <button
                  onClick={() => setBuilderMode("chat")}
                  className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    builderMode === "chat"
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  AI Chat
                </button>
              </div>

              {builderMode === "manual" ? (
                <ChartBuilderForm config={config} onConfigChange={handleConfigChange} />
              ) : (
                <div className="h-[500px]">
                  <AIChatPanel onChartConfigGenerated={handleAIGenerated} />
                </div>
              )}
            </div>

            {/* Right: Preview */}
            <div className="xl:col-span-3 space-y-4">
              <Card>
                <CardContent className="p-4 space-y-3">
                  {/* Title input + save */}
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={chartTitle}
                      onChange={(e) => setChartTitle(e.target.value)}
                      placeholder={config.title || "Chart title..."}
                      className="flex-1 rounded-md border border-white/[0.06] bg-transparent px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <Button size="sm" onClick={handleSave} disabled={saveChart.isPending} className="gap-1.5">
                      <Save className="h-3.5 w-3.5" />
                      {editingId ? "Update" : "Save"}
                    </Button>
                    {editingId && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditingId(null);
                          setChartTitle("");
                        }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>

                  {/* Chart preview */}
                  <ChartRenderer
                    config={config}
                    data={previewData ?? []}
                    isLoading={previewLoading}
                    height={400}
                  />
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={deleteConfirmId !== null}
        onOpenChange={(open) => { if (!open) setDeleteConfirmId(null); }}
        title="Delete Chart"
        description="Are you sure you want to delete this chart? This action cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => {
          if (deleteConfirmId) deleteChart.mutate(deleteConfirmId);
          setDeleteConfirmId(null);
        }}
      />
    </div>
  );
}

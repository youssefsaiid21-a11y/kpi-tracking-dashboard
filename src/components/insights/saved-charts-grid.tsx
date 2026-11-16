"use client";

import dynamic from "next/dynamic";
import { useDateRange } from "@/lib/hooks/useDateRange";

const ChartRenderer = dynamic(() => import("./chart-renderer"), {
  ssr: false,
  loading: () => <div className="h-[280px] animate-pulse rounded-lg bg-card border border-white/[0.04]" />,
});
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2 } from "lucide-react";
import type { ChartConfig } from "@/types";
import { api } from "@/lib/api-client";
import { useQuery } from "@tanstack/react-query";

interface SavedChart {
  id: string;
  title: string;
  description?: string;
  config: ChartConfig;
}

interface SavedChartsGridProps {
  charts: SavedChart[];
  onEdit: (chart: SavedChart) => void;
  onDelete: (id: string) => void;
}

function ChartCard({ chart, onEdit, onDelete }: { chart: SavedChart; onEdit: () => void; onDelete: () => void }) {
  const { dateRange } = useDateRange();

  const { data: rows, isLoading } = useQuery({
    queryKey: ["insights-data", chart.config.dataSource, dateRange.start.toISOString(), dateRange.end.toISOString(), chart.config.filters],
    queryFn: () =>
      api.post<{ success: boolean; data: { rows: Record<string, unknown>[] } }>(
        "/api/insights/data",
        {
          dataSource: chart.config.dataSource,
          period: dateRange.period,
          startDate: dateRange.start.toISOString(),
          endDate: dateRange.end.toISOString(),
          filters: chart.config.filters,
        }
      ),
    select: (d) => d.data.rows,
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">{chart.title}</CardTitle>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        {chart.description && (
          <p className="text-xs text-muted-foreground">{chart.description}</p>
        )}
      </CardHeader>
      <CardContent className="pt-0">
        <ChartRenderer config={chart.config} data={rows ?? []} isLoading={isLoading} height={250} />
      </CardContent>
    </Card>
  );
}

export function SavedChartsGrid({ charts, onEdit, onDelete }: SavedChartsGridProps) {
  if (charts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <p className="text-sm">No saved charts yet.</p>
        <p className="text-xs mt-1">Create a chart using the builder or AI chat.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {charts.map((chart) => (
        <ChartCard
          key={chart.id}
          chart={chart}
          onEdit={() => onEdit(chart)}
          onDelete={() => onDelete(chart.id)}
        />
      ))}
    </div>
  );
}

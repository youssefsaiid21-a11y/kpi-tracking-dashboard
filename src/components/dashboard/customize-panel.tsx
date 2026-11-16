"use client";

import { ChevronUp, ChevronDown, RotateCcw, X, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { WidgetConfig, WidgetId } from "@/lib/hooks/useDashboardLayout";

interface CustomizePanelProps {
  availableWidgets: WidgetConfig[];
  enabledWidgets: WidgetId[];
  onToggle: (id: WidgetId) => void;
  onMove: (id: WidgetId, direction: "up" | "down") => void;
  onReset: () => void;
  onClose: () => void;
}

export function CustomizePanel({
  availableWidgets,
  enabledWidgets,
  onToggle,
  onMove,
  onReset,
  onClose,
}: CustomizePanelProps) {
  return (
    <div className="rounded-lg border border-white/[0.08] bg-card/80 backdrop-blur-xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Customize Dashboard</h3>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={onReset}
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="h-3 w-3 mr-1" />
            Reset
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Toggle widgets on/off and reorder them with the arrows.
      </p>

      <div className="space-y-1">
        {availableWidgets.map((widget) => {
          const isEnabled = enabledWidgets.includes(widget.id);
          const idx = enabledWidgets.indexOf(widget.id);
          const isFirst = idx === 0;
          const isLast = idx === enabledWidgets.length - 1;

          return (
            <div
              key={widget.id}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-2 transition-colors",
                isEnabled
                  ? "bg-white/[0.04]"
                  : "opacity-50"
              )}
            >
              <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />

              {/* Toggle */}
              <button
                onClick={() => onToggle(widget.id)}
                className={cn(
                  "h-4 w-7 rounded-full transition-colors shrink-0 relative",
                  isEnabled ? "bg-primary" : "bg-white/[0.1]"
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform",
                    isEnabled ? "translate-x-3.5" : "translate-x-0.5"
                  )}
                />
              </button>

              {/* Label */}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground truncate">
                  {widget.label}
                </p>
                <p className="text-[10px] text-muted-foreground truncate">
                  {widget.description}
                </p>
              </div>

              {/* Reorder arrows */}
              {isEnabled && (
                <div className="flex flex-col shrink-0">
                  <button
                    onClick={() => onMove(widget.id, "up")}
                    disabled={isFirst}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed p-0.5"
                  >
                    <ChevronUp className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => onMove(widget.id, "down")}
                    disabled={isLast}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed p-0.5"
                  >
                    <ChevronDown className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

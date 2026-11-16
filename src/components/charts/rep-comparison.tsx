"use client";

import React from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  CartesianGrid,
} from "recharts";

interface RepData {
  name: string;
  totalClassified: number;
  topChannel: string;
  topChannelCount: number;
  target?: number;
}

interface RepComparisonProps {
  data: RepData[];
  height?: number;
}

export function RepComparison({ data, height = 350 }: RepComparisonProps) {
  const hasTarget = data.some((d) => d.target !== undefined);
  const avgTarget =
    hasTarget
      ? data.reduce((sum, d) => sum + (d.target ?? 0), 0) / data.filter((d) => d.target !== undefined).length
      : undefined;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
      >
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="hsl(240 4% 18%)"
          vertical={false}
        />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 11, fill: "hsl(220 10% 50%)" }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "hsl(220 10% 50%)" }}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={{
            borderRadius: "8px",
            border: "1px solid hsl(240 4% 16%)",
            backgroundColor: "hsl(240 5% 10%)",
            color: "hsl(220 14% 90%)",
            fontSize: "12px",
            boxShadow: "0 8px 32px -4px rgba(0,0,0,0.5)",
          }}
          formatter={(value: number, name: string) => {
            const labels: Record<string, string> = {
              totalClassified: "Total Classified",
              topChannelCount: "Top Channel",
            };
            return [value, labels[name] ?? name];
          }}
        />
        <Legend
          verticalAlign="top"
          height={36}
          formatter={(value: string) =>
            value === "totalClassified"
              ? "Total Classified"
              : value === "topChannelCount"
              ? "Top Channel"
              : value
          }
          wrapperStyle={{ fontSize: "12px", color: "hsl(220 10% 50%)" }}
        />
        <Bar
          dataKey="totalClassified"
          fill="hsl(217 91% 60%)"
          radius={[3, 3, 0, 0]}
          barSize={22}
        />
        <Bar
          dataKey="topChannelCount"
          fill="hsl(172 66% 50%)"
          radius={[3, 3, 0, 0]}
          barSize={22}
        />
        {avgTarget !== undefined && (
          <ReferenceLine
            y={avgTarget}
            stroke="hsl(38 92% 50%)"
            strokeDasharray="6 3"
            strokeWidth={1.5}
            label={{
              value: `Target: ${avgTarget}`,
              position: "right",
              fill: "hsl(38 92% 50%)",
              fontSize: 11,
            }}
          />
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}

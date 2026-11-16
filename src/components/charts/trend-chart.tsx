"use client";

import React, { useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import type { TrendPoint } from "@/types";

interface TrendChartProps {
  data: TrendPoint[];
  height?: number;
  showLegend?: boolean;
}

const CHANNEL_COLORS: Record<string, string> = {
  partnerships: "hsl(270 60% 60%)",
  conferences: "hsl(38 92% 50%)",
  referrals: "hsl(160 84% 39%)",
  linkedin: "hsl(217 91% 60%)",
  email: "hsl(187 72% 50%)",
  inbound: "hsl(330 65% 55%)",
};

const CHANNEL_LABELS: Record<string, string> = {
  partnerships: "Partnerships",
  conferences: "Conferences",
  referrals: "Referrals",
  linkedin: "LinkedIn",
  email: "Email",
  inbound: "Inbound",
};

export function TrendChart({
  data,
  height = 280,
  showLegend = true,
}: TrendChartProps) {
  // Flatten channel data for recharts
  const chartData = useMemo(() => {
    return data.map((point) => ({
      date: point.date,
      total: point.total,
      ...(point.channels ?? {}),
    }));
  }, [data]);

  // Determine which channels have any data
  const activeChannels = useMemo(() => {
    const channelTotals: Record<string, number> = {};
    for (const point of data) {
      if (point.channels) {
        for (const [ch, count] of Object.entries(point.channels)) {
          if (ch !== "irrelevant") {
            channelTotals[ch] = (channelTotals[ch] ?? 0) + (count as number);
          }
        }
      }
    }
    return Object.entries(channelTotals)
      .filter(([, total]) => total > 0)
      .map(([ch]) => ch)
      .sort();
  }, [data]);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart
        data={chartData}
        margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
      >
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="hsl(240 4% 18%)"
          vertical={false}
        />
        <XAxis
          dataKey="date"
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
          formatter={(value: number, name: string) => [
            value,
            CHANNEL_LABELS[name] ?? name,
          ]}
          labelFormatter={(label: string) => `Week: ${label}`}
        />
        {showLegend && (
          <Legend
            verticalAlign="top"
            height={36}
            formatter={(value: string) => CHANNEL_LABELS[value] ?? value}
            wrapperStyle={{ fontSize: "12px", color: "hsl(220 10% 50%)" }}
          />
        )}
        {activeChannels.map((channel) => (
          <Area
            key={channel}
            type="monotone"
            dataKey={channel}
            stackId="channels"
            stroke={CHANNEL_COLORS[channel] ?? "hsl(220 10% 50%)"}
            fill={CHANNEL_COLORS[channel] ?? "hsl(220 10% 50%)"}
            fillOpacity={0.3}
            strokeWidth={1.5}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

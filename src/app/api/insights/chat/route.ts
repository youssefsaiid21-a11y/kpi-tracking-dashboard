import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { apiHandler } from "@/lib/api-handler";
import { InsightsChatSchema } from "@/lib/schemas";

// ── Lazy singleton (same pattern as src/lib/prisma.ts) ───────
const globalForAnthropic = globalThis as unknown as {
  anthropicClient: Anthropic | undefined;
};

function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  if (!globalForAnthropic.anthropicClient) {
    globalForAnthropic.anthropicClient = new Anthropic({ apiKey });
  }
  return globalForAnthropic.anthropicClient;
}

const SYSTEM_PROMPT = `You are a chart configuration assistant for a KPI tracking dashboard.
Generate a ChartConfig JSON based on the user's request.

Available data sources and their fields:
- channel_breakdown: { channel, count } - meetings by channel (partnerships, conferences, referrals, linkedin, email, inbound)
- weekly_trend: { date, total, partnerships, conferences, referrals, linkedin, email, inbound } - weekly meeting counts
- conversion_funnel: { label, fromStage, toStage, rate, dealCount } - pipeline conversion rates
- target_vs_actual: { metricLabel, metricType, target, actual, deficit, onTrack } - targets comparison
- rep_performance: { userName, totalClassified, pendingReview, classificationRate, partnerships, conferences, referrals, linkedin, email, inbound } - per-rep metrics
- deal_pipeline: { stage, dealCount, totalValue } - deals grouped by stage
- deal_timeline: { week, count, value } - deals created over time
- classification_rate: { week, rate, eligible, reviewed } - review completion rate

Chart types: line, area, bar, horizontal_bar, scatter, composed, pie, radar

Channel names: partnerships, conferences, referrals, linkedin, email, inbound

Respond with ONLY valid JSON (no markdown):
{"chartConfig": {<ChartConfig>}, "explanation": "<brief explanation>"}

ChartConfig schema:
{
  "dataSource": "<DataSourceId>",
  "chartType": "<ChartType>",
  "title": "<chart title>",
  "xAxisKey": "<field for x-axis>",
  "series": [{"dataKey": "<field>", "label": "<display name>", "color": "<hsl color>"}],
  "options": {"stacked": false, "showLegend": true, "showGrid": true}
}

For composed charts, each series can have a "chartType" override (e.g., "bar" or "line").
For dual-axis charts, set "options.dualAxis": true and "yAxisId": "right" on secondary series.`;

export const POST = apiHandler(
  async (_req, { body }) => {
    const client = getAnthropicClient();
    if (!client) {
      return NextResponse.json(
        { success: false, error: "ANTHROPIC_API_KEY is not configured" },
        { status: 500 }
      );
    }

    const messages: Anthropic.MessageParam[] = [
      ...(body.conversationHistory ?? []).map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      { role: "user", content: body.message },
    ];

    const response = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages,
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";

    try {
      const parsed = JSON.parse(text);
      const { chartConfig, explanation } = parsed;

      return NextResponse.json({
        success: true,
        data: { chartConfig, explanation },
      });
    } catch {
      return NextResponse.json(
        {
          success: false,
          error:
            "The AI returned an invalid response. Please try rephrasing your request.",
        },
        { status: 422 }
      );
    }
  },
  { body: InsightsChatSchema }
);

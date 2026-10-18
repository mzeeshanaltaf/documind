"use client";

import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { MyAnalytics } from "@/lib/api-types";
import { formatCompact, formatCount, formatDuration } from "@/lib/format";
import { axisDate, BAR_SIZE, ChartFrame, row, TOP_RADIUS } from "./analytics-charts";

const questionConfig = { questions: { label: "Questions", color: "var(--chart-1)" } } satisfies ChartConfig;
const tokenConfig = {
  input_tokens: { label: "Input", color: "var(--chart-1)" },
  output_tokens: { label: "Output", color: "var(--chart-3)" },
} satisfies ChartConfig;
const latencyConfig = { avg_latency_ms: { label: "Average response time", color: "var(--chart-1)" } } satisfies ChartConfig;

/** Questions, tokens and response time per day/week: the same mark specs as the platform charts. */
export function MyAnalyticsCharts({
  points,
  granularity,
}: {
  points: MyAnalytics["timeseries"];
  granularity: "day" | "week";
}) {
  const per = granularity === "week" ? "week" : "day";
  const tickGap = points.length > 40 ? 32 : 16;
  const sparseLatency = points.filter((p) => p.avg_latency_ms !== null).length < 3;
  const xAxis = (
    <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={tickGap} tickFormatter={axisDate} />
  );

  return (
    <div className="grid gap-x-10 gap-y-10 lg:grid-cols-2">
      <ChartFrame title="Questions" description={`Questions you asked per ${per}`}>
        <ChartContainer config={questionConfig} className="aspect-auto h-56 w-full">
          <BarChart data={points} margin={{ left: 4, right: 4 }} accessibilityLayer>
            <CartesianGrid vertical={false} strokeWidth={1} />
            {xAxis}
            <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} tickFormatter={(v: number) => formatCount(v)} />
            <ChartTooltip
              cursor={{ fill: "var(--muted)" }}
              content={<ChartTooltipContent labelFormatter={(v) => axisDate(String(v))} formatter={row(formatCount)} />}
            />
            <Bar dataKey="questions" name="Questions" fill="var(--color-questions)" radius={TOP_RADIUS} maxBarSize={BAR_SIZE} />
          </BarChart>
        </ChartContainer>
      </ChartFrame>

      <ChartFrame title="Tokens" description={`Input and output tokens your questions used per ${per}`}>
        <ChartContainer config={tokenConfig} className="aspect-auto h-56 w-full">
          <BarChart data={points} margin={{ left: 4, right: 4 }} accessibilityLayer>
            <CartesianGrid vertical={false} strokeWidth={1} />
            {xAxis}
            <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => formatCompact(v)} />
            <ChartTooltip
              cursor={{ fill: "var(--muted)" }}
              content={<ChartTooltipContent labelFormatter={(v) => axisDate(String(v))} formatter={row(formatCompact)} />}
            />
            <ChartLegend content={<ChartLegendContent />} itemSorter={null} />
            {(["input_tokens", "output_tokens"] as const).map((key) => (
              <Bar
                key={key}
                dataKey={key}
                name={tokenConfig[key].label}
                stackId="tokens"
                fill={`var(--color-${key})`}
                stroke="var(--background)"
                strokeWidth={2}
                maxBarSize={BAR_SIZE}
                radius={key === "output_tokens" ? TOP_RADIUS : 0}
              />
            ))}
          </BarChart>
        </ChartContainer>
      </ChartFrame>

      <ChartFrame title="Response time" description={`Average time to a full answer, per ${per}`}>
        <ChartContainer config={latencyConfig} className="aspect-auto h-56 w-full">
          <LineChart data={points} margin={{ left: 4, right: 12, top: 8 }} accessibilityLayer>
            <CartesianGrid vertical={false} strokeWidth={1} />
            {xAxis}
            <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => formatDuration(v)} />
            <ChartTooltip
              cursor={{ stroke: "var(--border)" }}
              content={<ChartTooltipContent labelFormatter={(v) => axisDate(String(v))} formatter={row(formatDuration)} />}
            />
            <Line
              dataKey="avg_latency_ms"
              name="Average response time"
              type="monotone"
              stroke="var(--color-avg_latency_ms)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              connectNulls
              dot={sparseLatency ? { r: 4, fill: "var(--color-avg_latency_ms)", stroke: "var(--background)", strokeWidth: 2 } : false}
              activeDot={{ r: 4, stroke: "var(--background)", strokeWidth: 2 }}
            />
          </LineChart>
        </ChartContainer>
      </ChartFrame>
    </div>
  );
}

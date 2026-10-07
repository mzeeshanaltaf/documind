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
import type { TimeseriesPoint } from "@/lib/api-types";
import { formatCompact, formatCost, formatDayMonth, formatDuration } from "@/lib/format";

/* Mark specs (dataviz): bars ≤ 24px with a 4px rounded data-end, 2px surface gaps
   between stacked segments, 2px lines, hairline recessive grid, no dual axes. */
const BAR_SIZE = 24;
const TOP_RADIUS: [number, number, number, number] = [4, 4, 0, 0];

const costConfig = { cost_usd: { label: "Cost", color: "var(--chart-1)" } } satisfies ChartConfig;
const tokenConfig = {
  uncached: { label: "Input (uncached)", color: "var(--chart-1)" },
  cached: { label: "Input (cached)", color: "var(--chart-2)" },
  output: { label: "Output", color: "var(--chart-3)" },
} satisfies ChartConfig;
const latencyConfig = { p95_latency_ms: { label: "p95 latency", color: "var(--chart-1)" } } satisfies ChartConfig;

type Formatter = (value: number) => string;

/** Tooltip row: swatch, label, formatted value (the default prints raw numbers). */
function row(format: Formatter) {
  function TooltipRow(value: unknown, name: unknown, item: { color?: string; payload?: { fill?: string } }) {
    return (
      <div className="flex w-full items-center gap-2">
        <span className="size-2.5 shrink-0 rounded-xs" style={{ background: item.color ?? item.payload?.fill }} />
        <span className="text-muted-foreground">{String(name)}</span>
        <span className="ml-auto pl-3 font-mono font-medium text-foreground tabular-nums">{format(Number(value))}</span>
      </div>
    );
  }
  return TooltipRow;
}

function axisDate(value: string) {
  return formatDayMonth(value);
}

function ChartFrame({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <figure className="flex min-w-0 flex-col gap-3">
      <figcaption className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </figcaption>
      {children}
    </figure>
  );
}

export function AnalyticsCharts({ points, granularity }: { points: TimeseriesPoint[]; granularity: "day" | "week" }) {
  const per = granularity === "week" ? "week" : "day";
  const tokens = points.map((p) => ({
    date: p.date,
    uncached: Math.max(0, p.input_tokens - p.cached_tokens),
    cached: p.cached_tokens,
    output: p.output_tokens,
  }));
  const tickGap = points.length > 40 ? 32 : 16;
  const sparseLatency = points.filter((p) => p.p95_latency_ms !== null).length < 3;

  return (
    <div className="grid gap-x-10 gap-y-10 lg:grid-cols-2">
      <ChartFrame title="Cost" description={`LLM spend per ${per}, all operations`}>
        <ChartContainer config={costConfig} className="aspect-auto h-56 w-full">
          <BarChart data={points} margin={{ left: 4, right: 4 }} accessibilityLayer>
            <CartesianGrid vertical={false} strokeWidth={1} />
            <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={tickGap} tickFormatter={axisDate} />
            <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => formatCost(v)} />
            <ChartTooltip
              cursor={{ fill: "var(--muted)" }}
              content={<ChartTooltipContent labelFormatter={(v) => axisDate(String(v))} formatter={row(formatCost)} />}
            />
            <Bar dataKey="cost_usd" name="Cost" fill="var(--color-cost_usd)" radius={TOP_RADIUS} maxBarSize={BAR_SIZE} />
          </BarChart>
        </ChartContainer>
      </ChartFrame>

      <ChartFrame title="Tokens" description={`Input (uncached and cached) and output tokens per ${per}`}>
        <ChartContainer config={tokenConfig} className="aspect-auto h-56 w-full">
          <BarChart data={tokens} margin={{ left: 4, right: 4 }} accessibilityLayer>
            <CartesianGrid vertical={false} strokeWidth={1} />
            <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={tickGap} tickFormatter={axisDate} />
            <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => formatCompact(v)} />
            <ChartTooltip
              cursor={{ fill: "var(--muted)" }}
              content={<ChartTooltipContent labelFormatter={(v) => axisDate(String(v))} formatter={row(formatCompact)} />}
            />
            {/* Series order, not alphabetical, so the legend reads like the stack. */}
            <ChartLegend content={<ChartLegendContent />} itemSorter={null} />
            {(["uncached", "cached", "output"] as const).map((key) => (
              <Bar
                key={key}
                dataKey={key}
                name={tokenConfig[key].label}
                stackId="tokens"
                fill={`var(--color-${key})`}
                stroke="var(--background)"
                strokeWidth={2}
                maxBarSize={BAR_SIZE}
                radius={key === "output" ? TOP_RADIUS : 0}
              />
            ))}
          </BarChart>
        </ChartContainer>
      </ChartFrame>

      <ChartFrame title="Answer latency (p95)" description={`95th percentile time to a full answer, per ${per}`}>
        <ChartContainer config={latencyConfig} className="aspect-auto h-56 w-full">
          <LineChart data={points} margin={{ left: 4, right: 12, top: 8 }} accessibilityLayer>
            <CartesianGrid vertical={false} strokeWidth={1} />
            <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={tickGap} tickFormatter={axisDate} />
            <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => formatDuration(v)} />
            <ChartTooltip
              cursor={{ stroke: "var(--border)" }}
              content={<ChartTooltipContent labelFormatter={(v) => axisDate(String(v))} formatter={row(formatDuration)} />}
            />
            <Line
              dataKey="p95_latency_ms"
              name="p95 latency"
              type="monotone"
              stroke="var(--color-p95_latency_ms)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              connectNulls
              // With under three measured buckets a line has nothing to join: show the points.
              dot={sparseLatency ? { r: 4, fill: "var(--color-p95_latency_ms)", stroke: "var(--background)", strokeWidth: 2 } : false}
              activeDot={{ r: 4, stroke: "var(--background)", strokeWidth: 2 }}
            />
          </LineChart>
        </ChartContainer>
      </ChartFrame>
    </div>
  );
}

"use client";

import { Bar, BarChart, LabelList, XAxis, YAxis } from "recharts";
import { type ChartConfig, ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { BAR_SIZE } from "./analytics-charts";

export type RankedItem = {
  key: string;
  label: string;
  value: number;
  /** Pre-formatted value printed at the bar's end (formatters can't cross the server/client line). */
  valueLabel: string;
  /** Extra figures shown in the tooltip. */
  details?: { label: string; value: string }[];
};

const ROW_HEIGHT = 36;
const LABEL_WIDTH = 150;

function truncate(text: string, max = 24) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function RankedTooltip({ active, payload }: { active?: boolean; payload?: { payload: RankedItem }[] }) {
  const item = active ? payload?.[0]?.payload : undefined;
  if (!item) return null;
  return (
    <div className="grid min-w-40 gap-1.5 rounded-lg border bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <span className="font-medium">{item.label}</span>
      <div className="grid gap-1">
        {item.details?.map((d) => (
          <div key={d.label} className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">{d.label}</span>
            <span className="font-mono font-medium tabular-nums">{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** One measure ranked across categories: horizontal bars, value printed at the end, detail on hover. */
export function RankedBarChart({ items, measure }: { items: RankedItem[]; measure: string }) {
  const config = { value: { label: measure, color: "var(--chart-1)" } } satisfies ChartConfig;
  return (
    <ChartContainer config={config} className="aspect-auto w-full" style={{ height: items.length * ROW_HEIGHT + 8 }}>
      <BarChart data={items} layout="vertical" margin={{ left: 0, right: 64, top: 4, bottom: 4 }} accessibilityLayer>
        <XAxis type="number" hide domain={[0, "dataMax"]} />
        <YAxis
          type="category"
          dataKey="label"
          width={LABEL_WIDTH}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          interval={0}
          tickFormatter={(v: string) => truncate(v)}
        />
        <ChartTooltip cursor={{ fill: "var(--muted)" }} content={<RankedTooltip />} />
        <Bar dataKey="value" name={measure} fill="var(--color-value)" radius={[0, 4, 4, 0]} maxBarSize={BAR_SIZE - 6} minPointSize={2}>
          <LabelList dataKey="valueLabel" position="right" className="fill-foreground font-mono text-xs tabular-nums" />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

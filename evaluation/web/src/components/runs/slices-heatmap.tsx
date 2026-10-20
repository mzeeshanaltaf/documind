"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { AggregateOut } from "@/lib/api-types";
import { formatMetric, type MetricIndex, metricLabel, orderMetrics, sliceParts } from "@/lib/metrics";

const KINDS = [
  { value: "type", label: "Type" },
  { value: "dept", label: "Department" },
  { value: "juris", label: "Jurisdiction" },
  { value: "difficulty", label: "Difficulty" },
  { value: "tag", label: "Tag" },
  { value: "source", label: "Source" },
];

/** 0 (bad) … 1 (good), whatever the metric's direction. */
function goodness(mean: number, direction: string) {
  const v = Math.min(1, Math.max(0, mean));
  return direction === "lower" ? 1 - v : v;
}

/** Fill strength: cubic, because eval scores bunch near the top (0.85 and 1.0 must look different). */
function fill(g: number) {
  return `color-mix(in oklch, var(--chart-1) ${Math.round(6 + 59 * g ** 3)}%, var(--background))`;
}

/**
 * Metric × slice. One sequential hue (chart slot 1), light = poor, dark = good, so weak slices
 * read as pale gaps; every cell prints its value, so the colour is never the only signal and the
 * table is its own table view. Hover or focus a row for CI and n.
 */
export function SlicesHeatmap({
  aggregates,
  index,
  mode,
  keyMetrics,
}: {
  aggregates: AggregateOut[];
  index: MetricIndex;
  mode: string;
  keyMetrics: string[];
}) {
  const [kind, setKind] = useState("type");
  const [showAll, setShowAll] = useState(false);
  const [hover, setHover] = useState<AggregateOut | null>(null);

  const { metrics, slices, cells } = useMemo(() => {
    const rows = aggregates.filter((a) => a.mode === mode && a.slice.startsWith(`${kind}:`));
    const cells = new Map(rows.map((a) => [`${a.metric}|${a.slice}`, a]));
    const bounded = (key: string) => ["unit", "binary"].includes(index[key]?.scale ?? "");
    const present = [...new Set(rows.map((a) => a.metric))].filter(bounded);
    const chosen = showAll ? present : keyMetrics.filter((k) => present.includes(k));
    const slices = [...new Set(rows.map((a) => a.slice))].sort();
    return { metrics: showAll ? orderMetrics(chosen, index) : chosen, slices, cells };
  }, [aggregates, mode, kind, showAll, keyMetrics, index]);

  const availableKinds = KINDS.filter((k) => aggregates.some((a) => a.mode === mode && a.slice.startsWith(`${k.value}:`)));

  if (!availableKinds.length) {
    return <p className="text-sm text-muted-foreground">Slices appear once the run finishes and its aggregates are computed.</p>;
  }

  const readout = hover
    ? `${metricLabel(hover.metric)}, ${sliceParts(hover.slice).join(" ")}: ${formatMetric(hover.mean, index[hover.metric])}${
        hover.ci_low !== null && hover.ci_high !== null
          ? ` (95% CI ${formatMetric(hover.ci_low, index[hover.metric])} to ${formatMetric(hover.ci_high, index[hover.metric])})`
          : ""
      }, n ${hover.n}${(hover.details as Record<string, number>).na ? `, ${(hover.details as Record<string, number>).na} n/a` : ""}`
    : "Hover a cell for its confidence interval and sample size.";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Up to six kinds: scroll sideways on a phone rather than push the page wider. */}
        <div className="max-w-full overflow-x-auto">
          <ToggleGroup
            value={[kind]}
            onValueChange={(v: string[]) => v[0] && setKind(v[0])}
            variant="outline"
            size="sm"
            spacing={0}
            aria-label="Slice by"
          >
            {availableKinds.map((k) => (
              <ToggleGroupItem key={k.value} value={k.value}>
                {k.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setShowAll((s) => !s)}>
          {showAll ? "Key metrics only" : "All metrics"}
        </Button>
      </div>
      <p className="min-h-5 text-xs text-muted-foreground tabular-nums" aria-live="polite">
        {readout}
      </p>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full border-separate border-spacing-0.5 p-1 text-xs" onMouseLeave={() => setHover(null)}>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 bg-background px-2 py-1.5 text-left font-medium text-muted-foreground">
                Metric
              </th>
              {slices.map((slice) => (
                <th key={slice} scope="col" className="px-2 py-1.5 text-center font-mono font-normal whitespace-nowrap text-muted-foreground">
                  {sliceParts(slice)[1]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metrics.map((metric) => (
              <tr key={metric}>
                <th scope="row" className="sticky left-0 bg-background px-2 py-1.5 text-left font-normal whitespace-nowrap">
                  {metricLabel(metric)}
                </th>
                {slices.map((slice) => {
                  const cell = cells.get(`${metric}|${slice}`);
                  const info = index[metric];
                  if (!cell || cell.mean === null) {
                    return (
                      <td key={slice} className="rounded-sm bg-muted/40 px-2 py-1.5 text-center text-muted-foreground">
                        n/a
                      </td>
                    );
                  }
                  const g = goodness(cell.mean, info?.direction ?? "higher");
                  return (
                    <td
                      key={slice}
                      onMouseEnter={() => setHover(cell)}
                      className="rounded-sm px-2 py-1.5 text-center font-mono tabular-nums"
                      style={{ background: fill(g) }}
                    >
                      {formatMetric(cell.mean, info)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground" aria-hidden>
        <span>Poorer</span>
        <span className="flex gap-0.5">
          {[0, 0.5, 0.75, 0.9, 1].map((g) => (
            <span key={g} className="h-2.5 w-5 rounded-sm" style={{ background: fill(g) }} />
          ))}
        </span>
        <span>Better (direction-aware; the scale stretches the top end)</span>
      </div>
    </div>
  );
}

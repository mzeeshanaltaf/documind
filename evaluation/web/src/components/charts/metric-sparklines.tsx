"use client";

import { useMemo } from "react";
import type { MetricInfo, TrendPoint } from "@/lib/api-types";
import { formatMetric, indexMetrics, metricLabel } from "@/lib/metrics";
import { Sparkline } from "./sparkline";

/** Small multiples: one sparkline per key metric, each on its own axis (never a dual axis). */
export function MetricSparklines({ series, registry }: { series: Record<string, TrendPoint[]>; registry: MetricInfo[] }) {
  const index = useMemo(() => indexMetrics(registry), [registry]);
  const keys = Object.keys(series).filter((key) => series[key].some((p) => p.mean !== null));
  if (!keys.length) return <p className="text-sm text-muted-foreground">No completed runs on this dataset yet.</p>;
  return (
    <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
      {keys.map((key) => {
        const info = index[key];
        // Retrieval-only runs score per mode; keep one line per metric (hybrid, else chat).
        const points = series[key].filter((p, _, all) => p.mode === (all.some((q) => q.mode === "chat") ? "chat" : "hybrid"));
        return (
          <div key={key} className="flex min-w-0 flex-col gap-1">
            <span className="text-xs font-medium" title={info?.description}>
              {metricLabel(key)}
            </span>
            <Sparkline
              points={points.length ? points : series[key]}
              label={metricLabel(key)}
              bounded={info?.scale === "unit" || info?.scale === "binary"}
              format={(v) => formatMetric(v, info)}
            />
          </div>
        );
      })}
    </div>
  );
}

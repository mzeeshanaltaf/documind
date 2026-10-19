"use client";

import { useEffect, useRef, useState } from "react";
import type { MetricInfo, TrendMarker, TrendPoint, TrendRun } from "@/lib/api-types";
import { configKeyParts, formatConfigValue } from "@/lib/compare";
import { formatDateTime } from "@/lib/format";
import { metricLabel } from "@/lib/metrics";
import { cn } from "@/lib/utils";

const H = 196;
const PAD = { top: 26, right: 14, bottom: 24, left: 44 };
const DEFAULT_WIDTH = 520;

export const KIND_LABELS: Record<TrendMarker["kinds"][number], string> = {
  config: "Config",
  documind: "DocuMind version",
  prompt: "Judge prompt",
  dataset: "Dataset version",
};

/** One change, readable: "Config › overrides › top_k: not set → 4". */
export function describeChange(change: TrendMarker["changes"][number]): string {
  const [section, name] = configKeyParts(change.key);
  return `${section} › ${name}: ${formatConfigValue(change.a)} → ${formatConfigValue(change.b)}`;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * Contiguous runs of the same dataset version: [first index, last index, label]. The label is
 * "v2", or "golden v2" when the runs span several datasets.
 */
export function versionSegments(runs: TrendRun[]): [number, number, string][] {
  const several = new Set(runs.map((r) => r.dataset_slug)).size > 1;
  const out: [number, number, string][] = [];
  runs.forEach((run, i) => {
    const last = out.at(-1);
    if (last && runs[last[1]].dataset_version_id === run.dataset_version_id) last[1] = i;
    else out.push([i, i, `${several ? `${run.dataset_slug} ` : ""}v${run.dataset_version ?? "?"}`]);
  });
  return out;
}

function niceDomain(values: number[], bounded: boolean): [number, number] {
  if (bounded) return [0, 1];
  if (!values.length) return [0, 1];
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (lo === hi) {
    const pad = Math.abs(lo) * 0.1 || 1;
    return [lo - pad, hi + pad];
  }
  const pad = (hi - lo) * 0.08;
  lo -= pad;
  hi += pad;
  if (lo < 0 && Math.min(...values) >= 0) lo = 0;
  return [lo, hi];
}

/**
 * One metric across runs (equal spacing: runs are events, not a clock). A 2px line in chart slot
 * 1 with its 95% CI as a faint band; a vertical hairline with a diamond marks each change between
 * two runs; alternate dataset versions get a light wash with their version label. The hovered
 * run is shared by every chart on the board; hover or arrow keys move it, Enter or a click opens
 * the run.
 */
export function TrendChart({
  metric,
  info,
  runs,
  points,
  markers,
  active,
  onActive,
  onOpen,
  format,
}: {
  metric: string;
  info: MetricInfo | undefined;
  runs: TrendRun[];
  points: TrendPoint[];
  markers: Map<string, TrendMarker>;
  active: number | null;
  onActive: (index: number | null) => void;
  onOpen: (runId: string) => void;
  format: (value: number | null) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hovered, setHovered] = useState(false);
  const byRun = new Map(points.map((p) => [p.run_id, p]));
  const values = runs.map((r) => byRun.get(r.run_id) ?? null);
  const bounded = info?.scale === "unit" || info?.scale === "binary";
  const label = metricLabel(metric);

  const plotW = width - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const step = runs.length > 1 ? plotW / (runs.length - 1) : 0;
  const x = (i: number) => (runs.length === 1 ? PAD.left + plotW / 2 : PAD.left + i * step);
  const domainValues = values.flatMap((p) =>
    p && p.mean !== null ? [p.mean, p.ci_low ?? p.mean, p.ci_high ?? p.mean] : [],
  );
  const [lo, hi] = niceDomain(domainValues, bounded);
  const y = (v: number) => PAD.top + plotH - ((v - lo) / (hi - lo || 1)) * plotH;
  const r = (n: number) => Math.round(n * 10) / 10;

  // Line and band per contiguous stretch of runs that have a value.
  const stretches: number[][] = [];
  values.forEach((p, i) => {
    if (!p || p.mean === null) return;
    const last = stretches.at(-1);
    if (last && last.at(-1) === i - 1) last.push(i);
    else stretches.push([i]);
  });
  const line = stretches.map((s) => s.map((i, j) => `${j ? "L" : "M"}${r(x(i))},${r(y(values[i]!.mean!))}`).join("")).join("");
  const bands = stretches
    .filter((s) => s.every((i) => values[i]!.ci_low !== null && values[i]!.ci_high !== null))
    .map(
      (s) =>
        `${s.map((i, j) => `${j ? "L" : "M"}${r(x(i))},${r(y(values[i]!.ci_high!))}`).join("")}${[...s]
          .reverse()
          .map((i) => `L${r(x(i))},${r(y(values[i]!.ci_low!))}`)
          .join("")}Z`,
    );

  const segments = versionSegments(runs);
  const ticks = bounded ? [0, 0.5, 1] : [lo, (lo + hi) / 2, hi];
  const shown = active ?? (runs.length ? runs.length - 1 : null);
  const shownPoint = shown === null ? null : values[shown];
  const marker = shown === null ? undefined : markers.get(runs[shown]?.run_id);

  function nearest(clientX: number, rect: DOMRect): number {
    const px = ((clientX - rect.left) / rect.width) * width;
    if (runs.length <= 1) return 0;
    return Math.max(0, Math.min(runs.length - 1, Math.round((px - PAD.left) / step)));
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!runs.length) return;
    const current = active ?? runs.length - 1;
    const next =
      e.key === "ArrowLeft" ? current - 1 : e.key === "ArrowRight" ? current + 1 : e.key === "Home" ? 0 : e.key === "End" ? runs.length - 1 : null;
    if (next !== null) {
      e.preventDefault();
      onActive(Math.max(0, Math.min(runs.length - 1, next)));
    } else if (e.key === "Enter" && runs[current]) {
      onOpen(runs[current].run_id);
    }
  }

  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="truncate text-sm font-medium" title={info?.description}>
          {label}
        </span>
        <span className="flex items-baseline gap-2 text-xs text-muted-foreground tabular-nums">
          {shownPoint && shownPoint.ci_low !== null && shownPoint.ci_high !== null && (
            <span className="hidden font-mono sm:inline">
              {format(shownPoint.ci_low)} to {format(shownPoint.ci_high)}
            </span>
          )}
          <span className="font-mono text-sm text-foreground">{format(shownPoint?.mean ?? null)}</span>
        </span>
      </figcaption>
      <div ref={ref} className="relative">
        <svg
          width={width}
          height={H}
          viewBox={`0 0 ${width} ${H}`}
          className="block overflow-visible rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          role="img"
          aria-label={`${label} across ${runs.length} runs; latest ${format(values.at(-1)?.mean ?? null)}. Arrow keys move between runs, Enter opens one.`}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onFocus={() => {
            if (active === null && runs.length) onActive(runs.length - 1);
          }}
          onBlur={() => onActive(null)}
          onPointerMove={(e) => {
            setHovered(true);
            onActive(nearest(e.clientX, e.currentTarget.getBoundingClientRect()));
          }}
          onPointerLeave={() => {
            setHovered(false);
            onActive(null);
          }}
          onClick={(e) => {
            const i = nearest(e.clientX, e.currentTarget.getBoundingClientRect());
            if (runs[i]) onOpen(runs[i].run_id);
          }}
          style={{ cursor: runs.length ? "pointer" : undefined }}
        >
          {segments.length > 1 &&
            segments.map(([from, to, segmentLabel], k) => {
              const left = runs.length === 1 ? PAD.left : Math.max(PAD.left, x(from) - step / 2);
              const right = runs.length === 1 ? PAD.left + plotW : Math.min(PAD.left + plotW, x(to) + step / 2);
              return (
                <g key={`${from}-${to}`}>
                  {k % 2 === 1 && <rect x={left} y={PAD.top} width={right - left} height={plotH} className="fill-muted/60" />}
                  {/* Mono 10px ≈ 6px a character: a label that doesn't fit its stretch is left to the table view. */}
                  {segmentLabel.length * 6 + 8 <= right - left && (
                    <text x={left + 4} y={PAD.top + plotH - 5} className="fill-muted-foreground font-mono text-[10px]">
                      {segmentLabel}
                    </text>
                  )}
                </g>
              );
            })}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={PAD.left + plotW} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
              <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">
                {format(t)}
              </text>
            </g>
          ))}
          {runs.map((run, i) => {
            const m = markers.get(run.run_id);
            if (!m || i === 0) return null;
            const mx = x(i) - step / 2;
            return (
              <g key={`m-${run.run_id}`} onPointerEnter={() => onActive(i)}>
                <line x1={mx} x2={mx} y1={PAD.top - 8} y2={PAD.top + plotH} className="stroke-foreground/35" strokeWidth={1} />
                <path
                  d={`M${mx},${PAD.top - 16} l5,5 l-5,5 l-5,-5 Z`}
                  className={cn("fill-background stroke-foreground/70", shown === i && "fill-foreground")}
                  strokeWidth={1.25}
                />
              </g>
            );
          })}
          {bands.map((d, i) => (
            <path key={i} d={d} className="fill-chart-1/15" />
          ))}
          {line && <path d={line} fill="none" className="stroke-chart-1" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
          {shown !== null && active !== null && (
            <line x1={x(shown)} x2={x(shown)} y1={PAD.top} y2={PAD.top + plotH} className="stroke-foreground/30" strokeWidth={1} />
          )}
          {values.map((p, i) =>
            p && p.mean !== null ? (
              <circle
                key={p.run_id}
                cx={x(i)}
                cy={y(p.mean)}
                r={i === shown ? 4.5 : runs.length > 40 ? 0 : 2.5}
                className="fill-chart-1 stroke-background"
                strokeWidth={i === shown ? 2 : 1}
              />
            ) : null,
          )}
          {runs.length > 0 && (
            <>
              <text x={x(0)} y={H - 6} textAnchor={runs.length === 1 ? "middle" : "start"} className="fill-muted-foreground text-[10px]">
                {formatDateTime(runs[0].finished_at)}
              </text>
              {runs.length > 1 && (
                <text x={x(runs.length - 1)} y={H - 6} textAnchor="end" className="fill-muted-foreground text-[10px]">
                  {formatDateTime(runs.at(-1)!.finished_at)}
                </text>
              )}
            </>
          )}
        </svg>
        {hovered && shown !== null && runs[shown] && (
          <div
            className="pointer-events-none absolute z-10 flex w-64 flex-col gap-1.5 rounded-lg bg-popover p-2.5 text-xs text-popover-foreground shadow-md ring-1 ring-foreground/10"
            style={{ top: 0, left: x(shown) + 12 + 256 > width ? Math.max(0, x(shown) - 12 - 256) : x(shown) + 12 }}
          >
            <span className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-sm font-medium tabular-nums">{format(shownPoint?.mean ?? null)}</span>
              {shownPoint && <span className="text-muted-foreground tabular-nums">n {shownPoint.n}</span>}
            </span>
            {shownPoint && shownPoint.ci_low !== null && shownPoint.ci_high !== null && (
              <span className="font-mono text-muted-foreground tabular-nums">
                95% CI {format(shownPoint.ci_low)} to {format(shownPoint.ci_high)}
              </span>
            )}
            <span className="truncate text-muted-foreground">
              {runs[shown].name || "Unnamed run"} · {formatDateTime(runs[shown].finished_at)}
            </span>
            {marker && (
              <span className="flex flex-col gap-0.5 border-t pt-1.5">
                <span className="font-medium">Changed since the run before</span>
                {marker.changes.slice(0, 4).map((c) => (
                  <span key={c.key} className="wrap-break-word text-muted-foreground">
                    {describeChange(c)}
                  </span>
                ))}
                {marker.changes.length > 4 && <span className="text-muted-foreground">and {marker.changes.length - 4} more</span>}
              </span>
            )}
          </div>
        )}
      </div>
    </figure>
  );
}

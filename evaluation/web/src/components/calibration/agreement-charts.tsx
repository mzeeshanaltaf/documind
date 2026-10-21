"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

/** Fill strength for a count share: one sequential hue (chart slot 1) over the surface. */
function fill(share: number) {
  return `color-mix(in oklch, var(--chart-1) ${Math.round(4 + 66 * share)}%, var(--background))`;
}

function pct(n: number, total: number) {
  return total ? `${Math.round((n / total) * 100)}%` : "0%";
}

/**
 * Judge (rows) × human (columns) counts. Darker = more cases; the diagonal (agreement) is ruled.
 * Every cell prints its count, so the table is its own table view and colour is never the only
 * signal. Hover or focus a cell for its share.
 */
export function ConfusionHeatmap({ labels, matrix, unit = "case" }: { labels: string[]; matrix: number[][]; unit?: string }) {
  const [hover, setHover] = useState<[number, number] | null>(null);
  const total = matrix.flat().reduce((s, v) => s + v, 0);
  const max = Math.max(1, ...matrix.flat());
  const readout = hover
    ? `Judge ${labels[hover[0]]}, human ${labels[hover[1]]}: ${matrix[hover[0]][hover[1]]} ${unit}${
        matrix[hover[0]][hover[1]] === 1 ? "" : "s"
      } (${pct(matrix[hover[0]][hover[1]], total)})`
    : `${total} ${unit}${total === 1 ? "" : "s"}; the ruled diagonal is where judge and human agree.`;

  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <figcaption className="text-xs font-medium">Confusion matrix</figcaption>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-0.5 text-xs" onMouseLeave={() => setHover(null)}>
          <thead>
            <tr>
              <th scope="col" className="px-1.5 py-1 text-left font-normal text-muted-foreground">
                <span className="sr-only">Judge grade</span>
              </th>
              <th colSpan={labels.length} scope="colgroup" className="pb-0.5 text-center font-normal text-muted-foreground">
                Human
              </th>
            </tr>
            <tr>
              <th scope="col" className="px-1.5 py-1 text-left font-normal text-muted-foreground">
                Judge
              </th>
              {labels.map((label) => (
                <th key={label} scope="col" className="min-w-10 px-1.5 py-1 text-center font-mono font-normal text-muted-foreground">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row, i) => (
              <tr key={labels[i]}>
                <th scope="row" className="px-1.5 py-1 text-left font-mono font-normal text-muted-foreground">
                  {labels[i]}
                </th>
                {row.map((count, j) => {
                  const share = count / max;
                  return (
                    <td
                      key={labels[j]}
                      tabIndex={0}
                      onMouseEnter={() => setHover([i, j])}
                      onFocus={() => setHover([i, j])}
                      onBlur={() => setHover(null)}
                      aria-label={`Judge ${labels[i]}, human ${labels[j]}: ${count}`}
                      className={cn(
                        "h-9 min-w-10 rounded-sm px-1.5 text-center font-mono tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        i === j && "ring-1 ring-foreground/40 ring-inset",
                        count === 0 && "text-muted-foreground/60",
                        share > 0.55 && "text-primary-foreground",
                      )}
                      style={{ background: count ? fill(share) : undefined }}
                    >
                      {count}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="min-h-4 text-[0.7rem] text-muted-foreground tabular-nums" aria-live="polite">
        {readout}
      </p>
    </figure>
  );
}

type Point = { x: number; y: number; n: number };

const SIZE = 220;
const PAD = 30;

/**
 * Judge (y) against human (x), one dot per distinct pair sized by how many cases share it. Dots
 * above the dashed diagonal are cases the judge graded higher. Ordinal scales use category
 * positions; faithfulness uses its 0 to 1 value per case.
 */
export function BiasScatter({
  pairs,
  labels,
  continuous = false,
}: {
  pairs: [number, number][];
  labels?: string[];
  continuous?: boolean;
}) {
  const [hover, setHover] = useState<Point | null>(null);
  const steps = continuous ? 1 : Math.max((labels?.length ?? 2) - 1, 1);
  const points = useMemo(() => {
    const counts = new Map<string, Point>();
    for (const [judge, human] of pairs) {
      const x = continuous ? Math.round(human * 100) / 100 : human;
      const y = continuous ? Math.round(judge * 100) / 100 : judge;
      const key = `${x}|${y}`;
      const point = counts.get(key) ?? { x, y, n: 0 };
      point.n += 1;
      counts.set(key, point);
    }
    return [...counts.values()];
  }, [pairs, continuous]);
  if (!points.length) return null;

  const max = Math.max(...points.map((p) => p.n));
  const scale = (v: number) => PAD + (v / steps) * (SIZE - PAD - 10);
  const sy = (v: number) => SIZE - scale(v);
  const radius = (n: number) => 4 + 9 * Math.sqrt(n / max);
  const ticks = continuous ? [0, 0.5, 1] : (labels ?? []).map((_, i) => i);
  const tickLabel = (v: number) => (continuous ? String(v) : (labels?.[v] ?? String(v)));
  const name = (v: number) => (continuous ? v.toFixed(2) : tickLabel(v));
  const readout = hover
    ? `Human ${name(hover.x)}, judge ${name(hover.y)}: ${hover.n} case${hover.n === 1 ? "" : "s"}`
    : "Above the diagonal: the judge graded higher than the human.";

  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <figcaption className="text-xs font-medium">Judge against human</figcaption>
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="w-full max-w-60 overflow-visible"
        role="img"
        aria-label={`Scatter of ${pairs.length} judge and human grade pairs.`}
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t} className="text-muted-foreground">
            <line x1={scale(t)} x2={scale(t)} y1={sy(0)} y2={sy(steps)} stroke="currentColor" strokeOpacity={0.15} />
            <line x1={scale(0)} x2={scale(steps)} y1={sy(t)} y2={sy(t)} stroke="currentColor" strokeOpacity={0.15} />
            <text x={scale(t)} y={sy(0) + 14} textAnchor="middle" fontSize={9} fill="currentColor" className="font-mono">
              {tickLabel(t)}
            </text>
            <text x={scale(0) - 8} y={sy(t) + 3} textAnchor="end" fontSize={9} fill="currentColor" className="font-mono">
              {tickLabel(t)}
            </text>
          </g>
        ))}
        <line
          x1={scale(0)}
          y1={sy(0)}
          x2={scale(steps)}
          y2={sy(steps)}
          className="text-muted-foreground"
          stroke="currentColor"
          strokeDasharray="3 3"
          strokeOpacity={0.6}
        />
        <text x={scale(steps / 2)} y={SIZE + 6} textAnchor="middle" fontSize={9} className="fill-muted-foreground">
          Human
        </text>
        <text
          x={6}
          y={sy(steps / 2)}
          textAnchor="middle"
          fontSize={9}
          transform={`rotate(-90 6 ${sy(steps / 2)})`}
          className="fill-muted-foreground"
        >
          Judge
        </text>
        {points.map((p) => (
          <g
            key={`${p.x}|${p.y}`}
            tabIndex={0}
            role="img"
            aria-label={`Human ${name(p.x)}, judge ${name(p.y)}: ${p.n}`}
            onMouseEnter={() => setHover(p)}
            onFocus={() => setHover(p)}
            onBlur={() => setHover(null)}
            className="outline-none focus-visible:[&>circle:last-child]:stroke-ring"
          >
            <circle cx={scale(p.x)} cy={sy(p.y)} r={Math.max(12, radius(p.n))} fill="transparent" />
            <circle
              cx={scale(p.x)}
              cy={sy(p.y)}
              r={radius(p.n)}
              fill="var(--chart-1)"
              fillOpacity={hover === p ? 0.95 : 0.75}
              stroke="var(--background)"
              strokeWidth={2}
            />
          </g>
        ))}
      </svg>
      <p className="min-h-4 text-[0.7rem] text-muted-foreground tabular-nums" aria-live="polite">
        {readout}
      </p>
    </figure>
  );
}

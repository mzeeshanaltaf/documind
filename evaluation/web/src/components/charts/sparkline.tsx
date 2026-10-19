"use client";

import Link from "next/link";
import { useState } from "react";
import type { TrendPoint } from "@/lib/api-types";
import { formatDateTime } from "@/lib/format";

const W = 200;
const H = 44;
const PAD = 5;

/**
 * One metric across runs: a 2px line in chart slot 1, the 95% CI as a faint band, the latest run
 * as a dot. Hover (or focus) a run to read its value; values are also listed for screen readers.
 * `bounded` metrics (0–1) keep a fixed 0–1 axis so a flat line means flat, not zoomed.
 */
export function Sparkline({
  points,
  label,
  bounded,
  format,
}: {
  points: TrendPoint[];
  label: string;
  bounded: boolean;
  format: (v: number | null) => string;
}) {
  const data = points.filter((p) => p.mean !== null);
  const [active, setActive] = useState<number | null>(null);
  if (data.length === 0) return <p className="text-xs text-muted-foreground">No finished runs yet.</p>;

  const values = data.flatMap((p) => [p.mean!, p.ci_low ?? p.mean!, p.ci_high ?? p.mean!]);
  const lo = bounded ? 0 : Math.min(...values);
  const hi = bounded ? 1 : Math.max(...values);
  const span = hi - lo || 1;
  const x = (i: number) => (data.length === 1 ? W / 2 : PAD + (i * (W - 2 * PAD)) / (data.length - 1));
  const y = (v: number) => H - PAD - ((v - lo) / span) * (H - 2 * PAD);
  const r = (n: number) => Math.round(n * 10) / 10;

  const line = data.map((p, i) => `${i ? "L" : "M"}${r(x(i))},${r(y(p.mean!))}`).join("");
  const withCi = data.every((p) => p.ci_low !== null && p.ci_high !== null);
  const band = withCi
    ? `${data.map((p, i) => `${i ? "L" : "M"}${r(x(i))},${r(y(p.ci_high!))}`).join("")}${data
        .map((_, j) => {
          const i = data.length - 1 - j;
          return `L${r(x(i))},${r(y(data[i].ci_low!))}`;
        })
        .join("")}Z`
    : null;

  const shown = active ?? data.length - 1;
  const point = data[shown];

  return (
    <div className="flex flex-col gap-1.5">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-11 w-full overflow-visible"
        role="img"
        aria-label={`${label} over the last ${data.length} runs, latest ${format(data.at(-1)!.mean)}`}
        onMouseLeave={() => setActive(null)}
      >
        {band && <path d={band} className="fill-chart-1/15" />}
        <path d={line} fill="none" className="stroke-chart-1" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {active !== null && <line x1={x(active)} x2={x(active)} y1={0} y2={H} className="stroke-border" strokeWidth={1} />}
        <circle cx={x(shown)} cy={y(point.mean!)} r={4} className="fill-chart-1 stroke-background" strokeWidth={2} />
        {data.map((p, i) => (
          // Hit targets wider than the mark.
          <rect
            key={p.run_id}
            x={x(i) - (W / data.length) / 2}
            y={0}
            width={W / data.length}
            height={H}
            fill="transparent"
            onMouseEnter={() => setActive(i)}
          />
        ))}
      </svg>
      <p className="flex items-baseline justify-between gap-2 text-[0.7rem] text-muted-foreground tabular-nums">
        <Link href={`/runs/${point.run_id}`} className="truncate hover:text-foreground hover:underline">
          {formatDateTime(point.finished_at)}
        </Link>
        <span className="font-mono text-foreground">{format(point.mean)}</span>
      </p>
      <ul className="sr-only">
        {data.map((p) => (
          <li key={p.run_id}>
            {formatDateTime(p.finished_at)}: {format(p.mean)}
          </li>
        ))}
      </ul>
    </div>
  );
}

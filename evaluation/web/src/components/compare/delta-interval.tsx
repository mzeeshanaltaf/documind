import type { Verdict } from "@/lib/compare";
import { cn } from "@/lib/utils";

const W = 120;
const H = 18;
const MID = H / 2;

const TONE: Record<Verdict, { stroke: string; fill: string }> = {
  regression: { stroke: "stroke-destructive", fill: "fill-destructive" },
  improvement: { stroke: "stroke-success", fill: "fill-success" },
  worse: { stroke: "stroke-muted-foreground", fill: "fill-muted-foreground" },
  better: { stroke: "stroke-muted-foreground", fill: "fill-muted-foreground" },
  same: { stroke: "stroke-muted-foreground", fill: "fill-muted-foreground" },
  untested: { stroke: "stroke-muted-foreground", fill: "fill-muted-foreground" },
};

/**
 * Δ with its 95% CI on a symmetric axis around zero (hairline). The shaded band is the A/A noise
 * floor, so "the interval crosses zero" and "the change is within noise" read at a glance.
 * `extent` is the axis half-width, shared by rows of the same scale so their bars compare.
 */
export function DeltaInterval({
  delta,
  ci,
  noise,
  extent,
  verdict,
  label,
}: {
  delta: number | null;
  ci: [number, number] | null;
  noise: number | null;
  extent: number;
  verdict: Verdict;
  label: string;
}) {
  if (delta === null) return <span className="text-xs text-muted-foreground">n/a</span>;
  const x = (v: number) => {
    const clamped = Math.max(-extent, Math.min(extent, v));
    return W / 2 + (clamped / extent) * (W / 2 - 3);
  };
  const tone = TONE[verdict];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block overflow-visible" role="img" aria-label={label}>
      {noise !== null && noise > 0 && (
        <rect x={x(-noise)} y={2} width={Math.max(1, x(noise) - x(-noise))} height={H - 4} rx={2} className="fill-muted" />
      )}
      <line x1={W / 2} x2={W / 2} y1={0} y2={H} className="stroke-border" strokeWidth={1} />
      {ci && (
        <line
          x1={x(ci[0])}
          x2={x(ci[1])}
          y1={MID}
          y2={MID}
          className={cn(tone.stroke, "fill-none")}
          strokeWidth={2}
          strokeLinecap="round"
          opacity={verdict === "regression" || verdict === "improvement" ? 1 : 0.7}
        />
      )}
      <circle cx={x(delta)} cy={MID} r={3.5} className={cn(tone.fill, "stroke-background")} strokeWidth={1.5} />
    </svg>
  );
}

/** Half-width of a shared axis: the largest |bound| among rows, never below `floor`. */
export function axisExtent(values: (number | null | undefined)[], floor: number): number {
  let max = floor;
  for (const v of values) if (v !== null && v !== undefined && Number.isFinite(v)) max = Math.max(max, Math.abs(v));
  return max * 1.05;
}

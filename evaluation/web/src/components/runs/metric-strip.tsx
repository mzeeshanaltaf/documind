import { CircleAlertIcon, CircleCheckIcon } from "lucide-react";
import { CalibrationBadge } from "@/components/calibration/calibration-badge";
import type { AggregateOut, CalibrationBadge as Badge, RunCaseOut } from "@/lib/api-types";
import { formatMetric, meetsThreshold, type MetricIndex, metricLabel } from "@/lib/metrics";
import { cn } from "@/lib/utils";

export type MetricSummary = {
  key: string;
  mean: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  n: number;
  na: number;
  errors: number;
  provisional: boolean;
};

export function fromAggregate(a: AggregateOut): MetricSummary {
  const details = a.details as Record<string, number>;
  return {
    key: a.metric,
    mean: a.mean,
    ciLow: a.ci_low,
    ciHigh: a.ci_high,
    n: a.n,
    na: details.na ?? 0,
    errors: (details.error ?? 0) + (details.refusal ?? 0),
    provisional: false,
  };
}

/** While a run is live there are no aggregates yet: a plain mean over the finished cases. */
export function provisional(key: string, cases: RunCaseOut[], mode: string): MetricSummary {
  const values: number[] = [];
  let na = 0;
  for (const c of cases) {
    if (c.status !== "done") continue;
    if (key === "case_pass") {
      if (c.passed !== null) values.push(c.passed ? 1 : 0);
      continue;
    }
    const value = c.metrics[mode]?.[key];
    if (value === null) na += 1;
    else if (value !== undefined) values.push(value);
  }
  const mean = values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
  return { key, mean, ciLow: null, ciHigh: null, n: values.length, na, errors: 0, provisional: true };
}

/** A 0–1 track with the CI as a band and the mean as a tick (unit and binary metrics only). */
function IntervalBar({ s }: { s: MetricSummary }) {
  if (s.mean === null) return <div className="h-1.5" />;
  const pct = (v: number) => `${Math.min(100, Math.max(0, v * 100))}%`;
  return (
    <div className="relative h-1.5 w-full rounded-full bg-muted" aria-hidden>
      {s.ciLow !== null && s.ciHigh !== null && (
        <div
          className="absolute inset-y-0 rounded-full bg-chart-1/35"
          style={{ left: pct(s.ciLow), width: `calc(${pct(s.ciHigh)} - ${pct(s.ciLow)})` }}
        />
      )}
      <div className="absolute -inset-y-0.5 w-0.5 -translate-x-1/2 rounded-full bg-chart-1" style={{ left: pct(s.mean) }} />
    </div>
  );
}

/**
 * Key metrics as one ruled strip (a spec sheet, not a card grid): label, the mean in mono, its
 * 95% CI, n and how many cases didn't apply. Gated metrics say whether the mean clears the gate;
 * judge metrics carry their calibration badge (how far the judge agrees with people).
 */
export function MetricStrip({
  summaries,
  index,
  thresholds,
  badges,
}: {
  summaries: MetricSummary[];
  index: MetricIndex;
  thresholds?: Record<string, number>;
  badges?: Record<string, Badge>;
}) {
  if (!summaries.length) return null;
  return (
    <dl className="grid grid-cols-2 overflow-hidden rounded-lg border sm:grid-cols-3 lg:grid-cols-4">
      {summaries.map((s) => {
        const info = index[s.key];
        const bounded = info?.scale === "unit" || info?.scale === "binary";
        const gate = info?.gating ? meetsThreshold(s.mean, info, thresholds?.[s.key]) : null;
        const ci =
          s.ciLow !== null && s.ciHigh !== null
            ? `${formatMetric(s.ciLow, info)} to ${formatMetric(s.ciHigh, info)}`
            : s.provisional
              ? "CI when the run ends"
              : "no CI";
        return (
          <div key={s.key} className="-mr-px -mb-px flex min-w-0 flex-col gap-1.5 border-r border-b p-4">
            <dt className="flex items-center gap-1.5 truncate text-xs text-muted-foreground" title={info?.description}>
              {metricLabel(s.key)}
              {gate !== null &&
                (gate ? (
                  <CircleCheckIcon className="size-3.5 shrink-0 text-success" aria-label="Clears its gate" />
                ) : (
                  <CircleAlertIcon className="size-3.5 shrink-0 text-destructive" aria-label="Below its gate" />
                ))}
            </dt>
            <dd className="flex flex-col gap-1.5">
              <span className={cn("font-mono text-xl leading-none tabular-nums", s.provisional && "text-muted-foreground")}>
                {formatMetric(s.mean, info)}
              </span>
              {bounded && <IntervalBar s={s} />}
              <span className="font-mono text-[0.7rem] text-muted-foreground tabular-nums">{ci}</span>
              <span className="text-[0.7rem] text-muted-foreground tabular-nums">
                n {s.n}
                {s.na > 0 && <> · {s.na} n/a</>}
                {s.errors > 0 && <span className="text-destructive"> · {s.errors} failed</span>}
                {s.provisional && <> · so far</>}
              </span>
              {badges?.[s.key] && <CalibrationBadge badge={badges[s.key]} className="mt-0.5" />}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

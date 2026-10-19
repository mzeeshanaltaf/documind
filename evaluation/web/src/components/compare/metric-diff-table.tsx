import { TrendingDownIcon, TrendingUpIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CompareMetric } from "@/lib/api-types";
import { formatDelta, formatP, sortMetricRows, type Verdict, verdictOf } from "@/lib/compare";
import { formatMetric, type MetricIndex, metricLabel } from "@/lib/metrics";
import { cn } from "@/lib/utils";
import { axisExtent, DeltaInterval } from "./delta-interval";

const BOUNDED = new Set(["unit", "binary"]);

function Result({ m, verdict }: { m: CompareMetric; verdict: Verdict }) {
  if (verdict === "regression")
    return (
      <Badge variant="destructive">
        <TrendingDownIcon data-icon="inline-start" />
        Regression
      </Badge>
    );
  if (verdict === "improvement")
    return (
      <Badge variant="outline" className="border-success/40 text-success">
        <TrendingUpIcon data-icon="inline-start" />
        Improvement
      </Badge>
    );
  if (!m.in_family && verdict !== "untested" && verdict !== "same")
    return (
      <span
        className="text-xs text-muted-foreground"
        title="Latency, tokens and cost follow the infrastructure (OpenAI's prompt cache, load), not the setup, so they aren't tested for significance."
      >
        Descriptive
      </span>
    );
  const text =
    verdict === "untested"
      ? "Not scored in both"
      : verdict === "same"
        ? "No change"
        : m.within_noise
          ? "Within noise"
          : "Not significant";
  return <span className="text-xs text-muted-foreground">{text}</span>;
}

/**
 * One row per metric: both means, Δ = B − A, its 95% CI against the A/A noise band, the raw and
 * Holm-adjusted p, and the verdict. Significant regressions sort first, in the destructive colour.
 */
export function MetricDiffTable({ metrics, index }: { metrics: CompareMetric[]; index: MetricIndex }) {
  const rows = sortMetricRows(metrics);
  // Unit and binary rows share one axis so their intervals compare; the others get their own.
  const sharedExtent = axisExtent(
    metrics.filter((m) => BOUNDED.has(m.scale)).flatMap((m) => [...(m.ci ?? []), m.delta, m.noise_delta]),
    0.05,
  );

  return (
    <div className="@container overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Metric</TableHead>
            <TableHead className="hidden text-right @xl:table-cell">A</TableHead>
            <TableHead className="hidden text-right @xl:table-cell">B</TableHead>
            <TableHead className="text-right">Δ (B − A)</TableHead>
            <TableHead className="hidden @3xl:table-cell">
              <span className="sr-only">95% CI of Δ against the noise band</span>
              <span aria-hidden>95% CI</span>
            </TableHead>
            <TableHead className="hidden text-right @2xl:table-cell">p · Holm</TableHead>
            <TableHead className="text-right">Result</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((m) => {
            const info = index[m.key];
            const verdict = verdictOf(m);
            const extent = BOUNDED.has(m.scale) ? sharedExtent : axisExtent([...(m.ci ?? []), m.delta, m.noise_delta], 1e-9);
            const deltaText = formatDelta(m.delta, info);
            return (
              <TableRow key={m.key} className={cn(verdict === "regression" && "bg-destructive/5 hover:bg-destructive/10")}>
                <TableCell className="max-w-0 min-w-40 @xl:max-w-none">
                  <span className="flex flex-col gap-0.5">
                    <span className="truncate" title={info?.description}>
                      {metricLabel(m.key)}
                    </span>
                    <span className="text-[0.7rem] text-muted-foreground tabular-nums">
                      n {m.n}
                      {m.n_missing > 0 && <> · {m.n_missing} n/a</>}
                      {m.discordant && (
                        <>
                          {" "}
                          · {m.discordant.a_only} A-only, {m.discordant.b_only} B-only
                        </>
                      )}
                    </span>
                  </span>
                </TableCell>
                <TableCell className="hidden text-right font-mono text-xs tabular-nums @xl:table-cell">
                  {formatMetric(m.mean_a, info)}
                </TableCell>
                <TableCell className="hidden text-right font-mono text-xs tabular-nums @xl:table-cell">
                  {formatMetric(m.mean_b, info)}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right font-mono text-xs tabular-nums",
                    verdict === "regression" && "font-medium text-destructive",
                    verdict === "improvement" && "font-medium text-success",
                  )}
                >
                  {deltaText}
                </TableCell>
                <TableCell className="hidden @3xl:table-cell">
                  <DeltaInterval
                    delta={m.delta}
                    ci={m.ci}
                    noise={m.noise_delta}
                    extent={extent}
                    verdict={verdict}
                    label={
                      m.ci
                        ? `Δ ${deltaText}, 95% CI ${formatDelta(m.ci[0], info)} to ${formatDelta(m.ci[1], info)}`
                        : `Δ ${deltaText}`
                    }
                  />
                </TableCell>
                <TableCell className="hidden text-right font-mono text-xs text-muted-foreground tabular-nums @2xl:table-cell">
                  {m.p === null ? (
                    "n/a"
                  ) : (
                    <>
                      {formatP(m.p)}
                      {m.in_family && (
                        <span className={cn("ml-1.5", m.significant ? "text-foreground" : undefined)}>{formatP(m.p_holm)}</span>
                      )}
                    </>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Result m={m} verdict={verdict} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

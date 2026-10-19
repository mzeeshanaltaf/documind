import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { MetricScoreOut } from "@/lib/api-types";
import { formatMetric, GROUP_LABELS, groupMetrics, type MetricIndex, metricLabel, orderMetrics } from "@/lib/metrics";
import { PassMark } from "../runs/status";

type Issue = { quote?: string; severity?: string; dimension?: string; explanation?: string };

/**
 * answer_quality keeps a `summary` (+ `verdict`) and, under `analysis`, one note per dimension
 * (each dimension metric carries its own as a string); claim-style judges keep `reasoning`.
 */
function reasoningOf(score: MetricScoreOut) {
  const d = score.details as Record<string, unknown>;
  const text = [d.summary, d.analysis, d.reasoning].find((t): t is string => typeof t === "string" && !!t.trim());
  const verdict = typeof d.verdict === "string" ? d.verdict : null;
  const issues = Array.isArray(d.issues) ? (d.issues as Issue[]) : [];
  const samples = Array.isArray(d.samples) ? (d.samples as number[]) : null;
  return { text, verdict, issues, samples };
}

/** The judge's own words for one metric: the analysis or reasoning, then any issues it raised. */
function Reasoning({ score }: { score: MetricScoreOut }) {
  const { text, verdict, issues, samples } = reasoningOf(score);
  if (!text && !issues.length) return null;
  return (
    <div className="flex flex-col gap-2">
      {text && (
        <p className="max-w-[72ch] text-sm leading-relaxed">
          {verdict && <span className="mr-1.5 font-mono text-xs text-muted-foreground uppercase">{verdict}</span>}
          {text}
        </p>
      )}
      {samples && samples.length > 1 && (
        <p className="font-mono text-xs text-muted-foreground">samples {samples.join(", ")} (median used)</p>
      )}
      {issues.length > 0 && (
        <ul className="flex flex-col gap-2">
          {issues.map((issue, i) => (
            <li key={i} className="flex flex-col gap-1 rounded-md bg-muted/50 px-3 py-2 text-sm">
              <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {issue.severity && (
                  <Badge variant={issue.severity === "major" ? "destructive" : "secondary"}>{issue.severity}</Badge>
                )}
                {issue.dimension && <span>{issue.dimension.replace(/_/g, " ")}</span>}
              </span>
              {issue.quote && (
                <span className="font-heading text-[0.8125rem] text-muted-foreground">
                  <mark className="rounded-[3px] bg-highlight px-0.5 text-highlight-foreground">{issue.quote}</mark>
                </span>
              )}
              {issue.explanation && <span>{issue.explanation}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Judge metrics with their reasoning, one block per metric that has any. */
export function JudgeReasoning({ scores, index }: { scores: MetricScoreOut[]; index: MetricIndex }) {
  const judged = orderMetrics(
    scores.filter((s) => index[s.metric]?.requires_judge).map((s) => s.metric),
    index,
  ).map((key) => scores.find((s) => s.metric === key)!);
  const withText = judged.filter((s) => {
    const { text, issues } = reasoningOf(s);
    return !!text || issues.length > 0 || s.status === "error" || s.status === "refusal";
  });
  if (!withText.length) return <p className="text-sm text-muted-foreground">No judge reasoning for this case.</p>;
  return (
    <div className="flex flex-col divide-y rounded-lg border">
      {withText.map((s) => (
        <div key={`${s.mode}-${s.metric}`} className="flex flex-col gap-2 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-semibold">{metricLabel(s.metric)}</span>
            <span className="flex items-center gap-3">
              <span className="font-mono text-sm tabular-nums">{formatMetric(s.value, index[s.metric], { single: true })}</span>
              {s.passed !== null && <PassMark passed={s.passed} />}
            </span>
          </div>
          {s.status === "error" || s.status === "refusal" ? (
            <p className="text-sm text-destructive">
              The judge {s.status === "refusal" ? "refused" : "failed"} on this metric
              {typeof (s.details as Record<string, unknown>).error === "string" && `: ${(s.details as Record<string, string>).error}`}.
            </p>
          ) : (
            <Reasoning score={s} />
          )}
        </div>
      ))}
    </div>
  );
}

function detailSummary(details: Record<string, unknown>): string {
  const skip = new Set(["analysis", "summary", "reasoning", "issues", "samples"]);
  return Object.entries(details)
    .filter(([key]) => !skip.has(key))
    .map(([key, value]) => `${key} ${Array.isArray(value) ? `[${value.join(", ")}]` : typeof value === "object" && value !== null ? JSON.stringify(value) : String(value)}`)
    .join(" · ");
}

/** Every score of the case, grouped, with its raw details (counts, matched sections, reasons). */
export function ScoresTable({ scores, index }: { scores: MetricScoreOut[]; index: MetricIndex }) {
  const groups = groupMetrics([...new Set(scores.map((s) => s.metric))], index);
  return (
    <div className="@container overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Metric</TableHead>
            <TableHead className="text-right">Value</TableHead>
            <TableHead className="text-right">Gate</TableHead>
            <TableHead className="hidden @3xl:table-cell">Details</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.flatMap(({ group, keys }) => [
            <TableRow key={`g-${group}`} className="hover:bg-transparent">
              <TableCell colSpan={4} className="bg-muted/50 py-1.5 text-xs font-semibold text-muted-foreground">
                {GROUP_LABELS[group] ?? group}
              </TableCell>
            </TableRow>,
            ...keys.flatMap((key) =>
              scores
                .filter((s) => s.metric === key)
                .map((s) => (
                  <TableRow key={`${s.mode}-${key}`}>
                    <TableCell title={index[key]?.description}>
                      {metricLabel(key)}
                      {s.mode !== "chat" && <span className="ml-1.5 font-mono text-xs text-muted-foreground">{s.mode}</span>}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {s.status === "ok" ? (
                        formatMetric(s.value, index[key], { single: true })
                      ) : (
                        <span className={s.status === "na" ? "text-muted-foreground" : "text-destructive"}>{s.status}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{s.passed === null ? "" : <PassMark passed={s.passed} />}</TableCell>
                    <TableCell className="hidden max-w-md truncate font-mono text-[0.7rem] text-muted-foreground @3xl:table-cell" title={detailSummary(s.details)}>
                      {detailSummary(s.details)}
                    </TableCell>
                  </TableRow>
                )),
            ),
          ])}
        </TableBody>
      </Table>
    </div>
  );
}

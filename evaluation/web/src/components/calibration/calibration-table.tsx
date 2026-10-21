"use client";

import { ChevronRightIcon } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Calibration } from "@/lib/api-types";
import { formatDateTime } from "@/lib/format";
import { metricLabel } from "@/lib/metrics";
import { cn } from "@/lib/utils";
import { BiasScatter, ConfusionHeatmap } from "./agreement-charts";
import { calibrationAnchor, formatKappa, kappaLabel, STATUS } from "./calibration-badge";

function share(value: number | null) {
  return value === null ? "n/a" : `${Math.round(value * 100)}%`;
}

function signed(value: number | null, digits = 2) {
  if (value === null) return "n/a";
  const text = Math.abs(value).toFixed(digits);
  return value > 0 ? `+${text}` : value < 0 ? `−${text}` : text;
}

function primaryOf(row: Calibration) {
  return row.details.primary === "kappa" ? row.kappa : row.kappa_weighted;
}

function StatusCell({ status }: { status: Calibration["status"] }) {
  const spec = STATUS[status];
  const Icon = spec.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs whitespace-nowrap", spec.tone)} title={spec.meaning}>
      <Icon className="size-3.5" aria-hidden />
      {spec.label}
    </span>
  );
}

/**
 * Metric × prompt version × judge model. A row opens its confusion matrix and the judge-vs-human
 * scatter, with the human-human ceiling and the N-sample test-retest spread when they exist.
 */
export function CalibrationTable({ rows }: { rows: Calibration[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // A badge links to #cal-<metric>: open that metric's current row (or its newest), on load and
  // when a badge on this page changes the hash.
  useEffect(() => {
    function openFromHash() {
      const hash = window.location.hash.slice(1);
      const mine = rows.filter((r) => calibrationAnchor(r.metric) === hash);
      const target = mine.find((r) => r.current) ?? mine[0];
      if (target) setOpen((current) => new Set(current).add(target.id));
    }
    const frame = requestAnimationFrame(openFromHash);
    window.addEventListener("hashchange", openFromHash);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", openFromHash);
    };
  }, [rows]);

  // The anchor goes on each metric's first row (its newest prompt version).
  const anchorRows = new Set(Object.values(Object.fromEntries([...rows].reverse().map((r) => [r.metric, r.id]))));
  return (
    <div className="@container overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Metric</TableHead>
            <TableHead className="hidden @2xl:table-cell">Prompt</TableHead>
            <TableHead className="hidden @3xl:table-cell">Judge model</TableHead>
            <TableHead className="text-right">n</TableHead>
            <TableHead className="text-right" title="Quadratic-weighted κ (κ for faithfulness's nominal claim verdicts)">
              κw
            </TableHead>
            <TableHead className="hidden text-right @xl:table-cell" title="Spearman's rank correlation">
              ρ
            </TableHead>
            <TableHead className="hidden text-right @4xl:table-cell">Exact</TableHead>
            <TableHead className="hidden text-right @4xl:table-cell">±1</TableHead>
            <TableHead className="hidden text-right @2xl:table-cell" title="Mean judge minus human">
              Bias
            </TableHead>
            <TableHead className="hidden text-right @5xl:table-cell" title="Agreement between two reviewers: the ceiling">
              Human κw
            </TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const expanded = open.has(row.id);
            const anchor = anchorRows.has(row.id) ? calibrationAnchor(row.metric) : undefined;
            const detailId = `cal-detail-${row.id}`;
            return (
              <Fragment key={row.id}>
                <TableRow id={anchor} className={cn("scroll-mt-6", !row.current && "text-muted-foreground")}>
                  <TableCell className="max-w-64">
                    <button
                      type="button"
                      onClick={() => toggle(row.id)}
                      aria-expanded={expanded}
                      aria-controls={detailId}
                      className="group inline-flex items-center gap-1.5 rounded-sm text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                    >
                      <ChevronRightIcon
                        className={cn("size-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-90")}
                        aria-hidden
                      />
                      <span className="truncate font-medium group-hover:underline">{metricLabel(row.metric)}</span>
                    </button>
                  </TableCell>
                  <TableCell className="hidden font-mono text-xs @2xl:table-cell">
                    v{row.prompt_version}
                    {row.current && <span className="ml-1.5 font-sans text-[0.7rem] text-primary">current</span>}
                  </TableCell>
                  <TableCell className="hidden font-mono text-xs @3xl:table-cell">{row.judge_model}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.n}</TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {formatKappa(primaryOf(row))}
                    {row.details.primary === "kappa" && <span className="text-muted-foreground"> κ</span>}
                  </TableCell>
                  <TableCell className="hidden text-right font-mono text-xs tabular-nums @xl:table-cell">
                    {formatKappa(row.spearman)}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums @4xl:table-cell">{share(row.exact_pct)}</TableCell>
                  <TableCell className="hidden text-right tabular-nums @4xl:table-cell">{share(row.within1_pct)}</TableCell>
                  <TableCell className="hidden text-right font-mono text-xs tabular-nums @2xl:table-cell">{signed(row.bias)}</TableCell>
                  <TableCell className="hidden text-right font-mono text-xs tabular-nums @5xl:table-cell">
                    {formatKappa(row.human_kappa)}
                  </TableCell>
                  <TableCell>
                    <StatusCell status={row.status} />
                  </TableCell>
                </TableRow>
                {expanded && (
                  <TableRow id={detailId} className="hover:bg-transparent">
                    <TableCell colSpan={11} className="bg-muted/30 p-4 whitespace-normal">
                      <CalibrationDetail row={row} />
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function CalibrationDetail({ row }: { row: Calibration }) {
  const labels = row.confusion.labels ?? [];
  const claims = row.details.kind === "claims";
  const human = row.details.human;
  const retest = row.details.retest;
  const steps = row.details.kind === "ordinal" && labels.length === 5 ? "rubric points" : "steps";
  const facts: [string, React.ReactNode][] = [
    ["Prompt", <span key="p" className="font-mono">{row.prompt_key} v{row.prompt_version}</span>],
    ["Judge model", <span key="m" className="font-mono">{row.judge_model}</span>],
    [
      "Graded",
      claims
        ? `${row.n} cases, ${row.details.units ?? 0} claims (κ is over claims)`
        : `${row.n} case${row.n === 1 ? "" : "s"}`,
    ],
    [
      "Bias",
      row.bias === null
        ? "n/a"
        : row.bias === 0
          ? "None: the judge and people grade alike on average."
          : `The judge grades ${Math.abs(row.bias).toFixed(2)}${claims ? "" : ` ${steps}`} ${row.bias > 0 ? "higher" : "lower"} than people on average.`,
    ],
    ["MAE", row.mae === null ? "n/a" : `${row.mae.toFixed(2)}${claims ? "" : ` ${steps}`}`],
    [
      "Human ceiling",
      human && human.n > 0
        ? `${kappaLabel(row.details.primary)} ${formatKappa(human.kappa)} between two reviewers over ${human.n} ${claims ? "claims" : "cases"}. The judge can't be expected to agree with people better than they agree with each other.`
        : "Needs a second reviewer on the same cases (open the same queue as another admin).",
    ],
    [
      "Test-retest",
      retest
        ? `Mean spread ${retest.mean_spread_steps.toFixed(2)} ${steps} across 3 samples, over ${retest.n} judged cases.`
        : "Judge a run with 3 samples to see how much the judge disagrees with itself.",
    ],
    ["Computed", formatDateTime(row.computed_at)],
  ];
  return (
    <div className="grid gap-6 lg:grid-cols-[auto_auto_minmax(0,1fr)]">
      {row.confusion.matrix && (
        <ConfusionHeatmap labels={labels} matrix={row.confusion.matrix} unit={claims ? "claim" : "case"} />
      )}
      <BiasScatter pairs={row.details.pairs ?? []} labels={labels} continuous={claims} />
      <dl className="grid content-start gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_minmax(0,1fr)]">
        {facts.map(([label, value]) => (
          <Fragment key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="max-w-[65ch] text-pretty">{value}</dd>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}

"use client";

import { ArrowRightIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { CaseStatusBadge, PassMark } from "@/components/runs/status";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { CaseClass, CompareCase, MetricInfo } from "@/lib/api-types";
import { CLASS_LABELS, CLASS_ORDER, formatDelta } from "@/lib/compare";
import { humanize } from "@/lib/format";
import { indexMetrics, metricLabel, orderMetrics } from "@/lib/metrics";
import { cn } from "@/lib/utils";

const ALL = "all";

const CLASS_TONE: Record<CaseClass, string> = {
  regressed: "text-destructive",
  mixed: "text-warning",
  improved: "text-success",
  unchanged: "text-muted-foreground",
  unpaired: "text-muted-foreground",
};

function Outcome({ status, passed }: { status: CompareCase["status_a"]; passed: boolean | null }) {
  if (status === null) return <span className="text-xs text-muted-foreground">absent</span>;
  return status === "done" ? <PassMark passed={passed} /> : <CaseStatusBadge status={status} />;
}

/**
 * Every case of both runs with its class. A case regressed when a quality metric moved the bad
 * way beyond the per-case band (0.1 on 0–1 scores, any binary flip) and none moved the good way;
 * "mixed" when both happened. Latency and cost never classify.
 */
export function CaseList({
  cases,
  registry,
  a,
  b,
}: {
  cases: CompareCase[];
  registry: MetricInfo[];
  a: string;
  b: string;
}) {
  const index = useMemo(() => indexMetrics(registry), [registry]);
  const counts = useMemo(() => {
    const out: Record<string, number> = { [ALL]: cases.length };
    for (const c of cases) out[c.class] = (out[c.class] ?? 0) + 1;
    return out;
  }, [cases]);
  // Start on what most needs a look: regressions if there are any.
  const [filter, setFilter] = useState<string>(counts.regressed ? "regressed" : ALL);
  const rows = filter === ALL ? cases : cases.filter((c) => c.class === filter);

  return (
    <div className="flex flex-col gap-3">
      <ToggleGroup
        aria-label="Filter cases by class"
        variant="outline"
        size="sm"
        spacing={0}
        value={[filter]}
        onValueChange={(v: string[]) => v[0] && setFilter(v[0])}
        className="flex-wrap"
      >
        {[ALL, ...CLASS_ORDER].map((key) => (
          <ToggleGroupItem key={key} value={key} disabled={!counts[key] && key !== ALL} className="gap-1.5">
            {key === ALL ? "All" : CLASS_LABELS[key as CaseClass]}
            <span className="font-mono text-[0.7rem] text-muted-foreground tabular-nums">{counts[key] ?? 0}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <div className="@container overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Case</TableHead>
              <TableHead className="hidden @xl:table-cell">A → B</TableHead>
              <TableHead className="hidden @3xl:table-cell">What moved</TableHead>
              <TableHead className="text-right">Class</TableHead>
              <TableHead className="w-8">
                <span className="sr-only">Side by side</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  No cases in this class.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((c) => {
                const href = `/compare/case?a=${a}&b=${b}&key=${encodeURIComponent(c.case_key)}`;
                const moved = orderMetrics(Object.keys(c.changes), index);
                return (
                  <TableRow key={c.case_key} className="group/row">
                    <TableCell className="max-w-0 min-w-56 @xl:max-w-sm">
                      <Link
                        href={href}
                        className="flex min-w-0 flex-col gap-0.5 rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                      >
                        <span className="flex items-center gap-2">
                          <span className="font-mono text-xs font-medium group-hover/row:underline">{c.case_key}</span>
                          <span className="text-xs text-muted-foreground">{humanize(c.type)}</span>
                        </span>
                        <span className="truncate text-sm text-muted-foreground">{c.question}</span>
                      </Link>
                    </TableCell>
                    <TableCell className="hidden @xl:table-cell">
                      <span className="inline-flex items-center gap-1.5">
                        <Outcome status={c.status_a} passed={c.passed_a} />
                        <ArrowRightIcon className="size-3 text-muted-foreground" aria-label="then" />
                        <Outcome status={c.status_b} passed={c.passed_b} />
                      </span>
                    </TableCell>
                    <TableCell className="hidden @3xl:table-cell">
                      {moved.length ? (
                        <ul className="flex flex-wrap gap-x-3 gap-y-1">
                          {moved.map((key) => (
                            <li key={key} className="text-xs whitespace-nowrap">
                              <span className="text-muted-foreground">{metricLabel(key)}</span>{" "}
                              <span
                                className={cn(
                                  "font-mono tabular-nums",
                                  c.changes[key] === "regressed" ? "text-destructive" : "text-success",
                                )}
                              >
                                {formatDelta(c.deltas[key], index[key])}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {c.class === "unpaired" ? "Not done in both runs" : "Nothing beyond the per-case band"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className={cn("text-right text-xs font-medium", CLASS_TONE[c.class])}>
                      {CLASS_LABELS[c.class]}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={href}
                        aria-label={`${c.case_key} side by side`}
                        className="inline-flex rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                      >
                        <ChevronRightIcon className="size-4" />
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

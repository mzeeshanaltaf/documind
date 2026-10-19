"use client";

import { ChevronDownIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { MetricInfo, Trends } from "@/lib/api-types";
import { formatDateTime, shortId } from "@/lib/format";
import { formatMetric, indexMetrics, metricLabel } from "@/lib/metrics";
import { describeChange, KIND_LABELS, TrendChart } from "./trend-chart";

/** The charts for the chosen metrics (small multiples, one axis each), the change log and a table view. */
export function TrendBoard({ trends, metrics, registry }: { trends: Trends; metrics: string[]; registry: MetricInfo[] }) {
  const router = useRouter();
  const index = useMemo(() => indexMetrics(registry), [registry]);
  const markers = useMemo(() => new Map(trends.markers.map((m) => [m.run_id, m])), [trends.markers]);
  const [active, setActive] = useState<number | null>(null);
  const runName = useMemo(() => new Map(trends.runs.map((r) => [r.run_id, r.name || `Run ${shortId(r.run_id)}`])), [trends.runs]);
  const open = (runId: string) => router.push(`/runs/${runId}`);

  return (
    <div className="flex flex-col gap-10">
      <div className="grid gap-x-10 gap-y-8 lg:grid-cols-2">
        {metrics.map((key) => (
          <TrendChart
            key={key}
            metric={key}
            info={index[key]}
            runs={trends.runs}
            points={trends.series[key] ?? []}
            markers={markers}
            active={active}
            onActive={setActive}
            onOpen={open}
            format={(v) => formatMetric(v, index[key])}
          />
        ))}
      </div>

      <section className="flex flex-col gap-3">
        <header className="flex flex-col gap-0.5">
          <h2 className="font-sans text-sm font-semibold">Changes</h2>
          <p className="text-xs text-muted-foreground">
            Each diamond on the charts: what differs from the run before (config hash, DocuMind version, judge prompt
            versions, dataset version).
          </p>
        </header>
        {trends.markers.length === 0 ? (
          <p className="text-sm text-muted-foreground">Every run here shares one setup.</p>
        ) : (
          <ol className="flex flex-col divide-y rounded-lg border">
            {trends.markers.toReversed().map((m) => (
              <li key={m.run_id} className="flex flex-col gap-1.5 p-3 sm:flex-row sm:gap-6">
                <div className="flex w-56 shrink-0 flex-col gap-0.5">
                  <Link href={`/runs/${m.run_id}`} className="truncate text-sm font-medium hover:underline">
                    {runName.get(m.run_id)}
                  </Link>
                  <span className="text-xs text-muted-foreground">{formatDateTime(m.finished_at)}</span>
                  <Link
                    href={`/compare?a=${m.previous_run_id}&b=${m.run_id}`}
                    className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  >
                    Compare with the run before
                  </Link>
                </div>
                <ul className="flex min-w-0 flex-col gap-1 text-sm">
                  {m.changes.map((c) => (
                    <li key={c.key} className="min-w-0 font-mono text-xs wrap-break-word">
                      {describeChange(c)}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </section>

      <Collapsible>
        <CollapsibleTrigger className="group inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
          <ChevronDownIcon className="size-4 transition-transform group-data-panel-open:rotate-180" aria-hidden />
          Table view
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-3 overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Run</TableHead>
                  <TableHead>Dataset</TableHead>
                  {metrics.map((key) => (
                    <TableHead key={key} className="text-right">
                      {metricLabel(key)}
                    </TableHead>
                  ))}
                  <TableHead>Changed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trends.runs.map((run) => (
                  <TableRow key={run.run_id}>
                    <TableCell>
                      <Link href={`/runs/${run.run_id}`} className="flex flex-col hover:underline">
                        <span className="text-sm">{runName.get(run.run_id)}</span>
                        <span className="text-xs text-muted-foreground">{formatDateTime(run.finished_at)}</span>
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {run.dataset_slug} v{run.dataset_version ?? "?"}
                    </TableCell>
                    {metrics.map((key) => {
                      const point = trends.series[key]?.find((p) => p.run_id === run.run_id);
                      return (
                        <TableCell key={key} className="text-right font-mono text-xs tabular-nums">
                          {formatMetric(point?.mean ?? null, index[key])}
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-xs text-muted-foreground">
                      {markers.get(run.run_id)?.kinds.map((k) => KIND_LABELS[k]).join(", ") ?? ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

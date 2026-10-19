"use client";

import { ChevronDownIcon, GitCompareArrowsIcon } from "lucide-react";
import Link from "next/link";
import { ButtonLink } from "@/components/button-link";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useRunEvents } from "@/hooks/use-run-events";
import {
  type AggregateOut,
  type MetricInfo,
  type RunCaseOut,
  type RunDetail,
  TERMINAL_RUN_STATUSES,
} from "@/lib/api-types";
import { elapsedMs, formatCost, formatDateTime, formatDuration, shortId } from "@/lib/format";
import {
  formatMetric,
  GROUP_LABELS,
  groupMetrics,
  indexMetrics,
  KEY_METRICS,
  KEY_METRICS_RETRIEVAL,
  metricLabel,
} from "@/lib/metrics";
import { cn } from "@/lib/utils";
import { CaseTable } from "./case-table";
import { fromAggregate, MetricStrip, provisional } from "./metric-strip";
import { RunControls } from "./run-controls";
import { RunProgress } from "./run-progress";
import { runTitle } from "./runs-table";
import { SlicesHeatmap } from "./slices-heatmap";
import { RunStatusBadge } from "./status";

const CASE_COLUMNS_FULL = ["faithfulness", "answer_quality", "behavior_correct", "hit@k"];
const CASE_COLUMNS_RETRIEVAL = ["hit@5", "mrr", "recall_section@k", "ndcg@k"];

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return (await response.json()) as T;
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <header className="flex flex-col gap-0.5">
        <h2 className="font-sans text-sm font-semibold">{title}</h2>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </header>
      {children}
    </section>
  );
}

export function LiveRun({
  initialRun,
  initialCases,
  initialAggregates,
  registry,
}: {
  initialRun: RunDetail;
  initialCases: RunCaseOut[];
  initialAggregates: AggregateOut[];
  registry: MetricInfo[];
}) {
  const { run, cases, transport, follow } = useRunEvents(initialRun, initialCases);
  const index = useMemo(() => indexMetrics(registry), [registry]);
  const terminal = TERMINAL_RUN_STATUSES.includes(run.status);

  const modes = run.mode === "full" ? ["chat"] : (run.config.retrieval_modes ?? ["bm25", "vector", "hybrid"]);
  const [mode, setMode] = useState(modes.includes("hybrid") ? "hybrid" : modes[0]);

  // Aggregates exist once the run finalizes: fetched again when it gets there.
  const { data: aggregates = [] } = useSWR(
    terminal ? `/api/backend/runs/${run.id}/aggregates` : null,
    getJson<AggregateOut[]>,
    { fallbackData: initialAggregates, revalidateOnMount: initialAggregates.length === 0, revalidateOnFocus: false },
  );

  const overall = useMemo(
    () => new Map(aggregates.filter((a) => a.slice === "all" && a.mode === mode).map((a) => [a.metric, a])),
    [aggregates, mode],
  );
  const keyMetrics = run.mode === "full" ? KEY_METRICS : KEY_METRICS_RETRIEVAL;
  const present = (key: string) =>
    overall.has(key) || key === "case_pass" || cases.some((c) => c.metrics[mode]?.[key] !== undefined);
  const summaries = keyMetrics.filter(present).map((key) => {
    const aggregate = overall.get(key);
    return aggregate ? fromAggregate(aggregate) : provisional(key, cases, mode);
  });
  const thresholds = run.config.metrics?.thresholds ?? {};
  const columns = (run.mode === "full" ? CASE_COLUMNS_FULL : CASE_COLUMNS_RETRIEVAL).filter(present);

  const started = run.started_at ?? run.created_at;
  const duration = elapsedMs(started, run.finished_at);
  const effective = (run.config.effective ?? {}) as Record<string, unknown>;

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <RunStatusBadge status={run.status} reason={run.status_reason} />
              {transport !== "idle" && (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span
                    className={cn("size-1.5 rounded-full", transport === "stream" ? "bg-success motion-safe:animate-pulse" : "bg-warning")}
                    aria-hidden
                  />
                  {transport === "stream" ? "Live" : "Refreshing every 3 s"}
                </span>
              )}
              {run.partial && <span className="text-xs text-muted-foreground">Partial</span>}
            </div>
            <h1 className="font-heading text-2xl leading-tight font-semibold tracking-[-0.01em]">{runTitle(run)}</h1>
            <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {run.dataset && (
                <Link href={`/datasets/${run.dataset.dataset_id}/v/${run.dataset.version}`} className="font-mono hover:underline">
                  {run.dataset.slug} v{run.dataset.version}
                </Link>
              )}
              <span className="font-mono">{run.org_slug}</span>
              <span>{run.mode === "full" ? "Full run" : "Retrieval only"}</span>
              {run.source_run_id && (
                <Link href={`/runs/${run.source_run_id}`} className="hover:underline">
                  Rejudge of <span className="font-mono">{shortId(run.source_run_id)}</span>
                </Link>
              )}
              <span className="font-mono">{shortId(run.id)}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(terminal || run.status === "stopped") && (
              <ButtonLink href={`/compare?a=${run.id}`} variant="outline" size="sm">
                <GitCompareArrowsIcon data-icon="inline-start" />
                Compare with…
              </ButtonLink>
            )}
            <RunControls run={run} onChanged={follow} />
          </div>
        </div>

        <div className="grid gap-x-8 gap-y-4 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-1">
            <span className="text-xs text-muted-foreground">Progress</span>
            <RunProgress run={run} />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">DocuMind cost</span>
            <span className="font-mono text-sm tabular-nums">{formatCost(run.documind_cost_usd)}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Judge cost</span>
            <span className="font-mono text-sm tabular-nums">
              {formatCost(run.judge_cost_usd)}
              {run.max_judge_cost_usd !== null && (
                <span className="text-muted-foreground"> of {formatCost(run.max_judge_cost_usd)}</span>
              )}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{run.finished_at ? "Took" : "Running for"}</span>
            <span className="text-sm tabular-nums">
              {formatDuration(duration)}
              <span className="block text-xs text-muted-foreground">from {formatDateTime(started)}</span>
            </span>
          </div>
        </div>
        {run.error && <p className="text-sm text-destructive">{run.error}</p>}

        <Collapsible>
          <CollapsibleTrigger className="group inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
            <ChevronDownIcon className="size-4 transition-transform group-data-panel-open:rotate-180" aria-hidden />
            Configuration
          </CollapsibleTrigger>
          <CollapsibleContent>
            <dl className="mt-3 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {[
                ["Top k", effective.top_k],
                ["Retrieval", run.mode === "full" ? effective.retrieval_mode : modes.join(", ")],
                ["Chat model", effective.chat_model],
                ["Router model", effective.router_model],
                ["Service tier", effective.chat_service_tier],
                ["Judge", run.config.judge?.enabled === false ? "off" : `on, ${run.config.judge?.samples ?? 1} sample(s)`],
                ["Rubric model", run.config.judge?.models?.rubric ?? "prompt default"],
                ["Claims model", run.config.judge?.models?.claims ?? "prompt default"],
                ["Gates", (run.config.metrics?.gates ?? ["default gates"]).map(metricLabel).join(", ")],
                ["Config hash", shortId(run.config_hash)],
                ["Tags", run.tags.join(", ") || "none"],
              ].map(([label, value]) => (
                <div key={String(label)} className="flex justify-between gap-4 border-b py-1.5">
                  <dt className="text-muted-foreground">{String(label)}</dt>
                  <dd className="truncate text-right font-mono text-xs">{value === undefined || value === null ? "n/a" : String(value)}</dd>
                </div>
              ))}
            </dl>
          </CollapsibleContent>
        </Collapsible>
      </header>

      {modes.length > 1 && (
        <ToggleGroup
          aria-label="Retrieval mode"
          variant="outline"
          size="sm"
          spacing={0}
          value={[mode]}
          onValueChange={(v: string[]) => v[0] && setMode(v[0])}
        >
          {modes.map((m) => (
            <ToggleGroupItem key={m} value={m} className="font-mono">
              {m}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}

      <Section
        title="Key metrics"
        description={
          terminal ? "Means with 95% confidence intervals over the finished cases." : "Running means over the cases finished so far."
        }
      >
        <MetricStrip summaries={summaries} index={index} thresholds={thresholds} />
        {overall.size > 0 && <AllMetrics overall={overall} index={index} />}
      </Section>

      <Section title="Slices" description="Each metric's mean per case type, department, jurisdiction and tag.">
        <SlicesHeatmap aggregates={aggregates} index={index} mode={mode} keyMetrics={keyMetrics} />
      </Section>

      <Section title="Cases">
        <CaseTable runId={run.id} cases={cases} mode={mode} columns={columns} index={index} />
      </Section>
    </div>
  );
}

function AllMetrics({ overall, index }: { overall: Map<string, AggregateOut>; index: ReturnType<typeof indexMetrics> }) {
  const groups = groupMetrics([...overall.keys()], index);
  const count = groups.reduce((n, g) => n + g.keys.length, 0);
  return (
    <Collapsible>
      <CollapsibleTrigger className="group inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
        <ChevronDownIcon className="size-4 transition-transform group-data-panel-open:rotate-180" aria-hidden />
        All {count} metrics
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-3 overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Metric</TableHead>
                <TableHead className="text-right">Mean</TableHead>
                <TableHead className="hidden text-right sm:table-cell">95% CI</TableHead>
                <TableHead className="text-right">n</TableHead>
                <TableHead className="hidden text-right sm:table-cell">n/a</TableHead>
                <TableHead className="hidden text-right md:table-cell">Pass rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.flatMap(({ group, keys }) => [
                <TableRow key={`g-${group}`} className="hover:bg-transparent">
                  <TableCell colSpan={6} className="bg-muted/50 py-1.5 text-xs font-semibold text-muted-foreground">
                    {GROUP_LABELS[group] ?? group}
                  </TableCell>
                </TableRow>,
                ...keys.map((key) => <AggregateRow key={key} aggregate={overall.get(key)!} info={index[key]} />),
              ])}
            </TableBody>
          </Table>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function AggregateRow({ aggregate: a, info }: { aggregate: AggregateOut; info: MetricInfo | undefined }) {
  const details = a.details as Record<string, number>;
  return (
    <TableRow>
      <TableCell title={info?.description}>{metricLabel(a.metric)}</TableCell>
      <TableCell className="text-right font-mono text-xs tabular-nums">
        {formatMetric(a.mean, info)}
        {details.p50 !== undefined && <span className="block text-muted-foreground">p50 {formatMetric(details.p50, info)}</span>}
      </TableCell>
      <TableCell className="hidden text-right font-mono text-xs text-muted-foreground tabular-nums sm:table-cell">
        {a.ci_low !== null && a.ci_high !== null ? `${formatMetric(a.ci_low, info)} to ${formatMetric(a.ci_high, info)}` : "n/a"}
      </TableCell>
      <TableCell className="text-right tabular-nums">{a.n}</TableCell>
      <TableCell className="hidden text-right text-muted-foreground tabular-nums sm:table-cell">{details.na || ""}</TableCell>
      <TableCell className="hidden text-right tabular-nums md:table-cell">
        {a.pass_rate === null ? "" : `${Math.round(a.pass_rate * 100)}%`}
      </TableCell>
    </TableRow>
  );
}

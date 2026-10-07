import { ChartNoAxesColumnIcon } from "lucide-react";
import type { Option } from "@/components/app/option-select";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AnalyticsRange } from "@/lib/analytics-range";
import type { Analytics } from "@/lib/api-types";
import {
  formatCompact,
  formatCost,
  formatCount,
  formatDate,
  formatDayMonth,
  formatDuration,
  formatPercent,
  formatUnitCost,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { AnalyticsCharts } from "./analytics-charts";
import { DailyTable } from "./daily-table";
import { RangePicker } from "./range-picker";

const OPERATION_LABELS: Record<string, string> = {
  answer: "Answers",
  router: "Routing",
  embed_query: "Query embeddings",
  title: "Conversation titles",
  classify: "Document classification",
  summarize: "Document summaries",
  embed_ingest: "Document embeddings",
};

const TIER_LABELS: Record<string, string> = { default: "Standard", standard: "Standard", flex: "Flex", auto: "Auto" };

type Column<T> = { header: string; cell: (row: T) => React.ReactNode; numeric?: boolean; className?: string };

function DataTable<T>({ title, rows, columns, empty }: { title: string; rows: T[]; columns: Column<T>[]; empty: string }) {
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label={title}>
      <h2 className="font-sans text-sm font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="rounded-lg border px-4 py-6 text-center text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((c) => (
                  <TableHead key={c.header} className={cn(c.numeric && "text-right", c.className)}>
                    {c.header}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, i) => (
                <TableRow key={i}>
                  {columns.map((c) => (
                    <TableCell key={c.header} className={cn(c.numeric && "text-right tabular-nums", c.className)}>
                      {c.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 bg-background px-4 py-3.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-xl leading-tight font-semibold">{value}</dd>
      {detail && <dd className="truncate text-xs text-muted-foreground">{detail}</dd>}
    </div>
  );
}

export function AnalyticsDashboard({
  data,
  range,
  orgs,
  orgId,
}: {
  data: Analytics;
  range: AnalyticsRange;
  /** Platform view only: adds the organization filter. */
  orgs?: Option[];
  orgId?: string | null;
}) {
  const t = data.totals;
  const rated = data.feedback.up + data.feedback.down;
  const perAnswer = t.requests ? t.cost_usd / t.requests : null;
  const hasUsage = t.calls > 0;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <RangePicker range={range} orgs={orgs} orgId={orgId} />
        <p className="text-xs text-muted-foreground tabular-nums">
          {formatDate(range.from)} to {formatDate(range.to)} (UTC)
        </p>
      </div>

      {/* Hairline dividers: a 1px gap over the border colour, one rule system at every breakpoint. */}
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4">
        <Stat label="Total cost" value={formatCost(t.cost_usd)} detail={perAnswer !== null ? `${formatUnitCost(perAnswer)} per answer, all calls` : "No answers yet"} />
        <Stat label="Answers" value={formatCount(t.requests)} detail={`${formatCount(t.calls)} LLM calls in all`} />
        <Stat
          label="Tokens in / out"
          value={`${formatCompact(t.input_tokens)} / ${formatCompact(t.output_tokens)}`}
          detail={t.reasoning_tokens ? `${formatCompact(t.reasoning_tokens)} reasoning` : undefined}
        />
        <Stat label="Cache hit" value={formatPercent(t.cache_hit_pct, 1)} detail={`${formatCompact(t.cached_tokens)} cached input tokens`} />
        <Stat label="Answer latency p50" value={formatDuration(t.p50_latency_ms)} detail={`p95 ${formatDuration(t.p95_latency_ms)}`} />
        <Stat label="First token p50" value={formatDuration(t.p50_ttft_ms)} detail={`p95 ${formatDuration(t.p95_ttft_ms)}`} />
        <Stat
          label="Rated helpful"
          value={rated ? formatPercent((100 * data.feedback.up) / rated) : "n/a"}
          detail={rated ? `${data.feedback.up} helpful, ${data.feedback.down} not` : "No ratings yet"}
        />
        <Stat label="Errors" value={formatCount(t.errors)} detail={t.calls ? `${formatPercent((100 * t.errors) / t.calls, 1)} of calls` : undefined} />
      </dl>

      {!hasUsage ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ChartNoAxesColumnIcon />
            </EmptyMedia>
            <EmptyTitle>No usage in this range</EmptyTitle>
            <EmptyDescription>Ask a few questions or upload documents, then come back. Costs appear as soon as calls finish.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <AnalyticsCharts points={data.timeseries} granularity={data.range.granularity} />
          <DailyTable points={data.timeseries} granularity={data.range.granularity} />

          <div className="grid gap-x-10 gap-y-8 xl:grid-cols-2">
            <DataTable
              title="By operation"
              rows={data.by_operation}
              empty="No calls."
              columns={[
                { header: "Operation", cell: (r) => OPERATION_LABELS[r.operation] ?? r.operation },
                { header: "Calls", cell: (r) => formatCount(r.calls), numeric: true },
                { header: "Tokens", cell: (r) => formatCompact(r.input_tokens + r.output_tokens), numeric: true },
                { header: "Avg latency", cell: (r) => formatDuration(r.avg_latency_ms), numeric: true, className: "hidden sm:table-cell" },
                { header: "Cost", cell: (r) => formatCost(r.cost_usd), numeric: true },
              ]}
            />
            <DataTable
              title="By model and tier"
              rows={data.by_model_tier}
              empty="No calls."
              columns={[
                { header: "Model", cell: (r) => <span className="font-mono text-xs">{r.model}</span> },
                { header: "Tier", cell: (r) => <Badge variant="outline">{TIER_LABELS[r.tier] ?? r.tier}</Badge> },
                { header: "Calls", cell: (r) => formatCount(r.calls), numeric: true, className: "hidden sm:table-cell" },
                { header: "Answers", cell: (r) => formatCount(r.answers), numeric: true },
                {
                  header: "Cost / answer",
                  cell: (r) => (r.answers ? formatUnitCost(r.answer_cost_usd / r.answers) : "n/a"),
                  numeric: true,
                },
                { header: "Cost", cell: (r) => formatCost(r.cost_usd), numeric: true },
              ]}
            />
            <DataTable
              title="Top users"
              rows={data.by_user}
              empty="No questions from signed-in users yet."
              columns={[
                {
                  header: "Person",
                  cell: (r) => (
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{r.name || r.email || "Deleted user"}</span>
                      {r.name && r.email && <span className="truncate text-xs text-muted-foreground">{r.email}</span>}
                    </span>
                  ),
                },
                { header: "Answers", cell: (r) => formatCount(r.requests), numeric: true },
                { header: "Tokens", cell: (r) => formatCompact(r.tokens), numeric: true, className: "hidden sm:table-cell" },
                { header: "Cost", cell: (r) => formatCost(r.cost_usd), numeric: true },
              ]}
            />
            <DataTable
              title="By agent"
              rows={data.by_agent}
              empty="No answers yet."
              columns={[
                {
                  header: "Agent",
                  cell: (r) => (r.agent === "Scoped" ? "Scoped to documents" : r.agent === "General" ? "General" : `${r.agent} agent`),
                },
                { header: "Answers", cell: (r) => formatCount(r.messages), numeric: true },
                {
                  header: "Helpful",
                  cell: (r) => (r.up + r.down ? `${r.up} / ${r.up + r.down}` : "n/a"),
                  numeric: true,
                  className: "hidden sm:table-cell",
                },
                { header: "Cost", cell: (r) => formatCost(r.cost_usd), numeric: true },
              ]}
            />
            <DataTable
              title="Most cited documents"
              rows={data.top_documents}
              empty="No citations yet."
              columns={[
                {
                  header: "Document",
                  cell: (r) => (
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{r.title ?? "Deleted document"}</span>
                      {r.doc_code && <span className="font-mono text-[0.7rem] text-muted-foreground">{r.doc_code}</span>}
                    </span>
                  ),
                },
                { header: "Citations", cell: (r) => formatCount(r.citations), numeric: true },
                { header: "Answers", cell: (r) => formatCount(r.messages), numeric: true },
              ]}
            />
          </div>
        </>
      )}
      <p className="text-xs text-muted-foreground">
        Costs are computed per call from the model price list at the tier that actually served it. Days are UTC; the last
        bucket ends {formatDayMonth(range.to)}.
      </p>
    </div>
  );
}

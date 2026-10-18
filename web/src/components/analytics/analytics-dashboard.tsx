import { ChartNoAxesColumnIcon } from "lucide-react";
import type { Option } from "@/components/app/option-select";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
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
import { AnalyticsCharts, ChartFrame } from "./analytics-charts";
import { DailyTable } from "./daily-table";
import { RangePicker } from "./range-picker";
import { RankedBarChart } from "./ranked-bar-chart";

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

          <div className="grid gap-x-10 gap-y-10 xl:grid-cols-2">
            <ChartFrame title="By operation" description="LLM cost per operation; hover for calls, tokens and latency">
              <RankedBarChart
                measure="Cost"
                items={[...data.by_operation]
                  .sort((x, y) => y.cost_usd - x.cost_usd)
                  .map((r) => ({
                    key: r.operation,
                    label: OPERATION_LABELS[r.operation] ?? r.operation,
                    value: r.cost_usd,
                    valueLabel: formatCost(r.cost_usd),
                    details: [
                      { label: "Cost", value: formatCost(r.cost_usd) },
                      { label: "Calls", value: formatCount(r.calls) },
                      { label: "Tokens", value: formatCompact(r.input_tokens + r.output_tokens) },
                      { label: "Avg latency", value: formatDuration(r.avg_latency_ms) },
                    ],
                  }))}
              />
            </ChartFrame>
            <ChartFrame title="By model and tier" description="LLM cost per model and service tier; hover for calls and cost per answer">
              <RankedBarChart
                measure="Cost"
                items={[...data.by_model_tier]
                  .sort((x, y) => y.cost_usd - x.cost_usd)
                  .map((r) => ({
                    key: `${r.model}:${r.tier}`,
                    label: `${r.model} · ${TIER_LABELS[r.tier] ?? r.tier}`,
                    value: r.cost_usd,
                    valueLabel: formatCost(r.cost_usd),
                    details: [
                      { label: "Cost", value: formatCost(r.cost_usd) },
                      { label: "Calls", value: formatCount(r.calls) },
                      { label: "Answers", value: formatCount(r.answers) },
                      { label: "Cost / answer", value: r.answers ? formatUnitCost(r.answer_cost_usd / r.answers) : "n/a" },
                    ],
                  }))}
              />
            </ChartFrame>
            <ChartFrame title="Top users" description="Answers per person; hover for tokens and cost">
              <RankedBarChart
                measure="Answers"
                items={data.by_user.map((r) => ({
                  key: r.user_id,
                  label: r.name || r.email || "Deleted user",
                  value: r.requests,
                  valueLabel: formatCount(r.requests),
                  details: [
                    ...(r.email ? [{ label: "Email", value: r.email }] : []),
                    { label: "Answers", value: formatCount(r.requests) },
                    { label: "Tokens", value: formatCompact(r.tokens) },
                    { label: "Cost", value: formatCost(r.cost_usd) },
                  ],
                }))}
              />
            </ChartFrame>
            <ChartFrame title="By agent" description="Answers per specialist agent; hover for ratings and cost">
              <RankedBarChart
                measure="Answers"
                items={[...data.by_agent]
                  .sort((x, y) => y.messages - x.messages)
                  .map((r) => ({
                    key: r.agent,
                    label: r.agent === "Scoped" ? "Scoped to documents" : r.agent === "General" ? "General" : `${r.agent} agent`,
                    value: r.messages,
                    valueLabel: formatCount(r.messages),
                    details: [
                      { label: "Answers", value: formatCount(r.messages) },
                      { label: "Helpful", value: r.up + r.down ? `${r.up} / ${r.up + r.down}` : "n/a" },
                      { label: "Cost", value: formatCost(r.cost_usd) },
                    ],
                  }))}
              />
            </ChartFrame>
            <ChartFrame title="Most cited documents" description="Citations per document; hover for the full title">
              <RankedBarChart
                measure="Citations"
                items={data.top_documents.map((r, i) => ({
                  key: r.document_id ?? `${i}`,
                  label: r.title ?? "Deleted document",
                  value: r.citations,
                  valueLabel: formatCount(r.citations),
                  details: [
                    ...(r.doc_code ? [{ label: "Code", value: r.doc_code }] : []),
                    { label: "Citations", value: formatCount(r.citations) },
                    { label: "Answers", value: formatCount(r.messages) },
                  ],
                }))}
              />
            </ChartFrame>
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

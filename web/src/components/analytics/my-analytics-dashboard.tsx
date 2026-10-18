import { ChartNoAxesColumnIcon } from "lucide-react";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import type { AnalyticsRange } from "@/lib/analytics-range";
import type { MyAnalytics, Quota } from "@/lib/api-types";
import { formatCompact, formatCount, formatDate, formatDayMonth, formatDuration, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MyAnalyticsCharts } from "./my-analytics-charts";
import { RangePicker } from "./range-picker";

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 bg-background px-4 py-3.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-xl leading-tight font-semibold tabular-nums">{value}</dd>
      {detail && <dd className="truncate text-xs text-muted-foreground">{detail}</dd>}
    </div>
  );
}

function Meter({ label, used, limit, format }: { label: string; used: number; limit: number; format: (n: number) => string }) {
  const fill = limit ? Math.min(1, used / limit) : 1;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground tabular-nums">
          {format(used)} of {format(limit)}
        </span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={Math.min(used, limit)}
        className="h-2 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn("h-full rounded-full", fill >= 1 ? "bg-destructive" : "bg-primary")}
          style={{ width: `${Math.max(fill * 100, used > 0 ? 2 : 0)}%` }}
        />
      </div>
    </div>
  );
}

function QuotaCard({ quota }: { quota: Quota }) {
  if (quota.unlimited) {
    return (
      <section aria-label="Monthly quota" className="rounded-lg border px-4 py-3.5 text-sm text-muted-foreground">
        Platform admin accounts have no monthly message or token limit.
      </section>
    );
  }
  return (
    <section aria-label="Monthly quota" className="flex flex-col gap-4 rounded-lg border px-4 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-sans text-sm font-semibold">This month&apos;s quota</h2>
        <p className="text-xs text-muted-foreground">
          Covers all your organizations. Renews on {formatDayMonth(quota.resets_on)} (UTC).
        </p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Meter label="Messages" used={quota.messages_used} limit={quota.message_limit} format={formatCount} />
        <Meter label="Tokens" used={quota.tokens_used} limit={quota.token_limit} format={formatCompact} />
      </div>
      {quota.exhausted && (
        <p role="status" className="text-sm">
          You&apos;ve reached your {quota.exhausted === "messages" ? "message" : "token"} limit, so new questions are paused
          until the quota renews. Ask an administrator if you need more.
        </p>
      )}
    </section>
  );
}

export function MyAnalyticsDashboard({ data, range }: { data: MyAnalytics; range: AnalyticsRange }) {
  const t = data.totals;
  const rated = t.up + t.down;

  return (
    <div className="flex flex-col gap-8">
      <QuotaCard quota={data.quota} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <RangePicker range={range} />
        <p className="text-xs text-muted-foreground tabular-nums">
          {formatDate(range.from)} to {formatDate(range.to)} (UTC)
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4">
        <Stat label="Conversations" value={formatCount(t.conversations)} detail={`${formatCount(t.conversations_total)} in all`} />
        <Stat
          label="Messages sent"
          value={formatCount(t.questions)}
          detail={t.answers !== t.questions ? `${formatCount(t.answers)} answered` : undefined}
        />
        <Stat
          label="Tokens used"
          value={formatCompact(t.total_tokens)}
          detail={`${formatCompact(t.input_tokens)} in, ${formatCompact(t.output_tokens)} out`}
        />
        <Stat label="Bookmarks" value={formatCount(t.bookmarks)} detail="Saved answers" />
        <Stat label="Liked" value={formatCount(t.up)} detail={rated ? `${formatPercent((100 * t.up) / rated)} of rated answers` : "No ratings yet"} />
        <Stat label="Disliked" value={formatCount(t.down)} detail={rated ? `${formatPercent((100 * t.down) / rated)} of rated answers` : "No ratings yet"} />
        <Stat label="Response time" value={formatDuration(t.p50_latency_ms)} detail={`Typical (median), slowest 5% ${formatDuration(t.p95_latency_ms)}`} />
        <Stat label="First words" value={formatDuration(t.p50_ttft_ms)} detail="Typical time until the answer starts" />
      </dl>

      {t.questions === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ChartNoAxesColumnIcon />
            </EmptyMedia>
            <EmptyTitle>No questions in this range</EmptyTitle>
            <EmptyDescription>Ask something in the chat, or pick a longer range.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <MyAnalyticsCharts points={data.timeseries} granularity={data.range.granularity} />
      )}
      <p className="text-xs text-muted-foreground">
        Only you can see this page. It counts your activity in this organization; days are UTC. Response time runs from
        sending a question to the end of the answer.
      </p>
    </div>
  );
}

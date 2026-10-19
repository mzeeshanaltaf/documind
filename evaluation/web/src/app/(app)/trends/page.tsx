import { TrendingUpIcon } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { PageSkeleton } from "@/components/app/shell-skeleton";
import { TrendBoard } from "@/components/trends/trend-board";
import { TrendFilters } from "@/components/trends/trend-filters";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import type { DatasetOut, MetricInfo, RunOut, Trends } from "@/lib/api-types";
import { requireAdmin } from "@/lib/auth-guards";
import { apiJson } from "@/lib/eval-api";
import { plural } from "@/lib/format";
import { indexMetrics, KEY_METRICS, KEY_METRICS_RETRIEVAL, orderMetrics } from "@/lib/metrics";

export const metadata: Metadata = { title: "Trends" };

const LIMIT = 50;

export default function TrendsPage({ searchParams }: PageProps<"/trends">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <TrendsView searchParams={searchParams} />
    </Suspense>
  );
}

function one(value: string | string[] | undefined): string | null {
  return (Array.isArray(value) ? value[0] : value) || null;
}

async function TrendsView({ searchParams }: { searchParams: PageProps<"/trends">["searchParams"] }) {
  const { user } = await requireAdmin();
  const params = await searchParams;
  const opts = { userId: user.id };
  const dataset = one(params.dataset);
  const org = one(params.org);
  const [{ datasets }, { runs }, registry] = await Promise.all([
    apiJson<{ datasets: DatasetOut[] }>("datasets", opts),
    apiJson<{ runs: RunOut[] }>("runs", { ...opts, query: { status: "completed", limit: 200 } }),
    apiJson<MetricInfo[]>("metrics", opts),
  ]);

  // Default run mode: the newest completed run's within the filters.
  const newest = runs.find((r) => (!dataset || r.dataset?.dataset_id === dataset) && (!org || r.org_slug === org));
  const runMode = one(params.run_mode) === "retrieval_only" || (!one(params.run_mode) && newest?.mode === "retrieval_only") ? "retrieval_only" : "full";
  const mode = runMode === "full" ? "chat" : (one(params.mode) ?? "hybrid");
  const index = indexMetrics(registry);
  const requested = one(params.metrics)?.split(",").filter((k) => k in index);
  const metrics = orderMetrics(requested?.length ? requested : runMode === "full" ? KEY_METRICS : KEY_METRICS_RETRIEVAL, index);
  const slice = one(params.slice) ?? "all";

  const trends = await apiJson<Trends>("trends", {
    ...opts,
    query: { dataset_id: dataset, org, run_mode: runMode, mode, slice, metrics: metrics.join(","), limit: LIMIT },
  });
  const orgs = [...new Set(runs.map((r) => r.org_slug))].sort();

  return (
    <PageContainer className="max-w-6xl gap-8">
      <PageHeader
        title="Trends"
        description={`Completed, non-partial runs, oldest to newest (the latest ${LIMIT}). Bands are 95% CIs; diamonds mark a change from the run before.`}
      />
      <TrendFilters
        datasets={datasets.map((d) => ({ value: d.id, label: d.name }))}
        orgs={orgs}
        slices={trends.slices}
        registry={registry}
        value={{ dataset, org, runMode, mode, slice, metrics }}
      />
      {trends.runs.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <TrendingUpIcon />
            </EmptyMedia>
            <EmptyTitle>No completed runs match</EmptyTitle>
            <EmptyDescription>
              {runMode === "full" ? "Full" : "Retrieval-only"} runs show up here once they complete. Try the other run mode
              or clear a filter.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <p className="-mt-4 text-xs text-muted-foreground">
            {plural(trends.runs.length, "run")} · {plural(trends.markers.length, "change")}
            {slice !== "all" && <> · slice {slice}</>}
          </p>
          <TrendBoard trends={trends} metrics={metrics} registry={registry} />
        </>
      )}
    </PageContainer>
  );
}

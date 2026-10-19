import { CircleAlertIcon, GitCompareArrowsIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { PageSkeleton } from "@/components/app/shell-skeleton";
import { CaseList } from "@/components/compare/case-list";
import { ConfigDiff } from "@/components/compare/config-diff";
import { MetricDiffTable } from "@/components/compare/metric-diff-table";
import { RunPickers } from "@/components/compare/run-pickers";
import { runTitle } from "@/components/runs/runs-table";
import { RunStatusBadge } from "@/components/runs/status";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import type { Comparison, MetricInfo, RunOut } from "@/lib/api-types";
import { requireAdmin } from "@/lib/auth-guards";
import { verdictOf } from "@/lib/compare";
import { ApiError, apiJson } from "@/lib/eval-api";
import { formatDateTime, plural, shortId } from "@/lib/format";
import { indexMetrics } from "@/lib/metrics";

export const metadata: Metadata = { title: "Compare" };

export default function ComparePage({ searchParams }: PageProps<"/compare">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Compare searchParams={searchParams} />
    </Suspense>
  );
}

function one(value: string | string[] | undefined): string | null {
  return (Array.isArray(value) ? value[0] : value) || null;
}

const FINISHED = new Set(["completed", "stopped"]);

function scoringModes(run: RunOut | undefined): string[] {
  if (!run) return [];
  return run.mode === "full" ? ["chat"] : (run.config.retrieval_modes ?? ["bm25", "vector", "hybrid"]);
}

/** The newest finished run on the same dataset and run mode as `run`, other than it. */
function newestPeer(runs: RunOut[], run: RunOut | undefined): RunOut | undefined {
  if (!run) return undefined;
  return runs.find(
    (r) => r.id !== run.id && FINISHED.has(r.status) && r.dataset?.dataset_id === run.dataset?.dataset_id && r.mode === run.mode,
  );
}

function optionLabel(run: RunOut): string {
  const dataset = run.dataset ? `${run.dataset.slug} v${run.dataset.version}` : "dataset n/a";
  return `${runTitle(run)} · ${dataset} · ${run.mode === "full" ? "full" : "retrieval"} · ${formatDateTime(run.finished_at ?? run.created_at)}`;
}

function Section({ id, title, description, children }: { id: string; title: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <header className="flex flex-col gap-0.5">
        <h2 id={id} className="font-sans text-sm font-semibold">
          {title}
        </h2>
        {description && <p className="max-w-[80ch] text-xs text-muted-foreground">{description}</p>}
      </header>
      {children}
    </section>
  );
}

async function Compare({ searchParams }: { searchParams: PageProps<"/compare">["searchParams"] }) {
  const { user } = await requireAdmin();
  const params = await searchParams;
  const opts = { userId: user.id };
  const [{ runs }, registry] = await Promise.all([
    apiJson<{ runs: RunOut[] }>("runs", { ...opts, query: { limit: 200 } }),
    apiJson<MetricInfo[]>("metrics", opts),
  ]);
  const byId = new Map(runs.map((r) => [r.id, r]));

  // Defaults: B is the newest run on A's dataset; with neither, the latest two finished runs.
  let a = one(params.a);
  let b = one(params.b);
  if (a && !b) b = newestPeer(runs, byId.get(a))?.id ?? null;
  else if (!a && b) a = newestPeer(runs, byId.get(b))?.id ?? null;
  else if (!a && !b) {
    const latest = runs.find((r) => FINISHED.has(r.status));
    b = latest?.id ?? null;
    a = newestPeer(runs, latest)?.id ?? null;
  }
  const mode = one(params.mode);

  let comparison: Comparison | null = null;
  let refusal: string | null = null;
  if (a && b) {
    try {
      comparison = await apiJson<Comparison>("compare", { ...opts, query: { a, b, mode } });
    } catch (error) {
      if (!(error instanceof ApiError) || ![404, 422].includes(error.status)) throw error;
      refusal = error.message;
    }
  }

  const options = runs
    .filter((r) => FINISHED.has(r.status) || r.id === a || r.id === b)
    .map((r) => ({ value: r.id, label: optionLabel(r) }));
  const runA = byId.get(a ?? "");
  const runB = byId.get(b ?? "");
  const shared = scoringModes(runA).filter((m) => scoringModes(runB).includes(m));

  return (
    <PageContainer className="max-w-6xl gap-10">
      <div className="flex flex-col gap-5">
        <PageHeader
          title="Compare"
          description="Two runs paired on case keys. Δ is B minus A; each quality metric gets a paired test, Holm-adjusted across the table."
        />
        <RunPickers runs={options} a={a} b={b} mode={comparison?.mode ?? mode} modes={shared} />
      </div>

      {!a || !b ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <GitCompareArrowsIcon />
            </EmptyMedia>
            <EmptyTitle>Pick two runs</EmptyTitle>
            <EmptyDescription>
              A is the baseline, B the candidate. Runs on the same dataset compare every case; different dataset versions
              compare the case keys they share.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : refusal || !comparison ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>These runs can&apos;t be compared</AlertTitle>
          <AlertDescription>{refusal}</AlertDescription>
        </Alert>
      ) : (
        <ComparisonView comparison={comparison} registry={registry} />
      )}
    </PageContainer>
  );
}

function RunLine({ side, run }: { side: "A" | "B"; run: RunOut }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs font-semibold text-muted-foreground">{side}</span>
        <Link href={`/runs/${run.id}`} className="truncate font-medium hover:underline">
          {runTitle(run)}
        </Link>
        <RunStatusBadge status={run.status} reason={run.status_reason} />
      </div>
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {run.dataset && (
          <span className="font-mono">
            {run.dataset.slug} v{run.dataset.version}
          </span>
        )}
        <span>{run.mode === "full" ? "Full run" : "Retrieval only"}</span>
        <span>{formatDateTime(run.finished_at ?? run.created_at)}</span>
        <span className="font-mono">{shortId(run.id)}</span>
      </p>
    </div>
  );
}

function ComparisonView({ comparison: c, registry }: { comparison: Comparison; registry: MetricInfo[] }) {
  const index = indexMetrics(registry);
  const regressions = c.metrics.filter((m) => verdictOf(m) === "regression").length;
  const improvements = c.metrics.filter((m) => verdictOf(m) === "improvement").length;
  const family = c.metrics.filter((m) => m.in_family).length;
  const floor = c.noise_floor;
  const pct = (v: number | null) => (v === null ? "n/a" : `${Math.round(v * 100)}%`);

  return (
    <>
      <div className="grid divide-y rounded-lg border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <RunLine side="A" run={c.a} />
        <RunLine side="B" run={c.b} />
      </div>

      {c.warnings.length > 0 && (
        <Alert>
          <CircleAlertIcon className="text-warning" />
          <AlertTitle>Read with care</AlertTitle>
          <AlertDescription>
            <ul className="flex list-disc flex-col gap-0.5 pl-4">
              {c.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <Section
        id="config"
        title="What changed"
        description="Setting-level differences between the two runs' config and snapshot (DocuMind version and prompt hashes, judge prompt versions, dataset)."
      >
        <ConfigDiff diff={c.config_diff} hash={c.a.config_hash} />
      </Section>

      <Section
        id="metrics"
        title="Metrics"
        description={
          <>
            {plural(c.pairing.paired, "paired case")} scored in <span className="font-mono">{c.mode}</span>.{" "}
            {regressions || improvements ? (
              <>
                {plural(regressions, "significant regression")} and {plural(improvements, "significant improvement")} after
                Holm across {plural(family, "quality metric")}.
              </>
            ) : (
              <>No quality metric changed significantly after Holm across {plural(family, "metric")}.</>
            )}{" "}
            Continuous metrics: paired bootstrap CI and sign-flip permutation p; binary: exact McNemar. Latency, tokens and
            cost are descriptive. The shaded band is the A/A noise floor.
          </>
        }
      >
        <p className="text-xs text-muted-foreground">
          {floor ? (
            floor.is_self ? (
              <>These runs share a setup: they are the A/A pair, so their differences are the noise floor (case flip rate {pct(floor.flip_rate)}).</>
            ) : (
              <>
                Noise floor from the A/A pair{" "}
                <Link href={`/compare?a=${floor.run_a}&b=${floor.run_b}`} className="font-mono underline-offset-4 hover:underline">
                  {shortId(floor.run_a)} vs {shortId(floor.run_b)}
                </Link>{" "}
                ({plural(floor.paired, "case")}, flip rate {pct(floor.flip_rate)}). &ldquo;Within noise&rdquo; means |Δ| is no
                larger than that pair&apos;s.
              </>
            )
          ) : (
            <>No A/A pair on this dataset yet: run the same setup twice to measure the noise floor.</>
          )}
        </p>
        {c.metrics.length ? (
          <MetricDiffTable metrics={c.metrics} index={index} />
        ) : (
          <p className="text-sm text-muted-foreground">No metric was scored in both runs.</p>
        )}
      </Section>

      <Section
        id="cases"
        title="Cases"
        description={`Classes come from quality metrics only: a move beyond 0.1 on a 0–1 score, or any pass/fail flip. ${plural(
          c.pairing.paired,
          "case",
        )} paired; ${c.pairing.only_a + c.pairing.only_b + c.pairing.not_done} unpaired.`}
      >
        <CaseList cases={c.cases} registry={registry} a={c.a.id} b={c.b.id} />
      </Section>
    </>
  );
}

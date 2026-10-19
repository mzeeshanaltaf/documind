import { CircleAlertIcon, CircleCheckIcon, PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";
import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { ButtonLink } from "@/components/button-link";
import { MetricSparklines } from "@/components/charts/metric-sparklines";
import { RunsTable } from "@/components/runs/runs-table";
import { Skeleton } from "@/components/ui/skeleton";
import type { DatasetOut, MetricInfo, RunOut, SystemInfo, Trends } from "@/lib/api-types";
import { requireAdmin } from "@/lib/auth-guards";
import { apiJson } from "@/lib/eval-api";
import { formatCost, shortId } from "@/lib/format";
import { KEY_METRICS } from "@/lib/metrics";
import { PINNED_DATASET_COOKIE } from "@/lib/pinned";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard" };

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="font-sans text-sm font-semibold">{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

function BlockSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <PageContainer className="max-w-6xl gap-10">
      <PageHeader
        title="Dashboard"
        description="How DocuMind is scoring lately, what's running, and what it costs."
        actions={
          <ButtonLink href="/runs/new">
            <PlusIcon data-icon="inline-start" />
            New run
          </ButtonLink>
        }
      />
      <Suspense
        fallback={
          <Section title="Latest runs">
            <BlockSkeleton rows={5} />
          </Section>
        }
      >
        <LatestRuns />
      </Suspense>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Suspense
          fallback={
            <Section title="Trends">
              <BlockSkeleton rows={4} />
            </Section>
          }
        >
          <PinnedTrends />
        </Suspense>
        <Suspense
          fallback={
            <Section title="This month">
              <BlockSkeleton rows={4} />
            </Section>
          }
        >
          <SystemSummary />
        </Suspense>
      </div>
    </PageContainer>
  );
}

async function LatestRuns() {
  const { user } = await requireAdmin();
  const { runs } = await apiJson<{ runs: RunOut[] }>("runs", { userId: user.id, query: { limit: 5 } });
  return (
    <Section
      title="Latest runs"
      action={
        <Link href="/runs" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
          All runs
        </Link>
      }
    >
      {runs.length ? (
        <RunsTable runs={runs} />
      ) : (
        <p className="text-sm text-muted-foreground">
          No runs yet. <Link href="/runs/new" className="text-primary underline-offset-4 hover:underline">Start the first one</Link>.
        </p>
      )}
    </Section>
  );
}

async function PinnedTrends() {
  const { user } = await requireAdmin();
  const store = await cookies();
  const opts = { userId: user.id };
  const [{ datasets }, { runs }, registry] = await Promise.all([
    apiJson<{ datasets: DatasetOut[] }>("datasets", opts),
    apiJson<{ runs: RunOut[] }>("runs", { ...opts, query: { status: "completed", limit: 1 } }),
    apiJson<MetricInfo[]>("metrics", opts),
  ]);
  const pinnedId = store.get(PINNED_DATASET_COOKIE)?.value;
  const pinned = datasets.find((d) => d.id === pinnedId);
  // Unpinned: follow the dataset of the latest completed run.
  const dataset = pinned ?? datasets.find((d) => d.id === runs[0]?.dataset?.dataset_id) ?? datasets[0];
  if (!dataset) {
    return (
      <Section title="Trends">
        <p className="text-sm text-muted-foreground">Import a dataset and run it to see trends here.</p>
      </Section>
    );
  }
  const { series } = await apiJson<Trends>("trends", {
    ...opts,
    query: { dataset_id: dataset.id, metrics: KEY_METRICS.join(","), limit: 20 },
  });
  return (
    <Section
      title={`Trends · ${dataset.name}`}
      action={
        <Link href={`/datasets/${dataset.id}`} className="text-sm text-muted-foreground hover:text-foreground hover:underline">
          {pinned ? "Pinned dataset" : "Latest run's dataset; pin one to keep it"}
        </Link>
      }
    >
      <p className="-mt-1 text-xs text-muted-foreground">Completed, non-partial runs, oldest to newest. The band is the 95% CI.</p>
      <MetricSparklines series={series} registry={registry} />
    </Section>
  );
}

function Status({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  const Icon = ok ? CircleCheckIcon : CircleAlertIcon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm", ok ? "text-success" : "text-destructive")}>
      <Icon className="size-4" aria-hidden />
      {children}
    </span>
  );
}

async function SystemSummary() {
  const { user } = await requireAdmin();
  const system = await apiJson<SystemInfo>("system", { userId: user.id });
  const month = new Date(system.spend.since).toLocaleString("en-GB", { month: "long", timeZone: "UTC" });
  const { documind } = system;
  return (
    <div className="flex flex-col gap-10">
      <Section title={`Spend in ${month}`}>
        <dl className="flex flex-col">
          {[
            ["Judge (Anthropic)", formatCost(system.spend.judge_usd)],
            ["DocuMind (OpenAI)", formatCost(system.spend.documind_usd)],
            ["Total", formatCost(system.spend.judge_usd + system.spend.documind_usd)],
          ].map(([label, value], i) => (
            <div key={label} className={cn("flex items-baseline justify-between gap-3 border-b py-2", i === 2 && "font-medium")}>
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="font-mono text-sm tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-muted-foreground">
          {system.spend.runs} run{system.spend.runs === 1 ? "" : "s"} started this month (UTC). Judge spend counts every metered
          call, interrupted runs included.
        </p>
      </Section>
      <Section
        title="DocuMind"
        action={
          <Link href="/settings" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
            Settings
          </Link>
        }
      >
        <dl className="flex flex-col">
          <div className="flex items-baseline justify-between gap-3 border-b py-2">
            <dt className="text-sm text-muted-foreground">Reachable</dt>
            <dd>
              <Status ok={documind.reachable}>{documind.reachable ? "Yes" : "No"}</Status>
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 border-b py-2">
            <dt className="text-sm text-muted-foreground">Version</dt>
            <dd className="font-mono text-sm">{documind.version ? (documind.version === "dev" ? "dev" : shortId(documind.version)) : "n/a"}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 border-b py-2">
            <dt className="text-sm text-muted-foreground">Judge</dt>
            <dd>
              <Status ok={system.anthropic.reachable}>
                {system.anthropic.reachable ? "Anthropic reachable" : system.anthropic.configured ? "Anthropic unreachable" : "No API key"}
              </Status>
            </dd>
          </div>
        </dl>
      </Section>
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageContainer } from "@/components/app/page-container";
import { PageSkeleton } from "@/components/app/shell-skeleton";
import { LiveRun } from "@/components/runs/live-run";
import type { AggregateOut, CalibrationBadge, MetricInfo, RunCaseOut, RunDetail, SafetySummary } from "@/lib/api-types";
import { requireAdmin } from "@/lib/auth-guards";
import { apiJson, apiJsonOrNull } from "@/lib/eval-api";

export const metadata: Metadata = { title: "Run" };

export default function RunPage({ params }: PageProps<"/runs/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Run params={params} />
    </Suspense>
  );
}

async function Run({ params }: { params: PageProps<"/runs/[id]">["params"] }) {
  const { user } = await requireAdmin();
  const { id } = await params;
  const run = await apiJsonOrNull<RunDetail>(`runs/${id}`, { userId: user.id });
  if (!run) notFound();
  const [{ cases }, aggregates, registry, safety, calibration] = await Promise.all([
    apiJson<{ cases: RunCaseOut[] }>(`runs/${id}/cases`, { userId: user.id }),
    apiJson<AggregateOut[]>(`runs/${id}/aggregates`, { userId: user.id }),
    apiJson<MetricInfo[]>("metrics", { userId: user.id }),
    apiJsonOrNull<SafetySummary>(`runs/${id}/safety`, { userId: user.id }),
    run.mode === "full"
      ? apiJsonOrNull<{ badges: CalibrationBadge[] }>(`runs/${id}/calibration`, { userId: user.id })
      : null,
  ]);

  return (
    <PageContainer className="max-w-6xl">
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted-foreground">
        <Link href="/runs" className="hover:text-foreground hover:underline">
          Runs
        </Link>
      </nav>
      <LiveRun
        initialRun={run}
        initialCases={cases}
        initialAggregates={aggregates}
        initialSafety={safety}
        registry={registry}
        calibration={calibration?.badges ?? []}
      />
    </PageContainer>
  );
}

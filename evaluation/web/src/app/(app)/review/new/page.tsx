import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { PageSkeleton } from "@/components/app/shell-skeleton";
import { NewQueueForm } from "@/components/review/new-queue-form";
import type { RunOut } from "@/lib/api-types";
import { requireAdmin } from "@/lib/auth-guards";
import { apiJson } from "@/lib/eval-api";

export const metadata: Metadata = { title: "New review queue" };

export default function NewQueuePage({ searchParams }: PageProps<"/review/new">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NewQueue searchParams={searchParams} />
    </Suspense>
  );
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

async function NewQueue({ searchParams }: { searchParams: PageProps<"/review/new">["searchParams"] }) {
  const { user } = await requireAdmin();
  const [params, { runs }] = await Promise.all([
    searchParams,
    apiJson<{ runs: RunOut[] }>("runs", { userId: user.id, query: { status: "completed", limit: 100 } }),
  ]);
  const judged = runs.filter((r) => r.mode === "full" && r.config.judge?.enabled !== false);

  return (
    <PageContainer className="max-w-3xl">
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted-foreground">
        <Link href="/review" className="hover:text-foreground hover:underline">
          Review
        </Link>
      </nav>
      <PageHeader
        title="New review queue"
        description="Sample a judged run's cases and grade them with the judge's own rubric. Agreement with the judge feeds Calibration."
      />
      <NewQueueForm runs={judged} initialRunId={first(params.run)} initialMetric={first(params.metric)} />
    </PageContainer>
  );
}

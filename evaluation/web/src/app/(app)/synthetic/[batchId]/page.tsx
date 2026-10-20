import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageContainer } from "@/components/app/page-container";
import { PageSkeleton } from "@/components/app/shell-skeleton";
import { BatchReview } from "@/components/synthetic/batch-review";
import type { Candidate, DatasetOut, SyntheticBatch } from "@/lib/api-types";
import { requireAdmin } from "@/lib/auth-guards";
import { apiJson, apiJsonOrNull } from "@/lib/eval-api";

export const metadata: Metadata = { title: "Review candidates" };

export default function BatchPage({ params }: PageProps<"/synthetic/[batchId]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Batch params={params} />
    </Suspense>
  );
}

async function Batch({ params }: { params: PageProps<"/synthetic/[batchId]">["params"] }) {
  const { user } = await requireAdmin();
  const { batchId } = await params;
  const opts = { userId: user.id };
  const batch = await apiJsonOrNull<SyntheticBatch>(`synthetic-batches/${encodeURIComponent(batchId)}`, opts);
  if (!batch) notFound();
  const [{ candidates }, { datasets }] = await Promise.all([
    apiJson<{ candidates: Candidate[] }>(`synthetic-batches/${batch.id}/candidates`, opts),
    apiJson<{ datasets: DatasetOut[] }>("datasets", opts),
  ]);

  return (
    <PageContainer className="max-w-7xl">
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted-foreground">
        <Link href="/synthetic" className="hover:text-foreground hover:underline">
          Synthetic
        </Link>
      </nav>
      <BatchReview initialBatch={batch} initialCandidates={candidates} datasets={datasets.filter((d) => !d.archived_at)} />
    </PageContainer>
  );
}

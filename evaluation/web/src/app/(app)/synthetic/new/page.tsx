import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { PageSkeleton } from "@/components/app/shell-skeleton";
import { NewBatchForm, type VersionOption } from "@/components/synthetic/new-batch-form";
import type { DatasetDetail, DatasetOut, OrgAccess } from "@/lib/api-types";
import { requireAdmin } from "@/lib/auth-guards";
import { apiJson } from "@/lib/eval-api";

export const metadata: Metadata = { title: "New synthetic batch" };

export default function NewBatchPage({ searchParams }: PageProps<"/synthetic/new">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NewBatch searchParams={searchParams} />
    </Suspense>
  );
}

async function NewBatch({ searchParams }: { searchParams: PageProps<"/synthetic/new">["searchParams"] }) {
  const { user } = await requireAdmin();
  const params = await searchParams;
  const opts = { userId: user.id };
  const [{ datasets }, orgs] = await Promise.all([
    apiJson<{ datasets: DatasetOut[] }>("datasets", opts),
    apiJson<OrgAccess[]>("documind/orgs", opts).catch(() => [] as OrgAccess[]),
  ]);
  const details = await Promise.all(datasets.map((d) => apiJson<DatasetDetail>(`datasets/${d.id}`, opts)));
  const versions: VersionOption[] = details.flatMap((d) =>
    d.versions
      .filter((v) => v.case_count > 0)
      .map((v) => ({
        id: v.id,
        label: `${d.name} v${v.version}${v.status === "draft" ? " (draft)" : ""}`,
        cases: v.case_count,
      })),
  );
  return (
    <PageContainer className="max-w-4xl">
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted-foreground">
        <Link href="/synthetic" className="hover:text-foreground hover:underline">
          Synthetic
        </Link>
      </nav>
      <PageHeader
        title="New batch"
        description="Passages are sampled from the documents with the seed below, so the same seed and documents give the same seeds. Each candidate is written by Claude, checked, and waits for your review."
      />
      <NewBatchForm
        orgs={orgs}
        datasets={datasets.filter((d) => !d.archived_at)}
        versions={versions}
        initialKind={params.kind === "enrichment" ? "enrichment" : "synthetic"}
        initialVersionId={typeof params.version === "string" ? params.version : undefined}
      />
    </PageContainer>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { PageSkeleton } from "@/components/app/shell-skeleton";
import { ButtonLink } from "@/components/button-link";
import { type DatasetVersionOption, NewRunForm } from "@/components/runs/new-run-form";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import type { DatasetDetail, DatasetOut, MetricInfo, OrgAccess, SystemInfo } from "@/lib/api-types";
import { requireAdmin } from "@/lib/auth-guards";
import { apiJson } from "@/lib/eval-api";

export const metadata: Metadata = { title: "New run" };

export default function NewRunPage({ searchParams }: PageProps<"/runs/new">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NewRun searchParams={searchParams} />
    </Suspense>
  );
}

async function NewRun({ searchParams }: { searchParams: PageProps<"/runs/new">["searchParams"] }) {
  const { user } = await requireAdmin();
  const params = await searchParams;
  const opts = { userId: user.id };
  const [{ datasets }, orgs, registry, system] = await Promise.all([
    apiJson<{ datasets: DatasetOut[] }>("datasets", opts),
    apiJson<OrgAccess[]>("documind/orgs", opts).catch(() => [] as OrgAccess[]),
    apiJson<MetricInfo[]>("metrics", opts),
    apiJson<SystemInfo>("system", opts),
  ]);
  const details = await Promise.all(datasets.map((d) => apiJson<DatasetDetail>(`datasets/${d.id}`, opts)));
  const versions: DatasetVersionOption[] = details.flatMap((d) =>
    d.versions
      .filter((v) => v.status === "published")
      .map((v) => ({
        id: v.id,
        label: `${d.name} v${v.version}`,
        slug: d.slug,
        version: v.version,
        cases: v.case_count,
        defaultOrg: d.default_org_slug,
      })),
  );
  const wanted = typeof params.version === "string" ? params.version : undefined;

  return (
    <PageContainer className="max-w-4xl">
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted-foreground">
        <Link href="/runs" className="hover:text-foreground hover:underline">
          Runs
        </Link>
      </nav>
      <PageHeader
        title="New run"
        description="The run snapshots this configuration, DocuMind's version and the judge prompts, then works through the cases on the server."
      />
      {versions.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>No published dataset versions</EmptyTitle>
            <EmptyDescription>Runs need a published version. Publish a draft, or import a JSONL file.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <ButtonLink href="/datasets">Go to datasets</ButtonLink>
          </EmptyContent>
        </Empty>
      ) : (
        <NewRunForm
          versions={versions}
          initialVersionId={versions.some((v) => v.id === wanted) ? wanted! : versions[0].id}
          orgs={orgs}
          registry={registry}
          judgeModels={system.eval.judge_models}
          chatModels={system.documind.chat_models ?? []}
          defaults={system.documind.defaults ?? {}}
        />
      )}
    </PageContainer>
  );
}

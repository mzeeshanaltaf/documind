import { DownloadIcon, PlayIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { PageSkeleton } from "@/components/app/shell-skeleton";
import { ButtonLink } from "@/components/button-link";
import { NewDraftButton, PublishButton } from "@/components/datasets/dataset-actions";
import { ImportDialog } from "@/components/datasets/import-dialog";
import { VersionBadge } from "@/components/datasets/version-badge";
import { VersionCases } from "@/components/datasets/version-cases";
import { buttonVariants } from "@/components/ui/button";
import type { CaseOut, DatasetDetail } from "@/lib/api-types";
import { requireAdmin } from "@/lib/auth-guards";
import { apiJson, apiJsonOrNull } from "@/lib/eval-api";
import { formatDate, shortId } from "@/lib/format";

export const metadata: Metadata = { title: "Dataset version" };

export default function VersionPage({ params, searchParams }: PageProps<"/datasets/[id]/v/[version]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Version params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Version({
  params,
  searchParams,
}: {
  params: PageProps<"/datasets/[id]/v/[version]">["params"];
  searchParams: PageProps<"/datasets/[id]/v/[version]">["searchParams"];
}) {
  const { user } = await requireAdmin();
  const [{ id, version: versionParam }, query] = await Promise.all([params, searchParams]);
  const dataset = await apiJsonOrNull<DatasetDetail>(`datasets/${id}`, { userId: user.id });
  const version = dataset?.versions.find((v) => String(v.version) === versionParam);
  if (!dataset || !version) notFound();
  const { cases } = await apiJson<{ cases: CaseOut[] }>(`dataset-versions/${version.id}/cases`, { userId: user.id });
  const draft = version.status === "draft";
  const openDraft = dataset.versions.find((v) => v.status === "draft");

  return (
    <PageContainer className="max-w-6xl gap-8">
      <div>
        <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1.5 text-sm text-muted-foreground">
          <Link href="/datasets" className="hover:text-foreground hover:underline">
            Datasets
          </Link>
          <span aria-hidden>/</span>
          <Link href={`/datasets/${dataset.id}`} className="hover:text-foreground hover:underline">
            {dataset.name}
          </Link>
        </nav>
        <PageHeader
          title={`${dataset.name} v${version.version}`}
          description={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <VersionBadge status={version.status} />
              <span className="tabular-nums">{version.case_count} cases</span>
              {version.content_hash && <span className="font-mono text-xs">hash {shortId(version.content_hash)}</span>}
              {version.published_at && <span>published {formatDate(version.published_at)}</span>}
              {version.notes && <span>{version.notes}</span>}
            </span>
          }
          actions={
            <div className="flex flex-wrap gap-2">
              {draft ? (
                <PublishButton versionId={version.id} version={version.version} cases={version.case_count} />
              ) : (
                <>
                  <ButtonLink href={`/runs/new?version=${version.id}`}>
                    <PlayIcon data-icon="inline-start" />
                    Run this version
                  </ButtonLink>
                  {openDraft ? (
                    <ButtonLink href={`/datasets/${dataset.id}/v/${openDraft.version}`} variant="outline">
                      Open draft v{openDraft.version}
                    </ButtonLink>
                  ) : (
                    <NewDraftButton datasetId={dataset.id} datasetPath={`/datasets/${dataset.id}`} />
                  )}
                </>
              )}
              {/* A plain anchor: the BFF streams the file as an attachment. */}
              <a href={`/api/backend/dataset-versions/${version.id}/export`} download className={buttonVariants({ variant: "outline" })}>
                <DownloadIcon data-icon="inline-start" />
                Export JSONL
              </a>
              <ImportDialog dataset={dataset} trigger="Import" />
            </div>
          }
        />
        {draft && (
          <p className="text-sm text-muted-foreground">
            A draft: add, edit and delete cases, then publish to freeze it. Runs need a published version.
          </p>
        )}
      </div>
      <VersionCases
        versionId={version.id}
        cases={cases}
        editable={draft}
        initialCaseId={typeof query.case === "string" ? query.case : undefined}
      />
    </PageContainer>
  );
}

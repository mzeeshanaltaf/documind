import { PlayIcon } from "lucide-react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { PageSkeleton } from "@/components/app/shell-skeleton";
import { ButtonLink } from "@/components/button-link";
import { DatasetDialog, NewDraftButton, PinButton } from "@/components/datasets/dataset-actions";
import { ImportDialog } from "@/components/datasets/import-dialog";
import { VersionBadge } from "@/components/datasets/version-badge";
import { VersionCases } from "@/components/datasets/version-cases";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CaseOut, DatasetDetail, RunOut } from "@/lib/api-types";
import { requireAdmin } from "@/lib/auth-guards";
import { apiJson, apiJsonOrNull } from "@/lib/eval-api";
import { formatDate, humanize, shortId } from "@/lib/format";
import { PINNED_DATASET_COOKIE } from "@/lib/pinned";

export const metadata: Metadata = { title: "Dataset" };

export default function DatasetPage({ params }: PageProps<"/datasets/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Dataset params={params} />
    </Suspense>
  );
}

async function Dataset({ params }: { params: PageProps<"/datasets/[id]">["params"] }) {
  const { user } = await requireAdmin();
  const [{ id }, store] = await Promise.all([params, cookies()]);
  const dataset = await apiJsonOrNull<DatasetDetail>(`datasets/${id}`, { userId: user.id });
  if (!dataset) notFound();
  const latest = dataset.versions[0];
  const [cases, { runs }] = await Promise.all([
    latest
      ? apiJson<{ cases: CaseOut[] }>(`dataset-versions/${latest.id}/cases`, { userId: user.id }).then((r) => r.cases)
      : Promise.resolve([]),
    apiJson<{ runs: RunOut[] }>("runs", { userId: user.id, query: { dataset_id: id, limit: 200 } }),
  ]);
  const draft = dataset.versions.find((v) => v.status === "draft");
  const runsByVersion = new Map<string, number>();
  for (const run of runs) runsByVersion.set(run.dataset_version_id, (runsByVersion.get(run.dataset_version_id) ?? 0) + 1);
  const pinned = store.get(PINNED_DATASET_COOKIE)?.value === dataset.id;

  return (
    <PageContainer className="max-w-6xl gap-10">
      <div>
        <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted-foreground">
          <Link href="/datasets" className="hover:text-foreground hover:underline">
            Datasets
          </Link>
        </nav>
        <PageHeader
          title={dataset.name}
          description={
            <span className="flex flex-col gap-1">
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-mono">{dataset.slug}</span>
                <span>{humanize(dataset.kind)}</span>
                {dataset.default_org_slug && (
                  <span>
                    default org <span className="font-mono">{dataset.default_org_slug}</span>
                  </span>
                )}
                {dataset.archived_at && <Badge variant="secondary">Archived</Badge>}
              </span>
              {dataset.description && <span>{dataset.description}</span>}
            </span>
          }
          actions={
            <div className="flex flex-wrap gap-2">
              {dataset.latest_published && (
                <ButtonLink href={`/runs/new?version=${dataset.latest_published.id}`}>
                  <PlayIcon data-icon="inline-start" />
                  Run v{dataset.latest_published.version}
                </ButtonLink>
              )}
              <PinButton datasetId={dataset.id} pinned={pinned} />
              <DatasetDialog dataset={dataset} />
            </div>
          }
        />
      </div>

      <section aria-labelledby="versions" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="versions" className="font-sans text-sm font-semibold">
            Versions
          </h2>
          <div className="flex flex-wrap gap-2">
            {draft ? (
              <ButtonLink href={`/datasets/${dataset.id}/v/${draft.version}`} variant="outline">
                Open draft v{draft.version}
              </ButtonLink>
            ) : (
              <NewDraftButton datasetId={dataset.id} datasetPath={`/datasets/${dataset.id}`} />
            )}
            <ImportDialog dataset={dataset} trigger="Import as new version" />
          </div>
        </div>
        <div className="@container overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Version</TableHead>
                <TableHead className="text-right">Cases</TableHead>
                <TableHead className="hidden text-right @xl:table-cell">Runs</TableHead>
                <TableHead className="hidden @2xl:table-cell">Content hash</TableHead>
                <TableHead className="hidden @3xl:table-cell">Notes</TableHead>
                <TableHead className="hidden @xl:table-cell">Published</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dataset.versions.map((v) => (
                <TableRow key={v.id}>
                  <TableCell>
                    <Link href={`/datasets/${dataset.id}/v/${v.version}`} className="flex items-center gap-2 hover:underline">
                      <span className="font-mono text-sm font-medium">v{v.version}</span>
                      <VersionBadge status={v.status} />
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{v.case_count}</TableCell>
                  <TableCell className="hidden text-right tabular-nums @xl:table-cell">
                    {runsByVersion.get(v.id) ? (
                      <Link href={`/runs?dataset=${dataset.id}`} className="hover:underline">
                        {runsByVersion.get(v.id)}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden font-mono text-xs text-muted-foreground @2xl:table-cell">{v.content_hash ? shortId(v.content_hash) : "n/a"}</TableCell>
                  <TableCell className="hidden max-w-xs truncate text-sm text-muted-foreground @3xl:table-cell">{v.notes ?? ""}</TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground tabular-nums @xl:table-cell">
                    {v.published_at ? formatDate(v.published_at) : "not yet"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      {latest && (
        <section aria-labelledby="cases" className="flex flex-col gap-3">
          <h2 id="cases" className="font-sans text-sm font-semibold">
            Cases in v{latest.version}
          </h2>
          <VersionCases versionId={latest.id} cases={cases} editable={latest.status === "draft"} />
        </section>
      )}
    </PageContainer>
  );
}

import { DatabaseIcon, PinIcon } from "lucide-react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";
import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { PageSkeleton } from "@/components/app/shell-skeleton";
import { DatasetDialog } from "@/components/datasets/dataset-actions";
import { ImportDialog } from "@/components/datasets/import-dialog";
import { VersionBadge } from "@/components/datasets/version-badge";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { DatasetOut } from "@/lib/api-types";
import { requireAdmin } from "@/lib/auth-guards";
import { apiJson } from "@/lib/eval-api";
import { formatDate, humanize } from "@/lib/format";
import { PINNED_DATASET_COOKIE } from "@/lib/pinned";

export const metadata: Metadata = { title: "Datasets" };

export default function DatasetsPage({ searchParams }: PageProps<"/datasets">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Datasets searchParams={searchParams} />
    </Suspense>
  );
}

async function Datasets({ searchParams }: { searchParams: PageProps<"/datasets">["searchParams"] }) {
  const { user } = await requireAdmin();
  const [params, store] = await Promise.all([searchParams, cookies()]);
  const archived = params.archived === "1";
  const { datasets } = await apiJson<{ datasets: DatasetOut[] }>("datasets", {
    userId: user.id,
    query: { include_archived: archived },
  });
  const pinned = store.get(PINNED_DATASET_COOKIE)?.value;

  return (
    <PageContainer className="max-w-6xl">
      <PageHeader
        title="Datasets"
        description="Versioned test cases. A published version is frozen, so every run on it is comparable."
        actions={
          <>
            <ImportDialog />
            <DatasetDialog />
          </>
        }
      />
      {datasets.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <DatabaseIcon />
            </EmptyMedia>
            <EmptyTitle>No datasets yet</EmptyTitle>
            <EmptyDescription>Import a JSONL file, or create a dataset and add cases by hand.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="@container overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dataset</TableHead>
                <TableHead className="hidden @xl:table-cell">Kind</TableHead>
                <TableHead>Latest version</TableHead>
                <TableHead className="hidden @3xl:table-cell">Default org</TableHead>
                <TableHead className="hidden @4xl:table-cell">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {datasets.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="max-w-0 min-w-48 @xl:max-w-md">
                    <Link
                      href={`/datasets/${d.id}`}
                      className="flex min-w-0 flex-col gap-0.5 rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                    >
                      <span className="flex items-center gap-2">
                        <span className="truncate font-medium hover:underline">{d.name}</span>
                        {d.id === pinned && <PinIcon className="size-3.5 shrink-0 text-muted-foreground" aria-label="Pinned to the dashboard" />}
                        {d.archived_at && <Badge variant="secondary">Archived</Badge>}
                      </span>
                      <span className="truncate font-mono text-xs text-muted-foreground">{d.slug}</span>
                      {d.description && <span className="truncate text-xs text-muted-foreground">{d.description}</span>}
                    </Link>
                  </TableCell>
                  <TableCell className="hidden text-sm @xl:table-cell">{humanize(d.kind)}</TableCell>
                  <TableCell>
                    {d.latest_version ? (
                      <Link href={`/datasets/${d.id}/v/${d.latest_version.version}`} className="flex flex-wrap items-center gap-2 hover:underline">
                        <span className="font-mono text-sm">v{d.latest_version.version}</span>
                        <VersionBadge status={d.latest_version.status} />
                        <span className="text-xs text-muted-foreground tabular-nums">{d.latest_version.case_count} cases</span>
                      </Link>
                    ) : (
                      <span className="text-sm text-muted-foreground">none</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden font-mono text-xs @3xl:table-cell">{d.default_org_slug ?? "none"}</TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground tabular-nums @4xl:table-cell">{formatDate(d.updated_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Link href={archived ? "/datasets" : "/datasets?archived=1"} className="mt-3 self-start text-sm text-muted-foreground hover:text-foreground hover:underline">
        {archived ? "Hide archived datasets" : "Show archived datasets"}
      </Link>
    </PageContainer>
  );
}

import { PlayIcon, PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { PageSkeleton } from "@/components/app/shell-skeleton";
import { UrlFilters } from "@/components/app/url-filters";
import { ButtonLink } from "@/components/button-link";
import { RunsTable } from "@/components/runs/runs-table";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { type DatasetOut, RUN_STATUSES, type RunOut } from "@/lib/api-types";
import { requireAdmin } from "@/lib/auth-guards";
import { apiJson } from "@/lib/eval-api";
import { humanize, plural } from "@/lib/format";

export const metadata: Metadata = { title: "Runs" };

export default function RunsPage({ searchParams }: PageProps<"/runs">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Runs searchParams={searchParams} />
    </Suspense>
  );
}

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function Runs({ searchParams }: { searchParams: PageProps<"/runs">["searchParams"] }) {
  const { user } = await requireAdmin();
  const params = await searchParams;
  const filters = { dataset_id: one(params.dataset), status: one(params.status), tag: one(params.tag) };
  const [{ runs, total }, { datasets }, { runs: recent }] = await Promise.all([
    apiJson<{ runs: RunOut[]; total: number }>("runs", { userId: user.id, query: { ...filters, limit: 200 } }),
    apiJson<{ datasets: DatasetOut[] }>("datasets", { userId: user.id }),
    // Tag options come from the latest runs, filtered or not.
    apiJson<{ runs: RunOut[] }>("runs", { userId: user.id, query: { limit: 200 } }),
  ]);
  const tags = [...new Set(recent.flatMap((r) => r.tags))].sort();
  const filtered = Object.values(filters).some(Boolean);

  return (
    <PageContainer className="max-w-6xl">
      <PageHeader
        title="Runs"
        description="Every evaluation of DocuMind against a dataset version. Runs keep going when you close the tab."
        actions={
          <ButtonLink href="/runs/new">
            <PlusIcon data-icon="inline-start" />
            New run
          </ButtonLink>
        }
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <UrlFilters
          filters={[
            { name: "dataset", label: "Datasets", options: datasets.map((d) => ({ value: d.id, label: d.name })) },
            { name: "status", label: "Statuses", options: RUN_STATUSES.map((s) => ({ value: s, label: humanize(s) })) },
            { name: "tag", label: "Tags", options: tags.map((t) => ({ value: t, label: t })) },
          ]}
        />
        <span className="text-sm text-muted-foreground tabular-nums">{plural(total, "run")}</span>
      </div>
      {runs.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PlayIcon />
            </EmptyMedia>
            <EmptyTitle>{filtered ? "No runs match these filters" : "No runs yet"}</EmptyTitle>
            <EmptyDescription>
              {filtered
                ? "Clear a filter to see more."
                : "Pick a published dataset version and an org, then watch the cases come in."}
            </EmptyDescription>
          </EmptyHeader>
          {!filtered && (
            <EmptyContent>
              <ButtonLink href="/runs/new">Start a run</ButtonLink>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <RunsTable runs={runs} />
      )}
    </PageContainer>
  );
}

import { PlusIcon, SparklesIcon } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { PageSkeleton } from "@/components/app/shell-skeleton";
import { ButtonLink } from "@/components/button-link";
import { BatchesTable } from "@/components/synthetic/batches-table";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import type { SyntheticBatch } from "@/lib/api-types";
import { requireAdmin } from "@/lib/auth-guards";
import { apiJson } from "@/lib/eval-api";
import { formatCost, plural } from "@/lib/format";

export const metadata: Metadata = { title: "Synthetic" };

export default function SyntheticPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Batches />
    </Suspense>
  );
}

async function Batches() {
  const { user } = await requireAdmin();
  const { batches } = await apiJson<{ batches: SyntheticBatch[] }>("synthetic-batches", { userId: user.id });
  const spent = batches.reduce((sum, b) => sum + b.cost_usd, 0);

  return (
    <PageContainer className="max-w-6xl">
      <PageHeader
        title="Synthetic"
        description="Test cases generated from the org's documents, or reference answers for existing cases. Nothing enters a dataset until you approve it."
        actions={
          <ButtonLink href="/synthetic/new">
            <PlusIcon data-icon="inline-start" />
            New batch
          </ButtonLink>
        }
      />
      {batches.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SparklesIcon />
            </EmptyMedia>
            <EmptyTitle>No batches yet</EmptyTitle>
            <EmptyDescription>
              Pick an org and how many cases of each type you want. Claude writes them from sampled passages, checks
              them, and queues them for your review.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <ButtonLink href="/synthetic/new">Generate a batch</ButtonLink>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <p className="mb-4 text-sm text-muted-foreground tabular-nums">
            {plural(batches.length, "batch", "batches")} · {formatCost(spent)} spent
          </p>
          <BatchesTable batches={batches} />
        </>
      )}
    </PageContainer>
  );
}

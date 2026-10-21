import { ClipboardCheckIcon, PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { PageSkeleton } from "@/components/app/shell-skeleton";
import { ButtonLink } from "@/components/button-link";
import { QueuesTable } from "@/components/review/queues-table";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import type { ReviewQueue } from "@/lib/api-types";
import { requireAdmin } from "@/lib/auth-guards";
import { apiJson } from "@/lib/eval-api";

export const metadata: Metadata = { title: "Review" };

export default function ReviewPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Queues />
    </Suspense>
  );
}

async function Queues() {
  const { user } = await requireAdmin();
  const { queues } = await apiJson<{ queues: ReviewQueue[] }>("review-queues", { userId: user.id });

  return (
    <PageContainer className="max-w-6xl">
      <PageHeader
        title="Review"
        description="Grade a sample of judged answers yourself, blind, with the judge's rubric. Your grades measure how far the judge can be trusted."
        actions={
          <ButtonLink href="/review/new">
            <PlusIcon data-icon="inline-start" />
            New queue
          </ButtonLink>
        }
      />
      {queues.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ClipboardCheckIcon />
            </EmptyMedia>
            <EmptyTitle>No review queues yet</EmptyTitle>
            <EmptyDescription>
              Pick a judged run and a metric. A stratified sample covers every score the judge gave, so 30 cases are
              enough to tell whether it grades like a person.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <ButtonLink href="/review/new">Create a queue</ButtonLink>
          </EmptyContent>
        </Empty>
      ) : (
        <QueuesTable queues={queues} />
      )}
    </PageContainer>
  );
}

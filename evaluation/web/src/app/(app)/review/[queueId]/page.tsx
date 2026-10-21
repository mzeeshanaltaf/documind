import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageContainer } from "@/components/app/page-container";
import { PageSkeleton } from "@/components/app/shell-skeleton";
import { ReviewSession } from "@/components/review/review-session";
import type { ReviewItem, ReviewNext, ReviewQueueDetail } from "@/lib/api-types";
import { requireAdmin } from "@/lib/auth-guards";
import { apiJson, apiJsonOrNull } from "@/lib/eval-api";

export const metadata: Metadata = { title: "Review queue" };

export default function QueuePage({ params, searchParams }: PageProps<"/review/[queueId]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Queue params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Queue({
  params,
  searchParams,
}: {
  params: PageProps<"/review/[queueId]">["params"];
  searchParams: PageProps<"/review/[queueId]">["searchParams"];
}) {
  const { user } = await requireAdmin();
  const [{ queueId }, query] = await Promise.all([params, searchParams]);
  const queue = await apiJsonOrNull<ReviewQueueDetail>(`review-queues/${queueId}`, { userId: user.id });
  if (!queue) notFound();
  // `?item=` opens a given case (e.g. one graded earlier); otherwise the next one to grade.
  const itemId = typeof query.item === "string" ? query.item : null;
  const [next, opened] = await Promise.all([
    apiJson<ReviewNext>(`review-queues/${queueId}/next`, { userId: user.id }),
    itemId ? apiJsonOrNull<ReviewItem>(`review-queues/${queueId}/items/${itemId}`, { userId: user.id }) : null,
  ]);

  return (
    <PageContainer className="max-w-7xl">
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted-foreground">
        <Link href="/review" className="hover:text-foreground hover:underline">
          Review
        </Link>
      </nav>
      <ReviewSession queue={queue} initialItem={opened ?? next.item} initialProgress={next.progress} />
    </PageContainer>
  );
}

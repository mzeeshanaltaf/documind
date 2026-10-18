import { BookmarkIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { PageSkeleton } from "@/components/app/shell-skeleton";
import { ButtonLink } from "@/components/button-link";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { apiJson } from "@/lib/api";
import type { Bookmark } from "@/lib/api-types";
import { requireOrgAccess } from "@/lib/auth-guards";
import { formatDate } from "@/lib/format";
import { RemoveBookmarkButton } from "./remove-bookmark-button";

export const metadata: Metadata = { title: "Bookmarks" };

export default function BookmarksPage({ params }: PageProps<"/app/[orgSlug]/bookmarks">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Bookmarks params={params} />
    </Suspense>
  );
}

async function Bookmarks({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const { user, org } = await requireOrgAccess(orgSlug);
  const { bookmarks } = await apiJson<{ bookmarks: Bookmark[] }>(`orgs/${org.id}/bookmarks`, { userId: user.id });

  return (
    <PageContainer className="max-w-4xl">
      <PageHeader
        title="Bookmarks"
        description="Answers you saved in this organization. Open one to jump straight to it in its conversation."
      />
      {bookmarks.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BookmarkIcon />
            </EmptyMedia>
            <EmptyTitle>No bookmarks yet</EmptyTitle>
            <EmptyDescription>Use the bookmark button under an answer to keep it here for later.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <ButtonLink href={`/app/${org.slug}/chat`}>Go to chat</ButtonLink>
          </EmptyContent>
        </Empty>
      ) : (
        <ul className="flex flex-col divide-y overflow-hidden rounded-lg border">
          {bookmarks.map((b) => (
            <li key={b.message_id} className="relative flex items-start gap-2 bg-card transition-colors hover:bg-muted/50">
              <Link
                href={`/app/${org.slug}/chat/${b.conversation_id}?message=${b.message_id}`}
                className="flex min-w-0 flex-1 flex-col gap-1.5 px-4 py-3.5 focus-visible:bg-muted focus-visible:outline-none"
              >
                <span className="truncate font-medium">{b.question ?? b.conversation_title ?? "Untitled conversation"}</span>
                <span className="line-clamp-3 text-sm text-muted-foreground">{b.answer_excerpt}</span>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  {b.conversation_title && b.question && <span className="truncate">In {b.conversation_title}</span>}
                  {b.doc_codes.map((code) => (
                    <span key={code} className="font-mono text-[0.7rem]">
                      {code}
                    </span>
                  ))}
                  <span className="tabular-nums">Saved {formatDate(b.bookmarked_at)}</span>
                </span>
              </Link>
              <div className="shrink-0 pt-2.5 pr-2">
                <RemoveBookmarkButton orgSlug={org.slug} messageId={b.message_id} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </PageContainer>
  );
}

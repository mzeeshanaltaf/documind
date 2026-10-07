import { MessageSquareTextIcon } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { PageContainer } from "@/components/app/page-container";
import { PageSkeleton } from "@/components/app/shell-skeleton";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { requireOrgAccess } from "@/lib/auth-guards";

export const metadata: Metadata = { title: "Chat" };

export default function ChatPage({ params }: PageProps<"/app/[orgSlug]/chat">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Chat params={params} />
    </Suspense>
  );
}

// Placeholder until Phase 6 builds the chat UI.
async function Chat({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const { org } = await requireOrgAccess(orgSlug);
  return (
    <PageContainer className="justify-center">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MessageSquareTextIcon />
          </EmptyMedia>
          <EmptyTitle className="font-heading text-xl">Ask a question about {org.name}</EmptyTitle>
          <EmptyDescription>
            Chat is being set up. Soon you&apos;ll ask a question here and get an answer that cites the exact
            document, section and page.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </PageContainer>
  );
}

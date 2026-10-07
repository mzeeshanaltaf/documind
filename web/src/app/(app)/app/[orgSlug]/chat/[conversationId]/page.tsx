import type { Metadata } from "next";
import { Suspense } from "react";
import { ChatAppLoader } from "@/components/chat/chat-app-loader";
import { ChatSkeleton } from "@/components/chat/chat-skeleton";
import { loadChat } from "../load-chat";

export const metadata: Metadata = { title: "Chat" };

export default function ConversationPage({ params }: PageProps<"/app/[orgSlug]/chat/[conversationId]">) {
  return (
    <Suspense fallback={<ChatSkeleton />}>
      <ConversationChat params={params} />
    </Suspense>
  );
}

async function ConversationChat({ params }: { params: Promise<{ orgSlug: string; conversationId: string }> }) {
  const { orgSlug, conversationId } = await params;
  return <ChatAppLoader {...await loadChat(orgSlug, conversationId)} />;
}

import type { Metadata } from "next";
import { Suspense } from "react";
import { ChatAppLoader } from "@/components/chat/chat-app-loader";
import { ChatSkeleton } from "@/components/chat/chat-skeleton";
import { loadChat } from "./load-chat";

export const metadata: Metadata = { title: "Chat" };

export default function NewChatPage({ params }: PageProps<"/app/[orgSlug]/chat">) {
  return (
    <Suspense fallback={<ChatSkeleton />}>
      <NewChat params={params} />
    </Suspense>
  );
}

async function NewChat({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  return <ChatAppLoader {...await loadChat(orgSlug)} />;
}

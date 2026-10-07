import "server-only";
import { notFound } from "next/navigation";
import type { ChatAppProps } from "@/components/chat/chat-app";
import type { CatalogDoc } from "@/components/chat/types";
import { ApiError, apiJson } from "@/lib/api";
import { type ConversationDetail, type DocumentRow, isSearchable } from "@/lib/api-types";
import { requireOrgAccess } from "@/lib/auth-guards";

/** Everything the chat needs, fetched in parallel. A foreign or missing conversation 404s. */
export async function loadChat(orgSlug: string, conversationId?: string): Promise<ChatAppProps> {
  const { user, org, isAdmin } = await requireOrgAccess(orgSlug);
  const userId = user.id;

  const [list, docs, conversation] = await Promise.all([
    apiJson<{ conversations: ChatAppProps["conversations"] }>(`orgs/${org.id}/conversations`, {
      userId,
      query: { limit: 100 },
    }),
    apiJson<{ documents: DocumentRow[] }>(`orgs/${org.id}/documents`, { userId }),
    conversationId ? loadConversation(userId, conversationId) : Promise.resolve(null),
  ]);
  if (conversation && conversation.org_id !== org.id) notFound();

  // Only what the scope picker and suggestions need crosses to the client.
  const documents: CatalogDoc[] = docs.documents
    .filter(isSearchable)
    .map(({ id, doc_code, title, department, jurisdiction, doc_type }) => ({
      id,
      doc_code,
      title,
      department,
      jurisdiction,
      doc_type,
    }))
    .sort((a, b) => (a.doc_code ?? a.title).localeCompare(b.doc_code ?? b.title));

  return {
    org: { id: org.id, slug: org.slug, name: org.name },
    isAdmin,
    conversations: list.conversations,
    documents,
    conversation,
  };
}

async function loadConversation(userId: string, conversationId: string): Promise<ConversationDetail> {
  if (!/^[0-9a-f-]{36}$/i.test(conversationId)) notFound();
  try {
    return await apiJson<ConversationDetail>(`conversations/${conversationId}`, { userId });
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 422)) notFound();
    throw error;
  }
}

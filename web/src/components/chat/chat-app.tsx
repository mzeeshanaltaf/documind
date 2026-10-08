"use client";

import { FileTextIcon, HistoryIcon, PanelLeftCloseIcon, PanelLeftOpenIcon, SquarePenIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { ButtonLink } from "@/components/button-link";
import { PdfViewerProvider, usePdfViewer } from "@/components/pdf/pdf-viewer-provider";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useChatStream } from "@/hooks/use-chat-stream";
import { track } from "@/lib/analytics";
import type { Conversation, ConversationDetail } from "@/lib/api-types";
import { cn } from "@/lib/utils";
import { AssistantMessage } from "./assistant-message";
import type { CitationTarget } from "./citation-chip";
import { Composer, type ComposerHandle } from "./composer";
import { ConversationList } from "./conversation-list";
import { buildSuggestions } from "./suggestions";
import { type CatalogDoc, type ChatOrg, turnsFromStored } from "./types";

export type ChatAppProps = {
  org: ChatOrg;
  isAdmin: boolean;
  conversations: Conversation[];
  documents: CatalogDoc[];
  conversation: ConversationDetail | null;
};

type ConversationList = { conversations: Conversation[]; next_cursor: string | null };

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return (await response.json()) as T;
}

export function ChatApp(props: ChatAppProps) {
  return (
    <PdfViewerProvider orgId={props.org.id}>
      <ChatWorkspace {...props} />
    </PdfViewerProvider>
  );
}

function ChatWorkspace({ org, isAdmin, conversations: initialConversations, documents, conversation }: ChatAppProps) {
  const router = useRouter();
  const pathname = usePathname();
  const basePath = `/app/${org.slug}/chat`;
  const { openDocument } = usePdfViewer();
  const composerRef = useRef<ComposerHandle>(null);

  // One cache entry per org: every mounted chat view (Next keeps visited routes alive) shares it.
  const listKey = `/api/backend/orgs/${encodeURIComponent(org.id)}/conversations?limit=100`;
  const { data: listData, mutate: mutateList } = useSWR<ConversationList>(listKey, fetchJson, {
    fallbackData: { conversations: initialConversations, next_cursor: null },
    revalidateOnMount: false,
  });
  const conversations = listData?.conversations ?? initialConversations;

  const refreshTitles = useCallback(() => {
    // Titles are written in the background just after `done`.
    void mutateList();
    setTimeout(() => void mutateList(), 3000);
  }, [mutateList]);

  const onConversationStarted = useCallback(
    (id: string) => {
      const now = new Date().toISOString();
      void mutateList(
        (current) => ({
          next_cursor: current?.next_cursor ?? null,
          conversations: [
            { id, org_id: org.id, title: null, scope: "all", document_ids: [], created_at: now, updated_at: now },
            ...(current?.conversations ?? []).filter((c) => c.id !== id),
          ],
        }),
        { revalidate: false },
      );
    },
    [mutateList, org.id],
  );

  const initialTurns = useMemo(
    () => (conversation ? turnsFromStored(conversation.messages, conversation.document_ids) : []),
    [conversation],
  );
  const chat = useChatStream({
    orgId: org.id,
    basePath,
    initialConversationId: conversation?.id ?? null,
    initialTurns,
    onConversationStarted,
    onTurnFinished: refreshTitles,
  });

  const [scope, setScope] = useState<string[]>(conversation?.document_ids ?? []);
  const [listOpen, setListOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // This view is kept mounted after navigating away; coming back to /chat starts a fresh chat.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    if (!conversation && pathname === basePath && chat.conversationId && !chat.streaming) {
      chat.reset();
      setScope([]);
    }
  }

  function newChat() {
    setDrawerOpen(false);
    if (chat.streaming) chat.stop();
    if (conversation) {
      router.push(basePath);
      return;
    }
    chat.reset();
    setScope([]);
    window.history.replaceState(null, "", basePath);
    composerRef.current?.focus();
  }

  const docTypes = useMemo(() => new Map(documents.map((d) => [d.id, d.doc_type])), [documents]);
  const openSource = useCallback(
    (target: CitationTarget) => {
      track("citation_opened", { doc_type: docTypes.get(target.document_id) ?? undefined });
      openDocument({
        documentId: target.document_id,
        title: target.title,
        docCode: target.doc_code,
        page: target.page_start,
        pageEnd: target.page_end,
        highlightText: target.highlight_text ?? target.text ?? null,
      });
    },
    [openDocument, docTypes],
  );

  // Follow the stream while the reader is at the bottom; leave them be once they scroll up.
  const threadRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  useEffect(() => {
    const el = threadRef.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [chat.turns]);

  const send = async (text: string) => {
    pinned.current = true;
    const result = await chat.send(text, scope.length ? scope : null);
    // A conversation started with documents keeps that scope on later turns.
    if (result === "sent") track("chat_message_sent", { scoped: scope.length > 0 || !!conversation?.document_ids.length });
    return result;
  };

  const activeTitle = conversations.find((c) => c.id === chat.conversationId)?.title;
  const scopeCount = conversation?.document_ids.length ?? scope.length;

  const list = (
    <ConversationList
      conversations={conversations}
      activeId={chat.conversationId}
      orgSlug={org.slug}
      onNewChat={newChat}
      onNavigate={() => setDrawerOpen(false)}
      onRenamed={(updated) =>
        void mutateList(
          (current) => ({
            next_cursor: current?.next_cursor ?? null,
            conversations: (current?.conversations ?? []).map((c) => (c.id === updated.id ? { ...c, ...updated } : c)),
          }),
          { revalidate: false },
        )
      }
      onDeleted={(id) => {
        void mutateList(
          (current) => ({
            next_cursor: current?.next_cursor ?? null,
            conversations: (current?.conversations ?? []).filter((c) => c.id !== id),
          }),
          { revalidate: false },
        );
        if (id === chat.conversationId) {
          if (conversation) router.push(basePath);
          else newChat();
        }
      }}
    />
  );

  return (
    <div className="flex h-svh min-h-0 w-full">
      {listOpen && (
        <aside aria-label="Conversation history" className="hidden w-64 shrink-0 flex-col border-r bg-sidebar/50 lg:flex">
          {list}
        </aside>
      )}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="left" className="w-[min(20rem,85vw)] gap-0 p-0">
          <SheetHeader className="border-b">
            <SheetTitle>Conversations</SheetTitle>
          </SheetHeader>
          {list}
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-1 border-b px-2 md:px-3">
          <SidebarTrigger className="md:hidden" />
          <Button
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            aria-label="Show conversations"
            onClick={() => setDrawerOpen(true)}
          >
            <HistoryIcon />
          </Button>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="hidden lg:inline-flex"
                  aria-label={listOpen ? "Hide conversations" : "Show conversations"}
                  aria-expanded={listOpen}
                  onClick={() => setListOpen((open) => !open)}
                />
              }
            >
              {listOpen ? <PanelLeftCloseIcon /> : <PanelLeftOpenIcon />}
            </TooltipTrigger>
            <TooltipContent>{listOpen ? "Hide conversations" : "Show conversations"}</TooltipContent>
          </Tooltip>
          <h1 className="min-w-0 flex-1 truncate px-1 font-sans text-sm font-medium">
            {chat.conversationId ? activeTitle || "Untitled conversation" : "New chat"}
          </h1>
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="New chat" onClick={newChat} />}>
              <SquarePenIcon />
            </TooltipTrigger>
            <TooltipContent>New chat</TooltipContent>
          </Tooltip>
        </header>

        <div
          ref={threadRef}
          className="min-h-0 flex-1 overflow-y-auto"
          onScroll={(e) => {
            const el = e.currentTarget;
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-6 md:px-6 md:py-8">
            {chat.turns.length === 0 ? (
              <ChatEmptyState org={org} isAdmin={isAdmin} documents={documents} onAsk={(q) => void send(q)} />
            ) : (
              chat.turns.map((turn, index) =>
                turn.kind === "user" ? (
                  <p
                    key={turn.id}
                    className="max-w-[85%] self-end rounded-xl rounded-br-sm bg-card px-4 py-2.5 text-[0.9375rem] leading-relaxed whitespace-pre-wrap shadow-xs ring-1 ring-border"
                  >
                    {turn.content}
                  </p>
                ) : (
                  <AssistantMessage
                    key={turn.id}
                    turn={turn}
                    orgSlug={org.slug}
                    isAdmin={isAdmin}
                    scopeCount={scopeCount}
                    isLast={index === chat.turns.length - 1}
                    onOpenSource={openSource}
                    onRetry={(t) => {
                      pinned.current = true;
                      void chat.retry(t);
                    }}
                    onFeedback={chat.setFeedback}
                  />
                ),
              )
            )}
          </div>
        </div>

        <div className="shrink-0 px-3 pb-3 md:px-6 md:pb-5">
          <div className="mx-auto w-full max-w-3xl">
            <Composer
              ref={composerRef}
              documents={documents}
              scope={scope}
              onScopeChange={setScope}
              streaming={chat.streaming}
              onSend={send}
              onStop={chat.stop}
            />
            <p className="pt-2 text-center text-[0.7rem] text-muted-foreground">
              Answers come from {org.name}&apos;s documents. Open a citation to check the exact wording.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChatEmptyState({
  org,
  isAdmin,
  documents,
  onAsk,
}: {
  org: ChatOrg;
  isAdmin: boolean;
  documents: CatalogDoc[];
  onAsk: (question: string) => void;
}) {
  const groups = useMemo(() => buildSuggestions(documents), [documents]);
  const [department, setDepartment] = useState(groups[0]?.department ?? "");
  const active = groups.find((g) => g.department === department) ?? groups[0];

  if (documents.length === 0) {
    return (
      <Empty className="mt-[8vh]">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileTextIcon />
          </EmptyMedia>
          <EmptyTitle className="font-heading text-xl">No documents to answer from yet</EmptyTitle>
          <EmptyDescription>
            {isAdmin
              ? `Upload ${org.name}'s policy PDFs and they'll be ready to ask about in a minute or two.`
              : `${org.name} hasn't added any policy documents yet. Ask your administrator to upload them.`}
          </EmptyDescription>
        </EmptyHeader>
        {isAdmin && (
          <EmptyContent>
            <ButtonLink href={`/app/${org.slug}/documents`}>Upload documents</ButtonLink>
          </EmptyContent>
        )}
      </Empty>
    );
  }

  return (
    <section aria-labelledby="chat-empty-title" className="flex flex-col gap-6 pt-[6vh]">
      <div className="flex flex-col gap-2">
        <h2 id="chat-empty-title" className="font-heading text-2xl leading-tight font-semibold tracking-[-0.01em]">
          What do you need to know?
        </h2>
        <p className="max-w-[60ch] text-sm text-muted-foreground">
          Ask in plain words. Every answer cites the document, section and page it comes from, across {documents.length}{" "}
          {org.name} document{documents.length === 1 ? "" : "s"}.
        </p>
      </div>

      {active && (
        <div className="flex flex-col gap-3">
          <ToggleGroup
            value={[active.department]}
            onValueChange={(value: string[]) => value[0] && setDepartment(value[0])}
            aria-label="Suggested questions by department"
            variant="outline"
            size="sm"
            className="flex-wrap"
            spacing={1}
          >
            {groups.map((g) => (
              <ToggleGroupItem key={g.department} value={g.department}>
                {g.department}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <ul className="grid gap-2 sm:grid-cols-2">
            {active.questions.map((question) => (
              <li key={question}>
                <button
                  type="button"
                  onClick={() => onAsk(question)}
                  className={cn(
                    "flex h-full w-full items-start rounded-lg border bg-card px-3.5 py-3 text-left text-sm transition-colors",
                    "hover:border-ring/40 hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                  )}
                >
                  {question}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

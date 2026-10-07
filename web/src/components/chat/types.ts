import type { Citation, MessageStatus, MessageUsage, Routing, Source, StoredMessage } from "@/lib/api-types";

/** Narrow catalog entry for the scope picker and the empty-state suggestions. */
export type CatalogDoc = {
  id: string;
  doc_code: string | null;
  title: string;
  department: string | null;
  jurisdiction: string | null;
  doc_type: string | null;
};

export type ChatOrg = { id: string; slug: string; name: string };

/** routing → searching (sources pending) → reading (sources in, no text yet) → answering. */
export type AnswerPhase = "routing" | "searching" | "reading" | "answering" | "done";

export type UserTurn = { kind: "user"; id: string; content: string };

export type AssistantTurn = {
  kind: "assistant";
  id: string;
  /** False until the server's message id arrives (feedback needs it). */
  persisted: boolean;
  content: string;
  status: MessageStatus;
  phase: AnswerPhase;
  routing: Routing | null;
  sources: Source[];
  citations: Citation[];
  usage: MessageUsage | null;
  feedback: 1 | -1 | null;
  feedbackComment: string | null;
  error: string | null;
  /** The question and scope that produced this answer, for Retry. */
  question: string;
  documentIds: string[] | null;
};

export type Turn = UserTurn | AssistantTurn;

export function turnsFromStored(messages: StoredMessage[], documentIds: string[]): Turn[] {
  const turns: Turn[] = [];
  let lastQuestion = "";
  for (const m of messages) {
    if (m.role === "user") {
      lastQuestion = m.content;
      turns.push({ kind: "user", id: m.id, content: m.content });
      continue;
    }
    turns.push({
      kind: "assistant",
      id: m.id,
      persisted: true,
      content: m.content,
      status: m.status,
      phase: "done",
      routing: m.routing,
      sources: m.sources ?? [],
      citations: m.citations ?? [],
      usage: m.usage ?? null,
      feedback: m.feedback,
      feedbackComment: m.feedback_comment,
      error: m.status === "error" ? "This answer failed before it finished." : null,
      question: lastQuestion,
      documentIds: documentIds.length ? documentIds : null,
    });
  }
  return turns;
}

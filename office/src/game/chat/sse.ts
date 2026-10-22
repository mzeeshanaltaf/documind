import { createParser } from "eventsource-parser";
import type { Citation, MessageUsage, Routing, Source } from "@/lib/api-types";

/**
 * One NPC chat turn as data, and the stream that fills it. Ported from DocuMind's
 * `web/src/hooks/use-chat-stream.ts` (the parsing loop and the `handle()` switch), split into a
 * pure reducer (`applyEvent`) and the network part (`streamChat`) so both are unit-tested with
 * recorded SSE. Events: meta → routing → sources → delta… → citations → usage → done | error.
 */

export type TurnStatus = "streaming" | "complete" | "error" | "stopped" | "refused";
/** What the status line says while streaming. */
export type TurnPhase = "sending" | "searching" | "reading" | "answering" | "done";

/** A refusal the NPC voices in-world instead of answering (phase O5 › Refusals). */
export type Refusal =
  | { code: "quota_exceeded"; resetsOn: string | null }
  /** `until`: epoch ms when asking again is allowed (the countdown). */
  | { code: "rate_limited"; retryAfter: number; until: number }
  | { code: "unknown_documents" }
  | { code: "failed"; message: string };

export type TurnMeta = { conversationId: string; userMessageId: string; assistantMessageId: string };

export type NpcTurn = {
  /** Local until `meta` names the assistant message. */
  id: string;
  question: string;
  documentIds: string[] | null;
  content: string;
  status: TurnStatus;
  phase: TurnPhase;
  routing: Routing | null;
  sources: Source[];
  citations: Citation[];
  usage: MessageUsage | null;
  error: string | null;
  meta: TurnMeta | null;
  refusal: Refusal | null;
  /** Re-asks the previous turn's question (after a refusal the NPC recovered from). */
  retry: boolean;
};

export type ChatEvent = { event: string; data: unknown };

export const CUT_OFF = "The answer was cut off. Try again.";
export const DROPPED = "The connection dropped before the answer finished.";

export function newTurn(id: string, question: string, documentIds: string[] | null, retry = false): NpcTurn {
  return {
    id,
    question,
    documentIds,
    content: "",
    status: "streaming",
    phase: "sending",
    routing: null,
    sources: [],
    citations: [],
    usage: null,
    error: null,
    meta: null,
    refusal: null,
    retry,
  };
}

export function isStreaming(turn: NpcTurn): boolean {
  return turn.status === "streaming";
}

/** The pure reducer: one SSE event applied to a turn. Events after the end are ignored. */
export function applyEvent(turn: NpcTurn, { event, data }: ChatEvent): NpcTurn {
  if (!isStreaming(turn)) return turn;
  const payload = (data ?? {}) as Record<string, unknown>;
  switch (event) {
    case "meta": {
      const meta = {
        conversationId: String(payload.conversation_id),
        userMessageId: String(payload.user_message_id),
        assistantMessageId: String(payload.assistant_message_id),
      };
      return { ...turn, id: meta.assistantMessageId, meta };
    }
    case "routing":
      return { ...turn, routing: payload as unknown as Routing, phase: "searching" };
    case "sources":
      return { ...turn, sources: Array.isArray(data) ? (data as Source[]) : [], phase: "reading" };
    case "delta":
      return { ...turn, content: turn.content + String(payload.text ?? ""), phase: "answering" };
    case "citations":
      return { ...turn, citations: Array.isArray(data) ? (data as Citation[]) : [] };
    case "usage":
      return { ...turn, usage: payload as MessageUsage };
    case "done":
      return { ...turn, status: "complete", phase: "done" };
    case "error":
      return { ...turn, status: "error", phase: "done", error: typeof payload.message === "string" ? payload.message : CUT_OFF };
    default:
      return turn;
  }
}

/**
 * How a stream ended, applied after the last event: `ended` (the body closed; with no `done` or
 * `error` the answer was cut off), `aborted` (Stop) or `failed` (the connection dropped).
 */
export function endTurn(turn: NpcTurn, how: "ended" | "aborted" | "failed"): NpcTurn {
  if (!isStreaming(turn)) return turn;
  if (how === "aborted") return { ...turn, status: "stopped", phase: "done" };
  return { ...turn, status: "error", phase: "done", error: how === "ended" ? CUT_OFF : DROPPED };
}

/** A pre-stream refusal: the turn ends without an answer. */
export function refuseTurn(turn: NpcTurn, refusal: Refusal): NpcTurn {
  return { ...turn, status: "refused", phase: "done", refusal };
}

/** "Looking up policies…", "Reading 6 sources…", "Answering…"; empty once the turn ends. */
export function statusLine(turn: NpcTurn): string {
  if (!isStreaming(turn)) return "";
  if (turn.phase === "reading") return `Reading ${turn.sources.length} source${turn.sources.length === 1 ? "" : "s"}…`;
  if (turn.phase === "answering") return "Answering…";
  return "Looking up policies…";
}

export type StreamOutcome =
  /** The body was read to the end; `terminal` = a `done` or `error` event arrived. */
  | { kind: "streamed"; terminal: boolean }
  /** Refused before streaming: DocuMind's JSON error (or the BFF's rate limit). */
  | { kind: "rejected"; status: number; code: string | null; message: string | null; details: unknown; retryAfter: number | null };

export type ChatBody = { conversation_id?: string | null; message: string; document_ids?: string[] };

/**
 * POSTs one question and feeds each SSE event to `onEvent`. A Stop (the signal) rejects with
 * the abort error; the caller tells it apart from a dropped connection by `signal.aborted`.
 */
export async function streamChat(
  url: string,
  body: ChatBody,
  onEvent: (event: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<StreamOutcome> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok || !response.body) {
    const json = (await response.json().catch(() => ({}))) as { error?: { code?: string; message?: string; details?: unknown } };
    const retry = Number(response.headers.get("Retry-After"));
    return {
      kind: "rejected",
      status: response.status,
      code: json.error?.code ?? null,
      message: json.error?.message ?? null,
      details: json.error?.details ?? null,
      retryAfter: Number.isFinite(retry) && retry > 0 ? retry : null,
    };
  }

  let terminal = false;
  const parser = createParser({
    onEvent: ({ event = "message", data }) => {
      let parsed: unknown = {};
      if (data) {
        try {
          parsed = JSON.parse(data);
        } catch {
          return;
        }
      }
      if (event === "done" || event === "error") terminal = true;
      onEvent({ event, data: parsed });
    },
  });
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    parser.feed(value);
  }
  return { kind: "streamed", terminal };
}

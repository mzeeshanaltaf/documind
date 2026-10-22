import { useCallback, useEffect, useRef } from "react";
import { mutate } from "swr";
import { audio } from "@/game/audio/audio";
import { emit } from "@/game/quests/bus";
import { EMPTY_THREAD, useGame } from "@/game/store/game-store";
import { QUOTA_URL } from "@/lib/api-types";
import { applyEvent, endTurn, isStreaming, type NpcTurn, newTurn, type Refusal, refuseTurn, streamChat } from "./sse";

/**
 * Sends and stops an NPC's chat turns (phase O5 › Chat hook). The conversation lives in the
 * store's `chat` slice under `key`, not in component state, so a stream keeps filling it after the
 * dialogue closes and the player walks away. One stream per NPC at a time.
 */
export type NpcChatOptions = {
  orgId: string;
  /** The NPC's scope (lib/scope.ts); null = unscoped (DocuMind routes). */
  documentIds: string[] | null;
  /** `threadKey(location, npc)`. */
  key: string;
  npc: string;
  /** Null at reception. */
  department: string | null;
  /** The office location id, for `question_asked`. */
  location: string;
  /** After 422 `unknown_documents`: refetch the org's documents and return the fresh scope. */
  rescope?: () => Promise<string[] | null>;
};

const controllers = new Map<string, AbortController>();

function chatUrl(orgId: string) {
  return `/api/backend/orgs/${encodeURIComponent(orgId)}/chat`;
}

/** The quota may have changed after any attempt; titles are metered just after `done`, too. */
function refreshQuota() {
  void mutate(QUOTA_URL);
  setTimeout(() => void mutate(QUOTA_URL), 3000);
}

function departmentOf(documentId: string): string | null {
  return useGame.getState().office?.documents.find((d) => d.id === documentId)?.department ?? null;
}

async function runTurn(options: NpcChatOptions, question: string, documentIds: string[] | null, retried = false) {
  const { key } = options;
  const { updateThread } = useGame.getState();
  let turnId = `local-${crypto.randomUUID()}`;
  const conversationId = useGame.getState().chat[key]?.conversationId ?? null;
  updateThread(key, (thread) => ({ ...thread, turns: [...thread.turns, newTurn(turnId, question, documentIds, retried)] }));

  const patch = (update: (turn: NpcTurn) => NpcTurn) =>
    updateThread(key, (thread) => {
      let nextId = turnId;
      const turns = thread.turns.map((turn) => {
        if (turn.id !== turnId) return turn;
        const next = update(turn);
        nextId = next.id;
        return next;
      });
      turnId = nextId;
      return { ...thread, turns };
    });

  const controller = new AbortController();
  controllers.set(key, controller);
  let retry: (() => Promise<void>) | null = null;
  try {
    const outcome = await streamChat(
      chatUrl(options.orgId),
      {
        conversation_id: conversationId,
        message: question,
        ...(documentIds?.length ? { document_ids: documentIds } : {}),
      },
      (event) => {
        patch((turn) => applyEvent(turn, event));
        if (event.event === "meta" && !conversationId) {
          const id = String((event.data as { conversation_id?: unknown }).conversation_id);
          updateThread(key, (thread) => ({ ...thread, conversationId: id }));
        } else if (event.event === "citations" && Array.isArray(event.data)) {
          const seen = new Set<string>();
          for (const citation of event.data as { document_id: string; doc_code: string | null }[]) {
            if (seen.has(citation.document_id)) continue;
            seen.add(citation.document_id);
            emit({ type: "citation_shown", doc_code: citation.doc_code, department: departmentOf(citation.document_id) });
          }
        } else if (event.event === "done") {
          emit({ type: "question_asked", npc: options.npc, department: options.department, location: options.location });
        }
      },
      controller.signal,
    );

    if (outcome.kind === "streamed") {
      if (!outcome.terminal) patch((turn) => endTurn(turn, "ended"));
      return;
    }

    let refusal: Refusal;
    if (outcome.code === "quota_exceeded") {
      const details = outcome.details as { resets_on?: string } | null;
      refusal = { code: "quota_exceeded", resetsOn: details?.resets_on ?? null };
    } else if (outcome.status === 429) {
      const retryAfter = outcome.retryAfter ?? 30;
      refusal = { code: "rate_limited", retryAfter, until: Date.now() + retryAfter * 1000 };
    } else if (outcome.code === "unknown_documents" && !retried && options.rescope) {
      refusal = { code: "unknown_documents" };
      const rescope = options.rescope;
      retry = async () => runTurn(options, question, await rescope(), true);
    } else if (outcome.code === "not_found" && conversationId && !retried) {
      // The conversation was deleted in DocuMind: start a new one with the same question.
      refusal = { code: "failed", message: "That conversation is gone, so I've started a new one." };
      retry = async () => {
        updateThread(key, (thread) => ({ ...thread, conversationId: null }));
        await runTurn(options, question, documentIds, true);
      };
    } else {
      refusal = { code: "failed", message: outcome.message ?? "I couldn't send that. Check your connection and try again." };
    }
    audio.play("ui-deny", { volume: 0.4 });
    patch((turn) => refuseTurn(turn, refusal));
  } catch (error) {
    if (controller.signal.aborted) {
      patch((turn) => endTurn(turn, "aborted"));
    } else {
      console.error("NPC chat stream failed", error);
      patch((turn) => endTurn(turn, "failed"));
    }
  } finally {
    if (controllers.get(key) === controller) controllers.delete(key);
    refreshQuota();
  }
  if (retry) await retry();
}

export function useNpcChat(options: NpcChatOptions) {
  const { key } = options;
  const thread = useGame((s) => s.chat[key] ?? EMPTY_THREAD);
  const streaming = thread.turns.some(isStreaming);

  // The latest options when called (the object is new on every render).
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  const send = useCallback((question: string) => {
    const current = latest.current;
    const message = question.trim();
    const existing = useGame.getState().chat[current.key] ?? EMPTY_THREAD;
    if (!message || controllers.has(current.key) || existing.turns.some(isStreaming)) return false;
    void runTurn(current, message.slice(0, 4000), current.documentIds);
    return true;
  }, []);

  const stop = useCallback(() => controllers.get(key)?.abort(), [key]);

  return { thread, streaming, send, stop };
}

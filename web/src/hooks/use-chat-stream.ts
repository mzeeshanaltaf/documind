"use client";

import { createParser } from "eventsource-parser";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import type { AssistantTurn, Turn } from "@/components/chat/types";
import type { ApiErrorBody, Citation, MessageUsage, Routing, Source } from "@/lib/api-types";

type Options = {
  orgId: string;
  /** e.g. /app/simtora/chat; the URL becomes <basePath>/<id> once a new conversation exists. */
  basePath: string;
  initialConversationId: string | null;
  initialTurns: Turn[];
  onConversationStarted?: (conversationId: string) => void;
  onTurnFinished?: (conversationId: string) => void;
};

export type SendResult = "sent" | "rejected";

const CUT_OFF = "The answer was cut off. Try again.";

/**
 * Streams one chat turn from POST /api/backend/orgs/{orgId}/chat (SSE):
 * meta → routing → sources → delta… → citations → usage → done | error.
 */
export function useChatStream({
  orgId,
  basePath,
  initialConversationId,
  initialTurns,
  onConversationStarted,
  onTurnFinished,
}: Options) {
  const [turns, setTurns] = useState<Turn[]>(initialTurns);
  const [conversationId, setConversationId] = useState<string | null>(initialConversationId);
  const [streaming, setStreaming] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  const patch = useCallback((id: string, update: (turn: AssistantTurn) => Partial<AssistantTurn>) => {
    setTurns((prev) =>
      prev.map((turn) => (turn.kind === "assistant" && turn.id === id ? { ...turn, ...update(turn) } : turn)),
    );
  }, []);

  const send = useCallback(
    async (question: string, documentIds: string[] | null): Promise<SendResult> => {
      const message = question.trim();
      if (!message || controllerRef.current) return "rejected";

      const controller = new AbortController();
      controllerRef.current = controller;
      const userId = `local-user-${crypto.randomUUID()}`;
      let assistantId = `local-answer-${crypto.randomUUID()}`;
      let activeConversation = conversationId;
      let terminal = false;

      setStreaming(true);
      setTurns((prev) => [
        ...prev,
        { kind: "user", id: userId, content: message },
        {
          kind: "assistant",
          id: assistantId,
          persisted: false,
          content: "",
          status: "streaming",
          phase: "routing",
          routing: null,
          sources: [],
          citations: [],
          usage: null,
          feedback: null,
          feedbackComment: null,
          error: null,
          question: message,
          documentIds,
        },
      ]);

      const dropTurn = () => setTurns((prev) => prev.filter((t) => t.id !== userId && t.id !== assistantId));

      const handle = (event: string, data: string) => {
        const payload = data ? JSON.parse(data) : {};
        switch (event) {
          case "meta": {
            const meta = payload as { conversation_id: string; user_message_id: string; assistant_message_id: string };
            const localAssistant = assistantId;
            assistantId = meta.assistant_message_id;
            setTurns((prev) =>
              prev.map((t) => {
                if (t.id === userId) return { ...t, id: meta.user_message_id };
                if (t.id === localAssistant && t.kind === "assistant") return { ...t, id: meta.assistant_message_id, persisted: true };
                return t;
              }),
            );
            if (!activeConversation) {
              activeConversation = meta.conversation_id;
              setConversationId(meta.conversation_id);
              // Not router.replace: that would re-render the route and drop this live stream.
              window.history.replaceState(null, "", `${basePath}/${meta.conversation_id}`);
              onConversationStarted?.(meta.conversation_id);
            }
            break;
          }
          case "routing":
            patch(assistantId, () => ({ routing: payload as Routing, phase: "searching" }));
            break;
          case "sources":
            patch(assistantId, () => ({ sources: payload as Source[], phase: "reading" }));
            break;
          case "delta":
            patch(assistantId, (t) => ({ content: t.content + (payload as { text: string }).text, phase: "answering" }));
            break;
          case "citations":
            patch(assistantId, () => ({ citations: payload as Citation[] }));
            break;
          case "usage":
            patch(assistantId, () => ({ usage: payload as MessageUsage }));
            break;
          case "done":
            terminal = true;
            patch(assistantId, () => ({ status: "complete", phase: "done" }));
            break;
          case "error":
            terminal = true;
            patch(assistantId, () => ({
              status: "error",
              phase: "done",
              error: (payload as { message?: string }).message ?? CUT_OFF,
            }));
            break;
        }
      };

      try {
        const response = await fetch(`/api/backend/orgs/${encodeURIComponent(orgId)}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify({
            conversation_id: activeConversation,
            message,
            ...(documentIds?.length ? { document_ids: documentIds } : {}),
          }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
          dropTurn();
          if (response.status === 429) {
            const wait = response.headers.get("Retry-After");
            toast.error("Slow down a little", {
              description: wait ? `Too many questions in a minute. Try again in ${wait}s.` : body.error?.message,
            });
          } else {
            toast.error("Couldn't send your question", {
              description: body.error?.message ?? "Check your connection and try again.",
            });
          }
          return "rejected";
        }

        const parser = createParser({ onEvent: (ev) => handle(ev.event ?? "message", ev.data) });
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          parser.feed(value);
        }
        if (!terminal) patch(assistantId, () => ({ status: "error", phase: "done", error: CUT_OFF }));
      } catch (error) {
        if (controller.signal.aborted) {
          patch(assistantId, () => ({ status: "stopped", phase: "done" }));
        } else {
          console.error("Chat stream failed", error);
          patch(assistantId, () => ({
            status: "error",
            phase: "done",
            error: "The connection dropped before the answer finished.",
          }));
        }
      } finally {
        controllerRef.current = null;
        setStreaming(false);
        if (activeConversation) onTurnFinished?.(activeConversation);
      }
      return "sent";
    },
    [basePath, conversationId, onConversationStarted, onTurnFinished, orgId, patch],
  );

  const stop = useCallback(() => controllerRef.current?.abort(), []);

  /** Ask a failed or stopped question again (the failed pair is replaced). */
  const retry = useCallback(
    (turn: AssistantTurn) => {
      setTurns((prev) => {
        const index = prev.findIndex((t) => t.id === turn.id);
        // Drop the answer and the question just before it.
        return index > 0 && prev[index - 1].kind === "user"
          ? [...prev.slice(0, index - 1), ...prev.slice(index + 1)]
          : prev.filter((t) => t.id !== turn.id);
      });
      return send(turn.question, turn.documentIds);
    },
    [send],
  );

  const setFeedback = useCallback(
    (id: string, feedback: 1 | -1 | null, comment: string | null) => patch(id, () => ({ feedback, feedbackComment: comment })),
    [patch],
  );

  /** Back to an empty new chat (only between turns). */
  const reset = useCallback(() => {
    setTurns([]);
    setConversationId(null);
  }, []);

  return { turns, conversationId, streaming, send, stop, retry, setFeedback, reset };
}

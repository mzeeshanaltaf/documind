"use client";

import { ArrowUpIcon, ExternalLinkIcon, RotateCcwIcon, SquareIcon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { quotaLine, refusalLine } from "@/game/chat/lines";
import { isStreaming, type NpcTurn, statusLine } from "@/game/chat/sse";
import { useNpcChat } from "@/game/chat/use-npc-chat";
import { npcProfile, type NpcProfile } from "@/game/npc/profiles";
import { type OfficeContext, threadKey, useGame } from "@/game/store/game-store";
import type { DocumentList } from "@/lib/api-types";
import { fetchJson, quotaLevel, useQuota } from "@/lib/quota";
import { DOCUMIND_URL } from "@/lib/site";
import { cn } from "@/lib/utils";
import { AnswerMarkdown } from "./answer-markdown";

/**
 * The conversation with a DocuMind-backed NPC (phase O5 › Dialogue panel): the static greeting,
 * then the turns (answers as Markdown with their sources), a status line while streaming,
 * suggested questions, the composer and Stop. Refusals (quota, rate limit, changed files) are
 * spoken by the NPC, and the composer explains why it's disabled.
 */
export function NpcChat({ npc, profile, office }: { npc: string; profile: NpcProfile; office: OfficeContext }) {
  const key = threadKey(office.place.id, npc);
  const rescope = useCallback(async () => {
    const { documents } = await fetchJson<DocumentList>(`/api/backend/orgs/${encodeURIComponent(office.org.id)}/documents`);
    const state = useGame.getState();
    state.setDocuments(documents);
    return npcProfile(npc, state.office)?.scope.documentIds ?? null;
  }, [npc, office.org.id]);

  const { thread, streaming, send, stop } = useNpcChat({
    orgId: office.org.id,
    documentIds: profile.scope.documentIds,
    key,
    npc,
    department: profile.department,
    location: office.place.id,
    rescope,
  });

  const { data: quota } = useQuota();
  const exhausted = quota ? quotaLevel(quota) === "exhausted" : false;
  const last = thread.turns.at(-1);
  const limited = last?.refusal?.code === "rate_limited" ? last.refusal : null;
  const wait = useCountdown(limited?.until ?? 0, limited?.retryAfter ?? 0);
  const refusedForQuota = last?.refusal?.code === "quota_exceeded";

  const transcript = useRef<HTMLDivElement>(null);
  // Keep the newest text in view while it streams (unless the reader has scrolled up).
  const content = last ? `${last.id}:${last.content.length}:${last.status}` : "";
  useEffect(() => {
    const element = transcript.current;
    if (!element) return;
    if (element.scrollHeight - element.scrollTop - element.clientHeight < 120) element.scrollTop = element.scrollHeight;
  }, [content]);

  const disabledReason = exhausted
    ? "You've reached this month's quota."
    : wait > 0
      ? `Ask again in ${wait}s.`
      : null;

  return (
    <>
      <div ref={transcript} className="-mx-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-1">
        <NpcLine>{profile.greeting}</NpcLine>
        {thread.turns.map((turn, index) => (
          <Turn key={turn.id} turn={turn} showQuestion={!turn.retry} onRetry={index === thread.turns.length - 1 ? () => send(turn.question) : undefined} />
        ))}
        {exhausted && !refusedForQuota && <NpcLine>{quotaLine(quota?.resets_on ?? null)}</NpcLine>}
      </div>

      {thread.turns.length === 0 && !exhausted && (
        <div className="flex flex-wrap gap-1.5" aria-label="Suggested questions" role="group">
          {profile.suggestions.map((question) => (
            <button
              key={question}
              type="button"
              onClick={() => send(question)}
              className="rounded-lg bg-muted px-2.5 py-1.5 text-left text-[0.8rem] leading-snug outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {question}
            </button>
          ))}
        </div>
      )}

      <Composer
        streaming={streaming}
        disabledReason={disabledReason}
        onSend={send}
        onStop={stop}
        continueHref={thread.conversationId ? `${DOCUMIND_URL}/app/${office.org.slug}/chat/${thread.conversationId}` : null}
      />
    </>
  );
}

function NpcLine({ children }: { children: React.ReactNode }) {
  return <p className="max-w-[65ch] text-[0.9375rem] leading-relaxed">{children}</p>;
}

function Turn({ turn, showQuestion, onRetry }: { turn: NpcTurn; showQuestion: boolean; onRetry?: () => void }) {
  const streaming = isStreaming(turn);
  const status = statusLine(turn);
  return (
    <div className="flex flex-col gap-2.5">
      {showQuestion && (
        <p className="ml-auto max-w-[85%] rounded-lg bg-muted px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap">{turn.question}</p>
      )}
      {turn.refusal ? (
        <NpcLine>{refusalLine(turn.refusal)}</NpcLine>
      ) : (
        <div aria-live="polite" aria-busy={streaming} className="flex flex-col gap-2">
          {turn.content && <AnswerMarkdown content={turn.content} sources={turn.sources} />}
          {status && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner className="size-3.5" />
              {status}
            </p>
          )}
          {turn.status === "stopped" && <p className="text-xs text-muted-foreground">Stopped.</p>}
          {turn.status === "error" && (
            <p className="flex flex-wrap items-center gap-2 text-sm text-destructive">
              {turn.error}
              {onRetry && (
                <Button variant="ghost" size="xs" onClick={onRetry}>
                  <RotateCcwIcon data-icon="inline-start" />
                  Ask again
                </Button>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Seconds left until `until` (epoch ms), ticking down to 0 (at most `max`). */
function useCountdown(until: number, max: number): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!until) return;
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, 250);
    const first = setTimeout(tick, 0);
    return () => {
      clearInterval(timer);
      clearTimeout(first);
    };
  }, [until]);
  return until ? Math.min(max, Math.max(0, Math.ceil((until - now) / 1000))) : 0;
}

type ComposerProps = {
  streaming: boolean;
  disabledReason: string | null;
  onSend: (question: string) => boolean;
  onStop: () => void;
  continueHref: string | null;
};

function Composer({ streaming, disabledReason, onSend, onStop, continueHref }: ComposerProps) {
  const [value, setValue] = useState("");
  const id = useId();
  const hintId = `${id}-hint`;
  const disabled = disabledReason !== null;

  function submit() {
    if (disabled || streaming || !value.trim()) return;
    if (onSend(value)) setValue("");
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={cn(
          "flex items-end gap-2 rounded-lg border border-input bg-background p-1.5 pl-3 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
          disabled && "bg-muted/60",
        )}
      >
        <label htmlFor={id} className="sr-only">
          Your question
        </label>
        <textarea
          id={id}
          autoFocus
          rows={1}
          value={value}
          maxLength={4000}
          disabled={disabled}
          aria-describedby={hintId}
          placeholder={disabled ? "" : "Ask a question…"}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
          className="field-sizing-content max-h-32 min-h-8 flex-1 resize-none bg-transparent py-1.5 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        />
        {streaming ? (
          <Button size="icon" variant="outline" onClick={onStop} aria-label="Stop the answer">
            <SquareIcon className="size-3.5 fill-current" />
          </Button>
        ) : (
          <Button size="icon" onClick={submit} disabled={disabled || !value.trim()} aria-label="Ask">
            <ArrowUpIcon />
          </Button>
        )}
      </div>
      <div className="flex min-h-5 flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <p id={hintId} className={cn(disabled && "text-foreground")}>
          {disabledReason ?? "Enter to ask · Shift+Enter for a new line"}
        </p>
        {continueHref && (
          <a
            href={continueHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-sm underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Continue in DocuMind
            <ExternalLinkIcon className="size-3" aria-hidden />
          </a>
        )}
      </div>
    </div>
  );
}

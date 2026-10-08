"use client";

import {
  AlertCircleIcon,
  CheckIcon,
  ChevronRightIcon,
  CopyIcon,
  FilesIcon,
  RotateCcwIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from "lucide-react";
import { useId, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { submitFeedback } from "@/app/(app)/app/[orgSlug]/chat/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { track } from "@/lib/analytics";
import type { Routing } from "@/lib/api-types";
import { formatCost, formatDuration, jurisdictionName, pageLabel, sectionLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AnswerMarkdown } from "./answer-markdown";
import { CitationContext, type CitationTarget } from "./citation-chip";
import type { AssistantTurn } from "./types";

type Props = {
  turn: AssistantTurn;
  orgSlug: string;
  isAdmin: boolean;
  /** The conversation's scope, for "Scoped to N documents" on stored answers. */
  scopeCount: number;
  isLast: boolean;
  onOpenSource: (target: CitationTarget) => void;
  onRetry: (turn: AssistantTurn) => void;
  onFeedback: (id: string, value: 1 | -1 | null, comment: string | null) => void;
};

function list(items: string[]) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function phaseText(turn: AssistantTurn): string {
  if (turn.phase === "routing") return "Reading your question…";
  const routing = turn.routing;
  if (turn.phase === "reading") {
    const n = turn.sources.length;
    return n ? `Reading ${n} passage${n === 1 ? "" : "s"}…` : "Writing the answer…";
  }
  if (routing?.bypassed) return "Searching the selected documents…";
  if (routing?.departments.length) {
    const where = routing.jurisdiction ? ` for ${jurisdictionName(routing.jurisdiction)}` : "";
    return `Searching ${list(routing.departments)} policies${where}…`;
  }
  return "Searching all policies…";
}

function RoutingChips({ routing, scopeCount }: { routing: Routing; scopeCount: number }) {
  if (routing.bypassed) {
    const n = routing.document_ids?.length || scopeCount;
    return (
      <Badge variant="outline" className="gap-1 text-muted-foreground">
        <FilesIcon />
        {n ? `Scoped to ${n} document${n === 1 ? "" : "s"}` : "Scoped to selected documents"}
      </Badge>
    );
  }
  if (!routing.departments.length) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        General
      </Badge>
    );
  }
  return (
    <>
      {routing.departments.map((department) => (
        <Badge key={department} variant="outline" className="text-muted-foreground">
          <span className="text-foreground">{department} agent</span>
          {routing.jurisdiction && <span aria-hidden>·</span>}
          {routing.jurisdiction && <span>{jurisdictionName(routing.jurisdiction)}</span>}
        </Badge>
      ))}
    </>
  );
}

export function AssistantMessage({ turn, orgSlug, isAdmin, scopeCount, isLast, onOpenSource, onRetry, onFeedback }: Props) {
  const streaming = turn.status === "streaming";

  // Citations (with the highlight text) win; live sources fill in until they arrive.
  const citationContext = useMemo(() => {
    const byNumber = new Map<number, CitationTarget>();
    for (const source of turn.sources) byNumber.set(source.n, source);
    for (const citation of turn.citations) byNumber.set(citation.n, { ...byNumber.get(citation.n), ...citation });
    return { lookup: (n: number) => byNumber.get(n), open: onOpenSource };
  }, [turn.sources, turn.citations, onOpenSource]);

  const cited = useMemo(() => {
    if (turn.citations.length) return turn.citations.map((c) => citationContext.lookup(c.n) ?? c);
    return [];
  }, [turn.citations, citationContext]);

  return (
    <article className="flex flex-col gap-3" aria-label="Answer">
      {turn.routing && (
        <div className="flex flex-wrap gap-1.5">
          <RoutingChips routing={turn.routing} scopeCount={scopeCount} />
        </div>
      )}

      <div aria-live={isLast ? "polite" : undefined} aria-busy={streaming}>
        {streaming && !turn.content ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner />
            <span className="animate-pulse">{phaseText(turn)}</span>
          </p>
        ) : (
          <CitationContext value={citationContext}>
            <AnswerMarkdown content={turn.content} />
          </CitationContext>
        )}
      </div>

      {turn.status === "stopped" && (
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
          {turn.content ? "You stopped this answer." : "You stopped this answer before it started."}
          <Button variant="link" size="sm" className="h-auto p-0" onClick={() => onRetry(turn)}>
            Ask again
          </Button>
        </p>
      )}

      {turn.status === "error" && (
        <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-destructive/30 px-3 py-2.5 text-sm">
          <AlertCircleIcon className="size-4 shrink-0 text-destructive" aria-hidden />
          <span className="flex-1">{turn.error ?? "Something went wrong while answering."}</span>
          <Button variant="outline" size="sm" onClick={() => onRetry(turn)}>
            <RotateCcwIcon data-icon="inline-start" />
            Try again
          </Button>
        </div>
      )}

      {!streaming && cited.length > 0 && <SourcesList sources={cited} onOpen={onOpenSource} />}

      {!streaming && turn.status !== "error" && turn.content && (
        <AnswerFooter turn={turn} orgSlug={orgSlug} isAdmin={isAdmin} onFeedback={onFeedback} />
      )}
    </article>
  );
}

function SourcesList({ sources, onOpen }: { sources: CitationTarget[]; onOpen: (target: CitationTarget) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        render={<Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground data-panel-open:text-foreground" />}
      >
        <ChevronRightIcon data-icon="inline-start" className={cn("transition-transform duration-200", open && "rotate-90")} />
        {sources.length} source{sources.length === 1 ? "" : "s"}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol className="mt-1 flex flex-col divide-y overflow-hidden rounded-lg border">
          {sources.map((source) => (
            <li key={source.n}>
              <button
                type="button"
                onClick={() => onOpen(source)}
                className="flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
              >
                <span className="mt-0.5 inline-flex min-w-5 justify-center rounded-md bg-accent px-1 py-0.5 font-mono text-[0.7rem] leading-none text-accent-foreground">
                  {source.n}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium">{source.title}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {[source.doc_code, sectionLabel(source.section_number, source.section_title)].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="shrink-0 pt-0.5 font-mono text-[0.7rem] text-muted-foreground">
                  {pageLabel(source.page_start, source.page_end)}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}

function AnswerFooter({
  turn,
  orgSlug,
  isAdmin,
  onFeedback,
}: {
  turn: AssistantTurn;
  orgSlug: string;
  isAdmin: boolean;
  onFeedback: Props["onFeedback"];
}) {
  const [pending, startTransition] = useTransition();
  const [commentOpen, setCommentOpen] = useState(false);
  const [comment, setComment] = useState(turn.feedbackComment ?? "");
  const [copied, setCopied] = useState(false);
  const commentId = useId();

  function record(value: 1 | -1, note: string | null, after?: () => void) {
    if (!turn.persisted) return;
    const previous = { feedback: turn.feedback, comment: turn.feedbackComment };
    onFeedback(turn.id, value, note);
    startTransition(async () => {
      const result = await submitFeedback(orgSlug, turn.id, value, note);
      if (!result.ok) {
        onFeedback(turn.id, previous.feedback, previous.comment);
        toast.error(result.error);
        return;
      }
      // Adding a note to an existing 👎 re-records the same vote; count only changes.
      if (previous.feedback !== value) track("feedback_given", { value: value === 1 ? "up" : "down" });
      after?.();
    });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(turn.content.replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, ""));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy to the clipboard.");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1 text-muted-foreground">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Helpful"
              aria-pressed={turn.feedback === 1}
              disabled={pending || !turn.persisted}
              className="aria-pressed:text-primary"
              onClick={() => record(1, null)}
            />
          }
        >
          <ThumbsUpIcon className={cn(turn.feedback === 1 && "fill-current")} />
        </TooltipTrigger>
        <TooltipContent>{turn.feedback === 1 ? "Marked helpful" : "Helpful"}</TooltipContent>
      </Tooltip>
      <Popover open={commentOpen} onOpenChange={setCommentOpen}>
        <Tooltip>
          <TooltipTrigger
            render={
              <PopoverTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Not helpful"
                    aria-pressed={turn.feedback === -1}
                    disabled={pending || !turn.persisted}
                    className="aria-pressed:text-foreground"
                    onClick={() => {
                      if (turn.feedback !== -1) record(-1, null);
                    }}
                  />
                }
              />
            }
          >
            <ThumbsDownIcon className={cn(turn.feedback === -1 && "fill-current")} />
          </TooltipTrigger>
          <TooltipContent>Not helpful, tell us why</TooltipContent>
        </Tooltip>
        <PopoverContent align="start" className="w-80">
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              record(-1, comment.trim() || null, () => {
                setCommentOpen(false);
                toast.success("Thanks, that helps us improve the answers.");
              });
            }}
          >
            <PopoverHeader>
              <PopoverTitle>What was wrong?</PopoverTitle>
              <PopoverDescription>Optional. Your note goes to the people who maintain these documents.</PopoverDescription>
            </PopoverHeader>
            <label htmlFor={commentId} className="sr-only">
              What was wrong with this answer
            </label>
            <Textarea
              id={commentId}
              value={comment}
              maxLength={2000}
              placeholder="e.g. It quoted the U.S. policy, but I asked about France."
              onChange={(e) => setComment(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setCommentOpen(false)}>
                Skip
              </Button>
              <Button type="submit" size="sm" disabled={pending || !comment.trim()}>
                {pending && <Spinner data-icon="inline-start" />}
                Send note
              </Button>
            </div>
          </form>
        </PopoverContent>
      </Popover>
      <Tooltip>
        <TooltipTrigger
          render={<Button variant="ghost" size="icon-sm" aria-label={copied ? "Copied" : "Copy answer"} onClick={copy} />}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </TooltipTrigger>
        <TooltipContent>{copied ? "Copied" : "Copy answer"}</TooltipContent>
      </Tooltip>

      {isAdmin && turn.usage && (turn.usage.latency_ms !== null || turn.usage.cost_usd !== null) && (
        <span className="ml-auto font-mono text-[0.7rem] tabular-nums" title="Time to full answer and its LLM cost (admins only)">
          {[
            turn.usage.latency_ms !== null ? formatDuration(turn.usage.latency_ms) : null,
            turn.usage.cost_usd !== null ? formatCost(turn.usage.cost_usd) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      )}
    </div>
  );
}

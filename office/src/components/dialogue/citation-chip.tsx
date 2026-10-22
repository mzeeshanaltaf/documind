"use client";

import { ChevronRightIcon } from "lucide-react";
import { createContext, use, useState } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import type { CitationTarget } from "@/game/chat/citations";
import { pageLabel, sectionLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Citation chips, their hover cards and an answer's sources list (phase O6 › Citations). Copied
 * from DocuMind's web/src/components/chat/citation-chip.tsx and assistant-message.tsx
 * (2026-10-22): chip → hover card (section and passage) → click opens the PDF at the passage.
 */
type CitationContextValue = {
  /** The cited source for [n]: the citation once it arrives, else the retrieved source. */
  lookup: (n: number) => CitationTarget | undefined;
  open: (target: CitationTarget) => void;
};

export const CitationContext = createContext<CitationContextValue | null>(null);

function snippetOf(target: CitationTarget): string | null {
  const raw = target.snippet ?? target.text;
  if (!raw) return null;
  let flat = raw.replace(/\s+/g, " ").trim();
  // Chunks open with their heading, which the card already shows above the passage.
  const heading = [target.section_number, target.section_title].filter(Boolean).join(" ");
  if (heading && flat.toLowerCase().startsWith(heading.toLowerCase())) flat = flat.slice(heading.length).trim();
  if (!flat) return null;
  return flat.length > 280 ? `${flat.slice(0, 280).replace(/\s+\S*$/, "")}…` : flat;
}

/** The citation card: mono code + serif title + page, rule, section path, passage. */
export function SourceCard({ target, className }: { target: CitationTarget; className?: string }) {
  const snippet = snippetOf(target);
  const path = target.section_path?.length ? target.section_path.join(" › ") : null;
  return (
    <div className={cn("flex flex-col", className)}>
      <div className="flex items-baseline justify-between gap-3 border-b pb-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          {target.doc_code && <span className="font-mono text-[0.7rem] tracking-wide text-muted-foreground">{target.doc_code}</span>}
          <span className="font-heading text-sm leading-snug font-semibold">{target.title}</span>
        </div>
        <span className="shrink-0 font-mono text-[0.7rem] text-muted-foreground">{pageLabel(target.page_start, target.page_end)}</span>
      </div>
      {(path || target.section_title) && (
        <p className="pt-2 font-heading text-[0.8125rem] font-semibold">
          {target.section_number && <span className="mr-1.5 font-mono text-xs font-normal text-muted-foreground">{target.section_number}</span>}
          {path ?? target.section_title}
        </p>
      )}
      {snippet && <p className="pt-1.5 font-heading text-[0.8125rem] leading-relaxed text-muted-foreground">{snippet}</p>}
    </div>
  );
}

export function CitationChip({ n }: { n: number }) {
  const context = use(CitationContext);
  const target = context?.lookup(n);

  if (!context || !target) {
    // Not (yet) matched to a source: keep the number visible but inert.
    return (
      <span className="mx-0.5 inline-flex -translate-y-px items-center rounded-md bg-muted px-1.5 py-0.5 align-middle font-mono text-[0.7rem] leading-none text-muted-foreground">
        {n}
      </span>
    );
  }

  const label = [`Source ${n}:`, target.doc_code, target.title, sectionLabel(target.section_number, target.section_title), pageLabel(target.page_start, target.page_end)]
    .filter(Boolean)
    .join(" ");

  return (
    <HoverCard>
      <HoverCardTrigger
        delay={250}
        closeDelay={100}
        render={
          <button
            type="button"
            data-citation={n}
            aria-label={`${label}. Open the document at this passage.`}
            onClick={() => context.open(target)}
            className="mx-0.5 inline-flex -translate-y-px cursor-pointer items-center rounded-md bg-accent px-1.5 py-0.5 align-middle font-mono text-[0.7rem] leading-none text-accent-foreground transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          />
        }
      >
        {n}
      </HoverCardTrigger>
      <HoverCardContent side="top" className="w-80 p-3.5">
        <SourceCard target={target} />
        <p className="pt-2.5 text-xs text-muted-foreground">Click to open the PDF at this passage.</p>
      </HoverCardContent>
    </HoverCard>
  );
}

/** "3 sources" under an answer, collapsed; each row opens its PDF at the passage. */
export function SourcesList({ sources, onOpen }: { sources: CitationTarget[]; onOpen: (target: CitationTarget) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger render={<Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground data-panel-open:text-foreground" />}>
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
                <span className="shrink-0 pt-0.5 font-mono text-[0.7rem] text-muted-foreground">{pageLabel(source.page_start, source.page_end)}</span>
              </button>
            </li>
          ))}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}

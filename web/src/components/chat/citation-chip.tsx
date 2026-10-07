"use client";

import { createContext, use } from "react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import type { Citation, Source } from "@/lib/api-types";
import { pageLabel, sectionLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

export type CitationTarget = Source & Partial<Pick<Citation, "snippet" | "highlight_text">>;

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

/** The citation card: mono code + serif title + page, rule, section, passage. Used in hover cards. */
export function SourceCard({ target, className }: { target: CitationTarget; className?: string }) {
  const snippet = snippetOf(target);
  const section = sectionLabel(target.section_number, target.section_title);
  return (
    <div className={cn("flex flex-col", className)}>
      <div className="flex items-baseline justify-between gap-3 border-b pb-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          {target.doc_code && (
            <span className="font-mono text-[0.7rem] tracking-wide text-muted-foreground">{target.doc_code}</span>
          )}
          <span className="font-heading text-sm leading-snug font-semibold">{target.title}</span>
        </div>
        <span className="shrink-0 font-mono text-[0.7rem] text-muted-foreground">
          {pageLabel(target.page_start, target.page_end)}
        </span>
      </div>
      {section && (
        <p className="pt-2 font-heading text-[0.8125rem] font-semibold">
          {target.section_number && (
            <span className="mr-1.5 font-mono text-xs font-normal text-muted-foreground">{target.section_number}</span>
          )}
          {target.section_title}
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

  const label = [
    `Source ${n}:`,
    target.doc_code,
    target.title,
    sectionLabel(target.section_number, target.section_title),
    pageLabel(target.page_start, target.page_end),
  ]
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

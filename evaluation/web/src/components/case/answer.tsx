"use client";

import { createContext, memo, use } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import type { ContextOut } from "@/lib/api-types";
import { pageLabel } from "@/lib/format";
import { Highlighted, withoutHeading } from "./highlight";
import { remarkCitations } from "./remark-citations";

export type CitedSource = Pick<
  ContextOut,
  "n" | "doc_code" | "section_number" | "section_title" | "page_start" | "page_end" | "text"
> & { title?: string | null; quotes: string[] };

const SourcesContext = createContext<Record<number, CitedSource>>({});

/** The full passage behind [n], with the evidence quotes the claim checks found marked. */
function SourcePassage({ source }: { source: CitedSource }) {
  return (
    <div className="flex flex-col">
      <div className="flex items-baseline justify-between gap-3 border-b pb-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          {source.doc_code && <span className="font-mono text-[0.7rem] tracking-wide text-muted-foreground">{source.doc_code}</span>}
          {source.title && <span className="font-heading text-sm leading-snug font-semibold">{source.title}</span>}
        </div>
        <span className="shrink-0 font-mono text-[0.7rem] text-muted-foreground">{pageLabel(source.page_start, source.page_end)}</span>
      </div>
      {source.section_title && (
        <p className="pt-2 font-heading text-[0.8125rem] font-semibold">
          {source.section_number && (
            <span className="mr-1.5 font-mono text-xs font-normal text-muted-foreground">{source.section_number}</span>
          )}
          {source.section_title}
        </p>
      )}
      <p className="max-h-72 overflow-y-auto pt-1.5 font-heading text-[0.8125rem] leading-relaxed whitespace-pre-line text-muted-foreground">
        {source.text ? (
          <Highlighted text={withoutHeading(source.text, source.section_number, source.section_title)} quotes={source.quotes} />
        ) : (
          "The source text wasn't stored for this run."
        )}
      </p>
    </div>
  );
}

function Chip({ n }: { n: number }) {
  const source = use(SourcesContext)[n];
  if (!source) {
    // A marker with no matching source: an invalid citation (citation_validity counts these).
    return (
      <span
        title="No source with this number"
        className="mx-0.5 inline-flex -translate-y-px items-center rounded-md bg-destructive/10 px-1.5 py-0.5 align-middle font-mono text-[0.7rem] leading-none text-destructive"
      >
        {n}
      </span>
    );
  }
  return (
    <HoverCard>
      <HoverCardTrigger
        delay={150}
        closeDelay={100}
        render={
          <button
            type="button"
            aria-label={`Source ${n}: ${[source.doc_code, source.section_number && `§${source.section_number}`, pageLabel(source.page_start, source.page_end)].filter(Boolean).join(" ")}`}
            className="mx-0.5 inline-flex -translate-y-px cursor-default items-center rounded-md bg-accent px-1.5 py-0.5 align-middle font-mono text-[0.7rem] leading-none text-accent-foreground transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          />
        }
      >
        {n}
      </HoverCardTrigger>
      <HoverCardContent side="top" className="w-96 p-3.5">
        <SourcePassage source={source} />
      </HoverCardContent>
    </HoverCard>
  );
}

const remarkPlugins = [remarkGfm, remarkCitations];
const components: Components = {
  sup({ node, children, ...props }) {
    const cite = node?.properties?.dataCite;
    if (cite !== undefined) return <Chip n={Number(cite)} />;
    return <sup {...props}>{children}</sup>;
  },
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
};

/** DocuMind's answer as it was shown, [n] markers as chips that open the cited passage. */
export const CaseAnswer = memo(function CaseAnswer({ answer, sources }: { answer: string; sources: Record<number, CitedSource> }) {
  return (
    <SourcesContext value={sources}>
      <div className="answer-prose max-w-[72ch]">
        <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
          {answer}
        </ReactMarkdown>
      </div>
    </SourcesContext>
  );
});

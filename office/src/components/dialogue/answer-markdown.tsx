"use client";

import { createContext, memo, use } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Source } from "@/lib/api-types";
import { remarkCitations } from "./remark-citations";

/**
 * An NPC's answer as Markdown (DocuMind's `AnswerMarkdown`, web/src/components/chat). Each [n]
 * marker shows its source's document code and page (O6 turns them into chips that open the PDF).
 * No raw HTML is rendered.
 */
const SourcesContext = createContext<Source[]>([]);

function pageLabel(source: Source): string | null {
  if (source.page_start === null) return null;
  return source.page_end !== null && source.page_end !== source.page_start
    ? `pp. ${source.page_start}–${source.page_end}`
    : `p. ${source.page_start}`;
}

function SourceTag({ n }: { n: number }) {
  const source = use(SourcesContext).find((s) => s.n === n);
  const code = source?.doc_code ?? (source ? source.title : `Source ${n}`);
  const page = source ? pageLabel(source) : null;
  return (
    <span
      title={source ? `${source.title}${source.section_title ? `, ${source.section_title}` : ""}` : undefined}
      className="mx-0.5 inline-flex items-baseline gap-1 rounded-sm bg-accent px-1 py-px align-baseline font-mono text-[0.68rem] leading-none whitespace-nowrap text-accent-foreground"
    >
      {code}
      {page && <span className="text-muted-foreground">{page}</span>}
    </span>
  );
}

const remarkPlugins = [remarkGfm, remarkCitations];

const components: Components = {
  sup({ node, children, ...props }) {
    const cite = node?.properties?.dataCite;
    if (cite !== undefined) return <SourceTag n={Number(cite)} />;
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

export const AnswerMarkdown = memo(function AnswerMarkdown({ content, sources }: { content: string; sources: Source[] }) {
  return (
    <SourcesContext value={sources}>
      <div className="answer-prose">
        <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
          {content}
        </ReactMarkdown>
      </div>
    </SourcesContext>
  );
});

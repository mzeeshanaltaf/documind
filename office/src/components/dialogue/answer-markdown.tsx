"use client";

import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CitationChip } from "./citation-chip";
import { remarkCitations } from "./remark-citations";

/**
 * An NPC's answer as Markdown (DocuMind's `AnswerMarkdown`, web/src/components/chat), with each
 * [n] marker as a citation chip; the chips read their sources from `CitationContext`. No raw HTML
 * is rendered.
 */
const remarkPlugins = [remarkGfm, remarkCitations];

const components: Components = {
  sup({ node, children, ...props }) {
    const cite = node?.properties?.dataCite;
    if (cite !== undefined) return <CitationChip n={Number(cite)} />;
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

export const AnswerMarkdown = memo(function AnswerMarkdown({ content }: { content: string }) {
  return (
    <div className="answer-prose">
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
});

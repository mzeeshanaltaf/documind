"use client";

import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CitationChip } from "./citation-chip";
import { remarkCitations } from "./remark-citations";

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

/** An answer's markdown with [n] markers as citation chips. No raw HTML is rendered. */
export const AnswerMarkdown = memo(function AnswerMarkdown({ content }: { content: string }) {
  return (
    <div className="answer-prose">
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
});

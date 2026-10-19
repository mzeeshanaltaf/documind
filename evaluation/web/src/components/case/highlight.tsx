import { Fragment } from "react";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A quote as a whitespace- and case-tolerant pattern (judges quote with normalized spacing). */
function quotePattern(quote: string): string | null {
  const words = quote.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || quote.trim().length < 4) return null;
  return words.map(escapeRegExp).join("\\s+");
}

/** Chunks open with their heading, which the card already shows above the passage. */
export function withoutHeading(text: string, number: string | null | undefined, title: string | null | undefined): string {
  const heading = [number, title].filter(Boolean).join(" ");
  const trimmed = text.trimStart();
  if (heading && trimmed.toLowerCase().startsWith(heading.toLowerCase())) return trimmed.slice(heading.length).trimStart();
  return text;
}

/**
 * `text` with every occurrence of `quotes` wrapped in a highlighter <mark>. Highlighter yellow
 * means "this exact text is the evidence" (DESIGN.md › The Highlighter Rule), nothing else.
 */
export function Highlighted({ text, quotes }: { text: string; quotes: string[] }) {
  const patterns = [...new Set(quotes)].map(quotePattern).filter((p): p is string => !!p);
  if (patterns.length === 0) return <>{text}</>;
  const regex = new RegExp(`(${patterns.join("|")})`, "gi");
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded-[3px] bg-highlight px-0.5 text-highlight-foreground">
            {part}
          </mark>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

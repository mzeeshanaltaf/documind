import { Highlighted, withoutHeading } from "@/components/case/highlight";
import type { Candidate } from "@/lib/api-types";
import { pageLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The passages a candidate was written from (or, for an unanswerable question, what DocuMind's
 * search returned for it), set like DocuMind's source cards. The generator's evidence quotes are
 * marked with the highlighter: "this exact text is the answer" (DESIGN.md › The Highlighter Rule).
 */
export function SourceExcerpts({ candidate, quotes }: { candidate: Candidate; quotes: string[] }) {
  const excerpts = candidate.source_excerpt ?? [];
  const retrieved = excerpts.some((e) => e.role === "retrieved");
  const expected = new Set(candidate.expected_sections);

  let heading = "Source passages";
  let note: string | null = null;
  if (candidate.type === "out_of_scope") {
    heading = "No source";
    note = "Out-of-scope questions are written from the list of what the documents cover, not from a passage.";
  } else if (retrieved) {
    heading = candidate.target_case_key ? "Retrieved passages" : "What DocuMind found";
    note = candidate.target_case_key
      ? "The case names no section, so these were retrieved within its expected documents."
      : "DocuMind's search results for this question. None should answer it.";
  }

  return (
    <section aria-labelledby={`sources-${candidate.id}`} className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 id={`sources-${candidate.id}`} className="font-sans text-sm font-semibold">
          {heading}
        </h2>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </div>
      {excerpts.map((excerpt) => {
        const section = excerpt.doc_code && excerpt.section_number ? `${excerpt.doc_code} §${excerpt.section_number}` : null;
        const isExpected = section ? expected.has(section) : false;
        return (
          <article
            key={`${excerpt.role}-${excerpt.chunk_id}`}
            className={cn("rounded-lg border bg-background", isExpected && "border-foreground/25")}
          >
            <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b px-4 py-2.5">
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="shrink-0 font-mono text-[0.7rem] text-muted-foreground">[{excerpt.n}]</span>
                <span className="shrink-0 font-mono text-xs whitespace-nowrap">{excerpt.doc_code ?? "Document"}</span>
                <span className="truncate font-heading text-sm">
                  {excerpt.title}
                  {excerpt.jurisdiction && <span className="text-muted-foreground"> ({excerpt.jurisdiction})</span>}
                </span>
              </span>
              <span className="font-mono text-[0.7rem] text-muted-foreground">
                {pageLabel(excerpt.page_start, excerpt.page_end)}
              </span>
            </header>
            <div className="flex flex-col gap-2 px-4 py-3">
              <p className="flex flex-wrap items-baseline gap-x-2">
                {excerpt.section_number && <span className="font-mono text-xs text-muted-foreground">§{excerpt.section_number}</span>}
                <span className="font-heading text-[0.95rem] font-semibold">{excerpt.section_title}</span>
                {isExpected && <span className="text-xs text-muted-foreground">expected section</span>}
              </p>
              <p className="font-heading text-sm leading-relaxed whitespace-pre-line">
                <Highlighted
                  text={withoutHeading(excerpt.text, excerpt.section_number, excerpt.section_title)}
                  quotes={quotes}
                />
              </p>
            </div>
          </article>
        );
      })}
      {excerpts.length === 0 && candidate.type !== "out_of_scope" && (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          {candidate.gen_status === "queued" ? "Waiting for generation." : "No passages were found for this case."}
        </p>
      )}
    </section>
  );
}

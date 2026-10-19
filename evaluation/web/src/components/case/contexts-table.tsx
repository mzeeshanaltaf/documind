"use client";

import { CheckIcon, ChevronRightIcon, MinusIcon, XIcon } from "lucide-react";
import { Fragment, useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ContextOut } from "@/lib/api-types";
import { pageLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Highlighted, withoutHeading } from "./highlight";

function Flag({ value, yes, no }: { value: boolean | null; yes: string; no: string }) {
  if (value === null) return <MinusIcon className="ml-auto size-3.5 text-muted-foreground" aria-label="Not checked" />;
  return value ? (
    <CheckIcon className="ml-auto size-3.5 text-success" aria-label={yes} />
  ) : (
    <XIcon className="ml-auto size-3.5 text-muted-foreground" aria-label={no} />
  );
}

/**
 * What DocuMind retrieved, in rank order: fusion ranks and scores, the dataset's relevance label,
 * the judge's relevance verdict and whether the answer cited it. A row expands to the passage.
 */
export function ContextsTable({ contexts, quotesByN }: { contexts: ContextOut[]; quotesByN: Record<number, string[]> }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const modes = [...new Set(contexts.map((c) => c.mode))];

  function toggle(key: string) {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (!contexts.length) return <p className="text-sm text-muted-foreground">No contexts were stored for this case.</p>;

  return (
    <div className="@container overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">#</TableHead>
            <TableHead>Source</TableHead>
            <TableHead className="hidden text-right @2xl:table-cell">BM25</TableHead>
            <TableHead className="hidden text-right @2xl:table-cell">Vector</TableHead>
            <TableHead className="hidden text-right @3xl:table-cell">RRF</TableHead>
            <TableHead className="text-right">Label</TableHead>
            <TableHead className="text-right">Judge</TableHead>
            <TableHead className="text-right">Cited</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {contexts.map((c) => {
            const key = `${c.mode}-${c.rank}`;
            const expanded = open.has(key);
            return (
              <Fragment key={key}>
                <TableRow className={cn(expanded && "border-b-0")}>
                  <TableCell className="font-mono text-xs tabular-nums">
                    {c.rank}
                    {c.n !== c.rank && <span className="block text-muted-foreground">[{c.n}]</span>}
                  </TableCell>
                  <TableCell className="max-w-0 min-w-56 @2xl:max-w-none">
                    <button
                      type="button"
                      onClick={() => toggle(key)}
                      aria-expanded={expanded}
                      className="flex w-full min-w-0 items-start gap-1.5 rounded-sm text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                    >
                      <ChevronRightIcon
                        className={cn("mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-90")}
                        aria-hidden
                      />
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="flex flex-wrap items-baseline gap-x-2">
                          <span className="font-mono text-xs font-medium">{c.doc_code ?? "n/a"}</span>
                          {c.section_number && <span className="font-mono text-xs text-muted-foreground">§{c.section_number}</span>}
                          <span className="font-mono text-[0.7rem] text-muted-foreground">{pageLabel(c.page_start, c.page_end)}</span>
                          {modes.length > 1 && <span className="font-mono text-[0.7rem] text-muted-foreground">{c.mode}</span>}
                        </span>
                        <span className="truncate text-sm">{c.section_title ?? c.section_path.at(-1) ?? "Untitled section"}</span>
                      </span>
                    </button>
                  </TableCell>
                  <TableCell className="hidden text-right font-mono text-xs tabular-nums @2xl:table-cell">{c.bm25_rank ?? "n/a"}</TableCell>
                  <TableCell className="hidden text-right font-mono text-xs tabular-nums @2xl:table-cell">{c.vector_rank ?? "n/a"}</TableCell>
                  <TableCell className="hidden text-right font-mono text-xs tabular-nums @3xl:table-cell">
                    {c.rrf === null ? "n/a" : c.rrf.toFixed(4)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Flag value={c.label_relevant} yes="Relevant by label" no="Not relevant by label" />
                  </TableCell>
                  <TableCell className="text-right">
                    <Flag value={c.judge_relevant} yes="Judged relevant" no="Judged not relevant" />
                  </TableCell>
                  <TableCell className="text-right">
                    <Flag value={c.cited} yes="Cited in the answer" no="Not cited" />
                  </TableCell>
                </TableRow>
                {expanded && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell />
                    <TableCell colSpan={7} className="pt-0 pb-4">
                      <p className="max-w-[72ch] font-heading text-[0.8125rem] leading-relaxed whitespace-pre-line text-muted-foreground">
                        {c.text ? (
                          <Highlighted text={withoutHeading(c.text, c.section_number, c.section_title)} quotes={quotesByN[c.n] ?? []} />
                        ) : (
                          "The text wasn't stored."
                        )}
                      </p>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

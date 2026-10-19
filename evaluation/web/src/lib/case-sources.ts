import type { CitedSource } from "@/components/case/answer";
import type { RunCaseDetail } from "./api-types";

/**
 * What the drill-down views need from one case's detail: the judge's evidence quotes per source
 * number (highlighted in chips and context rows) and the sources the answer can cite (full runs).
 */
export function caseSources(detail: RunCaseDetail, runMode: string) {
  const quotesByN: Record<number, string[]> = {};
  for (const claim of detail.claims) {
    if (!claim.evidence_quote) continue;
    for (const n of claim.supporting_ns) (quotesByN[n] ??= []).push(claim.evidence_quote);
  }
  const sources: Record<number, CitedSource> = {};
  for (const c of runMode === "full" ? detail.contexts : []) {
    const citation = detail.citations?.find((x) => x.n === c.n);
    sources[c.n] ??= { ...c, title: citation?.title ?? null, quotes: quotesByN[c.n] ?? [] };
  }
  return { quotesByN, sources };
}

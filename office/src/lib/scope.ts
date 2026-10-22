import { type DocumentOut, isSearchable } from "./api-types";

/**
 * Which documents an NPC answers from (README › Chat scoping). DocuMind's chat only takes
 * `document_ids` (max 50, and sending them bypasses its router), so the office picks them here,
 * on the client, from the org's document list. Pure.
 *
 * 1. Only searchable documents (`indexed_at` set; a reindex keeps the old chunks searchable).
 * 2. A department in a country office: the department's documents whose jurisdiction is that
 *    country or GLOBAL, or that are the base `policy_manual`.
 * 3. A department in Worldwide: all of that department's documents.
 * 4. Reception: rule 2 without the department filter; Worldwide reception sends `null`, so
 *    DocuMind's router picks departments and jurisdictions itself.
 * 5. The presenter (O7): the `overview` documents (none: reception's set, as a fallback).
 * 6. A rule that matches nothing falls back to the unfiltered department set.
 */
export const MAX_SCOPE = 50;

export type ScopeDocument = Pick<DocumentOut, "id" | "title" | "doc_code" | "department" | "jurisdiction" | "doc_type" | "indexed_at">;

export type ScopeOptions = {
  /** Omitted (or null) for reception. */
  department?: string | null;
  /** ISO country of the office; null for Worldwide. */
  country: string | null;
  overviewOnly?: boolean;
  /** For the label: "Lahore", "Global Hub", or the Worldwide chip's country ("Germany"). */
  placeName?: string;
};

export type Scope = {
  /** Null = unscoped (DocuMind routes). */
  documentIds: string[] | null;
  /** The documents the NPC can see (every searchable document when unscoped). */
  documents: ScopeDocument[];
  /** "HR · Lahore · 3 documents", "Lahore · 10 documents", "Global Hub · all 14 documents". */
  label: string;
  /** No document matched the rule, so the unfiltered department set is used. */
  fallback: boolean;
};

const GLOBAL = "GLOBAL";
const BASE = "policy_manual";

/** Local first, then the base manual, then global: what survives the 50-document cap. */
function rank(doc: ScopeDocument, country: string | null): number {
  if (country && doc.jurisdiction === country) return 0;
  if (doc.doc_type === BASE) return 1;
  if (doc.jurisdiction === GLOBAL) return 2;
  return 3;
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** "HR · Lahore · 3 documents" (the dialogue header). */
function labelOf(parts: (string | null | undefined)[], count: number, all = false) {
  return [...parts.filter(Boolean), `${all ? "all " : ""}${plural(count, "document")}`].join(" · ");
}

export function scopeFor(documents: ScopeDocument[], { department, country, overviewOnly, placeName }: ScopeOptions): Scope {
  const searchable = documents.filter(isSearchable);

  if (overviewOnly) {
    const picked = searchable.filter((d) => d.doc_type === "overview");
    if (picked.length > 0) return finish(picked, country, labelOf(["Overview"], picked.length), false);
    // No overview: what reception would see in this office (Worldwide: unscoped).
    return { ...scopeFor(documents, { country, placeName }), fallback: true };
  }

  if (!department && !country) {
    return { documentIds: null, documents: searchable, label: labelOf([placeName], searchable.length, true), fallback: false };
  }

  const pool = department ? searchable.filter((d) => d.department === department) : searchable;
  const local = country ? pool.filter((d) => d.jurisdiction === country || d.jurisdiction === GLOBAL || d.doc_type === BASE) : pool;
  const fallback = local.length === 0 && pool.length > 0;
  const picked = fallback ? pool : local;
  return finish(picked, country, labelOf([department, placeName], Math.min(picked.length, MAX_SCOPE)), fallback);
}

function finish(picked: ScopeDocument[], country: string | null, label: string, fallback: boolean): Scope {
  const sorted = picked
    .map((doc, index) => ({ doc, index }))
    .toSorted((a, b) => rank(a.doc, country) - rank(b.doc, country) || a.index - b.index)
    .slice(0, MAX_SCOPE)
    .map(({ doc }) => doc);
  return { documentIds: sorted.map((d) => d.id), documents: sorted, label, fallback };
}

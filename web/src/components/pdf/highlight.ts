/**
 * Matching a cited chunk against a page's text items. PDF text items rarely line up with
 * the chunk (line breaks, hyphenation, curly quotes), so both sides are normalized and an
 * item is marked when its normalized text is contained in the normalized passage.
 */

const QUOTES = /[‘’‚‛′`´]/g;
const DOUBLE_QUOTES = /[“”„‟″«»]/g;
const DASHES = /[‐-―−­]/g;
const MIN_ITEM_CHARS = 4;

export function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(DASHES, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Markdown/table syntax the chunker keeps in chunk text but the PDF never shows. */
export function normalizePassage(value: string): string {
  return normalizeText(value.replace(/[|*_#]+/g, " "));
}

export function shouldHighlight(item: string, passage: string): boolean {
  const text = normalizeText(item);
  return text.replace(/[^\p{L}\p{N}]/gu, "").length >= MIN_ITEM_CHARS && passage.includes(text);
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

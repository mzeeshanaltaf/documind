/** What an NPC's speech bubble shows of an answer (phase O5 › NPCs). Pure. */

const MAX = 140;
const MARKERS = /\s*\[\d+(?:\s*,\s*\d+)*\]/g;

/** Markdown down to plain text: no citation markers, emphasis, headings, quotes or list bullets. */
export function plainText(markdown: string): string {
  return markdown
    .replace(MARKERS, "")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_`~]+/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The answer's first sentence once it's complete (or the whole text when the answer ended
 * without one), capped for the bubble; null while the first sentence is still streaming.
 */
export function firstSentence(markdown: string, complete: boolean): string | null {
  const text = plainText(markdown);
  if (!text) return null;
  const end = /[.!?](?=\s|$)/.exec(text);
  const sentence = end ? text.slice(0, end.index + 1) : complete ? text : null;
  if (sentence === null || (!end && !complete)) return null;
  // A sentence that ends right where the stream is might still be "e.g." or "3.5": wait for more.
  if (!complete && end && end.index + 1 >= text.length) return null;
  return sentence.length > MAX ? `${sentence.slice(0, MAX - 1).trimEnd()}…` : sentence;
}

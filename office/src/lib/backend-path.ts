/** Path rules for the BFF proxy (app/api/backend/[...path]). Pure, so they're unit-tested. */

/** DocuMind's chat endpoint, the one path the shared rate limit applies to (POST only). */
export const CHAT_PATH = /^orgs\/[^/]+\/chat$/;

/**
 * Turns Next's decoded catch-all segments into a path under `/v1`, or null when unsafe.
 * Dot and empty segments are refused so a path can't escape `/v1`; each segment is re-encoded
 * so a decoded `/` or `?` can't change the upstream route.
 */
export function upstreamPath(segments: string[]): string | null {
  if (segments.length === 0 || segments.some((s) => s === "." || s === ".." || s === "")) return null;
  return segments.map(encodeURIComponent).join("/");
}

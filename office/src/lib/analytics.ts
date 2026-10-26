/**
 * Umami (self-hosted, cookieless) page views + a few game events, the same pattern as
 * web/src/lib/analytics.ts.
 *
 * Production builds only: the `NEXT_PUBLIC_*` values are inlined at build time, so `pnpm dev`
 * never loads the tracker and `track()` is a no-op there. Event data carries counts and
 * categories only, never PII or message content.
 */

const scriptUrl = process.env.NEXT_PUBLIC_UMAMI_SCRIPT_URL;
const websiteId = process.env.NEXT_PUBLIC_OFFICE_UMAMI_WEBSITE_ID;

export const UMAMI =
  process.env.NODE_ENV === "production" && scriptUrl && websiteId
    ? {
        scriptUrl,
        websiteId,
        // The tracker ignores every other hostname, so a local `next start` sends nothing.
        domains: "office.documind.zeeshanai.cloud",
      }
    : null;

type EventData = {
  office_entered: { location: string };
  /** `department` is "reception" for the front desk. */
  question_asked: { department: string; location: string };
  cards_issued: { count: number };
  citation_opened: undefined;
  game_finished: { game: string };
  quest_completed: { id: string };
  rooftop_unlocked: undefined;
};

export type AnalyticsEvent = keyof EventData;

type EventArgs<E extends AnalyticsEvent> = EventData[E] extends undefined ? [] : [data: EventData[E]];

declare global {
  interface Window {
    umami?: { track: (event: string, data?: Record<string, string | number | boolean>) => void };
  }
}

// The script loads afterInteractive, so an event fired on page load can beat it.
const RETRY_MS = 500;
const MAX_WAIT_MS = 10_000;

export function track<E extends AnalyticsEvent>(event: E, ...[data]: EventArgs<E>) {
  if (!UMAMI || typeof window === "undefined") return;
  const started = Date.now();
  const attempt = () => {
    if (window.umami) {
      try {
        window.umami.track(event, data);
      } catch {
        // Analytics must never break the game.
      }
    } else if (Date.now() - started < MAX_WAIT_MS) {
      // Blocked or offline tracker: give up quietly after MAX_WAIT_MS.
      setTimeout(attempt, RETRY_MS);
    }
  };
  attempt();
}

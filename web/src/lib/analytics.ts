/**
 * Umami (self-hosted, cookieless) page views + a few product events.
 *
 * Production builds only: the `NEXT_PUBLIC_*` values are inlined at build time, so
 * `pnpm dev` never loads the tracker and `track()` is a no-op there. `track()` is for
 * client code; event data carries counts and categories only, never PII or message text.
 */

const scriptUrl = process.env.NEXT_PUBLIC_UMAMI_SCRIPT_URL;
const websiteId = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;

export const UMAMI =
  process.env.NODE_ENV === "production" && scriptUrl && websiteId
    ? {
        scriptUrl,
        websiteId,
        // The tracker ignores every other hostname, so a local `next start` sends nothing.
        domains: "documind.zeeshanai.cloud",
      }
    : null;

type EventData = {
  sign_up_completed: { method: "email" | "google" };
  contact_submitted: undefined;
  chat_message_sent: { scoped: boolean };
  citation_opened: { doc_type?: string };
  document_uploaded: { count: number };
  feedback_given: { value: "up" | "down" };
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
        // Analytics must never break the app.
      }
    } else if (Date.now() - started < MAX_WAIT_MS) {
      // Blocked or offline tracker: give up quietly after MAX_WAIT_MS.
      setTimeout(attempt, RETRY_MS);
    }
  };
  attempt();
}

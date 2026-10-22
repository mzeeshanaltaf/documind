import { formatDayMonth } from "@/lib/quota";
import type { Refusal } from "./sse";

/** What an NPC says instead of answering (phase O5 › Refusals in-world). Static: no quota. */
export function refusalLine(refusal: Refusal): string {
  switch (refusal.code) {
    case "quota_exceeded":
      return quotaLine(refusal.resetsOn);
    case "rate_limited":
      return `One moment, give me ${refusal.retryAfter}s.`;
    case "unknown_documents":
      return "My files just changed. One second.";
    case "failed":
      return refusal.message;
  }
}

/** Also shown when the dialogue opens with the month's allowance already used. */
export function quotaLine(resetsOn: string | null): string {
  return resetsOn
    ? `You've used this month's questions. They renew on ${formatDayMonth(resetsOn)}.`
    : "You've used this month's questions. They renew next month.";
}

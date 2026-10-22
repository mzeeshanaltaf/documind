import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * DocuMind's chat limit, copied from web/src/lib/rate-limit.ts (synced 2026-10-22). The prefix,
 * key and window must stay identical to DocuMind's: both BFFs then count against one shared
 * 30-per-minute window per user, whichever app the question comes from.
 */

let chatLimiter: Ratelimit | null | undefined;

/** 30 chat messages per minute per user (sliding window). Null when Upstash isn't configured. */
function getChatLimiter(): Ratelimit | null {
  if (chatLimiter !== undefined) return chatLimiter;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  chatLimiter =
    url && token
      ? new Ratelimit({
          redis: new Redis({ url, token }),
          limiter: Ratelimit.slidingWindow(30, "1 m"),
          prefix: "documind:ratelimit",
          analytics: false,
        })
      : null;
  return chatLimiter;
}

export type LimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

export async function limitChat(userId: string): Promise<LimitResult> {
  const limiter = getChatLimiter();
  if (!limiter) return { ok: true };
  try {
    const { success, reset } = await limiter.limit(`chat:${userId}`);
    if (success) return { ok: true };
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((reset - Date.now()) / 1000)) };
  } catch (error) {
    // Redis down: fail open rather than block every question.
    console.error("Rate limit check failed (chat)", error);
    return { ok: true };
  }
}

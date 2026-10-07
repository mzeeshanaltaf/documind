import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

let redis: Redis | null | undefined;
let chatLimiter: Ratelimit | null | undefined;
let contactLimiter: Ratelimit | null | undefined;

/** Null when Upstash isn't configured: every limit then fails open. */
function getRedis(): Redis | null {
  if (redis !== undefined) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  redis = url && token ? new Redis({ url, token }) : null;
  return redis;
}

/** 30 chat messages per minute per user (sliding window). */
function getChatLimiter(): Ratelimit | null {
  if (chatLimiter !== undefined) return chatLimiter;
  const client = getRedis();
  chatLimiter = client
    ? new Ratelimit({
        redis: client,
        limiter: Ratelimit.slidingWindow(30, "1 m"),
        prefix: "documind:ratelimit",
        analytics: false,
      })
    : null;
  return chatLimiter;
}

/** Contact form: 5 submissions per 10 minutes per IP (sliding window). */
export const CONTACT_LIMIT = 5;

function getContactLimiter(): Ratelimit | null {
  if (contactLimiter !== undefined) return contactLimiter;
  const client = getRedis();
  contactLimiter = client
    ? new Ratelimit({
        redis: client,
        limiter: Ratelimit.slidingWindow(CONTACT_LIMIT, "10 m"),
        prefix: "documind:ratelimit",
        analytics: false,
      })
    : null;
  return contactLimiter;
}

export type LimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

async function check(limiter: Ratelimit | null, key: string): Promise<LimitResult> {
  if (!limiter) return { ok: true };
  try {
    const { success, reset } = await limiter.limit(key);
    if (success) return { ok: true };
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((reset - Date.now()) / 1000)) };
  } catch (error) {
    // Redis down: fail open rather than block every request.
    console.error(`Rate limit check failed (${key.split(":")[0]})`, error);
    return { ok: true };
  }
}

export function limitChat(userId: string): Promise<LimitResult> {
  return check(getChatLimiter(), `chat:${userId}`);
}

export function limitContact(ip: string): Promise<LimitResult> {
  return check(getContactLimiter(), `contact:${ip}`);
}

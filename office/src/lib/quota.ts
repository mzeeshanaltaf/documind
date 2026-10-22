import useSWR from "swr";
import { type ApiErrorBody, type Quota, QUOTA_URL } from "./api-types";

/**
 * The user's monthly DocuMind allowance (`GET /v1/me/quota` through the BFF). Account-wide and
 * per UTC month; platform admins are `unlimited`. One SWR key serves the HUD meter and every NPC,
 * and the chat hook revalidates it after each turn.
 */
export async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(body.error?.message ?? `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export function useQuota() {
  return useSWR<Quota>(QUOTA_URL, fetchJson, { revalidateOnFocus: true, dedupingInterval: 2000 });
}

export type QuotaLevel = "ok" | "low" | "exhausted";

/** Amber at ≤ 3 messages left or ≥ 90% of the tokens used; red once either runs out. */
export function quotaLevel(quota: Pick<Quota, "message_limit" | "token_limit" | "messages_used" | "tokens_used" | "exhausted" | "unlimited">): QuotaLevel {
  if (quota.unlimited) return "ok";
  if (quota.exhausted || quota.messages_used >= quota.message_limit || quota.tokens_used >= quota.token_limit) return "exhausted";
  if (quota.message_limit - quota.messages_used <= 3 || quota.tokens_used >= quota.token_limit * 0.9) return "low";
  return "ok";
}

const whole = new Intl.NumberFormat("en-US");
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** DocuMind's formatters (web/src/lib/format.ts): 1,284 / 12.9K; "1 Nov". */
export function formatCount(value: number): string {
  return whole.format(value);
}

export function formatCompact(value: number): string {
  return Math.abs(value) < 10_000 ? whole.format(value) : compact.format(value);
}

export function formatDayMonth(value: string): string {
  return dayMonth.format(new Date(value.length === 10 ? `${value}T00:00:00Z` : value));
}

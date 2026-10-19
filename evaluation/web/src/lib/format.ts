/** Display formatting shared by Server Components and client islands (cost/count/date helpers
 * follow web/src/lib/format.ts). */

/** Cost: 4 decimals below $1, 2 above. */
export function formatCost(usd: number | null | undefined): string {
  const value = usd ?? 0;
  const digits = Math.abs(value) < 1 ? 4 : 2;
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** A unit cost (per call, per case): 3 significant digits, so sub-cent values stay comparable. */
export function formatUnitCost(usd: number | null | undefined): string {
  const value = usd ?? 0;
  if (value === 0 || Math.abs(value) >= 1) return formatCost(value);
  return `$${value.toLocaleString("en-US", { maximumSignificantDigits: 3, maximumFractionDigits: 8 })}`;
}

const whole = new Intl.NumberFormat("en-US");
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export function formatCount(value: number | null | undefined): string {
  return whole.format(value ?? 0);
}

/** 1,284 / 12.9K / 4.2M. */
export function formatCompact(value: number | null | undefined): string {
  const v = value ?? 0;
  return Math.abs(v) < 10_000 ? whole.format(v) : compact.format(v);
}

/** 840 ms / 1.2 s / 14 s. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "n/a";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${Math.round(seconds % 60)} s`;
}

const shortDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const dateTime = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

export function formatDate(value: string | null | undefined): string {
  if (!value) return "n/a";
  return shortDate.format(new Date(value));
}

/** "19 Oct, 08:56 UTC": runs are minutes apart, so the time matters. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "n/a";
  return `${dateTime.format(new Date(value))} UTC`;
}

/** Wall time between two ISO stamps (or until now). */
export function elapsedMs(from: string | null | undefined, to?: string | null): number | null {
  if (!from) return null;
  return (to ? new Date(to).getTime() : Date.now()) - new Date(from).getTime();
}

/** "p. 7" or "pp. 7–8". */
export function pageLabel(start: number | null | undefined, end?: number | null): string {
  if (!start) return "";
  return end && end !== start ? `pp. ${start}–${end}` : `p. ${start}`;
}

/** First 8 hex chars of an id or hash, for compact mono display. */
export function shortId(value: string | null | undefined): string {
  return value ? value.replace(/-/g, "").slice(0, 8) : "n/a";
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

/** snake_case → "Snake case" for enum values shown as labels. */
export function humanize(value: string | null | undefined): string {
  if (!value) return "n/a";
  const text = value.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

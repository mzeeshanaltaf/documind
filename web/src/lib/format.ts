/** Display formatting shared by Server Components and client islands. */

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

/** "DE" → "Germany", "GLOBAL" → "Global". Unknown codes come back unchanged. */
export function jurisdictionName(code: string | null | undefined): string {
  if (!code) return "Unspecified";
  if (code === "GLOBAL") return "Global";
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

/** Codes offered by the metadata editor, in addition to whatever is already stored. */
export const COMMON_JURISDICTIONS = [
  "GLOBAL",
  "US",
  "GB",
  "DE",
  "FR",
  "AU",
  "PK",
  "CA",
  "IE",
  "NL",
  "ES",
  "IT",
  "IN",
  "SG",
  "AE",
  "JP",
] as const;

/** Cost: 4 decimals below $1, 2 above (the analytics spec). */
export function formatCost(usd: number | null | undefined): string {
  const value = usd ?? 0;
  const digits = Math.abs(value) < 1 ? 4 : 2;
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** A unit cost (per call, per answer): 3 significant digits, so sub-cent tiers stay comparable. */
export function formatUnitCost(usd: number | null | undefined): string {
  const value = usd ?? 0;
  if (value === 0 || Math.abs(value) >= 1) return formatCost(value);
  return `$${value.toLocaleString("en-US", { maximumSignificantDigits: 3, maximumFractionDigits: 8 })}`;
}

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat("en-US");

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
  return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} s`;
}

export function formatPercent(value: number | null | undefined, digits = 0): string {
  return `${(value ?? 0).toFixed(digits)}%`;
}

const shortDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** API dates are ISO strings; `effective_date` is a bare YYYY-MM-DD (read as UTC). */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "n/a";
  return shortDate.format(new Date(value.length === 10 ? `${value}T00:00:00Z` : value));
}

export function formatDayMonth(value: string): string {
  return dayMonth.format(new Date(value.length === 10 ? `${value}T00:00:00Z` : value));
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "n/a";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "§5.2 Annual Leave", or just the title when there's no number. */
export function sectionLabel(number: string | null | undefined, title: string | null | undefined): string {
  return [number ? `§${number}` : null, title].filter(Boolean).join(" ");
}

/** "p. 7" or "pp. 7–8". */
export function pageLabel(start: number | null | undefined, end?: number | null): string {
  if (!start) return "";
  return end && end !== start ? `pp. ${start}–${end}` : `p. ${start}`;
}

export const DOC_TYPE_LABELS: Record<string, string> = {
  policy_manual: "Policy manual",
  country_supplement: "Country supplement",
  global_supplement: "Global supplement",
  overview: "Overview",
  procedure: "Procedure",
  other: "Other",
};

export const STAGE_LABELS: Record<string, string> = {
  downloading: "Fetching file",
  parsing: "Reading pages",
  metadata: "Classifying",
  chunking: "Splitting sections",
  embedding: "Embedding",
  indexing: "Indexing",
  done: "Finishing",
};

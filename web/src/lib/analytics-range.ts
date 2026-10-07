/** Analytics range from search params: 7d | 30d | 90d presets or a custom from/to (UTC dates). */

export const PRESETS = { "7d": 7, "30d": 30, "90d": 90 } as const;
export type RangeKey = keyof typeof PRESETS | "custom";

export type AnalyticsRange = {
  key: RangeKey;
  from: string; // YYYY-MM-DD, inclusive
  to: string; // YYYY-MM-DD, inclusive
  days: number;
  granularity: "day" | "week";
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const MAX_DAYS = 366;

function iso(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parse(value: string | undefined): Date | null {
  if (!value || !DATE.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function resolveRange(params: Record<string, string | string[] | undefined>, today: Date): AnalyticsRange {
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const key = first(params.range);

  if (key === "custom") {
    const from = parse(first(params.from));
    const to = parse(first(params.to));
    if (from && to && from <= to) {
      const end = to > todayUtc ? todayUtc : to;
      const start = from > end ? end : from;
      const days = Math.min(Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1, MAX_DAYS);
      const clampedStart = new Date(end.getTime() - (days - 1) * DAY_MS);
      return { key: "custom", from: iso(clampedStart), to: iso(end), days, granularity: days > 92 ? "week" : "day" };
    }
  }

  const preset: keyof typeof PRESETS = key && key in PRESETS ? (key as keyof typeof PRESETS) : "30d";
  const days = PRESETS[preset];
  return {
    key: preset,
    from: iso(new Date(todayUtc.getTime() - (days - 1) * DAY_MS)),
    to: iso(todayUtc),
    days,
    granularity: "day",
  };
}

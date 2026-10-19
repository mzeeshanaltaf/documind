import type { CaseClass, CompareMetric, MetricInfo } from "./api-types";
import { formatCompact, formatDuration, formatUnitCost } from "./format";
import { GROUP_ORDER } from "./metrics";

const MINUS = "−";

function signed(text: string, value: number): string {
  if (value > 0) return `+${text}`;
  if (value < 0) return `${MINUS}${text}`;
  return text;
}

/**
 * A difference B − A in its metric's unit: binary shares as percentage points ("+13.3 pts"),
 * unit scores with two decimals, latency as a duration, cost as a unit cost.
 */
export function formatDelta(value: number | null | undefined, info: Pick<MetricInfo, "scale"> | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  const magnitude = Math.abs(value);
  switch (info?.scale) {
    case "binary": {
      const pts = magnitude * 100;
      return signed(`${pts.toFixed(pts === 0 || pts >= 10 ? 0 : 1)} pts`, value);
    }
    case "ms":
      return signed(formatDuration(magnitude), value);
    case "count":
      // Mean deltas of token counts are often fractional and small: keep one decimal there.
      return signed(magnitude < 10 ? magnitude.toFixed(magnitude === Math.round(magnitude) ? 0 : 1) : formatCompact(Math.round(magnitude)), value);
    case "usd":
      return signed(formatUnitCost(magnitude), value);
    default:
      return signed(magnitude.toFixed(magnitude !== 0 && magnitude < 0.005 ? 3 : 2), value);
  }
}

export function formatP(p: number | null | undefined): string {
  if (p === null || p === undefined) return "n/a";
  if (p < 0.001) return "<0.001";
  if (p >= 0.995) return "1";
  return p < 0.01 ? p.toFixed(3) : p.toFixed(2);
}

/** What a metric row says, in one word: drives its colour and badge. */
export type Verdict = "regression" | "improvement" | "worse" | "better" | "same" | "untested";

export function verdictOf(m: CompareMetric): Verdict {
  if (m.delta === null) return "untested";
  if (m.direction_good === null) return "same";
  if (m.significant) return m.direction_good ? "improvement" : "regression";
  return m.direction_good ? "better" : "worse";
}

const VERDICT_RANK: Record<Verdict, number> = { regression: 0, improvement: 1, worse: 2, better: 2, same: 3, untested: 4 };

/** Significant regressions first, then significant improvements, then the rest by group. */
export function sortMetricRows(rows: CompareMetric[]): CompareMetric[] {
  const group = (g: string) => {
    const i = GROUP_ORDER.indexOf(g);
    return i === -1 ? 99 : i;
  };
  return rows
    .map((row, i) => ({ row, i }))
    .sort(
      (x, y) =>
        VERDICT_RANK[verdictOf(x.row)] - VERDICT_RANK[verdictOf(y.row)] || group(x.row.group) - group(y.row.group) || x.i - y.i,
    )
    .map(({ row }) => row);
}

/** One case, one metric: the API's per-case band (app/stats/paired.py `classify_change`). */
export function classifyChange(
  a: number | null | undefined,
  b: number | null | undefined,
  info: Pick<MetricInfo, "scale" | "direction"> | undefined,
): "improved" | "regressed" | "unchanged" | null {
  if (a === null || a === undefined || b === null || b === undefined || !info) return null;
  const delta = b - a;
  const moved =
    info.scale === "binary"
      ? a >= 0.5 !== b >= 0.5
      : info.scale === "unit"
        ? Math.abs(delta) > 0.1
        : Math.abs(delta) > 0.1 * Math.max(Math.abs(a), Math.abs(b));
  if (!moved) return "unchanged";
  return (info.direction === "higher" ? delta > 0 : delta < 0) ? "improved" : "regressed";
}

export const CLASS_ORDER: CaseClass[] = ["regressed", "mixed", "improved", "unchanged", "unpaired"];

export const CLASS_LABELS: Record<CaseClass, string> = {
  regressed: "Regressed",
  mixed: "Mixed",
  improved: "Improved",
  unchanged: "Unchanged",
  unpaired: "Unpaired",
};

/** A flattened config value for the diff table. */
export function formatConfigValue(value: unknown): string {
  if (value === null || value === undefined) return "not set";
  if (typeof value === "string") return value.length === 64 && /^[0-9a-f]+$/.test(value) ? value.slice(0, 12) : value;
  if (Array.isArray(value)) return value.length ? value.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join(", ") : "none";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/** `config.effective.top_k` → "effective › top_k" under its section "Config". */
export function configKeyParts(key: string): [string, string] {
  const [head, ...rest] = key.split(".");
  const sections: Record<string, string> = {
    mode: "Run",
    config: "Config",
    documind: "DocuMind",
    org_settings: "Org settings",
    documents: "Documents",
    judge_prompts: "Judge prompts",
    dataset: "Dataset",
    eval: "Eval harness",
  };
  const name = head === "judge_prompts" ? rest.join(".") : rest.join(" › ");
  return [sections[head] ?? head, name || head];
}

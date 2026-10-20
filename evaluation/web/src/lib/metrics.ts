import type { MetricInfo } from "./api-types";
import { formatCompact, formatDuration, formatUnitCost } from "./format";

/** Run-level rows in `run_aggregates` that aren't in the metric registry (binary, from case status). */
export const RUN_LEVEL: MetricInfo[] = [
  {
    key: "case_pass",
    group: "run",
    scale: "binary",
    direction: "higher",
    default_threshold: null,
    gating: false,
    requires_judge: false,
    run_modes: ["full", "retrieval_only"],
    description: "Share of finished cases that passed every gate that applies.",
  },
  {
    key: "error_rate",
    group: "run",
    scale: "binary",
    direction: "lower",
    default_threshold: null,
    gating: false,
    requires_judge: false,
    run_modes: ["full", "retrieval_only"],
    description: "Share of cases that ended in an error.",
  },
];

export const GROUP_ORDER = ["run", "retrieval", "routing", "generation", "behavior", "citations", "safety", "operational"];

export const GROUP_LABELS: Record<string, string> = {
  run: "Run",
  retrieval: "Retrieval",
  routing: "Routing",
  generation: "Generation",
  behavior: "Behaviour",
  citations: "Citations",
  safety: "Safety",
  operational: "Operational",
};

/** The headline metrics for cards and sparklines, in display order. */
export const KEY_METRICS = [
  "case_pass",
  "faithfulness",
  "answer_quality",
  "behavior_correct",
  "hit@k",
  "mrr",
  "citation_validity",
  "leakage",
];
export const KEY_METRICS_RETRIEVAL = ["case_pass", "hit@5", "hit@k", "mrr", "recall_section@k", "ndcg@k", "routing_hit"];

const LABELS: Record<string, string> = {
  case_pass: "Cases passed",
  error_rate: "Error rate",
  "hit@5": "Hit@5",
  "hit@k": "Hit@k",
  mrr: "MRR",
  "recall_doc@k": "Doc recall@k",
  "recall_section@k": "Section recall@k",
  "precision@k": "Precision@k",
  "ndcg@k": "nDCG@k",
  routing_hit: "Routing hit",
  routing_jaccard: "Routing Jaccard",
  jurisdiction_acc: "Jurisdiction accuracy",
  jurisdiction_false_pos: "Jurisdiction false positive",
  citation_validity: "Citation validity",
  cited_section_hit: "Cited section hit",
  cited_doc_precision: "Cited doc precision",
  page_hit: "Page hit",
  latency_ms: "Latency",
  ttft_ms: "Time to first token",
  input_tokens: "Input tokens",
  output_tokens: "Output tokens",
  documind_cost_usd: "DocuMind cost",
  leakage: "Leakage",
  injection_resisted: "Injection resisted",
  refusal_rate_oos: "Out-of-scope refusal",
  jurisdiction_confusion: "Jurisdiction confusion",
  authz_probe: "Authz probe",
  behavior_correct: "Behaviour correct",
  false_refusal: "False refusal",
  over_clarification: "Over-clarification",
  faithfulness: "Faithfulness",
  hallucination: "Hallucination",
  citation_precision: "Citation precision",
  citation_recall: "Citation recall",
  supported_citation_recall: "Supported citation recall",
  key_fact_recall: "Key-fact recall",
  context_recall: "Context recall",
  context_precision: "Context precision",
  answer_quality: "Answer quality",
  "answer_quality.correctness": "Correctness",
  "answer_quality.completeness": "Completeness",
  "answer_quality.relevance": "Relevance",
  "answer_quality.jurisdiction_handling": "Jurisdiction handling",
  "answer_quality.refusal_helpfulness": "Refusal helpfulness",
  followup_resolution: "Follow-up resolution",
};

export function metricLabel(key: string): string {
  return LABELS[key] ?? key;
}

/** Short label for dense headers (table columns, heatmap). */
export function metricShortLabel(key: string): string {
  if (key.startsWith("answer_quality.")) return metricLabel(key);
  return metricLabel(key);
}

export type MetricIndex = Record<string, MetricInfo>;

export function indexMetrics(registry: MetricInfo[]): MetricIndex {
  return Object.fromEntries([...RUN_LEVEL, ...registry].map((m) => [m.key, m]));
}

/**
 * One value in its own unit. Binary means read as a share ("86.7%"); a single case's binary
 * value as yes/no; unit scores keep two decimals (they're 0–1, not percentages).
 */
export function formatMetric(
  value: number | null | undefined,
  info: Pick<MetricInfo, "scale"> | undefined,
  { single = false }: { single?: boolean } = {},
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  switch (info?.scale) {
    case "binary":
      if (single) return value >= 0.5 ? "yes" : "no";
      return `${(value * 100).toFixed(value === 0 || value === 1 ? 0 : 1)}%`;
    case "ms":
      return formatDuration(value);
    case "count":
      return formatCompact(Math.round(value));
    case "usd":
      return formatUnitCost(value);
    default:
      return value.toFixed(2);
  }
}

/** Is a value good relative to its threshold? Null when the metric has no threshold. */
export function meetsThreshold(value: number | null | undefined, info: MetricInfo | undefined, threshold?: number | null) {
  const limit = threshold ?? info?.default_threshold;
  if (value === null || value === undefined || limit === null || limit === undefined || !info) return null;
  return info.direction === "lower" ? value <= limit : value >= limit;
}

/** Sort metric keys by group, then registry order. */
export function orderMetrics(keys: string[], index: MetricIndex): string[] {
  const position = new Map(Object.keys(index).map((key, i) => [key, i]));
  return [...keys].sort((a, b) => {
    const ga = GROUP_ORDER.indexOf(index[a]?.group ?? "zz");
    const gb = GROUP_ORDER.indexOf(index[b]?.group ?? "zz");
    if (ga !== gb) return (ga === -1 ? 99 : ga) - (gb === -1 ? 99 : gb);
    return (position.get(a) ?? 999) - (position.get(b) ?? 999);
  });
}

/** Ordered keys split into their groups, for tables with a header row per group. */
export function groupMetrics(keys: string[], index: MetricIndex): { group: string; keys: string[] }[] {
  const groups: { group: string; keys: string[] }[] = [];
  for (const key of orderMetrics(keys, index)) {
    const group = index[key]?.group ?? "other";
    const last = groups.at(-1);
    if (last?.group === group) last.keys.push(key);
    else groups.push({ group, keys: [key] });
  }
  return groups;
}

/** "type:single_hop" → ["Type", "single_hop"]. */
export function sliceParts(slice: string): [string, string] {
  if (slice === "all") return ["All", "all cases"];
  const [kind, ...rest] = slice.split(":");
  const names: Record<string, string> = {
    type: "Type",
    dept: "Department",
    juris: "Jurisdiction",
    tag: "Tag",
    difficulty: "Difficulty",
    source: "Source",
  };
  return [names[kind] ?? kind, rest.join(":")];
}

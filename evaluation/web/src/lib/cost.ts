/**
 * Run cost estimate, per case, from docs/plan/eval/README.md › Cost guide (measured on the golden
 * set; metered actuals replace it once the run starts).
 */
const PER_CASE = {
  documind: 0.0012,
  retrievalOnly: 0.0005,
  judgeChecks: 0.003,
  rubric: { haiku: 0.001, sonnet: 0.018 },
};

const CHECK_METRICS = new Set([
  "faithfulness",
  "hallucination",
  "citation_precision",
  "citation_recall",
  "supported_citation_recall",
  "key_fact_recall",
  "context_recall",
  "context_precision",
  "behavior_correct",
  "false_refusal",
]);
const RUBRIC_METRICS = new Set(["answer_quality", "followup_resolution"]);

export type CostEstimate = { documind: number; judge: number; total: number };

export function estimateRunCost({
  cases,
  mode,
  retrievalModes,
  judgeEnabled,
  enabled,
  rubricModel,
  samples,
}: {
  cases: number;
  mode: "full" | "retrieval_only";
  retrievalModes: number;
  judgeEnabled: boolean;
  /** null = every metric */
  enabled: string[] | null;
  rubricModel: string | null;
  samples: 1 | 3;
}): CostEstimate {
  if (mode === "retrieval_only") {
    const documind = cases * PER_CASE.retrievalOnly * Math.max(1, retrievalModes / 3);
    return { documind, judge: 0, total: documind };
  }
  const documind = cases * PER_CASE.documind;
  let judge = 0;
  if (judgeEnabled) {
    const on = (set: Set<string>) => enabled === null || enabled.some((k) => set.has(k) || [...set].some((s) => k.startsWith(`${s}.`)));
    if (on(CHECK_METRICS)) judge += cases * PER_CASE.judgeChecks;
    if (on(RUBRIC_METRICS)) {
      const sonnet = (rubricModel ?? "").includes("sonnet") || (rubricModel ?? "").includes("opus");
      judge += cases * (sonnet ? PER_CASE.rubric.sonnet : PER_CASE.rubric.haiku) * samples;
    }
  }
  return { documind, judge, total: documind + judge };
}

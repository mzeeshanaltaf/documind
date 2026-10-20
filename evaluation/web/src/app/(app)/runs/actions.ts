"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { EFFORTS, RETRIEVAL_MODES, type RunDetail, type RunOut } from "@/lib/api-types";
import { requireAdmin } from "@/lib/auth-guards";
import { type ActionResult, action, apiJson } from "@/lib/eval-api";

const id = z.uuid();
const model = z.string().trim().min(1).max(100).nullish();
const effort = z.enum(EFFORTS).nullish();

const judgeSchema = z.object({
  enabled: z.boolean(),
  models: z.object({ rubric: model, claims: model }),
  samples: z.union([z.literal(1), z.literal(3)]),
  efforts: z.object({ rubric: effort, claims: effort }),
});

const metricsSchema = z.object({
  enabled: z.array(z.string()).nullable(),
  thresholds: z.record(z.string(), z.number()),
  gates: z.array(z.string()).nullable(),
});

// Mirrors the eval API's RunIn; the API validates again (unknown metrics, mode-only fields).
const runSchema = z.object({
  dataset_version_id: id,
  org_slug: z.string().trim().min(1).max(100).nullish(),
  mode: z.enum(["full", "retrieval_only"]),
  overrides: z.object({
    top_k: z.number().int().min(1).max(30).nullish(),
    retrieval_mode: z.enum(RETRIEVAL_MODES).nullish(),
    chat_model: model,
    router_model: model,
    chat_service_tier: z.enum(["standard", "flex", "auto"]).nullish(),
  }),
  retrieval_modes: z.array(z.enum(RETRIEVAL_MODES)).min(1).nullish(),
  metrics: metricsSchema,
  judge: judgeSchema,
  name: z.string().trim().max(200).nullish(),
  tags: z.array(z.string().trim().min(1).max(60)).max(20),
  max_judge_cost_usd: z.number().min(0).nullish(),
  cleanup_conversations: z.boolean(),
});
export type RunInput = z.input<typeof runSchema>;

/** Drops null/undefined keys so the API applies its own defaults. */
function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null && v !== undefined)) as Partial<T>;
}

export async function createRun(input: RunInput): Promise<ActionResult<RunDetail>> {
  const { user } = await requireAdmin();
  const parsed = runSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `${issue.path.join(".")}: ${issue.message}` };
  }
  const run = parsed.data;
  const body = compact({
    ...run,
    name: run.name || null,
    overrides: compact(run.overrides),
    judge: { ...run.judge, models: compact(run.judge.models), efforts: compact(run.judge.efforts) },
  });
  return action(() => apiJson<RunDetail>("runs", { userId: user.id, method: "POST", body }));
}

async function control(runId: string, verb: "pause" | "resume" | "stop", body?: unknown) {
  const { user } = await requireAdmin();
  if (!id.safeParse(runId).success) return { ok: false as const, error: "Unknown run." };
  const result = await action(() => apiJson<RunOut>(`runs/${runId}/${verb}`, { userId: user.id, method: "POST", body }));
  if (result.ok) refresh();
  return result;
}

export async function pauseRun(runId: string): Promise<ActionResult<RunOut>> {
  return control(runId, "pause");
}

/** After a `budget` pause the API wants a higher `max_judge_cost_usd`. */
export async function resumeRun(runId: string, maxJudgeCostUsd?: number | null): Promise<ActionResult<RunOut>> {
  const budget = z.number().min(0).nullish().safeParse(maxJudgeCostUsd);
  if (!budget.success) return { ok: false, error: "Enter a budget in dollars." };
  return control(runId, "resume", budget.data != null ? { max_judge_cost_usd: budget.data } : undefined);
}

export async function stopRun(runId: string): Promise<ActionResult<RunOut>> {
  return control(runId, "stop");
}

const rejudgeSchema = z.object({
  judge: judgeSchema,
  name: z.string().trim().max(200).nullish(),
  tags: z.array(z.string().trim().min(1).max(60)).max(20),
  max_judge_cost_usd: z.number().min(0).nullish(),
  tamper: z.enum(["judge_robustness"]).nullish(),
});

/** A new run that re-scores this run's answers with the current prompt files (no DocuMind calls).
 * `tamper: judge_robustness` appends evaluator-directed text to every answer first. */
export async function rejudgeRun(runId: string, input: z.input<typeof rejudgeSchema>): Promise<ActionResult<RunDetail>> {
  const { user } = await requireAdmin();
  if (!id.safeParse(runId).success) return { ok: false, error: "Unknown run." };
  const parsed = rejudgeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const body = compact({
    ...parsed.data,
    name: parsed.data.name || null,
    judge: {
      ...parsed.data.judge,
      models: compact(parsed.data.judge.models),
      efforts: compact(parsed.data.judge.efforts),
    },
  });
  return action(() => apiJson<RunDetail>(`runs/${runId}/rejudge`, { userId: user.id, method: "POST", body }));
}

export async function deleteRun(runId: string): Promise<ActionResult<undefined>> {
  const { user } = await requireAdmin();
  if (!id.safeParse(runId).success) return { ok: false, error: "Unknown run." };
  return action(() => apiJson<undefined>(`runs/${runId}`, { userId: user.id, method: "DELETE" }));
}

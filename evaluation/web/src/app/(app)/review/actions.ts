"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import {
  type CalibrationList,
  REVIEW_SAMPLINGS,
  REVIEWABLE_METRICS,
  type ReviewGrade,
  type ReviewNext,
  type ReviewProgress,
  type ReviewItem,
  type ReviewQueue,
} from "@/lib/api-types";
import { requireAdmin } from "@/lib/auth-guards";
import { type ActionResult, action, apiJson } from "@/lib/eval-api";

const id = z.uuid();

// Mirrors the eval API's QueueIn; the API validates again (run mode, eligible cases).
const queueSchema = z.object({
  run_id: id,
  name: z.string().trim().max(200).nullish(),
  metrics: z.array(z.enum(REVIEWABLE_METRICS)).min(1, "Pick at least one metric.").max(10),
  sampling: z.enum(REVIEW_SAMPLINGS),
  size: z.number().int().min(1).max(200),
  blind: z.boolean(),
  seed: z.number().int().min(0).max(2 ** 31 - 1).nullish(),
});

export async function createQueue(input: z.input<typeof queueSchema>): Promise<ActionResult<ReviewQueue>> {
  const { user } = await requireAdmin();
  const parsed = queueSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const body = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== null && v !== undefined && v !== ""));
  return action(() => apiJson<ReviewQueue>("review-queues", { userId: user.id, method: "POST", body }));
}

const gradeSchema = z.object({
  metric: z.enum(REVIEWABLE_METRICS),
  label: z.string().max(40).nullish(),
  comment: z.string().max(4000).nullish(),
  claim_verdicts: z.record(z.string(), z.enum(["supported", "not_found", "contradicted"])).nullish(),
});

export async function submitReview(
  queueId: string,
  itemId: string,
  grades: ReviewGrade[],
): Promise<ActionResult<{ item: ReviewItem; progress: ReviewProgress }>> {
  const { user } = await requireAdmin();
  if (!id.safeParse(queueId).success || !id.safeParse(itemId).success) return { ok: false, error: "Unknown item." };
  const parsed = z.array(gradeSchema).min(1).max(10).safeParse(grades);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the grades." };
  return action(() =>
    apiJson<{ item: ReviewItem; progress: ReviewProgress }>("reviews", {
      userId: user.id,
      method: "POST",
      body: { queue_id: queueId, item_id: itemId, grades: parsed.data },
    }),
  );
}

export async function skipItem(queueId: string, itemId: string): Promise<ActionResult<ReviewNext>> {
  const { user } = await requireAdmin();
  if (!id.safeParse(queueId).success || !id.safeParse(itemId).success) return { ok: false, error: "Unknown item." };
  return action(() =>
    apiJson<ReviewNext>(`review-queues/${queueId}/items/${itemId}/skip`, { userId: user.id, method: "POST" }),
  );
}

export async function deleteQueue(queueId: string): Promise<ActionResult> {
  const { user } = await requireAdmin();
  if (!id.safeParse(queueId).success) return { ok: false, error: "Unknown queue." };
  const result = await action(() => apiJson<undefined>(`review-queues/${queueId}`, { userId: user.id, method: "DELETE" }));
  if (result.ok) refresh();
  return result;
}

export async function recomputeCalibration(): Promise<ActionResult<CalibrationList>> {
  const { user } = await requireAdmin();
  const result = await action(() => apiJson<CalibrationList>("calibration/recompute", { userId: user.id, method: "POST" }));
  if (result.ok) refresh();
  return result;
}

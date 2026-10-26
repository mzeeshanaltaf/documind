import "server-only";
import { ENGINE_SETS, type Progress } from "@/game/quests/definitions";
import { mergeProgress, normalizeProgress, type ProgressPatch } from "@/game/quests/schema";
import { query, transaction } from "./office-db";

/**
 * Quest and achievement progress on `{office}.progress` (phase O9 › Persistence): one row per
 * user and org. These helpers never check access; the Server Action and the beacon route do,
 * then call them.
 */
type Row = { quests: unknown; achievements: unknown; stats: unknown };

/** The stored progress, or an empty one for a player who has none yet. */
export async function readProgress(userId: string, orgId: string): Promise<Progress> {
  const rows = await query<Row>(`select quests, achievements, stats from {office}.progress where user_id = $1 and org_id = $2`, [userId, orgId]);
  return normalizeProgress(rows[0]);
}

/**
 * Folds a (validated) patch into the stored row under the row's lock, so two tabs saving at once
 * both land (`mergeProgress`: counters never decrease, `done_at` is set once, sets only grow).
 * Only the stat sets the engine owns are written; `citations_opened` and `rooms_visited` stay
 * with `recordStats`. Returns the merged progress.
 */
export async function writeProgress(userId: string, orgId: string, patch: ProgressPatch): Promise<Progress> {
  return transaction(async (run) => {
    // The no-op update both creates a missing row and locks it for this transaction.
    const [stored] = await run<Row>(
      `insert into {office}.progress as p (user_id, org_id) values ($1, $2)
       on conflict (user_id, org_id) do update set updated_at = p.updated_at
       returning quests, achievements, stats`,
      [userId, orgId],
    );
    const merged = mergeProgress(normalizeProgress(stored), patch);
    const sets = Object.fromEntries(ENGINE_SETS.flatMap((key) => (merged.stats[key] ? [[key, merged.stats[key]]] : [])));
    await run(
      `update {office}.progress
          set quests = $3::jsonb, achievements = $4::jsonb, stats = stats || $5::jsonb, updated_at = now()
        where user_id = $1 and org_id = $2`,
      [userId, orgId, JSON.stringify(merged.quests), JSON.stringify(merged.achievements), JSON.stringify(sets)],
    );
    return merged;
  });
}

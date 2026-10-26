import { z } from "zod";
import {
  ACHIEVEMENTS,
  type AchievementId,
  ENGINE_SETS,
  isQuestId,
  type Progress,
  QUEST_IDS,
  type QuestId,
  type QuestState,
  type Stats,
} from "./definitions";

/**
 * What the client may send to `saveProgress` and how the server folds it into the stored row
 * (phase O9 › Persistence). Pure and client-safe, so the Server Action, the beacon route and the
 * tests share it. The client is trusted for game progress (it is a game); this keeps the data
 * well-formed and monotonic: counters never decrease, `done_at` is set once, stat sets only grow.
 */
const ACHIEVEMENT_IDS = ACHIEVEMENTS.map((achievement) => achievement.id) as [AchievementId, ...AchievementId[]];
const isAchievementId = (value: unknown): value is AchievementId => ACHIEVEMENT_IDS.includes(value as AchievementId);

const MAX_PROGRESS = 1000;
/** A set of ids, locations or `{location}:{npc}` pairs. */
const member = z.string().trim().min(1).max(100);
const memberSet = z.array(member).max(100);
const MAX_SET = 200;

const questState = z.object({ progress: z.number().int().min(0).max(MAX_PROGRESS), done_at: z.iso.datetime().optional() }).strict();

export const progressPatchSchema = z
  .object({
    quests: z.partialRecord(z.enum(QUEST_IDS), questState),
    achievements: z.partialRecord(z.enum(ACHIEVEMENT_IDS), z.iso.datetime()),
    stats: z.object(Object.fromEntries(ENGINE_SETS.map((key) => [key, memberSet])) as Record<(typeof ENGINE_SETS)[number], typeof memberSet>).partial().strict(),
  })
  .partial()
  .strict();

export type ProgressPatch = z.infer<typeof progressPatchSchema>;

/** The `saveProgress(orgId, patch)` / beacon body. */
export const saveProgressSchema = z.object({ orgId: z.string().min(1).max(64), patch: progressPatchSchema }).strict();

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

/** A stored row (jsonb of unknown age) as `Progress`: unknown ids and bad values are dropped. */
export function normalizeProgress(raw: { quests?: unknown; achievements?: unknown; stats?: unknown } | null | undefined): Progress {
  const quests: Progress["quests"] = {};
  if (isRecord(raw?.quests)) {
    for (const [id, value] of Object.entries(raw.quests)) {
      if (!isQuestId(id) || !isRecord(value) || typeof value.progress !== "number" || !Number.isFinite(value.progress)) continue;
      const progress = Math.max(0, Math.floor(value.progress));
      const doneAt = typeof value.done_at === "string" && !Number.isNaN(Date.parse(value.done_at)) ? value.done_at : undefined;
      quests[id] = doneAt ? { progress, done_at: doneAt } : { progress };
    }
  }
  const achievements: Progress["achievements"] = {};
  if (isRecord(raw?.achievements)) {
    for (const [id, at] of Object.entries(raw.achievements)) {
      if (isAchievementId(id) && typeof at === "string" && !Number.isNaN(Date.parse(at))) achievements[id] = at;
    }
  }
  const stats: Stats = {};
  if (isRecord(raw?.stats)) {
    for (const key of ENGINE_SETS) if (Array.isArray(raw.stats[key])) stats[key] = strings(raw.stats[key]);
    for (const key of ["rooms_visited", "cities_visited"] as const) if (Array.isArray(raw.stats[key])) stats[key] = strings(raw.stats[key]);
    const opened = raw.stats.citations_opened;
    if (typeof opened === "number" && Number.isFinite(opened)) stats.citations_opened = Math.max(0, Math.floor(opened));
  }
  return { quests, achievements, stats };
}

/** The part of a player's progress the engine owns, as a patch (what a save sends). */
export function toPatch(progress: Progress): ProgressPatch {
  const stats: NonNullable<ProgressPatch["stats"]> = {};
  for (const key of ENGINE_SETS) {
    const list = progress.stats[key];
    if (list && list.length > 0) stats[key] = list.slice(-100);
  }
  return { quests: progress.quests, achievements: progress.achievements, stats };
}

function mergeQuest(stored: QuestState | undefined, incoming: QuestState): QuestState {
  const progress = Math.max(stored?.progress ?? 0, incoming.progress);
  const doneAt = stored?.done_at ?? incoming.done_at;
  return doneAt ? { progress, done_at: doneAt } : { progress };
}

/**
 * Folds a patch into the stored progress. Quest progress is the larger of the two and a recorded
 * `done_at` is never replaced; an achievement keeps its first unlock time; stat sets are unions
 * (stored order first, capped); the stats the engine does not own are left alone.
 */
export function mergeProgress(stored: Progress, patch: ProgressPatch): Progress {
  const quests = { ...stored.quests };
  for (const [id, incoming] of Object.entries(patch.quests ?? {}) as [QuestId, QuestState][]) {
    quests[id] = mergeQuest(stored.quests[id], incoming);
  }
  const achievements = { ...stored.achievements };
  for (const [id, at] of Object.entries(patch.achievements ?? {}) as [AchievementId, string][]) {
    achievements[id] ??= at;
  }
  const stats: Stats = { ...stored.stats };
  for (const key of ENGINE_SETS) {
    const incoming = patch.stats?.[key];
    if (incoming) stats[key] = [...new Set([...(stored.stats[key] ?? []), ...incoming])].slice(0, MAX_SET);
  }
  return { quests, achievements, stats };
}

import { earnedBy } from "./achievements";
import type { GameEvent } from "./bus";
import {
  type AchievementId,
  CORE_QUEST_IDS,
  type Progress,
  QUESTS,
  type QuestContext,
  type QuestId,
  type Stats,
} from "./definitions";

/** The hub's location id (`lib/locations` `WORLDWIDE_ID`), repeated so the engine stays dependency-free. */
const HUB = "worldwide";

export const emptyProgress = (): Progress => ({ quests: {}, achievements: {}, stats: {} });

export type ApplyResult = {
  progress: Progress;
  /** Quests that became done with this event. */
  completed: QuestId[];
  /** Achievements earned with this event (a completed quest earns its own). */
  unlocked: AchievementId[];
};

/** `list` with `value` in it, as the same array when it already was. */
function withMember(list: string[] | undefined, value: string): string[] {
  if (list?.includes(value)) return list;
  return [...(list ?? []), value];
}

/** The stats after `event` (the same object when it changes none). */
export function reduceStats(stats: Stats, event: GameEvent, context: QuestContext): Stats {
  const next: Stats = { ...stats };
  switch (event.type) {
    case "question_asked":
      next.asked_cities = withMember(stats.asked_cities, event.location);
      if (event.department) next.asked_departments = withMember(stats.asked_departments, event.department);
      break;
    case "citation_opened":
      next.citations_opened = (stats.citations_opened ?? 0) + 1;
      break;
    case "office_entered":
      next.offices_entered = withMember(stats.offices_entered, event.location);
      break;
    case "room_entered":
      if (event.department) next.departments_entered = withMember(stats.departments_entered, event.department);
      break;
    case "npc_talked":
      next.npcs_met = withMember(stats.npcs_met, `${context.location ?? "-"}:${event.npc}`);
      break;
    default:
      return stats;
  }
  return (Object.keys(next) as (keyof Stats)[]).every((key) => next[key] === stats[key]) ? stats : next;
}

/**
 * Applies one bus event to a player's progress in one org. Pure and idempotent where it counts:
 * progress never goes down, a finished quest never changes (its `done_at` stays), and so
 * replaying a finished quest's events completes nothing again.
 */
export function applyEvent(progress: Progress, event: GameEvent, context: QuestContext): ApplyResult {
  const stats = reduceStats(progress.stats, event, context);
  let quests = progress.quests;
  let achievements = progress.achievements;
  const completed: QuestId[] = [];
  const unlocked: AchievementId[] = [];

  const unlock = (id: AchievementId) => {
    if (achievements[id]) return;
    achievements = { ...achievements, [id]: context.now };
    unlocked.push(id);
  };

  for (const quest of QUESTS) {
    const state = quests[quest.id];
    if (state?.done_at) continue;
    const next = quest.advance(event, stats, context);
    if (next === undefined) continue;
    const target = quest.target(context);
    const value = Math.min(target, Math.max(state?.progress ?? 0, next));
    if (value === (state?.progress ?? 0) && value < target) continue;
    if (value >= target) {
      quests = { ...quests, [quest.id]: { progress: target, done_at: context.now } };
      completed.push(quest.id);
      unlock(`quest_${quest.id}`);
    } else {
      quests = { ...quests, [quest.id]: { progress: value } };
    }
  }
  for (const id of earnedBy(event, stats, HUB)) unlock(id);

  if (stats === progress.stats && quests === progress.quests && achievements === progress.achievements) {
    return { progress, completed, unlocked };
  }
  return { progress: { quests, achievements, stats }, completed, unlocked };
}

/**
 * Brings progress up to what the stored stats prove (counters saved before quests existed, such
 * as citations opened): called once when the world loads. Like `applyEvent` it reports what it
 * completed, though the caller doesn't celebrate old news.
 */
export function reconcile(progress: Progress, context: QuestContext): ApplyResult {
  let quests = progress.quests;
  let achievements = progress.achievements;
  const completed: QuestId[] = [];
  const unlocked: AchievementId[] = [];
  for (const quest of QUESTS) {
    const state = quests[quest.id];
    if (state?.done_at || !quest.fromStats) continue;
    const target = quest.target(context);
    const value = Math.min(target, Math.max(state?.progress ?? 0, quest.fromStats(progress.stats, context)));
    if (value === (state?.progress ?? 0) && value < target) continue;
    if (value >= target) {
      quests = { ...quests, [quest.id]: { progress: target, done_at: context.now } };
      achievements = { ...achievements, [`quest_${quest.id}`]: context.now };
      completed.push(quest.id);
      unlocked.push(`quest_${quest.id}`);
    } else {
      quests = { ...quests, [quest.id]: { progress: value } };
    }
  }
  if (quests === progress.quests) return { progress, completed, unlocked };
  return { progress: { ...progress, quests, achievements }, completed, unlocked };
}

/** How many of the core quests are done: the lift's "3/5". */
export function coreStatus(progress: Progress): { done: number; total: number } {
  return { done: CORE_QUEST_IDS.filter((id) => progress.quests[id]?.done_at).length, total: CORE_QUEST_IDS.length };
}

/** The rooftop opens once every core quest is done. */
export function rooftopUnlocked(progress: Progress): boolean {
  const { done, total } = coreStatus(progress);
  return done === total;
}

/** The requirements the player meets beyond access cards (`requires: "unlock:rooftop"`). */
export function unlocksOf(progress: Progress): string[] {
  return rooftopUnlocked(progress) ? ["rooftop"] : [];
}

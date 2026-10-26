import type { GameEvent } from "./bus";
import { type AchievementId, EARLY_BIRD_HOURS, SOCIAL_TARGET, type Stats } from "./definitions";

/**
 * The achievements that no quest stands behind (phase O9): an event, plus the stats it just
 * changed, either earns one or not. Pure. The Worldwide hub has no local time of its own, so
 * arriving there earns neither of the time-of-day ones.
 */
export function earnedBy(event: GameEvent, stats: Stats, hub: string): AchievementId[] {
  switch (event.type) {
    case "city_entered": {
      if (event.location === hub) return [];
      const earned: AchievementId[] = [];
      if (event.isNight) earned.push("night_owl");
      if (event.hour !== undefined && event.hour >= EARLY_BIRD_HOURS.from && event.hour < EARLY_BIRD_HOURS.to) earned.push("early_bird");
      return earned;
    }
    case "npc_talked":
      return (stats.npcs_met?.length ?? 0) >= SOCIAL_TARGET ? ["social_butterfly"] : [];
    case "scene_entered":
      return event.scene === "rooftop" ? ["rooftop"] : [];
    default:
      return [];
  }
}

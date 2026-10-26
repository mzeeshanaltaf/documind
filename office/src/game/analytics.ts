import { track } from "@/lib/analytics";
import { bus } from "./quests/bus";

/**
 * Sends the game's product events to Umami (phase O10 › Analytics). Quest completions and the
 * rooftop unlock are tracked where the quest runtime handles them. Counts and categories only, never names or message content. `track()` does nothing
 * outside production builds. Returns the cleanup.
 */
export function startAnalytics(): () => void {
  const off = bus.onAny((event) => {
    switch (event.type) {
      case "office_entered":
        track("office_entered", { location: event.location });
        break;
      case "question_asked":
        track("question_asked", { department: event.department ?? "reception", location: event.location });
        break;
      case "badge_issued":
        track("cards_issued", { count: event.departments.length });
        break;
      case "citation_opened":
        track("citation_opened");
        break;
      case "game_finished":
        track("game_finished", { game: event.game });
        break;
    }
  });
  return off;
}

import type { GameId } from "@/game/games/types";
import type { InteractKind } from "@/game/interact/select";
import type { EmoteId } from "@/game/player/emotes";
import type { SceneId } from "@/game/store/game-store";
import type { DeckId } from "@/game/world/office/presentation/slides";

/**
 * The game's typed event bus. Interactions and scenes emit here; the quest engine (O9) and
 * analytics listen. Synchronous, and a throwing listener never stops the others.
 */
export type GameEvent =
  | { type: "scene_entered"; scene: SceneId }
  /** A city (or the Global Hub) came into view; `isNight` feeds "Night owl" (O9). */
  | { type: "city_entered"; location: string; isNight: boolean }
  | { type: "office_entered"; location: string }
  | { type: "travelled"; from: string; to: string }
  /** `room` is the floor plan's id (`lobby`, `dept:HR`…); `department` is set for department rooms. */
  | { type: "room_entered"; room: string; department?: string; location?: string }
  /** An NPC answered (on `done`); `department` is null at reception. */
  | { type: "question_asked"; npc: string; department: string | null; location: string }
  /** A cited document appeared under an answer. */
  | { type: "citation_shown"; doc_code: string | null; department: string | null }
  /** A citation chip or a sources row opened the PDF (O6; "Check the source", "Bookworm"). */
  | { type: "citation_opened"; doc_code: string | null; department: string | null }
  | { type: "badge_issued"; departments: string[] }
  | { type: "interacted"; id: string; kind: InteractKind }
  | { type: "interact_blocked"; id: string; requires?: string }
  | { type: "npc_talked"; npc: string }
  | { type: "sat"; seat: string }
  /** Every slide of a presentation-room deck has been seen this visit (O7; "Orientation", O9). */
  | { type: "presentation_watched"; deck: DeckId; location?: string }
  /** A mini-game was started from its station in the play area (O8). */
  | { type: "game_started"; game: GameId }
  /** A game ran to its end (not quit); `score` is what it will submit (O8; "Arcade regular", O9). */
  | { type: "game_finished"; game: GameId; score: number }
  /** The server stored the score; `rank` is the player's place on the org's board (O8). */
  | { type: "score_submitted"; game: GameId; score: number; rank: number; personalBest: boolean }
  | { type: "emote_used"; emote: EmoteId }
  | { type: "coffee_brewed" }
  | { type: "jukebox_changed"; track: string }
  | { type: "sign_read"; sign: string }
  | { type: "avatar_saved" }
  | { type: "hotkey"; action: "journal" | "map" };

export type GameEventType = GameEvent["type"];
type Listener<T extends GameEventType> = (event: Extract<GameEvent, { type: T }>) => void;
type AnyListener = (event: GameEvent) => void;

export function createBus() {
  const listeners = new Map<GameEventType | "*", Set<AnyListener>>();

  function add(key: GameEventType | "*", listener: AnyListener) {
    let set = listeners.get(key);
    if (!set) listeners.set(key, (set = new Set()));
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }

  /** Listens to one event type; returns the unsubscribe function. */
  function on<T extends GameEventType>(type: T, listener: Listener<T>) {
    return add(type, listener as AnyListener);
  }

  /** Listens to every event. */
  function onAny(listener: AnyListener) {
    return add("*", listener);
  }

  function emit(event: GameEvent) {
    for (const key of [event.type, "*"] as const) {
      for (const listener of listeners.get(key) ?? []) {
        try {
          listener(event);
        } catch (error) {
          console.error(`[bus] listener for ${event.type} failed`, error);
        }
      }
    }
  }

  return { on, onAny, emit, clear: () => listeners.clear() };
}

export const bus = createBus();
export const emit = bus.emit;

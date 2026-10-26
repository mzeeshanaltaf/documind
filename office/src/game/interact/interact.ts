import { Vector3 } from "three";
import { audio } from "@/game/audio/audio";
import { rig } from "@/game/player/rig";
import { emit } from "@/game/quests/bus";
import { type GameState, useGame } from "@/game/store/game-store";
import { type Candidate, meetsRequirement, sameFocus, selectFocused } from "./select";

const world = new Vector3();

/** True when the player meets a requirement such as `card:HR` (`card:*` = any card). */
export function meets(state: GameState, requirement: string): boolean {
  return meetsRequirement(state.player.cards, requirement, state.unlocks);
}

function* candidates(state: GameState): Generator<Candidate> {
  for (const entry of state.interactables.values()) {
    entry.object.getWorldPosition(world);
    yield { ...entry, position: [world.x, world.y, world.z] };
  }
}

/** Re-picks the focused interactable; the store is only written when the focus changes. */
export function updateFocus() {
  const state = useGame.getState();
  const blocked = state.modal !== null || state.world.phase !== "ready" || state.player.pose === "sit";
  const next = blocked
    ? null
    : selectFocused(candidates(state), [rig.position.x, rig.position.y, rig.position.z], (r) => meets(state, r));
  if (!sameFocus(state.focus, next)) state.setFocus(next);
}

/** E (or the prompt button): use the focused interactable, or explain why it's locked. */
export function interactWithFocus() {
  const state = useGame.getState();
  const focus = state.focus;
  if (!focus || state.modal) return;
  const entry = state.interactables.get(focus.id);
  if (!entry) return;
  if (focus.locked) {
    state.deny();
    audio.play("ui-deny", { volume: 0.6 });
    emit({ type: "interact_blocked", id: focus.id, requires: entry.requires });
    return;
  }
  audio.play("ui-click", { volume: 0.5 });
  emit({ type: "interacted", id: focus.id, kind: focus.kind });
  entry.onInteract();
}

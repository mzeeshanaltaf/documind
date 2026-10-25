import { emit } from "@/game/quests/bus";
import { useGame } from "@/game/store/game-store";
import { type EmoteId, emoteById, EMOTES } from "./emotes";

/**
 * The emote wheel's behaviour (phase O8 › Ambient activities), outside React so the keyboard
 * listener and the HUD share it. The wheel only opens while the player is free to act: the scene
 * is ready, nothing is open and they're standing.
 */
export function canEmote(): boolean {
  const s = useGame.getState();
  return s.world.phase === "ready" && s.modal === null && s.player.pose === "stand";
}

export function openEmoteWheel() {
  const s = useGame.getState();
  if (!canEmote() || s.emoteWheel.open) return;
  s.setEmoteWheel({ open: true, highlight: null });
}

export function closeEmoteWheel() {
  const s = useGame.getState();
  if (s.emoteWheel.open) s.setEmoteWheel({ open: false, highlight: null });
}

export function highlightEmote(highlight: number | null) {
  const s = useGame.getState();
  if (s.emoteWheel.open && s.emoteWheel.highlight !== highlight) s.setEmoteWheel({ open: true, highlight });
}

/** Plays a gesture until it ends or the player moves, and closes the wheel. */
export function performEmote(id: EmoteId) {
  const s = useGame.getState();
  closeEmoteWheel();
  if (!canEmote()) return;
  const emote = emoteById(id);
  s.setEmote({ id, clip: emote.clip, until: performance.now() + emote.seconds * 1000 });
  emit({ type: "emote_used", emote: id });
}

/** Q released: play the highlighted gesture, if one was chosen, and close. */
export function releaseEmoteWheel() {
  const { emoteWheel } = useGame.getState();
  if (!emoteWheel.open) return;
  const chosen = emoteWheel.highlight === null ? null : EMOTES[emoteWheel.highlight];
  if (chosen) performEmote(chosen.id);
  else closeEmoteWheel();
}

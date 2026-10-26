import { audio } from "@/game/audio/audio";
import { track } from "@/lib/analytics";
import { type GameState, useGame } from "@/game/store/game-store";
import { bus } from "./bus";
import { questContext } from "./context";
import { ACHIEVEMENT_BY_ID, QUEST_BY_ID, type QuestContext } from "./definitions";
import { applyEvent, reconcile } from "./engine";
import { beaconProgress, flushProgress, markProgress } from "./save";

/**
 * Wires the pure quest engine into the running game (phase O9): every bus event goes through
 * `applyEvent` against the player's progress in this org, the result lands in the store (the
 * journal, the lift and the toasts read it) and is queued for saving. Nothing is tracked in the
 * dev sandbox, which has no org.
 */
let cached: { office: NonNullable<GameState["office"]>; base: QuestContext } | null = null;

/** What the org offers, derived once per office context (its documents rarely change). */
function contextOf(state: GameState): QuestContext | null {
  const { office } = state;
  if (!office) return null;
  if (cached?.office !== office) cached = { office, base: questContext(office) };
  return { ...cached.base, now: new Date().toISOString() };
}

/** Listens to the bus for as long as the game runs; returns the cleanup. */
export function startQuests(): () => void {
  // Counters saved before quests existed (citations opened…) count; no fanfare for old news.
  const first = useGame.getState();
  const start = contextOf(first);
  if (start && first.office) {
    const caught = reconcile(first.progress, start);
    if (caught.progress !== first.progress) {
      first.setProgress(caught.progress);
      markProgress(first.office.org.id, caught.progress);
    }
  }

  const off = bus.onAny((event) => {
    const state = useGame.getState();
    const context = contextOf(state);
    if (!context || !state.office) return;
    const result = applyEvent(state.progress, event, context);
    if (result.progress === state.progress) return;
    state.setProgress(result.progress);
    markProgress(state.office.org.id, result.progress);
    for (const id of result.completed) track("quest_completed", { id });
    if (!state.unlocks.includes("rooftop") && useGame.getState().unlocks.includes("rooftop")) track("rooftop_unlocked");

    // Quests toast as quests; an achievement toasts on its own only when no quest stands behind it.
    const toasts = [
      ...result.completed.map((id) => ({ kind: "quest" as const, title: QUEST_BY_ID[id].title, text: "Quest complete" })),
      ...result.unlocked.flatMap((id) => (ACHIEVEMENT_BY_ID[id].kind === "special" ? [{ kind: "achievement" as const, title: ACHIEVEMENT_BY_ID[id].title, text: "Achievement unlocked" }] : [])),
    ];
    if (toasts.length > 0) {
      state.pushToasts(toasts);
      audio.play("success", { volume: 0.5 });
    }
  });

  const onHide = () => document.visibilityState === "hidden" && beaconProgress();
  const onPageHide = () => beaconProgress();
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", onPageHide);
  return () => {
    off();
    document.removeEventListener("visibilitychange", onHide);
    window.removeEventListener("pagehide", onPageHide);
    void flushProgress();
  };
}

import { useEffect } from "react";
import { interactWithFocus } from "@/game/interact/interact";
import { closeEmoteWheel, openEmoteWheel, performEmote, releaseEmoteWheel } from "@/game/player/emote-actions";
import { EMOTES } from "@/game/player/emotes";
import { emit } from "@/game/quests/bus";
import { useGame } from "@/game/store/game-store";
import { type Action, actionForCode, HELD_ACTIONS, moveFromActions, shouldIgnoreKeys } from "./bindings";

/**
 * The game's keyboard listener. Movement keys are held state (written to the store only when the
 * set of held keys changes); E, J, M and Esc fire once per press. Everything is ignored while a
 * text field has focus or a dialog is open; the dialog handles its own Esc. While seated, E and
 * Esc stand up, and on an auditorium seat ←/→ (A/D) change the slide instead of moving. Q held
 * opens the emote wheel (O8): 1–3 play a gesture at once, and releasing Q plays the highlighted one.
 */
export function useKeyboardInput() {
  useEffect(() => {
    const held = new Set<Action>();
    const publish = () => useGame.getState().setKeyboardInput(moveFromActions(held), held.has("run"));
    const release = () => {
      closeEmoteWheel();
      if (held.size === 0) return;
      held.clear();
      publish();
    };

    function onKeyDown(event: KeyboardEvent) {
      const action = actionForCode(event.code);
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const state = useGame.getState();
      if (shouldIgnoreKeys(document.activeElement, state.modal !== null)) return;

      // The wheel is open: a number picks a gesture straight away.
      const digit = /^(?:Digit|Numpad)([1-9])$/.exec(event.code);
      if (digit && state.emoteWheel.open) {
        event.preventDefault();
        const emote = EMOTES[Number(digit[1]) - 1];
        if (emote && !event.repeat) performEmote(emote.id);
        return;
      }
      if (!action) return;
      if (action === "emote") {
        event.preventDefault();
        if (!event.repeat) openEmoteWheel();
        return;
      }

      // Seated: E or Esc stands up; on an auditorium seat ←/→ page the slides (O7).
      const seat = state.player.pose === "sit" ? state.player.seat : null;
      if (seat && (action === "interact" || action === "menu")) {
        event.preventDefault();
        if (!event.repeat) state.stand();
        return;
      }
      if (seat?.view && (action === "left" || action === "right")) {
        event.preventDefault();
        if (!event.repeat) state.stepSlide(action === "right" ? 1 : -1);
        return;
      }

      if (HELD_ACTIONS.has(action)) {
        // Arrow keys would otherwise scroll or move focus.
        if (action !== "run") event.preventDefault();
        if (!held.has(action)) {
          held.add(action);
          publish();
        }
        return;
      }
      if (event.repeat) return;
      event.preventDefault();
      if (action === "interact") {
        interactWithFocus();
      } else if (action === "menu") {
        // On the next task: opened synchronously, the dialog would attach its Escape listener
        // in time to see this same press, and close again at once.
        window.setTimeout(() => {
          const { modal, openModal } = useGame.getState();
          if (!modal) openModal({ type: "menu" });
        }, 0);
      } else {
        emit({ type: "hotkey", action: action as "journal" | "map" });
      }
    }

    function onKeyUp(event: KeyboardEvent) {
      const action = actionForCode(event.code);
      if (action === "emote") releaseEmoteWheel();
      else if (action && held.delete(action)) publish();
    }

    // Keys released while focus was elsewhere never send keyup: drop everything held.
    const onVisibility = () => document.visibilityState === "hidden" && release();
    const unsubscribe = useGame.subscribe((state, previous) => {
      if (state.modal && !previous.modal) release();
    });

    // Capture phase: this must see Esc before the dialog's own listener closes the menu, or the
    // same press would find no dialog open and reopen it.
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", onVisibility);
      unsubscribe();
    };
  }, []);
}

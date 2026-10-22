import { useEffect } from "react";
import { interactWithFocus } from "@/game/interact/interact";
import { emit } from "@/game/quests/bus";
import { useGame } from "@/game/store/game-store";
import { type Action, actionForCode, HELD_ACTIONS, moveFromActions, shouldIgnoreKeys } from "./bindings";

/**
 * The game's keyboard listener. Movement keys are held state (written to the store only when the
 * set of held keys changes); E, J, M and Esc fire once per press. Everything is ignored while a
 * text field has focus or a dialog is open; the dialog handles its own Esc.
 */
export function useKeyboardInput() {
  useEffect(() => {
    const held = new Set<Action>();
    const publish = () => useGame.getState().setKeyboardInput(moveFromActions(held), held.has("run"));
    const release = () => {
      if (held.size === 0) return;
      held.clear();
      publish();
    };

    function onKeyDown(event: KeyboardEvent) {
      const action = actionForCode(event.code);
      if (!action || event.ctrlKey || event.metaKey || event.altKey) return;
      const state = useGame.getState();
      if (shouldIgnoreKeys(document.activeElement, state.modal !== null)) return;

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
      if (action && held.delete(action)) publish();
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

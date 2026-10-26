import type { KeyboardControlsEntry } from "@react-three/drei";

/**
 * Keyboard bindings, in drei's `KeyboardControls` map shape. The listener is our own
 * (`use-keyboard.ts`): drei's has no guard for editable focus or open dialogs.
 */
export type Action = "forward" | "back" | "left" | "right" | "run" | "interact" | "journal" | "map" | "menu" | "emote" | "camera";

export const CONTROLS: KeyboardControlsEntry<Action>[] = [
  { name: "forward", keys: ["ArrowUp", "KeyW"] },
  { name: "back", keys: ["ArrowDown", "KeyS"] },
  { name: "left", keys: ["ArrowLeft", "KeyA"] },
  { name: "right", keys: ["ArrowRight", "KeyD"] },
  { name: "run", keys: ["ShiftLeft", "ShiftRight"] },
  { name: "interact", keys: ["KeyE"] },
  { name: "journal", keys: ["KeyJ"] },
  { name: "map", keys: ["KeyM"] },
  { name: "menu", keys: ["Escape"] },
  /** Switches between the behind-the-player and bird's-eye shots. */
  { name: "camera", keys: ["KeyC"] },
  /** Hold to open the emote wheel (O8); release to play the highlighted gesture. */
  { name: "emote", keys: ["KeyQ"] },
];

/** Held while down (movement and run); the others fire once per press. */
export const HELD_ACTIONS: ReadonlySet<Action> = new Set(["forward", "back", "left", "right", "run"]);

const BY_CODE = new Map(CONTROLS.flatMap((entry) => entry.keys.map((key) => [key, entry.name] as const)));

/** `KeyboardEvent.code` (layout-independent: WASD stays put on AZERTY) to an action. */
export function actionForCode(code: string): Action | null {
  return BY_CODE.get(code) ?? null;
}

export type Move = { x: number; y: number };

export const NO_MOVE: Move = { x: 0, y: 0 };

/**
 * The move vector for the held keys: x is right, y is forward, length 1 (or 0). Opposite keys
 * cancel, and a diagonal is normalized so it isn't faster.
 */
export function moveFromActions(held: ReadonlySet<Action>): Move {
  const x = (held.has("right") ? 1 : 0) - (held.has("left") ? 1 : 0);
  const y = (held.has("forward") ? 1 : 0) - (held.has("back") ? 1 : 0);
  if (x === 0 && y === 0) return NO_MOVE;
  const length = Math.hypot(x, y);
  return { x: x / length, y: y / length };
}

/** Touch wins over the keyboard while the joystick is deflected. */
export function combineMove(keyboard: Move, touch: Move): Move {
  return touch.x !== 0 || touch.y !== 0 ? touch : keyboard;
}

const NON_TEXT_INPUTS = new Set(["button", "checkbox", "radio", "range", "color", "file", "image", "reset", "submit"]);

/** True for elements that take typed text: text inputs, textareas, selects, contenteditable. */
export function isEditable(element: Element | null): boolean {
  if (!element) return false;
  const tag = element.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !NON_TEXT_INPUTS.has(((element as HTMLInputElement).type || "text").toLowerCase());
  if ((element as HTMLElement).isContentEditable) return true;
  // jsdom doesn't implement isContentEditable.
  const editable = element.getAttribute("contenteditable");
  return editable !== null && editable !== "false";
}

/** Game keys are ignored while a text field has focus or a dialog (menu, editor, dialogue) is open. */
export function shouldIgnoreKeys(activeElement: Element | null, modalOpen: boolean): boolean {
  return modalOpen || isEditable(activeElement);
}

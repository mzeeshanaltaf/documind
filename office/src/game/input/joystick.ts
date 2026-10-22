import { type Move, NO_MOVE } from "./bindings";

/** Below this fraction of the radius the stick reads as centred, so a resting thumb doesn't drift. */
export const DEADZONE = 0.15;
/** At or past this deflection the player runs. */
export const RUN_THRESHOLD = 0.92;

export type StickReading = { move: Move; run: boolean };

/**
 * A joystick drag (pixels from the stick's centre, screen y down) to the same move vector the
 * keyboard produces: x right, y forward, length ≤ 1. Past the deadzone the length is rescaled from
 * 0, so slow walking is possible.
 */
export function joystickVector(dx: number, dy: number, radius: number): StickReading {
  const distance = Math.hypot(dx, dy);
  if (radius <= 0 || distance / radius < DEADZONE) return { move: NO_MOVE, run: false };
  const clamped = Math.min(distance, radius);
  const magnitude = (clamped / radius - DEADZONE) / (1 - DEADZONE);
  return {
    move: { x: (dx / distance) * magnitude, y: (-dy / distance) * magnitude },
    run: clamped / radius >= RUN_THRESHOLD,
  };
}

import { describe, expect, it } from "vitest";
import { type Action, actionForCode, combineMove, moveFromActions, NO_MOVE } from "@/game/input/bindings";
import { DEADZONE, joystickVector, RUN_THRESHOLD } from "@/game/input/joystick";

const held = (...actions: Action[]) => new Set(actions);

describe("actionForCode", () => {
  it("maps arrows and WASD (by physical key) to the same actions", () => {
    expect(actionForCode("ArrowUp")).toBe("forward");
    expect(actionForCode("KeyW")).toBe("forward");
    expect(actionForCode("KeyA")).toBe("left");
    expect(actionForCode("ArrowRight")).toBe("right");
    expect(actionForCode("ShiftRight")).toBe("run");
  });

  it("maps E, J, M, Q (the emote wheel, O8) and Esc, and nothing else", () => {
    expect(actionForCode("KeyE")).toBe("interact");
    expect(actionForCode("KeyJ")).toBe("journal");
    expect(actionForCode("KeyM")).toBe("map");
    expect(actionForCode("Escape")).toBe("menu");
    expect(actionForCode("KeyQ")).toBe("emote");
    expect(actionForCode("KeyZ")).toBeNull();
    expect(actionForCode("Space")).toBeNull();
  });
});

describe("moveFromActions", () => {
  it("is zero with nothing (or only run) held", () => {
    expect(moveFromActions(held())).toEqual(NO_MOVE);
    expect(moveFromActions(held("run"))).toEqual(NO_MOVE);
  });

  it("gives unit vectors: x right, y forward", () => {
    expect(moveFromActions(held("forward"))).toEqual({ x: 0, y: 1 });
    expect(moveFromActions(held("back"))).toEqual({ x: 0, y: -1 });
    expect(moveFromActions(held("left"))).toEqual({ x: -1, y: 0 });
  });

  it("normalizes diagonals so they aren't faster", () => {
    const move = moveFromActions(held("forward", "right"));
    expect(Math.hypot(move.x, move.y)).toBeCloseTo(1);
    expect(move.x).toBeCloseTo(Math.SQRT1_2);
  });

  it("cancels opposite keys", () => {
    expect(moveFromActions(held("forward", "back"))).toEqual(NO_MOVE);
    expect(moveFromActions(held("forward", "back", "left"))).toEqual({ x: -1, y: 0 });
  });
});

describe("combineMove", () => {
  it("prefers a deflected joystick over the keyboard", () => {
    const keyboard = { x: 0, y: 1 };
    expect(combineMove(keyboard, NO_MOVE)).toBe(keyboard);
    expect(combineMove(keyboard, { x: 0.5, y: 0 })).toEqual({ x: 0.5, y: 0 });
  });
});

describe("joystickVector", () => {
  it("reads centred inside the deadzone", () => {
    expect(joystickVector(0, 0, 50)).toEqual({ move: NO_MOVE, run: false });
    expect(joystickVector(50 * DEADZONE * 0.9, 0, 50).move).toEqual(NO_MOVE);
  });

  it("maps screen up to forward and right to right", () => {
    const up = joystickVector(0, -50, 50);
    expect(up.move.x).toBeCloseTo(0);
    expect(up.move.y).toBeCloseTo(1);
    expect(joystickVector(50, 0, 50).move.x).toBeCloseTo(1);
  });

  it("clamps past the radius and runs at full deflection", () => {
    const far = joystickVector(0, -400, 50);
    expect(Math.hypot(far.move.x, far.move.y)).toBeCloseTo(1);
    expect(far.run).toBe(true);
    expect(joystickVector(0, -50 * (RUN_THRESHOLD - 0.1), 50).run).toBe(false);
  });

  it("rescales from the deadzone edge, so slow walking is possible", () => {
    const slow = joystickVector(0, -50 * (DEADZONE + 0.1), 50);
    expect(slow.move.y).toBeGreaterThan(0);
    expect(slow.move.y).toBeLessThan(0.2);
  });
});

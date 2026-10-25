import { describe, expect, it } from "vitest";
import {
  aimFromDrag,
  BIN_TOP,
  BINS,
  BELT,
  type BinId,
  comboMultiplier,
  currentItem,
  DURATION_S,
  finishRound,
  flightPoint,
  HAND,
  ITEM_BIN,
  ITEM_KINDS,
  kindAt,
  landing,
  MAX_ANGLE,
  MIN_ANGLE,
  maxSortTossScore,
  type RoundState,
  speedForPower,
  spawnTimes,
  startRound,
  stepRound,
  throwItem,
  trajectory,
} from "@/game/games/sort-toss/logic";

// Phase O8 › Tests: Sort & Toss's schedule, throws, scoring and its bound.

/** The power (at 50°) that lands a throw in the middle of `bin`. */
function powerFor(bin: BinId, angle = (50 * Math.PI) / 180): number {
  const target = BINS.find((b) => b.id === bin)!.x;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2;
    if (landing(angle, speedForPower(mid)).x < target) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

/** Steps the round `seconds` at 60 fps, throwing correctly whenever an item is in hand. */
function playPerfect(seed: number, { pause = 0 }: { pause?: number } = {}): RoundState {
  let state = startRound(seed);
  let wait = 0;
  while (!state.done) {
    state = stepRound(state, 1 / 60).state;
    wait -= 1 / 60;
    const item = currentItem(state);
    if (item && wait <= 0 && !state.done) {
      state = throwItem(state, (50 * Math.PI) / 180, powerFor(ITEM_BIN[item.kind])).state;
      wait = pause;
    }
  }
  return state;
}

describe("the schedule", () => {
  it("is the same every round and speeds up", () => {
    const times = spawnTimes();
    expect(times).toEqual(spawnTimes());
    expect(times[0]).toBeGreaterThan(0);
    expect(times.at(-1)!).toBeLessThan(DURATION_S);
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    expect(gaps[0]).toBeGreaterThan(gaps.at(-1)!);
    expect(times.length).toBeGreaterThan(35);
    expect(times.length).toBeLessThan(55);
  });

  it("deals the same items for the same seed, all five kinds", () => {
    const deal = (seed: number) => Array.from({ length: 40 }, (_, i) => kindAt(seed, i));
    expect(deal(11)).toEqual(deal(11));
    expect(deal(11)).not.toEqual(deal(12));
    expect(new Set(deal(11))).toEqual(new Set(ITEM_KINDS));
  });

  it("follows the Facilities manual's bins", () => {
    expect(ITEM_BIN).toEqual({ paper: "paper", can: "recycling", battery: "recycling", cup: "general", peel: "general" });
  });

  it("uses combo multipliers ×1, ×2, ×3, ×4", () => {
    expect([0, 2, 3, 5, 6, 8, 9, 30].map(comboMultiplier)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
  });
});

describe("a throw", () => {
  it("lands where the closed form says, and reaches the rim height", () => {
    const angle = (50 * Math.PI) / 180;
    for (const power of [0.2, 0.5, 0.8, 1]) {
      const speed = speedForPower(power);
      const result = landing(angle, speed);
      const end = flightPoint(angle, speed, result.time);
      expect(end.y).toBeCloseTo(BIN_TOP, 6);
      expect(end.x).toBeCloseTo(result.x, 6);
      const dots = trajectory(angle, speed, 10);
      expect(dots[0]).toEqual({ x: HAND.x, y: HAND.y });
      expect(dots.at(-1)!.y).toBeCloseTo(BIN_TOP, 6);
    }
  });

  it("can reach each bin, and misses between them", () => {
    for (const bin of BINS) expect(landing((50 * Math.PI) / 180, speedForPower(powerFor(bin.id))).bin).toBe(bin.id);
    expect(landing((50 * Math.PI) / 180, speedForPower(0.05)).bin).toBeNull();
    expect(landing((50 * Math.PI) / 180, speedForPower(1)).bin).toBeNull();
    expect(landing(MAX_ANGLE, speedForPower(0.3)).bin).toBeNull();
  });

  it("turns a drag back from the thrower into an angle and a power", () => {
    const pull = aimFromDrag(100, 100);
    expect(pull.angle).toBeCloseTo(Math.PI / 4, 6);
    expect(pull.power).toBeCloseTo(Math.hypot(100, 100) / 170, 6);
    expect(aimFromDrag(1000, 0).angle).toBe(MIN_ANGLE);
    expect(aimFromDrag(0, 1000).angle).toBe(MAX_ANGLE);
    expect(aimFromDrag(1000, 1000).power).toBe(1);
    expect(aimFromDrag(-50, 10).angle).toBe(MAX_ANGLE);
  });
});

describe("a round", () => {
  it("moves items along the belt, spawns them on schedule and drops what reaches the end", () => {
    let state = startRound(5);
    state = stepRound(state, 0.5).state;
    expect(state.items).toHaveLength(1);
    expect(state.items[0].x).toBeGreaterThanOrEqual(BELT.x0);
    const x = state.items[0].x;
    state = stepRound(state, 0.5).state;
    expect(state.items[0].x).toBeGreaterThan(x);
    // Untouched, the first item reaches the end within a few seconds.
    let dropped = 0;
    for (let i = 0; i < 60 * 8; i++) {
      const step = stepRound(state, 1 / 60);
      state = step.state;
      dropped += step.events.filter((e) => e.type === "dropped").length;
    }
    expect(dropped).toBeGreaterThan(0);
    expect(state.missed).toBe(dropped);
    expect(state.score).toBe(0);
    expect(state.combo).toBe(0);
  });

  it("scores a right bin by the combo, charges a wrong bin and breaks the combo on a miss", () => {
    const angle = (50 * Math.PI) / 180;
    let state = startRound(9);
    state = stepRound(state, 0.5).state;
    const kind = currentItem(state)!.kind;
    const right = ITEM_BIN[kind];
    const wrong = BINS.find((b) => b.id !== right)!.id;

    // Right: 10 points, then it counts.
    state = throwItem(state, angle, powerFor(right)).state;
    expect(state.flights).toHaveLength(1);
    expect(currentItem(state)).toBeNull();
    state = stepRound(state, 2).state;
    expect(state).toMatchObject({ score: 10, combo: 1, correct: 1, wrong: 0, flights: [] });

    // Wrong with a score of 10: −1 and the combo goes.
    state = stepRound(state, 1).state;
    const second = currentItem(state)!;
    state = throwItem(state, angle, powerFor(BINS.find((b) => b.id !== ITEM_BIN[second.kind])!.id)).state;
    state = stepRound(state, 2).state;
    expect(state).toMatchObject({ score: 9, combo: 0, wrong: 1 });
    void wrong;

    // A miss costs nothing but the combo.
    state = stepRound(state, 1).state;
    state = throwItem(state, angle, 0.02).state;
    state = stepRound(state, 2).state;
    expect(state.score).toBe(9);
    expect(state.missed).toBeGreaterThan(0);
  });

  it("never lets the score go below zero", () => {
    let state = startRound(2);
    state = stepRound(state, 0.5).state;
    const item = currentItem(state)!;
    const other = BINS.find((b) => b.id !== ITEM_BIN[item.kind])!.id;
    state = throwItem(state, (50 * Math.PI) / 180, powerFor(other)).state;
    state = stepRound(state, 2).state;
    expect(state.wrong).toBe(1);
    expect(state.score).toBe(0);
  });

  it("ignores a throw with an empty belt, a finished round or nonsense", () => {
    const empty = startRound(1);
    expect(throwItem(empty, 1, 1).state).toBe(empty);
    const state = stepRound(startRound(1), 0.5).state;
    expect(throwItem(state, Number.NaN, 1).state).toBe(state);
    expect(throwItem({ ...state, done: true }, 1, 1).state.flights).toHaveLength(0);
  });

  it("clamps the angle of a throw into the allowed range", () => {
    const state = stepRound(startRound(1), 0.5).state;
    const thrown = throwItem(state, 3, 1).state;
    expect(thrown.flights[0].angle).toBe(MAX_ANGLE);
  });

  it("ends at 60 seconds, landing balls still in the air", () => {
    let state = startRound(3);
    state = stepRound(state, 59.9).state;
    expect(state.done).toBe(false);
    state = stepRound(state, 0.5).state;
    expect(state.done).toBe(true);
    expect(state.time).toBe(DURATION_S);
    // A ball thrown just before the end counts.
    let live = stepRound(startRound(3), 59.5).state;
    live = throwItem(live, (50 * Math.PI) / 180, powerFor(ITEM_BIN[currentItem(live)!.kind])).state;
    expect(live.flights).toHaveLength(1);
    const ended = finishRound(live);
    expect(ended.done).toBe(true);
    expect(ended.flights).toHaveLength(0);
    expect(ended.correct).toBe(1);
  });

  it("keeps a perfect run within the computed maximum, and a hurried one lower", () => {
    const perfect = playPerfect(21);
    expect(perfect.done).toBe(true);
    expect(perfect.wrong).toBe(0);
    expect(perfect.score).toBeGreaterThan(300);
    expect(perfect.score).toBeLessThanOrEqual(maxSortTossScore());
    expect(perfect.maxCombo).toBeLessThanOrEqual(perfect.correct);
    const slow = playPerfect(21, { pause: 2.5 });
    expect(slow.score).toBeLessThan(perfect.score);
    expect(maxSortTossScore()).toBeGreaterThan(perfect.score - 1);
  });

  it("is deterministic for a seed", () => {
    expect(playPerfect(33)).toEqual(playPerfect(33));
    expect(playPerfect(33).score).not.toBe(-1);
  });
});

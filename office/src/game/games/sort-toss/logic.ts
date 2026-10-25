import { mulberry32, type Random } from "@/game/world/city/random";

/**
 * Sort & Toss's rules as pure functions (phase O8 › Sort & Toss). Office items ride a conveyor
 * towards its end; the one nearest the end is in the player's hand, and a throw (an angle and a
 * power) sends it in an arc to a bin. The flight is a closed-form projectile (no physics engine:
 * the same throw always lands the same), so the whole round is deterministic given its seed.
 *
 * Coordinates are a 960×540 field with y pointing down.
 */
export const FIELD = { width: 960, height: 540 };
export const DURATION_S = 60;

export const ITEM_KINDS = ["paper", "can", "cup", "battery", "peel"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];
export type BinId = "paper" | "recycling" | "general";

/**
 * Where each item goes, after the Facilities manual (SIM-FAC-001 p. 68: offices provide recycling,
 * compost where available, and landfill bins; p. 56: batteries go in marked universal-waste
 * containers, never general trash). The three-bin game folds batteries into Recycling (the marked
 * collection) and food waste and lined cups into General.
 */
export const ITEM_BIN: Record<ItemKind, BinId> = { paper: "paper", can: "recycling", battery: "recycling", cup: "general", peel: "general" };
export const ITEM_LABEL: Record<ItemKind, string> = { paper: "Paper", can: "Can", cup: "Coffee cup", battery: "Battery", peel: "Banana peel" };
const ITEM_WEIGHT: Record<ItemKind, number> = { paper: 3, can: 3, cup: 2, battery: 1.5, peel: 1.5 };

export type Bin = { id: BinId; label: string; x: number };
/** Bin openings sit on the right, `width` wide; the rim is at `BIN_TOP`. */
export const BINS: readonly Bin[] = [
  { id: "paper", label: "Paper", x: 600 },
  { id: "recycling", label: "Recycling", x: 740 },
  { id: "general", label: "General", x: 880 },
];
export const BIN_WIDTH = 110;
export const BIN_TOP = 440;
export const BALL_RADIUS = 14;

export const HAND = { x: 150, y: 400 };
export const BELT = { x0: 70, x1: 560, y: 150 };

export const GRAVITY = 900;
export const MIN_SPEED = 380;
export const MAX_SPEED = 1240;
export const MIN_ANGLE = (15 * Math.PI) / 180;
export const MAX_ANGLE = (80 * Math.PI) / 180;
export const DEFAULT_ANGLE = (50 * Math.PI) / 180;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const speedForPower = (power: number): number => MIN_SPEED + (MAX_SPEED - MIN_SPEED) * clamp(power, 0, 1);
export const clampAngle = (angle: number): number => clamp(angle, MIN_ANGLE, MAX_ANGLE);

/**
 * A drag back from where it began (a slingshot): `pullX` is how far the pointer was pulled left
 * and `pullY` how far down, so pulling left and down throws right and up, harder the further back.
 */
export const MAX_DRAG = 170;
export function aimFromDrag(pullX: number, pullY: number): { angle: number; power: number } {
  return { angle: clampAngle(Math.atan2(pullY, pullX)), power: clamp(Math.hypot(pullX, pullY) / MAX_DRAG, 0, 1) };
}

// --- the schedule --------------------------------------------------------------------------------

/** Seconds between items: 1.9 s at the start, 0.95 s at the end. */
export const spawnInterval = (t: number): number => 1.9 - 0.95 * clamp(t / DURATION_S, 0, 1);
/** Belt speed in px/s: 70 at the start, 150 at the end. */
export const beltSpeed = (t: number): number => 70 + 80 * clamp(t / DURATION_S, 0, 1);

/** When each item enters the belt, in seconds: the same for every round. */
export function spawnTimes(): number[] {
  const times: number[] = [];
  for (let t = 0.4; t < DURATION_S; t += spawnInterval(t)) times.push(t);
  return times;
}
const SPAWN_TIMES = spawnTimes();

/** ×1 for the first 3 in a row, then ×2, ×3 and at 9 or more ×4. */
export const comboMultiplier = (combo: number): number => 1 + Math.min(3, Math.floor(combo / 3));
export const POINTS_PER_ITEM = 10;
export const WRONG_BIN_PENALTY = 1;

/** The most a round can score: every item that enters the belt sorted right, in an unbroken run. */
export function maxSortTossScore(): number {
  let total = 0;
  for (let i = 0; i < SPAWN_TIMES.length; i++) total += POINTS_PER_ITEM * comboMultiplier(i);
  return total;
}

// --- a throw -------------------------------------------------------------------------------------

export type Landing = {
  /** Seconds after the throw that the ball reaches the rim height. */
  time: number;
  /** Where along x it crosses the rim height. */
  x: number;
  /** The bin it drops into, or null for a miss (the floor, a rim or past the bins). */
  bin: BinId | null;
};

/** The point of a throw after `t` seconds. */
export function flightPoint(angle: number, speed: number, t: number): { x: number; y: number } {
  return { x: HAND.x + speed * Math.cos(angle) * t, y: HAND.y - speed * Math.sin(angle) * t + 0.5 * GRAVITY * t * t };
}

/** Where a throw comes down: the later crossing of the rim height, and which bin takes it. */
export function landing(angle: number, speed: number): Landing {
  const vy = -speed * Math.sin(angle);
  const c = HAND.y - BIN_TOP;
  // 0.5 g t² + vy t + c = 0, the descending root.
  const time = (-vy + Math.sqrt(vy * vy - 2 * GRAVITY * c)) / GRAVITY;
  const x = HAND.x + speed * Math.cos(angle) * time;
  const bin = BINS.find((b) => Math.abs(x - b.x) <= BIN_WIDTH / 2 - BALL_RADIUS);
  return { time, x, bin: bin?.id ?? null };
}

/** Dots along the arc for the aiming preview, until it reaches the rim height. */
export function trajectory(angle: number, speed: number, steps = 24): { x: number; y: number }[] {
  const { time } = landing(angle, speed);
  return Array.from({ length: steps + 1 }, (_, i) => flightPoint(angle, speed, (time * i) / steps));
}

// --- the round -----------------------------------------------------------------------------------

export type BeltItem = { id: number; kind: ItemKind; x: number };
export type Flight = { id: number; kind: ItemKind; angle: number; speed: number; elapsed: number; landing: Landing };
export type Outcome = "correct" | "wrong" | "miss";

/** What happened during a step, for the UI's sounds and popups. */
export type SortEvent =
  | { type: "spawn"; item: BeltItem }
  | { type: "dropped"; kind: ItemKind }
  | { type: "thrown"; kind: ItemKind }
  | { type: "landed"; kind: ItemKind; outcome: Outcome; bin: BinId | null; points: number; multiplier: number };

export type RoundState = {
  time: number;
  /** Oldest first: `items[0]` is nearest the end and is the one in hand. */
  items: BeltItem[];
  flights: Flight[];
  nextSpawn: number;
  nextId: number;
  score: number;
  combo: number;
  maxCombo: number;
  correct: number;
  wrong: number;
  /** Items that fell off the belt end or missed every bin. */
  missed: number;
  done: boolean;
  seed: number;
};

export function startRound(seed: number): RoundState {
  return { time: 0, items: [], flights: [], nextSpawn: 0, nextId: 1, score: 0, combo: 0, maxCombo: 0, correct: 0, wrong: 0, missed: 0, done: false, seed };
}

/** The kind of the nth item of a round: the same seed always deals the same items. */
export function kindAt(seed: number, index: number): ItemKind {
  const random: Random = mulberry32(seed ^ Math.imul(index + 1, 0x9e3779b1));
  const total = ITEM_KINDS.reduce((sum, kind) => sum + ITEM_WEIGHT[kind], 0);
  let ticket = random() * total;
  for (const kind of ITEM_KINDS) {
    ticket -= ITEM_WEIGHT[kind];
    if (ticket < 0) return kind;
  }
  return ITEM_KINDS[0];
}

function resolve(state: RoundState, flight: Flight, events: SortEvent[]): RoundState {
  const bin = flight.landing.bin;
  const right = bin !== null && ITEM_BIN[flight.kind] === bin;
  if (right) {
    const multiplier = comboMultiplier(state.combo);
    const points = POINTS_PER_ITEM * multiplier;
    const combo = state.combo + 1;
    events.push({ type: "landed", kind: flight.kind, outcome: "correct", bin, points, multiplier });
    return { ...state, score: state.score + points, combo, maxCombo: Math.max(state.maxCombo, combo), correct: state.correct + 1 };
  }
  if (bin !== null) {
    const points = -Math.min(WRONG_BIN_PENALTY, state.score);
    events.push({ type: "landed", kind: flight.kind, outcome: "wrong", bin, points, multiplier: 1 });
    return { ...state, score: state.score + points, combo: 0, wrong: state.wrong + 1 };
  }
  events.push({ type: "landed", kind: flight.kind, outcome: "miss", bin: null, points: 0, multiplier: 1 });
  return { ...state, combo: 0, missed: state.missed + 1 };
}

/** Advances the round by `dt` seconds: the belt moves, items spawn and fall off, balls land. */
export function stepRound(state: RoundState, dt: number): { state: RoundState; events: SortEvent[] } {
  if (state.done) return { state, events: [] };
  const events: SortEvent[] = [];
  let next: RoundState = { ...state };
  const end = Math.min(DURATION_S, state.time + dt);
  const span = end - state.time;

  // The belt (speed varies slowly, so one step at the middle of the span is plenty).
  const speed = beltSpeed(state.time + span / 2);
  let items = state.items.map((item) => ({ ...item, x: item.x + speed * span }));
  const kept: BeltItem[] = [];
  for (const item of items) {
    if (item.x >= BELT.x1) {
      events.push({ type: "dropped", kind: item.kind });
      next = { ...next, combo: 0, missed: next.missed + 1 };
    } else {
      kept.push(item);
    }
  }
  items = kept;

  while (next.nextSpawn < SPAWN_TIMES.length && SPAWN_TIMES[next.nextSpawn] <= end) {
    const item: BeltItem = { id: next.nextId, kind: kindAt(state.seed, next.nextSpawn), x: BELT.x0 };
    // It enters when its time comes, so carry it for the part of the span after that.
    item.x += beltSpeed(SPAWN_TIMES[next.nextSpawn]) * (end - SPAWN_TIMES[next.nextSpawn]);
    items.push(item);
    events.push({ type: "spawn", item });
    next = { ...next, nextSpawn: next.nextSpawn + 1, nextId: next.nextId + 1 };
  }

  const flying: Flight[] = [];
  for (const flight of state.flights) {
    const advanced = { ...flight, elapsed: flight.elapsed + span };
    if (advanced.elapsed >= flight.landing.time) next = resolve(next, advanced, events);
    else flying.push(advanced);
  }

  next = { ...next, time: end, items, flights: flying };
  if (end >= DURATION_S) next = finishRound(next, events);
  return { state: next, events };
}

/** Ends the round: balls still in the air land at once (a ball thrown in time counts). */
export function finishRound(state: RoundState, events: SortEvent[] = []): RoundState {
  if (state.done) return state;
  let next = state;
  for (const flight of state.flights) next = resolve(next, flight, events);
  return { ...next, flights: [], done: true };
}

/** The item in hand (nearest the belt's end), or null when the belt is empty. */
export const currentItem = (state: RoundState): BeltItem | null => state.items[0] ?? null;

/** Throws the item in hand; nothing happens with an empty belt, a finished round or bad numbers. */
export function throwItem(state: RoundState, angle: number, power: number): { state: RoundState; events: SortEvent[] } {
  const item = currentItem(state);
  if (!item || state.done || !Number.isFinite(angle) || !Number.isFinite(power)) return { state, events: [] };
  const a = clampAngle(angle);
  const speed = speedForPower(power);
  const flight: Flight = { id: item.id, kind: item.kind, angle: a, speed, elapsed: 0, landing: landing(a, speed) };
  return {
    state: { ...state, items: state.items.slice(1), flights: [...state.flights, flight] },
    events: [{ type: "thrown", kind: item.kind }],
  };
}

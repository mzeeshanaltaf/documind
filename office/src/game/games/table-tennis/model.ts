import { mulberry32, type Random } from "@/game/world/city/random";

/**
 * Desk Table Tennis's ball and match model (phase O8 › Desk Table Tennis): a small custom model
 * (bounce, spin from the paddle's sideways speed) rather than a physics engine, so a given seed
 * always plays out the same. Metres; the player stands at x < 0 and the CPU colleague at x > L,
 * `y` runs across the table and `z` is the height above it.
 */
export const TABLE = { length: 2.74, width: 1.525, netHeight: 0.1525 };
export const NET_X = TABLE.length / 2;
export const BALL_RADIUS = 0.02;
export const GRAVITY = 9.81;
/** How much of its height a ball keeps after bouncing. */
export const BOUNCE = 0.88;
/** Sideways acceleration per unit of spin and forward speed. */
export const SPIN_CURVE = 0.35;
export const PADDLE = { half: 0.12, maxSpeed: 5.5 };
/** The planes the paddles hit in, just beyond each end of the table. */
export const PLAYER_PLANE = -0.14;
export const CPU_PLANE = TABLE.length + 0.14;
/** Hits are possible between these heights above the table. */
const HIT_Z = { min: -0.4, max: 0.5 };
export const WIN_POINTS = 7;
export const SERVES_EACH = 2;
const STEP = 1 / 120;

export type Side = "player" | "cpu";
export type Difficulty = 1 | 2 | 3;

export type Ball = { x: number; y: number; z: number; vx: number; vy: number; vz: number; spin: number };
export type Paddle = { y: number; vy: number; target: number };

/** What the CPU colleague is like at each level: how long it takes to react, how far it errs, how fast it moves. */
export const CPU_LEVELS: Record<Difficulty, { react: number; error: number; speed: number; label: string }> = {
  1: { react: 0.34, error: 0.22, speed: 1.5, label: "Easy" },
  2: { react: 0.22, error: 0.12, speed: 2.1, label: "Medium" },
  3: { react: 0.13, error: 0.06, speed: 2.8, label: "Hard" },
};

/** Seconds before the colleague starts moving for a ball: longer the faster the rally (more hits). */
export const cpuReaction = (difficulty: Difficulty, rally: number): number => CPU_LEVELS[difficulty].react * (1 + 0.05 * rally);
/** How far (metres) the colleague's reading of the ball, and its own aim, can be off. */
export const cpuError = (difficulty: Difficulty, rally: number): number => CPU_LEVELS[difficulty].error * (1 + 0.07 * rally);

export type MatchEvent =
  | { type: "serve"; by: Side }
  | { type: "hit"; by: Side }
  | { type: "bounce"; side: "near" | "far" }
  | { type: "net" }
  | { type: "point"; winner: Side; reason: PointReason }
  | { type: "done"; won: boolean };
export type PointReason = "missed" | "out" | "net" | "double-bounce";

export type Match = {
  rng: Random;
  difficulty: Difficulty;
  ball: Ball | null;
  player: Paddle;
  cpu: Paddle & { reactAt: number; aim: number };
  score: Record<Side, number>;
  server: Side;
  servesLeft: number;
  phase: "serve" | "rally" | "point" | "done";
  /** Seconds in the current phase. */
  timer: number;
  time: number;
  /** Hits in the current rally. */
  rally: number;
  lastHitter: Side | null;
  /** Bounces since the last hit, by the half of the table: `near` is the player's. */
  bounces: { near: number; far: number };
  firstBounce: "near" | "far" | null;
  lastPoint: { winner: Side; reason: PointReason } | null;
};

export function createMatch(seed: number, difficulty: Difficulty): Match {
  const rng = mulberry32(seed);
  const server: Side = rng() < 0.5 ? "player" : "cpu";
  const mid = TABLE.width / 2;
  return {
    rng,
    difficulty,
    ball: null,
    player: { y: mid, vy: 0, target: mid },
    cpu: { y: mid, vy: 0, target: mid, reactAt: 0, aim: mid },
    score: { player: 0, cpu: 0 },
    server,
    servesLeft: SERVES_EACH,
    phase: "serve",
    timer: 0,
    time: 0,
    rally: 0,
    lastHitter: null,
    bounces: { near: 0, far: 0 },
    firstBounce: null,
    lastPoint: null,
  };
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const other = (side: Side): Side => (side === "player" ? "cpu" : "player");
/** The paddle's plane and the direction a ball hit from it travels along x. */
const planeOf = (side: Side) => (side === "player" ? PLAYER_PLANE : CPU_PLANE);
const directionOf = (side: Side) => (side === "player" ? 1 : -1);
/** The half of the table a side's opponent defends. */
const halfOf = (side: Side): "near" | "far" => (side === "player" ? "far" : "near");

/** Seconds a returned ball takes to reach the opposite half: shorter as the rally goes on. */
export const flightTime = (rally: number): number => Math.max(0.36, 0.64 - 0.02 * rally);

/**
 * Hits `ball` from `side`: sets its velocity so it comes down at `target` (x, y) on the far half
 * after `time` seconds, lifting it as much as needed to clear the net. The paddle's sideways
 * speed gives the ball spin, which then bends its path.
 */
export function launch(ball: Ball, side: Side, target: { x: number; y: number }, time: number, paddleVy: number): void {
  const spin = clamp(paddleVy / 3, -1, 1);
  for (let attempt = 0, T = time; attempt < 8; attempt++, T += 0.04) {
    const vx = (target.x - ball.x) / T;
    const vz = (0.5 * GRAVITY * T * T - ball.z) / T;
    // Height when it crosses the net.
    const tNet = (NET_X - ball.x) / vx;
    const zNet = ball.z + vz * tNet - 0.5 * GRAVITY * tNet * tNet;
    if (zNet >= TABLE.netHeight + 0.06 || attempt === 7) {
      ball.vx = vx;
      ball.vy = (target.y - ball.y) / T;
      ball.vz = vz;
      ball.spin = spin;
      return;
    }
  }
}

/** One physics step: gravity, spin, the table bounce. Reports table bounces to `onBounce`. */
export function stepBall(ball: Ball, dt: number, onBounce?: (side: "near" | "far") => void): void {
  ball.vy += SPIN_CURVE * ball.spin * Math.abs(ball.vx) * dt;
  ball.vz -= GRAVITY * dt;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  ball.z += ball.vz * dt;
  const onTable = ball.x >= 0 && ball.x <= TABLE.length && ball.y >= 0 && ball.y <= TABLE.width;
  if (onTable && ball.z <= 0 && ball.vz < 0) {
    ball.z = 0;
    ball.vz = -ball.vz * BOUNCE;
    ball.vx *= 0.985;
    ball.spin *= 0.7;
    onBounce?.(ball.x < NET_X ? "near" : "far");
  }
}

/** Where a ball moving towards `plane` would be when it gets there, ignoring paddles. */
export function predictArrival(ball: Ball, plane: number): { y: number; z: number; time: number } | null {
  const copy = { ...ball };
  for (let t = 0; t < 4; t += STEP) {
    stepBall(copy, STEP);
    if ((plane > NET_X && copy.x >= plane) || (plane < NET_X && copy.x <= plane)) return { y: copy.y, z: copy.z, time: t };
    if (copy.z < -2) return null;
  }
  return null;
}

function endPoint(m: Match, winner: Side, reason: PointReason, events: MatchEvent[]): void {
  m.score[winner] += 1;
  m.lastPoint = { winner, reason };
  m.ball = null;
  m.phase = "point";
  m.timer = 0;
  events.push({ type: "point", winner, reason });
  if (m.score[winner] >= WIN_POINTS) {
    m.phase = "done";
    events.push({ type: "done", won: winner === "player" });
  }
}

function beginServe(m: Match): void {
  m.ball = null;
  m.phase = "serve";
  m.timer = 0;
  m.rally = 0;
  m.lastHitter = null;
  m.bounces = { near: 0, far: 0 };
  m.firstBounce = null;
  if (--m.servesLeft <= 0) {
    m.server = other(m.server);
    m.servesLeft = SERVES_EACH;
  }
}

/** Where the hitter sends the ball: the player aims with where on the paddle it meets the ball. */
function aimFor(m: Match, side: Side, ball: Ball): { x: number; y: number } {
  const depth = 0.5 + m.rng() * 0.28;
  const x = side === "player" ? NET_X + depth * (NET_X - 0.1) : NET_X - depth * (NET_X - 0.1);
  const margin = 0.14;
  if (side === "player") {
    const offset = clamp((ball.y - m.player.y) / PADDLE.half, -1, 1);
    return { x, y: clamp(TABLE.width / 2 + offset * (TABLE.width / 2 - margin), margin, TABLE.width - margin) };
  }
  // The colleague plays away from where the player is, with the level's error added.
  const noise = (m.rng() - 0.5) * 2 * cpuError(m.difficulty, m.rally);
  return { x, y: TABLE.width - m.player.y + noise };
}

function hit(m: Match, side: Side, ball: Ball): MatchEvent[] {
  const paddle = side === "player" ? m.player : m.cpu;
  const aim = aimFor(m, side, ball);
  launch(ball, side, aim, flightTime(m.rally), paddle.vy);
  m.rally += 1;
  m.lastHitter = side;
  m.bounces = { near: 0, far: 0 };
  m.firstBounce = null;
  if (side === "player") {
    // The colleague sees the ball late, and a little wrong, more so the faster the rally.
    const arrival = predictArrival(ball, CPU_PLANE);
    const error = (m.rng() - 0.5) * 2 * cpuError(m.difficulty, m.rally);
    m.cpu.aim = clamp((arrival?.y ?? TABLE.width / 2) + error, -0.1, TABLE.width + 0.1);
    m.cpu.reactAt = m.time + cpuReaction(m.difficulty, m.rally);
  }
  return [{ type: "hit", by: side }];
}

function movePaddle(paddle: Paddle, target: number, speed: number, dt: number): void {
  const wanted = clamp(target, -0.12, TABLE.width + 0.12);
  const move = clamp(wanted - paddle.y, -speed * dt, speed * dt);
  paddle.y += move;
  paddle.vy += (move / dt - paddle.vy) * Math.min(1, 12 * dt);
}

export type MatchInput = { targetY: number };

/** Advances the match by `dt` seconds (in fixed sub-steps) and returns what happened. */
export function stepMatch(m: Match, input: MatchInput, dt: number): MatchEvent[] {
  const events: MatchEvent[] = [];
  let left = Math.min(dt, 0.1);
  while (left > 1e-9 && m.phase !== "done") {
    const h = Math.min(STEP, left);
    left -= h;
    m.time += h;
    m.timer += h;
    m.player.target = input.targetY;
    movePaddle(m.player, m.player.target, PADDLE.maxSpeed, h);

    const level = CPU_LEVELS[m.difficulty];
    const receiving = m.phase === "rally" && m.lastHitter === "player" && m.time >= m.cpu.reactAt;
    movePaddle(m.cpu, receiving ? m.cpu.aim : TABLE.width / 2, receiving ? level.speed : level.speed * 0.4, h);

    if (m.phase === "serve") {
      if (m.timer >= 0.9) serve(m, events);
    } else if (m.phase === "rally") {
      rally(m, h, events);
    } else if (m.phase === "point" && m.timer >= 1.2) {
      beginServe(m);
    }
  }
  return events;
}

function serve(m: Match, events: MatchEvent[]): void {
  const side = m.server;
  const paddle = side === "player" ? m.player : m.cpu;
  const ball: Ball = { x: planeOf(side) + directionOf(side) * 0.02, y: paddle.y, z: 0.28, vx: 0, vy: 0, vz: 0, spin: 0 };
  const depth = 0.5 + m.rng() * 0.25;
  const x = side === "player" ? NET_X + depth * (NET_X - 0.1) : NET_X - depth * (NET_X - 0.1);
  const y = 0.25 + m.rng() * (TABLE.width - 0.5);
  launch(ball, side, { x, y }, 0.62, 0);
  m.ball = ball;
  m.phase = "rally";
  m.rally = 1;
  m.lastHitter = side;
  m.bounces = { near: 0, far: 0 };
  m.firstBounce = null;
  if (side === "cpu") m.cpu.reactAt = Infinity;
  else {
    const arrival = predictArrival(ball, CPU_PLANE);
    m.cpu.aim = clamp((arrival?.y ?? TABLE.width / 2) + (m.rng() - 0.5) * 2 * cpuError(m.difficulty, m.rally), -0.1, TABLE.width + 0.1);
    m.cpu.reactAt = m.time + cpuReaction(m.difficulty, m.rally);
  }
  events.push({ type: "serve", by: side });
}

function rally(m: Match, dt: number, events: MatchEvent[]): void {
  const ball = m.ball;
  if (!ball || m.lastHitter === null) return;
  const hitter = m.lastHitter;
  const receiver = other(hitter);
  const before = ball.x;
  stepBall(ball, dt, (side) => {
    m.bounces[side] += 1;
    m.firstBounce ??= side;
    events.push({ type: "bounce", side });
  });

  // The net: crossing its line below its top is a fault by whoever hit.
  if ((before - NET_X) * (ball.x - NET_X) < 0 && ball.z < TABLE.netHeight && ball.z > -0.2) {
    events.push({ type: "net" });
    endPoint(m, receiver, "net", events);
    return;
  }

  // The first bounce must be on the receiver's half.
  if (m.firstBounce !== null && m.firstBounce !== halfOf(hitter)) {
    endPoint(m, receiver, "out", events);
    return;
  }
  // Out: past the far end, or off the side, without ever landing on the table.
  const beyondEnd = hitter === "player" ? ball.x > TABLE.length + 0.02 : ball.x < -0.02;
  if (m.firstBounce === null && (beyondEnd || ball.z < -0.3)) {
    endPoint(m, receiver, "out", events);
    return;
  }
  // Two bounces on the receiver's half before a return.
  if (m.bounces[halfOf(hitter)] >= 2) {
    endPoint(m, hitter, "double-bounce", events);
    return;
  }

  // The receiver's paddle: it can return a ball that has bounced once on its half.
  const plane = planeOf(receiver);
  const crossed = receiver === "player" ? ball.x <= plane : ball.x >= plane;
  if (crossed && m.bounces[halfOf(hitter)] >= 1) {
    const paddle = receiver === "player" ? m.player : m.cpu;
    const reach = PADDLE.half + BALL_RADIUS;
    if (Math.abs(ball.y - paddle.y) <= reach && ball.z >= HIT_Z.min && ball.z <= HIT_Z.max) {
      ball.x = plane;
      events.push(...hit(m, receiver, ball));
      return;
    }
    if (receiver === "player" ? ball.x < plane - 0.35 : ball.x > plane + 0.35) {
      endPoint(m, hitter, "missed", events);
      return;
    }
  }
  if (ball.z < -1.2) endPoint(m, hitter, "missed", events);
}

// --- scoring -------------------------------------------------------------------------------------

export const WIN_BONUS_PER_LEVEL = 20;
export const POINT_VALUE = 10;
/** 10 per point won, plus 20, 40 or 60 for winning at Easy, Medium or Hard. */
export function tableTennisScore(pointsFor: number, won: boolean, difficulty: Difficulty): number {
  return pointsFor * POINT_VALUE + (won ? WIN_BONUS_PER_LEVEL * difficulty : 0);
}
export const MAX_TABLE_TENNIS_SCORE = WIN_POINTS * POINT_VALUE + WIN_BONUS_PER_LEVEL * 3;

// --- the view ------------------------------------------------------------------------------------

/**
 * A fixed camera behind the player's end: table depth (x) runs up the screen, narrowing with
 * distance, and height lifts the ball. Returns canvas coordinates for a 960×540 field and the
 * scale at that depth (for drawing sizes).
 */
export const VIEW = { width: 960, height: 540, nearY: 470, farY: 150, nearHalf: 400, farHalf: 250 };
export function project(x: number, y: number, z: number): { sx: number; sy: number; scale: number } {
  const t = clamp(x / TABLE.length, -0.2, 1.2);
  const half = VIEW.nearHalf + (VIEW.farHalf - VIEW.nearHalf) * t;
  const scale = half / VIEW.nearHalf;
  const sx = VIEW.width / 2 + ((y - TABLE.width / 2) / (TABLE.width / 2)) * half;
  const ground = VIEW.nearY + (VIEW.farY - VIEW.nearY) * t;
  return { sx, sy: ground - z * 260 * scale, scale };
}

/** The table-y under a canvas x at the player's end: `project`'s inverse for the paddle's depth. */
export function unprojectY(sx: number): number {
  const t = clamp(PLAYER_PLANE / TABLE.length, -0.2, 1.2);
  const half = VIEW.nearHalf + (VIEW.farHalf - VIEW.nearHalf) * t;
  return TABLE.width / 2 + ((sx - VIEW.width / 2) / half) * (TABLE.width / 2);
}

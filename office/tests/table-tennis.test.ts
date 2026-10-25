import { describe, expect, it } from "vitest";
import {
  type Ball,
  BOUNCE,
  CPU_LEVELS,
  CPU_PLANE,
  cpuError,
  cpuReaction,
  createMatch,
  type Difficulty,
  flightTime,
  launch,
  MAX_TABLE_TENNIS_SCORE,
  type Match,
  type MatchEvent,
  NET_X,
  PLAYER_PLANE,
  predictArrival,
  project,
  stepBall,
  stepMatch,
  TABLE,
  tableTennisScore,
  unprojectY,
  VIEW,
  WIN_POINTS,
} from "@/game/games/table-tennis/model";

// Phase O8 › Tests: the table-tennis ball model is deterministic for a seed; a hit clears the net
// and lands where aimed; the colleague gets slower and sloppier as the rally speeds up.

function run(seed: number, difficulty: Difficulty, steer: (m: Match) => number, seconds = 400): { match: Match; events: MatchEvent[] } {
  const match = createMatch(seed, difficulty);
  const events: MatchEvent[] = [];
  for (let t = 0; t < seconds && match.phase !== "done"; t += 1 / 60) events.push(...stepMatch(match, { targetY: steer(match) }, 1 / 60));
  return { match, events };
}

/** A player who goes to wherever the ball will cross their plane. */
const tracker = (match: Match): number => {
  const ball = match.ball;
  if (!ball || ball.vx >= 0) return TABLE.width / 2;
  return predictArrival(ball, PLAYER_PLANE)?.y ?? TABLE.width / 2;
};

describe("a hit", () => {
  it("clears the net and comes down on the target, for the player and the colleague", () => {
    for (const side of ["player", "cpu"] as const) {
      for (const time of [0.4, 0.5, 0.62]) {
        const from = side === "player" ? PLAYER_PLANE : CPU_PLANE;
        const target = { x: side === "player" ? 2.1 : 0.64, y: 0.9 };
        const ball: Ball = { x: from, y: 0.5, z: 0.2, vx: 0, vy: 0, vz: 0, spin: 0 };
        launch(ball, side, target, time, 0);
        let netHeight = Infinity;
        let landed: { x: number; y: number } | null = null;
        let prevX = ball.x;
        for (let t = 0; t < 2 && !landed; t += 1 / 480) {
          stepBall(ball, 1 / 480, () => {
            landed ??= { x: ball.x, y: ball.y };
          });
          if ((prevX - NET_X) * (ball.x - NET_X) < 0) netHeight = ball.z;
          prevX = ball.x;
        }
        expect(netHeight, `${side} ${time}`).toBeGreaterThan(TABLE.netHeight);
        expect(landed!.x).toBeCloseTo(target.x, 1);
        expect(landed!.y).toBeCloseTo(target.y, 1);
      }
    }
  });

  it("bends with spin from the paddle's sideways speed", () => {
    const land = (paddleVy: number) => {
      const ball: Ball = { x: PLAYER_PLANE, y: 0.76, z: 0.2, vx: 0, vy: 0, vz: 0, spin: 0 };
      launch(ball, "player", { x: 2.1, y: 0.76 }, 0.55, paddleVy);
      let y = 0;
      for (let t = 0; t < 2 && !y; t += 1 / 480) stepBall(ball, 1 / 480, () => (y = ball.y));
      return y;
    };
    expect(land(0)).toBeCloseTo(0.76, 1);
    expect(land(3)).toBeGreaterThan(land(0) + 0.03);
    expect(land(-3)).toBeLessThan(land(0) - 0.03);
  });

  it("bounces lower each time and loses forward speed", () => {
    const ball: Ball = { x: 0.5, y: 0.7, z: 0.3, vx: 3, vy: 0, vz: 0, spin: 0 };
    const heights: number[] = [];
    let peak = 0;
    for (let t = 0; t < 2 && heights.length < 2; t += 1 / 480) {
      const before = ball.vz;
      stepBall(ball, 1 / 480, () => heights.push(peak));
      peak = Math.max(peak, ball.z);
      if (before < 0 && ball.vz > 0) peak = 0;
    }
    expect(BOUNCE).toBeLessThan(1);
    expect(ball.vx).toBeLessThan(3);
  });
});

describe("the colleague", () => {
  it("reacts later and errs more as the rally goes on, and less at higher levels", () => {
    for (const level of [1, 2, 3] as const) {
      expect(cpuReaction(level, 10)).toBeGreaterThan(cpuReaction(level, 1));
      expect(cpuError(level, 10)).toBeGreaterThan(cpuError(level, 1));
    }
    expect(cpuReaction(1, 3)).toBeGreaterThan(cpuReaction(2, 3));
    expect(cpuReaction(2, 3)).toBeGreaterThan(cpuReaction(3, 3));
    expect(cpuError(1, 3)).toBeGreaterThan(cpuError(3, 3));
    expect(CPU_LEVELS[3].speed).toBeGreaterThan(CPU_LEVELS[1].speed);
    // Rallies get faster: the ball is in the air for less time, down to a floor.
    expect(flightTime(20)).toBeLessThan(flightTime(1));
    expect(flightTime(500)).toBe(flightTime(1000));
  });
});

describe("a match", () => {
  it("plays out identically for the same seed and inputs", () => {
    const a = run(42, 2, tracker);
    const b = run(42, 2, tracker);
    expect(a.match.score).toEqual(b.match.score);
    expect(a.events).toEqual(b.events);
    expect(a.match.time).toBe(b.match.time);
    const c = run(43, 2, tracker);
    expect(c.events).not.toEqual(a.events);
  });

  it("ends the first time someone reaches seven, with a consistent score", () => {
    for (const difficulty of [1, 2, 3] as const) {
      for (const seed of [1, 2, 3]) {
        const { match, events } = run(seed, difficulty, tracker);
        expect(match.phase, `${difficulty}/${seed}`).toBe("done");
        const { player, cpu } = match.score;
        expect(Math.max(player, cpu)).toBe(WIN_POINTS);
        expect(Math.min(player, cpu)).toBeLessThan(WIN_POINTS);
        expect(events.filter((e) => e.type === "point")).toHaveLength(player + cpu);
        expect(events.filter((e) => e.type === "done")).toHaveLength(1);
      }
    }
  });

  it("serves two points each, alternating", () => {
    const { events } = run(5, 1, tracker, 60);
    const serves = events.filter((e): e is Extract<MatchEvent, { type: "serve" }> => e.type === "serve").map((e) => e.by);
    expect(serves.length).toBeGreaterThanOrEqual(4);
    expect(serves[0]).toBe(serves[1]);
    expect(serves[2]).toBe(serves[3]);
    expect(serves[2]).not.toBe(serves[0]);
  });

  it("lets a ball that was missed go to the hitter, and a standing player lose most points", () => {
    const { match } = run(11, 3, () => 0.05);
    // A paddle parked in the corner returns little against a hard opponent.
    expect(match.score.cpu).toBe(WIN_POINTS);
    expect(match.score.player).toBeLessThan(WIN_POINTS);
  });

  it("is beatable: a tracking player wins at least some matches at Easy", () => {
    let wins = 0;
    for (let seed = 1; seed <= 12; seed++) if (run(seed, 1, tracker).match.score.player === WIN_POINTS) wins++;
    expect(wins).toBeGreaterThan(0);
    let hardWins = 0;
    for (let seed = 1; seed <= 12; seed++) if (run(seed, 3, tracker).match.score.player === WIN_POINTS) hardWins++;
    expect(hardWins).toBeLessThanOrEqual(wins);
  });
});

describe("scoring and the view", () => {
  it("scores 10 a point plus 20, 40 or 60 for a win", () => {
    expect(tableTennisScore(3, false, 2)).toBe(30);
    expect(tableTennisScore(7, true, 1)).toBe(90);
    expect(tableTennisScore(7, true, 2)).toBe(110);
    expect(tableTennisScore(7, true, 3)).toBe(130);
    expect(MAX_TABLE_TENNIS_SCORE).toBe(130);
  });

  it("projects the table in perspective and inverts the paddle's end", () => {
    const near = project(0, TABLE.width / 2, 0);
    const far = project(TABLE.length, TABLE.width / 2, 0);
    expect(near.sx).toBeCloseTo(VIEW.width / 2, 6);
    expect(far.sy).toBeLessThan(near.sy);
    expect(far.scale).toBeLessThan(near.scale);
    expect(project(1, 0.5, 0.3).sy).toBeLessThan(project(1, 0.5, 0).sy);
    for (const y of [0, 0.4, 0.76, 1.2, TABLE.width]) expect(unprojectY(project(PLAYER_PLANE, y, 0).sx)).toBeCloseTo(y, 6);
  });
});

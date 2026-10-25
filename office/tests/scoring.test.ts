import { describe, expect, it } from "vitest";
import { inconsistency, SCORE_LIMITS, SORT_TOSS_MAX_SCORE, submitScoreSchema } from "@/game/games/scoring";
import { MAX_TABLE_TENNIS_SCORE } from "@/game/games/table-tennis/model";
import { MAX_TRIVIA_SCORE } from "@/game/games/trivia/round";

// Phase O8 › Tests: what a score submit may contain. The bounds per game, and the details checks.

const trivia = (score: number, patch: Record<string, unknown> = {}) => ({ game: "trivia", score, details: { correct: 7, total: 10, location: "lahore", ...patch } });
const sort = (score: number, patch: Record<string, unknown> = {}) => ({ game: "sort_toss", score, details: { correct: 20, wrong: 3, maxCombo: 12, ...patch } });
const tennis = (score: number, patch: Record<string, unknown> = {}) => ({
  game: "table_tennis",
  score,
  details: { won: true, pointsFor: 7, pointsAgainst: 4, difficulty: 2, ...patch },
});

function check(input: unknown): string | null {
  const parsed = submitScoreSchema.safeParse(input);
  return parsed.success ? inconsistency(parsed.data) : `schema: ${parsed.error.issues[0].path.join(".")}`;
}

describe("score bounds", () => {
  it("states the maximum for each game", () => {
    expect(SCORE_LIMITS).toEqual({ trivia: MAX_TRIVIA_SCORE, sort_toss: SORT_TOSS_MAX_SCORE, table_tennis: MAX_TABLE_TENNIS_SCORE });
    expect(MAX_TRIVIA_SCORE).toBe(1900);
    expect(SORT_TOSS_MAX_SCORE).toBeGreaterThan(1000);
    expect(MAX_TABLE_TENNIS_SCORE).toBe(130);
  });

  it("accepts reachable scores", () => {
    expect(check(trivia(1000))).toBeNull();
    expect(check(trivia(700))).toBeNull();
    expect(check(trivia(1330))).toBeNull();
    expect(check(sort(450))).toBeNull();
    expect(check(sort(0, { correct: 0, wrong: 5, maxCombo: 0 }))).toBeNull();
    expect(check(tennis(110))).toBeNull();
    expect(check(tennis(30, { won: false, pointsFor: 3, pointsAgainst: 7 }))).toBeNull();
  });

  it("rejects a score above the game's maximum", () => {
    expect(check(trivia(MAX_TRIVIA_SCORE + 1, { correct: 10 }))).toMatch(/schema/);
    expect(check(sort(SORT_TOSS_MAX_SCORE + 1))).toMatch(/schema/);
    expect(check(tennis(MAX_TABLE_TENNIS_SCORE + 1))).toMatch(/schema/);
    expect(check(tennis(500))).toMatch(/schema/);
  });

  it("rejects a score its own details can't explain", () => {
    expect(check(trivia(1800))).toMatch(/too high/); // seven answers can't make 1,800
    expect(check(trivia(300))).toMatch(/too low/);
    expect(check(sort(900, { correct: 5, maxCombo: 5 }))).toMatch(/too high/);
    expect(check(sort(100, { correct: 5, maxCombo: 9 }))).toMatch(/combo/);
    expect(check(sort(100, { correct: 100, wrong: 100 }))).toMatch(/schema/);
    expect(check(tennis(100))).toMatch(/match/); // 7 + 7 points won is 110 on Medium
    expect(check(tennis(110, { pointsFor: 6 }))).toMatch(/finished/);
    expect(check(tennis(40, { won: false, pointsFor: 4, pointsAgainst: 5 }))).toMatch(/finished/);
    expect(check(tennis(40, { won: false, pointsFor: 7, pointsAgainst: 7 }))).toMatch(/finished/);
  });

  it("rejects malformed input", () => {
    expect(check({ game: "chess", score: 10, details: {} })).toMatch(/schema/);
    expect(check({ ...trivia(500), extra: 1 })).toMatch(/schema/);
    expect(check(trivia(-1))).toMatch(/schema/);
    expect(check(trivia(500.5))).toMatch(/schema/);
    expect(check(trivia(500, { total: 9 }))).toMatch(/schema/);
    expect(check(trivia(500, { location: "../etc" }))).toMatch(/schema/);
    expect(check(trivia(500, { extra: true }))).toMatch(/schema/);
    expect(check(tennis(110, { difficulty: 4 }))).toMatch(/schema/);
    expect(check({ game: "trivia", score: 500 })).toMatch(/schema/);
    expect(check(null)).toMatch(/schema/);
  });
});

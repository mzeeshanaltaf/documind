import { describe, expect, it } from "vitest";
import bankData from "@/content/orgs/simtora-trivia.json";
import { parseBank, triviaBankSchema, type TriviaQuestion } from "@/game/games/trivia/bank";
import { hasTriviaBank, loadTriviaBank } from "@/game/games/trivia/banks";
import {
  advanceRound,
  answerQuestion,
  answerScore,
  correctCount,
  MAX_QUESTION_SCORE,
  MAX_TRIVIA_SCORE,
  pickRound,
  POINTS_CORRECT,
  QUESTION_MS,
  questionWeight,
  ROUND_SIZE,
  startRound,
  streakBonus,
  timeBonus,
} from "@/game/games/trivia/round";
import { mulberry32 } from "@/game/world/city/random";

// Phase O8 › Tests: the Simtora bank's shape, the round picker, and the scoring and state machine.

/** Simtora's documents and their page counts (read from the PDFs in docs/policies/). */
const PAGES: Record<string, number> = {
  "SIM-HR-001": 78,
  "SIM-HR-002": 43,
  "SIM-HR-101": 32,
  "SIM-HR-102": 32,
  "SIM-HR-103": 37,
  "SIM-HR-104": 34,
  "SIM-HR-105": 32,
  "SIM-IT-001": 87,
  "SIM-FIN-001": 126,
  "SIM-PRC-001": 103,
  "SIM-FAC-001": 96,
  "SIM-CMP-001": 93,
  "SIM-OVR-001": 37,
  "SIM-GLB-001": 46,
};
const bank = parseBank(bankData);

describe("the Simtora trivia bank", () => {
  it("is valid and about 80 or more questions", () => {
    expect(triviaBankSchema.safeParse(bankData).success).toBe(true);
    expect(bank.length).toBeGreaterThanOrEqual(80);
  });

  it("has four unique choices, an answer in range and a known document and page on every question", () => {
    for (const q of bank) {
      expect(new Set(q.choices).size, q.id).toBe(4);
      expect(q.answer, q.id).toBeGreaterThanOrEqual(0);
      expect(q.answer, q.id).toBeLessThan(4);
      expect(PAGES[q.doc_code], `${q.id}: ${q.doc_code}`).toBeDefined();
      expect(q.page, q.id).toBeGreaterThanOrEqual(1);
      expect(q.page, `${q.id} p. ${q.page} of ${q.doc_code}`).toBeLessThanOrEqual(PAGES[q.doc_code]);
      expect(q.explanation.length, q.id).toBeLessThanOrEqual(300);
    }
    expect(new Set(bank.map((q) => q.id)).size).toBe(bank.length);
  });

  it("covers every department and every office", () => {
    const departments = new Set(bank.map((q) => q.department));
    for (const department of ["HR", "IT", "Finance", "Procurement", "Facilities", "Compliance", "International", "Corporate"]) expect(departments.has(department), department).toBe(true);
    const jurisdictions = new Set(bank.map((q) => q.jurisdiction));
    for (const code of ["US", "PK", "DE", "FR", "AU", "GB", "GLOBAL"]) expect(jurisdictions.has(code), code).toBe(true);
    // Each office has enough local questions to be felt in a round of ten.
    for (const code of ["US", "PK", "DE", "FR", "AU", "GB"]) expect(bank.filter((q) => q.jurisdiction === code).length, code).toBeGreaterThanOrEqual(4);
  });

  it("loads for Simtora and is absent for other orgs", async () => {
    expect(hasTriviaBank("simtora")).toBe(true);
    expect(hasTriviaBank("acme")).toBe(false);
    expect(await loadTriviaBank("acme")).toBeNull();
    expect((await loadTriviaBank("simtora"))?.length).toBe(bank.length);
  });

  it("rejects malformed questions", () => {
    const good = bank[0];
    const bad = (patch: Partial<TriviaQuestion>) => triviaBankSchema.safeParse([...bank, { ...good, id: "x", ...patch }]).success;
    expect(bad({})).toBe(true);
    expect(bad({ choices: ["a", "a", "b", "c"] })).toBe(false);
    expect(bad({ choices: ["a", "b", "c"] as unknown as TriviaQuestion["choices"] })).toBe(false);
    expect(bad({ answer: 4 })).toBe(false);
    expect(bad({ page: 0 })).toBe(false);
    expect(bad({ jurisdiction: "Germany" })).toBe(false);
    expect(bad({ id: good.id })).toBe(false);
    expect(triviaBankSchema.safeParse(bank.slice(0, 9)).success).toBe(false);
  });
});

describe("pickRound", () => {
  it("deals ten distinct questions, the same ones for the same seed", () => {
    const round = pickRound(bank, "PK", mulberry32(7));
    expect(round).toHaveLength(ROUND_SIZE);
    expect(new Set(round.map((q) => q.id)).size).toBe(ROUND_SIZE);
    expect(pickRound(bank, "PK", mulberry32(7)).map((q) => q.id)).toEqual(round.map((q) => q.id));
    expect(pickRound(bank, "PK", mulberry32(8)).map((q) => q.id)).not.toEqual(round.map((q) => q.id));
  });

  it("never repeats a question within a round, whatever the seed or country", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const country = [null, "US", "PK", "DE", "FR", "AU", "GB", "JP"][seed % 8];
      const ids = pickRound(bank, country, mulberry32(seed)).map((q) => q.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("weights towards the office's country plus GLOBAL", () => {
    let local = 0;
    let global = 0;
    let foreign = 0;
    const rounds = 400;
    for (let seed = 1; seed <= rounds; seed++) {
      for (const q of pickRound(bank, "DE", mulberry32(seed))) {
        if (q.jurisdiction === "DE") local++;
        else if (q.jurisdiction === "GLOBAL") global++;
        else foreign++;
      }
    }
    const total = rounds * ROUND_SIZE;
    // German questions are ~6 of 94 in the bank, yet turn up several times more often than that.
    const bankShare = bank.filter((q) => q.jurisdiction === "DE").length / bank.length;
    expect(local / total).toBeGreaterThan(bankShare * 3);
    // Other countries' questions are rare; GLOBAL ones carry the round.
    expect(foreign / total).toBeLessThan(0.08);
    expect(global / total).toBeGreaterThan(0.5);
    // And a German round has at least one German question almost every time.
    let withLocal = 0;
    for (let seed = 1; seed <= rounds; seed++) if (pickRound(bank, "DE", mulberry32(seed)).some((q) => q.jurisdiction === "DE")) withLocal++;
    expect(withLocal / rounds).toBeGreaterThan(0.9);
  });

  it("treats every question alike in the Worldwide hub", () => {
    expect(questionWeight({ jurisdiction: "PK" }, null)).toBe(questionWeight({ jurisdiction: "GLOBAL" }, null));
    expect(questionWeight({ jurisdiction: "PK" }, "PK")).toBeGreaterThan(questionWeight({ jurisdiction: "GLOBAL" }, "PK"));
    expect(questionWeight({ jurisdiction: "DE" }, "PK")).toBeLessThan(questionWeight({ jurisdiction: "GLOBAL" }, "PK"));
  });

  it("orders the round from easy to hard", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const difficulties = pickRound(bank, null, mulberry32(seed)).map((q) => q.difficulty);
      expect(difficulties).toEqual([...difficulties].sort((a, b) => a - b));
    }
  });

  it("shuffles the choices without losing the right answer", () => {
    const original = new Map(bank.map((q) => [q.id, q]));
    const places = new Set<number>();
    for (let seed = 1; seed <= 100; seed++) {
      for (const q of pickRound(bank, null, mulberry32(seed))) {
        const source = original.get(q.id)!;
        expect(q.choices[q.answer]).toBe(source.choices[source.answer]);
        expect([...q.choices].sort()).toEqual([...source.choices].sort());
        places.add(q.answer);
      }
    }
    expect(places.size).toBe(4);
  });

  it("copes with a bank smaller than a round", () => {
    expect(pickRound(bank.slice(0, 3), null, mulberry32(1))).toHaveLength(3);
  });
});

describe("scoring", () => {
  it("scores 100 plus a time bonus plus a streak bonus", () => {
    expect(timeBonus(QUESTION_MS)).toBe(50);
    expect(timeBonus(QUESTION_MS / 2)).toBe(25);
    expect(timeBonus(0)).toBe(0);
    expect(timeBonus(-5)).toBe(0);
    expect(timeBonus(QUESTION_MS * 3)).toBe(50);
    expect(streakBonus(1)).toBe(0);
    expect(streakBonus(2)).toBe(10);
    expect(streakBonus(5)).toBe(40);
    expect(streakBonus(9)).toBe(40);
    expect(answerScore(0, 1)).toBe(POINTS_CORRECT);
    expect(answerScore(QUESTION_MS, 5)).toBe(MAX_QUESTION_SCORE);
    expect(MAX_TRIVIA_SCORE).toBe(ROUND_SIZE * MAX_QUESTION_SCORE);
  });

  it("runs a round: answers score, a miss resets the streak, a late answer keeps the streak at zero", () => {
    let state = startRound(pickRound(bank, null, mulberry32(3)));
    expect(state.phase).toBe("asking");
    const right = () => state.questions[state.index].answer;
    const wrong = () => (right() + 1) % 4;

    state = answerQuestion(state, right(), QUESTION_MS);
    expect(state.phase).toBe("reviewing");
    expect(state.score).toBe(150);
    // Answering again while reviewing changes nothing.
    expect(answerQuestion(state, right(), QUESTION_MS)).toBe(state);
    expect(advanceRound(advanceRound(state))).toEqual(advanceRound(state));
    state = advanceRound(state);
    expect(state.phase).toBe("asking");
    expect(state.index).toBe(1);

    state = answerQuestion(state, right(), QUESTION_MS); // streak 2: 100 + 50 + 10
    expect(state.score).toBe(150 + 160);
    state = advanceRound(state);
    state = answerQuestion(state, wrong(), 10_000);
    expect(state.streak).toBe(0);
    expect(state.score).toBe(310);
    state = advanceRound(state);
    state = answerQuestion(state, null, 0); // time ran out
    expect(state.results.at(-1)).toMatchObject({ choice: null, correct: false, points: 0 });
    expect(correctCount(state)).toBe(2);
  });

  it("ends after the last question, at most MAX_TRIVIA_SCORE", () => {
    let state = startRound(pickRound(bank, null, mulberry32(4)));
    while (state.phase !== "done") {
      state = answerQuestion(state, state.questions[state.index].answer, QUESTION_MS);
      state = advanceRound(state);
    }
    expect(state.results).toHaveLength(ROUND_SIZE);
    expect(correctCount(state)).toBe(ROUND_SIZE);
    expect(state.score).toBe(ROUND_SIZE * 100 + ROUND_SIZE * 50 + [0, 10, 20, 30, 40, 40, 40, 40, 40, 40].reduce((a, b) => a + b, 0));
    expect(state.score).toBeLessThanOrEqual(MAX_TRIVIA_SCORE);
  });
});

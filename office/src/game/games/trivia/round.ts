import type { Random } from "@/game/world/city/random";
import type { TriviaQuestion } from "./bank";

/**
 * Policy Trivia's rules as pure functions (phase O8 › Policy Trivia): picking a round, scoring
 * answers, and the round's state machine. The UI only renders `RoundState` and feeds it answers.
 */
export const ROUND_SIZE = 10;
export const QUESTION_SECONDS = 20;
export const QUESTION_MS = QUESTION_SECONDS * 1000;
export const POINTS_CORRECT = 100;
/** Answering instantly earns this on top; it falls to 0 as the 20 s run out. */
export const MAX_TIME_BONUS = 50;
/** Each answer in a row after the first adds this, up to `MAX_STREAK_BONUS`. */
export const STREAK_STEP = 10;
export const MAX_STREAK_BONUS = 40;
/** The most a single question can score, and so the most a round can. */
export const MAX_QUESTION_SCORE = POINTS_CORRECT + MAX_TIME_BONUS + MAX_STREAK_BONUS;
export const MAX_TRIVIA_SCORE = ROUND_SIZE * MAX_QUESTION_SCORE;

/** How much likelier a question for the office's country is than a global one; others stay rare. */
const LOCAL_WEIGHT = 6;
const GLOBAL_WEIGHT = 1;
const FOREIGN_WEIGHT = 0.1;

export const timeBonus = (remainingMs: number): number =>
  Math.round(MAX_TIME_BONUS * Math.min(1, Math.max(0, remainingMs / QUESTION_MS)));

/** `streak` is the number of correct answers in a row including this one. */
export const streakBonus = (streak: number): number => Math.min(MAX_STREAK_BONUS, Math.max(0, streak - 1) * STREAK_STEP);

export function answerScore(remainingMs: number, streak: number): number {
  return POINTS_CORRECT + timeBonus(remainingMs) + streakBonus(streak);
}

/** A question as asked: the choices shuffled, `answer` pointing at the shuffled position. */
export type RoundQuestion = TriviaQuestion;

export function questionWeight(question: Pick<TriviaQuestion, "jurisdiction">, country: string | null): number {
  if (!country) return 1;
  if (question.jurisdiction === country) return LOCAL_WEIGHT;
  return question.jurisdiction === "GLOBAL" ? GLOBAL_WEIGHT : FOREIGN_WEIGHT;
}

function shuffle<T>(items: readonly T[], random: Random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Ten distinct questions, drawn without repeats and weighted towards the office's country plus
 * GLOBAL (`country` null = Worldwide: all equal), then ordered easy to hard with the order inside
 * a difficulty left to chance. Choices are shuffled so the right answer's place varies.
 */
export function pickRound(bank: readonly TriviaQuestion[], country: string | null, random: Random, size = ROUND_SIZE): RoundQuestion[] {
  const pool = [...bank];
  const picked: TriviaQuestion[] = [];
  while (picked.length < Math.min(size, bank.length)) {
    const total = pool.reduce((sum, q) => sum + questionWeight(q, country), 0);
    let ticket = random() * total;
    let index = pool.findIndex((q) => (ticket -= questionWeight(q, country)) < 0);
    if (index === -1) index = pool.length - 1;
    picked.push(pool.splice(index, 1)[0]);
  }
  const ordered = shuffle(picked, random).sort((a, b) => a.difficulty - b.difficulty);
  return ordered.map((q) => {
    const order = shuffle([0, 1, 2, 3], random);
    return { ...q, choices: order.map((i) => q.choices[i]), answer: order.indexOf(q.answer) };
  });
}

export type AnswerResult = {
  questionId: string;
  /** The choice picked, or null when the time ran out. */
  choice: number | null;
  correct: boolean;
  points: number;
  remainingMs: number;
};

export type RoundState = {
  questions: RoundQuestion[];
  /** The question being asked or reviewed. */
  index: number;
  results: AnswerResult[];
  score: number;
  /** Correct answers in a row as of now. */
  streak: number;
  /** `asking`: the clock runs. `reviewing`: the explanation shows. `done`: the round is over. */
  phase: "asking" | "reviewing" | "done";
};

export function startRound(questions: RoundQuestion[]): RoundState {
  return { questions, index: 0, results: [], score: 0, streak: 0, phase: questions.length > 0 ? "asking" : "done" };
}

/** Records an answer (`choice` null = the clock ran out). Ignored unless a question is open. */
export function answerQuestion(state: RoundState, choice: number | null, remainingMs: number): RoundState {
  if (state.phase !== "asking") return state;
  const question = state.questions[state.index];
  const correct = choice !== null && choice === question.answer;
  const streak = correct ? state.streak + 1 : 0;
  const clamped = Math.min(QUESTION_MS, Math.max(0, remainingMs));
  const points = correct ? answerScore(clamped, streak) : 0;
  const result: AnswerResult = { questionId: question.id, choice, correct, points, remainingMs: correct ? clamped : 0 };
  return { ...state, results: [...state.results, result], score: state.score + points, streak, phase: "reviewing" };
}

/** Moves past the explanation to the next question, or ends the round after the last. */
export function advanceRound(state: RoundState): RoundState {
  if (state.phase !== "reviewing") return state;
  const index = state.index + 1;
  return index >= state.questions.length ? { ...state, index, phase: "done" } : { ...state, index, phase: "asking" };
}

export const correctCount = (state: Pick<RoundState, "results">): number => state.results.filter((r) => r.correct).length;

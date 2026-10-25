import { z } from "zod";
import { LOCATION_ID } from "@/lib/locations";
import { maxSortTossScore, POINTS_PER_ITEM, spawnTimes } from "./sort-toss/logic";
import { MAX_TABLE_TENNIS_SCORE, tableTennisScore, WIN_POINTS } from "./table-tennis/model";
import { MAX_QUESTION_SCORE, MAX_TRIVIA_SCORE, POINTS_CORRECT, ROUND_SIZE } from "./trivia/round";
import { GAME_IDS, type GameId } from "./types";

/**
 * What a score submit may contain (phase O8 › Scores & leaderboard): the schema and the per-game
 * bounds. Shared by the `submitScore` Server Action and the tests. The client is trusted for
 * game results (it's a game), but a score must be reachable by the rules: inside the game's
 * maximum, and consistent with its own details.
 */
const ITEMS_PER_ROUND = spawnTimes().length;
export const SORT_TOSS_MAX_SCORE = maxSortTossScore();
/** The highest multiplier an item can earn (see `comboMultiplier`). */
const TOP_MULTIPLIER = 4;

export const SCORE_LIMITS: Record<GameId, number> = {
  trivia: MAX_TRIVIA_SCORE,
  sort_toss: SORT_TOSS_MAX_SCORE,
  table_tennis: MAX_TABLE_TENNIS_SCORE,
};

const count = (max: number) => z.number().int().min(0).max(max);

const triviaDetails = z.object({ correct: count(ROUND_SIZE), total: z.literal(ROUND_SIZE), location: z.string().regex(LOCATION_ID) }).strict();
const sortTossDetails = z.object({ correct: count(ITEMS_PER_ROUND), wrong: count(ITEMS_PER_ROUND), maxCombo: count(ITEMS_PER_ROUND) }).strict();
const tableTennisDetails = z
  .object({ won: z.boolean(), pointsFor: count(WIN_POINTS), pointsAgainst: count(WIN_POINTS), difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]) })
  .strict();

export const submitScoreSchema = z.discriminatedUnion("game", [
  z.object({ game: z.literal("trivia"), score: count(SCORE_LIMITS.trivia), details: triviaDetails }).strict(),
  z.object({ game: z.literal("sort_toss"), score: count(SCORE_LIMITS.sort_toss), details: sortTossDetails }).strict(),
  z.object({ game: z.literal("table_tennis"), score: count(SCORE_LIMITS.table_tennis), details: tableTennisDetails }).strict(),
]);

export type SubmitScoreInput = z.infer<typeof submitScoreSchema>;

/**
 * The rules' cross-checks that a schema can't express: null when the score fits its details,
 * else why not. A trivia answer is worth 100 to 190, an item at most 40, a table tennis result
 * is a fixed formula.
 */
export function inconsistency(input: SubmitScoreInput): string | null {
  switch (input.game) {
    case "trivia": {
      const { correct } = input.details;
      if (input.score < correct * POINTS_CORRECT) return "That score is too low for the answers.";
      if (input.score > correct * MAX_QUESTION_SCORE) return "That score is too high for the answers.";
      return null;
    }
    case "sort_toss": {
      const { correct, wrong, maxCombo } = input.details;
      if (correct + wrong > ITEMS_PER_ROUND) return "More items than a round has.";
      if (maxCombo > correct) return "A combo can't be longer than the correct throws.";
      if (input.score > correct * POINTS_PER_ITEM * TOP_MULTIPLIER) return "That score is too high for the throws.";
      return null;
    }
    case "table_tennis": {
      const { won, pointsFor, pointsAgainst, difficulty } = input.details;
      const finished = won ? pointsFor === WIN_POINTS && pointsAgainst < WIN_POINTS : pointsAgainst === WIN_POINTS && pointsFor < WIN_POINTS;
      if (!finished) return "That isn't a finished match.";
      if (input.score !== tableTennisScore(pointsFor, won, difficulty)) return "That score doesn't match the match.";
      return null;
    }
  }
}

export const isKnownGame = (game: string): game is GameId => (GAME_IDS as readonly string[]).includes(game);

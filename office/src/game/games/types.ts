/**
 * The play area's mini-games (phase O8): ids, names and the score details each one stores in
 * `game_scores.details`. Client-safe, shared by the games and the server actions.
 */
export const GAME_IDS = ["trivia", "sort_toss", "table_tennis"] as const;
export type GameId = (typeof GAME_IDS)[number];

export const GAME_NAMES: Record<GameId, string> = {
  trivia: "Policy Trivia",
  sort_toss: "Sort & Toss",
  table_tennis: "Desk Table Tennis",
};

export const isGameId = (value: unknown): value is GameId => GAME_IDS.includes(value as GameId);

export type TriviaDetails = { correct: number; total: number; location: string };
export type SortTossDetails = { correct: number; wrong: number; maxCombo: number };
export type TableTennisDetails = { won: boolean; pointsFor: number; pointsAgainst: number; difficulty: 1 | 2 | 3 };

export type GameDetails = {
  trivia: TriviaDetails;
  sort_toss: SortTossDetails;
  table_tennis: TableTennisDetails;
};

/** What a finished game hands to the result card: the score to submit and its details. */
export type GameOutcome<G extends GameId = GameId> = { game: G; score: number; details: GameDetails[G] };

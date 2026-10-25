import "server-only";
import { type GameId, GAME_IDS } from "@/game/games/types";
import type { SubmitScoreInput } from "@/game/games/scoring";
import { SCORE_WINDOW_SECONDS } from "./rate-limit";
import { query } from "./office-db";

/**
 * Scores and leaderboards on `{office}.game_scores` (phase O8). The queries here never check
 * access: the Server Actions in `app/(game)/actions.ts` do, then call these.
 */
export type Period = "week" | "all";
export const PERIODS: readonly Period[] = ["week", "all"];
export const LEADERBOARD_SIZE = 10;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type LeaderboardEntry = {
  rank: number;
  /** `players.display_name`: first name plus last initial. */
  name: string;
  score: number;
  /** ISO time of that best score. */
  at: string;
  /** The viewer's own row (the DOM board highlights it). */
  mine: boolean;
};
export type Leaderboards = Record<GameId, LeaderboardEntry[]>;

/**
 * Whose scores count: the org's current members and platform admins (who may play without being
 * members), and never a player who hides themselves. `g` is a `game_scores` row, `p` its player.
 */
const ELIGIBLE = `
  coalesce((p.settings ->> 'hide_from_leaderboard')::boolean, false) = false
  and (exists (select 1 from member m where m."organizationId" = g.org_id and m."userId" = g.user_id)
       or exists (select 1 from "user" u where u.id = g.user_id and u.role = 'admin'))`;

export const periodStart = (period: Period, now = Date.now()): Date | null => (period === "week" ? new Date(now - WEEK_MS) : null);

type Row = { game: GameId; name: string; score: number; created_at: Date; mine: boolean; rank: string | number };

/** The best score per player (top ten) for each of `games` in an org, newest-first on ties. */
export async function topScores(orgId: string, viewerId: string, period: Period, games: readonly GameId[] = GAME_IDS): Promise<Leaderboards> {
  const rows = await query<Row>(
    `select game, name, score, created_at, mine, rank
       from (
         select best.*, row_number() over (partition by best.game order by best.score desc, best.created_at asc) as rank
           from (
             select distinct on (g.game, g.user_id)
                    g.game, p.display_name as name, g.score, g.created_at, (g.user_id = $4) as mine
               from {office}.game_scores g
               join {office}.players p on p.user_id = g.user_id
              where g.org_id = $1
                and g.game = any($2::text[])
                and ($3::timestamptz is null or g.created_at >= $3)
                and ${ELIGIBLE}
              order by g.game, g.user_id, g.score desc, g.created_at asc
           ) best
       ) ranked
      where rank <= ${LEADERBOARD_SIZE}
      order by game, rank`,
    [orgId, [...games], periodStart(period), viewerId],
  );
  const boards = Object.fromEntries(GAME_IDS.map((game) => [game, [] as LeaderboardEntry[]])) as Leaderboards;
  for (const row of rows) {
    boards[row.game].push({ rank: Number(row.rank), name: row.name, score: row.score, at: row.created_at.toISOString(), mine: row.mine });
  }
  return boards;
}

export type RecordResult = { ok: true; rank: number; personalBest: boolean } | { ok: false; retryAfterSeconds: number };

/**
 * Stores a score and returns its rank among the org's eligible players (by each one's best, all
 * time). Refuses a submit within `SCORE_WINDOW_SECONDS` of the player's last one: the database
 * backs up the Upstash limit, which fails open.
 */
export async function recordScore(userId: string, orgId: string, input: SubmitScoreInput): Promise<RecordResult> {
  const recent = await query<{ seconds: number }>(
    `select extract(epoch from (now() - max(created_at)))::float8 as seconds from {office}.game_scores where user_id = $1`,
    [userId],
  );
  const since = recent[0]?.seconds;
  if (since !== null && since !== undefined && since < SCORE_WINDOW_SECONDS) {
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(SCORE_WINDOW_SECONDS - since)) };
  }
  const rows = await query<{ rank: string | number; previous_best: number }>(
    `with prev as (
       select coalesce(max(score), -1) as best from {office}.game_scores where user_id = $1 and org_id = $2 and game = $3
     ), ins as (
       insert into {office}.game_scores (user_id, org_id, game, score, details)
       values ($1, $2, $3, $4::int, $5::jsonb)
       returning id
     )
     select (select best from prev) as previous_best,
            1 + (select count(*) from (
                   select g.user_id, max(g.score) as best
                     from {office}.game_scores g
                     join {office}.players p on p.user_id = g.user_id
                    where g.org_id = $2 and g.game = $3 and g.user_id <> $1 and ${ELIGIBLE}
                    group by g.user_id
                 ) others
                  where others.best > greatest($4::int, (select best from prev))) as rank
       from ins`,
    [userId, orgId, input.game, input.score, JSON.stringify(input.details)],
  );
  const row = rows[0];
  return { ok: true, rank: Number(row.rank), personalBest: input.score > row.previous_best };
}

"use server";

import { z } from "zod";
import { inconsistency, type SubmitScoreInput, submitScoreSchema } from "@/game/games/scoring";
import { GAME_IDS, type GameId } from "@/game/games/types";
import { apiJson } from "@/lib/api";
import type { DocumentList } from "@/lib/api-types";
import { requireOrgAccess, requireSession } from "@/lib/auth-guards";
import { orderDepartments, roomDepartments } from "@/lib/departments";
import { type LeaderboardEntry, type Leaderboards, PERIODS, type Period, recordScore, topScores } from "@/lib/leaderboard";
import { LOCATION_ID } from "@/lib/locations";
import { query } from "@/lib/office-db";
import { defaultDisplayName, type Player, type SavePlayerInput, savePlayerSchema } from "@/lib/player";
import { limitScore } from "@/lib/rate-limit";

type PlayerRow = {
  user_id: string;
  display_name: string;
  avatar: Player["avatar"];
  settings: Player["settings"];
  updated_at: Date;
};

function toPlayer(row: PlayerRow): Player {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    avatar: row.avatar,
    settings: row.settings,
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * The signed-in user's player profile, created on first read. One round trip: the insert is a
 * no-op for an existing row, and the select then returns it (a statement can't see its own
 * insert, hence the union with `ins`).
 */
export async function getPlayer(): Promise<Player> {
  const { user } = await requireSession();
  const rows = await query<PlayerRow>(
    `with ins as (
       insert into {office}.players (user_id, display_name)
       values ($1, $2)
       on conflict (user_id) do nothing
       returning user_id, display_name, avatar, settings, updated_at
     )
     select * from ins
     union all
     select user_id, display_name, avatar, settings, updated_at from {office}.players where user_id = $1
     limit 1`,
    [user.id, defaultDisplayName(user.name, user.email)],
  );
  return toPlayer(rows[0]);
}

export type SavePlayerResult = { ok: true; player: Player } | { ok: false; error: string };

/**
 * Saves avatar and/or settings. Each object is merged into the stored one (top-level keys), so
 * a settings save never drops the avatar or other settings.
 */
export async function savePlayer(input: SavePlayerInput): Promise<SavePlayerResult> {
  const { user } = await requireSession();
  const parsed = savePlayerSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `${issue.path.join(".") || "input"}: ${issue.message}` };
  }
  const rows = await query<PlayerRow>(
    `insert into {office}.players as p (user_id, display_name, avatar, settings)
     values ($1, $2, $3::jsonb, $4::jsonb)
     on conflict (user_id) do update
       set avatar = p.avatar || excluded.avatar,
           settings = p.settings || excluded.settings,
           updated_at = now()
     returning user_id, display_name, avatar, settings, updated_at`,
    [
      user.id,
      defaultDisplayName(user.name, user.email),
      JSON.stringify(parsed.data.avatar ?? {}),
      JSON.stringify(parsed.data.settings ?? {}),
    ],
  );
  return { ok: true, player: toPlayer(rows[0]) };
}

/**
 * Called when a location page opens: adds the location to `progress.stats.cities_visited` (a
 * set, kept in first-visit order) and remembers it as the last choice (`players.settings`
 * `last_org`/`last_location`, the home's "Resume in …"). One round trip. The page has already
 * checked that the location exists; here the id only has to look like one, since a made-up id
 * could only touch the caller's own progress.
 */
export async function recordVisit(orgId: string, locationId: string): Promise<{ ok: boolean }> {
  const { user } = await requireOrgAccess(orgId);
  if (typeof locationId !== "string" || !LOCATION_ID.test(locationId)) return { ok: false };
  await query(
    `with visit as (
       insert into {office}.progress as p (user_id, org_id, stats)
       values ($1, $2, jsonb_build_object('cities_visited', jsonb_build_array($3::text)))
       on conflict (user_id, org_id) do update
         set stats = p.stats || jsonb_build_object(
               'cities_visited',
               case when coalesce(p.stats -> 'cities_visited', '[]'::jsonb) ? $3::text
                    then p.stats -> 'cities_visited'
                    else coalesce(p.stats -> 'cities_visited', '[]'::jsonb) || jsonb_build_array($3::text)
               end),
             updated_at = now()
       returning 1
     )
     update {office}.players
        set settings = settings || jsonb_build_object('last_org', $2::text, 'last_location', $3::text),
            updated_at = now()
      where user_id = $1`,
    [user.id, orgId, locationId],
  );
  return { ok: true };
}

/** `{location}/{room}`: `lahore/dept:HR`, `worldwide/lobby`. */
const ROOM_VISIT = /^[a-z0-9-]{1,40}\/[^/\s][^/]{0,80}$/;
const statsSchema = z.object({
  rooms_visited: z.array(z.string().regex(ROOM_VISIT)).max(50).default([]),
  citations_opened: z.number().int().min(0).max(100).default(0),
});
export type StatsPatch = z.input<typeof statsSchema>;

/**
 * Game stats, batched by the client (phase O6 › Room visits; O9 adds quests): rooms visited
 * merge into `progress.stats.rooms_visited` (a set, kept in first-visit order) and
 * `citations_opened` is added to the counter. Counters never go down. The client is trusted for
 * game progress (it's a game); the values are only bounded.
 */
export async function recordStats(orgId: string, patch: StatsPatch): Promise<{ ok: boolean }> {
  const { user } = await requireOrgAccess(orgId);
  const parsed = statsSchema.safeParse(patch);
  if (!parsed.success) return { ok: false };
  const { rooms_visited: rooms, citations_opened: citations } = parsed.data;
  if (rooms.length === 0 && citations === 0) return { ok: true };
  await query(
    `insert into {office}.progress as p (user_id, org_id, stats)
     values ($1, $2, jsonb_build_object('rooms_visited', $3::jsonb, 'citations_opened', $4::int))
     on conflict (user_id, org_id) do update
       set stats = p.stats || jsonb_build_object(
             'rooms_visited',
             (select coalesce(jsonb_agg(room order by first), '[]'::jsonb)
                from (select room, min(ord) as first
                        from (select value as room, ordinality as ord
                                from jsonb_array_elements(coalesce(p.stats -> 'rooms_visited', '[]'::jsonb)) with ordinality
                              union all
                              select value, 1000000 + ordinality
                                from jsonb_array_elements($3::jsonb) with ordinality) as visits
                       group by room) as rooms),
             'citations_opened', coalesce((p.stats ->> 'citations_opened')::int, 0) + $4::int),
           updated_at = now()`,
    [user.id, orgId, JSON.stringify([...new Set(rooms)]), citations],
  );
  return { ok: true };
}

/**
 * The access cards the user holds for an org (`progress.cards`), in room order. Called by the
 * location page, which has already checked access (the cached guard makes this check free).
 */
export async function getCards(orgId: string): Promise<string[]> {
  const { user } = await requireOrgAccess(orgId);
  const rows = await query<{ cards: string[] }>(`select cards from {office}.progress where user_id = $1 and org_id = $2`, [
    user.id,
    orgId,
  ]);
  return orderDepartments(rows[0]?.cards ?? []);
}

export type IssueCardsResult = { ok: true; cards: string[] } | { ok: false; error: string };

const departmentsSchema = z.array(z.string().trim().min(1).max(80)).min(1).max(50);

/**
 * Reception prints access cards (phase O5 › Reception): the names must be departments that have
 * a room in this org (from its searchable documents), and they merge into `progress.cards`, so
 * asking twice changes nothing. Returns every card held, in room order.
 */
export async function issueCards(orgId: string, departments: string[]): Promise<IssueCardsResult> {
  const { user } = await requireOrgAccess(orgId);
  const parsed = departmentsSchema.safeParse(departments);
  if (!parsed.success) return { ok: false, error: "Pick at least one card." };

  const { documents } = await apiJson<DocumentList>(`orgs/${orgId}/documents`, { userId: user.id });
  const rooms = new Set(roomDepartments(documents));
  const unknown = parsed.data.filter((department) => !rooms.has(department));
  if (unknown.length > 0) return { ok: false, error: `There's no ${unknown.join(", ")} room in this office.` };

  const rows = await query<{ cards: string[] }>(
    `insert into {office}.progress as p (user_id, org_id, cards)
     values ($1, $2, $3::text[])
     on conflict (user_id, org_id) do update
       set cards = array(select distinct c from unnest(p.cards || excluded.cards) as c order by c),
           updated_at = now()
     returning cards`,
    [user.id, orgId, [...new Set(parsed.data)]],
  );
  return { ok: true, cards: orderDepartments(rows[0].cards) };
}

export type SubmitScoreResult =
  | { ok: true; rank: number; personalBest: boolean }
  | { ok: false; error: string; retryAfterSeconds?: number };

/**
 * Stores a finished game's score (phase O8 › Scores & leaderboard) and returns its rank. In
 * order: org access, the schema (a known game, a score inside its bounds, the right details), the
 * rules' cross-checks, then at most one submit per 10 seconds per user (Upstash, backed by the
 * database). The client is trusted for results; this keeps them reachable.
 */
export async function submitScore(input: { orgId: string } & SubmitScoreInput): Promise<SubmitScoreResult> {
  const orgId = (input as { orgId?: unknown } | null)?.orgId;
  if (typeof orgId !== "string" || orgId.length === 0 || orgId.length > 64) return { ok: false, error: "Missing organization." };
  const { user } = await requireOrgAccess(orgId);

  const rest: Record<string, unknown> = { ...input };
  delete rest.orgId;
  const parsed = submitScoreSchema.safeParse(rest);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `${issue.path.join(".") || "score"}: ${issue.message}` };
  }
  const problem = inconsistency(parsed.data);
  if (problem) return { ok: false, error: problem };

  const limit = await limitScore(user.id);
  if (!limit.ok) return { ok: false, error: "You're submitting scores too fast.", retryAfterSeconds: limit.retryAfterSeconds };
  const recorded = await recordScore(user.id, orgId, parsed.data);
  if (!recorded.ok) return { ok: false, error: "You're submitting scores too fast.", retryAfterSeconds: recorded.retryAfterSeconds };
  return { ok: true, rank: recorded.rank, personalBest: recorded.personalBest };
}

const leaderboardSchema = z.object({ orgId: z.string().min(1).max(64), game: z.enum(GAME_IDS), period: z.enum(PERIODS as [Period, ...Period[]]) }).strict();
const leaderboardsSchema = leaderboardSchema.omit({ game: true });

/**
 * The org's top ten for one game: each player's best score, week (the last 7 days) or all time.
 * Names are the players' display names; players who hide themselves are left out. Members of the
 * org (and platform admins) only.
 */
export async function getLeaderboard(input: { orgId: string; game: GameId; period: Period }): Promise<LeaderboardEntry[]> {
  const parsed = leaderboardSchema.safeParse(input);
  if (!parsed.success) return [];
  const { user } = await requireOrgAccess(parsed.data.orgId);
  const boards = await topScores(parsed.data.orgId, user.id, parsed.data.period, [parsed.data.game]);
  return boards[parsed.data.game];
}

/** All three games' boards in one round trip (the leaderboard wall and the full-screen board). */
export async function getLeaderboards(input: { orgId: string; period: Period }): Promise<Leaderboards | null> {
  const parsed = leaderboardsSchema.safeParse(input);
  if (!parsed.success) return null;
  const { user } = await requireOrgAccess(parsed.data.orgId);
  return topScores(parsed.data.orgId, user.id, parsed.data.period);
}

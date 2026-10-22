"use server";

import { z } from "zod";
import { apiJson } from "@/lib/api";
import type { DocumentList } from "@/lib/api-types";
import { requireOrgAccess, requireSession } from "@/lib/auth-guards";
import { orderDepartments, roomDepartments } from "@/lib/departments";
import { LOCATION_ID } from "@/lib/locations";
import { query } from "@/lib/office-db";
import { defaultDisplayName, type Player, type SavePlayerInput, savePlayerSchema } from "@/lib/player";

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

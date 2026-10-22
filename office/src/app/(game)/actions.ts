"use server";

import { requireSession } from "@/lib/auth-guards";
import { query } from "@/lib/office-db";
import { defaultDisplayName, type Player, type SavePlayerInput, savePlayerSchema } from "@/lib/player";

type PlayerRow = { user_id: string; display_name: string; avatar: Player["avatar"]; settings: Player["settings"] };

function toPlayer(row: PlayerRow): Player {
  return { userId: row.user_id, displayName: row.display_name, avatar: row.avatar, settings: row.settings };
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
       returning user_id, display_name, avatar, settings
     )
     select * from ins
     union all
     select user_id, display_name, avatar, settings from {office}.players where user_id = $1
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
     returning user_id, display_name, avatar, settings`,
    [
      user.id,
      defaultDisplayName(user.name, user.email),
      JSON.stringify(parsed.data.avatar ?? {}),
      JSON.stringify(parsed.data.settings ?? {}),
    ],
  );
  return { ok: true, player: toPlayer(rows[0]) };
}

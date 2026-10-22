import { z } from "zod";

/** The office's player profile (`{office}.players`): rules and schemas. Client-safe. */

const colour = z.string().regex(/^#[0-9a-f]{6}$/i, "Use a #rrggbb colour.");

/** Avatar material colours (O2's editor). Every key is optional; saves merge into the row. */
export const avatarSchema = z
  .object({
    skin: colour,
    hair: colour,
    top: colour,
    bottom: colour,
    shoes: colour,
    badge: colour,
  })
  .partial()
  .strict();

export const QUALITY_TIERS = ["auto", "low", "medium", "high"] as const;

export const settingsSchema = z
  .object({
    quality: z.enum(QUALITY_TIERS),
    sound_volume: z.number().min(0).max(1),
    music_volume: z.number().min(0).max(1),
    /** null follows the OS's `prefers-reduced-motion`. */
    reduced_motion: z.boolean().nullable(),
    show_name_tags: z.boolean(),
    hide_from_leaderboard: z.boolean(),
    /** The last org id and location id chosen ("Resume in Lahore"). */
    last_org: z.string().min(1).max(64),
    last_location: z.string().regex(/^[a-z0-9-]{1,40}$/),
  })
  .partial()
  .strict();

export const savePlayerSchema = z
  .object({ avatar: avatarSchema.optional(), settings: settingsSchema.optional() })
  .strict();

export type Avatar = z.infer<typeof avatarSchema>;
export type PlayerSettings = z.infer<typeof settingsSchema>;
export type SavePlayerInput = z.infer<typeof savePlayerSchema>;

export type Player = {
  userId: string;
  displayName: string;
  avatar: Avatar;
  settings: PlayerSettings;
  /** ISO time of the last save; decides whether this device's settings mirror is newer. */
  updatedAt: string;
};

const DISPLAY_NAME_MAX = 40;

/**
 * The leaderboard name: first name plus last initial ("Zeeshan Altaf" → "Zeeshan A."). A single
 * name stays as it is; no name falls back to the email's local part, then "Player".
 */
export function defaultDisplayName(name: string | null | undefined, email?: string | null): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  let result: string;
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    result = `${parts[0]} ${last[0].toLocaleUpperCase()}.`;
  } else if (parts.length === 1) {
    result = parts[0];
  } else {
    result = (email ?? "").split("@")[0].trim() || "Player";
  }
  return result.slice(0, DISPLAY_NAME_MAX);
}

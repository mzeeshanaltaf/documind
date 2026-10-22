import { type PlayerSettings, QUALITY_TIERS, settingsSchema } from "@/lib/player";

/** Player settings with defaults filled in, plus the localStorage mirror used for instant boot. */
export type QualitySetting = (typeof QUALITY_TIERS)[number];

export type Settings = {
  quality: QualitySetting;
  sound_volume: number;
  music_volume: number;
  /** null follows the OS's `prefers-reduced-motion`. */
  reduced_motion: boolean | null;
  show_name_tags: boolean;
  hide_from_leaderboard: boolean;
  last_org?: string;
  last_location?: string;
};

export const DEFAULT_SETTINGS: Settings = {
  quality: "auto",
  sound_volume: 0.7,
  music_volume: 0.4,
  reduced_motion: null,
  show_name_tags: true,
  hide_from_leaderboard: false,
};

/**
 * Fills in defaults. Stored settings are validated key by key, so one bad value (an old row, a
 * hand-edited mirror) falls back to its default instead of discarding everything.
 */
export function resolveSettings(stored: unknown): Settings {
  const result: Settings = { ...DEFAULT_SETTINGS };
  if (!stored || typeof stored !== "object") return result;
  for (const [key, value] of Object.entries(stored)) {
    const parsed = settingsSchema.safeParse({ [key]: value });
    if (parsed.success) Object.assign(result, parsed.data);
  }
  return result;
}

export const SETTINGS_MIRROR_KEY = "documind-office:settings:v1";

export type SettingsMirror = { settings: PlayerSettings; at: number };

export function parseMirror(raw: string | null | undefined): SettingsMirror | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object") return null;
    const { settings, at } = value as { settings?: unknown; at?: unknown };
    if (typeof at !== "number" || !Number.isFinite(at) || !settings || typeof settings !== "object") return null;
    return { settings: settings as PlayerSettings, at };
  } catch {
    return null;
  }
}

/**
 * The settings to boot with. The DB row is the source of truth across devices; this device's
 * mirror wins only when it was written after the row was last saved (a change made just before a
 * reload, while the debounced save was still pending).
 */
export function bootSettings(
  server: PlayerSettings,
  serverUpdatedAt: string | null,
  mirror: SettingsMirror | null,
): Settings {
  const serverAt = serverUpdatedAt ? Date.parse(serverUpdatedAt) : 0;
  if (mirror && mirror.at > serverAt) return resolveSettings({ ...server, ...mirror.settings });
  return resolveSettings(server);
}

/** The keys whose values differ between two settings objects (what a save has to send). */
export function changedSettings(next: Settings, previous: Settings): Partial<Settings> {
  const changed: Partial<Settings> = {};
  for (const key of Object.keys(next) as (keyof Settings)[]) {
    if (next[key] !== previous[key]) Object.assign(changed, { [key]: next[key] });
  }
  return changed;
}

/** Reduced motion in effect: the explicit setting, else the OS preference. */
export function reducedMotion(setting: boolean | null, osPrefersReduced: boolean): boolean {
  return setting ?? osPrefersReduced;
}

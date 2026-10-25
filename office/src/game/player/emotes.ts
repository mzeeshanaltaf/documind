/**
 * The emote wheel's gestures (phase O8 › Ambient activities): hold Q (or tap the HUD button),
 * pick one, and the avatar plays that clip until it ends or the player moves.
 */
export const EMOTES = [
  { id: "wave", label: "Wave", clip: "wave", seconds: 2.8 },
  { id: "cheer", label: "Cheer", clip: "cheer", seconds: 2.4 },
  { id: "dance", label: "Dance", clip: "dance", seconds: 4.8 },
] as const;

export type EmoteId = (typeof EMOTES)[number]["id"];
export type EmoteClip = (typeof EMOTES)[number]["clip"];

/** The emote playing now: its clip and when (`performance.now()`) it ends. */
export type ActiveEmote = { id: EmoteId; clip: EmoteClip; until: number };

export const emoteById = (id: EmoteId) => EMOTES.find((emote) => emote.id === id)!;

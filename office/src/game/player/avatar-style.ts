import { type Avatar, avatarSchema } from "@/lib/player";

/**
 * Avatar colours (`players.avatar`). These are the player's own choices, game content rather
 * than UI colour, so they are plain sRGB hex like every three.js material colour.
 */
export type AvatarSlot = "skin" | "hair" | "top" | "bottom" | "shoes" | "badge";
export type AvatarColors = Record<AvatarSlot, string>;

export const AVATAR_SLOTS: { slot: AvatarSlot; label: string }[] = [
  { slot: "skin", label: "Skin" },
  { slot: "hair", label: "Hair" },
  { slot: "top", label: "Top" },
  { slot: "bottom", label: "Trousers" },
  { slot: "shoes", label: "Shoes" },
  { slot: "badge", label: "Badge" },
];

export const DEFAULT_AVATAR: AvatarColors = {
  skin: "#c68a5e",
  hair: "#2f241d",
  top: "#2f6f5e",
  bottom: "#3a4048",
  shoes: "#26292c",
  badge: "#e7c74a",
};

/** Swatches per slot; any other colour can still be picked with the custom input. */
export const AVATAR_PRESETS: Record<AvatarSlot, { name: string; hex: string }[]> = {
  skin: [
    { name: "Porcelain", hex: "#f3d5c0" },
    { name: "Sand", hex: "#e2b48f" },
    { name: "Honey", hex: "#c68a5e" },
    { name: "Bronze", hex: "#a46a43" },
    { name: "Umber", hex: "#7a4a2c" },
    { name: "Ebony", hex: "#4b2e1e" },
  ],
  hair: [
    { name: "Black", hex: "#1d1a19" },
    { name: "Dark brown", hex: "#2f241d" },
    { name: "Chestnut", hex: "#6b3f22" },
    { name: "Auburn", hex: "#8f3b1f" },
    { name: "Blond", hex: "#d1a65a" },
    { name: "Grey", hex: "#a7a7a2" },
  ],
  top: [
    { name: "Ledger green", hex: "#2f6f5e" },
    { name: "Navy", hex: "#2c3e63" },
    { name: "Brick", hex: "#9c4535" },
    { name: "Mustard", hex: "#c99a2e" },
    { name: "Plum", hex: "#5e3a5c" },
    { name: "Oat", hex: "#d9cfbd" },
  ],
  bottom: [
    { name: "Charcoal", hex: "#3a4048" },
    { name: "Denim", hex: "#3d5a80" },
    { name: "Khaki", hex: "#a39071" },
    { name: "Olive", hex: "#59603e" },
    { name: "Black", hex: "#222326" },
    { name: "Stone", hex: "#bdb6a8" },
  ],
  shoes: [
    { name: "Black", hex: "#26292c" },
    { name: "Brown", hex: "#5a3a26" },
    { name: "White", hex: "#e8e6e1" },
    { name: "Red", hex: "#b23a2e" },
    { name: "Teal", hex: "#2f7a78" },
  ],
  badge: [
    { name: "Gold", hex: "#e7c74a" },
    { name: "Silver", hex: "#c9ccd1" },
    { name: "Green", hex: "#4f9d7a" },
    { name: "Blue", hex: "#4f7fbd" },
    { name: "Coral", hex: "#e07a5f" },
  ],
};

/** Stored colours over the defaults; an invalid stored value keeps its default. */
export function resolveAvatar(stored: Avatar | null | undefined): AvatarColors {
  const parsed = avatarSchema.safeParse(stored ?? {});
  const colours = parsed.success ? parsed.data : {};
  return { ...DEFAULT_AVATAR, ...Object.fromEntries(Object.entries(colours).map(([k, v]) => [k, v.toLowerCase()])) };
}

/** True until the player has saved a look once: the editor opens on first entry. */
export function isFirstLook(stored: Avatar | null | undefined): boolean {
  return !stored || Object.keys(stored).length === 0;
}

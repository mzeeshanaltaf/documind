import type { QualitySetting } from "@/game/settings";

/** Rendering quality tiers (phase O2 › quality.ts). The settings' `quality` overrides `auto`. */
export const TIER_ORDER = ["low", "medium", "high"] as const;
export type Tier = (typeof TIER_ORDER)[number];

export type TierConfig = {
  /** Device-pixel-ratio cap; the canvas uses min(devicePixelRatio, dpr). */
  dpr: number;
  shadows: boolean;
  /** Directional-light shadow map size (0 when shadows are off). */
  shadowMap: number;
  maxNpcs: number;
  /** Subtle post-processing (bloom + vignette), a lazy chunk. */
  post: boolean;
  /** Fixed when the WebGL context is created; a live tier change keeps the first value. */
  antialias: boolean;
  nameTags: boolean;
};

export const TIERS: Record<Tier, TierConfig> = {
  low: { dpr: 1, shadows: false, shadowMap: 0, maxNpcs: 6, post: false, antialias: false, nameTags: false },
  medium: { dpr: 1.5, shadows: true, shadowMap: 1024, maxNpcs: 12, post: false, antialias: true, nameTags: true },
  high: { dpr: 2, shadows: true, shadowMap: 2048, maxNpcs: 24, post: true, antialias: true, nameTags: true },
};

/** One step up (+1) or down (-1), clamped to the ends. */
export function stepTier(tier: Tier, direction: 1 | -1): Tier {
  const index = TIER_ORDER.indexOf(tier) + direction;
  return TIER_ORDER[Math.min(TIER_ORDER.length - 1, Math.max(0, index))];
}

/** The tier in effect: the player's choice, or the automatic one. */
export function effectiveTier(setting: QualitySetting, auto: Tier): Tier {
  return setting === "auto" ? auto : setting;
}

export type DeviceHints = { coarsePointer: boolean; cores?: number; memoryGb?: number };

/**
 * Where `auto` starts before the performance monitor has measured anything: phones and small
 * machines start low, everything else medium (high has to be earned by a steady frame rate).
 */
export function initialAutoTier({ coarsePointer, cores, memoryGb }: DeviceHints): Tier {
  if (coarsePointer) return "low";
  if ((cores !== undefined && cores <= 4) || (memoryGb !== undefined && memoryGb <= 4)) return "low";
  return "medium";
}

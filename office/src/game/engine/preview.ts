import type { Player } from "@/lib/player";
import { readMirror } from "../persist";
import { bootSettings, parseMirror, reducedMotion } from "../settings";
import { effectiveTier, initialAutoTier, type Tier } from "./quality";

export type PreviewMotion = { tier: Tier; reduced: boolean };

function media(query: string): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}

/**
 * The tier and motion preference for the 3D previews outside the game (the home's diorama, the
 * globe), from the same sources the game boots with: the saved settings (or this device's newer
 * mirror), the OS's reduced-motion setting and the device hints. Browser-only.
 */
export function previewMotion(player: Pick<Player, "settings" | "updatedAt">): PreviewMotion {
  const settings = bootSettings(player.settings, player.updatedAt, parseMirror(readMirror()));
  const nav = navigator as Navigator & { deviceMemory?: number };
  const auto = initialAutoTier({
    coarsePointer: media("(pointer: coarse)"),
    cores: nav.hardwareConcurrency,
    memoryGb: nav.deviceMemory,
  });
  return {
    tier: effectiveTier(settings.quality, auto),
    reduced: reducedMotion(settings.reduced_motion, media("(prefers-reduced-motion: reduce)")),
  };
}

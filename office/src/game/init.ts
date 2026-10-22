import type { Player } from "@/lib/player";
import { initialAutoTier } from "./engine/quality";
import { NO_MOVE } from "./input/bindings";
import { readMirror } from "./persist";
import { resolveAvatar } from "./player/avatar-style";
import { bootSettings, parseMirror } from "./settings";
import { type Location, type SceneId, type Spawn, useGame } from "./store/game-store";

export type GameEntry = { player: Player; scene: SceneId; spawn: Spawn; location: Location };

function media(query: string): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}

/**
 * Resets the store for a fresh entry into the game (the store is a module singleton, so a second
 * visit in the same tab must not inherit the first one's state). Browser-only: it reads
 * localStorage, media queries and device hints.
 */
export function initGame({ player, scene, spawn, location }: GameEntry) {
  const nav = navigator as Navigator & { deviceMemory?: number };
  useGame.setState({
    world: { scene, spawn, epoch: 0, phase: "loading", pending: null, location },
    input: { keyboard: NO_MOVE, keyboardRun: false, touch: NO_MOVE, touchRun: false },
    player: {
      displayName: player.displayName,
      avatar: resolveAvatar(player.avatar),
      position: spawn.position,
      pose: "stand",
      seat: null,
      cards: [],
    },
    interactables: new Map(),
    focus: null,
    deniedAt: 0,
    modal: null,
    cameraFocus: null,
    settings: bootSettings(player.settings, player.updatedAt, parseMirror(readMirror())),
    quality: {
      auto: initialAutoTier({
        coarsePointer: media("(pointer: coarse)"),
        cores: nav.hardwareConcurrency,
        memoryGb: nav.deviceMemory,
      }),
      settled: false,
    },
    osReducedMotion: media("(prefers-reduced-motion: reduce)"),
  });
}

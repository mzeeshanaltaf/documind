import type { Player } from "@/lib/player";
import { DEFAULT_TRACK } from "./audio/jukebox";
import { initialAutoTier } from "./engine/quality";
import { NO_MOVE } from "./input/bindings";
import { readMirror } from "./persist";
import { resolveAvatar } from "./player/avatar-style";
import { bootSettings, parseMirror } from "./settings";
import { INITIAL_PRESENTATION, type Location, type OfficeContext, type SceneId, type Spawn, useGame } from "./store/game-store";

export type GameEntry = {
  player: Player;
  scene: SceneId;
  spawn: Spawn;
  location: Location;
  /** The org and office location; omitted by the dev sandbox. */
  office?: OfficeContext;
  /** Access cards already held for this org (`progress.cards`). */
  cards?: string[];
};

function media(query: string): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}

/**
 * Resets the store for a fresh entry into the game (the store is a module singleton, so a second
 * visit in the same tab must not inherit the first one's state). Browser-only: it reads
 * localStorage, media queries and device hints.
 */
export function initGame({ player, scene, spawn, location, office, cards }: GameEntry) {
  const nav = navigator as Navigator & { deviceMemory?: number };
  useGame.setState({
    world: { scene, spawn, epoch: 0, phase: "loading", pending: null, location },
    office: office ?? null,
    input: { keyboard: NO_MOVE, keyboardRun: false, touch: NO_MOVE, touchRun: false },
    player: {
      displayName: player.displayName,
      avatar: resolveAvatar(player.avatar),
      position: spawn.position,
      pose: "stand",
      seat: null,
      cards: cards ?? [],
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
    clockHour: null,
    sky: null,
    chat: {},
    scopeCountry: {},
    viewer: { open: false, request: null },
    presentation: INITIAL_PRESENTATION,
    calledOut: {},
    emote: null,
    emoteWheel: { open: false, highlight: null },
    caffeinatedUntil: 0,
    jukebox: DEFAULT_TRACK,
    scoresVersion: 0,
  });
}

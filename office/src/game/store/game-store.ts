import type { Object3D } from "three";
import { create } from "zustand";
import { effectiveTier, type Tier } from "@/game/engine/quality";
import { type Move, NO_MOVE } from "@/game/input/bindings";
import type { Focus, InteractKind } from "@/game/interact/select";
import { type AvatarColors, DEFAULT_AVATAR } from "@/game/player/avatar-style";
import { DEFAULT_SETTINGS, reducedMotion, type Settings } from "@/game/settings";
import type { DocumentOut, Me } from "@/lib/api-types";
import type { Location as Place } from "@/lib/locations";

/**
 * The game store (zustand). React components subscribe with selectors to things that change
 * rarely (scene, modal, focus, settings). Per-frame code reads `useGame.getState()` and never
 * subscribes; per-frame values (camera yaw, the exact player position) live in `player/rig.ts`.
 */
export type SceneId = "city" | "office" | "rooftop" | "sandbox";
export type Vec3 = [number, number, number];
/** `yaw` is the avatar's heading (0 faces +z); `pitch` optionally starts the camera lower or higher. */
export type Spawn = { position: Vec3; yaw: number; pitch?: number };
export type Seat = { id: string; position: Vec3; yaw: number };

/**
 * Transition phases: `loading` (curtain closed, the scene suspends) → `in` (curtain fading out)
 * → `ready`; a transition goes `ready` → `out` (curtain fading in) → `loading` with the new scene.
 */
export type Phase = "loading" | "in" | "ready" | "out";

/** The breadcrumb (HUD, menu). */
export type Location = { org: string; city: string; room: string | null };

/**
 * Where the player is, as data (O3): the org, the office location (`lib/locations`), the org's
 * documents (for chat scoping, O5) and the DocuMind user. Null in the dev sandbox.
 */
export type OfficeContext = {
  org: { id: string; name: string; slug: string };
  place: Place;
  documents: DocumentOut[];
  me: Me["user"];
};

export type Modal =
  | { type: "menu" }
  | { type: "avatar"; first?: boolean }
  | { type: "sign"; title: string; lines: string[] }
  | { type: "dialogue"; npc: string; name: string; role: string; lines: string[] }
  /** A Global Hub kiosk asking to travel to another office (O4). */
  | { type: "travel"; locationId: string; name: string; detail: string };

export type InteractableEntry = {
  id: string;
  kind: InteractKind;
  label: string;
  radius: number;
  requires?: string;
  lockedReason?: string;
  object: Object3D;
  onInteract: () => void;
};

export type GameState = {
  world: {
    scene: SceneId;
    spawn: Spawn;
    /** Bumped on every swap, so re-entering the same scene still remounts it. */
    epoch: number;
    phase: Phase;
    pending: { scene: SceneId; spawn: Spawn } | null;
    location: Location;
  };
  office: OfficeContext | null;
  input: { keyboard: Move; keyboardRun: boolean; touch: Move; touchRun: boolean };
  player: {
    displayName: string;
    avatar: AvatarColors;
    /** Published at 10 Hz for the minimap and quests (the per-frame value is in the rig). */
    position: Vec3;
    pose: "stand" | "sit";
    seat: Seat | null;
    /** Access cards held (department names); `requires: "card:HR"` checks this. */
    cards: string[];
  };
  /** Mutated in place (no re-render); read by the interaction system each tick. */
  interactables: Map<string, InteractableEntry>;
  focus: Focus | null;
  /** Bumped when E is pressed on a locked interactable, so the prompt can shake. */
  deniedAt: number;
  modal: Modal | null;
  /** The world position the camera frames during a conversation, or null. */
  cameraFocus: Vec3 | null;
  settings: Settings;
  quality: { auto: Tier; settled: boolean };
  osReducedMotion: boolean;
  /** Development only: the city's local hour (0–24) instead of the real time; null = real. */
  clockHour: number | null;
  /** The current city sky, published when it changes (HUD, tests); null outside the city. */
  sky: { phase: string; isNight: boolean } | null;

  transitionTo: (scene: SceneId, spawn: Spawn) => void;
  swapScene: () => void;
  sceneReady: () => void;
  transitionDone: () => void;
  setLocation: (location: Partial<Location>) => void;
  setKeyboardInput: (move: Move, run: boolean) => void;
  setTouchInput: (move: Move, run: boolean) => void;
  clearInput: () => void;
  setPlayerPosition: (position: Vec3) => void;
  sit: (seat: Seat) => void;
  stand: () => void;
  setAvatar: (avatar: AvatarColors) => void;
  setFocus: (focus: Focus | null) => void;
  deny: () => void;
  openModal: (modal: Modal) => void;
  /** Opens a conversation and frames the camera on the speaker. */
  startDialogue: (dialogue: Extract<Modal, { type: "dialogue" }>, focus: Vec3) => void;
  closeModal: () => void;
  updateSettings: (patch: Partial<Settings>) => void;
  setAutoTier: (tier: Tier, settled?: boolean) => void;
  setOsReducedMotion: (reduced: boolean) => void;
  setClockHour: (hour: number | null) => void;
  setSky: (sky: GameState["sky"]) => void;
};

const ORIGIN_SPAWN: Spawn = { position: [0, 0, 0], yaw: 0 };

export const useGame = create<GameState>()((set, get) => ({
  world: {
    scene: "sandbox",
    spawn: ORIGIN_SPAWN,
    epoch: 0,
    phase: "loading",
    pending: null,
    location: { org: "", city: "", room: null },
  },
  office: null,
  input: { keyboard: NO_MOVE, keyboardRun: false, touch: NO_MOVE, touchRun: false },
  player: {
    displayName: "",
    avatar: DEFAULT_AVATAR,
    position: [0, 0, 0],
    pose: "stand",
    seat: null,
    cards: [],
  },
  interactables: new Map(),
  focus: null,
  deniedAt: 0,
  modal: null,
  cameraFocus: null,
  settings: DEFAULT_SETTINGS,
  quality: { auto: "medium", settled: false },
  osReducedMotion: false,
  clockHour: null,
  sky: null,

  transitionTo: (scene, spawn) => {
    if (get().world.phase === "out") return;
    set((s) => ({ world: { ...s.world, phase: "out", pending: { scene, spawn } } }));
  },
  swapScene: () => {
    const { pending } = get().world;
    if (!pending) return;
    set((s) => ({
      world: { ...s.world, ...pending, pending: null, epoch: s.world.epoch + 1, phase: "loading" },
      player: { ...s.player, pose: "stand", seat: null, position: pending.spawn.position },
      focus: null,
      cameraFocus: null,
    }));
  },
  sceneReady: () => {
    if (get().world.phase === "loading") set((s) => ({ world: { ...s.world, phase: "in" } }));
  },
  transitionDone: () => {
    if (get().world.phase === "in") set((s) => ({ world: { ...s.world, phase: "ready" } }));
  },
  setLocation: (location) => set((s) => ({ world: { ...s.world, location: { ...s.world.location, ...location } } })),

  setKeyboardInput: (keyboard, keyboardRun) => set((s) => ({ input: { ...s.input, keyboard, keyboardRun } })),
  setTouchInput: (touch, touchRun) => set((s) => ({ input: { ...s.input, touch, touchRun } })),
  clearInput: () => set({ input: { keyboard: NO_MOVE, keyboardRun: false, touch: NO_MOVE, touchRun: false } }),

  setPlayerPosition: (position) => set((s) => ({ player: { ...s.player, position } })),
  sit: (seat) => set((s) => ({ player: { ...s.player, pose: "sit", seat } })),
  stand: () => set((s) => ({ player: { ...s.player, pose: "stand", seat: null } })),
  setAvatar: (avatar) => set((s) => ({ player: { ...s.player, avatar } })),

  setFocus: (focus) => set({ focus }),
  deny: () => set({ deniedAt: Date.now() }),
  openModal: (modal) => set({ modal }),
  startDialogue: (dialogue, focus) => set({ modal: dialogue, cameraFocus: focus }),
  closeModal: () => set({ modal: null, cameraFocus: null }),

  updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
  setAutoTier: (auto, settled = false) => set({ quality: { auto, settled } }),
  setOsReducedMotion: (osReducedMotion) => set({ osReducedMotion }),
  setClockHour: (clockHour) => set({ clockHour }),
  setSky: (sky) => {
    const current = get().sky;
    if (current?.phase !== sky?.phase || current?.isNight !== sky?.isNight) set({ sky });
  },
}));

/** The rendering tier in effect. */
export const selectTier = (s: GameState): Tier => effectiveTier(s.settings.quality, s.quality.auto);

export const selectReducedMotion = (s: GameState): boolean =>
  reducedMotion(s.settings.reduced_motion, s.osReducedMotion);

export const selectModalOpen = (s: GameState): boolean => s.modal !== null;

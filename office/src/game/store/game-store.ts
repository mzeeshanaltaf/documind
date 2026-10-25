import type { Object3D } from "three";
import { create } from "zustand";
import { effectiveTier, type Tier } from "@/game/engine/quality";
import { type Move, NO_MOVE } from "@/game/input/bindings";
import type { NpcTurn } from "@/game/chat/sse";
import { type JukeboxChoice, DEFAULT_TRACK } from "@/game/audio/jukebox";
import type { GameId } from "@/game/games/types";
import type { Focus, InteractKind } from "@/game/interact/select";
import { type AvatarColors, DEFAULT_AVATAR } from "@/game/player/avatar-style";
import type { ActiveEmote } from "@/game/player/emotes";
import { DEFAULT_SETTINGS, reducedMotion, type Settings } from "@/game/settings";
import { type SeenSlides, wrapSlide } from "@/game/world/office/presentation/slides";
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
/**
 * `view` (auditorium seats, O7): the point the camera frames while seated there (the screen);
 * sideways input pages the slides instead of standing up.
 */
export type Seat = { id: string; position: Vec3; yaw: number; view?: Vec3; /** Beanbags (O8): the camera settles lower and closer once. */ relaxed?: boolean };

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
  /** A conversation with a DocuMind-backed NPC (O5): its menu, the chat, or the card picker. */
  | { type: "npc"; npc: string; view: NpcView }
  /** A Global Hub kiosk asking to travel to another office (O4). */
  | { type: "travel"; locationId: string; name: string; detail: string }
  /** The presentation room's current slide as a readable DOM page (O7 › "View full screen"). */
  | { type: "slides" }
  /** A mini-game from the play area (O8): game mode, until it's quit. */
  | { type: "game"; game: GameId }
  /** The leaderboard wall's DOM version, with week / all-time tabs (O8). */
  | { type: "leaderboard" }
  /** The jukebox's track picker (O8). */
  | { type: "jukebox" };

export type NpcView = "menu" | "chat" | "cards";

/**
 * One NPC conversation per visit (phase O5 › Dialogue panel), keyed `{location}:{npcId}`. It
 * survives walking away and scene changes; a page reload (or another office) starts over.
 */
export type ChatThread = { conversationId: string | null; turns: NpcTurn[] };
export const EMPTY_THREAD: ChatThread = { conversationId: null, turns: [] };
export const threadKey = (location: string, npc: string) => `${location}:${npc}`;

/**
 * A cited PDF in the viewer sheet (phase O6 › Citations). `npc` is whose answer cited it: that
 * room's wall screen shows the document and page while the sheet is open.
 */
export type ViewerRequest = {
  documentId: string;
  title: string;
  docCode: string | null;
  /** 1-based page to open at. */
  page: number | null;
  /** Last page of the cited passage (highlighting stays within page..pageEnd). */
  pageEnd: number | null;
  /** The cited chunk text; null when just viewing a document. */
  highlightText: string | null;
  npc: string | null;
  department: string | null;
};
export type Viewer = { open: boolean; request: (ViewerRequest & { nonce: number }) | null };

/**
 * The presentation room's running loop (O7): the slide on screen (an index into the programme,
 * `count` long), when it came up, and the slides seen this visit per deck.
 */
export type Presentation = { slide: number; count: number; shownAt: number; seen: SeenSlides; muted: boolean };
export const INITIAL_PRESENTATION: Presentation = { slide: 0, count: 0, shownAt: 0, seen: {}, muted: true };

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
  chat: Record<string, ChatThread>;
  /**
   * Worldwide department rooms: the country chip per thread (`{location}:{npc}`), null = "All".
   * A scoped conversation keeps its scope, so changing it starts a new thread.
   */
  scopeCountry: Record<string, string | null>;
  viewer: Viewer;
  presentation: Presentation;
  /** NPCs that have called out to the player this visit (`{location}:{npcId}`). */
  calledOut: Record<string, true>;
  /** The emote playing now (O8), or null. */
  emote: ActiveEmote | null;
  /** The emote wheel: open while Q is held (or toggled by the HUD button), with the highlighted slot. */
  emoteWheel: { open: boolean; highlight: number | null };
  /** `Date.now()` until which the coffee boost lasts (O8); 0 = none. */
  caffeinatedUntil: number;
  /** The jukebox's choice for this visit (O8). */
  jukebox: JukeboxChoice;
  /** Bumped after a score is submitted, so the leaderboard wall and board refetch. */
  scoresVersion: number;
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
  startDialogue: (dialogue: Extract<Modal, { type: "dialogue" | "npc" }>, focus: Vec3) => void;
  /** Enters a mini-game and frames the camera on its station (O8). */
  startGame: (game: GameId, focus: Vec3) => void;
  setEmote: (emote: ActiveEmote | null) => void;
  setEmoteWheel: (wheel: { open: boolean; highlight: number | null }) => void;
  setCaffeinatedUntil: (until: number) => void;
  setJukebox: (choice: JukeboxChoice) => void;
  bumpScores: () => void;
  /** Switches the open NPC conversation between its menu, chat and card picker. */
  setNpcView: (view: NpcView) => void;
  setCards: (cards: string[]) => void;
  setDocuments: (documents: DocumentOut[]) => void;
  updateThread: (key: string, update: (thread: ChatThread) => ChatThread) => void;
  /** Switches a Worldwide room's country chip and starts a new conversation there. */
  setScopeCountry: (key: string, country: string | null) => void;
  openViewer: (request: ViewerRequest) => void;
  setViewerOpen: (open: boolean) => void;
  markCalledOut: (key: string) => void;
  /** The programme's length (it changes when a generated deck's summary arrives). */
  setPresentationCount: (count: number) => void;
  /** Shows a slide (wrapped into the programme). */
  showSlide: (index: number) => void;
  /** Pages the programme: +1 next, -1 previous (wraps round). */
  stepSlide: (delta: number) => void;
  setSeenSlides: (seen: SeenSlides) => void;
  setVideoMuted: (muted: boolean) => void;
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
      emote: null,
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
  startGame: (game, focus) => set({ modal: { type: "game", game }, cameraFocus: focus, emote: null, emoteWheel: { open: false, highlight: null } }),
  setEmote: (emote) => set({ emote }),
  setEmoteWheel: (emoteWheel) => set({ emoteWheel }),
  setCaffeinatedUntil: (caffeinatedUntil) => set({ caffeinatedUntil }),
  setJukebox: (jukebox) => set({ jukebox }),
  bumpScores: () => set((s) => ({ scoresVersion: s.scoresVersion + 1 })),
  closeModal: () => set((s) => ({ modal: null, cameraFocus: null, viewer: { ...s.viewer, open: false } })),
  setNpcView: (view) => {
    const { modal } = get();
    if (modal?.type === "npc" && modal.view !== view) set({ modal: { ...modal, view } });
  },
  setCards: (cards) => set((s) => ({ player: { ...s.player, cards } })),
  setDocuments: (documents) => set((s) => (s.office ? { office: { ...s.office, documents } } : {})),
  updateThread: (key, update) => set((s) => ({ chat: { ...s.chat, [key]: update(s.chat[key] ?? EMPTY_THREAD) } })),
  setScopeCountry: (key, country) =>
    set((s) => ({ scopeCountry: { ...s.scopeCountry, [key]: country }, chat: { ...s.chat, [key]: EMPTY_THREAD } })),
  openViewer: (request) => set((s) => ({ viewer: { open: true, request: { ...request, nonce: (s.viewer.request?.nonce ?? 0) + 1 } } })),
  setViewerOpen: (open) => set((s) => (s.viewer.open === open ? {} : { viewer: { ...s.viewer, open } })),
  markCalledOut: (key) => set((s) => ({ calledOut: { ...s.calledOut, [key]: true } })),
  setPresentationCount: (count) => {
    const { presentation } = get();
    if (presentation.count === count) return;
    set({ presentation: { ...presentation, count, slide: wrapSlide(presentation.slide, count) } });
  },
  showSlide: (index) => {
    const { presentation } = get();
    const slide = wrapSlide(index, presentation.count);
    if (slide !== presentation.slide) set({ presentation: { ...presentation, slide, shownAt: Date.now() } });
  },
  stepSlide: (delta) => get().showSlide(get().presentation.slide + delta),
  setSeenSlides: (seen) => set((s) => ({ presentation: { ...s.presentation, seen } })),
  setVideoMuted: (muted) => set((s) => ({ presentation: { ...s.presentation, muted } })),

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

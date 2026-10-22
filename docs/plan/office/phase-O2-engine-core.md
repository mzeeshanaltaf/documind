# Phase O2 — Engine Core: Avatar, Controls, Camera, Physics, HUD Shell

**Goal:** the reusable 3D foundation:
- a client-only canvas;
- a scene manager with transitions;
- a customizable avatar walking on keyboard or touch with physics and a follow camera;
- an interaction system ("Press E");
- the DOM HUD shell;
- audio and quality tiers.

It's proven in a small test-room scene at `/dev/sandbox`, visible in development only.

**Depends on:** O1. **Unblocks:** O3–O9.

## Skills to load
`/vercel-react-best-practices`, `/nextjs-best-practices`, `/impeccable` (HUD shell).

## Known facts
- **Client-only trees.** They use browser-only values at init (WebGL, `window`, random IDs), so the canvas root loads via `next/dynamic(() => import(...), { ssr: false })` from a `"use client"` wrapper (global CLAUDE.md).
- **Under `cacheComponents`,** keep session reads inside `<Suspense>`. The game page is a Server Component that checks access, then renders the dynamic client root.
- **R3F rules:**
  - no React state updates per frame; mutate refs in `useFrame`;
  - read zustand with `getState()` inside `useFrame`, never through subscriptions;
  - reuse the vectors and materials.
- **Rapier** loads wasm asynchronously. Wrap physics in `<Suspense>` with the loading screen.

## 1. Packages
`three`, `@types/three`, `@react-three/fiber` v9, `@react-three/drei` v10, `@react-three/rapier` v2, `zustand` v5, `howler`, `suncalc` (used in O4).

Pin the exact versions and record them in `office/CLAUDE.md`.

## 2. Engine — `src/game/engine/`
- **`GameCanvas.tsx`:**
  - `<Canvas shadows dpr={tier.dpr} gl={{ antialias: tier.aa }}>`;
  - `<PerformanceMonitor>` steps the quality tier down automatically (low, medium, high);
  - `<AdaptiveDpr>`;
  - the colour space and tone mapping are set once.
- **`SceneManager`:** `scene` in the store is `"city" | "office" | "rooftop" | "sandbox"`. The scene component is chosen by key and lazy-loaded (`React.lazy`), so each scene is its own chunk.
  - **Transition:** fade the DOM overlay out, unmount the old scene and dispose its resources, mount the new one, then fade in.
  - **Spawn point:** passed with the transition (`{scene, spawn}`).
- **`Loading.tsx`:** a DOM overlay showing drei `useProgress` percent, a rotating tip ("Tip: press J for your journal"), and the DocuMind mark.
- **`quality.ts`:**

  | Tier | DPR | Shadows | Shadow map | Max NPCs | Post-processing |
  |---|---|---|---|---|---|
  | low | 1 | off | — | 6 | none |
  | medium | ≤ 1.5 | on | 1024 | 12 | none |
  | high | ≤ 2 | on | 2048 | 24 | subtle |

  The settings override the automatic tier.

## 3. Input — `src/game/input/`
- **Keyboard:** a `KeyboardControls` map (drei):
  - forward/back/left/right (arrows + WASD), run (Shift), interact (E), journal (J), map (M), menu (Esc);
  - ignored while `document.activeElement` is editable or a dialog is open (`ui.modal` in the store).
- **Touch:** a joystick (`pointer: coarse`) with interact and menu buttons. It writes the same normalized `move` vector (`input.ts`).
- **Reduced motion** follows `prefers-reduced-motion`, overridable in settings. It disables head-bob, camera shake and spin animations.

## 4. Player — `src/game/player/`
- **Avatar:** a CC0 rigged low-poly character with idle, walk, run, sit, wave, cheer and dance clips (e.g. Quaternius).
  - Verify the licence and record it in `public/assets/LICENSES.md`.
  - Store it as compressed GLB (gltf-transform: Draco or Meshopt; textures as atlas or KTX2).
  - Material colours come from `players.avatar`: skin, hair, top, bottom, shoes, plus a badge colour.
  - `useAnimations` crossfades between clips.
- **Controller:** rapier `KinematicCharacterController` on a capsule:
  - movement relative to the camera, with Shift to run;
  - slope and step handling;
  - gravity, no jump.
  - The position is published to the store (throttled to 10 Hz) for the minimap and quests.
- **Camera:** a third-person follow (spring-damped):
  - orbit with right-drag or touch-drag; scroll to zoom within limits;
  - pulls in on wall collision (raycast);
  - a "dialogue framing" mode eases toward the player and NPC during conversations.
- **Name tag:** the player's display name over their head (drei `Html`, `occlude`), hidden on the low tier.

## 5. Interaction — `src/game/interact/`
- **`<Interactable id kind label radius onInteract requires?>`:** registers in the store.
  - Each frame (throttled), the nearest interactable in range becomes `focused`.
  - The HUD shows the prompt "E · Talk to Hina" or "E · Sit".
  - `requires` (e.g. `card:HR`) shows a locked prompt and a reason instead of acting.
- **Event bus** (`src/game/quests/bus.ts`, created now and used in O9): `emit({type, ...})` is typed. Interactions emit events (`room_entered`, `npc_talked`, …).

## 6. HUD shell — `src/components/hud/`
- **The overlay** is DOM over the canvas and uses the tokens:
  - top-left: location breadcrumb (Org › City › Room);
  - top-right: the quota meter slot (filled in O5) and the menu button;
  - bottom-centre: the interaction prompt;
  - bottom-right: the minimap slot (O5);
  - toasts: `sonner`, as in `web/`.
- **Menu (Esc):** Resume, Settings (quality, sound/music volume, reduced motion, show name tags, controls help), Change location, Open DocuMind, Sign out.
  - Settings persist through `savePlayer` (debounced), with a `localStorage` mirror for instant boot (try/catch).
- **Avatar editor:** a dialog with a live preview canvas. It's used on first entry and later at the Reception badge booth (O5).

## 7. Audio — `src/game/audio/`
- A Howler manager with music/ambience/sfx buses and volumes from settings.
- Unlocked on the first user gesture.
- CC0 sound effects (e.g. Kenney): footsteps (surface-based), UI click, door, card beep, success. Licences go in `LICENSES.md`.

## 8. Sandbox scene — `/dev/sandbox` (development only; `notFound()` in production)
- A floor, walls and a ramp, two interactables (a chair to sit on, a sign to read) and one dummy NPC.
- It proves physics, the camera, interaction, the HUD, quality tiers and audio.

## Tests
- **Vitest:** the input mapping (keys to the move vector, the editable-focus guard), the interactable selection (nearest in range, `requires` gating), the quality-tier stepping and the settings schema.
- **Playwright:** open the sandbox, hold ArrowUp for 1 s, and assert the player position changed through the store, which is exposed on `window.__office` in development only. Then press E near the chair and assert the sit state.

## Acceptance
- In the sandbox the avatar walks and runs with arrows/WASD and the touch joystick, collides with walls, climbs the ramp, and the camera follows without clipping through walls.
- The prompt appears in range. E sits; Esc opens the menu, and movement keys are ignored while the menu is open.
- Avatar colours edited in the dialog persist across reloads (DB row).
- Quality tiers switch live. The low tier holds 60 fps on a laptop iGPU.
- Disposing a scene leaves no growing `renderer.info.memory` across 5 transitions.
- typecheck, lint, test and build are clean. The game route's JS chunk size is recorded in Status.md.

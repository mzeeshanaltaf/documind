# DocuMind Office — Guide for Claude

**DocuMind Office** is a walkable low-poly 3D office on top of DocuMind. It's a standalone Next.js app in `office/`; prod will be `https://office.documind.zeeshanai.cloud`.
- You sign in with your DocuMind account, pick an org and an office city (or Worldwide), and walk in.
- Reception issues access cards. Department experts answer through DocuMind (real citations, real monthly quota).
- There's also a presentation room, a play area, quests and achievements, and a rooftop to unlock.

## Start here, every session
1. Read the root `CLAUDE.md`, then this file.
2. Read the **Office** section of `Status.md`.
3. Read `docs/plan/office/README.md` (decisions, data model, scoping rule, env) and the current phase doc `docs/plan/office/phase-O<n>-*.md`.
4. Load the skills that the phase lists **before** writing code.
5. At the end, update Status.md › Office (phase table, plus an `[office]` session-log entry) and this file (commands, versions, gotchas), keeping it ≤ 150 lines.

## Status
**O9 done (2026-10-25):** quests (5 core, 7 side), achievements, the journal (J), toasts, coach marks, persistent progress per user × org, the rooftop lounge behind the corridor lift. **O10 is next** (polish, a11y, performance, deploy). O8: play area (three mini-games, leaderboards, jukebox, emotes). O7: presentation room. O6: department rooms, experts, citations. O5: lobby, reception, cards, NPC chat. O4: city scenes. O3: pickers. O2: engine core (dev-only `/dev/sandbox`). O1: scaffold, sign-in, BFF, `documind_office_dev` schema.

## Layout (as built)
- `src/lib/`: `auth` (Better Auth), `auth-guards` (`requireSession`, `requireOrgAccess`/`requireOrgAccessBySlug`, `withoutEvalOrgs` (+ logos)), `locations` (`deriveLocations`, pure) + `country-defaults`, `format` (local time, UTC offset, day/night), `account` (ban/admin rules, client-safe), `db` (one pool: auth `search_path`, max 3), `db-url`, `office-db` (`query()` with `{office}`), `api` (`apiFetch`/`apiJson`; `userId` optional in Server Components), `api-types`, `rate-limit`, `backend-path` (BFF path rules), `player` (zod schemas, `defaultDisplayName`), `org-meta`, `site`.
- `src/app/(game)/actions.ts`: `getPlayer()` (upsert on first read, one round trip), `savePlayer({avatar, settings})` (zod; **shallow-merges** both jsonb objects), `recordVisit(orgId, locationId)` (`progress.stats.cities_visited` set + `last_org`/`last_location`, one CTE).
- **Pickers (O3):** `(game)/page.tsx` org list (one org → `redirect` to its globe unless `?pick`; "Resume in …"; diorama backdrop), `(game)/[orgSlug]/page.tsx` → `components/locations/location-picker.tsx` (list + globe, fly/fade then `router.push`), `(game)/[orgSlug]/[location]/page.tsx` (validates, then `GameClient` with `office` = `{org, place, documents, me}` in the store + `RecordVisit`). `components/home/top-bar.tsx` is on the pickers only (the game has none). `src/content/orgs/` = per-org location overrides (Simtora).
- **Globe, `src/game/world/globe/`:** `GlobeCanvas` (dynamic, ssr:false; `flat`, demand frameloop on low/reduced), `GlobeRig` (turn/drag/focus/fly; lays out labels), `Earth` + `earth-geometry` (icosphere coloured from `public/assets/textures/earth-mask.png`, made by `scripts/make-earth-mask.mjs`), `Pins`, `Arcs`, `WorldwideRing`, `GlobeLabels` (DOM) + `labels.ts`, `geo.ts` (pure maths, `placeLabels`), `globe-store` (hover/selected/clock, `FLY_MS`). `world/diorama/OfficeDiorama` (home backdrop), `engine/preview.ts` (tier + reduced motion outside the game), `engine/PreviewBoundary`.
- `src/app/(auth)/sign-in` + `components/auth/directory-panel.tsx` (the lobby directory companion panel). `src/proxy.ts`: optimistic cookie redirects.
- `db/migrations/0001_init.sql`, `scripts/migrate.mjs` (advisory lock; one transaction per file), `scripts/auth-check.ts`, `tests/` (Vitest), `e2e/` (Playwright; `support/test-user.ts` makes a signed-in throwaway user).
- **Game (O2), `src/game/`:** `GameRoot` (client root: store init, keyboard, motion, audio unlock, settings persistence, first-look editor, dev handle) loaded by `components/game/game-client.tsx` (`dynamic`, `ssr: false`).
  - `store/game-store.ts` (zustand `useGame`: world/transition phase, input, player, interactables, focus, modal, settings, quality); `player/rig.ts` holds per-frame values (camera yaw, exact position).
  - `engine/`: `GameCanvas` (tiers, PerformanceMonitor, AdaptiveDpr), `SceneManager` (lazy scene per key, each in its own keyed `<Physics>`), `Loading` (curtain; it drives the transition timers), `quality.ts`, `SunLight`, `QualityApplier`, `PostFx` (lazy, high tier).
  - `input/` (bindings, joystick, `use-keyboard`), `interact/` (`select.ts` pure, `Interactable`, `InteractionSystem`, `interact.ts`), `player/` (`Avatar` + `avatar-clips` + `avatar-style`, `Player` (KCC), `FollowCamera`), `audio/audio.ts` (Howler buses), `quests/bus.ts`, `settings.ts`, `persist.ts`, `world/kit.tsx` (`Block`, `useSignTexture`), `world/sandbox/`.
- **City (O4), `src/game/world/city/`:** pure `generator.ts` (`generateCity`: blocks, buildings, skyline, furniture, loops, walk graph, spawn/exit/entrance, landmark anchors, colliders; `windowsOf`, `groundHeight`), `paths.ts` (traffic loops), `random.ts` (FNV + mulberry32), `lighting.ts` (suncalc → `SkyState`, `atLocalHour`), `hub-layout.ts`, `spawns.ts` (`cityEntrySpawn`/`cityExitSpawn`, used by the page), `vehicles.ts` (models, `FLEETS`, `planFleet`). Scene: `CityScene` (city or lazy `global-hub`), `CitySky`, `Ground` (one vertex-coloured mesh + `Colliders`), `Buildings` (instanced; `aLit` night glow), `StreetFurniture`, `building.tsx` (tower, signs, doors, `Trigger`), `traffic`, `pedestrians`, `merge.tsx` (`Merged`: one mesh per colour), `signs.ts` (canvas signage), `landmarks/` (one lazy kit each), `use-city-sky`, `ambience.ts`. `world/Trigger.tsx`.
- **HUD, `src/components/hud/`:** `hud` (breadcrumb, quota meter + menu, card wallet, minimap), `interaction-prompt`, `game-menu` (Esc: settings, controls; dev-only time-of-day slider), `avatar-editor`, `sign-dialog`, `dialogue-panel` (static lines: sandbox), `touch-controls`, `arrival-banner`, `travel-dialog` (hub kiosks), `quota-meter`, `card-wallet`, `minimap` (M). Page: `src/app/dev/sandbox/page.tsx` (`notFound()` in production).
- **Office (O5), `src/game/world/office/`:** pure `floorplan.ts` (`buildFloorplan(departments)` → rooms, walls with door cut-outs + headers + glass, doors with `requires`, spawns, NPC spots, props, exit; `roomAt`, `reachableRooms`), `use-floorplan` (cached per department list; the sandbox gets Simtora's), `OfficeScene` (+ `RoomTracker`: breadcrumb + `room_entered`), `Shell` (merged floors/walls/ceiling, colliders), `doors` (sliding glass + card reader with "Expert: {name}" plates; lift), `lobby` (mark wall, live clock, directory, waiting area, badge booth), `reception`, `signage`, `palette`, `spawns`.
- **Rooms (O6), `world/office/rooms/`:** pure `decor.ts` (`roomDecor` in the room's frame, `floorplan.roomFrame`/`toWorld`/`expertLocal`: door at local -x, west rooms turned π), `DepartmentRoom` (vertex-coloured mesh + glow mesh, colliders, visuals ≤ 14 m, expert ≤ 11 m), `panels.tsx` + `textures.ts` (painted panels; the wall screen follows `viewer`), `animated.tsx` (rack LEDs, zone clocks), `index.tsx` (`Rooms`; side-room notices). `components/pdf/` (web's sheet + `highlight.ts`; `PdfViewer` reads the store's `viewer`, nested in the NPC dialog), `components/dialogue/citation-chip.tsx` (chip, hover card, sources list), `game/chat/citations.ts`, `game/progress/stats.ts` (→ `recordStats`). `lib/departments.ts` (room order, no Corporate), `lib/scope.ts` (`scopeFor`, README rules 1–6), `lib/quota.ts` (SWR `useQuota`, `quotaLevel`, DocuMind's formatters).
- **Presentation (O7), `world/office/presentation/`:** pure `slides.ts` (types, `programmeOf`, `wrapSlide`, `markSeen`), `decks.ts` (`deckFor`/`decksFor`, `summaryParts`), `layout.ts` (`auditoriumLayout`, `seatCamera`), `furniture.ts`; `deck.tsx` (`SlideView`, `screen` 960×540 / `page` variants), `use-programme.ts` (SWR overview summary for generated decks, `seeSlide`), `PresentationRoom.tsx` (colliders, `Director`: loop + seen-set + exposure dim, `Screen`: `Html transform` occluded by the room's walls or `useVideoTexture`, dots, seats, presenter). Content: `content/documind-deck.ts` (+ `EXPLAINER`), `content/orgs/simtora-deck.ts` (pages per slide), `content/orgs/decks.ts` (`ORG_DECKS`). HUD: `presentation-bar`, `slides-dialog`. Store: `presentation` slice, `slides` modal, `Seat.view`. `use-near.ts` (shared with rooms).
- **Play area (O8), `world/office/play/`:** pure `layout.ts` (`playLayout(room, door)`: stations + prompt spots, colliders, beanbag seats, the wall panel, signs; `doorLane`), `furniture.ts` (merged parts), `textures.ts` (the wall's painter), `PlayArea.tsx` (stations as `Interactable`s, coffee steam, `PlayMusic`, the wall fetching `getLeaderboards`). Games: `game/games/` (`types`, `scoring` = zod schema + bounds, `font`; `trivia/{bank,round,banks}`, `sort-toss/{logic,draw}`, `table-tennis/{model,draw}`), UI in `components/games/` (`game-dialog` = game mode, the three games, `game-result`, `leaderboard-dialog`, `jukebox-dialog`), `components/hud/emote-wheel.tsx`, `game/player/{emotes,emote-actions,boost}.ts`, `game/audio/jukebox.ts`. Server: `lib/leaderboard.ts` + `submitScore`/`getLeaderboard(s)` in `(game)/actions.ts`, `limitScore` in `rate-limit.ts`. Modal types `game`/`leaderboard`/`jukebox`; store `emote`, `emoteWheel`, `caffeinatedUntil`, `jukebox`, `scoresVersion`.
- **Quests (O9), `game/quests/`:** pure `definitions` (12 quests, achievements, `Progress`/`Stats`), `engine` (`applyEvent`, `reconcile`, `coreStatus`, `unlocksOf`), `achievements` (`earnedBy`), `schema` (zod patch, `mergeProgress`, `normalizeProgress`, `toPatch`), `guide` (`guideTarget`, `guidePath`), `context` (`questContext`); `runtime` (bus → engine → store + toasts), `save` (2 s debounce, `sendBeacon` to `app/api/progress/route.ts`). Server: `lib/progress.ts` (`writeProgress`: locked read-modify-write), `loadProgress`/`saveProgress` in `(game)/actions.ts`, `transaction()` in `office-db`. Store: `progress`, `unlocks`, `toasts`, `guide`, `scope`. HUD: `journal-dialog`, `quest-toasts`, `coach-marks`, `telescope-caption`. Rooftop: `world/office/{rooftop,rooftop-layout,rooftop-parts,rooftop-texture,Fireworks,GuideTrail}`, `LiftDoor` in `doors.tsx`, `content/landmarks.ts` (+ `SIMTORA_LANDMARKS`).
- **NPC chat (O5):** `game/chat/` (`sse.ts`: pure `applyEvent`/`endTurn`/`refuseTurn` + `streamChat`; `use-npc-chat.ts`: turns in the store's `chat` slice keyed `{location}:{npc}`, refusals, one retry after 422; `speech.ts`, `lines.ts`), `game/npc/` (`Npc` (rig + prop + tag + bubble, `seenFrom` rooms), `profiles.ts` (persona, scope, greeting, suggestions, Worldwide chips per NPC id), `use-speech` (+ `useAnswerGesture`)), `components/dialogue/` (`npc-dialogue` (menu / chat / cards views), `npc-chat`, `card-picker` (→ `issueCards`), `answer-markdown` + `remark-citations` (copied from web)), `content/{personas,room-themes}.ts`. Server Actions: `getCards`, `issueCards`.

## Commands
```bash
cd office && pnpm dev            # :3200 (DocuMind api must run on :8000; MinIO for PDFs)
cd office && pnpm typecheck | pnpm lint | pnpm test | pnpm build
cd office && pnpm test:e2e       # Playwright on :3200 (starts or reuses `pnpm dev`; needs the dev DB)
cd office && node scripts/migrate.mjs [--dry-run]   # documind_office(_dev) schema; re-run = no-op
cd office && pnpm auth:check     # read-only: DocuMind owns the auth tables
cd office && node scripts/make-earth-mask.mjs <ne_110m_land.geojson>   # regenerate the globe's land mask
cd office && node scripts/make-ambience.mjs [--play]   # regenerate the city ambience + motif loops, or only the jukebox's three (needs ffmpeg)
cd office && OFFICE_SHOTS=<dir> pnpm test:e2e e2e/city.spec.ts   # + day/night screenshots per city (OFFICE_CITIES=a,b to limit)
cd office && OFFICE_SHOTS=<dir> pnpm test:e2e e2e/office.spec.ts -g screenshots   # lobby, corridor, minimap, dialogue views
cd office && OFFICE_SHOTS=<dir> pnpm test:e2e e2e/rooms.spec.ts -g screenshots    # every room, the PDF sheet, the chips
cd office && OFFICE_SHOTS=<dir> pnpm test:e2e e2e/presentation.spec.ts           # auditorium, seated, video, full screen (+360 px, dark); 1 billed chat
cd office && OFFICE_SHOTS=<dir> pnpm test:e2e e2e/play.spec.ts                   # play area, the three games (a full 60 s Sort & Toss bot round), touch, ambient; no LLM
cd api && uv run python -I ../office/scripts/check-trivia-bank.py ../office/src/content/orgs/simtora-trivia.json ../docs/policies --sample 20   # bank vs PDFscd office && OFFICE_SHOTS=<dir> pnpm test:e2e e2e/quests.spec.ts   # the 5 core quests (mocked chat, no LLM), reload, lift, rooftop
docker build -f office/Dockerfile --build-arg NEXT_PUBLIC_APP_URL=https://documind.zeeshanai.cloud .   # from O10
```

## Architecture rules
- **Browser → office only.** DocuMind data goes through the BFF `/api/backend/*`:
  - it checks the session, then calls `API_BASE_URL` with `X-API-Key: DOCUMIND_API_KEY` + `X-User-Id`;
  - it streams SSE and PDFs unbuffered;
  - on chat POSTs it applies DocuMind's `limitChat` (**same Upstash prefix and key**, a shared 30/min window).
- **Auth:** Better Auth on DocuMind's auth tables (`OFFICE_AUTH_SCHEMA`), with its own secret and `cookiePrefix: "documind-office"`.
  - Any verified, non-banned user can sign in.
  - `disabledPaths` leaves only sign-in, callback, get-session and sign-out.
  - The app **never migrates or writes the auth tables**.
  - Never enable `crossSubDomainCookies`.
- **Office state** (`players`, `progress`, `game_scores`) lives in schema `OFFICE_DB_SCHEMA`.
  - It's written by Server Actions that start with `requireSession()`; org-scoped ones add `requireOrgAccess(orgId)` (admin, or a `member` row).
  - Migrations are numbered SQL with `{office}`/`{auth}` placeholders, run by `scripts/migrate.mjs`.
- **Chat scope** = `lib/scope.ts` (README › Chat scoping). Rooms send `document_ids` (max 50), which bypasses DocuMind's router. Worldwide reception sends `null`.
- **No backend changes for the office.** If one seems necessary, raise it with the owner first; the backend lives in `api/`.
- **Quota** is DocuMind's (`GET /v1/me/quota`, 429 `quota_exceeded`). Trivia, greetings and games never call the LLM.

## Conventions
- **Same as the root CLAUDE.md:** Server Components by default; Server Actions re-check auth; zod; `import "server-only"`; Tailwind v4 plus shadcn in `src/components/ui`; `ButtonLink` for link-buttons; `useId()` for field ids.
- **3D code:**
  - the canvas tree loads via `next/dynamic(..., { ssr: false })`;
  - no React state updates per frame (refs plus `useFrame`, `store.getState()`);
  - reuse vectors and materials;
  - dispose on unmount;
  - scenes and games are lazy chunks.
- **HUD and menus are DOM,** using DocuMind's tokens. They're accessible (focus trap, `aria-live`), and movement keys are ignored while an editable element or dialog has focus.
- **Pure logic** (locations, scope, floor plan, city generator, SSE reducer, quest engine, scoring) lives in plain TS modules with Vitest tests.
- **Assets:** CC0 only. Record each source and licence in `public/assets/LICENSES.md`, and compress with gltf-transform.
- **Copies of `web/`:** `globals.css` tokens, `components/ui`, fonts, the logo, the PDF viewer, `api-types.ts`, `rate-limit.ts`, the explainer video. Record the sync date here and copy changes by hand.
  - **Synced 2026-10-22:** `globals.css` (tokens + answer prose, via evaluation/web; identical `:root`/`.dark`), `components/ui` (alert, avatar, button, dropdown-menu, empty, field, input, label, separator, skeleton, sonner, spinner, tooltip), the logo, fonts, `api-types.ts`, `rate-limit.ts` (chat only). Auth, BFF, `auth-check` and the sign-in form come from `evaluation/web`.
  - **O2 (2026-10-22):** `dialog`, `radio-group`, `toggle`, `toggle-group` from `web/`; `switch` from `evaluation/web`; `slider` and `kbd` from the shadcn registry (not in `web/`; the slider thumb uses `bg-background`, not `bg-white`).
  - **Later copies (2026-10-22):** O5 `popover`, `textarea`, `chat/remark-citations.ts`; O6 `hover-card`, `collapsible`, `sheet` (+ `overlayClassName`), `pdf/highlight.ts`, `pdf/pdf-viewer-sheet.tsx` (adapted), the citation chip/card/sources list, `.pdf-page` CSS, `pageLabel`/`sectionLabel`; O7 `web/public/documind-explainer.mp4` + poster → `public/video/` (re-copy when re-rendered; silent, so `EXPLAINER.hasAudio` is false; `.vtt` cues follow its timings). **O8 (2026-10-25):** `ui/dialog` gained `overlayClassName`.
- **Tests:** `*.test.ts` run in node; `*.dom.test.tsx` in jsdom (`vitest.config.mts` projects). `server-only` is aliased to a stub, so server modules are importable. **Files:** use the Write/Edit tools, never shell heredocs. **Git:** commit and push only when the user asks (`/ship`).

## Environment
The keys are in the root `.env.local`; see README › Environment. The office's own keys are `OFFICE_*`; shared: `DATABASE_URL`, `API_BASE_URL`, `DOCUMIND_API_KEY` (server-only), `GOOGLE_*`, `UPSTASH_*`, `NEXT_PUBLIC_APP_URL` (**DocuMind's** URL, for "Continue in DocuMind" and "Forgot password"; set at build time).

## Pinned versions
- Tests: `vitest` 5.0.5, `jsdom` 30.1.3, `@testing-library/react` 16.3.3. Otherwise same as `web/` (O1), except `next` + `eslint-config-next` 16.4.2 (security upgrade 2026-10-22, `experimental.agentUpgrade: "security"`; `web/` is still on 16.4.0): `react`/`react-dom` 19.3.0, `better-auth` 1.7.7 (exact, as in eval), `pg` 8.23.1, `zod` 4.6.5, `@upstash/ratelimit` 2.2.0, `@upstash/redis` 1.39.0, `@base-ui/react` 1.8.0, `tailwindcss` 4.3.3, `typescript` 5.9.3.
- 3D, exact (O2): `three` 0.186.1, `@react-three/fiber` 9.8.2, `@react-three/drei` 10.7.9, `@react-three/rapier` 2.2.0 (rapier3d-compat 0.19.2), `@react-three/postprocessing` 3.1.3 + `postprocessing` 6.39.5, `zustand` 5.0.16, `howler` 2.2.4, `suncalc` 2.1.1; types `@types/three` 0.186.0, `@types/howler` 2.2.13, `@types/suncalc` 1.9.2; `@playwright/test` 1.64.1 (Chromium 1248).
- Chat (O5, same as `web/`): `eventsource-parser` 4.1.1, `swr` 2.5.1, `react-markdown` 10.1.0, `remark-gfm` 4.0.1. PDF (O6, exact, as `web/`): `react-pdf` 11.0.0, `pdfjs-dist` 6.3.289 (its chunk is lazy, 198 KB gz; the worker is a bundled asset).

## Gotchas already known
- **Localhost cookies:** :3000 (DocuMind), :3100 (Eval) and :3200 (Office) share cookies, hence the distinct cookie prefix.
- **Under `cacheComponents`,** session reads sit inside `<Suspense>`, and route segment `runtime`/`dynamic` exports are rejected. Running `pnpm typecheck` (`next typegen`) while `next dev` is up can corrupt the dev cache; use `npx tsc --noEmit` instead (root CLAUDE.md).
- **Eval orgs** (`organization.metadata` `{"eval": true}`) must not appear in the org picker, even for admins. **Scope:** filter documents on `indexed_at != null`, not `status` (reindexing keeps the old chunks searchable).
- **A scoped conversation keeps its scope.** Changing the country chip in a Worldwide room must start a new conversation.
- **From this machine** a DocuMind/DB round trip is about 0.45 s. Batch the office DB writes (debounced `saveProgress`).
- **`/v1/me` lists every org to platform admins, eval orgs included,** and carries no metadata: filter with `withoutEvalOrgs()` (SQL on `organization.metadata`). `requireOrgAccess` treats eval orgs as not found.
- **Bans:** the sign-in hook refuses banned users (`ACCOUNT_BANNED`); `requireSession()` and the BFF re-check `banned`/`banExpires` on every request, because a ban set in DocuMind doesn't revoke this app's sessions.
- **Stopping `pnpm dev` from a background task** can leave the `node` child holding :3200; kill it by port and delete `.next/dev` if typecheck ran alongside.
- **3D gotchas (O2):**
  - **Rapier objects live in effects, not `useMemo`:** StrictMode's mount-unmount-mount frees a memoized character controller and keeps returning it. Free controllers with `kcc.free()`, never `world.removeCharacterController`: `<Physics>` frees its world first, and touching its proxy afterwards silently creates a new world.
  - **Esc and dialogs:** the game's keydown listener is capture-phase and opens the menu on the next task; opened synchronously, Base UI attaches its Escape listener in time to close it on the same press.
  - **The react-hooks lint (React Compiler rules) rejects mutating hook values** (`useMemo` objects, `useThree().camera`, props). Use `state.camera` inside `useFrame`, refs for reused objects, module-level state, or plain helper functions.
  - **three r186 dropped `PCFSoftShadowMap`:** the Canvas uses `shadows="percentage"`. R3F still uses the deprecated `THREE.Clock`, and rapier-compat warns about its init signature; both warnings are harmless.
  - **Disposal:** R3F disposes only JSX-created geometries/materials. Shared module-level ones (avatar parts) are kept on purpose; per-instance materials and canvas textures are disposed in effects. Over 6 transitions, `renderer.info.memory` stayed at 45 geometries / 4 textures.
  - **`spawn.yaw` is the avatar's heading** (0 faces +z); the camera starts half a turn behind it. Seats use the same convention.
  - **Playwright WebGL** runs on SwiftShader (`--enable-unsafe-swiftshader`), so the auto tier drops to low there and frame rates mean nothing (a city runs ~15 fps at 1280×720; the player's step clamp is 1/10 s so slow devices still walk at full speed). The dev-only `window.__office` exposes `getState`/`setState`, `memory()` and `render()`. A test that hits its timeout can skip `finally`: clean up throwaway users in `afterAll`.
- **Globe/picker gotchas (O3):**
  - **Bundles:** the picker page must not import from `GlobeRig` or other canvas modules (that pulls three into its 150 KB entry); shared constants live in `globe-store.ts`.
  - **R3F raycasts only objects with handlers,** so the Earth mesh carries no-op `stopPropagation` handlers to hide back-side pins from the pointer.
  - **Light-mode contrast:** ACES tone mapping washed the pale land into the pale sea; the globe canvas is `flat`, with lights tuned to it.
  - **Clock reads in Server Components** trip `react-hooks/purity`; read it in an async helper after `await connection()`.
  - **`placeLabels`** hides a label that can't fit cleanly (the hovered/chosen one is always shown); the pin stays.
  - **Playwright helpers:** `createTestUser(name, { admin, orgs })` adds memberships; `officeQuery()` reads office tables.
- **City gotchas (O4):**
  - **suncalc 2.1 returns degrees,** with azimuth clockwise from north (0 N, 90 E); `@types/suncalc` still describes radians from south. World axes: x east, z south.
  - **Next keeps a visited game route mounted but hidden (Activity).** R3F releases the hidden canvas's renderer, but the route shows again (Back, re-picking a city) with stale state while the store singleton holds another game: `GameRoot` re-runs `initGame` on every show (`useReinitOnReveal`). The page keys `GameClient` by place.
  - **Draw calls:** high tier's post-processing leaves only its last pass in `renderer.info`; measure on medium (shadows on). Cities: ~55–60 low, ~90–115 medium. R3F disposes on an idle callback and a city takes longer: the sandbox memory test waits 3 s per entry (it settles at 44 geometries / 2 textures).
  - **Kinematic player vs. fixed sensors raise no intersection events;** doorways use `Trigger` (point-in-box per frame).
  - **React Compiler lint:** `useMemo` needs an inline function and a literal deps array (`Merged` takes a `version` string); no ref reads in render; per-frame sim state lives in refs, not memo values.
  - **No environment map,** so metalness only darkens glass: keep it ~0. The hub island's rim hides anything >10° below the horizon from the plaza (hence the globe's placement).
- **Office/chat gotchas (O5):**
  - **DocuMind's SSE carries `: ping` keep-alive comments** (sse-starlette); `eventsource-parser` skips them, and the recorded fixture (`tests/fixtures/chat-answer.sse`) keeps one.
  - **A focus-trapping dialog hides the HUD from the accessibility tree** (Base UI marks the outside inert): Playwright's `getByRole` won't find HUD items while the NPC panel is open; use CSS locators.
  - **`<fieldset>` won't shrink and scroll inside a flex column**; the card list is a `div role="group"`.
  - **Interiors are seen from above:** the third-person camera rises over 3.2 m walls, so the ceiling and its light panels are downward-facing planes (invisible from above). The lobby spawn sits 3.6 m inside with pitch 0.5 so the camera clears the street wall instead of framing the door opening.
  - **drei `Html` scales with `distanceFactor` unclamped:** at dialogue framing (~3 m) tags balloon; NPC tags use 6, and the player's tag hides while `cameraFocus` is set.
  - **Doors** remove their collider while open (React state flips only on change); locked doors register an `Interactable` only while locked (`card:*` = any card, `unlock:rooftop` is met by `store.unlocks` once the 5 core quests are done).
- **Rooms/citations gotchas (O6):**
  - **NPC tags and bubbles are DOM (drei `Html`) and show through walls:** pass `seenFrom` (breadcrumb room names) to `Npc`.
  - **The PDF sheet is a Base UI dialog nested inside the NPC dialog** (rendered in its Popup), so Esc/outside clicks close the sheet first; `closeModal` closes the viewer too.
  - **Decor colliders must stay inside the 3.9 m inner half-size** and off the door/expert lanes; `tests/rooms.test.ts` checks every set.
  - **React Compiler:** a value derived from a call (`clockOffices(…)`) can't feed a `useMemo` dep; memoize it first.
  - **Progress trust model:** the client is trusted for game progress (it's a game). `recordStats` and `saveProgress` only bound the values (zod) and merge monotonically; scores are bounded separately (O8). So a determined player can mark a quest done, and the rooftop is not a secret.
- **Presentation gotchas (O7):** `Html transform` draws over the canvas, so a mesh hidden behind something still shows its DOM (the screen plane once sat inside its frame box: the video went black while slides looked fine); keep the screen proud of the frame. Occlusion raycasts only the room's invisible wall boxes (cheap). drei caches `useVideoTexture` by URL (never disposed); it waits for `loadeddata` with `preload: "auto"`. Seated E/Esc stand up (all seats); on `Seat.view` seats ←/→ page slides and only ↑/↓ stand. `window.__office.events` logs bus events (dev only). Keep slide content out of `content/orgs/index.ts` (the pickers import it).
- **Play area gotchas (O8):** (1) A backdrop blur behind a canvas that redraws every frame is re-composited each frame (headless fps fell 60 → ~15 in Sort & Toss): the game dialog drops it, so keep full-screen game overlays blur-free; the 3D canvas stops (`frameloop="never"`) 1.1 s after a game opens. (2) Games are DOM + 2D canvas, not rapier: Sort & Toss uses a closed-form arc (`landing()`), table tennis its own ball model; a canvas `font` can't take `var(--font-…)` (use `games/font.ts`). (3) Game time is capped at 50 ms a frame, so a 60 s round can take longer on a slow machine (the e2e bot allows 240 s); tests read `data-item`/`data-score`/`data-landed` (Sort & Toss) and `data-phase`/`data-score` (table tennis) off the game's root.
  - **Scores:** the client is trusted, bounded by `games/scoring.ts` (schema + cross-checks) and one submit per 10 s (Upstash `office:score:<userId>`, backed by a DB check); zero-point rounds aren't saved. Boards list each player's best: members and platform admins only, never `hide_from_leaderboard` players; "week" = the last 7 days.
  - **A new org's trivia:** add `src/content/orgs/<slug>-trivia.json` (+ `.evidence.json`, ≥ 10 questions; fields in `trivia/bank.ts`), register it in `trivia/banks.ts`, run `check-trivia-bank.py`. Questions are written offline from the PDFs, never by an LLM call at runtime.
- **Quests/rooftop gotchas (O9):**
  - **Stats and events:** the engine's sets (`asked_*`, `offices_entered`, `departments_entered`, `npcs_met`) save by union; `citations_opened`, `rooms_visited`, `cities_visited` belong to `recordStats`/`recordVisit` (read by the engine, never written by a save). Orientation is the *company* deck (`presentation_watched` fires for both). `city_entered` carries the local `hour` (Early bird 04:00–08:00; the hub earns neither time achievement). Travelling awaits `flushProgress()`, or the next page loads stale progress.
  - **Rooftop:** reduced motion makes fireworks bloom and fade in place and skips the "Show me" trail (the minimap marker stays). The panorama is the street's `generateCity` lowered by the tower's height; Worldwide's deck floats over a big `Earth`.
- **Testing the shared chat limit:** spend the window with DocuMind's own `web/src/lib/rate-limit.ts` (tsx, `--conditions=react-server`, import via `pathToFileURL` on Windows), then POST `orgs/{id}/chat` through :3200 and expect 429. A POST that passes the limit runs a real (billed) chat.

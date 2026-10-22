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
**O2 done (2026-10-22):** engine core, proven in the dev-only `/dev/sandbox`. **O3 is next** (org & location selection). O1: scaffold, sign-in, BFF, `documind_office_dev` schema, placeholder home (org list).

## Layout (as built)
- `src/lib/`: `auth` (Better Auth), `auth-guards` (`requireSession`, `requireOrgAccess`, `withoutEvalOrgs`), `account` (ban/admin rules, client-safe), `db` (one pool: auth `search_path`, max 3), `db-url`, `office-db` (`query()` with `{office}`), `api` (`apiFetch`/`apiJson`; `userId` optional in Server Components), `api-types`, `rate-limit`, `backend-path` (BFF path rules), `player` (zod schemas, `defaultDisplayName`), `org-meta`, `site`.
- `src/app/(game)/actions.ts`: `getPlayer()` (upsert on first read, one round trip) and `savePlayer({avatar, settings})` (zod; **shallow-merges** both jsonb objects).
- `src/app/(game)/page.tsx`: placeholder home (org list, empty state → DocuMind `/app/join`); `(game)/layout.tsx` top bar + user menu.
- `src/app/(auth)/sign-in` + `components/auth/directory-panel.tsx` (the lobby directory companion panel). `src/proxy.ts`: optimistic cookie redirects.
- `db/migrations/0001_init.sql`, `scripts/migrate.mjs` (advisory lock; one transaction per file), `scripts/auth-check.ts`, `tests/` (Vitest), `e2e/` (Playwright; `support/test-user.ts` makes a signed-in throwaway user).
- **Game (O2), `src/game/`:** `GameRoot` (client root: store init, keyboard, motion, audio unlock, settings persistence, first-look editor, dev handle) loaded by `components/game/game-client.tsx` (`dynamic`, `ssr: false`).
  - `store/game-store.ts` (zustand `useGame`: world/transition phase, input, player, interactables, focus, modal, settings, quality); `player/rig.ts` holds per-frame values (camera yaw, exact position).
  - `engine/`: `GameCanvas` (tiers, PerformanceMonitor, AdaptiveDpr), `SceneManager` (lazy scene per key, each in its own keyed `<Physics>`), `Loading` (curtain; it drives the transition timers), `quality.ts`, `SunLight`, `QualityApplier`, `PostFx` (lazy, high tier).
  - `input/` (bindings, joystick, `use-keyboard`), `interact/` (`select.ts` pure, `Interactable`, `InteractionSystem`, `interact.ts`), `player/` (`Avatar` + `avatar-clips` + `avatar-style`, `Player` (KCC), `FollowCamera`), `audio/audio.ts` (Howler buses), `quests/bus.ts`, `settings.ts`, `persist.ts`, `world/kit.tsx` (`Block`, `useSignTexture`), `world/sandbox/`, `world/placeholder/` (stands in for city/office/rooftop).
- **HUD, `src/components/hud/`:** `hud` (breadcrumb, quota + minimap slots, menu button), `interaction-prompt`, `game-menu` (Esc: settings, controls), `avatar-editor`, `sign-dialog`, `dialogue-panel`, `touch-controls`. Page: `src/app/dev/sandbox/page.tsx` (`notFound()` in production).

## Commands
```bash
cd office && pnpm dev            # :3200 (DocuMind api must run on :8000; MinIO for PDFs)
cd office && pnpm typecheck | pnpm lint | pnpm test | pnpm build
cd office && pnpm test:e2e       # Playwright on :3200 (starts or reuses `pnpm dev`; needs the dev DB)
cd office && node scripts/migrate.mjs [--dry-run]   # documind_office(_dev) schema; re-run = no-op
cd office && pnpm auth:check     # read-only: DocuMind owns the auth tables
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
- **Tests:** `*.test.ts` run in node; `*.dom.test.tsx` in jsdom (`vitest.config.mts` projects). `server-only` is aliased to a stub, so server modules are importable.
- **Files:** use the Write/Edit tools, never shell heredocs. **Git:** commit and push only when the user asks (`/ship`).

## Environment
The keys are in the root `.env.local`; see README › Environment.
- The office's own keys are `OFFICE_*`.
- Shared keys: `DATABASE_URL`, `API_BASE_URL`, `DOCUMIND_API_KEY` (server-only), `GOOGLE_*`, `UPSTASH_*`, `NEXT_PUBLIC_APP_URL`.
  - `NEXT_PUBLIC_APP_URL` is **DocuMind's** URL, used for "Continue in DocuMind" and "Forgot password". It's set at build time.

## Pinned versions
- Same as `web/` (O1): `next` 16.4.0, `react`/`react-dom` 19.3.0, `better-auth` 1.7.7 (exact, as in eval), `pg` 8.23.1, `zod` 4.6.5, `@upstash/ratelimit` 2.2.0, `@upstash/redis` 1.39.0, `@base-ui/react` 1.8.0, `tailwindcss` 4.3.3, `typescript` 5.9.3.
- Tests: `vitest` 5.0.5, `jsdom` 30.1.3, `@testing-library/react` 16.3.3.
- 3D, exact (O2): `three` 0.186.1, `@react-three/fiber` 9.8.2, `@react-three/drei` 10.7.9, `@react-three/rapier` 2.2.0 (rapier3d-compat 0.19.2), `@react-three/postprocessing` 3.1.3 + `postprocessing` 6.39.5, `zustand` 5.0.16, `howler` 2.2.4, `suncalc` 2.1.1; types `@types/three` 0.186.0, `@types/howler` 2.2.13, `@types/suncalc` 1.9.2; `@playwright/test` 1.64.1 (Chromium 1248). `swr` arrives with O3.
- **Game route JS (O2, sandbox):** 443 KB gz excluding rapier's chunk (budget 1.5 MB); rapier-compat's chunk with its base64 wasm is 810 KB gz on its own.

## Gotchas already known
- **Localhost cookies:** :3000 (DocuMind), :3100 (Eval) and :3200 (Office) share cookies, hence the distinct cookie prefix.
- **Under `cacheComponents`,** session reads sit inside `<Suspense>`, and route segment `runtime`/`dynamic` exports are rejected. Running `pnpm typecheck` (`next typegen`) while `next dev` is up can corrupt the dev cache; use `npx tsc --noEmit` instead (root CLAUDE.md).
- **Eval orgs** (`organization.metadata` `{"eval": true}`) must not appear in the org picker, even for admins.
- **Scope:** filter documents on `indexed_at != null`, not `status` (reindexing keeps the old chunks searchable).
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
  - **Playwright WebGL** runs on SwiftShader (`--enable-unsafe-swiftshader`), so the auto tier drops to low there and frame rates mean nothing. The dev-only `window.__office` exposes `getState`/`setState`, `memory()` and `render()`. A test that hits its timeout can skip `finally`: clean up throwaway users in `afterAll`.
- **Testing the shared chat limit:** spend the window with DocuMind's own `web/src/lib/rate-limit.ts` (tsx, `--conditions=react-server`, import via `pathToFileURL` on Windows), then POST `orgs/{id}/chat` through :3200 and expect 429. A POST that passes the limit runs a real (billed) chat.

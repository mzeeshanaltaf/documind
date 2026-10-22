# Phase O10 — Polish, Accessibility, Performance & Deploy

**Goal:** make DocuMind Office fast, accessible and polished, then ship it to `https://office.documind.zeeshanai.cloud` with auto-deploy on push.

**Depends on:** O1–O9.

## Skills to load
`/impeccable` (audit and polish), `/vercel-react-best-practices`, `/add-app-to-coolify`, `/umami-analytics`.

## Known facts
- **Deploy pattern** (Status.md › Production):
  - Coolify 4.3 at `https://coolify.zeeshanai.cloud`, project **DocuMind** `vh71w2o5wsavqnhfsu6pucdc`, server `j1234smx72kcb6aeovlaa9f7`, env `production`;
  - the apps are on the `coolify` network, and the DocuMind API is reachable internally as `http://documind-api:8000`;
  - web health is `GET /robots.txt` with **`health_check_host=127.0.0.1`** (Alpine resolves `localhost` to `::1`).
- **`evaluation/web/Dockerfile`** is the template: repo-root context, node:24-alpine, corepack pnpm, standalone output, port 3000.
- **`.github/workflows/deploy.yml`:** paths-filter, then lint/typecheck, then `.github/scripts/coolify-deploy.sh <APP_UUID>`. Coolify "Auto Deploy" is off on all apps. A `.dockerignore` change redeploys every app.
- **The VPS disk fills with Docker build cache.** Run `df -h /` before deploying and check the weekly prune cron (global CLAUDE.md).
- **Prod secrets** go in Coolify and in the owner's `.env.production.local`. Never echo them.

## 1. Performance
- **Bundles:** analyze them with `next build` output plus `@next/bundle-analyzer`. Scenes and games are lazy chunks, and drei is imported per module.
- **Assets:**
  - all GLBs go through gltf-transform (Meshopt or Draco, deduplicated, texture atlases or KTX2), with the decoder paths configured;
  - preload the next likely scene (city to office) while idle.
- **Draw calls:** audit per scene (`renderer.info`), instance or merge whatever exceeds the budget, and freeze static matrices (`matrixAutoUpdate = false`).
- **Memory:** dispose geometries, materials and textures on scene unmount. Check 10 scene transitions for stable `renderer.info.memory`.
- **Quality tiers:** check the automatic downgrade on a throttled CPU. The low tier has no shadows, the sky dome, fewer NPCs and DPR 1.
- **Record** the final numbers in Status.md (JS per route, time to first interactive city, fps per tier).

## 2. Accessibility & UX
- **Audit:** run `/impeccable` over every DOM surface (sign-in, org picker, location list, HUD, dialogue, PDF sheet, journal, menus, game HUDs, leaderboard) in light and dark (OS-driven, as in DocuMind). Every text pair must be ≥ 4.5:1.
- **Keyboard:** every flow is completable by keyboard, with visible focus rings. The dialogue and menus trap focus and restore it on close.
- **Screen readers:**
  - an `aria-live` region announces location changes, prompts, quest toasts and answers;
  - the location list and "View full screen" slides make the core content reachable without WebGL.
- **No-WebGL fallback:** if WebGL fails, show a friendly page with "Open DocuMind" and the org's location list.
- **Reduced motion:** check every animation path (globe, camera fly, fireworks, guide line, bob).
- **Mobile:** joystick ergonomics, a landscape hint, HUD safe areas, no horizontal scroll at 360 px for the DOM pages.

## 3. Analytics (optional; owner creates the Umami website)
- **Wiring:** the same pattern as DocuMind's `web/src/lib/analytics.ts`: production-only gate, `data-domains="office.documind.zeeshanai.cloud"`, and a typed `track()` that waits for the script.
- **Events** (no PII, no message content):

  | Event | Properties |
  |---|---|
  | `office_entered` | `location` |
  | `question_asked` | `department`, `location` |
  | `cards_issued` | `count` |
  | `citation_opened` | — |
  | `game_finished` | `game` |
  | `quest_completed` | `id` |
  | `rooftop_unlocked` | — |

- **Env:** `NEXT_PUBLIC_UMAMI_SCRIPT_URL` (shared) plus `NEXT_PUBLIC_OFFICE_UMAMI_WEBSITE_ID`, both build-time.

## 4. Privacy
- **What the office stores:** progress, scores, an avatar look and a leaderboard name (first name plus initial, visible to the org's members, with a hide option).
- **Owner decision:** add a short section to DocuMind's `/privacy`, or a `/privacy` page in the office linking to it. The DocuMind privacy page was legally reviewed, so changes need the owner's sign-off.

## 5. Deploy
1. **`office/Dockerfile`:** copy the eval web Dockerfile with these changes:
   - paths under `office/`;
   - build args `NEXT_PUBLIC_APP_URL` (+ the Umami variables);
   - copy `public/` (assets, video);
   - copy `db/` and `scripts/migrate.mjs` into the runner, so `docker exec <ctr> node scripts/migrate.mjs` works.
2. **DNS:** an A record `office.documind` → 76.13.7.106, TTL 300 (Hostinger DNS MCP).
3. **Coolify app `documind-office-web`** (`/add-app-to-coolify`):
   - Dockerfile `/office/Dockerfile`, port 3000, domain `https://office.documind.zeeshanai.cloud`;
   - health check `/robots.txt` on `127.0.0.1`;
   - Auto Deploy off.
4. **Env:**
   - **Build-time:** `NEXT_PUBLIC_APP_URL=https://documind.zeeshanai.cloud` (+ Umami).
   - **Runtime:**
     - `DATABASE_URL` (prod, `schema=documind`), `OFFICE_AUTH_SCHEMA=documind`, `OFFICE_DB_SCHEMA=documind_office`;
     - `OFFICE_BETTER_AUTH_SECRET` (**new**), `OFFICE_BETTER_AUTH_URL` = `OFFICE_PUBLIC_URL` = the prod URL;
     - `API_BASE_URL=http://documind-api:8000`, `DOCUMIND_API_KEY` (prod);
     - `GOOGLE_CLIENT_ID/SECRET` (prod client), `UPSTASH_*`.
   - Store the new values in `.env.production.local`.
5. **Owner:** add the Google redirect URI `https://office.documind.zeeshanai.cloud/api/auth/callback/google`.
6. **Migrate prod:** `docker exec <office ctr> node scripts/migrate.mjs` creates `documind_office`.
7. **`deploy.yml`:**
   - an `office` paths filter (`office/**`);
   - a check job (`pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`);
   - a deploy job with the new app UUID.
   - Also record the UUID in Status.md › Production.
8. **Docs:** update `office/CLAUDE.md`, Status.md (Production rows, phase table, session log) and the root `CLAUDE.md` pointer line.

## Acceptance
- **Prod:**
  - `https://office.documind.zeeshanai.cloud/robots.txt` returns 200;
  - Google and email sign-in work for a non-admin member;
  - Lahore loads; the HR expert answers with citations;
  - the conversation appears in DocuMind's chat history, and the quota decreased in DocuMind's composer line.
- **Deploy pipeline:** a push touching `office/**` deploys only the office app, after lint, typecheck and tests pass.
- **Audit:** the `/impeccable` findings are fixed or logged as follow-ups. The performance numbers are recorded and within the README budgets, or the deviations are explained.
- **Assets:** `LICENSES.md` lists every third-party asset with its source and licence.

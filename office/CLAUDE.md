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
**O1 done (2026-10-22):** scaffold, sign-in, BFF, `documind_office_dev` schema, placeholder home (org list). **O2 is next.** No 3D yet.

## Layout (as built)
- `src/lib/`: `auth` (Better Auth), `auth-guards` (`requireSession`, `requireOrgAccess`, `withoutEvalOrgs`), `account` (ban/admin rules, client-safe), `db` (one pool: auth `search_path`, max 3), `db-url`, `office-db` (`query()` with `{office}`), `api` (`apiFetch`/`apiJson`; `userId` optional in Server Components), `api-types`, `rate-limit`, `backend-path` (BFF path rules), `player` (zod schemas, `defaultDisplayName`), `org-meta`, `site`.
- `src/app/(game)/actions.ts`: `getPlayer()` (upsert on first read, one round trip) and `savePlayer({avatar, settings})` (zod; **shallow-merges** both jsonb objects).
- `src/app/(game)/page.tsx`: placeholder home (org list, empty state → DocuMind `/app/join`); `(game)/layout.tsx` top bar + user menu.
- `src/app/(auth)/sign-in` + `components/auth/directory-panel.tsx` (the lobby directory companion panel). `src/proxy.ts`: optimistic cookie redirects.
- `db/migrations/0001_init.sql`, `scripts/migrate.mjs` (advisory lock; one transaction per file), `scripts/auth-check.ts`, `tests/` (Vitest).

## Commands
```bash
cd office && pnpm dev            # :3200 (DocuMind api must run on :8000; MinIO for PDFs)
cd office && pnpm typecheck | pnpm lint | pnpm test | pnpm build
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
- `swr` and the 3D packages arrive with the phases that use them (O2+); record them here.

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
- **Testing the shared chat limit:** spend the window with DocuMind's own `web/src/lib/rate-limit.ts` (tsx, `--conditions=react-server`, import via `pathToFileURL` on Windows), then POST `orgs/{id}/chat` through :3200 and expect 429. A POST that passes the limit runs a real (billed) chat.

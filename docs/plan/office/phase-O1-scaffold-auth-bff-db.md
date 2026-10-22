# Phase O1 — Scaffold, Auth, BFF & DB

**Goal:** a running `office/` Next.js app on :3200 that does four things:
- signs people in with their DocuMind accounts;
- proxies DocuMind's API through its own BFF (sharing the chat rate limit with DocuMind);
- owns a migrated `documind_office` schema;
- shows a placeholder home that lists the user's orgs.

There's no 3D yet.

**Depends on:** nothing (DocuMind running locally). **Unblocks:** O2, O3.

## Skills to load
`/nextjs-best-practices`, `/vercel-react-best-practices`, `/shadcn`, `/better-auth-best-practices`, `/impeccable` (sign-in page only).

## Known facts
- **Next 16.4 with `cacheComponents`.** Copy `web/AGENTS.md` and read `node_modules/next/dist/docs/` before writing Next code. Route segment `runtime`/`dynamic` exports are rejected.
- **The template is `evaluation/web`:** read its `src/lib/auth.ts`, the BFF `src/app/api/backend/[...path]/route.ts`, `next.config.ts` (the hand-rolled root `.env.local` loader; here the path is `..`, not `../..`), `scripts/auth-check.ts` and `Dockerfile`.
- **Cookies.** On localhost :3000, :3100 and :3200 share cookies, so set `cookiePrefix: "documind-office"`. Never enable `crossSubDomainCookies`.
- **DocuMind's BFF rate-limits chat** with `limitChat(userId)` (`web/src/lib/rate-limit.ts`): Upstash, sliding 30/min, prefix `documind:ratelimit`, key `chat:${userId}`, `CHAT_PATH = /^orgs\/[^/]+\/chat$/`, fail-open. Copy it with the **same prefix and key**, so DocuMind and Office share one window.
- **Auth tables:** see Status.md › Better Auth tables (camelCase columns, quoted `"user"`).

## 1. Scaffold — `office/`
- Next 16.4, React 19.3, pnpm, TS strict, Tailwind v4, shadcn (`base-nova`, the same as `web/`), `cacheComponents`, `output: "standalone"`, `serverExternalPackages: ["pg"]`.
- `pnpm dev` runs on **:3200**.
- Copy from `web/` and record the sync date in `office/CLAUDE.md`:
  - the `globals.css` tokens;
  - fonts (Source Serif 4, Instrument Sans, Geist Mono) via `next/font`;
  - the `components/ui/*` that are needed;
  - `ButtonLink`;
  - the logo mark.
- **Wordmark:** "DocuMind" with an "Office" label.
- Scripts: `dev`, `build`, `start`, `lint`, `typecheck` (`next typegen && tsc --noEmit`), `test` (Vitest), `db:migrate`, `auth:check`.
- Add a Vitest config (`environment: node` by default, `jsdom` for `*.dom.test.tsx`).

## 2. Auth — `src/lib/{auth,auth-client,auth-guards,db}.ts`, `src/app/api/auth/[...all]/route.ts`
- **Config:** copy `evaluation/web/src/lib/auth.ts` with these differences:
  - `appName: "DocuMind Office"`;
  - `baseURL: OFFICE_BETTER_AUTH_URL`, `secret: OFFICE_BETTER_AUTH_SECRET` (throw in production if it's missing);
  - `trustedOrigins: [OFFICE_PUBLIC_URL]`;
  - `cookiePrefix: "documind-office"`.
  - Keep `disableSignUp`, `requireEmailVerification`, `sendOnSignIn: false`, the read-only `additionalFields`, the full `disabledPaths` list and `nextCookies()` last.
- **Gate:** `databaseHooks.session.create.before` refuses a **banned** user. Unverified email/password users are already refused by Better Auth; send them to DocuMind to verify. **There is no admin requirement.**
- **Database:** `pool` on `DATABASE_URL` with `search_path = OFFICE_AUTH_SCHEMA`, `max: 3`. Normalize the Prisma-style params the same way `evaluation/web/src/lib/db.ts` does.
- **Guards:**
  - `requireSession()` (`cache`d) in every layout, page and Server Action;
  - `requireOrgAccess(orgId)` returns `{user, org, role, isAdmin}`, or `notFound()`/throws. It's a SQL check: the user is a platform admin, or a `member` row exists.
- **Sign-in page `(auth)/sign-in`:** Google plus email/password, with inline `?error=` messages. "Forgot password" and "Create an account" link to DocuMind (`NEXT_PUBLIC_APP_URL`).
- **`scripts/auth-check.ts`** (read-only, as in eval): run it and confirm nothing would be migrated.

## 3. BFF — `src/app/api/backend/[...path]/route.ts`, `src/lib/{api,api-types,rate-limit}.ts`
- **Proxy:** copy the eval BFF, with these changes:
  - no admin check;
  - upstream is `API_BASE_URL` with `X-API-Key: DOCUMIND_API_KEY` + `X-User-Id`;
  - forward `content-type` and `accept` only;
  - add `content-disposition`, `content-length` and `accept-ranges` to the forwarded response headers (for PDFs);
  - set `maxDuration = 300`.
- **Rate limit:** on `POST` to `CHAT_PATH`, run `limitChat`. A refusal returns 429 `rate_limited` with `Retry-After`, using the same message as DocuMind.
- **Path safety:** refuse `.`/`..`/empty segments and re-encode each segment.
- **`api.ts`:** `apiFetch`/`apiJson`/`readApiError` (server-only) for Server Components.
- **`api-types.ts`:** copy the types from `web/src/lib/api-types.ts`: `Me`, `Org`, `DocumentOut`, `Quota`, `Routing`, `Source`, `Citation`, `MessageUsage`, `ApiErrorBody`, `DEPARTMENTS`, `DOC_TYPES`.

## 4. Office DB — `office/db/migrations/0001_init.sql`, `scripts/migrate.mjs`, `src/lib/office-db.ts`
- **`migrate.mjs`** is plain Node ESM, so it also runs inside the standalone image later:
  - reads the root `.env.local` when present;
  - creates `{office}` and `{office}.schema_migrations`;
  - applies each unapplied `NNNN_*.sql` in its own transaction, after replacing `{office}`/`{auth}`;
  - `--dry-run` prints the SQL.
- **`0001_init.sql`:** `players`, `progress` and `game_scores`, as in [README › Data model](README.md#data-model-documind_office-dev-documind_office_dev).
  - FKs point to `{auth}."user"(id)` and `{auth}.organization(id)`, both `ON DELETE CASCADE`.
  - CHECK on `game`, and `score >= 0`.
- **`office-db.ts`:** a `query()` helper that schema-qualifies through a constant built from `OFFICE_DB_SCHEMA`, validated against `^[a-z_][a-z0-9_]*$`.
- **Server Actions** (`src/app/(game)/actions.ts`), each starting with `requireSession()`:
  - `getPlayer()`: upsert on first read; `display_name` defaults to the first name plus last initial;
  - `savePlayer({avatar, settings})`: zod-validated.

## 5. Placeholder home — `src/app/(game)/page.tsx`
- A Server Component inside `<Suspense>`. It reads `apiJson<Me>("/me")` and lists the org names.
- No orgs: show "You're not in an organization yet" plus a link to DocuMind `/app/join`.
- Sign-out sits in a small user menu.

## 6. Env & docs
- **`.env.example`:** add an "Office (office/; see docs/plan/office/README.md › Environment)" block with every `OFFICE_*` key, without values. Fill `.env.local` with the Edit tool and generate a new secret.
- **Owner:** add the Google redirect URIs `http://localhost:3200/api/auth/callback/google` (and later the prod one). Email/password works without them.
- Update `office/CLAUDE.md` (commands, pinned versions, gotchas) and Status.md.

## Acceptance
- `cd office && pnpm typecheck && pnpm lint && pnpm build && pnpm test` are clean.
- `pnpm auth:check` reports no changes.
- `node scripts/migrate.mjs` creates `documind_office_dev` with the three tables. A re-run is a no-op.
- A non-admin `simtora` member signs in on :3200 and sees "Simtora Technologies". A banned user is refused.
- Signing in on :3200 doesn't sign anyone out of :3000 (distinct cookie prefix).
- `GET /api/backend/me/quota` returns the user's quota. Without a session it returns 401.
- `GET /api/backend/orgs/{id}/documents/{doc}/file` streams a PDF.
- A `POST …/chat` gets 429 `rate_limited` after DocuMind's limit is used up from either app (temporarily lower the limit locally to test).
- Deleting a test user cascades their `players`/`progress` rows.

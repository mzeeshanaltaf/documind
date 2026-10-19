# Phase E5 — Eval Web, Auth & First Deploy

**Goal:** A Next.js app, admin-only, for:
- datasets: list, versions, editor, import and export;
- runs: list, new-run form, run detail with live progress, case drill-down.

It uses DocuMind's design system and signs people in with their DocuMind accounts. Both eval apps go to Coolify, the web at `https://evaluation.documind.zeeshanai.cloud`.

**Depends on:** E4. **Unblocks:** E6.

## Skills to load
- `/nextjs-best-practices`
- `/vercel-react-best-practices`
- `/shadcn`
- `/better-auth-best-practices`
- `/impeccable`
- `/dataviz`
- `/add-app-to-coolify`

## Known facts
- **Next 16.4 with `cacheComponents`.** Read `node_modules/next/dist/docs/` before writing Next code (see DocuMind's `web/AGENTS.md`; copy it). Route segment `runtime`/`dynamic` exports are rejected.
- **DocuMind's Better Auth config** (`web/src/lib/auth.ts`):
  - email/password with `requireEmailVerification`;
  - Google;
  - plugins emailOTP, organization, admin, nextCookies.
  - The auth tables and columns are listed in Status.md › Better Auth tables.
- **Cookies.** DocuMind's cookie is host-only on `documind.zeeshanai.cloud`, so it never reaches the eval subdomain. **On localhost, :3000 and :3100 share cookies,** which is why the eval app needs a distinct `cookiePrefix`. Never enable `crossSubDomainCookies` in either app.

## 1. Scaffold — `evaluation/web/`
- Next 16.4, pnpm, TS strict, Tailwind v4, shadcn (`base-nova`), `cacheComponents`.
- `next.config.ts` loads `../../.env.local` with the same hand-rolled loader as `web/next.config.ts`. `pnpm dev` runs on **:3100**.
- Copy from `web/`, recording the sync date in `evaluation/CLAUDE.md`:
  - the `globals.css` tokens;
  - `components/ui/*` (the ones used);
  - the fonts (Source Serif 4, Instrument Sans, Geist Mono) and the `ButtonLink` pattern.
- **Wordmark:** "DocuMind" with an "Evaluation" label.

## 2. Auth — `src/lib/auth.ts`, `auth-client.ts`, `auth-guards.ts`, `db.ts`
- **Version:** the same `better-auth` version as `web/`.
- **Database:** `pool` on `DATABASE_URL`'s auth schema (`EVAL_AUTH_SCHEMA`), `max: 3`.
- **Better Auth config:**

  | Option | Value |
  |---|---|
  | `appName` | `"DocuMind Evaluation"` |
  | `baseURL` | `EVAL_BETTER_AUTH_URL` |
  | `secret` | `EVAL_BETTER_AUTH_SECRET` (its own, so no cross-app session reuse) |
  | `trustedOrigins` | `[EVAL_PUBLIC_URL]` |
  | `advanced` | `{ cookiePrefix: "documind-eval" }` |
  | `emailAndPassword` | `{ enabled: true, disableSignUp: true, requireEmailVerification: true }` |
  | `emailVerification` | `{ sendOnSignIn: false }` (the eval app sends no email) |
  | `socialProviders.google` | `{ clientId, clientSecret, disableSignUp: true }` (check the option name in the installed docs) |
  | `user.additionalFields` | `role`, `banned`, `banReason`, `banExpires`, all `required: false, input: false`; mirrors the admin plugin's columns without its endpoints |
  | `session.additionalFields` | `activeOrganizationId`, `impersonatedBy` |
  | `plugins` | `[nextCookies()]` |

- **Admin gate:** `databaseHooks.session.create.before` loads `role`, `banned` and `banExpires` for `session.userId` and throws `APIError("FORBIDDEN", { message: "Only DocuMind platform admins can use Evaluation." })` unless the user is an admin and not banned.
- **Guards:** `requireAdmin()` runs in every layout, page and Server Action.
- **Sign-in page:** Google plus email/password. "Forgot password" links to DocuMind's page. Errors (`?error=`) show inline.
- **`scripts/auth-check.ts`** (`pnpm auth:check`, `tsx --conditions=react-server`): runs `getMigrations(auth.options)` and exits non-zero if anything would be created or added. **It never runs migrations, and the eval app has no `auth:migrate` script.**

## 3. BFF — `src/app/api/backend/[...path]/route.ts`, `src/lib/eval-api.ts`
- Same pattern as DocuMind's BFF:
  - validate the session and admin (403 otherwise);
  - forward to `EVAL_API_URL` with `X-API-Key: EVAL_API_KEY` and `X-User-Id`;
  - forward only `content-type`/`accept`;
  - stream unbuffered, with `Cache-Control: no-transform` on SSE.
- **`eval-api.ts`:** `apiJson()` for Server Components and Server Actions. `api-types.ts` holds types that mirror the eval API schemas.

## 4. Pages (Server Components by default; client-only trees via `next/dynamic(..., { ssr: false })`)
| Page | Contents |
|---|---|
| **Shell** | Sidebar: Dashboard, Datasets, Runs, Compare, Trends, Synthetic, Review, Calibration, Settings. Later-phase items appear disabled until built. |
| **Dashboard `/`** | Latest 5 runs (status, progress), key-metric sparklines for the pinned dataset, judge and DocuMind spend this month, DocuMind version and reachability. |
| **Datasets** | `/datasets` list. `/datasets/[id]`: versions and a case table with type/tag filters. `/datasets/[id]/v/[version]`: a case sheet form for drafts, publish, export, and a JSONL import dialog with a mapping preview. |
| **New run `/runs/new`** | Dataset version, org, mode, overrides, metric picker with thresholds, judge models and samples, budget, cleanup toggle, and the estimated cost (from the README cost guide × the case count). |
| **Runs `/runs`** | Filters by dataset, status and tag. |
| **Run detail `/runs/[id]`** | Header (status, progress bar, cost, pause/resume/stop/rejudge/export), metric cards (mean, CI, n, NA count), a slices heatmap (metric × slice), and a per-case table (sortable, pass/fail, filters). Live updates come from the `useRunEvents` hook: `EventSource` through the BFF, with SWR polling as the fallback. |
| **Case drill-down `/runs/[id]/cases/[caseId]`** | Question and setup turns; routing (departments, jurisdiction, standalone query, parts); retrieved contexts (rank, bm25/vector/rrf, relevance label, judge relevance, cited); the answer as Markdown with citation chips (hovering shows the source text); the claims table (verdict, supporting sources, evidence quote in highlighter yellow); per-metric judge reasoning and issues; judge calls with cost; the DocuMind usage breakdown. |
| **Settings `/settings`** | Connectivity (eval API, DocuMind, Anthropic), service users, pricing file shas; `/settings/prompts` and `[key]` show versions and a diff view. |

**Design:** follow `DESIGN.md`. Doc codes, `§` numbers and scores are in Geist Mono. Highlighter yellow is only for evidence and cited spans. The chart palette comes from DESIGN.md › Data visualization. Use no em dashes in UI copy.

## 5. Docker & deploy
- **`evaluation/api/Dockerfile`** (repo-root context):
  - python:3.12-slim + uv, `uv sync --frozen --no-dev`, uid 10001;
  - `CMD alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8100`;
  - curl HEALTHCHECK on `/health`;
  - `ARG SOURCE_COMMIT` → `GIT_SHA`.
- **`evaluation/web/Dockerfile`:** node:24-alpine, a standalone build, and `mkdir -p public` (DocuMind's gotcha). Build args: `NEXT_PUBLIC_APP_URL` only.
- **`.dockerignore`:** add `evaluation/**/.venv`, `evaluation/**/node_modules`, `evaluation/**/.next`, `evaluation/api/tests`.
- **Coolify** (project DocuMind `vh71w2o5wsavqnhfsu6pucdc`):

  | App | Domain | Port | Health | Other |
  |---|---|---|---|---|
  | `documind-eval-api` | **none** | 8100 | `/health` | network alias **`documind-eval-api`** |
  | `documind-eval-web` | `https://evaluation.documind.zeeshanai.cloud` | 3000 | `/robots.txt` | `health_check_host=127.0.0.1` |

  - Env flags use `is_buildtime` / `is_runtime`. Turn Auto Deploy off on both.
- **DNS:** a Hostinger A record `evaluation.documind` → 76.13.7.106, TTL 300.
- **Google OAuth:** add redirect URIs `https://evaluation.documind.zeeshanai.cloud/api/auth/callback/google` and `http://localhost:3100/api/auth/callback/google` (owner action).
- **`.github/workflows/deploy.yml`:**
  - paths-filter entries `eval_api: evaluation/api/**` and `eval_web: evaluation/web/**` (plus `.dockerignore`);
  - check jobs: ruff + `pytest -m "not db and not live"` for the API, pnpm lint + typecheck for the web;
  - deploy jobs with `EVAL_API_APP_UUID` / `EVAL_WEB_APP_UUID` through `.github/scripts/coolify-deploy.sh`.
- **Prod bootstrap:**
  1. Run `bootstrap_service_users.py` against the prod auth schema.
  2. Set `EVAL_SERVICE_USER_ID` and `EVAL_PROBE_USER_ID` in Coolify.
  3. Run `import_golden.py` in the container.
- **`robots.ts`** disallows everything; it doubles as the health check.
- **Before deploying,** check `df -h /` on the VPS.

## Acceptance criteria
- [ ] A non-admin DocuMind account is refused at sign-in (Google and email) with the inline message.
- [ ] Locally, an admin signed in to DocuMind (:3000) and to Evaluation (:3100) keeps both sessions.
- [ ] `pnpm auth:check` reports nothing to migrate.
- [ ] Starting a run from `/runs/new` shows live progress, and the drill-down shows contexts, claims and judge reasoning.
- [ ] Prod `https://evaluation.documind.zeeshanai.cloud` works end to end, with a valid TLS cert. The eval API isn't reachable from outside (no domain, no host port).
- [ ] An eval-only push deploys only the eval apps.
- [ ] `pnpm typecheck`, `pnpm lint` and `pnpm build` pass. Status.md › Production gets the eval rows.

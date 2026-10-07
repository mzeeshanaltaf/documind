# DocuMind — Project Guide for Claude

**DocuMind:** "Turn company documents into an intelligent assistant". It's a multi-organization RAG app.
- A platform admin creates organizations, uploads policy PDFs and adds users.
- Users chat with all of an org's documents or with selected ones, and get citations that open the PDF at the cited page.

## Start here, every session
1. Read **`Status.md`**: it gives the current phase, decisions, open questions and the session log.
2. Read the current phase doc in **`docs/plan/phase-<n>-*.md`**: it lists the tasks, the skills to load, and the acceptance criteria.
3. Load the skills that phase lists **before** writing code.
4. Before ending the session, update `Status.md`: the phase table, a dated session-log entry, and any deviations or gotchas.
   - If you change something this file documents (commands, layout, conventions), update this file too, keeping it ≤ 150 lines.

## Stack
| Layer | Tech |
|---|---|
| Web | Next.js 16 App Router, TypeScript, Tailwind v4, shadcn/ui, pnpm (`web/`) |
| Auth | Better Auth on `pg`. Plugins: emailOTP, organization, admin, nextCookies. Plus Google OAuth. Emails via Resend |
| API | FastAPI, Python 3.12, uv, SQLAlchemy 2 async + asyncpg, Alembic, sse-starlette (`api/`) |
| DB | Shared Postgres 17 on the VPS, schema-per-app (`documind`), pgvector 0.8.1 (HNSW) |
| Search | Okapi BM25 implemented in SQL (`chunk_terms` table) + pgvector, fused with RRF |
| LLM | OpenAI Responses API: `gpt-6-luna` (chat/router), `text-embedding-3-small` (1536-d) |
| Files | MinIO (S3 API via boto3), image `pgsty/minio` (official images are gone). Local: docker compose. Prod: private Coolify service |
| Misc | Upstash Redis (rate limits), n8n webhook (contact form), Umami (analytics), Coolify on Hostinger VPS |

## Repo layout
```
web/                Next.js app
  src/app/(marketing)/   landing, contact, privacy (+ app/api/contact → n8n; opengraph-image, sitemap, robots)
  src/app/(auth)/        sign-in, sign-up, verify-email, forgot/reset-password, accept-invitation
  src/app/(app)/app/[orgSlug]/  chat, documents, members, settings, analytics
  src/app/admin/         platform admin (orgs, users, analytics)
  src/app/api/auth/[...all]/     Better Auth handler
  src/app/api/backend/[...path]/ BFF proxy → FastAPI (adds X-API-Key + X-User-Id)
  src/lib/{auth,auth-client,auth-guards,db,org-members,api,api-types,format,rate-limit,contact,site}.ts, src/lib/email/
  src/components/{brand,auth,app,chat,pdf,documents,settings,analytics,marketing,contact}/  src/hooks/use-chat-stream.ts
  scripts/ (create-schema, migrate-auth, preview-emails)
api/                FastAPI app
  app/core/       config, db (URL normalizer), security (API key + actor), storage (MinIO), log, errors
  app/models/     SQLAlchemy models (+ read-only mirrors of Better Auth tables)
  app/routers/    v1 (key-gated aggregator), me, documents, chat (SSE), conversations, settings, analytics, health
  app/ingestion/  parser (pdfplumber), header, metadata, chunker, indexer, worker
  app/rag/        tokenizer, bm25, vector, hybrid (RRF)
  app/agents/     catalog, router (orchestrator), specialists, answer, citations
  app/llm/        client (tiers, flex fallback, metering), pricing, usage
  alembic/  scripts/seed_policies.py  eval/ (golden.jsonl, run_eval.py)  tests/
docs/policies/      14 seed PDFs (fictional company "Simtora Technologies")
docs/plan/          phase-1 … phase-9 implementation docs
PRODUCT.md, DESIGN.md  design context (impeccable); DESIGN.json = its sidecar
model-pricing.json  per-model $/1M tokens for standard & flex tiers (single source)
docker-compose.dev.yml  local MinIO · api/Dockerfile, web/Dockerfile (context = repo root), .github/workflows/deploy.yml → Coolify (see Status.md › Production)
```

## Commands
```bash
docker compose -f docker-compose.dev.yml up -d        # local MinIO (console :9001)
cd web && pnpm dev | pnpm typecheck | pnpm lint | pnpm build
cd web && pnpm db:schema && pnpm auth:migrate        # schema + Better Auth tables (-- --dry-run prints SQL)
cd api && uv run uvicorn app.main:app --reload --port 8000
cd api && uv run alembic upgrade head                  # app tables (`alembic check` = models vs DB drift)
cd api && uv run pytest && uv run ruff check .
cd api && uv run python -m scripts.seed_policies --org-slug simtora --wait
cd api && uv run python -m eval.run_eval --org-slug simtora   # writes eval/results/<date>.md
```

## Environment
- **One root `.env.local`** (git-ignored) serves both apps:
  - `web/next.config.ts` loads it via `loadEnvConfig("..")`;
  - the api's pydantic-settings uses `env_file="../.env.local"`.
  - `.env.example` lists every key, without values.
- **Never** commit secrets or echo them in output; the repo is **public**. Edit `.env.local` with the Edit tool.
- **`DATABASE_URL` has Prisma-style params** (`schema`, `connection_limit`, `pool_timeout`, `uselibpqcompat`, `sslmode`). Always normalize it:
  - read `schema` for the search_path, then strip the unsupported params;
  - set `search_path = <schema>,public`, because `vector` lives in `public`.
  - Local dev uses `schema=documind_dev`; prod uses `schema=documind`.
- **`DOCUMIND_API_KEY` and `API_BASE_URL` are server-only.** They must never get a `NEXT_PUBLIC_` prefix.

## Architecture rules
- **Browser → Next.js only.** Client code calls `/api/backend/*`, never FastAPI directly.
  - The BFF validates the Better Auth session, then calls FastAPI with `X-API-Key` + `X-User-Id`.
  - Responses (SSE, PDFs) are streamed through unbuffered.
- **FastAPI authorizes everything.** `verify_api_key` runs on all `/v1` routes. `get_actor` loads the user from Better Auth's `"user"` table. `require_org_access` allows `is_admin` OR a `member` row; `require_admin` guards admin routes.
- **Table ownership.** Better Auth owns `user, session, account, verification, organization, member, invitation`, which use camelCase quoted columns such as `"organizationId"`. Alembic owns everything else and must exclude the Better Auth tables (`include_object`).
- **Every OpenAI call goes through `app/llm/client.py`.** It writes an `llm_usage` row covering tokens (input, cached, output, reasoning), the requested and actual tier, latency, TTFT and `cost_usd` from `model-pricing.json`, priced at the *actual* tier.
- **Service tiers.** The settings values are `standard|flex|auto`; the API values are `default|flex|auto`. Flex retries once, then falls back to default.
- **Chunks keep the metadata needed for citations and filters.** That means `section_path`, `section_number`, `page_start/end`, `content_type`, and the denormalized `department`/`jurisdiction`/`doc_type`.
  - `embed_text` = contextual header + text; it's what gets embedded and BM25-indexed.
  - `text` is what gets shown and highlighted.
  - When document metadata is edited, keep the chunks' denormalized columns in sync.
- **Ingestion** runs as a DB-backed job queue (`ingestion_jobs`, `FOR UPDATE SKIP LOCKED`), processed by an asyncio worker started in the FastAPI lifespan.

## Conventions
- **Python:**
  - async everywhere;
  - Pydantic v2 schemas in `app/schemas`;
  - thin routers with logic in `app/services`;
  - type hints;
  - ruff (line length 100);
  - pytest with `asyncio_mode=auto`.
- **TypeScript:**
  - Server Components by default;
  - Server Actions for mutations, which re-check auth;
  - zod for validation;
  - `import "server-only"` in server modules;
  - shadcn components in `src/components/ui`.
- **Hydration:** client trees that use browser-only values at init (chat, PDF viewer) load via `next/dynamic(..., { ssr: false })`.
- **Design:** follow `PRODUCT.md` + `DESIGN.md` (repo root, written by `/impeccable` in Phase 2; tokens in `web/src/app/globals.css`). Don't invent colours or fonts ad hoc. Link-buttons use `ButtonLink`, not `<Button render={<Link/>}>` (that sets `role="button"`); client-form field ids come from `useId()`.
- **Auth guards:** `lib/auth-guards.ts` (`requireSession`/`requireAdmin`/`requireOrgAccess`/`requireOrgAdmin`) in every layout, page and Server Action. Session reads sit inside `<Suspense>` (cacheComponents), so `notFound()`/`redirect()` stream with HTTP 200; that's expected.
- **Files:** write them with the Write/Edit tools, never shell heredocs (Windows quirks).
- **Git:** commit and push only when the user asks (`/ship`). The branch is `main`.

## Skills by area
| Area | Skills |
|---|---|
| API | `/fastapi-python` |
| Web | `/nextjs-best-practices`, `/vercel-react-best-practices`, `/shadcn` |
| UI design | `/impeccable` (all front-end design + final audit/polish), `/dataviz` (charts) |
| Auth & email | `/better-auth-best-practices`, `/better-auth-email-otp`, `/resend` |
| Contact page | `/nextjs-contact-form` |
| PDF viewer | `/pdf-preview` (adapt to load a URL from the BFF, not base64) |
| Deploy | `/add-minio-storage-to-coolify`, `/add-app-to-coolify` |
| Analytics | `/umami-analytics` |

## Gotchas already known
- Postgres prints a harmless "collation version mismatch" WARNING on connect.
- There's no `pg_search`, so don't try `CREATE EXTENSION pg_search`. BM25 is custom SQL (see phase 5).
- Better Auth's table is named `"user"` (a reserved word), so it must always be quoted in SQL.
- `pgvector` iterative scans (`SET LOCAL hnsw.iterative_scan = relaxed_order`) need the results re-sorted by distance afterwards.
- AsyncSession isn't concurrency-safe, so parallel retrievals each need their own session.
- The VPS disk fills with Docker build cache. A weekly prune cron exists (see the global CLAUDE.md); check `df -h /` before deploys.
- OpenAI returns `service_tier="default"` (never `"standard"`) for standard and `auto` requests. Usage and the tier arrive only on the `response.completed` stream event.
- Next 16.4 runs with `cacheComponents` on. Read `web/node_modules/next/dist/docs/` (see `web/AGENTS.md`) before writing Next code. Route segment `runtime`/`dynamic` exports are rejected (Node is the default; route handlers are dynamic).
- **Chat URL:** a new conversation switches the URL with `history.replaceState`, never `router.replace` (that re-renders the route and drops the live stream). Reads go through the BFF (SWR); writes are Server Actions calling `apiJson`.
- On this machine, PDFToolkit's containers can hold :3000/:8000 (their restart policy is now `no`), so check `docker ps` if `next dev` falls back to :3001.
- `@better-auth/cli` is deprecated (stuck at 1.4) and rejects `server-only`; use `pnpm auth:migrate` (runs `getMigrations` under `--conditions=react-server`).
- Better Auth org endpoints (invite, remove, list) require the caller to be an org member. Platform-admin actions therefore go through `lib/org-members.ts` (Better Auth's adapter via `auth.$context`, or SQL) after `requireAdmin()`.
- `next.config.ts` loads the root `.env.local` by hand. `loadEnvConfig("..")` is a cached no-op there, and `forceReload` makes `next dev` reload endlessly.
- If `next dev` reloads endlessly (log repeats "Compiled in 2ms" + the same GET), stop it and delete `web/.next/dev` (corrupted Turbopack dev cache). Running `pnpm typecheck` (`next typegen`) while `next dev` is up triggers it; use `npx tsc --noEmit` then.
- Static auth pages bake `RESEND_FROM_EMAIL`, and `NEXT_PUBLIC_APP_URL` (canonical, sitemap, OG URLs) is inlined at build: in Coolify both must be build-time variables.
- **No-JS pages can't rely on Suspense:** a streamed boundary only resolves with JavaScript. `/contact` uses `export const instant = false` and awaits `searchParams` outside Suspense so the native form's `?sent`/`?error` redirect renders. Marketing pages use `<details>` and native `popover` instead of client state.
- `opengraph-image.tsx` reads its fonts (`web/assets/fonts/*.woff`; Satori can't read woff2) at module scope: inside the handler it counts as uncached I/O and the route turns dynamic. App tables hide columns by `@container` width (the sidebar eats 256px), and `SidebarInset` keeps `min-w-0`.
- **Alembic on the shared DB:** `env.py` only looks at our schema (`include_name`) and connects with `search_path=public`, so reflection names our schema explicitly. Otherwise autogenerate wants to drop other apps' `public` tables and re-create every FK. Migrations take the schema from `get_settings().db_schema` (never hard-coded), and explicit `ck_*` names need `op.f()`. After model changes, run `alembic check`.
- API tests hit the real dev DB (throwaway `test-*` Better Auth rows, removed afterwards) and local MinIO; OpenAI is monkeypatched (`llm.client.respond`/`embed`, or `get_client` for chat). From this machine a DB round-trip is ~0.45 s and a cold connect 1–3 s, so the suite takes ~5.5 minutes. Stop any local uvicorn first: its ingestion worker claims the tests' jobs.
- **asyncpg infers parameter types from context:** in `:k1 + 1` the param becomes an integer (1.2 → 1), so cast numeric params (`CAST(:k1 AS float8)`); interval params need a `timedelta`, not `'1 day'`.
- **SSE disconnects:** sse-starlette cancels the generator mid-await or abandons it at a `yield`, and never `aclose()`s it. `routers/chat.py` closes it in `background=`, and `run_chat` saves `status='stopped'` in a shielded `finally`.
- Python-side `uuid4` defaults only apply at flush; set ids explicitly when a child row or an SSE event needs them earlier.
- Retrieval fusion is tuned (`rag/hybrid.py`: BM25 weight 0.6, country supplements ×0.9 when no country is asked). Re-run `eval.run_eval` after changing chunking, the tokenizer or these constants.
- **Parser heuristics** (`ingestion/parser.py`) are calibrated on the Simtora PDFs (body 12pt; headings 24/18/15pt semibold; bold body-size L3 only after a paragraph gap on a short line). `find_tables()` returns a page-sized frame "table" on most pages; it's filtered. Some source PDFs render `$…` as KaTeX garbage; that's in the PDFs, not a parser bug.
- **Reindex keeps stored metadata** (admin edits win); the LLM metadata step runs only on first ingestion. If the classify prompt changes, refresh `api/tests/fixtures/metadata_llm.json`.

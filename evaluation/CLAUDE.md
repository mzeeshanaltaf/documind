# DocuMind Evaluation — Project Guide for Claude

**DocuMind Evaluation** is a standalone harness that measures DocuMind end to end: retrieval, answers, citations, safety, cost and latency.
- **Web:** `https://evaluation.documind.zeeshanai.cloud`, admin-only.
- **API:** internal only.

> Status: **skeleton** (planning done 2026-10-18; E1 hooks built in DocuMind's `api/` 2026-10-19; no harness code yet). Fill in the sections marked _TBD_ as the phases land. Keep this file ≤ 120 lines.

## Start here, every session
1. Read the root `CLAUDE.md` (DocuMind conventions apply here too), then `Status.md` › **Evaluation harness**.
2. Read the current phase doc in `docs/plan/eval/phase-E<n>-*.md`, plus `docs/plan/eval/README.md` for the architecture, data model and metric definitions.
3. Load the skills that phase lists **before** writing code.
4. Before ending the session, update `Status.md` › Evaluation harness (tracker, dated `[eval]` session-log entry, deviations, gotchas) and this file if commands or layout changed.

## Stack
| Layer | Tech |
|---|---|
| Web | Next.js 16 App Router, TS, Tailwind v4, shadcn/ui, pnpm (`evaluation/web`, port **3100**) |
| Auth | Better Auth on **DocuMind's auth tables** (`EVAL_AUTH_SCHEMA`), Google + email/password; platform admins only |
| API | FastAPI, Python 3.12, uv, SQLAlchemy 2 async + asyncpg, Alembic, sse-starlette (`evaluation/api`, port **8100**) |
| DB | Shared Postgres, schema `documind_eval` (dev `documind_eval_dev`, tests `documind_eval_test`) |
| Jobs | Postgres `jobs` table (`FOR UPDATE OF j SKIP LOCKED`), asyncio worker slots in the API lifespan |
| System under test | DocuMind `/v1` over HTTP as the `eval-bot` platform-admin service account |
| Judge | Anthropic: `claude-sonnet-5-5` (rubric), `claude-haiku-5-5` (claims, behaviour, relevance), `claude-opus-5-5` (synthetic generation) |

## Repo layout
_TBD as the phases land._ The target layout is in `docs/plan/eval/README.md` › Folder layout.

## Commands
_TBD (Phase E2 / E5)._ Expected:
```bash
cd evaluation/api && uv run uvicorn app.main:app --reload --port 8100
cd evaluation/api && uv run alembic upgrade head
cd evaluation/api && uv run pytest -m "not live" && uv run ruff check .
cd evaluation/api && uv run python -m scripts.bootstrap_service_users --org-slug simtora
cd evaluation/api && uv run python -m scripts.import_golden
cd evaluation/web && pnpm dev | pnpm typecheck | pnpm lint | pnpm build | pnpm auth:check
```
DocuMind itself must be running locally (`api` on :8000) for live runs.

## Environment
- **Keys:** they live in the root `.env.local`. Use the `EVAL_*` keys plus `ANTHROPIC_API_KEY` and `DOCUMIND_API_URL`; the full table is in `docs/plan/eval/README.md` › Environment. `.env.example` lists every key, without values.
- **Shared with DocuMind:** `DOCUMIND_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
- **`EVAL_API_KEY`** and **`DOCUMIND_API_KEY`** are server-only. They never get a `NEXT_PUBLIC_` prefix.

## Architecture rules
- **Browser → eval web only.** The BFF (`/api/backend/*`) checks the session plus admin, then calls the eval API with `X-API-Key` + `X-User-Id`, and streams SSE unbuffered.
- **The eval API authorizes everything.** The admin check runs against `{EVAL_AUTH_SCHEMA}."user"` (quoted, schema-qualified).
- **The eval web touches only the Better Auth tables.** All eval data goes through the eval API.
- **The eval web never migrates the auth tables.** `pnpm auth:check` is read-only. DocuMind owns those tables.
- **DocuMind calls go through `app/documind/client.py`** and carry `X-Eval-Run-Id`, `X-Eval-Case-Id` and `X-Request-ID=eval.<run8>.<case_key>.<attempt>` (no colons).
- **Every Anthropic call goes through `app/judge/client.py`.** It writes a `judge_calls` row (tokens incl. cache, cost from `judge-pricing.json`), checks the run budget, and reuses responses with the same `request_hash`.
- **Judge prompts are files** (`app/judge/prompts/*.md`) whose hash becomes a `prompt_versions` row; runs record the version ids.
- **Published dataset versions are immutable;** edits create a draft.
- **Runs are server-side jobs.** They survive closed tabs and restarts (lock reclaim after 5 min).

## DocuMind hooks (E1, in `api/`)
All admin-only; code in `api/app/core/eval.py`, `routers/eval.py`, `services/eval.py`, tests in `api/tests/test_eval_hooks.py`.
- **Headers:** `X-Eval-Run-Id` (required with a case id) and `X-Eval-Case-Id`, each `^[A-Za-z0-9_-]{1,100}$` (422 `invalid_eval_header`; non-admin → 403 `eval_forbidden`). Tagged chats create `is_eval` conversations titled `[eval] <case>`, skip quota and title, and tag every `llm_usage` row. An eval conversation can only be continued with eval headers (and vice versa), else 404.
- **Chat `overrides`** (eval headers required, else 403 `overrides_require_eval`): `top_k` 1–30, `retrieval_mode` bm25|vector|hybrid, `chat_model`, `router_model`, `chat_service_tier` standard|flex|auto, `include_source_text` (default true).
- **Eval-mode SSE:** `routing` = `Route.as_dict()` + `document_ids`; `sources` = full `Source.as_dict()` (chunk id, text unless disabled, scores); `usage` adds `by_operation` (one entry per call) and `retrieval` (summary).
- **Endpoints:** `POST /v1/orgs/{id}/retrieve` (`{query, history?, document_ids?, modes, top_k?, router_model?, chat_service_tier?}` → `{routing, queries, config, results{mode: {sources, retrieval}}, usage, timings_ms}`; bm25-only skips the embed), `GET /v1/orgs/{id}/documents/{doc}/chunks?offset&limit≤500`, `GET /v1/admin/eval/info`, `GET /v1/admin/eval-runs/{run}/usage` (`totals`, `by_operation`, `by_case` with `calls/input/cached/output/cost_usd`), `DELETE /v1/admin/eval-runs/{run}/conversations` → `{deleted}` (usage rows are kept). `/health` has `version`.

## Conventions
- Same as the root `CLAUDE.md` › Conventions. Python: async, Pydantic v2, thin routers / logic in services, ruff at 100. TS: Server Components, Server Actions re-check auth, zod, `server-only`.
- **Design:** follow the root `PRODUCT.md` + `DESIGN.md`. The tokens in `evaluation/web/src/app/globals.css` and `components/ui` are **copies** of `web/` (sync date _TBD_).
- **Files:** write them with the Write/Edit tools, never shell heredocs.
- **Git:** commit and push only when the user asks (`/ship`).

## Gotchas already known
- **No temperature control.** Sonnet and Haiku 5.5 reject non-default `temperature`/`top_p`/`top_k`. Use `messages.parse` structured output, not forced `tool_choice`. Sonnet 5.5 can't disable thinking.
- **Cookies on localhost.** DocuMind (:3000) and Eval (:3100) share localhost cookies, so the eval app uses `cookiePrefix: "documind-eval"`. Never enable `crossSubDomainCookies`.
- **Chat isn't idempotent.** A retried case first recovers its existing DocuMind conversation, or deletes it and starts over.
- **Prod DocuMind serves real users** on one uvicorn worker. Keep `EVAL_DOCUMIND_CONCURRENCY` low and run big suites off-hours.
- **asyncpg pitfalls.** Cast numeric params (`CAST(:x AS float8)`), pass `timedelta` for intervals, and give each concurrent task its own session.

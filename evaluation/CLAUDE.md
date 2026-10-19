# DocuMind Evaluation — Project Guide for Claude

**DocuMind Evaluation** is a standalone harness that measures DocuMind end to end: retrieval, answers, citations, safety, cost and latency.
- **Web:** `https://evaluation.documind.zeeshanai.cloud`, admin-only.
- **API:** internal only.

> Status: **E3 done** (2026-10-19): `evaluation/api` foundation, datasets, durable queue, run engine and deterministic metrics. No judge (E4) or web (E5) yet. Fill in the sections marked _TBD_ as the phases land. Keep this file ≤ 120 lines.

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
Target layout: `docs/plan/eval/README.md` › Folder layout. Built so far (`evaluation/api/`):
```
app/core/       config (EVAL_* settings, parse_schema/with_schema), db, security (verify_api_key, get_admin), log, errors
app/models/     enums (Literal values = CHECKs), dataset, prompt (+config_presets), run (runs…run_aggregates), job
app/documind/   client (DocuMindClient, get_documind), events (typed SSE + parse_event), models
app/worker/     queue (claim/…/enqueue, enqueue_many, enqueue_finalize), loop (slots), sweeper, limits, errors,
                handlers/{noop, case_generate, run_finalize}
app/metrics/    types, registry (REGISTRY, MetricConfig, evaluate, case_passed), retrieval, citations,
                operational, safety (+ fingerprints.txt)
app/stats/      intervals (Wilson), bootstrap (seeded percentile, percentile)
app/services/   datasets, importer, runs (create/snapshot/read/delete), run_state (count, settle, pause/
                resume/stop, sweep), case_results (persist + score), aggregates, exports
app/routers/    v1 (get_admin on all), datasets, documind (passthrough), jobs, runs (+events, export), health
alembic/versions/0001_core, 0002_usd_precision   scripts/{bootstrap_service_users,import_golden}.py   tests/
```

## Commands
```bash
cd evaluation/api && uv run uvicorn app.main:app --reload --port 8100
cd evaluation/api && uv run alembic upgrade head          # `alembic check` = models vs DB drift
cd evaluation/api && uv run pytest && uv run ruff check .  # -m "not db" skips the Postgres tests
cd evaluation/api && uv run python -m scripts.bootstrap_service_users --org-slug simtora [--dry-run]
cd evaluation/api && uv run python -m scripts.import_golden   # needs DocuMind up; re-run = no-op
cd evaluation/web && pnpm dev | pnpm typecheck | pnpm lint | pnpm build | pnpm auth:check   # E5
```
DocuMind itself must be running locally (`api` on :8000) for live runs, the golden import and `/health.documind`.

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
- **Endpoints:** `POST /v1/orgs/{id}/retrieve` (`{query, history?, document_ids?, modes, top_k?, router_model?, chat_service_tier?}` → `{routing, queries, config, results{mode: {sources, retrieval}}, usage, timings_ms}`; bm25-only skips the embed), `GET /v1/orgs/{id}/documents/{doc}/chunks?offset&limit≤500`, `GET /v1/admin/eval/info`, `GET /v1/admin/eval-runs/{run}/usage` (`totals`, `by_operation`, `by_case` with `calls/input/cached/output/cost_usd`), `GET /v1/admin/eval-runs/{run}/conversations?case_id=` → `{conversations: [{id, eval_case_id, created_at}]}` (added in E3 for retry recovery), `DELETE /v1/admin/eval-runs/{run}/conversations` → `{deleted}` (usage rows are kept). `/health` has `version`.

## Conventions
- Same as the root `CLAUDE.md` › Conventions. Python: async, Pydantic v2, thin routers / logic in services, ruff at 100. TS: Server Components, Server Actions re-check auth, zod, `server-only`.
- **Design:** follow the root `PRODUCT.md` + `DESIGN.md`. The tokens in `evaluation/web/src/app/globals.css` and `components/ui` are **copies** of `web/` (sync date _TBD_).
- **Files:** write them with the Write/Edit tools, never shell heredocs.
- **Git:** commit and push only when the user asks (`/ship`).

## Gotchas already known
- **No temperature control.** Sonnet and Haiku 5.5 reject non-default `temperature`/`top_p`/`top_k`. Use `messages.parse` structured output, not forced `tool_choice`. Sonnet 5.5 can't disable thinking.
- **Cookies on localhost.** DocuMind (:3000) and Eval (:3100) share localhost cookies, so the eval app uses `cookiePrefix: "documind-eval"`. Never enable `crossSubDomainCookies`.
- **Chat isn't idempotent.** A retried case (attempt > 1) lists DocuMind's conversations for the case (a crash can land before `meta` is stored), recovers one with a complete scored answer and deletes the rest.
- **Run state:** every transition happens with the run row locked; "in flight" = a `generating`/`judging` case whose job has a live lock. A dead worker's lock looks live for 5 min, so a pausing run turns `paused` (via the 15 s sweeper) only then. Finishing = `done + failed + skipped ≥ total`.
- **Money is `numeric(14, 8)`** (DocuMind's precision); 6 decimals rounded case costs. Stored cost = successful attempts; `/usage` also meters interrupted ones, so a killed run's gap is real spend.
- **Local drills:** in Git Bash set `MSYS_NO_PATHCONV=1` before passing `/v1/...` args, and hard-kill with PowerShell `Stop-Process -Force` (`taskkill //F` fails from Git Bash). respx mocks with a `base_url` need `path__regex`.
- **Prod DocuMind serves real users** on one uvicorn worker. Keep `EVAL_DOCUMIND_CONCURRENCY` low and run big suites off-hours.
- **asyncpg pitfalls.** Cast numeric params (`CAST(:x AS float8)`), and pass intervals as `timedelta` **and** `CAST(:d AS interval)`: in `now() - $1` asyncpg infers a timestamp. Give each concurrent task its own session.
- **Async ORM:** `Base` sets `eager_defaults=True` so server defaults and `onupdate` values come back with RETURNING; an expired attribute can't lazy-load in async. A column named `text` shadows `sqlalchemy.text` in a class body (`run.py` imports it as `sql_text`).
- **Queue semantics:** every write after `claim` is guarded by `locked_by`, so a slot whose job was reclaimed can't record an outcome. A job whose lock expired more than `max_attempts` times is failed on the next claim. Graceful shutdown releases jobs at once; a hard kill waits for the 5-minute reclaim.
- **Tests:** `tests/conftest.py` sets `EVAL_DATABASE_URL` to schema `documind_eval_test` before any app import, migrates it once (alembic in a thread) and drops it at the end. Admin checks use the real `eval-bot` / `eval-probe` users in `EVAL_AUTH_SCHEMA`. From this machine the db tests take ~3 min.
- **Datasets:** `content_hash` sorts cases by `case_key` and normalizes them through `CaseFields`, so positions, key order and explicit defaults don't change it. Imports replace a version's cases (never merge); re-importing the latest published content is a no-op.

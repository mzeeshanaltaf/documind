# DocuMind Evaluation — Project Guide for Claude

**DocuMind Evaluation** is a standalone harness that measures DocuMind end to end: retrieval, answers, citations, safety, cost and latency.
- **Web:** `https://evaluation.documind.zeeshanai.cloud`, admin-only.
- **API:** internal only.

> Status: **E8 code done** (2026-10-20): adversarial & safety suite (canary org, authz probes, safety metrics + panel, judge-robustness rejudge); E7 committed. Keep this file ≤ 120 lines.

## Start here, every session
1. Read the root `CLAUDE.md` (DocuMind conventions apply here too), then `Status.md` › **Evaluation harness**.
2. Read the current phase doc in `docs/plan/eval/phase-E<n>-*.md`, plus `docs/plan/eval/README.md` for the architecture, data model and metric definitions.
3. Load the skills that phase lists **before** writing code. Before ending the session, update `Status.md` › Evaluation harness (tracker, dated `[eval]` session-log entry, deviations, gotchas) and this file if commands or layout changed.

## Stack
| Layer | Tech |
|---|---|
| Web | Next.js 16 App Router, TS, Tailwind v4, shadcn/ui, pnpm (`evaluation/web`, port **3100**) |
| Auth | Better Auth on **DocuMind's auth tables** (`EVAL_AUTH_SCHEMA`), Google + email/password; platform admins only |
| API | FastAPI, Python 3.12, uv, SQLAlchemy 2 async + asyncpg, Alembic, sse-starlette (`evaluation/api`, port **8100**) |
| DB | Shared Postgres, schema `documind_eval` (dev `documind_eval_dev`, tests `documind_eval_test`) |
| Jobs | Postgres `jobs` table (`FOR UPDATE OF j SKIP LOCKED`), asyncio worker slots in the API lifespan |
| System under test | DocuMind `/v1` over HTTP as the `eval-bot` platform-admin service account |
| Judge | Anthropic: `claude-haiku-5-5` (rubric, claims, behaviour, relevance; Sonnet 5.5 is a per-run `judge.models.rubric` option), `claude-opus-5-5` (synthetic generation) |

## Repo layout
Target layout: `docs/plan/eval/README.md` › Folder layout. `evaluation/web/` (E5):
```
src/app/(auth)/sign-in   src/app/(app)/{page (dashboard),datasets,synthetic (+new, [batchId] review),runs,compare (+case),trends,settings}/
src/app/api/auth/[...all]  src/app/api/backend/[...path] (BFF)   src/proxy.ts (cookie-presence redirects)
src/lib/  auth (Better Auth on DocuMind's tables), admin (role/ban rules), auth-guards (requireAdmin),
          db (pool, EVAL_AUTH_SCHEMA), eval-api (apiFetch/apiJson/action), api-types, metrics, format, cost,
          compare (Δ/p formats, verdicts), case-sources (drill-down sources + evidence quotes)
src/components/  ui/ (copied), brand/, app/ (shell), auth/, datasets/, synthetic/, runs/, case/, charts/, compare/, trends/
src/hooks/use-run-events.ts (EventSource via BFF → SWR poll fallback)   scripts/auth-check.ts
```
`evaluation/api/`:
```
app/core/       config (EVAL_* settings, parse_schema/with_schema), db, security (verify_api_key, get_admin), log, errors
app/models/     enums (Literal values = CHECKs), dataset, prompt (+config_presets), run (runs…run_aggregates), job, synthetic
app/documind/   client (DocuMindClient, get_documind), events (typed SSE + parse_event), models
app/worker/     queue (claim/…/enqueue, enqueue_many, enqueue_finalize), loop (slots), sweeper, limits
                (DocuMind + judge semaphores, RPM bucket), errors, handlers/{noop, case_generate, case_judge, run_finalize,
                synthetic_generate, authz_probe}
app/judge/      client (every Anthropic call), registry (prompt files → prompt_versions), render (case
                packet), pricing (judge-pricing.json), schemas (structured outputs), prompts/*.md
app/metrics/    types, registry (REGISTRY, MetricConfig, evaluate, case_passed), retrieval, citations,
                operational, safety (+ fingerprints.txt), generation + behavior (judge metrics' math)
app/stats/      intervals (Wilson), bootstrap (seeded percentile), paired (bootstrap CI, sign-flip, McNemar, Holm, classes)
app/services/   datasets, importer, runs (create/snapshot/read/delete), run_state (count, settle, pause/
                resume/stop, budget pause, sweep), case_results (persist + score, save_judged),
                judging (judge metric groups), rejudge, prompts, aggregates, exports, compare (A/B +
                A/A noise floor), config_diff (flattened config/snapshot diff), trends (series + markers),
                synthetic (sampling, batches), synthetic_checks (pure), synthetic_review (edit/approve/commit),
                canary (fixture → run snapshot), probes (pure), safety (run safety summary)
app/routers/    v1 (get_admin on all), datasets, documind (passthrough), jobs, prompts, runs (+rejudge,
                events, export, safety), compare, trends, synthetic (batches + candidates), system, health
alembic/versions/0001_core…0006_offline  tests/ (fake_anthropic.py)
scripts/{bootstrap_service_users,import_golden,import_adversarial,export_dataset,import_dataset,setup_canary_org,make_canary_pdf,offline_tasks}.py
```
`evaluation/fixtures/` (baked into the API image): `canary/canary-policy.{md,pdf}`, `adversarial.jsonl`, `judge-robustness.txt`.

## Commands
```bash
cd evaluation/api && uv run uvicorn app.main:app --reload --port 8100
cd evaluation/api && uv run alembic upgrade head          # `alembic check` = models vs DB drift
cd evaluation/api && uv run pytest && uv run ruff check .  # -m "not db" skips the Postgres tests
cd evaluation/api && uv run pytest -m live tests/test_judge_live.py  # real DocuMind + Anthropic (~1¢)
cd evaluation/api && uv run python -m scripts.bootstrap_service_users --org-slug simtora [--dry-run]; uv run python -m scripts.import_golden  # needs DocuMind up; re-run = no-op
cd evaluation/api && uv run python -m scripts.setup_canary_org --wait [--dry-run]; uv run python -m scripts.import_adversarial  # E8, idempotent
# promote a reviewed dataset dev -> prod (dev DB and prod DB are separate): export a published version, pipe it into the prod container
cd evaluation/api && uv run python -m scripts.export_dataset --slug synthetic-v1 --out ds.json   # latest published, or --version N
ssh <vps> 'docker exec -i <eval-api container> python -m scripts.import_dataset --file -' < ds.json   # --dry-run / --draft; re-run = no-op; checks content_hash
cd evaluation/web && pnpm dev | pnpm typecheck | pnpm lint | pnpm build | pnpm auth:check  # dev :3100; auth:check is read-only
docker build -f evaluation/{api,web}/Dockerfile .   # repo-root context (web: --build-arg NEXT_PUBLIC_APP_URL)
```
DocuMind itself must be running locally (`api` on :8000) for live runs, the golden import and `/health.documind`. The web needs the eval API on :8100.

## Environment
- **Keys:** they live in the root `.env.local`. Use the `EVAL_*` keys plus `ANTHROPIC_API_KEY` and `DOCUMIND_API_URL`; the full table is in `docs/plan/eval/README.md` › Environment. `.env.example` lists every key, without values.
- **Shared with DocuMind:** `DOCUMIND_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `DATABASE_URL` (the web's auth pool; search_path = `EVAL_AUTH_SCHEMA`) and `NEXT_PUBLIC_APP_URL`, which here too means **DocuMind's** URL ("Forgot password", "Open DocuMind"; build-time). The web's own origin is `EVAL_PUBLIC_URL`.
- **`EVAL_API_KEY`** and **`DOCUMIND_API_KEY`** are server-only. They never get a `NEXT_PUBLIC_` prefix.

## Architecture rules
- **Browser → eval web only.** The BFF (`/api/backend/*`) checks the session plus admin (403), then calls the eval API with `X-API-Key` + `X-User-Id`, and streams SSE unbuffered. It forwards `content-type`, `accept` and `Last-Event-ID` (EventSource resume) only. Reads in the browser go through it (SWR, SSE, imports, exports); mutations are Server Actions (`app/(app)/*/actions.ts`, each `requireAdmin()` + `apiJson`, then `refresh()`).
- **Sign-in gate:** `databaseHooks.session.create.before` throws `APIError("FORBIDDEN", {code: "NOT_PLATFORM_ADMIN"})` for non-admins (email: inline error; Google: `/sign-in?error=NOT_PLATFORM_ADMIN`). `disabledPaths` leaves only sign-in, callback, get-session and sign-out: this app can't change DocuMind accounts. `requireAdmin()` re-checks role/ban on every request.
- **The eval API authorizes everything.** The admin check runs against `{EVAL_AUTH_SCHEMA}."user"` (quoted, schema-qualified).
- **The eval web touches only the Better Auth tables** (all eval data goes through the eval API) **and never migrates them:** `pnpm auth:check` is read-only; DocuMind owns them.
- **DocuMind calls go through `app/documind/client.py`** and carry `X-Eval-Run-Id`, `X-Eval-Case-Id` and `X-Request-ID=eval.<run8>.<case_key>.<attempt>` (no colons).
- **Every Anthropic call goes through `app/judge/client.py`.** It writes a `judge_calls` row (tokens incl. cache, cost from `judge-pricing.json` at the model that served it), checks the run budget (reached → run `pausing`, reason `budget`), and reuses a run case's earlier `ok`/`refusal` call with the same `request_hash`. **Offline mode** (`EVAL_JUDGE_MODE=offline`, local only, no API spend): `call()` parks the request in `offline_tasks` and raises `RetryLater` (poll `EVAL_OFFLINE_POLL_S`); Claude Code answers via `uv run python -m scripts.offline_tasks status|show|import` (schema-validated), storing a `judge_calls` row (`model_actual=claude-code-offline`, cost 0) the retry reuses; later-stage calls park in later rounds; runs get `snapshot.eval.judge_mode=offline` (a trend marker, not comparable with Haiku scores), batches `config.judge_mode`.
- **Judge prompts are files** (`app/judge/prompts/*.md`: frontmatter + system prompt + `<!-- task -->` line; `_rules.md` is the shared include). The hash (key, bodies, schema, params) becomes a numbered `prompt_versions` row at startup and at run creation; runs record the version ids and judge **from those rows**, so a file edit only affects new runs and rejudges.
- **Judge flow:** with judging on (`judge.enabled` + a judge metric enabled + full run), `case_generate` stops a case at `generated` and enqueues `case_judge` (priority 1); `save_judged` decides `passed` over all scores and counts the case. Each metric group fails alone (`error`/`refusal`); 429 requeues, 5xx retries the job.
- **Rejudge** (`POST /v1/runs/{id}/rejudge`) copies answers, contexts and deterministic scores into a new run (`source_run_id`), enqueues only `case_judge`, and never calls DocuMind (finalize skips usage/cleanup; DocuMind cost 0).
- **Published dataset versions are immutable;** edits create a draft. **Runs are server-side jobs:** they survive closed tabs and restarts (lock reclaim after 5 min).
- **Synthetic (E7):** `POST /v1/synthetic-batches` samples seeds (seeded `random.Random`, chunks via DocuMind's E1 endpoint) and inserts candidates + one `synthetic_generate` job each, claimed only while the batch is `generating`. A job: `gen.<type>` (Opus) → unanswerable: DocuMind `/retrieve` → `gen.validate` (Sonnet) → deterministic checks → save (dedupe under a per-batch advisory lock); a hard failure auto-rejects. Calls meter as `judge_calls` (`purpose=synthetic`, `batch_id`/`candidate_id`; the batch's `max_cost_usd` pauses it). `gen.*` prompts are `kind: generator`, recorded on the batch, never in run snapshots (`registry.sync(kind=…)`), so they add no trend markers. Commit writes approved candidates into the dataset's draft (`syn-<batch8>-NNN`, `source=synthetic`; enrichment sets reference + key facts by `target_case_key`).
- **Safety (E8):** every run snapshots the canary's phrases (`snapshot.canary`, empty when the run targets `eval-canary` itself) and the country supplements (`snapshot.documents.supplements`, for `jurisdiction_confusion`). `leakage` ignores codes/phrases the user's own messages contain when the answer repeats them (never in sources/citations). `authz_probe` cases (`cases.probes`, placeholders `{org_id}` `{canary_org_id}` `{bot_conversation_id}` `{doc_id}`) get an `authz_probe` job instead of `case_generate`, run as `EVAL_PROBE_USER_ID`, score only `authz_probe`, are never judged and are carried as `done` by a rejudge. `injection_resisted` is `judge_refined` (deterministic canary/fingerprint check, then AND-ed with the behaviour verdict in the judge's behaviour group); `refusal_rate_oos` is judge-only. `GET /v1/runs/{id}/safety` feeds the run page's panel. `rejudge {tamper: "judge_robustness"}` appends `fixtures/judge-robustness.txt` lines to answers (`scripts.judge_robustness` runs plain vs tampered and checks Δ ≤ noise).

## DocuMind hooks (E1, in `api/`)
All admin-only; code in `api/app/core/eval.py`, `routers/eval.py`, `services/eval.py`, tests in `api/tests/test_eval_hooks.py`.
- **Headers:** `X-Eval-Run-Id` (required with a case id) and `X-Eval-Case-Id`, each `^[A-Za-z0-9_-]{1,100}$` (422 `invalid_eval_header`; non-admin → 403 `eval_forbidden`). Tagged chats create `is_eval` conversations titled `[eval] <case>`, skip quota and title, and tag every `llm_usage` row. An eval conversation can only be continued with eval headers (and vice versa), else 404.
- **Chat `overrides`** (eval headers required, else 403 `overrides_require_eval`): `top_k` 1–30, `retrieval_mode` bm25|vector|hybrid, `chat_model`, `router_model`, `chat_service_tier` standard|flex|auto, `include_source_text` (default true).
- **Eval-mode SSE:** `routing` = `Route.as_dict()` + `document_ids`; `sources` = full `Source.as_dict()` (chunk id, text unless disabled, scores); `usage` adds `by_operation` (one entry per call) and `retrieval` (summary).
- **Endpoints:** `POST /v1/orgs/{id}/retrieve` (`{query, history?, document_ids?, modes, top_k?, router_model?, chat_service_tier?}` → `{routing, queries, config, results{mode: {sources, retrieval}}, usage, timings_ms}`; bm25-only skips the embed), `GET /v1/orgs/{id}/documents/{doc}/chunks?offset&limit≤500`, `GET /v1/admin/eval/info`, `GET /v1/admin/eval-runs/{run}/usage` (`totals`, `by_operation`, `by_case` with `calls/input/cached/output/cost_usd`), `GET /v1/admin/eval-runs/{run}/conversations?case_id=` → `{conversations: [{id, eval_case_id, created_at}]}` (added in E3 for retry recovery), `DELETE /v1/admin/eval-runs/{run}/conversations` → `{deleted}` (usage rows are kept). `/health` has `version`.

## Conventions
- Same as the root `CLAUDE.md` › Conventions. Python: async, Pydantic v2, thin routers / logic in services, ruff at 100. TS: Server Components, Server Actions re-check auth, zod, `server-only`.
- **Design:** follow the root `PRODUCT.md` + `DESIGN.md`. The tokens in `evaluation/web/src/app/globals.css`, `components/ui`, `button-link`, `option-select`, the logo mark and `remark-citations` are **copies** of `web/` (synced 2026-10-19; checkbox/switch/tabs added via the shadcn CLI). Copy changes over by hand. Scores, case keys and doc codes are mono; highlighter yellow only marks evidence quotes and cited spans; charts use `--chart-1` (sequential, one hue).
- **Files:** write them with the Write/Edit tools, never shell heredocs. **Git:** commit and push only when the user asks (`/ship`).

## Gotchas already known
- **No temperature control.** Sonnet and Haiku 5.5 reject non-default `temperature`/`top_p`/`top_k`. Structured output via `output_config.format` (`anthropic.transform_schema`), not forced `tool_choice`. We call `beta.messages.create` + `model_validate_json`, not `messages.parse`: parse raises on a refusal/`max_tokens` reply before `stop_reason` can be checked. Sonnet 5.5 can't disable thinking (`between_tools` if a Haiku prompt runs on it); Haiku has no server-side fallback.
- **The Anthropic account has its own spend limit.** Once reached, every call is a 400 "You have reached your specified API usage limits … regain access on <date>"; the judge treats it (and 401/403) as `JudgeUnavailable` → the run pauses with `status_reason = judge_unavailable`, then `POST /resume` once the limit is raised (synthetic batches pause the same way: `POST /v1/synthetic-batches/{id}/resume`). Live judge runs cost ~$0.65 per 30 cases with the Sonnet rubric; Haiku for the rubric is ~1/20 of that rubric cost.
- **Prompt caching** needs a ≥ 512-token prefix (the system prompts are ~900–1,400 tokens). The packet is rendered in a fixed section order with no ids, so equal packets are byte-identical. It gets a breakpoint only when reused (N samples: the first runs alone, the rest read; the key-facts answer/sources pair), since an unread cache write costs 1.25× input.
- **Cookies on localhost.** DocuMind (:3000) and Eval (:3100) share localhost cookies, so the eval app uses `cookiePrefix: "documind-eval"`. Never enable `crossSubDomainCookies`.
- **Chat isn't idempotent.** A retried case (attempt > 1) lists DocuMind's conversations for the case (a crash can land before `meta` is stored), recovers one with a complete scored answer and deletes the rest.
- **Run state:** every transition happens with the run row locked; "in flight" = a `generating`/`judging` case whose job has a live lock. A dead worker's lock looks live for 5 min, so a pausing run turns `paused` (via the 15 s sweeper) only then. Finishing = `done + failed + skipped ≥ total`. **Money is `numeric(14, 8)`** (DocuMind's precision); 6 decimals rounded case costs. Stored cost = successful attempts; `/usage` also meters interrupted ones, so a killed run's gap is real spend.
- **Local drills:** in Git Bash set `MSYS_NO_PATHCONV=1` before passing `/v1/...` args, and hard-kill with PowerShell `Stop-Process -Force` (`taskkill //F` fails from Git Bash). respx mocks with a `base_url` need `path__regex`. Run one golden run at a time locally: with the ~0.45 s VPS round trip, 4 busy runs saturate the 7-connection pool (`QueuePool limit … reached`) and cases fail at stage `job`; pages wait 30 s. Killing a `--reload` uvicorn on Windows can leave its spawn child holding :8100 (find it by `parent_pid` in `Get-CimInstance Win32_Process`). **Prod DocuMind serves real users** on one uvicorn worker: keep `EVAL_DOCUMIND_CONCURRENCY` low, big suites off-hours.
- **asyncpg pitfalls.** Cast numeric params (`CAST(:x AS float8)`), and pass intervals as `timedelta` **and** `CAST(:d AS interval)`: in `now() - $1` asyncpg infers a timestamp. Give each concurrent task its own session. **Async ORM:** `Base` sets `eager_defaults=True` so server defaults and `onupdate` values come back with RETURNING; an expired attribute can't lazy-load in async. A column named `text` shadows `sqlalchemy.text` in a class body (`run.py` imports it as `sql_text`).
- **Queue semantics:** every write after `claim` is guarded by `locked_by`, so a slot whose job was reclaimed can't record an outcome. A job whose lock expired more than `max_attempts` times is failed on the next claim. Graceful shutdown releases jobs at once; a hard kill waits for the 5-minute reclaim.
- **Tests:** `tests/conftest.py` sets `EVAL_DATABASE_URL` to schema `documind_eval_test` before any app import, migrates it once (alembic in a thread) and drops it at the end. Admin checks use the real `eval-bot` / `eval-probe` users in `EVAL_AUTH_SCHEMA`. From this machine the db tests take ~3 min.
- **Web (E5):** the live run closes its EventSource itself on a terminal `run` event (the server ends the stream and EventSource would reconnect forever), then refetches once for the aggregates (computed only at finalize, so live metric cards are plain running means). React compiler lint rejects reassigning a render-time variable (e.g. a running group header): precompute (`groupMetrics`). `answer_quality.details.analysis` is a per-dimension object; show `summary`. From this machine a drill-down takes ~8 s in dev (each eval API query is a ~0.45 s VPS round trip).
- **Compare/trends (E6):** Δ = B − A. Operational metrics (latency, TTFT, tokens, cost) are descriptive (CI + raw p, outside Holm, never significant): a back-to-back rerun reads ~99 % of its input from OpenAI's prompt cache vs ~50 % cold, so cost drops ~45 % with an identical setup. The noise floor is an A/A pair found automatically (same config hash + DocuMind version + judge prompt shas; rejudges excluded), preferring A's or B's setup. Trend markers come from `config_diff.kind_of` over consecutive runs of one run mode; locally DocuMind's version is always `dev`, so redeploy markers only show on prod.
- **Containers:** the API image keeps the repo layout under `/srv` (`config.py` finds the repo root 4 levels up, and `/srv/api/eval/golden.jsonl` for `import_golden`); the web image is DocuMind's standalone pattern (`mkdir -p public`, health `/robots.txt`). **Datasets:** `content_hash` sorts cases by `case_key` and normalizes them through `CaseFields`, so positions, key order and explicit defaults don't change it (`probes` is dropped when null, so pre-E8 hashes hold). Imports replace a version's cases (never merge); re-importing the latest published content is a no-op.
- **Web formatting:** there is no Prettier config and the TSX is hand-wrapped near 120–130 columns; never run Prettier over existing files (it reflows untouched lines).

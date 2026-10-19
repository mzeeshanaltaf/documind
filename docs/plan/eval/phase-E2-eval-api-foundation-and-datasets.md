# Phase E2 — Eval API Foundation, Datasets & Durable Queue

**Goal:** `evaluation/api` runs locally with its own schema. It:
- authenticates callers against DocuMind's admin users;
- talks to DocuMind through a typed client;
- stores versioned datasets and imports the existing golden set;
- processes background jobs durably, so a job survives a crash or restart.

**Depends on:** E1. **Unblocks:** E3.

## Skills to load
- `/fastapi-python`

## 1. Scaffold — `evaluation/api/`
- **Setup:** `uv init`, Python 3.12, `.python-version`.
- **Dependencies:** fastapi, uvicorn[standard], sqlalchemy[asyncio], asyncpg, alembic, pydantic-settings, httpx, httpx-sse, sse-starlette, anthropic, numpy, pyyaml.
- **Dev dependencies:** pytest, pytest-asyncio, respx, ruff.
- **Config:** ruff with line length 100; pytest with `asyncio_mode=auto` and markers `db` and `live`.
- **`app/main.py`:** FastAPI with a lifespan that starts the worker slots (§6), `/health`, and the `v1` aggregator router.

## 2. Core — `app/core/`
- **`config.py`:** pydantic-settings with `env_file=("../../.env.local", ".env.local")`, holding the `EVAL_*` keys listed in [README](README.md#environment-root-envlocal-every-key-listed-in-envexample). Port `parse_schema` from `api/app/core/config.py`; the default schema is `documind_eval`.
- **`db.py`:** port `normalize_database_url` from `api/app/core/db.py`, with `application_name=documind-eval-api`, pool 5+2, pre-ping. Provide `SessionLocal` and `session_scope()`.
- **`log.py`, `errors.py`:** copied from DocuMind (request ids, `ApiError` with `details`).
- **`security.py`:**
  - `verify_api_key` checks `X-API-Key == EVAL_API_KEY` with a constant-time compare.
  - `get_admin` reads `X-User-Id` and looks the user up in `{EVAL_AUTH_SCHEMA}."user"` (quoted, schema-qualified). It requires `role` to contain `admin` and the user to be unbanned; otherwise 401/403.

## 3. Alembic — `alembic/env.py` + `0001_core.py`
- Same pattern as `api/alembic/env.py`:
  - `include_name` limited to our schema;
  - `version_table_schema`;
  - connect with `search_path=public`;
  - `CREATE SCHEMA IF NOT EXISTS` first.
- **`0001_core`** creates every table in the README data model **except** synthetic (E7) and review (E9): `datasets`, `dataset_versions`, `cases`, `prompts`, `prompt_versions`, `config_presets`, `runs`, `run_cases`, `retrieved_contexts`, `metric_scores`, `claims`, `judge_calls`, `run_aggregates`, `jobs`.
- **Constraints:**
  - CHECKs on the status, kind and type enums (named with `op.f()`);
  - unique `(dataset_version_id, case_key)` and `(run_id, case_id)`;
  - unique partial index `jobs(run_id) WHERE kind='run_finalize' AND status IN ('queued','running')`;
  - index `jobs(status, available_at, priority)`.

## 4. DocuMind client — `app/documind/`
- **`client.py`:** an `httpx.AsyncClient` with base URL `DOCUMIND_API_URL` and headers `X-API-Key` (DocuMind's key) and `X-User-Id` (`EVAL_SERVICE_USER_ID`). Each call takes optional `eval_run_id`, `eval_case_id` and `request_id`.
  - Methods: `me()`, `documents(org_id)`, `chunks(org_id, doc_id, offset, limit)`, `info()`, `health()`, `chat(...)` (an async iterator of typed events, with a 180 s timeout and ping comments ignored), `retrieve(...)`, `conversation(id)`, `run_usage(run_id)`, `delete_run_conversations(run_id)`.
  - **Retry policy:** GETs retry on 5xx and connection errors (2 attempts with backoff). POST chat never retries.
- **`events.py`:** Pydantic models for `meta`, `routing`, `sources`, `delta`, `citations`, `usage`, `done` and `error` (eval-mode supersets from E1), and `parse_event(name, data)`.
- **`models.py`:** the `Source`, `Citation`, `Routing` and `RetrieveResult` shapes.

## 5. Service users — `scripts/bootstrap_service_users.py`
- Idempotent SQL into `{EVAL_AUTH_SCHEMA}."user"`; it prints the ids to put in `.env.local`.
- **`eval-bot@documind.zeeshanai.cloud`:**
  - name "Evaluation service", `role='admin'`, `emailVerified=true`;
  - **no `account` row**, so it can't sign in.
- **`eval-probe@documind.zeeshanai.cloud`:** `role='user'`, plus a `member` row in `simtora` only. Used for the authz probes in E8.
- `--org-slug` (default `simtora`) and `--dry-run`.

## 6. Durable job queue — `app/worker/`
- **`queue.py`:**
  - **`claim(worker_id)`:**
    ```sql
    UPDATE jobs SET status='running', locked_at=now(), locked_by=:w, attempts=attempts+1
    WHERE id = (SELECT j.id FROM jobs j LEFT JOIN runs r ON r.id = j.run_id
      WHERE ((j.status='queued' AND j.available_at <= now())
             OR (j.status='running' AND j.locked_at < now() - interval '5 minutes'))
        AND (j.run_id IS NULL OR r.status IN ('running','stopping','finalizing') OR j.kind='run_finalize')
      ORDER BY j.priority DESC, j.created_at
      FOR UPDATE OF j SKIP LOCKED LIMIT 1)
    RETURNING id, kind, run_id, run_case_id, batch_id, payload, attempts;
    ```
    `FOR UPDATE OF j` is required because Postgres rejects `FOR UPDATE` on the nullable side of an outer join.
  - **`heartbeat(job_id)`** every 60 s.
  - **`succeed`, `fail`:** `fail` retries with backoff `available_at = now() + timedelta(...)` until `max_attempts`.
  - **`requeue(job_id, delay)`:** used on rate limits; it doesn't consume an attempt.
  - **`release(job_id)`:** on shutdown, sets `status='queued', attempts=attempts-1, locked_at=NULL` (shielded).
- **`loop.py`:**
  - `EVAL_WORKER_SLOTS` asyncio tasks, each running: claim → dispatch to `handlers[kind]` → record the outcome.
  - Each handler opens its own sessions (an AsyncSession isn't concurrency-safe).
  - Idle polling is 1 s with jitter.
- **`limits.py`:** `DocuMindLimiter` (semaphore `EVAL_DOCUMIND_CONCURRENCY`); the judge limiters arrive in E4.
- **Handler `noop`**, for tests.

## 7. Datasets — `services/datasets.py`, `services/importer.py`, `routers/datasets.py`
- **Datasets:** `GET|POST /v1/datasets`, `GET|PATCH /v1/datasets/{id}`.
- **Versions:**
  - `POST /v1/datasets/{id}/versions` creates a draft copied from the latest version;
  - `GET /v1/dataset-versions/{id}`;
  - `POST /v1/dataset-versions/{id}/publish` computes `content_hash` over the canonical JSON of the cases; after that, the version can't be edited.
- **Cases:** `GET|POST /v1/dataset-versions/{id}/cases`, `PATCH|DELETE /v1/cases/{id}`. Drafts only; anything else gets 409 `version_published`.
- **Import and export:**
  - `POST /v1/datasets/import`: a JSONL upload plus a field mapping; `?preview=true` returns the parsed cases without saving.
  - `GET /v1/dataset-versions/{id}/export`: JSONL.
- **Golden importer** (`scripts/import_golden.py` + the service), reading `api/eval/golden.jsonl`:
  - `case_key` is `golden-001…`;
  - `type`: a jurisdiction → `jurisdiction`; more than one expected doc → `multi_hop`; otherwise `single_hop`;
  - `expected_departments` comes from DocuMind's documents list (doc_code → department);
  - `expected_behavior='answer'`, tag `golden`, `source='imported'`;
  - it publishes as v1 of dataset `golden` with `default_org_slug=simtora`.
- **DocuMind passthrough:** `GET /v1/documind/orgs` (from `/v1/me`), `GET /v1/documind/orgs/{id}/documents`, `GET /v1/documind/info`.
- **Health:** `GET /health` → `{status, db, version, documind: {reachable, version}}`, always HTTP 200.

## 8. Tests
- **Unit:**
  - importer type inference and mapping;
  - SSE event parsing from recorded fixtures (`tests/fixtures/sse/*.txt`, covering a normal answer, `needs_clarification`, an error, and a multi-part question);
  - the dataset `content_hash` is stable.
- **db-marked** (schema `documind_eval_test`, created and dropped per session):
  - publish locks edits;
  - a queue claim skips locked jobs;
  - a job with an expired lock is reclaimed;
  - `release` restores the attempt;
  - a run in status `paused` isn't claimed.
- **respx-mocked DocuMind:** client retries on a GET 502 and never on a POST.

## Acceptance criteria
- [ ] `uv run alembic upgrade head` creates `documind_eval_dev` only; `documind_dev` and the other apps' schemas are untouched, and `alembic check` is clean.
- [ ] `bootstrap_service_users.py` creates both users (a re-run is a no-op), and DocuMind `/v1/me` as the bot lists `simtora`.
- [ ] Importing `golden.jsonl` gives dataset `golden` v1, published, 30 cases, with departments filled.
- [ ] Killing uvicorn during a `noop` job (sleeping 30 s), then restarting, resumes and finishes it.
- [ ] `/health` shows the DocuMind version.
- [ ] `uv run ruff check .` and `uv run pytest` pass.
- [ ] Status.md is updated.

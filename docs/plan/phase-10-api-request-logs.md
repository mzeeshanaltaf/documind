# Phase 10 — REST API request logs & viewer (`/v1/logs/ui`)

**Goal:** Record every `/v1` request in Postgres and add a request-log viewer at `https://api.documind.zeeshanai.cloud/v1/logs/ui`. Debugging in prod today means reading container stdout (one line per request from `RequestIdMiddleware`) and querying `llm_usage` and `messages` by hand. The viewer has two views:
- a filterable list of every `/v1` request;
- a detail page per request, showing what matters in this project: user and org, the conversation and message, tokens, cost and tier for each OpenAI call, routing and retrieval, the error, and the request and response bodies.

**Depends on:** Phase 8 (the API is deployed on Coolify).

## Decisions (owner, 2026-10-18)
- **Store bodies**, capped, with uploads and PDFs summarised.
- **Keep logs 30 days.**
- **The UI asks for the existing `DOCUMIND_API_KEY`**, and every data call sends `X-API-Key`.

## Skills to load
- `/fastapi-python` (API work).
- `/impeccable` is optional; the page is a single static HTML file that uses DESIGN.md's tokens.

## 1. Storage: table `api_request_logs` (Alembic `0003_request_logs`)
Model `api/app/models/request_log.py` (`ApiRequestLog`). It has no FKs, like `LlmUsage`, so logs outlive deleted users and orgs.
- **Columns:**
  - `id` uuid pk, `created_at`, `request_id` text (the X-Request-ID, shown as "Trace ID");
  - `method`, `path`, `query` text, `route` (template, e.g. `/v1/orgs/{org_id}/chat`), `status_code` int, `duration_ms` int;
  - `user_id`, `org_id` text, `conversation_id`, `message_id`, `document_id` uuid;
  - `client_ip`, `user_agent`;
  - `request_headers` jsonb (redacted), `request_body` jsonb, `request_body_size`;
  - `response_headers` jsonb, `response_body` jsonb, `response_content_type`, `response_body_size`, `body_truncated` bool;
  - `error_code`, `error_message`, `error_traceback` text.
  - Bodies that aren't JSON are stored as a JSON string, so both body columns stay `jsonb`.
- **Indexes:** `(created_at desc)`, `(status_code, created_at)`, `(route, created_at)`, `(user_id, created_at)`, `request_id`.
- **Also in this migration:** add a nullable **`request_id`** column + index to `llm_usage`.
  - `record_usage` (`api/app/llm/usage.py`) fills it from `request_id_var` (`app/core/log.py`).
  - Title tasks inherit the contextvar, so their usage links to the chat request too. Ingestion-worker calls stay null (`"-"` maps to null).
- Register the model in `app/models/__init__.py`, then run `alembic check`.

## 2. Capture: pure-ASGI `RequestLogMiddleware` (`api/app/core/request_log.py`)
It's pure ASGI for the same reason as `RequestIdMiddleware`: SSE and PDF streams must stay unbuffered. It runs *inside* `RequestIdMiddleware`, so `request_id_var` is already set (`main.py`: `add_middleware(RequestLogMiddleware)` before `add_middleware(RequestIdMiddleware)`).
- **Scope:** only paths starting with `/v1`, excluding `/v1/logs*`. `/health`, `/docs` and `/openapi.json` are skipped.
- **Request:** wrap `receive` to tee body chunks up to 64 KB.
  - JSON is parsed if valid.
  - `multipart/form-data` (uploads up to 50 MB) is stored as a summary only: `{"multipart": true, "bytes": N, "filenames": [...]}`, with filenames parsed from the part headers seen.
- **Response:** wrap `send` to capture the status, headers and body (64 KB cap).
  - **`text/event-stream`:** capture up to 256 KB raw, then *condense*. Parse the `event:`/`data:` blocks, merge the `delta`s into one `answer` text, and keep `meta`, `routing`, `sources`, `citations`, `usage` and `done`/`error` as a list of events.
  - **`application/pdf` and other binary types:** store `{content_type, bytes}` only.
  - **Error fields:** `error_code` and `error_message` come from our error shape `{"error": {...}}` (`app/core/errors.py`).
- **Redaction:** `x-api-key`, `authorization`, `cookie` and `set-cookie` become `"[REDACTED]"`.
- **Context from routing:** after the inner app runs, `route` is rebuilt from `scope["path"]` + `scope["path_params"]` (each segment equal to a param value becomes `{name}`; FastAPI 0.142 keeps included routers nested, so `scope["route"].path` lacks the prefixes), and `scope["path_params"]` gives `org_id`, `conversation_id` and `document_id`. `user_id` comes from the `X-User-Id` header.
- **Annotations:** `annotate(**fields)` writes into a contextvar holding a *mutable dict*, created per request. The SSE generator runs in sse-starlette's task group, which copies the context, so it still writes into the same dict.
  - `services/chat.py` `run_chat` annotates `conversation_id` + `message_id`.
  - On exception it annotates `error_message` + the traceback. A 200 stream that emitted `error` is otherwise invisible.
- **Unhandled exceptions:** they propagate up to `ServerErrorMiddleware`. The middleware catches them, records `status=500` + `traceback.format_exc()` (capped at 16 KB) and re-raises.
- **Writing rows:** each row is written with `asyncio.create_task(_write(row))` in its own `session_scope()`. Tasks are kept in a module-level `set` (the `background_tasks` pattern in `services/chat.py`). `drain()` awaits them; tests and the lifespan shutdown use it.
  - It never raises: a failed log write only goes to `logger.exception`.
- **Settings:** `request_log_retention_days: int = 30` and `request_log_enabled: bool = True` (`core/config.py`; both keys in `.env.example`).
- **Retention:** a lifespan task in `main.py` runs `DELETE … WHERE created_at < now() - :age` hourly, with a `timedelta` param (asyncpg gotcha). It stops on the same `stop` event as the ingestion workers.

## 3. Read API (key-gated, under the existing `v1` router)
Router `api/app/routers/logs.py` + service `api/app/services/request_logs.py` + schemas `api/app/schemas/request_logs.py`, added to the loop in `routers/v1.py`. It needs only `verify_api_key` (no `X-User-Id`), which matches the trust model in `core/security.py`.
- **`GET /v1/logs`**
  - **Params:** `q` (ILIKE on path/query/error_message, or exact on request_id/log id), `method`, `status` (`2xx|3xx|4xx|5xx` or an exact code), `route`, `user_id`, `org_id`, `from`/`to`, `limit` (≤100), `before` (keyset cursor on `created_at, id`).
  - **Returns** the list columns, plus `user_email` (LEFT JOIN `user_table`), `org_slug` (LEFT JOIN `organization_table`), `total_tokens` and `cost_usd` (aggregated from `llm_usage` by `request_id`), and `next_cursor`.
- **`GET /v1/logs/routes`:** the distinct `route` values, for the Route filter.
- **`GET /v1/logs/{log_id}`:** the full row, plus:
  - user (id, name, email), org (id, name, slug);
  - `llm_calls`: the `llm_usage` rows with this `request_id` (operation, model, tier requested/actual, input/cached/output/reasoning tokens, latency, TTFT, cost, status, error), and their totals;
  - `message`: when `message_id` is set, the assistant `Message`'s `status`, `routing`, `retrieval`, `sources` and `citations`.

## 4. UI: `GET /v1/logs/ui` (public HTML shell, no data)
- **Routing:** a separate `logs_ui` router without the key dependency, included in `main.py` **before** `v1.router`. Otherwise `/v1/logs/{log_id}` would match `ui` and fail.
- **The page:** a single self-contained file `api/app/static/logs_ui.html`, read once at import and returned as `HTMLResponse`.
  - No external scripts or fonts; system font stacks that mirror DESIGN.md.
  - **Security headers:** a strict `Content-Security-Policy` (`default-src 'none'`; the inline script gets a per-response nonce; `connect-src 'self'`; `style-src 'unsafe-inline'`), plus `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` and `Cache-Control: no-store`.
  - **Colours:** DESIGN.md's tokens as CSS variables. A Light/Dark toggle defaults to `prefers-color-scheme`; the choice is saved in localStorage.
- **Header:** "REST API Logs" with Light/Dark, API Key and Refresh buttons.
  - The API Key button opens a `<dialog>`; the key is saved in localStorage (wrapped in try/catch) and "Forget key" clears it.
  - A 401 from the API re-opens the dialog.
- **List view:**
  - **Filters:** search box, Method, Status class, Route (from `/v1/logs/routes`), Search.
  - **Columns:** method badge, URL (path+query, mono), status pill, time, user (email or id), org slug, tokens/cost, timestamp (local time).
  - "View" opens the detail; "Load more" uses the cursor.
- **Detail view** (hash routing `#/log/<id>`, so links are shareable and Back works):
  - **Summary grid:** Method, Status, Response time, Timestamp, URL, Log ID, Trace ID, User, Organization, Conversation ID, Message ID, Document ID, Model(s), Service tier requested→actual, TTFT, Input/Cached/Output/Reasoning/Total tokens, Cost (USD), Answer status, Error.
  - **Tabs:**
    - **Request:** headers, query params, body;
    - **Response:** headers and body, or the condensed SSE events with the full answer;
    - **Error:** code, message, traceback;
    - **Retrieval:** routing (departments, jurisdiction, standalone query, sub-queries, bypassed), a sources table (n, doc_code, section, pages, scores) and timings;
    - **LLM calls:** a table of the `llm_usage` rows.
  - Tabs with no data show "—".
- **Rendering:** every value goes in via `textContent` or escaped JSON pretty-print, never `innerHTML` with log data. Bodies hold user-supplied text, so this rules out XSS.

## 5. Privacy and docs
- **`web/src/app/(marketing)/privacy/page.tsx`:**
  - **Technical logs:** API requests are logged with time, path, status, request ID, account and organization IDs, and request and response content (questions, answers). This is for debugging and investigating errors, and only the operator can view the logs.
  - **Retention:** add "Technical logs: deleted after 30 days".
- **`CLAUDE.md`:** add `request_log` to core and `logs` to routers in the repo layout, plus one gotcha line (the logs UI is public HTML gated by the API key; `logs_ui` must be included before `v1`).
- **`Status.md`:** the phase row and a dated session-log entry.
- **Dockerfile:** `api/Dockerfile` copies `api/` wholesale, so `app/static/` ships.

## Files
- **New:** `api/app/core/request_log.py`, `api/app/models/request_log.py`, `api/alembic/versions/0003_request_logs.py`, `api/app/routers/logs.py`, `api/app/services/request_logs.py`, `api/app/schemas/request_logs.py`, `api/app/static/logs_ui.html`, `api/tests/test_request_logs.py`.
- **Edited:** `api/app/main.py` (middleware, UI router, prune task, `drain()` on shutdown), `api/app/routers/v1.py`, `api/app/core/config.py`, `api/app/models/__init__.py`, `api/app/models/usage.py`, `api/app/llm/usage.py`, `api/app/services/chat.py`, `.env.example`, the privacy page, `CLAUDE.md`, `Status.md`.

## Verification
1. `cd api && uv run alembic upgrade head && uv run alembic check` reports no drift.
2. **`tests/test_request_logs.py`** (real dev DB, OpenAI monkeypatched as in `test_chat_stream.py`; `await request_log.drain()` before asserting). It covers:
   - a `/v1/me` call writes a row with the route template, user_id and a redacted `x-api-key`;
   - `/health` and `/v1/logs` aren't logged;
   - a chat call stores the condensed SSE (answer text, events), `conversation_id`/`message_id`, and `llm_usage` rows linked by `request_id`;
   - a 404/422 stores `error_code`;
   - `GET /v1/logs` needs the key (401 without it), and the filters work;
   - `GET /v1/logs/ui` returns HTML with no key and sends the CSP header;
   - the prune deletes old rows.
3. Test log rows are removed afterwards (by the `test-*` user ids).
4. `uv run pytest && uv run ruff check .` pass (stop the local uvicorn first).
5. **Manual:** run uvicorn and the web app, send a chat message, open `http://localhost:8000/v1/logs/ui`, enter the dev key, then check the list, the filters, the detail tabs (Retrieval and LLM calls filled in for a chat), dark/light and phone width.
6. After `/ship` and the deploy, open `https://api.documind.zeeshanai.cloud/v1/logs/ui` with the prod key.

## Acceptance criteria
- [ ] Every `/v1` request (except `/v1/logs*`) leaves one `api_request_logs` row; secrets are redacted; uploads and PDFs are summarised.
- [ ] SSE and PDF responses still stream unbuffered.
- [ ] Chat rows link to their conversation, message and `llm_usage` rows.
- [ ] The list and detail endpoints need the API key; the UI shell doesn't, and it sends a strict CSP.
- [ ] Rows older than 30 days are pruned.
- [ ] The privacy page mentions technical logs and their retention.

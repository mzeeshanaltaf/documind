# Phase 3 — API Foundation & Data Model (FastAPI)

**Goal:** Build the FastAPI core, made of four parts:
- config,
- an async DB connected to the shared Postgres schema,
- service API-key security that resolves the acting user and org access from Better Auth tables,
- an Alembic migration creating all app tables (pgvector, BM25 tables, chat and metering), plus a MinIO storage client.

**Depends on:** Phase 2, because the Better Auth tables must exist for FKs and authorization. **Unblocks:** Phases 4 and 5.

## Skills to load
- `/fastapi-python`: async patterns, dependency injection, Pydantic v2 schemas, error handling.

## 1. Config — `api/app/core/config.py`
- **Settings class.** `Settings(BaseSettings)` with `model_config = SettingsConfigDict(env_file=("../.env.local", ".env.local"), extra="ignore")`.
- **Fields:**
  - `database_url`, `documind_api_key`, `openai_api_key`
  - `openai_chat_model`, `openai_router_model`, `openai_embedding_model`, `openai_embedding_dim=1536`
  - `openai_chat_service_tier="standard"`, `openai_background_service_tier="flex"`
  - `s3_endpoint`, `s3_region`, `s3_bucket`, `s3_access_key`, `s3_secret_key`, `s3_force_path_style=True`
  - `pricing_file` (default: the repo-root `model-pricing.json`, resolved relative to the package, overridable for Docker)
  - `max_upload_mb=50`, `ingest_concurrency=1`
- **Derived property `db_schema`,** parsed from the `schema` query param of `DATABASE_URL` (default `documind`).
- **Access.** Use a cached `get_settings()`.

## 2. DB — `api/app/core/db.py`
- **Normalize the URL:**
  - The scheme becomes `postgresql+asyncpg://`.
  - Drop every query param.
  - Map `sslmode=require` to `connect_args={"ssl": "require"}`.
  - Add `server_settings={"search_path": f"{schema},public", "application_name": "documind-api"}`.
- **Engine.** `create_async_engine(..., pool_size=5, max_overflow=5, pool_pre_ping=True)`. The DB is shared, so keep the pool small.
- **Sessions.** `async_sessionmaker(expire_on_commit=False)` and a `get_session()` dependency.
- **Worker helper.** `session_scope()` is an async context manager for code outside requests, such as the worker.
- **Unit test** the URL normalizer with the real param shape: `schema`, `sslmode`, `uselibpqcompat`, `connection_limit`, `pool_timeout`.

## 3. Models — `api/app/models/` (SQLAlchemy 2 typed, `MetaData(schema=settings.db_schema)`)
- **Better Auth mirror tables** (`models/auth.py`) are **read-only** `Table` objects, used only for joins and authorization.
  - `"user"`: `id, name, email, "emailVerified", role, banned`.
  - `organization`: `id, name, slug`.
  - `member`: `id, "organizationId", "userId", role`.
  - Use the exact column names recorded in Status.md (camelCase, quoted).
- **App tables**, with `uuid` PKs defaulting to `gen_random_uuid()` and `timestamptz` columns defaulting to `now()`:

```
documents
  id uuid pk, org_id text fk organization(id) on delete cascade,
  title text not null, doc_code text, legal_entity text,
  department text, jurisdiction text, doc_type text,
  version text, effective_date date, review_cycle text, owner text, approved_by text,
  applies_to text, related_doc_codes text[] default '{}', summary text, outline jsonb,
  page_count int, file_key text not null, file_name text, file_size bigint, sha256 text not null,
  status text not null default 'uploaded'  -- uploaded|processing|ready|failed
  error text, uploaded_by text fk "user"(id) on delete set null,
  created_at, updated_at, indexed_at
  unique(org_id, sha256); index(org_id, status); index(org_id, department)

ingestion_jobs
  id uuid pk, document_id uuid fk documents on delete cascade, org_id text,
  status text default 'queued'   -- queued|running|succeeded|failed
  stage text, progress int default 0, attempts int default 0, error text,
  locked_at, created_at, started_at, finished_at
  index(status, created_at)

chunks
  id uuid pk, document_id uuid fk documents on delete cascade, org_id text not null,
  chunk_index int, text text not null, embed_text text not null,
  section_path text[], section_number text, section_title text,
  page_start int, page_end int, content_type text, token_count int,
  cross_refs text[] default '{}',
  department text, jurisdiction text, doc_type text,      -- denormalized for filtering
  embedding vector(1536), bm25_len int not null, created_at
  index(org_id, document_id); index(org_id, department)
  HNSW: create index on chunks using hnsw (embedding vector_cosine_ops) with (m=16, ef_construction=64)

chunk_terms
  org_id text, term text, chunk_id uuid fk chunks on delete cascade, tf int not null
  primary key(org_id, term, chunk_id); index(chunk_id)

bm25_stats
  org_id text pk, n_chunks int not null, avg_len double precision not null, updated_at

conversations
  id uuid pk, org_id text, user_id text fk "user"(id) on delete cascade, title text,
  scope text default 'all' -- all|docs
  document_ids uuid[] default '{}', created_at, updated_at
  index(org_id, user_id, updated_at desc)

messages
  id uuid pk, conversation_id uuid fk conversations on delete cascade,
  role text -- user|assistant
  content text, citations jsonb, sources jsonb, routing jsonb, retrieval jsonb,
  status text default 'complete' -- complete|error|stopped
  feedback smallint, feedback_comment text, created_at
  index(conversation_id, created_at)

org_settings
  org_id text pk fk organization(id) on delete cascade,
  chat_model text, router_model text,
  chat_service_tier text, background_service_tier text,   -- standard|flex|auto
  top_k int default 8, updated_at, updated_by text

llm_usage
  id uuid pk, org_id text, user_id text, conversation_id uuid, message_id uuid, document_id uuid,
  operation text not null  -- router|answer|embed_query|embed_ingest|classify|summarize|title
  model text not null, service_tier_requested text, service_tier_actual text,
  input_tokens int default 0, cached_tokens int default 0, output_tokens int default 0,
  reasoning_tokens int default 0, latency_ms int, ttft_ms int,
  cost_usd numeric(14,8) default 0, pricing_estimated bool default false,
  status text default 'ok', error text, created_at
  index(org_id, created_at); index(operation, created_at)
```
- **Columns the same as their documents.** Chunk `department`, `jurisdiction` and `doc_type` mirror the document; Phase 4/6 must keep them in sync on metadata edits.
- **No FKs on `llm_usage`.** Analytics rows must survive deletions.

## 4. Alembic — `api/alembic/`
- **Setup.** Run `uv run alembic init -t async alembic`. `env.py` uses the normalized URL and sets `version_table_schema=settings.db_schema` and `include_schemas=True`.
- **Ignore Better Auth tables.** An `include_object` filter excludes them (`user, session, account, verification, organization, member, invitation`), so autogenerate never drops or alters them.
- **Migration `0001_initial`:**
  - `CREATE SCHEMA IF NOT EXISTS <schema>`.
  - `CREATE EXTENSION IF NOT EXISTS vector` (already in `public`, so this is a no-op guard).
  - All tables above, plus the HNSW index.
- **Import `Vector`** from `pgvector.sqlalchemy`.
- **Run:** `uv run alembic upgrade head`. Afterwards, verify that `\d+ chunks` shows the HNSW index.

## 5. Security — `api/app/core/security.py`
- **Service key.** `api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)`. Compare with `secrets.compare_digest`; a missing or invalid key returns **401**.
- **Acting user.** `get_actor` reads the `X-User-Id` header (required on all `/v1` routes) and loads the user from `"user"`.
  - It returns an `Actor(id, email, name, is_admin)`, where `is_admin = role contains "admin"`.
  - An unknown or banned user returns 403.
- **Org access.** `require_org_access(org_id)` passes if the actor is an admin or a `member` row exists, and returns 404 otherwise, so org existence isn't leaked.
  - It returns `OrgContext(org_id, role, is_admin)`.
- **Admin-only routes.** `require_admin` guards them.
- **Trust model.** This is a single service key, so anyone holding it can act as any user. The key lives only in the Next.js server env and Coolify secrets, and is never sent to the browser.

## 6. Storage — `api/app/core/storage.py`
- **Client.** boto3 S3 with `endpoint_url=S3_ENDPOINT`, `Config(signature_version="s3v4", s3={"addressing_style": "path"})`, and the region.
- **Functions** (run blocking boto3 calls via `anyio.to_thread.run_sync`):
  - `put_pdf(key, fileobj, size)`
  - `open_stream(key)`, which returns a body iterator for `StreamingResponse`
  - `delete(key)`
  - `ensure_bucket()`, called from lifespan; it creates the bucket if missing (dev convenience).
- **Key scheme:** `orgs/{org_id}/documents/{document_id}.pdf`.

## 7. App wiring — `api/app/main.py`
- **Lifespan.** Startup runs `ensure_bucket()`, and Phase 4 adds starting the ingestion worker. Shutdown disposes the engine and cancels the worker.
- **Routers** are mounted under `/v1`. Every `/v1` router has `dependencies=[Depends(verify_api_key)]`.
- **Health.** `GET /health` is public and returns `{status, db: "ok"|"error"}`; it runs `select 1` and nothing sensitive.
- **OpenAPI.** Add an `APIKeyHeader` security scheme so Swagger at `/docs` shows the Authorize button.
- **Errors.** A consistent JSON shape `{ "error": { "code", "message" } }`, from exception handlers for HTTPException and validation errors.
- **No CORS.** The API is called server-to-server from Next.js or by API-key holders.
- **Logging.** stdlib `logging`, configured once, with request-id middleware that adds an `X-Request-ID` header.
- **Router stubs.** Create the files for `documents`, `chat`, `conversations`, `analytics` and `settings`; they're filled in Phases 4 and 5.
- **`GET /v1/me`** returns the actor and the orgs they can access. It's a useful smoke test for the key + user flow.

## 8. Tests — `api/tests/`
- **`test_db_url.py`:** normalizer cases.
- **`test_security.py`:** using an httpx `AsyncClient` with `ASGITransport`:
  - no key → 401
  - wrong key → 401
  - key without `X-User-Id` → 401/422
  - key with an unknown user → 403
  - key with a real user → `/v1/me` returns 200
- **`/health`** without a key → 200.

## Acceptance criteria
- [ ] `uv run alembic upgrade head` creates all tables in the configured schema; the Better Auth tables are untouched.
- [ ] `uv run pytest` passes.
- [ ] `curl localhost:8000/v1/me` returns 401. The same call with `-H "X-API-Key: …" -H "X-User-Id: <real user id>"` returns 200 with the user's orgs.
- [ ] Swagger `/docs` shows API-key auth.
- [ ] The MinIO bucket is checked or created on startup.
- [ ] Status.md is updated.

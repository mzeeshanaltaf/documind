# DocuMind — Implementation Status

> **Session protocol**
> - **Start of every session:** read `CLAUDE.md`, then this file, then the current phase doc in `docs/plan/`.
> - **End of every session:**
>   - update the phase table;
>   - add a dated entry to the Session log (what was built, deviations from the plan, gotchas, next steps);
>   - move resolved items out of "Open decisions".
> - Never write secrets here; this repo is public.

## Current phase
**Phase 5 — Hybrid retrieval, agents & chat API** (not started). Phase 4 is done.

## Phase tracker
| # | Phase | Doc | Status |
|---|---|---|---|
| 1 | Scaffold & environment | [phase-1](docs/plan/phase-1-scaffold-and-environment.md) | ✅ Done |
| 2 | Design foundation, auth & organizations | [phase-2](docs/plan/phase-2-auth-and-organizations.md) | ✅ Done |
| 3 | API foundation & data model | [phase-3](docs/plan/phase-3-api-foundation-and-data-model.md) | ✅ Done |
| 4 | Document ingestion | [phase-4](docs/plan/phase-4-document-ingestion.md) | ✅ Done |
| 5 | Hybrid retrieval, agents & chat API | [phase-5](docs/plan/phase-5-hybrid-retrieval-agents-and-chat-api.md) | ⬜ Not started |
| 6 | App UI | [phase-6](docs/plan/phase-6-app-ui.md) | ⬜ Not started |
| 7 | Marketing site & design polish | [phase-7](docs/plan/phase-7-marketing-site.md) | ⬜ Not started |
| 8 | Deployment (Coolify + MinIO) | [phase-8](docs/plan/phase-8-deployment.md) | ⬜ Not started |
| 9 | Umami analytics & wrap-up | [phase-9](docs/plan/phase-9-umami-analytics.md) | ⬜ Not started |

Legend: ⬜ Not started · 🟨 In progress · ✅ Done · ⛔ Blocked

## Decisions made (planning session, 2026-10-06)
- **Tenancy:** platform admin only.
  - Admins (Better Auth `admin` plugin, `role=admin`) create orgs, upload docs, manage members and settings, and view analytics.
  - Users sign up freely but can only chat in orgs they were added to.
  - Admins can access all orgs.
- **Admin bootstrap:** the `PLATFORM_ADMIN_EMAILS` env var (comma-separated) grants `role=admin` on sign-up or login.
- **Agents:** an orchestrator router (one structured call) picks the department(s) and jurisdiction and rewrites the query. Department specialists are each a prompt plus a metadata-filtered retrieval. One streamed synthesis call writes the answer. Routing is bypassed when the user scopes to specific documents.
- **Domains:**
  - web: `documind.zeeshanai.cloud`.
  - FastAPI: **public** at `api.documind.zeeshanai.cloud`, gated by a **single service API key** (`X-API-Key`). Next.js forwards the user as `X-User-Id`.
  - Accepted trade-off: a key holder can act as any user.
- **Repo:** `github.com/mzeeshanaltaf/documind`, **PUBLIC**, empty at planning time.
- **Retrieval:** true Okapi BM25 implemented in SQL (no `pg_search` available) plus pgvector HNSW, combined with RRF and a jurisdiction boost.
- **Embeddings:** `text-embedding-3-small` (1536-d). **Chat and router model:** `gpt-6-luna`.
- **Service tier:** per-org `chat_service_tier` (default standard) and `background_service_tier` (default flex), with flex falling back to standard.
- **PDF parsing:** `pdfplumber` (MIT), chosen to avoid PyMuPDF's AGPL licence.
- **Storage:** MinIO; local via docker compose, prod as a private Coolify service.

## Decisions made (Phase 1, 2026-10-07)
- **DB schema:** local dev uses `?schema=documind_dev` (set in `.env.local`), prod uses `?schema=documind`. Local and prod MinIO are separate stores, so the two databases never share PDF keys.
- **`PLATFORM_ADMIN_EMAILS`:** set to the owner's account email. Add more comma-separated later if needed.
- **MinIO image:** `pgsty/minio` + `pgsty/mc`, which are community builds of the same AGPL source with the web console kept.
  - MinIO no longer publishes `minio/minio` or `minio/mc` on Docker Hub or quay.io (pulls are denied).
  - **Phase 8 must use `pgsty/minio` too.** The `/add-minio-storage-to-coolify` skill still says `minio/minio:latest`.

## Decisions made (Phase 2, 2026-10-07)
- **Design context:** `PRODUCT.md` + `DESIGN.md` (+ `DESIGN.json` sidecar) at the repo root. North star "The Annotated Policy Binder".
  - Restrained palette: paper neutrals tinted to hue ~160, one **ink-green** accent, and **highlighter yellow reserved for cited passages**.
  - Fonts: Source Serif 4 (titles, wordmark), Instrument Sans (all UI), Geist Mono (doc codes, section numbers, OTPs).
  - Light by default; dark follows the OS (next-themes, toggle in the user menu). Every text pair is ≥ 4.5:1 in both themes.
  - Anti-references: generic AI chatbot, legacy intranet, SaaS landing clichés, dark hacker tool.
- **Org admin operations bypass Better Auth's member-gated endpoints.** `createInvitation`/`removeMember`/`cancelInvitation`/`listMembers` require the caller to be an org member, but a platform admin may not be.
  - So `lib/org-members.ts` writes through Better Auth's own adapter (`auth.$context`) or SQL, after `requireAdmin()`.
  - Adding an existing user uses `auth.api.addMember` (no session needed). Invitations are emailed by our code.
- **Last active org** is written directly to `session."activeOrganizationId"` (in `after()`), because `setActiveOrganization` also requires membership.
- **Email OTP:** codes are hashed at rest, 10-minute expiry, 5 attempts. `disableSignUp: true`, so the passwordless `/sign-in/email-otp` can't create accounts. Only `email-verification` and `forget-password` emails are sent.
- **Reserved org slugs** (`new-org`, `admin`, `api`, `settings`) are rejected client-side and in `organizationHooks.beforeCreateOrganization`.

## Decisions made (Phase 3, 2026-10-07)
- **Extra integrity beyond the plan.**
  - `conversations.org_id` and `bm25_stats.org_id` are FKs to `organization` with `ON DELETE CASCADE`, so deleting an org leaves no orphans. `llm_usage` still has no FKs.
  - CHECK constraints cover `documents.status`, `ingestion_jobs.status`, `conversations.scope`, `messages.role`/`status`, `messages.feedback ∈ {-1, 1}` and the `org_settings` tiers (NULL = env default). A new enum value needs a migration.
  - `messages.content` is NOT NULL with default `''`.
- **Missing `X-User-Id` returns 401**, not FastAPI's 422, so every auth failure is 401/403.
- **`require_org_access` returns 404** for a non-member and for an admin asking about a missing org. `OrgContext.role` is the `member.role`, or None for an admin who isn't a member. `require_admin` returns 403.
- **`/health` is always HTTP 200** with `status: ok|degraded` and `db: ok|error` (5 s timeout), so a shared-DB blip doesn't make Coolify restart the container.
- **A failed bucket check at startup is logged, not fatal.** Chat still works; uploads fail loudly.
- **Routes key off `org_id`** (Better Auth `organization.id`), not the slug. The BFF must map slug → id (`/v1/me` returns both).

## Decisions made (Phase 4, 2026-10-07)
- **Metadata is two concurrent background-tier calls**, `classify` (department, jurisdiction, doc_type, fallback title/entity) and `summarize`, not one. That gives the `classify`/`summarize` usage rows the acceptance criteria ask for. Model = the org's `router_model`.
- **Jurisdiction for the "US/GLOBAL" rows:** IT, Finance, Procurement and Facilities resolve to **GLOBAL**. Their "Applies to" covers everyone who uses the systems/money/offices of Simtora Technologies, Inc., with no single-country limit. Only the HR Policy Manual says "All U.S. employees" → US.
- **Reindex keeps the stored metadata** (admin edits win). The LLM step runs only on first ingestion (`indexed_at IS NULL`) or when dept/juris/doc_type are missing. Outline and page count are always re-derived. There's no "refresh metadata" option yet; delete + re-upload does it.
- **During ingestion/reindex the document is `processing`**, but its old chunks stay searchable until the single index transaction swaps them. Phase 5 should not filter retrieval on `status='ready'` alone, or reindexed docs vanish briefly.
- **Tables are standalone chunks** (prefixed by their nearest heading, or the pending L3 heading such as "Steps"). Prose before/after a table in the same section becomes separate chunks.
- **`content_type` precedence:** `revision_history`/`glossary` (by heading) → `table`/`list` (> 50% of tokens) → `appendix` → `prose`.
- **`section_number`** ignores "Part N" headings (spec regex), so a Part's intro text has `section_number = NULL`. The outline does record `"Part 3"` as the number. Appendix letters come from "Appendix G – …". Heading-only sections (a Part heading directly followed by 3.1) produce no chunk.
- **Chunks under 40 tokens are folded into a neighbour** from the same section (e.g. "Employee comments:" after a form table). Title lines are kept out of `section_path` (they're already in the contextual header).
- **Hyphenated line breaks** join without a space. The hyphen is dropped only when the joined word appears elsewhere in the document (so `SIM-\nHR-101` → `SIM-HR-101`, `corrective-\naction` keeps its hyphen).
- **Uploads:** multipart field `files[]`. The magic bytes `%PDF-` must appear in the first 1 KB. Per-file results are `queued|duplicate|not_pdf|too_large|empty`. A request where nothing was queued answers with the first failure's status (409/415/413/400) and `error.details = {existing_id, documents}`. A new `ApiError` carries `details`.
- **Reindex while a job is queued/running** returns that job (202), not a second one.
- **`llm_usage` tiers are stored as API values** (`requested=flex|default|auto`, `actual` = what OpenAI returned). Embedding rows have no tier and are priced as standard.

## Better Auth tables (Phase 2, for Phase 3)
- All seven live in the configured schema (`documind_dev` locally). None are in `public`; verified via `information_schema`.
- Columns are camelCase and must be quoted. `!` = NOT NULL; ids are `text`.

| Table | Columns |
|---|---|
| `"user"` | id!, name!, email! (unique), "emailVerified"! bool, image, "createdAt"!, "updatedAt"!, role (admin plugin: `admin`/`user`/null), banned bool, "banReason", "banExpires" |
| `session` | id!, "expiresAt"!, token! (unique), "createdAt"!, "updatedAt"!, "ipAddress", "userAgent", "userId"! → user, "activeOrganizationId", "impersonatedBy" |
| `account` | id!, "accountId"!, "providerId"!, "userId"! → user, "accessToken", "refreshToken", "idToken", "accessTokenExpiresAt", "refreshTokenExpiresAt", scope, password, "createdAt"!, "updatedAt"! |
| `verification` | id!, identifier!, value!, "expiresAt"!, "createdAt"!, "updatedAt"! (OTP rows: identifier `<type>-otp-<email>`, value `<sha256-b64url>:<attempts>`) |
| `organization` | id!, name!, slug! (unique), logo, "createdAt"!, metadata (text) |
| `member` | id!, "organizationId"! → organization, "userId"! → user, role! (`owner`/`admin`/`member`), "createdAt"! |
| `invitation` | id!, "organizationId"! → organization, email!, role, status! (`pending`/`accepted`/`rejected`/`canceled`), "expiresAt"!, "createdAt"!, "inviterId"! → user |

- Foreign keys cascade on delete. Timestamps are `timestamptz`. Indexes: session/account `userId`, verification `identifier`, member `organizationId`/`userId`, invitation `organizationId`/`email`.

## Verified facts (Phase 1, OpenAI smoke test 2026-10-07, `gpt-6-luna`)
- **`response.service_tier` values.** The request→response pairs are: `"flex"`→`"flex"`, `"default"`→`"default"`, `"auto"`→`"default"`, omitted→`"default"`.
  - Standard comes back as **`"default"`**, never `"standard"`.
  - Map it to the settings value `standard` when pricing (`model-pricing.json` keys are `standard`/`flex`).
- **Responses `usage` shape.** `{input_tokens, input_tokens_details: {cached_tokens, cache_write_tokens}, output_tokens, output_tokens_details: {reasoning_tokens}, total_tokens}`.
  - `cache_write_tokens` is a new field. Store it if it's ever non-zero.
  - Reasoning tokens do appear on structured calls (21 on the router-style test).
- **Streaming events, in order:**
  1. `response.created`, `response.in_progress`;
  2. `response.output_item.added`, `response.content_part.added`;
  3. `response.output_text.delta` × N;
  4. `response.output_text.done`, `response.content_part.done`, `response.output_item.done`;
  5. `response.completed`.

  Usage and the actual `service_tier` are on `event.response` of **`response.completed`** only.
- **Latency.** Flex non-streaming took about 3.7 s for "Say hi". Streaming flex had a TTFT of about 1.2 s and a total of about 1.8 s. The structured call took about 2.1 s.
- **Structured output.** `text={"format": {"type": "json_schema", "name": ..., "schema": ..., "strict": True}}` works with flex; `output_text` is the JSON string.
- **Embeddings.** `text-embedding-3-small` returns 1536 dims, with usage `{prompt_tokens, total_tokens}` and no output tokens.

## Verified facts (planning session)
- **Postgres:** PG 17.7 on the VPS, shared DB `postgresdb` with one schema per app.
  - The `documind` schema did not exist yet.
  - `vector` 0.8.1 is installed in `public`; `pgcrypto` is in `public`; `pg_trgm` and `unaccent` are available. There is **no `pg_search`**.
  - The DB role is superuser.
  - Connecting prints a harmless "collation version mismatch" warning.
- **`DATABASE_URL`** has Prisma-style params (`schema=documind`, `sslmode=require`, `uselibpqcompat`, `connection_limit`, `pool_timeout`) and must be normalized per driver.
- **Policy PDFs:**
  - Every PDF has a page-1 header table: Document ID, Version, Owner, Approved by, Effective date, Review cycle, Applies to, Related manuals.
  - Numbered sections (`Part N – …`, `N.N Title`, plain subheadings) and tables.
  - A "Page X of N" footer.
  - Doc codes: SIM-HR-001/002, SIM-HR-101..105 (PK, DE, FR, AU, UK), SIM-GLB-001, SIM-IT-001, SIM-FIN-001, SIM-PRC-001, SIM-CMP-001, SIM-FAC-001, SIM-OVR-001.
- **Local tooling:** Python 3.12.7, uv 0.8.3, Node 24.12, pnpm 10.5, Docker 29.6; `gh` is authenticated.
- **`RESEND_FROM_EMAIL`** display name was "Qanoon" and should become "DocuMind" (Phase 1).

## Open decisions
- **Coolify base URL:** not in env; find it in Phase 8.

## Pending user actions
- **Phase 2 manual check (owner):** Click "Continue with Google" on http://localhost:3000/sign-in and complete the consent screen. If Google shows `redirect_uri_mismatch`, add `http://localhost:3000/api/auth/callback/google` to the OAuth client.
  - Done as of Phase 3: the owner's admin account exists, and the org "Simtora Technologies" (`simtora`) exists with the owner as `owner`.
- Phase 8: add `https://documind.zeeshanai.cloud/api/auth/callback/google` and the JS origin.
- Phase 7/9: get legal review of the Privacy Policy before launch.

## Session log
<!-- Newest first. Template:
### YYYY-MM-DD — Phase N (status)
- Built: …
- Deviations from plan: …
- Gotchas / learnings: …
- Next: …
-->
### 2026-10-07 — Phase 4 (done)
- **Built (`api/`):**
  - **LLM layer:** `llm/pricing.py` (Decimal, `default`/`standard` → standard, unknown tier → standard + `estimated`, unknown model → 0 + `estimated`). `llm/usage.py` (`UsageCtx`, `record_usage` in its own session, never raises). `llm/client.py` (`respond`, `embed` in batches of 100 with 4 concurrent, `api_tier`, `extract_tokens`). Flex calls get a 600 s timeout and no SDK retries; on 429/503/"resource unavailable" they retry once with 1–4 s jitter, then fall back to `default`. Errors write a `status='error'` row and re-raise.
  - **Ingestion:** `parser.py` (+ `extract_header` for pages 1–2 only), `header.py`, `metadata.py`, `chunker.py`, `indexer.py` (chunks via SQLAlchemy insert, postings via asyncpg `copy_records_to_table` on the session's connection, `refresh_bm25_stats`), `worker.py` (claim SQL from the plan with an optional org filter, stage/progress updates that also refresh `locked_at`, `run()` for the lifespan, `run_until_idle()` for scripts/tests).
  - **`rag/tokenizer.py`:** NFKC, apostrophes stripped, compounds kept whole plus their parts, ~150 stopwords, Snowball stemming of alphabetic tokens.
  - **API:** `routers/documents.py` (all 8 routes) over `services/documents.py`, plus `schemas/documents.py` and `services/org_settings.py` (`effective_settings`, which Phase 5 reuses for models and tiers). The lifespan starts `ingest_concurrency` worker loops and stops them on shutdown.
  - **Seed:** `scripts/seed_policies.py` (`--org-slug`, `--dir`, `--wait`, `--concurrency` default 3).
  - **Tests (+72, 107 total):** `test_pricing`, `test_tokenizer`, `test_header_parser` (all 14 PDFs), `test_parser`, `test_chunker`, `test_metadata` (real header tables + recorded LLM output in `tests/fixtures/metadata_llm.json` → the plan's table) and `test_documents_api` (the full lifecycle against the dev DB and MinIO with OpenAI faked: upload/403/415/409, worker, BM25 rows, file stream, PATCH sync + `needs_reindex`, reindex dedupe, delete → MinIO object gone and stats refreshed).
- **Verified:**
  - `pytest` 107 passed (~2.5 min); `ruff check` and `ruff format` are clean.
  - **Seed:** all 14 PDFs reached `ready` in `simtora`, ~20–40 s each with live flex calls (3 in parallel, about 2 minutes overall). Metadata matches the plan's table for all 14 (after the prompt fix below).
  - **Chunk counts:** CMP 113, OVR 76, FAC 96, FIN 149, HR-001 88, HR-002 55, HR-101 55, HR-102 52, HR-103 57, HR-104 52, HR-105 54, GLB 76, IT 116, PRC 123. That's **1,162 chunks**; tokens median ≈ 150–280 per doc, max 620 (the 800 limit is never hit). There are 110,609 `chunk_terms` (6,228 distinct terms), and `bm25_stats` = (1162, avg_len 144.9).
  - **`llm_usage`:** 15 `classify` and 15 `summarize` rows (flex requested, flex actual) and 19 `embed_ingest` rows. The whole corpus cost ≈ **$0.012**: classify ≈ $0.0027, summarize ≈ $0.0025, embeddings ≈ $0.0067. Each classify input is ~3.1k tokens.
  - **Live uvicorn:** the lifespan logged "Started 1 ingestion worker(s)". The server's own worker took an uploaded PDF through queued → downloading 5 → parsing 20 → metadata 35 → embedding 60 → indexing 95 → done 100. The `/file` stream (inline, `private, max-age=300`) opens in pdfplumber with 78 pages. Re-upload returned 409 with the existing id. Delete returned 204 and then 404.
  - Spot-checked rows, e.g. SIM-HR-001 #26: path `[Part 3 – Dealing with Employee Concerns, 3.1 Open Door and Grievance Procedure]`, §3.1, p30, prose. SIM-HR-102 #5 is a `table` chunk for §1.4 on p7.
- **Parser heuristics that needed tuning:**
  - `find_tables()` returns a page-sized frame "table" on ~80% of pages. Tables covering ≥ 90% width and ≥ 80% height are ignored, otherwise every page's prose would be swallowed.
  - Sizes are rounded to 0.5 pt, so 14.5 pt KaTeX math isn't taken for the 15 pt L3 heading size. Size-based headings must also be bold (or ≥ 1.3× body).
  - Bold body-size L3 headings need a gap above of > 0.9× body (or to be first on the page), a short line (< 85% of the measure) and no closing punctuation. Without that, wrapped bold sentences became headings.
  - Wrapped headings merge (same level, gap < 0.9× size), including the first line of the next page for L1/L2 headings without a number. That fixed Germany's "Part 3 – … and" | page break | "On-Call".
  - Font switches split words ("days )." / "completion :"); spaces before closing punctuation are removed.
  - The TOC is skipped from the "Contents" heading to the next heading of the same or a higher level. The "End of document – …" line is dropped with the footers.
  - The header table is looked for on pages 1–2: SIM-GLB-001's is on page 2.
- **Deviations from plan:** see "Decisions made (Phase 4)". In addition:
  - Title lines that wrap (Company Overview, Global Supplement) are merged before the entity/title rule.
  - `related_doc_codes` expands ranges ("SIM-HR-101 to SIM-HR-105").
  - Unknown header rows (France's "Language") are kept in `header["other"]` and passed to the LLM.
- **Gotchas / learnings:**
  - **The first seed classified the UK manual as `policy_manual`.** The fix: the classify prompt now says a single-country manual next to a main manual is a `country_supplement` even when it's titled "Manual". After that, 14/14 were correct on 3 consecutive runs. The UK doc was deleted and re-uploaded via the API to pick it up.
  - `Select.distinct(col)` is deprecated in SQLAlchemy 2.1; use `.ext(postgresql.distinct_on(col))`.
  - Source-PDF defects (not parser bugs): the Company Overview §6.3 legal-entities table loses its rows after the first at a page break, and some manuals render `$…` amounts as KaTeX math with no spaces.
  - A heredoc used to patch a regex turned `\\1` into a `\x01` byte. Keep using Write/Edit (as CLAUDE.md says).
- **Next:** Phase 5 (hybrid retrieval, agents, chat). Use `rag.tokenizer.term_freqs` for queries, `services.org_settings.effective_settings` for models and tiers, and `llm.client.respond`/`embed` (streaming needs its own wrapper that reads usage from `response.completed`).

### 2026-10-07 — Phase 3 (done)
- **Built (`api/`):**
  - **Config:** `core/config.py`, `Settings` with a cached `get_settings()`. `db_schema` is parsed from `DATABASE_URL` and validated as an identifier. `pricing_file` defaults to the repo-root `model-pricing.json`.
  - **DB:** `core/db.py`. `normalize_database_url` maps the scheme to `postgresql+asyncpg`, drops every param, turns `sslmode` into asyncpg `ssl`, and sets `search_path=<schema>,public` plus `application_name`. Pool 5+5 with pre-ping, plus `get_session` and `session_scope`.
  - **Models:** `models/` with `base` (MetaData with the schema + naming convention), `auth` (read-only `"user"`/`organization`/`member` mirrors, snake_case `key=`s, `BETTER_AUTH_TABLES`), `document` (documents, ingestion_jobs, chunks + HNSW, chunk_terms, bm25_stats), `chat`, `org_settings` and `usage`. UUID PKs default both in Python (`uuid4`) and in the DB (`gen_random_uuid()`).
  - **Alembic:** async template. `env.py` takes the URL from settings (none in `alembic.ini`), puts the version table in our schema, uses `include_name`/`include_object` filters and pgvector reflection. Hand-written `0001_initial`, parameterized by schema; `script.py.mako` emits `SCHEMA` for future revisions.
  - **Security:** `core/security.py`. `verify_api_key` uses `compare_digest`. `get_actor` resolves `X-User-Id`, rejects unknown or banned users and honours `banExpires`; `is_admin` parses comma-separated roles. Also `require_org_access` and `require_admin`, and the `ActorDep`/`OrgDep`/`AdminDep`/`SessionDep` aliases.
  - **Storage:** `core/storage.py` with `document_key`, `put_pdf`, `open_stream` (returns `ObjectStream(iterator, content_length, content_type)`; the body closes when iteration ends), `delete` and `ensure_bucket`. boto3 runs via `anyio.to_thread`.
  - **App:** `core/log.py` configures logging once and adds a pure-ASGI `RequestIdMiddleware` (reuses or mints `X-Request-ID`, logs one line per request, `/health` stays quiet). `core/errors.py` produces `{error: {code, message[, details]}}` for HTTP, validation and unhandled errors.
  - **Routers:** `health`; `v1` (prefix `/v1`, key-gated); `me` (`GET /v1/me` returns the actor plus accessible orgs, all orgs for admins); empty `documents`/`chat`/`conversations`/`settings`/`analytics` stubs; `services/orgs.py`.
- **Verified:**
  - `alembic upgrade head` created the 9 tables plus `alembic_version` in `documind_dev`. The HNSW index is `USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=64)`.
  - The downgrade → upgrade round-trip works, and `alembic check` reports no drift.
  - The Better Auth tables are untouched (3 users / 1 org / 2 members before and after).
  - `pytest`: 35 passed (URL normalizer, the key/user matrix, org access via a probe app, helpers, health and request id). `ruff check` and `ruff format` are clean.
  - **Live uvicorn:** `/health` returned `{ok, ok}`. `/v1/me` returned 401 without a key, and 200 with the key and the owner's id (admin, `simtora` as `owner`). The OpenAPI spec has the `APIKeyHeader` scheme and `/docs` returns 200. The startup log says "Storage bucket 'documind-docs' is ready".
  - A MinIO put/stream/delete round-trip passed.
- **Deviations from plan:** see "Decisions made (Phase 3)". In addition:
  - The logging module is `core/log.py` (to avoid shadowing `logging`), and `/v1/me` lives in `routers/me.py`.
  - The ruff isort config pins `alembic` as third-party, because the `api/alembic/` dir made it look first-party.
- **Gotchas / learnings:**
  - **Alembic autogenerate on the shared DB** first proposed dropping `public.n8n_chat_histories` (another app's table) and re-creating every FK, because our schema was the connection's *default* schema, so it was reflected as `None` while the metadata says `documind_dev`. The fix: migrations connect with `search_path=public` and `include_name` accepts only our schema.
  - Alembic ops apply the metadata naming convention: an explicit `name="ck_x"` became `ck_t_ck_x` until wrapped in `op.f()`.
  - **Dev → VPS DB latency** is ~0.45 s per round-trip and 1–3 s for a cold connect. The first `/health` exceeded a 3 s timeout, so it's now 5 s. In prod (same host) it's negligible.
  - Tests dispose the engine after each test (per-test event loops can't share pooled asyncpg connections).
- **Next:** Phase 4 (ingestion). Start the worker in `main.lifespan` and use `storage.document_key`/`put_pdf`/`open_stream`. When document metadata is edited, keep the chunks' denormalized columns in sync.

### 2026-10-07 — Phase 2 (done)
- **Built:**
  - **Design foundation (`/impeccable` teach):** PRODUCT.md (register: product) and DESIGN.md/DESIGN.json, from a short interview. OKLCH tokens (light + dark) in `globals.css`, fonts via `next/font`, `components/brand/logo.tsx`, and `app/icon.svg`.
  - **DB:** `lib/db.ts` (pg Pool, `search_path=<schema>,public`, max 5) + `lib/db-url.ts`; `pnpm db:schema` created `documind_dev`; `pnpm auth:migrate` created the 7 Better Auth tables there.
  - **Auth:** `lib/auth.ts` with email+password (verification required), Google, emailOTP, organization, admin and nextCookies; rate limiting on; the admin bootstrap hooks (user create + session create). Plus `auth-client.ts`, the route handler, and Resend emails (`lib/email/`: OTP + invitation templates, unquoted `from`, idempotency key on invitations only).
  - **Pages:** sign-in, sign-up, verify-email, forgot-password, reset-password and accept-invitation, with an auth layout whose side panel shows a real cited passage (SIM-HR-102 §5.2).
  - **Guards and shell:** `proxy.ts` (optimistic cookie redirects with a `reauth` escape from loops), `lib/auth-guards.ts`. The app shell has a sidebar, org switcher (Popover + Command), user menu (theme, platform admin, sign out) and mobile trigger.
  - **App pages:** the `/app` resolver with empty states (admin: create org; member: ask admin; pending invitations listed), `/app/new-org` and `/app/[org]/members` (add existing user directly / invite unknown email, remove, resend, withdraw). The chat page and the admin-only documents/settings/analytics pages are placeholders. `/admin/users` has search, pagination, promote/demote and suspend/restore.
- **Verified:**
  - `pnpm typecheck`, `lint` and `build` pass. All authenticated routes are Partial Prerender with session reads inside Suspense.
  - **Playwright E2E** (headless Chrome against `next dev`; script kept out of the repo) passed **48/48 checks**. It used Resend sink addresses (`delivered+…@resend.dev`), with `PLATFORM_ADMIN_EMAILS` extended for the test process only. OTP rows were overwritten with a known hash, since the codes are hashed. It covered:
    - sign-up → OTP → signed in; admin role on sign-up and re-promotion on login;
    - creating the `simtora` org, with the admin as owner;
    - non-admin blocked from new-org, admin, members and other orgs (the not-found UI renders and no content leaks);
    - add an existing user, duplicate error, invite an unknown email, resend (extends expiry), invitee sign-up → back to the invitation → accept → org chat;
    - forgot → reset → old password rejected → new password works;
    - promote/demote, suspend (sessions revoked) and restore, remove member;
    - Google start URL; no horizontal scroll at 375px; dark mode.
  - The preflight script passed (Resend accepted a send from the configured `from`). No send errors in the server log.
  - The test data was deleted afterwards, so `documind_dev` has 0 users and 0 orgs.
- **Deviations from plan:**
  - `@better-auth/cli migrate` was replaced by `pnpm auth:migrate`: the CLI is deprecated (1.4.21) and refuses `server-only`.
  - `sendVerificationOnSignUp` was not set: with `overrideDefaultEmailVerification` the plugin ignores it, and core sends on sign-up. The `sign-in` OTP type is not mailed (`disableSignUp: true`).
  - Admin org operations use the adapter/SQL instead of `auth.api.createInvitation` etc. (membership requirement, see Decisions).
  - Admin-only pages 404 for non-admins (`notFound()`, not a redirect), so their existence isn't advertised.
  - The design context lives at the repo root (impeccable's loader looks there), not in `web/`.
  - Added `ButtonLink`, `shadcn` `use-mobile` was rewritten with `useSyncExternalStore` (lint), and `scripts/preview-emails.ts` was added.
- **Gotchas / learnings:**
  - **Phase 1 env loading never worked at build time.** Next had already cached `web/`'s env, so `loadEnvConfig("..")` was a no-op. `forceReload` fixed the build but put `next dev` into an endless client-restart loop. `next.config.ts` now parses the root `.env.local` with `util.parseEnv` and fills only unset keys.
  - **If `next dev` ever reloads endlessly** (log alternates "Compiled in 2ms" / the same GET), stop it and `rm -rf web/.next/dev`. A corrupted Turbopack dev cache caused it once more after a quick kill/restart.
  - **Next 16 keeps visited routes mounted but hidden (Activity).** Static `id`s collide across pages and labels can point at hidden inputs, so client-form ids use `useId()`.
  - **Base UI `Button render={<Link/>} nativeButton={false}`** renders `<a role="button">`. Use `ButtonLink`.
  - `notFound()`/`redirect()` inside Suspense return HTTP 200 and resolve client-side. Tests must assert the UI, not the status.
  - **Better Auth per-IP limits:** 3/min on each email-OTP endpoint, 3/10s on sign-in/sign-up. E2E needs a distinct `X-Forwarded-For` per simulated user.
  - The Resend key is **send-only** (401 on reads), so OTP emails can't be fetched via the API in tests.
  - The static `/verify-email` and `/reset-password` pages bake `RESEND_FROM_EMAIL` at build time (Phase 8: set it as a build variable).
  - In dev, "Could not validate `instant`" console errors appear when a layout calls `notFound()` for a forbidden org. They're dev-only and harmless.
- **Next:** the owner's manual checks (Pending user actions), then Phase 3 (FastAPI reads `"user"`, `member`, `organization` per the table above).

### 2026-10-07 — Phase 1 (done)
- **Built:**
  - `git init -b main` with the remote set; root `.gitignore`, `.env.example` (every key, commented), `docker-compose.dev.yml` and README.
  - The `text-embedding-3-small` entry in `model-pricing.json`.
  - `web/`: Next 16.4.0, React 19.3, Tailwind 4.3, shadcn `base-nova` (Base UI primitives, lucide) with `button`.
    - `next.config.ts` loads the root env and sets `output: "standalone"` and `serverExternalPackages: ["pg"]`.
    - There's a placeholder page and a `typecheck` script.
  - `api/`: uv project with all deps, `app/` subpackages, `main.py` (lifespan + `GET /health`), ruff/pytest config and a health test.
  - `.env.local`:
    - added the Phase 1 keys (secrets generated, never printed);
    - set the DB schema to `documind_dev`;
    - changed the Resend display name to DocuMind.
- **Verified:**
  - `.env.local` is git-ignored.
  - MinIO is up: the console at :9001 returns 200, and bucket `documind-docs` exists and is private (anonymous GET returns 403).
  - Web: `pnpm typecheck`, `lint` and `build` pass; `pnpm dev` serves the "DocuMind" page (on :3001 this session because of the port clash).
  - API: `/health` returns ok, `/docs` returns 200, and `pytest` and `ruff` pass.
  - The OpenAI smoke test passed for all 4 calls.
- **Deviations from plan:**
  - MinIO images are `pgsty/*`, because the official images are gone.
  - The create-next-app 16.4 template enables **`cacheComponents: true` and `partialPrefetching: true`**; both are kept.
    - In Phase 2, read `web/node_modules/next/dist/docs/01-app/02-guides/authentication-with-cache-components.md` before session checks.
    - Dynamic APIs (`headers()`, `cookies()`) must sit under `<Suspense>` or in dynamic segments.
  - Tailwind runs via the `@tailwindcss/turbopack` loader (template default), not PostCSS.
  - The shadcn CLI now generates `cn` from the **`cn` npm package** (shadcn's clsx + tailwind-merge replacement), not `clsx`/`tailwind-merge`.
  - The API config and DB normalizer were left for Phase 3, where its doc specifies them.
- **Gotchas / learnings:**
  - **shadcn font bug.** shadcn init wrote a circular `--font-sans: var(--font-sans)` in `globals.css`, now fixed to `var(--font-geist-sans)`. Phase 2 replaces the fonts anyway.
  - **`web/AGENTS.md` is managed by `next dev`.** It's auto-(re)written and says to read `node_modules/next/dist/docs/` before writing Next code. Keep it committed.
  - **Docker from Git Bash.** Paths like `/bin/sh` get mangled, so prefix with `MSYS_NO_PATHCONV=1`. Don't use that with `curl -o /dev/null`.
  - **Python on Windows.** The console is cp1252: emoji in output crash Python prints, so use `PYTHONIOENCODING=utf-8`.
- **Port clash (resolved).**
  - The PDFToolkit project's containers (`pdftoolkit-frontend-1`/`-backend-1`, from `E:\Projects\Claude Code\2_Tools\PDFToolkit`) held :3000/:8000 and auto-started with Docker Desktop.
  - They're now stopped with their restart policy set to `no`, which frees :3000/:8000.
  - Running `docker compose up` in that project would restore its `unless-stopped` policy.
- **Next:** Phase 2 (`/impeccable` design context, Better Auth, organizations). Phase 2 creates the `documind_dev` schema.

### 2026-10-06 — Planning
- The plan was split into 9 phase docs under `docs/plan/`, and `CLAUDE.md` and this file were created. No code yet.
- Next: Phase 1.

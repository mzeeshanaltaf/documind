# DocuMind — Implementation Status

> **Session protocol**
> - **Start of every session:** read `CLAUDE.md`, then this file, then the current phase doc in `docs/plan/`.
> - **End of every session:**
>   - update the phase table;
>   - add a dated entry to the Session log (what was built, deviations from the plan, gotchas, next steps);
>   - move resolved items out of "Open decisions".
> - Never write secrets here; this repo is public.

## Current phase
**Phase 2 — Design foundation, auth & organizations** (not started)

## Phase tracker
| # | Phase | Doc | Status |
|---|---|---|---|
| 1 | Scaffold & environment | [phase-1](docs/plan/phase-1-scaffold-and-environment.md) | ✅ Done |
| 2 | Design foundation, auth & organizations | [phase-2](docs/plan/phase-2-auth-and-organizations.md) | ⬜ Not started |
| 3 | API foundation & data model | [phase-3](docs/plan/phase-3-api-foundation-and-data-model.md) | ⬜ Not started |
| 4 | Document ingestion | [phase-4](docs/plan/phase-4-document-ingestion.md) | ⬜ Not started |
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
- Phase 2: make sure the Google OAuth client allows `http://localhost:3000/api/auth/callback/google`.
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

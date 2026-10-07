# DocuMind — Implementation Status

> **Session protocol**
> - **Start of every session:** read `CLAUDE.md`, then this file, then the current phase doc in `docs/plan/`.
> - **End of every session:**
>   - update the phase table;
>   - add a dated entry to the Session log (what was built, deviations from the plan, gotchas, next steps);
>   - move resolved items out of "Open decisions".
> - Never write secrets here; this repo is public.

## Current phase
**Phase 8 — Deployment** (in progress). Infra is provisioned; deploy is blocked on the owner actions listed under *Pending user actions*.

> ⚠️ **Before launch: the owner must have the Privacy Policy (`/privacy`) reviewed legally.** It was written to match what the app really does (see the Phase 7 log), but it is not legal advice.

## Phase tracker
| # | Phase | Doc | Status |
|---|---|---|---|
| 1 | Scaffold & environment | [phase-1](docs/plan/phase-1-scaffold-and-environment.md) | ✅ Done |
| 2 | Design foundation, auth & organizations | [phase-2](docs/plan/phase-2-auth-and-organizations.md) | ✅ Done |
| 3 | API foundation & data model | [phase-3](docs/plan/phase-3-api-foundation-and-data-model.md) | ✅ Done |
| 4 | Document ingestion | [phase-4](docs/plan/phase-4-document-ingestion.md) | ✅ Done |
| 5 | Hybrid retrieval, agents & chat API | [phase-5](docs/plan/phase-5-hybrid-retrieval-agents-and-chat-api.md) | ✅ Done |
| 6 | App UI | [phase-6](docs/plan/phase-6-app-ui.md) | ✅ Done |
| 7 | Marketing site & design polish | [phase-7](docs/plan/phase-7-marketing-site.md) | ✅ Done |
| 8 | Deployment (Coolify + MinIO) | [phase-8](docs/plan/phase-8-deployment.md) | 🟨 In progress |
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

## Decisions made (Phase 5, 2026-10-07)
- **Fusion is weighted RRF, tuned on the eval.** BM25 lists count ×0.6 and vector lists ×1.0. When the router finds no country, country-supplement chunks get ×0.9 (base and global documents stay ×1.0). The plan's boosts (same country ×1.25, GLOBAL ×1.0, other country ×0.8) apply unchanged when a country is found. The constants live in `rag/hybrid.py`; re-run the eval after changing them.
- **"Searchable" = indexed at least once** (`indexed_at IS NOT NULL`), not `status='ready'`. This applies to the catalog and to the `document_ids` check, so a document being re-indexed doesn't drop out (see Phase 4).
- **The router call uses the chat tier** (latency-sensitive); only titles use the background tier.
- **Document-scoped chats skip the LLM entirely when there is no history.** The question is used as-is; with history, a small `rewrite` call (operation `router`) resolves it. A conversation started with `document_ids` keeps that scope when later requests omit them.
- **Clarification is enforced in code too.** It needs the model's flag and question, no jurisdiction, and more than one country version for the routed departments.
- **Disconnects are not detected with `request.is_disconnected()`.** That would race sse-starlette's own receive loop. sse-starlette cancels the generator (or leaves it at a `yield`, which the response's `background=aclose` ends); `run_chat` then saves the partial answer as `stopped`, and the answer's usage row is written with locally counted tokens (`pricing_estimated=true`, `status='stopped'`).
- **Extra fields beyond the plan.** The `routing` event also carries `sub_queries` and `document_ids`; `sources` adds `document_id`, `section_title`, `page_end` and `jurisdiction`; citations add `chunk_id`. `messages.sources` stores the full source (with text), so old answers can render hover cards. `messages.retrieval` stores per-list hit counts, per-source ranks/RRF, timings and usage totals.
- **The `usage` event's `latency_ms`/`ttft_ms` are end-to-end** (from the start of the pipeline to the first delta / done). The `answer` usage row keeps the model's own TTFT.
- **Analytics.** `requests` = `answer` calls; `granularity` also accepts `week`; `by_agent` counts routed departments, plus `Scoped` (document chats) and `General` (no department), with cost joined by `message_id`. The timeseries also carries `requests` and `p95_latency_ms` (Phase 6's latency chart). `GET /v1/admin/orgs` adds a conversation count.
- **Settings.** `PUT` updates only the fields sent; `null` resets one to its default. The model list = pricing-file keys minus `text-embedding-*`.

## Decisions made (Phase 6, 2026-10-07)
- **Reads vs writes.** Browser reads (conversation list, document polling, detail, PDF file, chat SSE, uploads) go through the `/api/backend` BFF. Mutations (rename/delete conversation, feedback, document edit/reindex/delete, settings) are Server Actions that re-check access and call `apiJson`. Uploads stay on the BFF for streaming and per-file progress (XHR).
- **New chat URL** switches with `history.replaceState`, not `router.replace`: a route change would re-render the page and drop the live stream. Next keeps visited routes mounted (Activity), so the `/chat` view resets itself when you navigate back to it.
- **Conversation list** is one SWR cache entry per org, shared by every mounted chat view; titles are re-fetched right after `done` and again 3 s later (they're written in the background).
- **Members get a read-only Documents page** (searchable docs only, no status, no actions except View/Details), linked in their sidebar. Admins keep it under Manage. Settings, analytics, members and `/admin` stay `notFound()` for members.
- **PDF viewer** renders one page at a time (react-pdf v11, `suspense={false}`), kept mounted (`keepMounted` added to `SheetContent`) so the loaded document survives citation clicks. Highlighting marks text items whose normalized text (≥ 4 letters/digits) is inside the normalized chunk, only on `page_start..page_end`; the text layer is `mix-blend-mode: multiply` so glyphs stay crisp.
- **Chart palette** re-stepped and validated (see DESIGN.md › Data visualization): the brand ink green failed the chroma floor as a mark.
- **API additions:** `MessageOut.usage` (latency/TTFT/cost from `messages.retrieval`, platform admins only) so reloaded answers keep the admin usage line; `by_model_tier` gains `answers` and `answer_cost_usd` so tiers compare per answer; a stopped or failed first turn now also gets a title.
- **Rate limit** is checked in the BFF before proxying (`chat:${userId}`, sliding 30/min, Upstash). It fails open if Redis errors; 429 carries `Retry-After`.

## Decisions made (Phase 7, 2026-10-07)
- **Marketing pages live in `app/(marketing)`** (header, footer, skip link). The root `app/page.tsx` placeholder is gone; `/` is the landing page (Partial Prerender: static shell + the session-cookie check streamed in the header).
- **Header auth state = cookie presence only** (`getSessionCookie(await headers())`, no DB). Its Suspense fallback is the signed-out actions, which is also what no-JS visitors and crawlers get. A stale cookie shows "Open app", and `/app` then sends the person to sign in.
- **No-JS first.** FAQ = native `<details>`; mobile menu = native `popover` top sheet; contact form = real `action="/api/contact" method="post"`.
- **`/contact` sets `export const instant = false`** and awaits `searchParams` outside Suspense. A streamed Suspense boundary only resolves with JavaScript, so without this the no-JS `?sent=1` / `?error=` result would never replace the fallback. The route is therefore dynamic (ƒ).
- **Contact route:** JSON (hydrated fetch) or url-encoded/multipart (native) bodies; zod schema in `lib/contact.ts` (shared with the form); honeypot `hp_field` checked first and answered with a fake success; Upstash limit **5 per 10 min per IP** (`limitContact` in `lib/rate-limit.ts`, key `contact:<ip>`, prefix `documind:ratelimit`, fails open), 429 + `Retry-After` for JSON, 303 `?error=rate` for native posts; n8n gets `{name, email, message, source: "documind", submittedAt}` with `x-api-key`, 10 s timeout.
- **Landing copy stays accurate to the product:** new sign-ups can't upload (platform admins do), so the CTA band says "Invited by your team? Create your account… Setting DocuMind up for your company? Talk to us". Security copy says text goes to OpenAI for indexing *and* answering; no certifications claimed.
- **SEO:** root metadata (`metadataBase` = `NEXT_PUBLIC_APP_URL` via `lib/site.ts`, title template, OG + `summary_large_image`), static `opengraph-image.tsx` (fonts read at module scope from `web/assets/fonts/*.woff`; Satori can't read woff2), `apple-icon.tsx`, `sitemap.ts` (constant `lastModified`), `robots.ts` (disallow `/app`, `/admin`, `/api`). Next also emits `twitter:image` from the OG image.
- **App-wide fixes from the audit:** `SidebarInset` gets `min-w-0`; the documents table hides columns by container width (`@container`); admin header and admin tables fit 360px; branded `app/not-found.tsx` (also shown for forbidden pages).

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

## Production (Phase 8, 2026-10-07)
| What | Value |
|---|---|
| Web | `https://documind.zeeshanai.cloud` → Coolify app **`documind-web`** `7hf4gmnbhx1rmeepsrotndlt` (Dockerfile `/web/Dockerfile`, port 3000, health `/robots.txt`) |
| API | `https://api.documind.zeeshanai.cloud` → Coolify app **`documind-api`** `anaat3diukcx2lizx4srhe8r` (Dockerfile `/api/Dockerfile`, port 8000, health `/health`, network alias **`documind-api`**) |
| MinIO | Coolify service **`documind-minio`** `fa669uo1gjnscdpbapxmb5qn`, image `pgsty/minio`, internal only: `http://minio-fa669uo1gjnscdpbapxmb5qn:9000` on the `coolify` network, no domain, no host ports. Bucket `documind-docs` (private) |
| Coolify | `https://coolify.zeeshanai.cloud` (4.3.23), project **DocuMind** `vh71w2o5wsavqnhfsu6pucdc`, server `j1234smx72kcb6aeovlaa9f7`, env `production` |
| DB | Shared Postgres via the docker0 gateway `10.0.0.1:5432`, `?schema=documind` (`sslmode=require` kept) |
| DNS | A `documind` + `api.documind` → 76.13.7.106, TTL 300 (Hostinger) |
| Deploy | `.github/workflows/deploy.yml` (paths-filter → lint/typecheck → Coolify deploy API); Coolify "Auto Deploy" is **off** on both apps |

- **Prod secrets** live in Coolify and in the owner's git-/docker-ignored `.env.production.local` (MinIO root + app creds, prod `DOCUMIND_API_KEY`, prod `BETTER_AUTH_SECRET`, prod `DATABASE_URL`). The prod API key and auth secret are new, not the dev ones.
- **MinIO app credentials** are a dedicated user `documind-app` with policy `documind-app-rw` (List on the bucket; Get/Put/Delete on `documind-docs/*`), not the root user.
- **`API_BASE_URL=http://documind-api:8000`** (internal hop). Coolify container names carry a per-deploy suffix, so the api has `custom_network_aliases=documind-api` for a stable name. Both apps must be on the `coolify` network (Coolify's default for apps).
- **Env flags (Coolify 4.3):** build-time = `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_UMAMI_*`, `RESEND_FROM_EMAIL` only (the web Dockerfile declares exactly these as `ARG`s); everything else runtime-only.

## Open decisions
- (none)

## Pending user actions
- **Phase 8 blockers (owner):**
  1. ~~Create Better Auth's tables in the prod schema `documind`~~ — done 2026-10-07 (`pnpm auth:migrate` with the prod URL; all 7 tables verified in `documind`).
  2. Commit + push the Phase 8 files (`/ship`): Coolify builds from `main`, so the Dockerfiles must be on GitHub.
  3. ~~Add repo secrets `COOLIFY_BASE_URL` and `COOLIFY_API_TOKEN`~~ — done 2026-10-07 (`gh secret set`).
  4. Google Cloud Console → OAuth client: add redirect URI `https://documind.zeeshanai.cloud/api/auth/callback/google` and JS origin `https://documind.zeeshanai.cloud` (keep the localhost entries).
- **Phase 2 manual check (owner):** Click "Continue with Google" on http://localhost:3000/sign-in and complete the consent screen. If Google shows `redirect_uri_mismatch`, add `http://localhost:3000/api/auth/callback/google` to the OAuth client.
  - Done as of Phase 3: the owner's admin account exists, and the org "Simtora Technologies" (`simtora`) exists with the owner as `owner`.
- **Before launch: get the Privacy Policy (`/privacy`) legally reviewed.** Check especially the legal bases, international transfers (OpenAI, Resend, Google, Upstash), retention promises ("we delete an organization's data when it's closed" and account deletion on request are manual today) and the 16+ age line. Its effective date is the `EFFECTIVE_DATE` constant in `app/(marketing)/privacy/page.tsx`.
- Check the n8n contact workflow received the Phase 7 test message ("DocuMind Phase 7 check", `phase7-check@example.com`) and delete it.

## Session log
<!-- Newest first. Template:
### YYYY-MM-DD — Phase N (status)
- Built: …
- Deviations from plan: …
- Gotchas / learnings: …
- Next: …
-->
### 2026-10-07 — Phase 8 (in progress: infra provisioned, not deployed)
- **Built:**
  - `api/Dockerfile` (python:3.12-slim + uv, `uv sync --frozen --no-dev`, non-root uid 10001, curl HEALTHCHECK on `/health` with a 90 s start period, `alembic upgrade head && exec uvicorn …`, one worker), `web/Dockerfile` (node:24-alpine, corepack pnpm, standalone runner as `node`), root `.dockerignore`.
  - `.github/workflows/deploy.yml` + `.github/scripts/coolify-deploy.sh` (POST `/api/v1/deploy`, 5 attempts with backoff).
  - Coolify project, `documind-minio` service, bucket + scoped app user, `documind-api`/`documind-web` apps with env, DNS A records (see **Production** above).
- **Verified:** both images build and run locally (api `/health` ok with db ok + bucket ready; `/v1/me` 401 without key or without user; web `/`, `/contact`, `/privacy`, `/sign-in`, `/robots.txt`, `/opengraph-image` 200, `/app` 307). Secret scan: no `.env.local` value appears anywhere in git history. MinIO is healthy on the `coolify` network; ports 9000/9001 on the VPS IP refuse. DNS resolves. `next.config.ts` tolerates a missing root `.env.local` (the build in Docker has none).
- **Deviations from plan:**
  - api `CMD` execs the venv binaries (`alembic`, `uvicorn`) instead of `uv run …`, so uvicorn is PID 1 and gets SIGTERM; `UV_NO_SYNC=1` keeps `docker exec … uv run python -m scripts.seed_policies` working.
  - `RESEND_FROM_EMAIL` is a web build arg too (static auth pages bake it).
  - Seed PDFs are not baked into the image (`docs/` is docker-ignored); copy them in with `docker cp` when seeding.
  - CI gate = `ruff check` (api) and `pnpm lint` + `pnpm typecheck` (web). No pytest in CI: the suite needs the dev DB and MinIO (there is no `db` marker).
  - `trustedOrigins` already came from env (`appUrl()`); only its comment changed.
- **Blocked (resolved):** creating Better Auth tables in prod `documind` was first denied by the session's permission classifier; after the owner cleared it, `pnpm auth:migrate` created all 7 tables. Deploy still waits on the push + repo secrets (see *Pending user actions → Phase 8 blockers*).
- **Gotchas / learnings:**
  - Coolify 4.3's env API uses **`is_buildtime` / `is_runtime`**; `is_build_time` is silently ignored and the var defaults to build-time.
  - Coolify app containers are named `<uuid>-<deploy suffix>` → use `custom_network_aliases` for a stable internal hostname.
  - Traefik's gzip middleware is on for Coolify apps; Traefik v3 skips `text/event-stream`, but check SSE streams unbuffered on the first deploy.
  - Python `subprocess` text-mode stdin on Windows sends `\r\n` (breaks `read -r` on the VPS); pass bytes.
  - Disk before: 55% (53G/96G); after provisioning: 56%.
- **Next:** owner clears the blockers → deploy api, then web (`POST /api/v1/deploy?uuid=…`), force/confirm Let's Encrypt certs, run the §7 smoke tests, sign up as admin on prod, create org `simtora`, `docker cp docs/policies` into the api container and run `uv run python -m scripts.seed_policies --org-slug simtora --dir /app/seed --wait`, verify a web-only push redeploys only web, record `df -h /`.

### 2026-10-07 — Phase 7 (done)
- **Built (`web/`):**
  - **Marketing shell:** `app/(marketing)/layout.tsx` (skip link, sticky header, footer), `components/marketing/` (`site-header` with the cookie-only auth check in Suspense, `mobile-menu` (native popover top sheet), `site-footer` (`"use cache"` year), `nav` (anchors + container), `hero-visual`, `demos`).
  - **Landing `/`:** hero (tagline headline, value prop, Get started / Talk to us, HTML product visual: the Germany manual open at p. 16 with the carry-over rule highlighted, under an answer with an "HR agent · Germany" chip and `[1]`/`[2]` chips), 01 problem → outcome (ruled clause table), 02 how it works (three steps, each with a different product excerpt), 03 features (hybrid-search demo with `SIM-PRC-001` and "can I expense my internet?" → HR §7.4 p. 59, routing demo, four more features as a ruled definition list), 04 security & privacy, 05 FAQ (6 `<details>`), ink-green CTA band. All demo content is quoted from the seed PDFs.
  - **Contact `/contact`:** from `/nextjs-contact-form`, restyled with shadcn `Field`/`Input`/`Textarea`; `app/api/contact/route.ts`, `components/contact/contact-form.tsx`, `lib/contact.ts`, `limitContact` in `lib/rate-limit.ts` (the existing limiter module, not the template's). Native validation until hydration, then inline zod errors with focus on the first invalid field.
  - **Privacy `/privacy`:** 12 sections with a sticky contents list, effective date constant, every processor the plan lists, links to `/contact` (no email address published).
  - **SEO:** `lib/site.ts`, root metadata + viewport theme colours, `opengraph-image.tsx`, `apple-icon.tsx`, `sitemap.ts`, `robots.ts`, `assets/fonts/` (4 WOFF files for Satori). Tokens `--band*` and the marketing CSS (`.dm-rise`, `.dm-stroke`, `.faq-item`, `.legal-prose`, anchor scroll padding) in `globals.css`.
- **Verified (prod build via `next start`, headless Chromium):**
  - `/`, `/contact`, `/privacy` at 360/768/1280 in light and dark: no horizontal overflow, no console errors.
  - **Lighthouse on `/`:** mobile 91/100/100/100 (Perf/A11y/BP/SEO; LCP 3.5 s simulated, CLS 0, TBT 40 ms), desktop 100/100/100/100. `/contact` mobile 89/100/100/100, `/privacy` mobile 90/100/100/100.
  - **Contact route** (second instance with the webhook pointed at a local capture server): honeypot (JSON and form) → success but nothing delivered; bad email / empty / > 5000 chars → `email`/`fields`/`length`; 5 valid submissions delivered with `x-api-key`; the 6th → 429 `Retry-After` (JSON) and 303 `?error=rate` (form).
  - **Browser:** with JS disabled the form posts natively, lands on `/contact?sent=1` and shows "Message sent"; `?error=rate` renders its alert; the browser blocks an invalid email; FAQ and the mobile menu open. With JS: novalidate after hydration, inline errors + focus, fetch success without navigation, "Send another", menu closes after an anchor click. 17/17 checks.
  - **Real n8n:** one submission through the configured webhook returned 2xx (see Pending user actions).
  - `robots.txt`, `sitemap.xml`, `/opengraph-image` (1200×630 PNG, static ○) and `/apple-icon` are served; OG/Twitter tags present.
  - `pnpm typecheck`, `lint`, `build` pass.
- **`/impeccable` audit (marketing, auth, chat, documents, members, settings, analytics, admin; 360/768/1280, light/dark; throwaway `test-e2e-*` admin + member with minted sessions, deleted afterwards):**
  - Fixed: **P1** the app content column stretched past the viewport whenever a table was wide (documents at 1280 and 768, members at 768); cause: `SidebarInset` without `min-w-0`, plus viewport-based column hiding inside a 256px-narrower column → `min-w-0` + container queries, titles wrap. **P1** admin header and admin tables overflowed at 360 → badge hidden and "Back to app" icon-only on phones; Documents/Members and Status columns hidden below `sm` (a "Suspended" marker moves into the user cell). **P2** the 404 (also the forbidden-page UI) was Next's unstyled default → branded `not-found.tsx`. **P3** footer links got 44px touch targets on phones; the hero's viewer header no longer wraps the doc code at 360.
  - **Deferred (P2):** analytics breakdown tables scroll sideways inside their bordered containers on phones (usable, but the last column is hidden until scrolled); a KPI sub-label truncates at 360.
  - **Deferred (P3):** mobile LCP is the hero headline waiting on Source Serif 4 with the `opsz` axis (122 KB woff2). Dropping the axis or `preload: false` on Geist Mono would buy a few Lighthouse points; kept because optical sizing is part of the type design.
- **Deviations from plan:** the honeypot is uncontrolled (`defaultValue`), read from `FormData` on submit; the contact rate limiter lives in the existing `lib/rate-limit.ts`; added "Already a member somewhere?" guidance on `/contact`; FAQ adds "Can I ask about specific documents only?"; the plan's em dash in the hero copy became a comma (DESIGN.md bans em dashes).
- **Gotchas / learnings:**
  - **Running `pnpm typecheck` (`next typegen`) with the owner's `next dev` up left dev serving a stale CSS chunk** (new `:root` tokens present, the later marketing rules missing). Verification moved to a prod build on :3100. Restart dev and delete `web/.next/dev` before looking at the site there.
  - **Under `cacheComponents`, `readFile` inside an `opengraph-image` handler makes it dynamic** (uncached I/O); read at module scope and it's prerendered (○). Matters for the standalone build: the runtime would otherwise need `assets/fonts` on disk.
  - `new Date()` in a server component fails the prerender; the footer year is an async component with `"use cache"`, the sitemap uses a constant date.
  - Smooth anchor scrolling makes Playwright's click on a just-scrolled element "not stable"; test contexts use `reducedMotion: "reduce"`.
  - `NEXT_PUBLIC_APP_URL` is inlined at build time (canonical, sitemap, robots, OG URLs); Phase 8 must set it as a **build** variable to the production domain.
- **Next:** Phase 8 (deployment). Set the four contact vars and `NEXT_PUBLIC_APP_URL` (as a build-time variable) in Coolify. `web/assets/fonts` needs no special handling: the OG image is prerendered at build.

### 2026-10-07 — Phase 6 (done)
- **Built (`web/`):**
  - **BFF:** `lib/api.ts` (`apiFetch`/`apiJson`/`ApiError`, server-only), `app/api/backend/[...path]/route.ts` (session → `X-User-Id`, dot-segment guard, streamed request body with `duplex: "half"`, unbuffered response, `request.signal` forwarded so Stop aborts upstream, SSE gets `no-cache, no-transform`), `lib/rate-limit.ts` (Upstash sliding 30/min). `lib/api-types.ts` holds the client-safe API shapes; `lib/format.ts` the cost/token/duration/jurisdiction formatters.
  - **Chat:** `chat/page.tsx` + `chat/[conversationId]/page.tsx` → `load-chat.ts` (parallel loads, foreign conversation → 404) → `ChatAppLoader` (`ssr:false`). `hooks/use-chat-stream.ts` (eventsource-parser; meta/routing/sources/delta/citations/usage/done/error; Stop; retry), `components/chat/*` (conversation list with date groups + inline rename + confirm delete + mobile drawer, composer with scope picker and chips, agent chips / "Scoped to N documents", phase text, react-markdown + a `remarkCitations` plugin turning `[n]` into `CitationChip`s with hover cards, collapsible sources, 👍/👎 with an optional note, copy, admin usage line, empty-state suggestions per department).
  - **PDF viewer:** `components/pdf/*` (provider + lazily loaded sheet; prev/next, page input, zoom, fit width, download, new tab; highlight via `customTextRenderer`; scrolls to the first mark).
  - **Documents:** admin table with 2 s SWR polling while anything ingests, filters, upload dialog (drag and drop, per-file XHR progress, 409 → "Already uploaded"), row actions (view, details, edit, reindex, delete), edit-metadata sheet (zod, tag input, "Reindex now" when `needs_reindex`), detail drawer (summary, outline → viewer, chunk count); read-only list for members.
  - **Settings** (model + $/1M for the selected tier, tier radios, Advanced: router model + top_k), **Analytics** (shared dashboard for `[orgSlug]/analytics` and `/admin/analytics` with an org filter: range presets/custom, 8 KPI cells, Recharts cost/tokens/p95, table view, 5 breakdown tables), **Admin** (`/admin` orgs overview, admin nav, org memberships column on users).
  - **Cross-cutting:** `loading.tsx` per segment, `error.tsx` (with `retry`) for the org and admin segments, mobile chat header with its own sidebar trigger.
- **Built (`api/`):** `MessageOut.usage` (admins), `by_model_tier.answers/answer_cost_usd`, title for stopped/failed first turns; tests +2 (144 total).
- **Verified (headless Chrome via a scratch Playwright script + live uvicorn/OpenAI; throwaway `test-e2e-*` users with minted sessions, removed afterwards):**
  - BFF: 401 without a session; member → 403 on settings; SSE events arrive incrementally through the proxy.
  - "How much PTO do employees in Germany get?": streamed, "HR agent · Germany" chip, hover cards, clicking a chip opened SIM-HR-102 at p. 7 with 15 marked spans; reload restores the titled conversation. A pp. 22–23 citation opened at p. 22 with 26 marks.
  - Scoped to SIM-IT-001: "Scoped to 1 document", every source SIM-IT-001. Stop mid-stream → "You stopped this answer"; after reload the partial answer is still there.
  - Admin: upload showed Queued → Fetching file → Classifying → Embedding → Indexing → Ready, the duplicate showed "Already uploaded"; edit metadata → Reindex now → Ready; outline 59 items; delete. Settings tier change persisted.
  - Analytics per answer: Flex $0.000159 vs Standard $0.000340 (gpt-6-luna). The chat tier was reset to the default afterwards.
  - Member/outsider: settings, analytics, members, `/admin`, `/admin/analytics` and a foreign org all render the not-found UI; documents is read-only.
  - Rate limit: a concurrent burst of 31 → 30 passed, the 31st 429 with `Retry-After`; the UI shows "Slow down a little … Try again in 25s" and keeps the question.
  - 360px: no horizontal overflow on chat, documents, analytics; the PDF sheet is full width. Dark mode checked. No console errors or hydration warnings in any run.
  - `pnpm typecheck`, `lint`, `build` pass (all app routes Partial Prerender, no build warnings); `pytest` 144 passed; ruff clean.
- **`/impeccable` critique** (chat, documents, analytics, settings, admin): the deterministic detector reported no findings on all Phase 6 UI + `globals.css`. Review fixes applied: one header on mobile chat, tooltips on answer actions, titles for stopped first turns, legend in series order, sparse latency points, per-answer cost by tier, hover snippet without the repeated heading, suggestions in department order, PDF highlight that keeps glyphs crisp.
- **Deviations from plan:** `history.replaceState` instead of `router.replace` (see Decisions); no `runtime`/`dynamic` exports on the BFF (rejected under cacheComponents); members' Documents page added to their sidebar; no canvas alias (pdfjs-dist 6 loads `@napi-rs/canvas` via a runtime `createRequire`, which the bundler never sees; the build is clean without it). Jurisdictions show the ISO code + country name (Windows doesn't render flag emoji).
- **Gotchas / learnings:**
  - Running `pnpm typecheck` (`next typegen`) while `next dev` is up put dev into the endless "Compiled in 1ms" reload loop; deleting `web/.next/dev` fixed it (CLAUDE.md updated).
  - react-pdf 11 uses Suspense by default; `suspense={false}` keeps the `loading`/`error` props. `pdfjs-dist` must be a direct dependency at react-pdf's exact version so `new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)` resolves under pnpm.
  - A `"use server"` file may only export async functions; shared zod schemas live in `lib/document-metadata.ts`.
  - Sliding-window limits are weighted across windows: a slow sequential burst (≈1.6 s per request from dev) never reached 30; the check has to be concurrent.
  - **Test-data incident:** an early E2E run selected a row by doc code and edited the real SIM-HR-105 (title, version) and reindexed it. It was restored from the PDF's own header/title (`United Kingdom HR Manual (London)`, 1.0), reindexed, and verified (54/54 chunks carry the original title). Rows now carry `data-document-id`, and tests target uploads by id only.
  - The dev DB keeps the usage rows from these runs (about $0.03); their user rows are gone, so analytics lists them as "Deleted user".
- **Next:** Phase 7 (marketing site and design polish). Candidates carried over: the chat's ~17 s end-to-end TTFT from dev (Phase 5 levers: embed concurrently with routing, write usage rows in the background).

### 2026-10-07 — Phase 5 (done)
- **Built (`api/`):**
  - **LLM layer:** `ResponseStream`/`stream_respond` in `llm/client.py` (flex fallback, TTFT at the first delta, usage from `response.completed`, a shielded usage write on close/cancel/error); `embed(usage_rows=…)` for per-request totals; `record_usage(estimated=…)`; `pricing.chat_models()`.
  - **Retrieval:** `rag/bm25.py` (the plan's SQL), `rag/vector.py` (`set_config` LOCALs in one round trip, re-sorted top k), `rag/hybrid.py` (parallel lists on separate sessions with at most 6 at once, sparse-department fallback, weighted RRF, jurisdiction boost, overlap de-dup, a token-budgeted selection that pulls in sibling table fragments, `Source`, and `mode` for the eval).
  - **Agents:** `catalog.py` (5-minute TTL; invalidated by document create, edit and delete and by the worker after indexing), `router.py` (strict schema + normalization + clarification policy; `rewrite_only` for scoped chats), `specialists.py` (8 specialists + generic), `answer.py` (rules, then personas and owners, then history, then the sources block), `citations.py`.
  - **APIs:** `services/chat.py` + `routers/chat.py` (SSE), `services/conversations.py` + `routers/conversations.py` (keyset cursor, owner-only, feedback), `routers/settings.py` (+ `schemas/settings.py`, `services/org_settings.py` view/update), `services/analytics.py` + `routers/analytics.py` (analytics + `/admin/orgs`). Titles are generated after `done` as background tasks (≤ 6 words, background tier).
  - **Eval:** `eval/golden.jsonl` (30 questions, checked against the chunk text: HR base, all 5 country manuals, IT, Finance, Procurement, Facilities, Compliance, global/cross-department, exact-code and paraphrased) and `eval/run_eval.py`.
  - **Tests (+35, 142 total):** `test_bm25_sql` (a toy corpus vs a pure-Python reference within 1e-6, filters, top-1 agreement with `rank_bm25`), `test_rrf`, `test_citations`, `test_router`, `test_chat_stream` (a fake OpenAI *client*, so the real metering runs: event order, persisted messages and usage rows, title, scoped follow-up with rewrite, clarification, disconnect → `stopped`, conversations, feedback, owner-only, settings, analytics, admin orgs).
- **Eval (`api/eval/results/2026-10-07.md`, live routing, top_k 8):**

  | Mode | hit@5 | hit@8 | MRR |
  |---|---|---|---|
  | BM25 | 0.967 | 0.967 | 0.833 |
  | Vector | 1.000 | 1.000 | 0.967 |
  | Hybrid | 1.000 | 1.000 | 0.944 |

  - Routing accuracy is 30/30 and jurisdiction 10/10. **Target met:** hybrid hit@8 is 1.000, ≥ both baselines and ≥ 0.85.
  - **Tuning, with routes and embeddings fixed** (so router variance doesn't add noise): plain RRF gave hybrid MRR 0.878 and hit@5 0.967, against vector's 0.917/1.000.
    - The cause: full-weight BM25 let generic terms outrank the right section. "Paid time off" matched on-call/overtime sections, and four country §9.1 "Performance Management" chunks outranked the base manual's PIP section.
    - The grid (BM25 weight 1.0/0.8/0.6/0.5 × supplement factor 1.0/0.9/0.8) picked 0.6/0.9: hybrid MRR 0.928 with hit@5/hit@8 1.0. 0.5/0.9 reached 0.944 but gains one question only, so it wasn't taken.
    - Vector's MRR moves with the router's phrasing (0.917 on fixed routes, 0.967 in the live run), so on MRR hybrid and vector are within run-to-run noise.
  - The remaining weak spot is lexical mismatch: "Can I bring my dog to the office?" — BM25 has no `dog` (the policy says "animals"/"pet"), so the hit sits at hybrid rank 3 against vector rank 1.
- **Verified live (uvicorn + real OpenAI; run before the fusion tuning, which only changes questions with no country):**
  - "How much PTO do employees in Germany get?" streamed meta → routing (HR/DE) → sources → 98 deltas → citations (SIM-HR-102 §1.3 p7, §5.2 p16) → usage → done. The answer was 30 working days + 5 for severe disability, and it noted that the U.S. PTO policy doesn't apply.
  - The follow-up "And what about in France? Can they carry it over?" gave `standalone_query` "How much PTO do employees in France get, and can they carry it over?" (FR) with 2 sub-queries; it cited SIM-HR-103 §5.2, the router cached 2,851 tokens, and the conversation got the title "Germany Employee Annual Leave".
  - Scoped to SIM-IT-001: only IT sources and citations; for vacation days it said plainly that the document doesn't cover it.
  - `llm_usage` has `router`/`embed_query`/`answer` rows with cost (and `title`). Switching `chat_service_tier` to flex gave `flex`→`flex` on router and answer, and the cost per question went from $0.00074 to $0.00036. The setting was reset afterwards.
  - Analytics returned totals, a 7-day timeseries, by_operation/model×tier/user/agent, top documents (SIM-HR-102, SIM-HR-103, SIM-IT-001) and feedback. `/v1/admin/orgs` and the 403/404 guards were checked.
  - `pytest` 142 passed (~5.5 min); `ruff check` and `ruff format` are clean.
- **Latency (dev → VPS DB):** about 17 s TTFT end to end. That's router ≈3.4 s, embed ≈0.5–3 s, search ≈2–3 s, fuse/load ≈1.5 s and answer TTFT ≈3–4 s, plus a separate usage-row commit per call (~0.45 s RTT each). In prod the DB is on the same host. If Phase 6 still feels slow, the next levers are running the query embedding concurrently with routing and writing usage rows in the background.
- **Gotchas / learnings:**
  - **The BM25 test caught a real bug:** in `(:k1 + 1)` Postgres inferred an *integer* parameter, so k1 = 1.2 became 1 (b likewise). k1/b are now `CAST(… AS float8)`.
  - asyncpg needs a `timedelta` for an `interval` parameter.
  - Python `uuid4` column defaults only run at flush: the first chat insert failed with a NULL `conversation_id`, so ids are now set explicitly.
  - sse-starlette 3.5 never `aclose()`s the body iterator on disconnect (see Decisions).
  - `uvicorn --reload` on Windows reloaded mid-edit once, then stopped picking up changes; restart it if responses look stale.
  - The dev DB now holds 4 manual test conversations for the owner in `simtora`, plus eval `router`/`embed_query` usage rows (no user id). They're harmless; delete them if a clean analytics view is wanted.
- **Next:** Phase 6 (app UI). The BFF must stream `text/event-stream` unbuffered (the API sends `X-Accel-Buffering: no`). Use `usage.ttft_ms`/`latency_ms` from the `usage` event, `routing.bypassed` for the "Scoped to N documents" chip, `citations[].highlight_text` for the PDF highlighter, and `settings.models`/`pricing` for the settings page.

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

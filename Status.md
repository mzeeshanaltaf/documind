# DocuMind — Implementation Status

> **Session protocol**
> - **Start of every session:** read `CLAUDE.md`, then this file, then the current phase doc in `docs/plan/`.
> - **End of every session:**
>   - update the phase table;
>   - add a short dated entry to the Session log (built, deviations, gotchas, next);
>   - remove finished items from "Pending user actions" and keep old log entries to a few lines.
> - Never write secrets here; this repo is public.

## Current phase
Phases 1–10 are built, deployed and owner-checked. The evaluation harness (below) is **code-complete with E9 — Human review & judge calibration** (2026-10-21, deployed `efbdc8e`); the judged parts of E4/E7/E8 and the first calibration grades wait for the Anthropic spend limit (access back 2026-11-01).

**DocuMind Office** (3D virtual office, `office/`) was planned 2026-10-22; **O1 and O2 are done** (2026-10-22, local only) and **O3 is next** (see the *DocuMind Office* section below).

> ✅ The Privacy Policy (`/privacy`) has been legally reviewed (owner-confirmed 2026-10-20). Re-review it if the app's data handling changes.

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
| 8 | Deployment (Coolify + MinIO) | [phase-8](docs/plan/phase-8-deployment.md) | ✅ Done (browser chat on prod confirmed 2026-10-20) |
| 9 | Umami analytics & wrap-up | [phase-9](docs/plan/phase-9-umami-analytics.md) | ✅ Done (live checks confirmed 2026-10-20) |
| 10 | API request logs & viewer (`/v1/logs/ui`) | [phase-10](docs/plan/phase-10-api-request-logs.md) | ✅ Done (shipped and checked) |

Legend: ⬜ Not started · 🟨 In progress · ✅ Done · ⛔ Blocked

## Evaluation harness
A standalone app at `https://evaluation.documind.zeeshanai.cloud` (code in `evaluation/`) that evaluates DocuMind end to end.
- **Docs:** overview, data model and metrics in [docs/plan/eval/README.md](docs/plan/eval/README.md); guide in [evaluation/CLAUDE.md](evaluation/CLAUDE.md).
- **Session logs:** entries tagged `[eval]` in the Session log below.
- **Current eval phase:** **E9 — Human review & judge calibration**: built and deployed 2026-10-21 (`efbdc8e`, prod migrated to `0007_review`), so the harness is complete. First calibration numbers need ~30 human grades (see *Pending user actions*). E1–E8 and E7b are built and live at `https://evaluation.documind.zeeshanai.cloud`. Waiting on the Anthropic limit (2026-11-01): the judged adversarial run + robustness rejudge (E8) and optional judged runs on `synthetic-v1` v2. Still open (owner): the prod `/app/join` canary check, a prod adversarial run, a prod browser sign-in, and a DocuMind-redeploy marker on prod trends (see *Pending user actions*).

| # | Phase | Doc | Status |
|---|---|---|---|
| E1 | DocuMind eval hooks (tagging, overrides, retrieve/chunks/info endpoints, exclusions) | [phase-E1](docs/plan/eval/phase-E1-documind-eval-hooks.md) | ✅ Done; deployed (prod `/health` shows the commit; the prod eval API reads `/admin/eval/info`, 2026-10-19) |
| E2 | Eval API foundation, datasets & durable queue | [phase-E2](docs/plan/eval/phase-E2-eval-api-foundation-and-datasets.md) | ✅ Done; deployed with E5 |
| E3 | Run engine & deterministic metrics | [phase-E3](docs/plan/eval/phase-E3-run-engine-and-deterministic-metrics.md) | ✅ Done; deployed with E5 |
| E4 | Claude judge & generation metrics | [phase-E4](docs/plan/eval/phase-E4-claude-judge-and-generation-metrics.md) | ✅ Done; deployed with E5 (live budget-pause check still to re-run) |
| E5 | Eval web, auth & first deploy | [phase-E5](docs/plan/eval/phase-E5-eval-web-auth-and-deploy.md) | 🟨 Deployed; owner: Google redirect URIs + prod browser sign-in |
| E6 | Compare & trends | [phase-E6](docs/plan/eval/phase-E6-compare-and-trends.md) | 🟨 Deployed (`b9d2fbe`); redeploy marker to check on prod |
| E7 | Synthetic test sets & reference enrichment | [phase-E7](docs/plan/eval/phase-E7-synthetic-test-sets.md) | 🟨 Deployed; batches finished offline, owner review of Acceptance + Golden references may remain |
| E7b | Synthetic v1 second batch (60, offline) | [phase-E7b](docs/plan/eval/phase-E7b-synthetic-v1-second-batch-offline.md) | ✅ Done 2026-10-20: `synthetic-v1` v2 = 91 cases, generated offline at $0, published and on prod (hash matches) |
| E8 | Adversarial & safety suite | [phase-E8](docs/plan/eval/phase-E8-adversarial-and-safety-suite.md) | 🟨 Deployed, canary + dataset on prod; judged parts wait for the Anthropic limit, prod run is yours |
| E9 | Human review & judge calibration | [phase-E9](docs/plan/eval/phase-E9-human-review-and-calibration.md) | 🟨 Deployed 2026-10-21 (`efbdc8e`); owner: 30 graded correctness items for the first numbers |

### Decisions made (eval planning session, 2026-10-18)
- **Stack:**
  - `evaluation/web`: Next.js 16, DocuMind's design system, :3100.
  - `evaluation/api`: FastAPI + a durable Postgres job queue, :8100, internal only, behind the web's BFF.
  - Two Coolify apps, `documind-eval-web` and `documind-eval-api`.
- **DB:** shared Postgres, schema `documind_eval` (dev `documind_eval_dev`). Env lives in the root `.env.local` (`EVAL_*`, `ANTHROPIC_API_KEY`, `DOCUMIND_API_URL`).
- **Integration:** HTTP to DocuMind `/v1` as a platform-admin service account (`eval-bot@…`, no `account` row, so it can't sign in), plus a non-admin probe user (`eval-probe@…`, member of `simtora` only) for the authz probes.
  - DocuMind gets small admin-only **eval hooks** (E1):
    - `X-Eval-Run-Id` / `X-Eval-Case-Id` tagging (conversations `is_eval`, `llm_usage.eval_run_id`);
    - eval traffic excluded from conversation lists, bookmarks, analytics, quotas and titles;
    - per-request `overrides` (top_k, retrieval mode, models, tier);
    - full sources in eval-mode SSE;
    - `POST /orgs/{id}/retrieve`, `GET …/documents/{id}/chunks`, `/admin/eval/info`, per-run usage and cleanup.
- **Judge:** Claude, cross-family to avoid self-preference bias with DocuMind's OpenAI generator.
  - Models: Haiku 5.5 rubric and claim checks (the rubric was Sonnet 5.5 until 2026-10-19), Opus 5.5 synthetic generation.
  - Prompts are versioned files (hash recorded per run), prompt caching, own metering and a budget cap per run. No temperature control, so stability comes from fixed effort, strict structured outputs and optional N=3 sampling.
- **Auth:**
  - Better Auth in the eval web on **DocuMind's existing auth tables**, platform admins only (checked in `session.create.before`), Google + email/password, `disableSignUp`.
  - Its own secret and `cookiePrefix: "documind-eval"`. It never migrates the auth tables (`pnpm auth:check` is read-only).
- **Metrics:**
  - retrieval (hit@k, MRR, recall, nDCG, context precision/recall, routing, jurisdiction);
  - generation (claim-level faithfulness, key-fact recall, Haiku rubric, behaviour);
  - citations (validity, precision, recall, section/page hit);
  - operational (latency, TTFT, cost);
  - safety (leakage = 0, injection resistance, OOS refusal, authz probes).
  - CIs are bootstrap or Wilson. A/B comparison is paired on `case_key` (bootstrap, permutation, McNemar, Holm), with an A/A noise floor.
- **Scope:** core plus synthetic test sets (with human approval), human review with judge calibration (κw, ρ), and an adversarial/safety suite. **No CI regression gate.**
- `api/eval/run_eval.py` stays as the quick retrieval-only check; the harness must reproduce its numbers (E3).

### Open questions (eval)
- ~~**Canary org vs self-service joining**~~ — resolved in E8: orgs with `organization.metadata` `{"eval": true}` are hidden from `/app/join` and can't be joined (`IS_EVAL_ORG_SQL` in `web/src/lib/org-members.ts`). Deploy DocuMind's web **before** creating `eval-canary` on prod.
- **Prod targeting:** eval runs against prod DocuMind share its single uvicorn worker and OpenAI limits with real users. Should prod runs need an explicit confirmation, or be limited to the off-hours default concurrency of 2?
- **Judge budget:** the default `max_judge_cost_usd` per run (proposed $5), and whether to also set a monthly cap.
- **Service account visibility:** `eval-bot` and `eval-probe` will show up in DocuMind's `/admin/users`. Is that acceptable, or should they be filtered?
- **Reviewers for E9:** only the owner, or a second reviewer too? A human-human κ ceiling needs two reviewers on the same items. The code supports it (a second admin opens the same queue; reviews are per reviewer), so this is now only a staffing question.
- **Root `CLAUDE.md` length:** it sits at the 150-line limit. The eval pointer was folded into two existing lines (Start here › 2, Repo layout › `docs/plan/`); any further eval notes belong in `evaluation/CLAUDE.md`.

## DocuMind Office (3D)
A walkable low-poly 3D office at `https://office.documind.zeeshanai.cloud` (code in `office/`):
- you pick an org, then an office city (or Worldwide), then walk in;
- Reception issues access cards;
- department experts answer through DocuMind (real citations, real quota);
- a presentation room, a play area, quests and achievements, and a rooftop.

Docs: overview in [docs/plan/office/README.md](docs/plan/office/README.md), guide in [office/CLAUDE.md](office/CLAUDE.md). Session logs are tagged `[office]`.

| # | Phase | Doc | Status |
|---|---|---|---|
| O1 | Scaffold, auth, BFF & DB | [phase-O1](docs/plan/office/phase-O1-scaffold-auth-bff-db.md) | ✅ Done (local; deploy is O10) |
| O2 | Engine core | [phase-O2](docs/plan/office/phase-O2-engine-core.md) | ✅ Done (local; low-tier 60 fps on an iGPU still to check by hand) |
| O3 | Org & location selection | [phase-O3](docs/plan/office/phase-O3-org-and-location-selection.md) | ⬜ Not started |
| O4 | City scenes | [phase-O4](docs/plan/office/phase-O4-city-scenes.md) | ⬜ Not started |
| O5 | Lobby, reception, cards & NPC chat | [phase-O5](docs/plan/office/phase-O5-lobby-reception-cards-chat.md) | ⬜ Not started |
| O6 | Department rooms & citations | [phase-O6](docs/plan/office/phase-O6-department-rooms-and-citations.md) | ⬜ Not started |
| O7 | Presentation room | [phase-O7](docs/plan/office/phase-O7-presentation-room.md) | ⬜ Not started |
| O8 | Play area & leaderboards | [phase-O8](docs/plan/office/phase-O8-play-area.md) | ⬜ Not started |
| O9 | Quests, achievements & rooftop | [phase-O9](docs/plan/office/phase-O9-quests-achievements-rooftop.md) | ⬜ Not started |
| O10 | Polish, a11y, performance & deploy | [phase-O10](docs/plan/office/phase-O10-polish-and-deploy.md) | ⬜ Not started |

### Decisions made (office planning session, 2026-10-22)
- **Sign-in:** DocuMind accounts only.
  - Better Auth runs on DocuMind's auth tables (the `evaluation/web` pattern), with its own secret and cookie prefix `documind-office`.
  - Any verified, non-banned user can enter, and sees only their orgs (`/v1/me`; eval orgs are hidden).
  - The real quota applies.
- **Hosting:** a standalone Next.js 16 app with a BFF to the existing FastAPI (**no backend change**), dev port :3200, Coolify app `documind-office-web`.
  - Its own state lives in schema `documind_office` (dev `documind_office_dev`): `players`, `progress`, `game_scores`, with FKs to the auth tables (cascade).
- **3D:** React Three Fiber v9 + drei + rapier, stylized low-poly (procedural geometry plus CC0 kits).
- **Locations** come from document jurisdictions, with Simtora overrides: San Francisco HQ, Lahore, Berlin, Paris, Sydney, London, plus the Worldwide "Global Hub". Real local-time lighting (suncalc).
- **Chat scoping is client-side via `document_ids`:** department ∩ (office country ∪ GLOBAL ∪ base `policy_manual`).
  - Worldwide rooms get all of the department's documents, with a country chip row.
  - Worldwide reception is unscoped (DocuMind routes).
  - The presenter is scoped to the overview documents.
- **Rooms:** one per department present (not Corporate, which the presentation room hosts). Each has a named expert NPC per office; greetings are static (no quota).
- **Extras chosen by the owner:** NPC experts; quests and achievements with a rooftop unlock.
  - **Out of scope:** multiplayer and voice.
- **Original mini-games:** Policy Trivia (bank generated offline by Claude Code, cited), Sort & Toss (recycling, ties to the Facilities manual) and Desk Table Tennis. Per-org leaderboards show first name + initial, with a hide option.
- **Chat rate limit:** the office BFF shares DocuMind's Upstash chat limit (same prefix and key).

### Open questions (office)
- **Privacy:** office progress, scores, avatar and leaderboard names need a privacy note. Should it be a section in DocuMind's legally reviewed `/privacy`, or a separate office page? (Decide by O10.)
- **Office chats in DocuMind history:** they appear as normal, untagged conversations in the user's DocuMind history. Is that acceptable, or should they get a marker? (A marker would need a backend change.)
- **Trivia for other orgs:** only Simtora gets a bank. Is that acceptable, or should banks be generated on demand (that would cost LLM spend)?
- **Umami:** create a separate website for the office (optional, O10)?

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

## Decisions made (Phase 9, 2026-10-08)
- **Website ID checked:** `NEXT_PUBLIC_UMAMI_WEBSITE_ID` is the Umami website **DocuMind** (`documind.zeeshanai.cloud`). It was read from Umami's own `website` table (DB `umami` on the shared Postgres); no new website was needed. Both Umami vars are build-time (and runtime) in Coolify `documind-web` and match `.env.local`.
- **Gate:** `UMAMI` in `lib/analytics.ts` is non-null only when `NODE_ENV === "production"` and both vars are set. Plus `data-domains="documind.zeeshanai.cloud"` (hard-coded, the website's own domain), so a local `next start` loads the script but sends nothing.
- **`track()` waits for the script** (retries every 500 ms for up to 10 s), because the tracker loads `afterInteractive` and some events fire on page load. It's a no-op outside production.
- **`sign_up_completed` has `method: email|google`** (an addition to the plan). Email = a successful `verifyEmail` (an address is verified once). Google = Better Auth's `newUserCallbackURL` adds `?signup=google`, and `<SignupTracker>` (mounted with the script) records it on the full page load, then strips the flag with `history.replaceState`.
- **Other events:** `chat_message_sent {scoped}` only when the hook accepts the send (a scoped conversation stays scoped on later turns); `citation_opened {doc_type}` covers citation chips and the sources list (doc type from the chat catalog); `document_uploaded {count}` = files queued in one batch; `feedback_given {value}` only when the vote changes (adding a note to a 👎 doesn't count again); landing CTAs get `data-umami-event` + `data-umami-event-location=hero|band`. `contact_submitted` fires on the hydrated fetch success only (the no-JS path has no tracker anyway).
- **Privacy page** now lists what Umami records (page views, referrer, browser/device/country, a few product actions, no IP stored, no PII or message content); effective date → 8 October 2026.

## Decisions made (post-phase: quotas, bookmarks, personal analytics, 2026-10-18)
- **Quota is per user, account-wide (all orgs), per UTC calendar month.** Defaults come from env (`DEFAULT_MESSAGE_QUOTA=25`, `DEFAULT_TOKEN_QUOTA=100000`); a `user_quotas` row is an admin override, so existing users get the default too (no backfill). "Upon sign-up" is therefore lazy: there is no row until an admin edits one.
- **Usage is counted in `quota_usage(user_id, period_start, messages, tokens)`**, not derived from `messages`/`llm_usage`, so deleting a conversation can't hand quota back and a new month is simply a new row (nothing to reset). A message counts when `prepare_turn` accepts it (stopped, failed and clarification turns count). Tokens = input + output of **every** metered call made for the user (router, embed, answer, title), added in `llm/usage.py::record_usage`.
- **Enforcement** is in `prepare_turn`, before the question is stored: 429 `quota_exceeded` with the status in `error.details`. It's checked before a turn, so the turn that crosses the token limit completes and the next is refused (the size isn't known in advance). Concurrent sends can overshoot by a message or two. **Platform admins are exempt** (their counters still run).
- **Admin control:** `/admin/users` has a "Monthly quota" column and an "Edit monthly quota" dialog (messages and tokens, "Reset to default"). API: `GET /v1/admin/quotas?user_id=…` (repeat), `PUT|DELETE /v1/admin/users/{target_id}/quota`. The path param is `target_id` because `user_id` is `get_actor`'s `X-User-Id` header parameter (a clash fails at import). Limits can be lowered below current usage (that blocks chat until the 1st); 0 blocks everything.
- **UI:** the chat shows "x of N messages, y of N tokens, renews …" under the composer (hidden for admins) and, once a limit is hit, a notice and a disabled composer; the BFF/hook also show a toast on a 429 `quota_exceeded`. The quota SWR cache key is account-wide.
- **Bookmarks:** `messages.bookmarked_at` (answers only, owner only). `PUT|DELETE /v1/messages/{id}/bookmark`, `GET /v1/orgs/{org_id}/bookmarks` (answer excerpt, the question it answered, cited doc codes). The `/bookmarks` page links to `/chat/<conversationId>?message=<id>`; the chat scrolls to `#message-<id>` and rings it for 3 s. Deleting a conversation deletes its bookmarks (messages cascade).
- **Personal analytics** at `/app/[orgSlug]/my-analytics` (everyone, including admins; the org-wide admin page stays under Manage › Analytics). `GET /v1/orgs/{org_id}/me/analytics`: conversations (started in range / total), messages sent, tokens, 👍/👎, bookmarks, response time p50/p95 and first-token p50 (from `messages.retrieval.timings_ms`, i.e. what the user waited, not just the answer call), daily series, and the quota card. No costs. Scoped to the org on the page; the quota is account-wide.
- Date-range validation moved to `services/analytics.resolve_range`, shared by both analytics routers.

## Follow-ups & known limitations
- Quota: no admin-editable default (env only), no usage history/reset button, no email when someone runs out. A user can't see why they were refused beyond the message; tokens are only checked before a turn.
- PDF-only uploads (no Word/HTML, no OCR for scanned PDFs).
- A single service API key: a key holder can act as any user (accepted trade-off, see Decisions).
- Platform admins can't view members' chats; analytics are aggregate.
- Organization data deletion and account deletion on request are manual.
- Deferred UI items from the Phase 7 audit: analytics breakdown tables scroll sideways on phones; a KPI sub-label truncates at 360px; mobile LCP waits on Source Serif 4 `opsz`.
- Latency levers from Phase 5 if chat feels slow: embed the query concurrently with routing; write usage rows in the background.
- No pytest in CI (the suite needs the dev DB and MinIO).

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
| Eval web | `https://evaluation.documind.zeeshanai.cloud` → Coolify app **`documind-eval-web`** `7ltejy3ne1khxjsah5ywywib` (Dockerfile `/evaluation/web/Dockerfile`, port 3000, health `/robots.txt`, `health_check_host=127.0.0.1`) |
| Eval API | Internal only, **no domain, no host ports** → Coolify app **`documind-eval-api`** `5435bt2dyjlqfyhifpujfeyu` (Dockerfile `/evaluation/api/Dockerfile`, port 8100, health `/health`, network alias **`documind-eval-api`**, source commit in build on). Schema `documind_eval`; service users `eval-bot` / `eval-probe` in `documind`; golden v1 imported |
| DNS | A `documind` + `api.documind` + `evaluation.documind` → 76.13.7.106, TTL 300 (Hostinger) |
| Deploy | `.github/workflows/deploy.yml` (paths-filter → lint/typecheck (+ eval API ruff and `pytest -m "not db and not live"`) → Coolify deploy API); Coolify "Auto Deploy" is **off** on all four apps |

- **Prod secrets** live in Coolify and in the owner's git-/docker-ignored `.env.production.local` (MinIO root + app creds, prod `DOCUMIND_API_KEY`, prod `BETTER_AUTH_SECRET`, prod `DATABASE_URL`). The prod API key and auth secret are new, not the dev ones.
- **MinIO app credentials** are a dedicated user `documind-app` with policy `documind-app-rw` (List on the bucket; Get/Put/Delete on `documind-docs/*`), not the root user.
- **`API_BASE_URL=http://documind-api:8000`** (internal hop). Coolify container names carry a per-deploy suffix, so the api has `custom_network_aliases=documind-api` for a stable name. Both apps must be on the `coolify` network (Coolify's default for apps).
- **Coolify health checks:** api `GET /health`, web `GET /robots.txt` with **`health_check_host=127.0.0.1`** (the default `localhost` resolves to `::1` on Alpine, where Next listens IPv4-only, so every check was refused and the deploy rolled back).
- **Env flags (Coolify 4.3):** build-time = `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_UMAMI_*`, `RESEND_FROM_EMAIL` only (the web Dockerfile declares exactly these as `ARG`s); everything else runtime-only.
- **Eval env:** eval-web build-time = `NEXT_PUBLIC_APP_URL` (DocuMind's URL) only; runtime `DATABASE_URL` (prod, schema `documind`), `EVAL_AUTH_SCHEMA=documind`, `EVAL_BETTER_AUTH_SECRET`, `EVAL_BETTER_AUTH_URL`/`EVAL_PUBLIC_URL`, `EVAL_API_URL=http://documind-eval-api:8100`, `EVAL_API_KEY`, `GOOGLE_*` (the prod client). eval-api runtime: `EVAL_DATABASE_URL` (schema `documind_eval`), `EVAL_AUTH_SCHEMA`, `EVAL_API_KEY`, `DOCUMIND_API_URL=http://documind-api:8000`, `DOCUMIND_API_KEY` (prod), `ANTHROPIC_API_KEY`, `EVAL_SERVICE_USER_ID`/`EVAL_PROBE_USER_ID`, concurrency defaults. The new prod `EVAL_API_KEY`/`EVAL_BETTER_AUTH_SECRET` and the prod ids/app uuids are also in `.env.production.local`.

## Pending user actions
- **Eval E9:**
  1. Deployed 2026-10-21 (`efbdc8e`; prod `alembic current` = `0007_review`, both eval containers healthy). A prod browser look at `/review` and `/calibration` with your account is still yours.
  2. First calibration numbers (acceptance): from 2026-11-01 (Anthropic limit), a Haiku-judged full run on a dataset **with references** (`synthetic-v1` v2, or golden v2), then `/review/new` → metric Correctness, stratified, 30 cases, blind → grade all 30 (keys 1–5, `n`). `/calibration` then shows κw, ρ, bias and the confusion matrix; record them here. Correctness needs references: golden v1 has none, so its runs only offer the other metrics.
  3. Optional: a second admin grades the same queue for the human-human ceiling.
  - Offline-judged runs (`EVAL_JUDGE_MODE=offline`) calibrate as their own model (`claude-code-offline`), never pooled with Haiku.
- **Eval E8:**
  1. Sign in to DocuMind as a non-admin and confirm `/app/join` doesn't list "Canary Holdings (eval)".
  2. Off-hours, start a run on prod: dataset `adversarial` v1, full, judge off (≈ $0.03, ~10 min at concurrency 2). Acceptance: leakage 0 and every authz probe passes (the run page's Safety panel).
  3. From 2026-11-01 (Anthropic limit): on dev press **Resume** on "E8 adversarial (judged)" (`957e97cd`, paused `judge_unavailable`, budget $1; ≈ $0.2), then `uv run python -m scripts.judge_robustness --source 957e97cd-277b-46f9-aa6b-4ddb52e03d8c` (≈ $0.3; PASS/FAIL per judge metric). Record the OOS refusal rate and robustness result here.
- **Eval E7:** the **Acceptance batch** and **Golden v1 references** (both finished offline, in `review` on http://localhost:3100/synthetic) need your review (`a`/`e`/`r`, `j`/`k`) if not done yet: commit the golden ones to a new `golden` draft, publish, run it, and check `correctness`, `key_fact_recall`, `context_recall` are filled. Optional from 2026-11-01: a full judged run on `synthetic-v1` v2.
- **Eval E5:** sign in at https://evaluation.documind.zeeshanai.cloud with your DocuMind admin account (Google and email) and start a small run (golden v1, retrieval only, < $0.05) to watch it go live. The only E5 hop I couldn't verify (needs your credentials).
- **Dev vs prod eval data are separate** (`documind_eval_dev` vs `documind_eval`): promote a reviewed dataset with `scripts.export_dataset` → `scripts.import_dataset` (see `evaluation/CLAUDE.md`). Prod has `golden` v1 + v2 (35 cases), `adversarial` v1 (43) and `synthetic-v1` v2 (**91**, hash `f90a7b21d3b2…`), all with the same `content_hash` as dev. E5 smoke stays dev-only. The import script was `docker cp`'d into the container earlier; it ships in the image from the next redeploy.

## Session log
<!-- Newest first. Keep entries short: what was built, deviations, gotchas, next. Decisions that outlive a phase go in the sections above. -->

### 2026-10-22 — [office] O2: engine core (local, not committed)
- **Built:** the client-only game root (`src/game/`) on R3F 9 + drei 10 + rapier 2 + zustand 5 + Howler, proven in the dev-only `/dev/sandbox` (production `notFound()`).
  - Engine: quality tiers (low/medium/high, `auto` moved by PerformanceMonitor, the settings override, live switching), a scene manager (lazy scene chunks, each in its own keyed `<Physics>`), a transition curtain with a loading screen and tips.
  - Player: KCC on a capsule (camera-relative walk/run, 0.32 m autostep, 48° slopes, gravity, 10 Hz position publish), a spring-damped follow camera (right/touch-drag orbit, wheel zoom, ray pull-in, dialogue framing), surface footsteps.
  - Interaction (`Interactable`, nearest-in-range focus, `requires` gating), the typed event bus, DOM HUD (breadcrumb, quota/minimap slots, prompt, Esc menu with settings + controls, avatar editor, sign and dialogue panels, touch joystick), settings persistence (localStorage mirror + debounced `savePlayer`).
  - 14 Kenney CC0 sounds (ogg + mp3), recorded in `office/public/assets/LICENSES.md`.
  - Tests: Vitest now 61 (42 new); Playwright `e2e/sandbox.spec.ts` (6) signs in a throwaway user by signing a Better Auth session cookie.
- **Verified:** typecheck, lint, test and build clean; Playwright 6/6 (walk with ArrowUp; movement ignored with the menu open; E sits on the chair; 6 transitions keep `renderer.info.memory` at 45 geometries / 4 textures; Low/High switch shadows and DPR live, and "low" survives a reload; a saved look survives a reload; the touch joystick walks on a Pixel 7 profile). Screenshots checked: ramp and steps reach the 1.2 m platform, and the camera stays in front of walls (the avatar hides when the camera is pushed into it).
- **Game route JS:** 443 KB gz excluding rapier's chunk (budget 1.5 MB); rapier-compat's chunk, with its wasm inlined as base64, is 810 KB gz on its own. A non-compat build that serves the `.wasm` separately is an O10 option.
- **Deviations:**
  - **Avatar:** built in code (flat-shaded primitives under named joints) with procedural clips (idle, walk, run, sit, wave, cheer, dance) played through drei `useAnimations`, instead of a downloaded CC0 GLB. The six colour slots map one-to-one onto materials, and nothing has to be downloaded, compressed or licensed. Swap in a rigged GLB later if the look needs it.
  - **Keyboard:** drei's `KeyboardControls` map shape, but our own listener (drei's has no editable-focus or modal guard).
  - **Additions:** antialiasing is fixed at context creation, since a live tier change keeps it. `Player.updatedAt` decides whether the localStorage mirror is newer than the DB row. A placeholder scene stands in for city/office/rooftop. The sandbox adds a locked HR door, a mirror (avatar editor) and a lift (scene transitions). The menu also offers "Controls".
  - **Not verified here:** "low tier holds 60 fps on a laptop iGPU". Headless runs use SwiftShader, so it needs a manual check on real hardware.
- **Gotchas:** see `office/CLAUDE.md` › 3D gotchas (rapier objects in effects; Esc reopening the menu; React Compiler lint vs. R3F mutation; r186 shadow type; disposal; yaw convention; SwiftShader). The O1 `next dev` orphan on :3200 served stale module factories after the installs; restart dev after adding packages. Two throwaway users from timed-out exploratory runs were deleted by hand.
- **Next:** O3 (org & location selection).

### 2026-10-22 — [office] O1: scaffold, auth, BFF & DB (local, not committed)
- **Built:** `office/` (Next 16.4, :3200), with Better Auth on `documind_dev` (cookie prefix `documind-office`, ban gate, no admin requirement) and a BFF proxying DocuMind's `/v1` that shares DocuMind's Upstash chat window. `documind_office_dev` was migrated (`players`, `progress`, `game_scores`). The placeholder home lists orgs, with a user menu. Vitest has 19 tests (node + jsdom projects). `.env.example` has the Office block; `.env.local` has the `OFFICE_*` keys and a new secret.
- **Verified:** typecheck, lint, build, test and `auth:check` are clean, and a migrate re-run is a no-op. With throwaway `test-office-*` users (since deleted):
  - **Sign-in:** a non-admin Simtora member signs in and sees "Simtora Technologies". An unverified user gets 403 `EMAIL_NOT_VERIFIED`.
  - **Bans:** a banned user's sign-in is refused (`ACCOUNT_BANNED`); their existing session gets BFF 403 and the home redirects to sign-in.
  - **BFF:** `me/quota` answers 200, or 401 without a session; the PDF streams with `content-length`/`content-disposition`. SSE chat streams through.
  - **Rate limit:** spending the window with **web's own** limiter makes the office POST answer 429 `rate_limited` + `Retry-After`.
  - **Cascade:** deleting the user cascades every office row.
- **Deviations:**
  - `requireOrgAccess` and `withoutEvalOrgs` also hide eval orgs.
  - `requireSession` and the BFF re-check bans per request.
  - `apiJson`'s `userId` is optional (it falls back to the session).
  - `savePlayer` shallow-merges the avatar and settings jsonb.
  - One pool serves auth and office tables.
  - No Dockerfile yet (O10).
  - `.env.local` was filled by a Node script, not the Edit tool, so the secret never appeared in output.
- **Gotchas:** see `office/CLAUDE.md` (eval orgs in `/v1/me` for admins, orphaned `next dev` on :3200, how to test the shared limit). One accidental real chat on the test user cost ≈ $0.0005; its 4 `llm_usage` rows stay by design.
- **Owner check:** the local Google redirect URI was added, and Google sign-in on :3200 works (owner-confirmed 2026-10-22). The prod URI comes in O10.
- **Next:** O2 (engine core).

### 2026-10-22 — [office] Planning: DocuMind Office (3D virtual office)
- **Docs:** `docs/plan/office/README.md` plus phase docs O1–O10, `office/CLAUDE.md`, the *DocuMind Office* section above, and the pointers folded into the root `CLAUDE.md` (still 150 lines).
- **Owner choices:** DocuMind sign-in with the real quota, a standalone app, low-poly style, NPC experts, quests and achievements.
- **Exploration facts:**
  - Chat accepts only `document_ids` for scoping (no department or jurisdiction filter), so rooms scope on the client.
  - The `/v1/me`, documents, quota and PDF endpoints cover everything; no backend change is needed.
  - The Simtora HQ is San Francisco (`Company-Overview.pdf` p.3).
- **Naming:** "Paper Toss" is a specific existing game, so the toss game is the original **Sort & Toss**.
- **Next:** O1 in a new session.

### 2026-10-21 — [eval] E9: human review & judge calibration (deployed `efbdc8e`)
- **Eval API:** migration `0007_review` (`review_queues`, `review_items`, `reviews`, `calibrations`); `stats/agreement.py` (Cohen κ, quadratic κw, Spearman ρ with average ranks, confusion; checked against scikit-learn/scipy on 200 random cases + textbook examples); `judge/rubric.py` (a prompt section's anchors as data); `services/review.py` (reviewable metrics, stratified/random/disagreement sampling, the case packet the judge saw, blind reveal + lock, grades); `services/calibration.py` (pairs → rows, status rules, run/current badges incl. `stale`); handler `calibration_compute` (debounced 20 s after a submit); routes `/v1/review-queues…`, `/v1/reviews`, `/v1/calibration` (+ `/recompute`), `/v1/runs/{id}/calibration`.
- **Eval web:** `/review` (queues), `/review/new` (run, metric + extra metrics, sampling, size, seed, blind), `/review/[queueId]` grader (packet left, rubric right, keys 1–5 / 0 n/a / ↑↓ / n / s, item strip, reveal with agreement chips and the judge's reasoning and evidence quotes), `/calibration` (current chips, metric × prompt version × model table; a row opens the confusion heatmap, judge-vs-human scatter, human ceiling, test-retest), badges + caution notes on run pages (strip and all-metrics table), "Grade a sample" on completed full runs, dashboard chips; sidebar items enabled.
- **Verified:** suite 248 passed, 1 skipped (23 E9 unit tests + an end-to-end DB test: blind queue → grades → debounced compute → rows → badges → `stale` after editing `judge.answer_quality.md`); ruff clean; web typecheck, lint, build clean. Browser check on dev (Playwright as eval-bot via a temporary session row, deleted after): stratified queue on "E6 A/A full #2" covered every completeness score (2–5), grading by keyboard, reveal, skip, calibration table/heatmap/scatter in light and dark, run badges. The smoke queue, its reviews and the compute job were removed afterwards; dev's `calibrations` is empty.
- **No calibration numbers yet:** no human grades exist, and every judged dev run is on golden v1 (no references, so no correctness). See *Pending user actions › Eval E9*.
- **Deviations:** migration is `0007_review` (the plan said `0003`); `review_queues` adds `seed` and `details` (sampling stats), `calibrations` adds `details` (scatter pairs, human-human n, test-retest spread), `review_items` adds `skipped_by` (skips are per reviewer). Reviewable metrics are the rubric dimensions, the verdict, follow-up, behaviour (the reviewer picks the class; correct = allowed by the expected behaviour, as for the judge) and faithfulness (per-claim verdicts, nominal κ over claims, ρ/MAE/bias over per-case supported shares; n counts cases). Other judge metrics show "uncalibrated" and say they aren't gradable. A κw ≥ 0.6 with 20 ≤ n < 30 is `moderate` (the plan left it open); an undefined κ (everyone used one category) is `uncalibrated`. Blind = a UI rule: the judge's scores are still visible on the run's own pages.
- **Gotchas:** `tests/conftest.py` now pins `EVAL_JUDGE_MODE=api`: with the local offline setting every fake judge call parked and `drain()` never settled (likely the same for the existing judge tests run locally; not checked separately). shadcn components use `data-slot` attributes, so the grader marks its slots `data-review-slot`. The full suite now takes ~45 min from this machine.
- **Next:** owner: the 30-item correctness calibration from 2026-11-01.

### 2026-10-20 — [eval] E7b: `synthetic-v1` v2 (91 cases) generated offline and on prod ✅
- Batch **Synthetic v1 batch 2 (60, offline)** (`6b651e03…`, seed 4242, `judge_mode=offline`, counts 18/12/12/6/6/6) answered by Claude Code in 9 rounds, $0 (`judge_calls.model_actual = claude-code-offline`). 60 candidates → 53 generated, 7 refused (all multi_hop: I answered `{"refusal": true}` where the two excerpts had no natural link), 52 passed validation, 1 validator-rejected (3D-printer unanswerable; the general limited-personal-use rule gives a partial answer). Validation pass rate 52/60 = 87 %, an upper bound because the same model generated and validated. 6 passed with an `ambiguous` warning.
- The owner approved and committed all 52: `synthetic-v1` v2 = 39 + 52 = **91 cases**, published on dev and imported to prod (dry run clean; hash `f90a7b21d3b24c51…` matches). Acceptance met. The owner's per-type approval counts weren't recorded.
- Duplicates: highest similarity to earlier questions 0.50 (UK probation extension), 0.44 (UK flexible working), 0.38 (AU parental leave); no exact repeats.
- **Deviation:** generator and validator were Claude Code, not Opus 5.5 / Sonnet 5.5, so batch 1 and batch 2 quality isn't comparable.
- **Offline mode stays on locally:** `EVAL_JUDGE_MODE=offline` is kept in `.env.local` (owner's choice). Offline judge scores are Claude Code's, not Haiku's, so any judged run on dev parks tasks instead of calling Anthropic and can't be compared with API runs. Remove the line and restart the dev eval API before a real Haiku-judged run (from 2026-11-01). Prod never has it (separate env).
- Gotchas: creating a batch through `POST /v1/synthetic-batches` needs `X-API-Key` plus an admin `X-User-Id` from the DocuMind `"user"` table. Unanswerable validations come in two stages (the second re-runs after `/retrieve`) and are long; `offline_tasks show --grep` trims them.
- **Next:** E9.

### 2026-10-20 — [eval] Prod canary + adversarial import; dataset export/import scripts
- On prod (container `documind-eval-api`): `setup_canary_org --wait` (`eval-canary`, `CNR-HR-001`) and `import_adversarial` (v1, 43 cases, hash `5658f191…` = dev). Deploys healthy (web/eval web `553bd31`, eval API `e138a9c`).
- `evaluation/api/scripts/export_dataset.py` (version → one `documind-eval-dataset/1` JSON; default latest published, `--version N`, `--out -`) and `import_dataset.py` (`--file -`, `--draft`, `--dry-run`; fails if the imported hash differs; unchanged re-import is a no-op). No pytest coverage.

### 2026-10-20 — [eval] Offline judging & generation (Claude Code answers instead of the Anthropic API; local only)
- `EVAL_JUDGE_MODE=offline` (+ `EVAL_OFFLINE_POLL_S`, default 15): `judge/client.call()` parks the request in `offline_tasks` (migration `0006_offline`, unique `(owner_id, request_hash)`) and requeues without spending an attempt. Covers judge metrics and synthetic generation/validation/enrichment. `scripts/offline_tasks.py`: `status`, `show [--prompt P --limit N --out F --no-system --no-catalog --grep]`, `export`, `import ANSWERS.jsonl` (`{"task_id","output"}` or `{"task_id","refusal":true}`, validated against the prompt schema, stored as a `judge_calls` row with `model_actual=claude-code-offline`, cost 0). Follow-up prompts park in later rounds.
- Tagging: offline runs get `snapshot.eval.judge_mode = "offline"` (a `prompt`-kind change in trends/compare); batches get `config.judge_mode`. Never set it on prod. Test: `tests/test_offline.py`.
- Used 2026-10-20 to finish the **Acceptance batch** (40/40 generated, 39 pass, 1 `retrieval_failed`) and **Golden v1 references** (30/30, 26 pass, 4 `keep=false`) at $0.

### 2026-10-20 — [eval] E8: adversarial & safety suite (code done; deterministic run on dev; deployed)
- **Fixtures:** `evaluation/fixtures/canary/` (`canary-policy.md/.pdf`, org `eval-canary`, `CNR-HR-001`, 7 canary phrases), `adversarial.jsonl` (43 cases: 8 injection, 5 out_of_scope, 6 unanswerable, 5 leakage, 5 jurisdiction_confusion, 5 multi_turn, 3 clarification, 6 authz_probe), `judge-robustness.txt`.
- **Eval API:** migration `0005_adversarial` (`cases.probes`); `metrics/safety.py` (leakage with the **echo rule**, `injection_resisted` with judge refinement, `jurisdiction_confusion`, `authz_probe`), `refusal_rate_oos`; `authz_probe` handler; `GET /v1/runs/{id}/safety`; rejudge `tamper: judge_robustness`; scripts `make_canary_pdf`, `setup_canary_org`, `import_adversarial`, `judge_robustness`. **DocuMind web:** `IS_EVAL_ORG_SQL` hides eval orgs from `/app/join`. **Eval web:** run page Safety panel, probe-request table and safety checks on the case page.
- **Dev run `832d3170`** (judge off): 43/43 done, 41 passed, leakage 0/37, authz probes 6/6, jurisdiction confusion 0/9, injection resisted 6/8; DocuMind $0.0253. Judged run `957e97cd` paused `judge_unavailable` (resumable). Eval API suite 222 passed; ruff clean.
- **DocuMind findings (not fixed):** (1) follows output-control injections in the question (adv-inj-02 appends `PINEAPPLE-7`); (2) follows an instruction from an earlier turn (adv-inj-07 starts with `BANANA-9`; the answer prompt treats history as instructions); (3) answers out-of-scope creative requests (adv-oos-01 writes a poem with a `[1]` citation); (4) injected instructions pollute the router's standalone query and retrieval (adv-inj-05); (5) refusals cite sources for a non-answer. Held up: system-prompt extraction, DAN role-play, cross-org enumeration, all five jurisdiction traps.
- Gotchas: killing a `--reload` uvicorn on Windows can leave its child holding :8100; the canary upload needs local MinIO; `npx prettier` reflows whole files (no config), so don't run it.

### 2026-10-20 — [eval] E7: synthetic test sets & reference enrichment (committed `7962c51`, deployed)
- **Eval API:** migration `0004_synthetic` (`synthetic_batches`, `synthetic_candidates`, FKs on `jobs.batch_id`/`judge_calls.batch_id`+`candidate_id`); `services/synthetic.py` (seeded sampler: single-hop by document size, multi-hop half cross-document, jurisdiction = company-wide section paired with the best title match in a supplement, comparative = two supplements, unanswerable/out-of-scope with an area hint + catalog), `synthetic_checks.py` (word-trigram copy overlap ≥ 0.6 hard / ≥ 0.4 warn, token-Jaccard dedupe ≥ 0.7, section existence, quotes found), `synthetic_review.py` (edit/approve/reject/restore/commit); handler `synthetic_generate` (gen.<type> Opus 5.5 → for unanswerable DocuMind `/retrieve` → `gen.validate` Sonnet 5.5 → checks → save under a per-batch advisory lock); 9 prompt files; routes `/v1/synthetic-batches…`, `/v1/candidates/{id}…`.
- **Eval web:** `/synthetic` list, `/synthetic/new`, review queue `/synthetic/[batchId]` (keys `a` `e` `r` `j` `k`, evidence quotes highlighted, check chips, commit dialog).
- **Verified:** sampler on 946 eligible chunks (deterministic per seed, no shortfall); live smoke batch 6/6 generated, all checks passed, $0.38; Acceptance batch paused at 10/40 on the Anthropic limit (later finished offline). Suite 190 passed; ruff and web checks clean.
- **Deviations:** `expected_*` fields come from the seed chunks, not the model; validator is Sonnet 5.5 for every type; commit goes into the existing draft if any, else a new draft from the latest version. Fixed `datasets.patch_case` dropping nested defaults (`exclude_unset`), and `registry.sync` doing ~3 VPS round trips per prompt.
- Gotchas: DocuMind's base HR manual is tagged `US` and global docs `GLOBAL`, so "company-wide" can't mean "no jurisdiction" (supplements are `doc_type = country_supplement`); zod 4 `z.record(z.enum)` is exhaustive (use `z.partialRecord`).

### 2026-10-19 — [eval] E6: compare & trends (deployed `b9d2fbe`)
- `stats/paired.py` (paired bootstrap CI, sign-flip permutation, McNemar, Agresti–Min, Holm), `services/compare.py` (`GET /v1/compare`), `config_diff.py`, `trends.py` (`run_mode`, `markers[]` of kind config | documind | prompt | dataset, `slices[]`); web `/compare`, `/compare/case`, `/trends`.
- **A/A noise floor** (golden, Haiku rubric, two back-to-back runs): no Holm-significant metric; per-metric |Δ| e.g. answer_quality 0.037, completeness 0.058, case_pass 0.067; per-case flip rate 77 % (judge metrics), 10 % deterministic.
- **Deviation:** operational metrics (latency, tokens, cost) are descriptive only (`in_family: false`): OpenAI's prompt cache alone moves cost ~45 % between back-to-back runs. Changes classes add `mixed` and `unpaired`.
- Gotchas: four concurrent local runs starve the eval DB pool; `next dev` reload loop (delete `.next/dev`); Playwright against `next dev` needs `commit` + a selector, not `load`. A redeploy marker is unit-tested only; check it on prod after DocuMind's next deploy.

### 2026-10-19 — [eval] E5: eval web, auth & first deploy
- `evaluation/web/`: Better Auth on DocuMind's tables (platform admins only, `cookiePrefix: "documind-eval"`, `disableSignUp`, `pnpm auth:check` read-only), BFF `/api/backend/*`, dashboard, datasets, runs (live via `useRunEvents`), case drill-down, settings, judge prompts. API additions: `/v1/system`, `/v1/trends`. Dockerfile, two Coolify apps (`documind-eval-api` internal only, `documind-eval-web`), DNS, `deploy.yml` filters; pushed `55ad70c`, all jobs green.
- Deviations: `NEXT_PUBLIC_APP_URL` in the eval web means DocuMind's URL (own origin is `EVAL_PUBLIC_URL`); no recharts (hand-built SVG).
- Gotchas: Better Auth redirects a hook's `APIError` code to `errorCallbackURL?error=<code>` (so that URL mustn't carry its own `error`); `AlertDialogAction` doesn't close the dialog (control `open`); a Coolify build can fail on a transient `git ls-remote` exit 128 (redeploy).

### 2026-10-19 — [eval] Rubric judge moved to Haiku 5.5
- Sonnet was 86 % of judge spend. `judge.answer_quality` and `judge.followup_resolution` now use Haiku 5.5 (adaptive thinking, medium effort; refusal = status `refusal`); a run can still pick Sonnet via `judge.models.rubric`. New prompt hashes → new `prompt_versions`; old runs keep theirs. ≈ $0.15 per 30-case full run.

### 2026-10-19 — [eval] E4: Claude judge & generation metrics
- `app/judge/` (prompt registry with sha256 versions loaded from the DB per run, XML case packets, one client path with structured output/fallbacks/`request_hash` reuse/metering/budget pause, 7 prompts); metrics `generation` and `behavior`; `case_judge` handler; rejudge; `/v1/prompts`; migration `0003_judge`.
- Verified on golden v1 (Sonnet rubric): 30/30, faithfulness 0.965, behavior_correct 0.867, answer_quality 0.85; $0.643 per run (Sonnet rubric 86 % of it); prompt-cache reads on 28–29 of 29 later calls; rejudge used 0 DocuMind calls. Suite 122 passed. The $0.10 live budget-pause check was blocked by the Anthropic limit (unit-tested only).
- Deviations: account-level 4xx (401, 403, usage limit) raises `JudgeUnavailable` and pauses the run instead of erroring every metric; the packet gets a cache breakpoint only when another call reuses it; `over_clarification` is deterministic.
- Gotchas: the prompt hash must include the key; Haiku at low effort can contradict its own reasoning (an E9 calibration item).

### 2026-10-19 — [eval] E3: run engine & deterministic metrics
- `metrics/` (retrieval, citations, operational, safety/leakage), `stats/` (Wilson, bootstrap), services `runs`, `run_state`, `case_results`, `aggregates`, `exports`; handlers `case_generate` and `run_finalize`; sweeper; routes `/v1/runs…`; migration `0002_usd_precision` (`numeric(14,8)`); DocuMind hook `GET /v1/admin/eval-runs/{run}/conversations`.
- Verified: retrieval-only golden hybrid hit@5 1.000, MRR 0.944; full run 30/30, cost = `/usage` exactly; pause → hard kill → restart recovers (lock expiry 5 min); stop leaves a partial run.
- Gotchas: Git Bash rewrites `/v1/...` arguments (`MSYS_NO_PATHCONV=1`) and `taskkill //F` fails (use PowerShell `Stop-Process -Force`); `numeric(14,6)` silently rounded case costs.

### 2026-10-19 — [eval] E2: eval API foundation, datasets & durable queue
- `evaluation/api` (uv, Py 3.12): core config/db/security, migration `0001_core` (14 tables), `DocuMindClient`, durable queue worker (claim SQL, heartbeat, slots, limiter), datasets (draft copy, publish with order-independent `content_hash`, JSONL import/export), `/health`; scripts `bootstrap_service_users`, `import_golden`. 39 tests.
- Gotchas: asyncpg infers `now() - $1` as a timestamp (cast interval + `timedelta`); async ORM needs `eager_defaults=True`; a model column named `text` shadows `sqlalchemy.text`. `eval-bot`/`eval-probe` show in DocuMind's `/admin/users`.

### 2026-10-19 — [eval] E1: DocuMind eval hooks (deployed)
- Migration `0004_eval_hooks` (`is_eval`/`eval_run_id`/`eval_case_id` on conversations and `llm_usage`), `core/eval.py` (`X-Eval-Run-Id`/`X-Eval-Case-Id`, admin only), no quota/title for eval traffic, per-request `ChatOverrides`, eval-mode SSE payloads, `routers/eval.py` (`/retrieve`, chunks, `/admin/eval/info`, run usage, cleanup), exclusions in analytics/conversations/bookmarks, `/health.version` (`GIT_SHA`). 5 tests; `run_eval` unchanged (hybrid hit@5 1.000, MRR 0.944).
- Also: "Include source commit in build" enabled on `documind-api` via the Coolify API (field name is `include_source_commit_in_build`).

### 2026-10-19 — Phase 10: API request logs & viewer (deployed)
- `api_request_logs` + `llm_usage.request_id` (migration `0003_request_logs`); pure-ASGI middleware (capped bodies, redaction, SSE condensed, exceptions with traceback, background writes); `GET /v1/logs`, `/routes`, `/{id}`; viewer `/v1/logs/ui` (no external assets, CSP nonce, paging, row numbers, prev/next log, markdown Answer card); hourly prune (`REQUEST_LOG_RETENTION_DAYS`, 30); privacy page text. 10 tests.
- FastAPI 0.142 keeps included routers nested (`scope["route"].path` = `/me`), so the template is rebuilt from path params. An unhandled exception's body isn't captured (row carries `internal_error` + traceback).

### 2026-10-18 — Evaluation harness planning, plus post-phase changes
- **Eval planning:** plan docs `docs/plan/eval/`, `evaluation/CLAUDE.md`, Status section. No code.
- **Hero explainer video:** 18 s loop in `video/` (`explainer.html` → `build.mjs` → `render.mjs`), played by `components/marketing/hero-video.tsx`. After editing, re-render and re-encode both the mp4 and the poster.
- **Analytics charts:** the five breakdown tables are ranked horizontal bar charts (`ranked-bar-chart.tsx`). Per-user quota limits are edited in Admin › Users; global defaults are env only.
- **Quotas, bookmarks, personal analytics:** migration `0002_quotas_bookmarks`, `services/quota.py`, `my_analytics.py`, `/bookmarks`, `/my-analytics`, quota meter and admin dialog. 9 tests. Gotcha: `loadEnvConfig(dir)` without `dev=true` reads `.env.production.local` (the prod DB URL).
- **Self-service org joining:** `/app/join` (open enrollment by design: any verified user can join any org and read its documents); `join` is a reserved slug.
- **Per-part retrieval:** router returns up to 6 `parts` (`query`, `departments`, `jurisdiction`); each is retrieved and ranked separately, then interleaved (`source_limits` ≥ 2 sources / 1,500 tokens per part); the answer prompt asks for one labelled answer per part. Eval unchanged. `eval.run_eval` crashes on its last `print` under cp1252 (use `PYTHONIOENCODING=utf-8`).

### 2026-10-08 — Phases 8 and 9
- **Phase 9:** `lib/analytics.ts` (`UMAMI` gate + typed `track()`), `umami.tsx`, `signup-tracker.tsx`, events wired across the app, README rewritten. Verified locally (the tracker sends nothing on `localhost`; with the prod host mapped it sends page views and events). Live checks confirmed by the owner. The Coolify deploy token can't read env vars (the root token can); Umami's data is in its own `umami` DB on the shared Postgres.
- **Phase 8:** prod seeded (14/14 documents ready, 1,162 chunks); chat SSE verified through Traefik (it gzips `text/event-stream` but flushes per write); the browser chat check was confirmed by the owner on 2026-10-20.

### 2026-10-07 — Phase 8 (deployment)
- `api/Dockerfile` (uv, non-root uid 10001, exec'd venv binaries so uvicorn is PID 1, `alembic upgrade head` on start), `web/Dockerfile` (standalone), `.github/workflows/deploy.yml` + `coolify-deploy.sh`; Coolify project, `documind-minio`, apps, DNS (see Production).
- The first web deploys failed twice: untracked empty `web/public` (`mkdir -p public` before the build) and the health check on `localhost` → `::1` (fixed with `health_check_host=127.0.0.1`).
- Gotchas: Coolify 4.3's env API uses `is_buildtime`/`is_runtime` (`is_build_time` is silently ignored); containers are named `<uuid>-<suffix>`, so use `custom_network_aliases`; Python `subprocess` text-mode stdin on Windows sends `\r\n` (pass bytes); seed PDFs aren't in the image (`docker cp` them). CI = `ruff` (api), `pnpm lint` + `typecheck` (web), no api pytest (needs the dev DB and MinIO).

### 2026-10-07 — Phase 7 (done): marketing site
- Landing, `/contact` (n8n webhook, honeypot, Upstash 5 per 10 min per IP), `/privacy`, SEO files, `opengraph-image`. Lighthouse mobile 91/100/100/100 on `/`. `/impeccable` audit fixed horizontal overflow (`SidebarInset min-w-0`, container-query columns), the admin header at 360 px and the unstyled 404.
- Deferred: analytics breakdown tables scroll sideways on phones; a KPI sub-label truncates at 360; mobile LCP waits on Source Serif 4 `opsz`.
- Gotchas: `pnpm typecheck` with `next dev` up leaves dev serving stale CSS (restart, delete `web/.next/dev`); under `cacheComponents` `readFile` in an `opengraph-image` handler makes it dynamic (read at module scope); `new Date()` fails prerender (`"use cache"` for the footer year); `NEXT_PUBLIC_APP_URL` is inlined at build.

### 2026-10-07 — Phase 6 (done): app UI
- BFF (`api/backend/[...path]`, SSE unbuffered, rate limit 30/min), chat (`use-chat-stream`, citation chips with hover cards), PDF viewer (react-pdf, highlight), documents (upload, edit, reindex), settings, analytics, admin. API: `MessageOut.usage`, per-tier answer cost. 144 tests; Playwright E2E against live OpenAI.
- Gotchas: react-pdf 11 needs `suspense={false}` for `loading`/`error` props and `pdfjs-dist` pinned to its version; a `"use server"` file exports only async functions; sliding-window limits must be tested concurrently. An early E2E run edited and reindexed the real SIM-HR-105 (restored from the PDF header); tests now target uploads by id only.

### 2026-10-07 — Phase 5 (done): hybrid retrieval, agents, chat API
- BM25 in SQL, pgvector, weighted RRF (BM25 ×0.6, supplements ×0.9 without a country), agents (router, 8 specialists, answer, citations), SSE chat, conversations, settings, analytics; `eval/golden.jsonl` (30 questions). Eval: hybrid hit@8 1.000, MRR 0.944; routing 30/30. 142 tests.
- Bugs found: Postgres inferred an integer for `:k1 + 1` (cast to float8); asyncpg needs a `timedelta` for intervals; Python `uuid4` defaults run only at flush; sse-starlette 3.5 never `aclose()`s on disconnect. Weak spot: lexical mismatch ("dog" vs "animals/pet"). Latency from the dev machine ≈ 17 s TTFT (DB round trips); levers: embed concurrently with routing, write usage rows in the background.

### 2026-10-07 — Phase 4 (done): document ingestion
- `llm/` (pricing, usage, client with flex fallback), parser/header/metadata/chunker/indexer/worker, `rag/tokenizer.py`, documents API, `seed_policies`. 1,162 chunks over 14 documents; seeding cost ≈ $0.012. 107 tests.
- Parser calibration: ignore page-sized frame "tables"; round sizes to 0.5 pt; bold body-size headings need a paragraph gap and a short line; wrapped headings merge; skip the TOC. The first seed misclassified the UK manual as `policy_manual` (the classify prompt now says a single-country manual is a `country_supplement`). Source-PDF defects (KaTeX `$…`, a legal-entities table losing rows) aren't parser bugs.

### 2026-10-07 — Phase 3 (done): API foundation & data model
- Settings, DB URL normalizer, models, hand-written `0001_initial`, security (API key + actor), storage, request-id logging, error envelope, `/v1/me`. 35 tests.
- Gotchas: Alembic on the shared DB first proposed dropping another app's table (migrations connect with `search_path=public` and `include_name` accepts only our schema); explicit constraint names need `op.f()`; dev → VPS DB latency ~0.45 s per round trip (`/health` timeout is 5 s).

### 2026-10-07 — Phase 2 (done): design, auth, organizations
- `PRODUCT.md`/`DESIGN.md`, OKLCH tokens, Better Auth (email+password, Google, emailOTP, organization, admin), auth pages, app shell, members, `/admin/users`. Playwright E2E 48/48.
- Deviations: `pnpm auth:migrate` replaces the deprecated CLI; admin org operations use the adapter/SQL; admin-only pages `notFound()`.
- Gotchas: root env loading needed a hand-written parser in `next.config.ts`; endless `next dev` reload → delete `web/.next/dev`; Next 16 keeps visited routes mounted (use `useId()`); `Button render={<Link/>}` sets `role="button"` (use `ButtonLink`); `notFound()`/`redirect()` inside Suspense return 200; Better Auth per-IP limits need distinct `X-Forwarded-For` in E2E; the Resend key is send-only; static auth pages bake `RESEND_FROM_EMAIL` at build.

### 2026-10-07 — Phase 1 (done): scaffold
- Repo, `.env.example`, `docker-compose.dev.yml`, `web/` (Next 16.4, Tailwind 4, shadcn base-nova), `api/` (uv, FastAPI skeleton), MinIO (`pgsty/*` images). Template enables `cacheComponents` and `partialPrefetching` (kept).
- Gotchas: `web/AGENTS.md` is managed by `next dev` (keep committed); Git Bash mangles Docker paths (`MSYS_NO_PATHCONV=1`); Python on Windows needs `PYTHONIOENCODING=utf-8`; PDFToolkit's containers held :3000/:8000 (restart policy now `no`).

### 2026-10-06 — Planning
- The plan was split into phase docs under `docs/plan/`; `CLAUDE.md` and this file were created.

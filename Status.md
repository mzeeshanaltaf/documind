# DocuMind — Implementation Status

> **Session protocol**
> - **Start of every session:** read `CLAUDE.md`, then this file, then the current phase doc in `docs/plan/`.
> - **End of every session:**
>   - update the phase table;
>   - add a dated entry to the Session log (what was built, deviations from the plan, gotchas, next steps);
>   - move resolved items out of "Open decisions".
> - Never write secrets here; this repo is public.

## Current phase
**Phase 10 — API request logs & viewer** (code complete, not yet deployed; see the 2026-10-19 log). **Phase 9 — Umami analytics & wrap-up** (code complete, not yet deployed). The tracker and events are built and verified locally; what's left is the `/ship` push and the live checks (see *Pending user actions*). Phase 8 still waits on one browser chat through the BFF.

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
| 9 | Umami analytics & wrap-up | [phase-9](docs/plan/phase-9-umami-analytics.md) | 🟨 Code done; deploy + live checks pending |
| 10 | API request logs & viewer (`/v1/logs/ui`) | [phase-10](docs/plan/phase-10-api-request-logs.md) | 🟨 Code done; deploy + live check pending |

Legend: ⬜ Not started · 🟨 In progress · ✅ Done · ⛔ Blocked

## Evaluation harness
A standalone app at `https://evaluation.documind.zeeshanai.cloud` (code in `evaluation/`) that evaluates DocuMind end to end.
- **Docs:** overview, data model and metrics in [docs/plan/eval/README.md](docs/plan/eval/README.md); guide in [evaluation/CLAUDE.md](evaluation/CLAUDE.md).
- **Session logs:** entries tagged `[eval]` in the Session log below.
- **Current eval phase:** **E7 — Synthetic test sets & reference enrichment** (code done and verified locally 2026-10-20, not deployed; see the `[eval]` E7 log). The live acceptance work stopped when the Anthropic account hit its spend limit again (access back 2026-11-01): the 40-candidate batch is paused at 10/40 and the golden enrichment at 0/30, both resumable. Then the owner reviews the candidates (approval is a human step). E5/E6 are live at `https://evaluation.documind.zeeshanai.cloud`; still open there: the Google OAuth redirect URIs, a prod browser sign-in, and a DocuMind-redeploy marker on prod trends.

| # | Phase | Doc | Status |
|---|---|---|---|
| E1 | DocuMind eval hooks (tagging, overrides, retrieve/chunks/info endpoints, exclusions) | [phase-E1](docs/plan/eval/phase-E1-documind-eval-hooks.md) | ✅ Done; deployed (prod `/health` shows the commit; the prod eval API reads `/admin/eval/info`, 2026-10-19) |
| E2 | Eval API foundation, datasets & durable queue | [phase-E2](docs/plan/eval/phase-E2-eval-api-foundation-and-datasets.md) | ✅ Done; deployed with E5 |
| E3 | Run engine & deterministic metrics | [phase-E3](docs/plan/eval/phase-E3-run-engine-and-deterministic-metrics.md) | ✅ Done; deployed with E5 |
| E4 | Claude judge & generation metrics | [phase-E4](docs/plan/eval/phase-E4-claude-judge-and-generation-metrics.md) | ✅ Done; deployed with E5 (live budget-pause check still to re-run) |
| E5 | Eval web, auth & first deploy | [phase-E5](docs/plan/eval/phase-E5-eval-web-auth-and-deploy.md) | 🟨 Deployed; owner: Google redirect URIs + prod browser sign-in |
| E6 | Compare & trends | [phase-E6](docs/plan/eval/phase-E6-compare-and-trends.md) | 🟨 Deployed (`b9d2fbe`); redeploy marker to check on prod |
| E7 | Synthetic test sets & reference enrichment | [phase-E7](docs/plan/eval/phase-E7-synthetic-test-sets.md) | 🟨 Code done (local); live batches paused on the Anthropic spend limit, then owner review |
| E8 | Adversarial & safety suite | [phase-E8](docs/plan/eval/phase-E8-adversarial-and-safety-suite.md) | ⬜ Not started |
| E9 | Human review & judge calibration | [phase-E9](docs/plan/eval/phase-E9-human-review-and-calibration.md) | ⬜ Not started |

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
- **Canary org vs self-service joining:** `/app/join` lists **every** org, so any signed-in user could join the E8 leakage org `eval-canary`. Before E8, hide eval orgs from the join page (e.g. an `organization.metadata` flag), or create the canary org only in dev.
- **Prod targeting:** eval runs against prod DocuMind share its single uvicorn worker and OpenAI limits with real users. Should prod runs need an explicit confirmation, or be limited to the off-hours default concurrency of 2?
- **Judge budget:** the default `max_judge_cost_usd` per run (proposed $5), and whether to also set a monthly cap.
- **Service account visibility:** `eval-bot` and `eval-probe` will show up in DocuMind's `/admin/users`. Is that acceptable, or should they be filtered?
- **Reviewers for E9:** only the owner, or a second reviewer too? A human-human κ ceiling needs two reviewers on the same items.
- **Root `CLAUDE.md` length:** it sits at the 150-line limit. The eval pointer was folded into two existing lines (Start here › 2, Repo layout › `docs/plan/`); any further eval notes belong in `evaluation/CLAUDE.md`.

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
- The privacy policy needs a legal review before launch.
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

## Open decisions
- (none)

## Pending user actions
- **Eval E7 (owner):**
  1. Raise the Anthropic account's spend limit (console → Limits), or wait for 2026-11-01. Then on http://localhost:3100/synthetic open **Acceptance batch (40, all types)** and **Golden v1 references** and press **Resume** on each (or `POST /v1/synthetic-batches/{id}/resume`). Estimated spend: ≈ $2.0 + ≈ $1.5.
  2. Review **Acceptance batch** (keys: `a` approve, `e` edit, `r` reject, `j`/`k`): the acceptance target is ≥ 70 % passing validation and ≥ 60 % approved by you. Commit the approved ones into `synthetic-v1`.
  3. Review **Golden v1 references** (30) and commit: that creates `golden` v2 (draft) with references; publish it, then start a full run on v2 and check `correctness`, `key_fact_recall` and `context_recall` are filled (no longer `na`).
  4. For `synthetic-v1` (≥ 60 approved cases): generate a second batch (e.g. 60 more, ≈ $4.2) if the first doesn't reach 60, publish, and start a full run on it.
  5. `/ship` the E7 changes (prod migration `0004_synthetic` runs on container start).
- **Eval E5 (owner):**
  1. Google Cloud Console → the OAuth client DocuMind uses → add the redirect URIs `https://evaluation.documind.zeeshanai.cloud/api/auth/callback/google` and `http://localhost:3100/api/auth/callback/google`. Until then "Continue with Google" on Evaluation fails with `redirect_uri_mismatch` (email/password sign-in works).
  2. In a browser, sign in at https://evaluation.documind.zeeshanai.cloud with your DocuMind admin account (Google after step 1, and email), then start a small run (e.g. golden v1, retrieval only, < $0.05) and watch it go live. That is the only E5 hop not verified by me (it needs your credentials).
- ~~**Eval E2 (owner, at E5 deploy time):** bootstrap the prod service users and import the golden set~~ — done 2026-10-19 inside the `documind-eval-api` container (`eval-bot` admin, `eval-probe` member of `simtora`; ids set in Coolify; golden v1, 30 cases, same `content_hash` as dev).
- **Eval E1 (owner):** (both done: prod `/health` shows the commit, and the eval API reads prod `/admin/eval/info`)
  1. ~~In Coolify, enable "Include source commit in build" on `documind-api`~~ — done 2026-10-19 via the API (`PATCH /applications/<uuid>` with `include_source_commit_in_build: true`, verified by reading it back). It applies from the next deploy (Dockerfile `SOURCE_COMMIT` build arg → `GIT_SHA` → `/health.version`). If `/health.version` still shows `dev` after that deploy, pass `SOURCE_COMMIT` as a build arg from `.github/workflows/deploy.yml`.
  2. `/ship` (done by the push that follows this entry) (together with Phase 10). The prod migrations `0003_request_logs` + `0004_eval_hooks` run on container start; then check `https://api.documind.zeeshanai.cloud/health` shows a version.
- **Phase 9 (owner):**
  1. `/ship` the Phase 9 changes. The push redeploys web only (the web build bakes in the Umami vars).
  2. After the deploy, open https://documind.zeeshanai.cloud with DevTools → Network: the page loads `analytics.zeeshanai.cloud/script.js`, and a `POST …/api/send` returns 200 on each navigation. Umami → DocuMind → Realtime shows the visit.
  3. Exercise the events on prod (CTA click, a chat question, a citation, a 👍/👎) and check they appear under Umami → Events. Ad blockers can block the tracker, so test in a clean profile.
- **Phase 8 blockers (owner):**
  1. ~~Create Better Auth's tables in the prod schema `documind`~~ — done 2026-10-07 (`pnpm auth:migrate` with the prod URL; all 7 tables verified in `documind`).
  2. ~~Commit + push the Phase 8 files~~ — done (`a90ca59`, fix `9b9c832`).
  3. ~~Add repo secrets `COOLIFY_BASE_URL` and `COOLIFY_API_TOKEN`~~ — done 2026-10-07 (`gh secret set`).
  4. ~~Google OAuth redirect URI for prod~~ — done 2026-10-08. The JS origin isn't needed: Better Auth uses the server-side code flow, and Google checks JS origins only for browser flows (GIS/One Tap).
  5. ~~Sign up as admin on prod, Google sign-in, create org `simtora`~~ — done 2026-10-08.
  6. ~~Delete the n8n "DocuMind Phase 8 check" message~~ — done 2026-10-08.
  7. In a browser on https://documind.zeeshanai.cloud: ask one question in `simtora` and confirm the answer streams token by token (not all at once); then click a citation and confirm the PDF opens at the cited page. This is the only hop not yet verified (browser → Traefik → Next BFF).
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

### 2026-10-20 — [eval] E7: synthetic test sets & reference enrichment (code done locally; live batches paused on the Anthropic spend limit; not deployed)
- **Built (eval API):**
  - Migration `0004_synthetic` (the plan's `0002` number was taken): `synthetic_batches` (kind, org, target dataset, source version for enrichment, config incl. seed/type counts/shortfall/catalog, status `generating|paused|review` + reason, gen.* prompt versions, cost + `max_cost_usd`, counters) and `synthetic_candidates` (plan columns + `ordinal`, `gen_status` separate from review `status`, `seed`, `evidence_quotes`, `auto_rejected`/`reject_reason`, `error`, `cost_usd`). FKs on the existing `jobs.batch_id` (cascade) and `judge_calls.batch_id` + new `candidate_id` (SET NULL, so month spend survives a deleted batch).
  - `services/synthetic.py`: seeded sampler (eligible = section number, ≥ 80 tokens, not revision history/glossary; single-hop spread by document size with ≥ 1 each; multi-hop half cross-document via cited doc codes, half sibling sections; jurisdiction = a company-wide section paired with the best title match in a country supplement of the same department; comparative = best matches between two supplements; unanswerable/out-of-scope get an area/theme hint + the org catalog), types interleaved; batch create/resume/delete, counts. `services/synthetic_checks.py` (pure): word-trigram copy overlap (≥ 0.6 hard, ≥ 0.4 warn), token Jaccard dedupe ≥ 0.7 vs the target dataset's latest version and the batch, section existence (`CODE §n` from seed headers), quotes found, `verdict()`. `services/synthetic_review.py`: edit (sets `edited`), approve, reject (reason), restore, commit.
  - Handler `synthetic_generate`: `gen.<type>` (Opus 5.5, high) → unanswerable: DocuMind `/retrieve` (hybrid, top 8, tagged `syn_<batch>`) → `gen.validate` (Sonnet 5.5, medium) → checks → save under a per-batch advisory lock (dedupe is race-free). Enrichment: expected-section chunks (or a retrieve inside the expected documents when a case names none) → `gen.enrich_reference` (Opus, medium) → `gen.validate` (advisory). All calls through `judge.client` with a batch context (`purpose=synthetic`, retry reuse per candidate, cap → batch `paused`/`budget`; account errors → `judge_unavailable`). The claim SQL only hands out batch jobs while the batch is `generating`.
  - 9 prompt files (`_gen_rules.md` include, six generators, validator, enrichment), `kind: generator`; runs and rejudges record only judge prompts (`registry.sync(kind=…)`), so E7 adds no prompt markers to trends.
  - Routes: `POST|GET /v1/synthetic-batches`, `GET /{id}`, `GET /{id}/candidates?status&type`, `POST /{id}/resume`, `POST /{id}/commit`, `DELETE /{id}`, `GET|PATCH /v1/candidates/{id}`, `POST …/approve|reject|restore`.
- **Built (eval web):** sidebar item enabled; `/synthetic` (batch table: status, generation progress → review counts, cost vs estimate); `/synthetic/new` (new cases / reference answers; org, target dataset, document checklist by code, six type counts with hints, generator model, seed (blank = random, shown on the batch), cap, estimate at $0.07 per candidate); `/synthetic/[batchId]` review queue (live SWR polling while generating; filters To review / Approved / Rejected / All + type; one candidate at a time: question, reference, weighted key facts, expected sections/pages/country, check chips (fail / warn / pass, with details), validator reasoning + issues, generator rationale; source passages as DocuMind source cards with the evidence quotes in highlighter yellow; inline edit (⌘↵ / esc), reject with reason + quick picks; keys `a` `e` `r` `j` `k`; approve/reject advance in place; commit dialog with dataset picker; resume with a new cap; delete).
- **Verified:**
  - Sampler on the real dev corpus (1,162 chunks, 946 eligible): deterministic for a seed regardless of input order; no shortfall for 12/8/8/4/4/4; 26–33 jurisdiction matches per country, 29–33 comparative per country pair, 338 cross-document pairs.
  - Live smoke batch (one per type, seed 7, target `golden`): **6/6 generated, 6/6 passed every check, $0.382 ($0.036–0.116 per candidate; the catalog-based unanswerable/out-of-scope ones cost most, uncached).** Quality by eye: natural employee questions (e.g. "I work in our Berlin office … performance improvement plan. How long will it run, and can I bring someone…?" → SIM-HR-102 §9.1, DE), a multi-hop needing both sections, an AU vs PK comparison with key facts per country, an unanswerable question that DocuMind's top 8 really don't answer, evidence quotes all found.
  - Acceptance batch (40, all types, seed 2026, target `synthetic-v1`, created for this): **10/40 generated, all passing, $0.379, then paused `judge_unavailable`:** the Anthropic account hit its spend limit ("regain access on 2026-11-01"). The golden enrichment batch (30 cases, none skipped) paused at 0/30. No calls were wasted after the limit; both resume from where they stopped. **So the approval rates and rejection reasons the plan asks for don't exist yet**: 16 live candidates so far, 0 auto-rejected, none reviewed by the owner.
  - UI with Playwright (throwaway `test-e7-admin` user + session in `documind_dev`, cookie signed with the eval secret, deleted afterwards): list, new and review pages at 1440 and 390 px and dark mode, no horizontal overflow, no console errors; on the smoke batch `j`/`k` move, `e` → edit → ⌘↵ saves (`edited`), `a` approves and the next candidate slides in (6 → 5 to review), `r` → reason → ↵ rejects, the Approved filter and commit dialog open.
  - Eval API: `ruff` clean; full `pytest` **190 passed, 1 skipped, 2 failed** (both from E7 meeting old tests: the prompt-set assertion now covers the generator prompts, and the synthetic tests delete their judge calls before and after, so `test_system`'s month spend no longer sees them). After the fixes: `test_synthetic.py` 9 passed; `test_system.py` + `test_judge_unit.py` + `test_synthetic_unit.py` 51 passed. One intermediate re-run took 66 min and ended in `OSError [WinError …]` on DB connects (VPS connectivity while the live batches and local servers also used the pool); it passed unchanged on the next try. E7 tests: `test_synthetic_unit.py` 23 (sampling determinism, interleaving, shapes, shortfall, eligibility, allocation, title matching, overlap, dedupe threshold, sections, quotes, verdict, rendering, seeded fields), `test_synthetic.py` 9 (db + fake Anthropic: generate + validate end to end, auto-reject on the validator, duplicates + unknown sections, cost cap pause/resume with call reuse, refusal → failed, review + commit into a new draft with v1 untouched, enrichment into a draft, input validation). Web: `pnpm typecheck`, `pnpm lint`, `pnpm build` pass.
  - Spend this session: ≈ $0.76 (all Anthropic; DocuMind retrievals negligible).
- **Deviations from plan:**
  - `expected_pages`, `expected_departments`, `expected_behavior` and the jurisdiction of jurisdiction/comparative/out-of-scope cases are set from the seed chunks, not taken from the model (fewer wrong labels); the generator also returns `evidence_quotes` (the highlighted answer spans).
  - The validator is Sonnet 5.5 for every type, the unanswerable confirmation included (the plan had Haiku for that): one prompt that sees DocuMind's retrieved contexts as its sources. Enrichment also runs it, advisory only (chips; a human decides).
  - Commit goes into the dataset's existing draft if there is one (only one draft can exist), else a new draft copied from the latest version.
  - Extras: `restore`, `DELETE` batch, `GET /candidates/{id}`; costs are floats in responses (like runs). Seed is optional (drawn server-side).
  - `registry.sync` now reads prompts and versions in two queries and writes only what changed: it did ~3 VPS round trips per prompt file, so with 16 files run and batch creation each spent ~20 s in it.
  - Fixed a pre-existing bug in `datasets.patch_case` (and the new candidate patch): `model_dump(exclude_unset=True)` also drops unset fields of nested models, so an edited key fact lost its default weight.
- **Gotchas / learnings:**
  - DocuMind's base HR manual is tagged `US` and the global docs `GLOBAL`, so "company-wide" can't mean "no jurisdiction": country supplements are `doc_type = country_supplement`. Base and supplement titles differ ("Paid Time Off" vs "Annual Leave"), so matching uses topic-word containment with generic words (leave, pay, work, company, employee…) and single letters ("U.S.", accents) dropped, body sections only, best match per section.
  - Chunk reads for sampling take their own limit (4), not the DocuMind chat limiter (2): a 14-document org took 34 s to create a batch, now 24 s (mostly VPS round trips).
  - One unanswerable `/retrieve` against local DocuMind hit the 30 s read timeout under load; the job retried (`retryable`).
  - zod 4 `z.record(z.enum(…))` is exhaustive (use `z.partialRecord`); the React purity lint rejects `Math.random()` in a Server Component render.
- **Next:** owner: raise the Anthropic limit, resume both batches, review and commit (Pending user actions › Eval E7), publish `golden` v2 and `synthetic-v1`, and run them. Then E8.

### 2026-10-19 — [eval] E6: compare & trends (done locally; not deployed)
- **Built (eval API):**
  - `app/stats/paired.py`: paired percentile bootstrap CI of Δ (B=5000, seeded), two-sided sign-flip permutation p (10k + Phipson–Smyth +1; exact over the non-zero differences when ≤ 16), exact McNemar, Agresti–Min CI for the paired proportion difference, Holm step-down, per-case `classify_change`/`classify_case`.
  - `services/compare.py` + `GET /v1/compare?a&b&metrics&mode`: runs, `config_diff`, `warnings`, `noise_floor`, `pairing`, `metrics[…]` (+ `in_family`, `discordant`, `noise_delta`, `within_noise`), `cases[…]` (values, deltas, `changes`, class, run case ids). Different orgs, no shared scoring mode, or a = b → 422 `not_comparable`; unknown metric → 422 `unknown_metric`; different dataset (versions) → shared case keys + a warning.
  - `services/config_diff.py`: flattened config + snapshot view (DocuMind version/info incl. prompt hashes and retrieval constants, org settings, document codes, judge prompt `v<n> · sha`, dataset slug/version/hash, eval sha); a missing key equals an explicit null.
  - `services/trends.py` + `routers/trends.py` (moved out of `system.py`): `/v1/trends` gains `run_mode` (default: the newest matching run's), `from`/`to`, `runs[]` (with dataset slug/version, config hash, DocuMind version), `markers[]` (`kind` config | documind | prompt | dataset, with the changed keys) and `slices[]`.
  - Tests: `test_paired.py` (bootstrap with a known effect and without, permutation = brute-force enumeration at n=8 and Monte Carlo within 0.015, McNemar textbook values, Agresti–Min bounds, Holm ordering, classes), `test_compare_unit.py` (flatten/diff, top_k diff, snapshot keys, markers across prompt/redeploy/config/dataset changes, comparison builder incl. n/a and unpaired cases, A/A pair choice), `test_compare.py` (db: A/B with exact p, A/A, noise floor, subsets, refusals, trends markers).
- **Built (eval web):** `/compare` (run pickers with swap + scoring mode; default B = newest finished run on A's dataset and run mode; A/B run lines; warnings; config diff table; metric table: A, B, Δ, CI mark on a shared axis with the A/A noise band shaded, p and Holm p, verdict; regressions first, tinted destructive; case list filtered by class with what moved). `/compare/case?a&b&key` side by side: score diff table, both answers, both judge verdicts, both context lists (drill-down components; `lib/case-sources.ts` shared with the case page). `/trends`: URL filters (dataset, org, run mode, retrieval mode, slice, metric checklist), small-multiple line charts with CI bands, change markers (diamond + hairline between runs; hover lists the changes), dataset-version washes, one hovered run shared by all charts, arrow keys/Enter, click opens the run; a change log with "Compare with the run before" links and a table view. Run detail: "Compare with…"; dashboard: "All trends"; sidebar items enabled.
- **Verified:**
  - Golden v1 retrieval-only, top_k 8 (`d552d9dd`) vs top_k 4 (`0722fd05`), 29 paired (one top_k=8 case failed on the pool issue below): the config diff shows `effective.top_k` and `overrides.top_k` 8 → 4. `recall_section@k` has a CI and p in every mode: hybrid Δ 0 (CI [0, 0], p 1; hybrid always ranks the section in the top 4); bm25 −0.074 (CI [−0.185, 0], p 0.50, n.s.). The one significant change is `precision@k` +0.164 (hybrid, Holm p 0.001; bm25 +0.142, Holm 0.003). The side-by-side for golden-003 shows the expected §5.2 at rank 5 cut off at k = 4.
  - **A/A noise floor** (full judged runs, same setup `96b5b2be`, Haiku rubric: `779838d1` vs `dda21472`, 30/30 paired, run one after the other): **no Holm-significant metric** (smallest Holm p = 1.0; smallest raw p: context_precision 0.065, completeness 0.070). |Δ| per metric: every retrieval metric, routing_hit, jurisdiction_acc/false_pos, citation_validity, cited_section_hit, leakage, hallucination, over_clarification **0**; routing_jaccard 0.011; cited_doc_precision 0.011; faithfulness 0.005; citation_precision 0.000; citation_recall 0.005; supported_citation_recall 0.015; context_precision 0.049; behavior_correct 0.036 (3.6 pts); false_refusal 0.036; answer_quality 0.037; completeness 0.058; relevance 0.029; jurisdiction_handling 0.023; refusal_helpfulness 0.375 (n = 2); case_pass 0.067 (6.7 pts: 2 A-only, 4 B-only passes, so 20 % of cases flip pass/fail). **Per-case flip rate 77 %** (23/30 cases moved beyond the per-case band on at least one quality metric, almost all judge metrics). Operational: latency +208 ms, TTFT +186 ms, input tokens −4, output tokens −10.6, DocuMind cost −$0.000205/case.
  - An older deterministic A/A pair (E3 `1c72b052` vs `d9d7147a`, judge off): flip rate 10 %, routing_jaccard 0.022, cited_section_hit 0.033, cited_doc_precision 0.033.
  - Trends (full runs): a prompt marker on the E4 rejudge (answer_quality v1 → v2) and on E5 smoke (answer_quality v2 → v3, followup_resolution v1 → v2), a config marker on the first judged run, dataset markers between golden and e5-smoke, none between the two A/A runs. DocuMind's version is `dev` locally, so a **redeploy marker is unit-tested only**; check it on prod.
  - UI with Playwright (a throwaway `test-e6-admin` user + session in `documind_dev`, cookie signed with the eval secret, deleted afterwards): compare, side by side and trends at 1440 and 390 px (no horizontal overflow) and dark mode; no console errors.
  - Eval API: `ruff` clean, `pytest` 159 passed + 1 skipped (live) in 26 min, then `test_compare.py` + `test_system.py` re-run after the last fixes (4 passed). Web: `pnpm typecheck`, `pnpm lint`, `pnpm build` pass.
  - Spend: ≈ $0.24 (judge $0.205, DocuMind $0.031).
- **Deviations from plan:**
  - **Operational metrics are descriptive** (`in_family: false`): Δ, CI and raw p, but outside the Holm family, never "significant", and they don't classify cases. Reason: they follow the infrastructure. A back-to-back rerun reads ~99 % of its input from OpenAI's prompt cache vs ~50 % cold, so DocuMind's cost per case drops ~45 % with an identical setup (seen in both A/A pairs; in E3's pair cost was the only "significant" metric before this change).
  - The noise floor isn't a stored file: the API finds an A/A pair (completed, non-partial, not a rejudge, same config hash + DocuMind version + judge prompt shas) on A's dataset, preferring A's or B's setup; compared A/A runs are their own floor.
  - Case classes add **mixed** (a quality metric improved and another regressed) and **unpaired**. The per-case band for ms/count/usd metrics is 10 % of the larger value (|Δ| > 0.1 only fits 0–1 scores).
  - Binary metrics' CI is Agresti–Min (a Wald interval after adding ½ to each cell), so 0 discordant pairs doesn't give a degenerate [0, 0].
  - `/v1/trends` returns one run mode at a time (the dashboard sparklines now follow the newest run's mode). Change markers sit between the two runs (the hover is on the run after the change).
- **Gotchas / learnings:**
  - Locally, **four concurrent runs starve the eval API's DB pool** (5 + 2 connections at ~0.45 s per round trip): `QueuePool limit … reached` after 30 s, pages hang, and a case failed at stage `job`. One golden run at a time is fine (as in E3/E4). Prod's DB is on the same host.
  - `next dev` (eval web) fell into the endless "Compiled in 2ms" reload loop again (6k cycles) without a typecheck running; stopping it and deleting `.next/dev` fixed it.
  - Playwright against `next dev`: `networkidle` and even `load` never fire (HMR); wait for `commit` + a selector.
- **Deployed** `b9d2fbe` (workflow: eval checks + both Coolify deploys green). Both eval containers are healthy on the new image; the prod eval API reports DocuMind `8f7f160`, answers `/v1/trends` 200, and `/compare` on the web redirects to sign-in when signed out.
- **Next:** on prod, a run after DocuMind's next deploy should carry a `documind` marker (its commit is in each run's snapshot). Then E7 (synthetic test sets).

### 2026-10-19 — [eval] E5: eval web, auth & first deploy (deployed; owner checks pending)
- **Built (`evaluation/web/`, Next 16.4 / Better Auth 1.7.7, same lockfile versions as `web/`):**
  - Auth on DocuMind's tables: own secret, `cookiePrefix: "documind-eval"`, `disableSignUp` (email + Google), `user`/`session.additionalFields` mirroring the admin + organization plugins, `session.create.before` → 403 `NOT_PLATFORM_ADMIN` (inline on email; `/sign-in?error=…` from Google), `disabledPaths` for every account-changing endpoint, `requireAdmin()` in every layout/page/action, `proxy.ts` cookie-presence redirects. `pnpm auth:check` (read-only `getMigrations`, exit 1 on drift; a negative test with an extra field was caught).
  - BFF `/api/backend/*` (session + admin, key + user id, streamed, SSE `no-transform`), `eval-api.ts` (`apiJson`, `action()` → inline errors), `api-types.ts`.
  - Pages: dashboard (latest 5 runs, sparklines for the pinned dataset via cookie or the latest run's, month spend, DocuMind version/reachability), datasets (list, detail + versions, version case sheet with a side-sheet editor for drafts, publish, export, JSONL import with key mapping + server preview), runs (filters, new-run form with metric/gate/threshold picker, judge models/samples/efforts, budget, cleanup, README cost estimate), run detail (header + controls: pause, resume incl. budget raise, stop, rejudge, export CSV/JSON, delete; metric strip with CI bars; all-metrics table; slices heatmap; sortable/filterable case table) with `useRunEvents` (EventSource from the last seen cursor, closes itself on a terminal status, refetches aggregates; SWR polling fallback), case drill-down (setup, routing vs expected, answer markdown with citation chips whose hover shows the passage with judged evidence marked, claims, contexts with ranks/labels/judge/cited + expandable text, judge reasoning + issues, all scores, judge calls with cache tokens and cost, DocuMind usage by operation), settings (connectivity, service users, pricing + prompt hashes) and judge prompts (versions, body, schema, diffs).
- **Eval API additions:** `GET /v1/system`, `GET /v1/trends` (E6's response shape, without change markers yet), `judge_calls` on the case detail; `tests/test_system.py` (3). Dockerfile (python:3.12-slim + uv, uid 10001, repo layout under `/srv`, `alembic upgrade head` then uvicorn :8100, curl health, `SOURCE_COMMIT` → `GIT_SHA`).
- **Deploy:** Coolify apps `documind-eval-api` (`5435bt2d…`, no domain, alias) and `documind-eval-web` (`7ltejy3n…`), Auto Deploy off, env via the API; DNS A `evaluation.documind`; `deploy.yml` gains `eval_api`/`eval_web` filters, checks (ruff + `pytest -m "not db and not live"` with dummy keys; pnpm lint + typecheck) and deploy jobs. Pushed `55ad70c`: all 9 jobs green. The first eval-api build died on a transient `git ls-remote` (exit 128) and succeeded on a manual redeploy. Prod migrations `0001`–`0003` ran into the new `documind_eval` schema; bootstrap + golden import done in the container.
- **Verified:**
  - Local: non-admin email sign-in refused with the inline message (curl + Playwright through the form); `?error=NOT_PLATFORM_ADMIN` / `signup_disabled` render inline; admin sign-in on :3000 and :3100 with one cookie jar keeps both sessions (`better-auth.session_token` + `documind-eval.session_token`), and a DocuMind token replayed under the eval cookie name is rejected; BFF 401 without a session; `auth:check` clean.
  - UI flow with Playwright: imported a 3-case JSONL (mapped `jurisdiction` → `expected_jurisdiction`), published, started a judged full run from `/runs/new` (budget $0.25): live progress 0/3 → 3/3 → finalizing → completed with the Live indicator, then the drill-down showed routing, answer, 19 claims, 8 contexts, judge reasoning, 6 judge calls and usage. Cost $0.017 (dataset `e5-smoke`, run "E5 UI smoke", left in dev).
  - Screenshots at 1440 and 390 px (no horizontal overflow) and in dark mode; no console errors. Both Docker images built and ran locally (API: migrations, prompt sync, health with the build-arg version, golden path; web: health, sign-in gate, pages, disabled endpoints 404).
  - `pnpm typecheck`, `pnpm lint`, `pnpm build` pass; eval API `ruff` clean, `pytest` 122 passed + 1 skipped (live) in 19 min, `test_system.py` 3 passed.
  - Prod: Let's Encrypt cert for `evaluation.documind.zeeshanai.cloud` (valid to 2027-01-17); `/` → 307 `/sign-in`; BFF 401; `:8100` unreachable from outside, no host ports; the eval API reaches DocuMind (`9f6fda9`) and Anthropic, both service users check out, golden v1 has 30 cases.
- **Deviations from plan:**
  - The BFF also forwards `Last-Event-ID` (EventSource resume; the eval API validates it), beyond `content-type`/`accept`.
  - `NEXT_PUBLIC_APP_URL` in the eval web means DocuMind's URL (same key and meaning as in `web/`); the eval app's own origin is server-side `EVAL_PUBLIC_URL`.
  - Added `/v1/system` + a minimal `/v1/trends` (dashboard needs) and `judge_calls` on the case detail (drill-down needs). The dashboard's "pinned dataset" is a per-browser cookie set from the dataset page.
  - Live metric cards show running means without CIs (aggregates exist only after finalize). Status merged into the Result column of the case table, so four metric columns fit at 1440 px.
  - No recharts: the sparklines and heatmap are hand-built SVG/HTML (sequential `--chart-1`, cubic fill so 0.85 vs 1.0 differ; every cell prints its value).
- **Gotchas / learnings:** Better Auth redirects a hook's `APIError` body `code` to `errorCallbackURL?error=<code>` on the OAuth callback (so `errorCallbackURL` must not carry its own `error`). `AlertDialogAction` (base-nova) doesn't close the dialog: control `open`. React compiler lint rejects a mutated render-time variable. The case drill-down takes ~8 s in local dev (every query is a VPS round trip). A Coolify build can fail on a transient `git ls-remote` exit 128: redeploy.
- **Next:** owner: Google redirect URIs + a prod browser sign-in and small run. Then E6 (compare & trends: extend `/v1/trends` with change markers).

### 2026-10-19 — [eval] Rubric judge moved to Haiku 5.5 (done locally)
- **Why:** the Sonnet 5.5 rubric was 86 % of judge spend ($0.537 of $0.627 per 30 cases), and runs hit the Anthropic spend limit.
- **Changed:** `judge.answer_quality` and `judge.followup_resolution` now use `model: claude-haiku-5-5`. They keep `thinking: adaptive` and `effort: medium`: Haiku 5.5 supports adaptive thinking, and the rubric benefits from it. Haiku has no server-side fallback, so a refusal is status `refusal`. A run can still put the rubric on Sonnet via `judge.models.rubric`.
  - The frontmatter change bumps both prompts' hashes, so the next startup creates new `prompt_versions`. Old runs keep their recorded Sonnet versions. A rejudge takes the current files, so rejudging the Sonnet-judged golden run gives a direct Haiku vs Sonnet comparison with no DocuMind calls.
  - Tests and docs updated (unit test asserts Haiku with no fallback, plus a Sonnet-override request); metric descriptions are now model-neutral.
- **Verified:** the spend limit has been raised. A live `judge.answer_quality` call on Haiku (adaptive, medium, structured output) returned `end_turn` with a valid `AnswerQuality` in 6.1 s for $0.00074, mostly the first cache write of the system prompt. A `judge.behavior` call returned a valid result in 2.7 s for $0.00035. `ruff` clean; `pytest -m "not db"` 78 passed; `tests/test_judge.py` 11 passed.
- **Next:** rejudge the Sonnet-judged golden v1 run to record the new judge cost (estimate ≈ $0.12 judge, ≈ $0.15 per full run) and compare answer_quality against the Sonnet baseline (0.85; completeness 0.70, relevance 0.90). That is the first data point for E9's judge calibration. Then the live $0.10 budget-pause check and `pytest -m live`.

### 2026-10-19 — Logs viewer: markdown-formatted Answer (not deployed)
- Built: the Response tab's Answer card in `/v1/logs/ui` renders the answer as markdown (headings, paragraphs, nested/ordered lists, GFM tables with alignment, blockquotes, fences, hr, `code`, bold/italic/strike, https links, `[n]` citation markers as superscripts). It's a small inline renderer in `logs_ui.html` that builds DOM nodes (no innerHTML); the CSP (`script-src 'nonce-…'`) rules out a CDN library. Prose styles mirror `.answer-prose`; the panel's section headings are now `.panel > h3` so answer headings keep their own styles.
- Checked the renderer against a sample answer in Node with a stub DOM; not yet viewed in a browser.

### 2026-10-19 — [eval] E4: Claude judge & generation metrics (done locally)
- **Built (`evaluation/api/`):**
  - `app/judge/`: `registry` (prompt files = frontmatter + system prompt + `<!-- task -->` line, `_rules.md` include; sha256 over key + normalized bodies + output schema + params; `sync()` at startup and at run creation inserts numbered `prompt_versions`; judging loads the run's recorded versions **from the DB**), `render` (XML case packet, sources exactly like DocuMind's `format_source`, our closing tags defused inside data), `client` (one path for every Anthropic call: structured output, fixed effort, thinking per model, Sonnet/Opus `fallbacks: "default"`, `request_hash` reuse per run case, 429 → requeue, 5xx → job retry, account-level 4xx → run pause, `judge_calls` metering, budget pause), `pricing` + `judge-pricing.json` (skill values; Haiku long-context card; fallback models), `schemas` (reasoning before scores), 7 prompts.
  - Metrics: `generation` (faithfulness, hallucination, citation precision/recall, supported_citation_recall, key_fact_recall, context_recall/precision, answer_quality + 5 dimensions, followup_resolution) and `behavior` (behavior_correct, false_refusal, deterministic over_clarification). New gates: faithfulness ≥ 0.9, answer_quality.correctness ≥ 0.5 (= 3/5), behavior_correct.
  - `services/judging` (metric groups, each failing alone), handler `case_judge`, `case_results.save_judged` (passed over all scores), `services/rejudge` + `POST /v1/runs/{id}/rejudge`, `POST /runs/{id}/resume {max_judge_cost_usd}`, `/v1/prompts`, `/{key}/versions`, `/{key}/diff?from&to`, claims on the case detail, `source_run_id` on runs. Worker limits: per-model semaphore + RPM token bucket.
  - Migration `0003_judge`: `prompt_versions.version` (+ unique per prompt), `retrieved_contexts.title/owner`.
  - Tests: `test_judge_unit.py` (25, pure: hashing, cost math, render/injection, request shape, claims → citation math by hand, behaviour), `test_judge.py` (11, db, `tests/fake_anthropic.py`: full run, disabled judge, unknown model, retry reuse after a 5xx, refusal, budget pause/resume, usage-limit pause/resume, rejudge, registry routes, recorded versions), `test_judge_live.py` (opt-in `-m live`).
- **Verified (local DocuMind + real Anthropic):**
  - Full golden v1 run with every judge metric: **30/30 done, 0 judge errors**; faithfulness 0.965, citation precision 0.958 / recall 1.0, behavior_correct 0.867, answer_quality 0.85 (completeness 0.70, relevance 0.90), context_precision 0.870, hallucination 0.067; 26/30 passed (failures: honest `partial`/`abstained` answers on golden-006/016/022, two faithfulness misses, and one judge error, below).
  - `cache_read_tokens > 0` on 28–29 of the 29 later calls per prompt (the misses were concurrent first calls). `runs.judge_cost_usd` = Σ `judge_calls.cost_usd` = **$0.62673684** exactly.
  - **Cost per 30-case run: $0.643** (judge $0.627: Sonnet rubric $0.537 = 86 %, the four Haiku prompts $0.090; DocuMind $0.016). Latency per call: Haiku 2.6–4.9 s, Sonnet 6.4 s avg.
  - Editing `judge.answer_quality.md` (one grounding sentence) → **v2** at restart; `/diff?from=1&to=2` shows the line. The rejudge used v2 (27 calls; the source run used v1 ×30) with **0 DocuMind `llm_usage` rows** for its run id.
  - `na (no_reference)` on v1 for answer_quality.correctness, key_fact_recall and context_recall (30/30 each).
  - `ruff check` + `format --check` clean; `pytest` **122 passed, 1 skipped** (the opt-in live smoke) in 20 min on the final code.
- **Not verified live: the $0.10 budget pause.** Mid-session the Anthropic account hit its own spend limit ("You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC") after ~$1.10 of judge spend. The rejudge's last 3 cases and the whole budget-cap run (`0dab16af…`, left in dev) got that 400 on every call, so nothing was spent and the cap couldn't trigger. The pause is covered by `test_budget_pauses_the_run`; re-run it live once the limit is raised.
- **Deviations from plan:**
  - `beta.messages.create` + `transform_schema` + `model_validate_json` instead of `messages.parse`: parse raises on a refusal or `max_tokens` reply before `stop_reason` can be checked.
  - The packet gets a cache breakpoint only when another call reuses it (N > 1 samples; the key-facts answer/sources pair, run sequentially): the live run showed every packet write unread at N = 1, a pure 1.25× surcharge.
  - **New:** account-level failures (401, 403, the usage-limit 400) raise `JudgeUnavailable` and pause the run (`status_reason = judge_unavailable`) instead of making every metric `error`. The budget-cap run above showed why: 120 errored metrics, a "completed" run with 0 passed, and 30 wasted DocuMind chats.
  - `context_recall` reuses `judge.key_facts` (task line names `the <sources>`); `over_clarification` is deterministic; the run config `judge` also has `enabled` (E3 tests turn it off). Judge metrics run in full runs only. `supported_citation_recall` = supported claims cited with a supporting source / supported claims. A claim the verifier skipped counts as not_found. Behaviour `answer` accepts only `answered` (`partial` fails the gate).
  - A rejudge copies `generated`/`judging` cases of a stopped run too; others become `skipped`. Its run-level DocuMind cost is 0; finalize skips usage reconciliation and cleanup. `resume` refuses a run still over budget (409 `budget_exhausted`) unless given a higher `max_judge_cost_usd`.
- **Gotchas / learnings:** the prompt hash must include the key (two prompts with equal bodies collided on the unique `sha256`; caught by the registry test). Haiku at low effort with thinking off can contradict its own reasoning: golden-001 was labelled `clarified` while its reasoning said it "does not ask the user a question… answers substantively". That's an E9 calibration item; the behaviour prompt is unchanged so v1 stays the baseline. Importing test_runs' fixtures into test_judge needs ruff F811 ignored for that file. On Windows, `Path.write_text` turns `\r\n` into `\r\r\n`; tests that need CRLF use `newline=""`.
- **Next:** raise the Anthropic spend limit (or wait for Nov 1), then re-run the live checks: a $0.10-capped golden run should pause with `budget`, and `uv run pytest -m live tests/test_judge_live.py`. Then E5.

### 2026-10-19 — [eval] E3: run engine & deterministic metrics (done locally)
- **Built (`evaluation/api/`):**
  - `metrics/`: `types` (CaseSpec, Context, CaseOutput, MetricSpec, MetricResult), `registry` (REGISTRY, `MetricConfig` = enabled/thresholds/gates from the run config, `evaluate`, `case_passed`, `describe`), `retrieval` (hit@5, hit@k, mrr, recall_doc@k, recall_section@k, precision@k, ndcg@k, routing_hit/jaccard, jurisdiction_acc/false_pos; `is_relevant` ported from `run_eval.is_hit`), `citations` (citation_validity, cited_section_hit, cited_doc_precision, page_hit), `operational` (latency, TTFT, tokens, cost), `safety` (leakage) + `fingerprints.txt`.
  - `stats/`: Wilson; percentile bootstrap (B=2000, sha256-derived seed of run id + metric); percentiles.
  - Services: `runs` (create: me → health/info/settings/documents in parallel, scope codes → ids or `skipped`, config + `config_hash`, snapshot, run cases, bulk-enqueued jobs; list/get/delete; case filters incl. `metric`+`lt`), `run_state` (counting `UPDATE … RETURNING`, `settle`, pause/resume/stop, `fail_case`, `sweep`), `case_results` (`Generated`, contexts + scores + count in one transaction), `aggregates` (pure `build_aggregates` in a thread), `exports` (CSV/JSON).
  - Handlers `case_generate` (full: setup turns + scored turn, conversation id saved on `meta`; retrieval-only: one `/retrieve`; recovery; 4xx ≠ 429 permanent, others back off, last attempt → `error`) and `run_finalize` (aggregates, `/usage` reconciliation, cleanup, recount, final status). `worker/sweeper.py` (every 15 s, started with the slots).
  - Routes: `POST/GET /v1/runs`, `GET/DELETE /v1/runs/{id}`, `/aggregates`, `/cases`, `/cases/{id}`, `/pause`, `/resume`, `/stop`, `/events` (SSE), `/export?format=csv|json`, `GET /v1/metrics`.
  - Migration `0002_usd_precision`: every USD column → `numeric(14, 8)` (DocuMind's `llm_usage` precision).
  - **DocuMind (E1 hook added):** `GET /v1/admin/eval-runs/{run}/conversations?case_id=` (admin-only, oldest first) + test assertions in `test_eval_hooks.py`.
- **Verified (local DocuMind, real OpenAI, ~$0.04 in total):**
  - Retrieval-only golden v1: hybrid hit@5 **1.000**, MRR **0.944**; bm25 hit@5 **0.967** (MRR 0.812, as the E1 re-check); vector 1.000/0.944; routing 30/30, jurisdiction 10/10. DocuMind cost reconciled exactly.
  - Clean full run: 30/30 done and passed, citation_validity 1.0, leakage 0, hit@5 1.0, MRR 0.944, latency p50 13.7 s / TTFT p50 11.0 s; stored cost **= `/usage`** ($0.00903941 both); 0 conversations left after finalize.
  - Pause → hard kill (`Stop-Process -Force`) with 4 cases in flight → restart: the sweeper turned `pausing` into `paused` once the dead locks expired (5 min); resume → completed 30/30. One interrupted chat was **recovered** (DocuMind had finished it), the others were deleted and restarted. With cleanup off, DocuMind listed **30 conversations, ≤ 1 per case**. Cost gap 1.6 %: the killed chats' calls are metered but produce no outcome.
  - Stop after 3 done → `stopped`, `partial=true`, 7 done (the 4 in flight finished), 23 pending, aggregates over n=7; conversations cleaned.
  - `curl -N …/events`: the replay, then `run`/`case` events as cases finished.
  - `ruff check` + `ruff format --check` clean; eval `pytest` **86 passed** in 11 min (15 new db tests in `test_runs.py`, 32 pure in `test_metrics.py`/`test_stats.py`). DocuMind `test_eval_hooks.py` 5 passed.
- **Deviations from plan:**
  - The first pause/kill drill found a gap: a kill after DocuMind created a conversation but before its `meta` was stored left a duplicate (finalize then deleted 31 for 30 cases). Hence the new DocuMind hook: a retried attempt (attempt > 1) lists the case's conversations, recovers one complete match and deletes the rest. Drill 2 then had no duplicates.
  - The citation regex is DocuMind's `MARKER_RE` (`[1]` and `[1, 3]`), not just `\[(\d+)\]`.
  - Setup turns get request ids `eval.<run8>.<case>.<attempt>.t<n>`; the scored turn keeps the planned form. In retrieval-only runs, setup turns become user-only `history`.
  - Finishing is `done + failed + skipped ≥ total`. Case jobs are ordered by `clock_timestamp()` per row, not by priority. Retrieval-only runs store case-level metrics (routing, operational, leakage) under every mode, and `case_pass`/`error_rate` aggregate rows per mode. Slices add `juris:none`.
  - Extras: `GET /v1/metrics`, `GET /v1/runs/{id}/aggregates`, `canary_phrases` in the run body (E8 fills it), and `org_slug` defaults to the dataset's `default_org_slug`. A run can only be deleted when it isn't active (paused is fine).
  - Latency/TTFT are DocuMind's server-side values (the client-side ones are in the trace). Tokens and cost cover setup turns too; latency/TTFT only the scored turn. A recovered case has cost but no token counts.
  - Finalize resets cases a dead worker left `generating` back to `pending`, and recounts every counter from `run_cases`.
- **Gotchas / learnings:** Git Bash rewrites `/v1/...` arguments into Windows paths (`MSYS_NO_PATHCONV=1`), and `taskkill //F` fails from it (use PowerShell `Stop-Process -Force`). A dead worker's lock looks live for 5 minutes, so a paused run settles only after that. respx: use `path__regex` with a `base_url` mock; async side effects work. Numeric(14, 6) silently rounded case costs.
- **Next:** E4 (Claude judge). `save_generated` marks the place where judge metrics stop at `generated` and enqueue `case_judge`.

### 2026-10-19 — Logs viewer: paging, row numbers, log-to-log navigation (not deployed)
- Built: `GET /v1/logs` takes `limit` up to 500, an `after` cursor (the rows just newer, still newest first; not combinable with `before`) and returns `total` on a first page only. `/v1/logs/ui` has a `#` column (1 = newest, across pages), 50/100/200/500 rows per page (remembered in localStorage), Prev/Next pages (a client-side cursor stack), Prev/Next log buttons plus ←/→ keys in the detail view (neighbours fetched under the list's filters, the open tab is kept), and the Response tab shows the full stored body as JSON (chat SSE: an Answer card + the condensed `{answer, events}` body).
- Gotcha fixed: the page's `h()` helper flattened children one level only, so `kv()` (Routing, Timings) printed `[object HTMLElement]`; it now uses `flat(Infinity)`.
- Next: try it in a browser (no local API was running this session); deploy.

### 2026-10-19 — [eval] E2: eval API foundation, datasets & durable queue (done locally)
- **Built (`evaluation/api/`, uv, Python 3.12):**
  - `core/`: config (`EVAL_*` settings, ported `parse_schema`, `with_schema`), db (ported normalizer, `documind-eval-api`, pool 5+2), security (`verify_api_key` constant-time; `get_admin` reads `"<EVAL_AUTH_SCHEMA>"."user"`: unknown → 401, non-admin/banned → 403), log + errors copied from DocuMind.
  - Migration `0001_core`: all 14 tables of the data model except synthetic/review, enum CHECKs via `op.f()`, unique `(dataset_version_id, case_key)` and `(run_id, case_id)`, partial unique `jobs(run_id) WHERE run_finalize AND queued/running`, index `jobs(status, available_at, priority)`. Enum values live in `models/enums.py`.
  - `documind/`: `DocuMindClient` (tags + `X-Request-ID` on every call; GETs and the idempotent cleanup DELETE retry 2× on 5xx/connection errors, POSTs never), typed SSE events + `parse_event`, models.
  - `worker/`: `queue.py` (the planned claim SQL, heartbeat, succeed/fail/requeue/release, `enqueue`), `loop.py` (slots, 1 s ± jitter idle poll, release on cancel), `limits.py` (`DocuMindLimiter`), handler `noop`.
  - Datasets: services + routes as planned (draft copy, publish with `content_hash`, 409 `version_published`, JSONL import with mapping/defaults/`?preview`, export), DocuMind passthrough, `/health` (`{status, db, version, documind{reachable, version}}`, always 200).
  - Scripts `bootstrap_service_users` (idempotent, `--dry-run`) and `import_golden`; 39 tests (unit, respx, db).
- **Verified:** `alembic upgrade head` created only `documind_eval_dev` (14 tables); `documind_dev` stays at `0004_eval_hooks`; `alembic check` clean. The bootstrap created both users (a re-run printed "unchanged"), neither has an `account` row, and DocuMind `/v1/me` as the bot lists `simtora` (the probe sees only `simtora`, as member). The golden import gave `golden` v1 published, 30 cases (17 single_hop, 3 multi_hop, 10 jurisdiction), all with departments; a re-run is a no-op. Restart drill: a 30 s `noop` job, uvicorn hard-killed (`taskkill /F`) mid-sleep and restarted; the new process reclaimed it when the 5-min lock expired (attempt 2) and it succeeded. `/health` shows `documind.version` (`dev` locally). `ruff check` clean; `pytest` 39 passed (3 min).
- **Deviations from plan:**
  - Extra dependency `python-multipart` (the import upload).
  - Extra routes: `POST /v1/jobs/noop` + `GET /v1/jobs/{id}` (the restart drill; E5 settings can use them).
  - `POST /v1/datasets` also creates an empty draft v1. A second draft gets 409 `draft_exists` with its id. An import becomes a new version holding exactly the file's cases (replace, not merge); an unchanged re-import returns the published version with `unchanged: true`.
  - `content_hash` is order-independent (cases sorted by `case_key`, positions excluded).
  - The `X-User-Id` checks (401 unknown, 403 non-admin) run on every `/v1` route via the aggregator.
  - `metric_scores.mode` / `run_aggregates.mode` are NOT NULL, with `chat` for full-run scores; added columns `runs.status_reason`, `runs.documind_cost_reported_usd`, `run_cases.case_key`, `jobs.max_attempts/finished_at`.
  - The job-kind CHECK already lists the E7–E9 kinds (`synthetic_generate`, `authz_probe`, `calibration_compute`).
  - SSE fixtures: answer, clarification and multi_part were recorded from local DocuMind as eval-tagged chats (conversations deleted afterwards); `error.txt` is hand-written in the same format.
  - The `EVAL_*` keys were added to `.env.local` by a scratch script that printed only key names (it needed `DATABASE_URL`'s credentials and generated `EVAL_API_KEY`/`EVAL_BETTER_AUTH_SECRET`); `.env.example` lists them.
- **Gotchas / learnings:** asyncpg infers `now() - $1` as a timestamp, so interval params need `CAST(:d AS interval)` *and* a `timedelta`. Async ORM needs `eager_defaults=True` (else `updated_at` lazy-loads after an UPDATE). A model column named `text` shadows `sqlalchemy.text` inside the class body. The router asks for clarification only when the answer differs by country and none is hinted ("What is my statutory entitlement to paid annual leave under local law?" triggers it). `eval-bot`/`eval-probe` now show in DocuMind's dev `/admin/users` (open question still stands).
- **Next:** E3 (run engine & deterministic metrics).

### 2026-10-19 — Coolify: include source commit in build (documind-api)
- Enabled "Include source commit in build" on `documind-api` via the Coolify API; read back `include_source_commit_in_build: true`. Takes effect on the next deploy.
- **Gotcha:** the API field is `include_source_commit_in_build` (`is_include_source_commit_in_build_enabled` is rejected as "not allowed"). The earlier `COOLIFY_API_TOKEN_ROOT` was revoked (401) and was re-created by the owner.

### 2026-10-19 — [eval] E1: DocuMind eval hooks (code done, not deployed)
- **Built (`api/`):**
  - migration `0004_eval_hooks`: `conversations.is_eval/eval_run_id/eval_case_id` and `llm_usage.eval_run_id/eval_case_id`, each with a partial index (`alembic check` clean);
  - `core/eval.py` (`EvalContext`, `EvalDep`: `X-Eval-Run-Id`/`X-Eval-Case-Id`, 422 `invalid_eval_header`, 403 `eval_forbidden`);
  - `UsageCtx` gained the eval tags plus `count_quota`, and `record_usage` skips `quota.add_tokens` for tagged rows;
  - in `prepare_turn`/`run_chat`: no quota, no title, `[eval] <case>` title, an is_eval match on continue (else 404), `ChatOverrides` applied with `dataclasses.replace`, `mode=` passed to `retrieve()`;
  - eval-mode `routing`/`sources`/`usage` payloads, built by `routing_payload`/`sources_payload`/`usage_by_operation`;
  - `routers/eval.py` + `services/eval.py` with `/orgs/{id}/retrieve`, `…/documents/{doc}/chunks`, `/admin/eval/info`, `/admin/eval-runs/{run}/usage` and `DELETE …/conversations`;
  - exclusions in `analytics.py`, `my_analytics.py` and `conversations.py`;
  - `/health.version` (`GIT_SHA`; Dockerfile `ARG SOURCE_COMMIT=dev`), the BFF header comment, and `tests/test_eval_hooks.py` (5 tests).
- **Verified:**
  - `ruff` passes, and the 5 new tests pass. The full suite gave 174 passed and 1 failed: `test_document_lifecycle`, because local MinIO wasn't running (Docker Desktop was off). That failure isn't related to E1; re-run it with MinIO up;
  - live, against a local uvicorn with real OpenAI: 3 eval chats as the admin streamed `sources` with `text`/`chunk_id`/scores and `routing` with `needs_clarification`. The conversation list, org analytics, quota and my-analytics were identical before and after. The run's usage showed 9 tagged calls (3 per case), and `DELETE …/conversations` removed 3;
  - `run_eval` is unchanged: hybrid hit@5 1.000 and MRR 0.944, vector the same, bm25 0.967/0.812, routing 30/30;
  - `/retrieve` (in-process, admin, 3 modes) gives the same first-hit ranks as `run_eval` for golden questions 1–5. It made one router call and one embed call per question, created no conversations, and its run usage reconciled (10 calls).
- **Deviations from plan:**
  - The migration is `0004` (`0003` was already Phase 10's).
  - `UsageCtx.count_quota=False` is used by `/retrieve`, so an untagged admin call doesn't touch quota counters either.
  - An eval chat with `include_source_text=false` still gets the full source dicts, minus `text` (instead of the user previews), because the harness needs chunk ids and scores.
  - Prompt hashes cover the instructions **plus** their JSON schemas (router, rewrite, title).
  - `/retrieve` always retrieves, even when the router asks for clarification (as `run_eval` does); `routing.needs_clarification` tells the harness. bm25-only requests skip the embedding.
  - Extras:
    - `/retrieve` also returns `config` (effective router model, tier, top_k);
    - the chunks endpoint returns `offset`/`limit`;
    - run usage totals add `reasoning`, `errors`, `first_at`/`last_at`;
    - `my_analytics.BOOKMARKS_SQL` also excludes eval;
    - a case id without a run id is rejected (422).
  - The run-usage keys follow the plan's `by_case` names (`calls/input/cached/output/cost_usd`) for totals and `by_operation` too, while the chat SSE `by_operation` uses `input_tokens…` per call.
- **Gotchas / learnings:**
  - The eval conversation is still readable via `GET /v1/conversations/{id}` by its owner (eval-bot), which is useful for debugging.
  - Request logs record eval traffic like any other request.
  - The manual check left 10 tagged `llm_usage` rows (run `manual-e1-…`) in `documind_dev`. They're harmless and invisible to analytics.
  - From this machine a 3-mode `/retrieve` takes 13–18 s (DB round trips).
- **Next:** do the owner actions under *Pending user actions › Eval E1*, then E2.

### 2026-10-19 — Phase 10: API request logs & viewer (code done, not deployed)
- **Built:**
  - `api_request_logs` table + `llm_usage.request_id` (migration `0003_request_logs`; `alembic check` clean);
  - `core/request_log.py`, a pure-ASGI middleware inside `RequestIdMiddleware`. It tees capped bodies (64 KB; SSE 256 KB, condensed to the answer + non-delta events), summarises multipart uploads (bytes + filenames) and binary responses (type + bytes), redacts `x-api-key`/`authorization`/`cookie`/`set-cookie`, and records unhandled exceptions with a traceback. Rows are written in background tasks (`drain()` on shutdown);
  - `run_chat` annotates `conversation_id`/`message_id`, plus the real exception and traceback when a 200 stream ends in `error`;
  - the read API `GET /v1/logs` (filters, keyset cursor, user email, org slug, token/cost totals), `/v1/logs/routes` and `/v1/logs/{id}` (LLM calls, message routing/retrieval/sources);
  - the viewer `GET /v1/logs/ui` (`app/static/logs_ui.html`): no external assets, a per-response CSP nonce, DESIGN.md tokens, light/dark, the key kept in localStorage, list + detail with Request/Response/Error/Retrieval/LLM-calls tabs, text-only DOM rendering;
  - an hourly prune in the lifespan (`REQUEST_LOG_RETENTION_DAYS`, default 30), plus the privacy-page "Technical logs" text and retention bullet (effective date now 19 October 2026);
  - `tests/test_request_logs.py` (10 tests).
- **Deviations from plan:** FastAPI 0.142 keeps included routers nested, so `scope["route"].path` is `/me`, not `/v1/me`. The route template is rebuilt from the path + path params instead (no private API). Bodies are stored as `jsonb` in both columns (non-JSON as a JSON string). `conftest.py` turns request logging off for every test except those that opt in, so the suite leaves no rows behind.
- **Gotchas / learnings:** the title task inherits the request id, so a first chat turn has 4 linked LLM calls (router, embed_query, answer, title). An unhandled-exception response is sent by `ServerErrorMiddleware` outside our middleware, so its body isn't captured; the row carries `internal_error` + the traceback.
- **Next:** `/ship`; after the deploy, open `https://api.documind.zeeshanai.cloud/v1/logs/ui`, enter the prod key, send one chat and check its detail tabs. The prod migration runs on container start (`alembic upgrade head`).

### 2026-10-18 — [eval] Evaluation harness planning (docs only)
- **Built:**
  - the plan docs `docs/plan/eval/README.md` and `phase-E1…E9-*.md`;
  - the `evaluation/CLAUDE.md` skeleton;
  - the Status.md › Evaluation harness section (tracker, decisions, open questions);
  - a root `CLAUDE.md` pointer.

  No code was written.
- **Inputs:**
  - the Flourish evaluation harness as a reference. It is actually a Next.js app, with browser-side orchestration, JSONB-blob runs, a single unvalidated judge and no run comparison. Its good ideas were kept: correlation ids, a config snapshot per run, a multi-dimension rubric, prompt history, per-case cost and latency.
  - DocuMind's existing retrieval-only eval (hybrid hit@5 1.000, MRR 0.944).
- **Next:** Phase E1 (DocuMind eval hooks). Resolve the canary-org/join-page question before E8.

### 2026-10-18 — Hero explainer video (not deployed)
- Built: an 18 s seamless-loop motion graphic (a ball travels upload → indexing → pipeline → question → cited answer → PDF page, then the camera pulls out) made with the `explainer-engaging` skill (Barty-Bart/motion-graphics). Source and renderer are in `video/` (`src/explainer.html` → `node build.mjs` inlines the brand fonts; `node render.mjs documind-explainer.html out.mp4 60 4 4`). The landing hero (`components/marketing/hero-video.tsx`) plays `web/public/documind-explainer.mp4` (1280×720, silent, ~2 MB) with a poster; autoplay, muted, loop; reduced motion pauses it on the poster.
- Deviation: the hero is now headline + CTAs on top and the video full-width below (the old right-hand column made the UI text in the video unreadable at ~550 px). `hero-visual.tsx` is no longer used on the landing page.
- Gotchas: after editing `video/src/explainer.html`, re-render and re-encode both the mp4 and the poster (`ffmpeg -ss 14.5 … -frames:v 1`; the 60 fps blurred render takes ~1 min). A version with sound is in `video/draft.mp4` (git-ignored, not on the page).

### 2026-10-18 — Analytics charts
- Built: the five breakdown tables on the analytics dashboards (by operation, model and tier, top users, by agent, most cited documents) are now ranked horizontal bar charts (`components/analytics/ranked-bar-chart.tsx`). Operations and models rank by cost, users and agents by answers, documents by citations; the other columns moved into tooltips.
- Gotchas / learnings: per-user quota limits are edited in Admin › Users › row menu › "Edit monthly quota"; the global defaults are only env/config (`default_message_quota`, `default_token_quota`).
### 2026-10-18 — Post-phase change: monthly quotas, bookmarks, personal analytics (not deployed)
- **Built (`api/`):** migration `0002_quotas_bookmarks` (`user_quotas`, `quota_usage`, `messages.bookmarked_at` + partial index; schema from `SCHEMA`, not the autogenerated `documind_dev`), models `quota.py`, `services/quota.py`, `services/my_analytics.py`, routers `quota.py` / `my_analytics.py` and bookmark routes in `conversations.py`, `MessageOut.bookmarked_at`, `llm/usage.py` adds tokens to the counter, `prepare_turn` enforces. `tests/test_quota_bookmarks.py` (9 tests; one per-file ruff F811 ignore because it imports fixtures from `test_chat_stream`).
- **Built (`web/`):** bookmark button + highlight in `assistant-message.tsx`, `/bookmarks` page, `/my-analytics` page (`my-analytics-dashboard.tsx`, `my-analytics-charts.tsx`; `analytics-charts.tsx` now exports its helpers), `quota-meter.tsx`, blocked state in `composer.tsx`, quota in `load-chat.ts`/`chat-app.tsx`, admin `quota-dialog.tsx` + column + actions, sidebar entries (Bookmarks, My analytics), `bookmark_added` Umami event.
- **Verified:** `ruff`, `pnpm typecheck`, `pnpm lint`, `pnpm build` pass. API tests: the 9 new ones pass (4.5 min). Headless Chromium on `next dev` + live uvicorn against the dev DB with throwaway `test-e2e-*` users (removed afterwards, including their `llm_usage` rows): a `?message=` deep link scrolls to and rings the answer; bookmarking works and the bookmarks list links back to it; my-analytics shows conversations/messages/tokens/likes/dislikes/response time; the admin dialog changes a user's limits and the row refreshes; the composer blocks with an explanation at the limit and unblocks when the admin raises it; the BFF refuses a send with 429 `quota_exceeded`. No real OpenAI chat was run (chat rows were inserted directly; the fake-OpenAI API tests cover metering).
- **Deviations / choices to review:** platform admins are exempt from quotas; quota is per account, not per org; defaults are env-only. See *Decisions made (post-phase…)*.
- **Gotchas / learnings:** `loadEnvConfig(dir)` without `dev=true` reads `.env.production.local` (the prod DB URL). A scratch script that forgot the flag tried to reach the prod DB and timed out; always pass `true` in throwaway scripts (`migrate-auth.ts` relies on the prod behaviour on purpose). `llm_usage` has no FKs, so deleting a test user leaves its usage rows behind. The dev server logs a `crypto.getRandomValues()` prerender warning for `/chat/[conversationId]` (not caused by this change; `next build` passes).
- **Next:** run the migration on prod (the api container does it on start via `alembic upgrade head`), try one real chat in a browser, then `/ship`.

### 2026-10-18 — Post-phase change: self-service org joining (not deployed)
- **Why:** new users hit a 404 until an admin added them to an org. Now any signed-in user can join any number of organizations themselves.
- **Built:** `/app/join` (list of all orgs with Join buttons; `join/actions.ts` → `joinOrganization` calls `auth.api.addMember` as role `member`, marks a matching pending invitation `accepted`). `/app` redirects non-admins with no orgs and no invitations to `/app/join`; the org switcher shows "Join another organization" for non-admins. `join` added to `RESERVED_SLUGS`.
- **Gotcha:** this is open enrollment by design: any signed-in (email-verified) user can read every org's documents once joined. Not yet tested in a browser; typecheck + lint pass.

### 2026-10-18 — Post-phase change: per-part retrieval for multi-part questions (not deployed)
- **Why:** a six-question message (IT, Compliance, Facilities, Procurement, Finance, HR) routed only 3 departments (`MAX_DEPARTMENTS`) and 3 sub-queries, and one shared top-8 ranking let one topic crowd out the others. The answer then covered only the gift question.
- **Built:**
  - Router: `sub_queries: [str]` became `parts: [{query, departments, jurisdiction}]`, up to `MAX_PARTS = 6`, each part with up to 3 departments. A part without a country inherits the message's. Fewer than 2 parts means a single question. Top-level `departments` is the union of the parts' departments, and there's no clarifying question for multi-part messages. `Route.sub_queries` is now derived and still stored and streamed; the `routing` event adds `parts`.
  - Retrieval: `retrieve(org_id, parts: [RetrievalPart], …)` searches each part under its own filters, fuses, boosts and ranks it on its own, then interleaves the parts round-robin (`interleave`). `source_limits` gives multi-part questions ≥ 2 sources and 1,500 tokens per part (cap 16 sources / 12,000 tokens); single questions are unchanged. `RankedList`/`Fused`/source scores carry `part`. The cross-product of all queries × all filters is gone.
  - Answer prompt lists the parts and asks for one labelled answer per part.
  - `search_filters` moved from `services/chat.py` to `agents/router.py`; `Route.retrieval_parts(vectors, document_ids)` builds the parts (chat and eval share it).
- **Verified:** ruff; pytest 150/151 (the miss is `test_document_lifecycle`, because Docker Desktop and local MinIO weren't running; it doesn't touch retrieval); a new chat-stream test for a two-part question. Eval is unchanged for single questions: hybrid hit@5 1.000, MRR 0.944 (`eval/results/2026-10-18.md`). Live smoke of the six-question message: all 6 departments routed, PK only on the leave part, 12 sources (2 per part, interleaved).
- **Gotchas / learnings:** `eval.run_eval` crashes on its last `print` (a `→`) under the cp1252 console, after the report is written; run it with `PYTHONIOENCODING=utf-8`.
- **Next:** try the six-question message in the browser (the dog-in-the-office part got §1.2/§4.7 of SIM-FAC-001; check that the pets rule is among them), then `/ship`.

### 2026-10-08 — Phase 9 (code complete; deploy + live checks pending)
- **Built (`web/`):** `lib/analytics.ts` (`UMAMI` config gate + typed `track()`), `components/analytics/umami.tsx` (`next/script` afterInteractive with `data-website-id` + `data-domains`, mounted once in `app/layout.tsx`), `components/analytics/signup-tracker.tsx`. Events wired in `verify-email-form`, `google-button` (`newUserCallbackURL`), `contact-form`, `chat-app` (send + open source), `assistant-message` (feedback), `upload-dialog`; landing CTAs in `(marketing)/page.tsx`. Privacy page Umami text widened (see Decisions). README rewritten as the final version: architecture, analytics events, env var reference (names only), known limitations.
- **Verified locally:** `tsc --noEmit`, `pnpm lint`, `pnpm build` pass. `next start` on :3100: `/`, `/privacy`, `/contact` and `/sign-up` all carry the website ID (on PPR pages it sits in the RSC payload; the HTML shell has the script preload). Headless Chromium with `/api/send` intercepted (nothing reached the real Umami): on `localhost`, the script loads and sends **0** events. With `documind.zeeshanai.cloud` mapped to :3100, it sends page views, `cta_get_started {location: hero}` and `sign_up_completed {method: google}`, the `?signup` flag is stripped (`next` kept), and there are no console errors. `script.js` returns 200 `application/javascript`. The web Dockerfile already passes both vars as build args.
- **Not verified yet:** the live tag, real ingestion into Umami and the remaining events on prod (they need the deploy and a signed-in browser); see *Pending user actions → Phase 9*. `pnpm dev` wasn't started, but `UMAMI` is null whenever `NODE_ENV !== "production"`.
- **Deviations from plan:** `sign_up_completed` carries `method`; CTAs carry `location`; `data-domains` is hard-coded to the prod host rather than an env var.
- **Gotchas / learnings:** the Coolify deploy token (`COOLIFY_API_TOKEN`) can't read env vars ("Missing required permissions: read"); reading them needs the root token. Umami's data lives in its own `umami` database on the shared `postgres-pgvector` container (not `coolify-db`). Disk 48% (46G/96G).
- **Next:** owner `/ship` → check the live page and Umami realtime/events → mark Phases 8 and 9 Done once the Phase 8 browser chat check also passes.

### 2026-10-08 — Phase 8 (in progress: prod seeded, chat verified at the API hop)
- **Owner done:** prod sign-up with the admin email (the OTP email arrived); Google sign-in; org **Simtora Technologies** (`simtora`); the n8n test message was deleted. In prod DB there is one user: `role=admin`, `owner` of `simtora` (admin bootstrap works).
- **Seeded:** the PDFs were `scp`'d to the VPS, then `docker cp`'d to `/app/seed` (chowned to 10001); ran `uv run python -m scripts.seed_policies --org-slug simtora --dir /app/seed --wait`. 14/14 are `ready`, 1,162 chunks, all 14 jobs `succeeded`, and doc types match dev (6 `country_supplement`s including UK, 2 `global_supplement`s). One job was picked up by the API's own worker (SKIP LOCKED), so the script's summary showed it still `processing`; it finished seconds later.
- **Verified (API hop, through Traefik):** `POST https://api.documind.zeeshanai.cloud/v1/orgs/…/chat` streams the events in order (meta 0.5 s → routing → sources → deltas → citations → usage → done). **Traefik does gzip `text/event-stream`** (`content-encoding: gzip`), against the earlier assumption, but it flushes on every write: ~700 deltas arrived at ~270 distinct times over 4 s, the same as with `Accept-Encoding: identity`. `GET …/documents/{id}/file` returns a 951 KB `%PDF` from prod MinIO. Citations carry `document_id` + `page_start`.
- **Not verified yet:** the browser → web Traefik → Next BFF hop (it needs a browser session; the BFF sets `no-transform` on SSE). See *Pending user actions* 7.
- **Test data:** the check created 3 conversations in the admin's history ("How many days of annual leave…", 2× "Explain in detail how leave works…"); they can be deleted from the chat sidebar.
- **Disk:** 48% (46G/96G).

### 2026-10-07 — Phase 8 (in progress: deployed, owner-dependent smoke tests pending)
- **Deployed:** Better Auth tables created in prod `documind`; secrets `COOLIFY_BASE_URL`/`COOLIFY_API_TOKEN` set; pushed `a90ca59` → workflow checked and deployed both apps. The api came up first try (alembic `0001_initial` ran on start). The web deploy failed twice:
  1. `COPY /app/public: not found`: `web/public` is empty, so git doesn't track it → `mkdir -p public` before `pnpm build` (`9b9c832`).
  2. Coolify's healthcheck (`localhost` → `::1`, image has no curl, `wget` refused) → `health_check_host=127.0.0.1`, redeployed via the API.
- **Smoke tests passed:** api `/health` 200 (db ok) + `/v1/me` 401 without key, Let's Encrypt certs on both hosts; web `/`, `/contact`, `/privacy`, `/sign-in`, `/sign-up`, `/robots.txt`, `/sitemap.xml`, `/opengraph-image` 200, `/app` 307, BFF unauth 401; canonical + sitemap use the prod domain (build-time env correct); contact submit → n8n `{"success":true}`; web container → `http://documind-api:8000/health` ok; MinIO 9000/9001 closed from outside, no domain; the web-only push (`9b9c832`) skipped `check-api`/`deploy-api` and redeployed only web.
- **Still to verify (needs a prod account):** sign-up OTP, Google sign-in, admin bootstrap, seeded docs reaching Ready, chat SSE unbuffered through Traefik (gzip middleware is on; Traefik should skip `text/event-stream`), citations opening PDFs from prod MinIO.
- **Disk:** 63% (60G/96G) after both builds (55% before the phase).

### 2026-10-07 — Phase 8 (earlier the same day: infra provisioned, not deployed)
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

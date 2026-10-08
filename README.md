# DocuMind

**Turn company documents into an intelligent assistant.**

DocuMind is a multi-organization RAG app:
- A platform admin creates organizations, uploads policy PDFs and adds members.
- Members chat with all of an organization's documents, or with selected ones.
- Answers come with citations that open the PDF at the cited page.

Live at https://documind.zeeshanai.cloud.

## Architecture
```
Browser ──► Next.js (web/)  ── BFF /api/backend/* ──►  FastAPI (api/)  ──►  Postgres 17 + pgvector
              │ Better Auth sessions                     │ X-API-Key + X-User-Id   (schema per app)
              │ Server Actions for mutations             ├──► MinIO (private PDF storage)
              │ marketing site, contact → n8n            ├──► OpenAI Responses API + embeddings
              └ Umami tracker (production only)          └ ingestion worker (DB job queue)
```
- **The browser only talks to Next.js.** The BFF checks the Better Auth session, then calls FastAPI with the service key and the user id; SSE answers and PDFs stream through unbuffered.
- **FastAPI authorizes everything:** a platform admin can reach every org, anyone else needs a `member` row.
- **Ingestion** runs in a background worker inside the API: parse (pdfplumber) → LLM metadata → section-aware chunks with a contextual header → embeddings → BM25 terms.
- **Retrieval is hybrid:** Okapi BM25 implemented in SQL plus pgvector HNSW, fused with weighted RRF and a jurisdiction boost. An orchestrator routes each question to department specialists (skipped when the user scopes the chat to specific documents), then one streamed call writes the cited answer.
- **Every OpenAI call is metered** (tokens, tier, latency, cost from `model-pricing.json`) and feeds the org and platform analytics dashboards. Orgs choose standard or flex service tiers; flex falls back to standard.

## Stack
| Layer | Tech |
|---|---|
| Web (`web/`) | Next.js 16 App Router, TypeScript, Tailwind v4, shadcn/ui, Better Auth (email OTP, Google, organizations, admin), Resend |
| API (`api/`) | FastAPI, Python 3.12, SQLAlchemy 2 async, Alembic, SSE |
| Data | Postgres 17 + pgvector, MinIO (S3) |
| LLM | OpenAI Responses API (`gpt-6-luna`), `text-embedding-3-small` |
| Other | Upstash Redis (rate limits), n8n (contact form), Umami (web analytics) |
| Hosting | Coolify on a Hostinger VPS |

## Local setup
Prerequisites: Node 24 with pnpm, Python 3.12 with [uv](https://docs.astral.sh/uv/), and Docker.

1. **Environment.** Copy `.env.example` to `.env.local` in the repo root and fill it in (see [Environment variables](#environment-variables)). Both apps read this one file.
2. **Object storage.** Start local MinIO. It also creates the private `documind-docs` bucket.
   ```bash
   docker compose -f docker-compose.dev.yml up -d   # API :9000, console :9001
   ```
3. **Web.** Creates the Postgres schema and Better Auth's tables, then serves http://localhost:3000.
   ```bash
   cd web && pnpm install
   pnpm db:schema && pnpm auth:migrate   # once, and again after auth plugin changes
   pnpm dev
   ```
   Emails listed in `PLATFORM_ADMIN_EMAILS` become platform admins on sign-up (or on their next sign-in).
4. **API.** Creates the app tables (after step 3, which creates the Better Auth tables they reference), then serves http://localhost:8000/docs.
   ```bash
   cd api && uv sync
   uv run alembic upgrade head   # once, and again after pulling new migrations
   uv run uvicorn app.main:app --reload --port 8000
   ```
   Every `/v1` route needs the `X-API-Key` header (`DOCUMIND_API_KEY`); most also need `X-User-Id`.
5. **Seed documents (optional).** Create an org with slug `simtora` in the web app, then load the 14 sample policies:
   ```bash
   cd api && uv run python -m scripts.seed_policies --org-slug simtora --wait
   ```
6. **Use the app.** With both servers running, open http://localhost:3000/app/simtora/chat and ask a question. Answers stream in with citation chips; clicking one opens the PDF at the cited page with the passage highlighted. Platform admins also get Documents (upload, edit metadata, reindex), Members, Settings (model and service tier) and Analytics, plus `/admin` for every organization.
   - Chat is limited to 30 questions a minute per user when `UPSTASH_REDIS_REST_URL`/`_TOKEN` are set (no limit otherwise).
   - The API itself: `POST /v1/orgs/{org_id}/chat` streams Server-Sent Events (routing, sources, text, citations, usage); the [API README](api/README.md#chat) has a `curl` example.
7. **Public site.** http://localhost:3000 is the marketing site: the landing page, `/contact` and `/privacy`.
   - The contact form posts to the n8n webhook in `N8N_CONTACT_WEBHOOK_URL`, authenticated with `N8N_API_KEY` in an `x-api-key` header.
   - It works without JavaScript, drops honeypot submissions silently, and allows 5 messages per 10 minutes per IP when Upstash is configured.

To measure retrieval quality (BM25 vs vector vs hybrid) on the golden questions:
```bash
cd api && uv run python -m eval.run_eval --org-slug simtora   # writes eval/results/<date>.md
```

Checks: `cd web && pnpm typecheck && pnpm lint && pnpm build` and `cd api && uv run pytest && uv run ruff check .` (stop `next dev` before `pnpm typecheck`, and any local uvicorn before `pytest`).

## Analytics
- **Product analytics** (tokens, cost, latency, feedback, top documents) live in the app: `/app/<org>/analytics` and `/admin/analytics`.
- **Web analytics** use the self-hosted, cookieless [Umami](https://umami.is) at `analytics.zeeshanai.cloud`. The tracker ([`components/analytics/umami.tsx`](web/src/components/analytics/umami.tsx)) loads only in production builds with both `NEXT_PUBLIC_UMAMI_*` set, and only reports on `documind.zeeshanai.cloud` (`data-domains`), so `pnpm dev` and local `next start` send nothing.
- **Custom events** go through `track()` in [`lib/analytics.ts`](web/src/lib/analytics.ts). Payloads carry categories and counts only, never PII or message text:

  | Event | Data |
  |---|---|
  | `sign_up_completed` | `method`: `email` (OTP verified) or `google` (first Google sign-in) |
  | `contact_submitted` | none |
  | `chat_message_sent` | `scoped` |
  | `citation_opened` | `doc_type` |
  | `document_uploaded` | `count` |
  | `feedback_given` | `value`: `up` / `down` |
  | `cta_get_started`, `cta_contact` | `location`: `hero` / `band` (landing CTAs, via `data-umami-event`) |

## Deployment
Production runs on Coolify: `documind-web` (https://documind.zeeshanai.cloud), `documind-api` (https://api.documind.zeeshanai.cloud, `X-API-Key` gated) and a private MinIO service reachable only on Coolify's internal network.
- Images: [`api/Dockerfile`](api/Dockerfile) and [`web/Dockerfile`](web/Dockerfile), both built from the repo root (`docker build -f api/Dockerfile .`). The api applies `alembic upgrade head` on start.
- A push to `main` runs [`deploy.yml`](.github/workflows/deploy.yml): it lints and typechecks what changed, then redeploys only that app through the Coolify API (repo secrets `COOLIFY_BASE_URL`, `COOLIFY_API_TOKEN`).
- Web vars marked *build* below are inlined by `next build`: set them as build-time variables in Coolify and redeploy after any change.
- Seed PDFs aren't baked into the api image: `docker cp` them into the container and run `seed_policies --dir`.
- The VPS runs a weekly Docker prune; check `df -h /` before a deploy.

## Environment variables
One root `.env.local` serves both apps; [`.env.example`](.env.example) lists every key. Never prefix `DOCUMIND_API_KEY` or `API_BASE_URL` with `NEXT_PUBLIC_`.

| Variable | Used by | Notes |
|---|---|---|
| `DATABASE_URL` | web, api | Prisma-style params; `schema=` sets the Postgres schema (`documind_dev` locally, `documind` in prod) |
| `DOCUMIND_API_KEY` | web, api | Service key for the BFF → API hop |
| `API_BASE_URL` | web | FastAPI base URL (internal `http://documind-api:8000` in prod) |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | web | |
| `NEXT_PUBLIC_APP_URL` | web (build) | Canonical URL, sitemap, OG images |
| `PLATFORM_ADMIN_EMAILS` | web | Comma-separated; these accounts get `role=admin` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | web | Google sign-in |
| `RESEND_API_KEY` | web | OTP and invitation emails |
| `RESEND_FROM_EMAIL` | web (build) | Baked into the static auth pages |
| `N8N_CONTACT_WEBHOOK_URL`, `N8N_API_KEY` | web | Contact form |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | web | Rate limits (fail open when unset) |
| `NEXT_PUBLIC_UMAMI_SCRIPT_URL`, `NEXT_PUBLIC_UMAMI_WEBSITE_ID` | web (build) | Umami tracker |
| `OPENAI_API_KEY` | api | |
| `OPENAI_CHAT_MODEL`, `OPENAI_ROUTER_MODEL`, `OPENAI_EMBEDDING_MODEL`, `OPENAI_EMBEDDING_DIM` | api | Defaults; orgs can override chat/router models in Settings |
| `OPENAI_CHAT_SERVICE_TIER`, `OPENAI_BACKGROUND_SERVICE_TIER` | api | `standard`, `flex` or `auto` |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_FORCE_PATH_STYLE` | api | MinIO |
| `PRICING_FILE`, `MAX_UPLOAD_MB`, `INGEST_CONCURRENCY` | api | Optional; sensible defaults |
| `COOLIFY_BASE_URL`, `COOLIFY_API_TOKEN` | ops | Deploy API (also GitHub repo secrets) |

## Known limitations
- PDF uploads only (no Word, HTML or scanned-image OCR).
- One service API key: anyone holding it can call the API as any user, so it must stay server-side.
- Platform admins can't read members' conversations; analytics are aggregate only.
- Organization deletion and account deletion on request are manual today.
- The privacy policy (`/privacy`) still needs a legal review.

## Project docs
- [`docs/plan/`](docs/plan/): the phase-by-phase implementation plan.
- [`Status.md`](Status.md): progress, decisions and the session log.
- [`PRODUCT.md`](PRODUCT.md) and [`DESIGN.md`](DESIGN.md): who the product is for, and the visual system.
- [`docs/policies/`](docs/policies/): seed policy PDFs for the fictional company "Simtora Technologies".

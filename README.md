# DocuMind

**Turn company documents into an intelligent assistant.**

DocuMind is a multi-organization RAG app:
- A platform admin creates organizations, uploads policy PDFs and adds members.
- Members chat with all of an organization's documents, or with selected ones.
- Answers come with citations that open the PDF at the cited page.

Retrieval is hybrid: Okapi BM25 implemented in SQL plus pgvector HNSW, fused with RRF. An orchestrator routes each question to department specialists.

## Stack
| Layer | Tech |
|---|---|
| Web (`web/`) | Next.js 16 App Router, TypeScript, Tailwind v4, shadcn/ui, Better Auth |
| API (`api/`) | FastAPI, Python 3.12, SQLAlchemy 2 async, Alembic, SSE |
| Data | Postgres 17 + pgvector, MinIO (S3) |
| LLM | OpenAI Responses API (`gpt-6-luna`), `text-embedding-3-small` |
| Hosting | Coolify on a Hostinger VPS |

## Local setup
Prerequisites: Node 24 with pnpm, Python 3.12 with [uv](https://docs.astral.sh/uv/), and Docker.

1. **Environment.** Copy `.env.example` to `.env.local` in the repo root and fill it in. Both apps read this one file.
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
   The API runs a background worker that ingests uploaded PDFs (parse → metadata → chunk → embed → index).
5. **Seed documents (optional).** Create an org with slug `simtora` in the web app, then load the 14 sample policies:
   ```bash
   cd api && uv run python -m scripts.seed_policies --org-slug simtora --wait
   ```
6. **Use the app.** With both servers running (the web app loads all its data from the API), open http://localhost:3000/app/simtora/chat and ask a question. Answers stream in with citation chips; clicking one opens the PDF at the cited page with the passage highlighted. Platform admins also get Documents (upload, edit metadata, reindex), Members, Settings (model and service tier) and Analytics, plus `/admin` for every organization.
   - The browser only talks to Next.js; `/api/backend/*` forwards to FastAPI with the service key.
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

## Deployment
Production runs on Coolify: `documind-web` (https://documind.zeeshanai.cloud), `documind-api` (https://api.documind.zeeshanai.cloud, `X-API-Key` gated) and a private MinIO service reachable only on Coolify's internal network.
- Images: [`api/Dockerfile`](api/Dockerfile) and [`web/Dockerfile`](web/Dockerfile), both built from the repo root (`docker build -f api/Dockerfile .`). The api applies `alembic upgrade head` on start.
- The web build needs `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_UMAMI_*` and `RESEND_FROM_EMAIL` as build args; every other variable is runtime-only.
- A push to `main` runs [`deploy.yml`](.github/workflows/deploy.yml): it lints and typechecks what changed, then redeploys only that app through the Coolify API (repo secrets `COOLIFY_BASE_URL`, `COOLIFY_API_TOKEN`).

## Project docs
- [`docs/plan/`](docs/plan/): the phase-by-phase implementation plan.
- [`Status.md`](Status.md): current progress and decisions.
- [`PRODUCT.md`](PRODUCT.md) and [`DESIGN.md`](DESIGN.md): who the product is for, and the visual system.
- [`docs/policies/`](docs/policies/): seed policy PDFs for the fictional company "Simtora Technologies".

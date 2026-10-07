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

Checks: `cd web && pnpm typecheck && pnpm lint` and `cd api && uv run pytest && uv run ruff check .`

## Project docs
- [`docs/plan/`](docs/plan/): the phase-by-phase implementation plan.
- [`Status.md`](Status.md): current progress and decisions.
- [`PRODUCT.md`](PRODUCT.md) and [`DESIGN.md`](DESIGN.md): who the product is for, and the visual system.
- [`docs/policies/`](docs/policies/): seed policy PDFs for the fictional company "Simtora Technologies".

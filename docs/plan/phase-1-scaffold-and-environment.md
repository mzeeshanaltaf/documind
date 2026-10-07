# Phase 1 — Scaffold & Environment

**Goal:** Set up a monorepo where both apps boot locally, a single root `.env.local` drives both, MinIO runs locally, and the OpenAI model, service tier and usage fields are verified with a real call.

**Depends on:** nothing. **Unblocks:** every later phase.

## Skills to load
- `/nextjs-best-practices` (scaffold conventions)
- `/fastapi-python` (API skeleton)

## 1. Git & repo hygiene
- **Init git.** `git init -b main`, then `git remote add origin https://github.com/mzeeshanaltaf/documind.git`.
  - The remote is **PUBLIC** and empty.
- **Root `.gitignore`.** It must exist **before any `git add`**:
  ```
  .env
  .env.*
  !.env.example
  node_modules/
  .next/
  out/
  .venv/
  __pycache__/
  *.pyc
  .pytest_cache/
  .ruff_cache/
  .mypy_cache/
  minio-data/
  graphify-out/
  *.log
  .DS_Store
  ```
- **Commits.** Commit and push only when the user asks; the `/ship` skill is available.

## 2. Repo layout to create
```
DocuMind/
  CLAUDE.md  Status.md  README.md  .gitignore  .env.example
  model-pricing.json            # single source of pricing (api reads it)
  docker-compose.dev.yml        # local MinIO
  docs/policies/*.pdf           # seed docs (fictional company "Simtora")
  docs/plan/phase-*.md
  web/                          # Next.js app (Phase 2+)
  api/                          # FastAPI app (Phase 3+)
```

## 3. Environment variables
- **`.env.local` (root, git-ignored) is the single source.** Both apps read it.
  - `web/next.config.ts` calls `loadEnvConfig(path.resolve(__dirname, ".."))` from `@next/env`.
  - `api` uses pydantic-settings with `env_file=("../.env.local", ".env.local")` and `extra="ignore"`.
- **Already present:** DATABASE_URL, OPENAI_API_KEY, N8N_CONTACT_WEBHOOK_URL, N8N_API_KEY, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, RESEND_API_KEY, RESEND_FROM_EMAIL, COOLIFY_API_TOKEN_ROOT, COOLIFY_API_TOKEN, NEXT_PUBLIC_UMAMI_SCRIPT_URL, NEXT_PUBLIC_UMAMI_WEBSITE_ID.
- **Add these with the Edit tool** (never a shell heredoc). Generate secrets with `python -c "import secrets;print(secrets.token_urlsafe(48))"`:
  ```
  BETTER_AUTH_SECRET=<generated>
  BETTER_AUTH_URL=http://localhost:3000
  NEXT_PUBLIC_APP_URL=http://localhost:3000
  API_BASE_URL=http://localhost:8000
  DOCUMIND_API_KEY=<generated>
  PLATFORM_ADMIN_EMAILS=<user's email — confirm with user; comma-separated>
  S3_ENDPOINT=http://localhost:9000
  S3_REGION=us-east-1
  S3_BUCKET=documind-docs
  S3_ACCESS_KEY=documind
  S3_SECRET_KEY=<generated>
  S3_FORCE_PATH_STYLE=true
  OPENAI_CHAT_MODEL=gpt-6-luna
  OPENAI_ROUTER_MODEL=gpt-6-luna
  OPENAI_EMBEDDING_MODEL=text-embedding-3-small
  OPENAI_EMBEDDING_DIM=1536
  OPENAI_CHAT_SERVICE_TIER=standard        # standard | flex | auto
  OPENAI_BACKGROUND_SERVICE_TIER=flex      # used for ingestion classify/summary
  ```
- **Fix `RESEND_FROM_EMAIL`.** Change its display name from "Qanoon" to `DocuMind <noreply@verification.zeeshanai.cloud>`. Keep the address.
- **`.env.example`.** List the same keys with empty values and a one-line comment each. It is committed.
- **DB schema decision.** See Status.md "Open decisions". The recommendation is local dev on `?schema=documind_dev` and prod on `?schema=documind`, because local and prod MinIO differ. Ask the user, then record the answer in Status.md.

## 4. `DATABASE_URL` facts (verified)
- **Format.** `postgresql://…@76.13.7.106:5432/postgresdb?schema=documind&sslmode=require&uselibpqcompat=…&connection_limit=…&pool_timeout=…`. The params are Prisma-style.
- **Normalization.** Both apps need a normalizer that does three things:
  - Reads `schema` and uses it for `search_path`.
  - Keeps `sslmode` (Node `pg` also understands `uselibpqcompat`).
  - **Strips** `schema`, `connection_limit` and `pool_timeout`, because psycopg/asyncpg reject them.
- **Server.** PG 17.7 in a shared DB (`postgresdb`) with one schema per app. The `documind` schema does **not** exist yet; Phase 2 creates it.
- **Extensions.** `vector` 0.8.1 is installed in schema `public`, so `search_path` must be `<schema>,public`. `pgcrypto` is in `public`. `pg_trgm` and `unaccent` are available but not installed. **No `pg_search`/BM25 extension.**
- **Collation warning.** Connections print a "collation version mismatch" WARNING. It is harmless, so ignore it.
- **Role.** The DB role is superuser, so `CREATE SCHEMA` and `CREATE EXTENSION` are allowed.

## 5. Local MinIO — `docker-compose.dev.yml`
- `minio/minio:latest` runs `server /data --console-address ":9001"` on ports 9000/9001, with root user and password taken from `S3_ACCESS_KEY`/`S3_SECRET_KEY` via `env_file: .env.local`, and a named volume.
- A one-shot `minio/mc` service creates the bucket with `mc alias set local http://minio:9000 …` then `mc mb -p local/documind-docs`. The bucket stays **private**, with no anonymous policy.
- Run it with `docker compose -f docker-compose.dev.yml up -d`.

## 6. Scaffold `web/`
- **Create the app.** Run `pnpm create next-app@latest web --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-pnpm --turbopack`. Use the latest stable Next 16.x.
- **Initialise shadcn** with `pnpm dlx shadcn@latest init`; the `/shadcn` skill covers this. Don't add components yet beyond `button`.
- **Edit `next.config.ts`:**
  - Load the root env as described above.
  - Set `output: "standalone"` (needed in Phase 8).
  - Set `serverExternalPackages: ["pg"]`.
- **Placeholder page.** `src/app/page.tsx` renders "DocuMind" as a simple placeholder; the marketing site comes in Phase 7.
- **Package scripts:** `dev`, `build`, `start`, `lint`, and `typecheck` (`tsc --noEmit`).

## 7. Scaffold `api/`
- **Create the project.** Run `uv init api --app --python 3.12`, then `cd api`.
- **Runtime deps:**
  `uv add fastapi "uvicorn[standard]" pydantic-settings "sqlalchemy[asyncio]>=2" asyncpg alembic pgvector openai boto3 sse-starlette python-multipart pdfplumber tiktoken snowballstemmer httpx python-dateutil`
- **Dev deps:** `uv add --dev pytest pytest-asyncio ruff rank-bm25`
- **Package structure.** Create `api/app/` with these subpackages, each with an `__init__.py`:
  `core/ routers/ schemas/ services/ models/ ingestion/ rag/ agents/ llm/`
- **Minimal app.** `app/main.py` builds the FastAPI app with a lifespan and a `GET /health` that returns `{"status":"ok"}`.
- **Config.** In `pyproject.toml`, set ruff line-length 100, target py312, and `[tool.pytest.ini_options] asyncio_mode = "auto"`.
- **Run command:** `uv run uvicorn app.main:app --reload --port 8000` (from `api/`).

## 8. Pricing file
Add an embedding entry to `model-pricing.json`. Keep the existing format; embeddings have no output tokens:
```json
"text-embedding-3-small": { "standard": { "inputPerMillion": 0.02, "cachedInputPerMillion": 0.02, "outputPerMillion": 0 } }
```

## 9. OpenAI smoke test (de-risk now, record results in Status.md)
- **Write a throwaway script** in the scratchpad, not in the repo. It loads `OPENAI_API_KEY` from the root `.env.local`.
- **Call 1:** `client.responses.create(model="gpt-6-luna", input="Say hi", service_tier="flex")`. Print `response.service_tier`, `response.usage` (`input_tokens`, `input_tokens_details.cached_tokens`, `output_tokens`, `output_tokens_details.reasoning_tokens`) and the latency.
- **Call 2:** the same request with `stream=True`. Confirm the event names (`response.output_text.delta`, `response.completed`) and that usage appears on the completed event.
- **Call 3:** a structured output via `text={"format": {"type": "json_schema", "name": "...", "schema": {...}, "strict": True}}`.
- **Call 4:** `client.embeddings.create(model="text-embedding-3-small", input=["a","b"])`. Confirm the dimension is 1536 and read `usage.prompt_tokens`.
- **Record** the actual field names and returned `service_tier` values in Status.md, e.g. whether "default" or "standard" comes back. Phases 4–5 depend on them.

## 10. README.md (root)
Write a short project description: tagline, stack, local setup steps (env, `docker compose`, `pnpm dev`, `uv run uvicorn`), and a pointer to `docs/plan/`.

## Acceptance criteria
- [ ] `git status` shows no `.env.local`; `.env.example` is present.
- [ ] `docker compose -f docker-compose.dev.yml up -d`: the MinIO console opens at :9001 and bucket `documind-docs` exists.
- [ ] `cd web && pnpm dev` serves http://localhost:3000; `pnpm typecheck` and `pnpm lint` pass.
- [ ] `cd api && uv run uvicorn app.main:app --port 8000`: `/health` returns ok and `/docs` loads.
- [ ] The OpenAI smoke test passes for all four calls, with findings in Status.md.
- [ ] Status.md is updated: Phase 1 is Done, the decisions are recorded, and Phase 2 is next.

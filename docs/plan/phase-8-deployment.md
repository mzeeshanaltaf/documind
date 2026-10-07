# Phase 8 — Deployment to Hostinger VPS (Coolify + MinIO)

**Goal:** Run DocuMind in production with this layout:
- **web:** `https://documind.zeeshanai.cloud`.
- **api:** `https://api.documind.zeeshanai.cloud`. It's public but gated by `X-API-Key`.
- **MinIO:** a private service reachable only on Coolify's internal Docker network.
- **TLS:** automatic SSL.
- **Auto-deploy** on push to `main`.

**Depends on:** Phases 1–7. **Unblocks:** Phase 9.

## Skills to load
- `/add-minio-storage-to-coolify`: deploy MinIO as a Coolify service on the shared network, create the private bucket and credentials. Its storage-layer examples are Node; **our storage client is Python boto3** (`api/app/core/storage.py`), so only the env wiring applies.
- `/add-app-to-coolify`: run it **twice**, once for `api` and once for `web`. It covers creating each app from the GitHub repo, build-time vs runtime env, the domain and SSL, DNS, the first deploy, and auto-deploy via GitHub Actions.
- **Global CLAUDE.md, "Hostinger VPS: Docker disk cleanup cron".** Check `df -h /` before building. A weekly prune cron already exists; confirm it's running if disk usage is high.

## Known facts
- **VPS:** IP `76.13.7.106`, hostname `zeeshanai.cloud`, SSH key `~/.ssh/hostinger_vps_ed25519`, running 18+ Coolify apps.
- **Coolify API tokens** are in `.env.local`: `COOLIFY_API_TOKEN_ROOT` to create resources and `COOLIFY_API_TOKEN` to deploy.
  - The Coolify base URL is **not** in env. Find it with the skill (or ask the user) and add `COOLIFY_BASE_URL` to `.env.local`.
- **Repo:** `https://github.com/mzeeshanaltaf/documind` (PUBLIC). Make sure no secrets were ever committed: run `git log -p | grep -iE "sk-|api_key=|secret="` before deploying.
- **Postgres** already runs on the same VPS. The prod `DATABASE_URL` uses `?schema=documind`; check Status.md for the dev/prod schema decision.
  - Containers may keep using the public IP with `sslmode=require` (works today).
  - Alternatively, they can use the DB container's internal hostname if it's on the same Coolify network. Use the internal hostname if the skill recommends it.
- **DNS** for `zeeshanai.cloud`: use the Hostinger DNS MCP tools (`mcp__hostinger-dns__*`, loaded via ToolSearch) to add the A records `documind` → 76.13.7.106 and `api.documind` → 76.13.7.106. Check for existing records first.

## 1. Dockerfiles (build context = repo root)
- **`api/Dockerfile`:**
  - `python:3.12-slim`, with uv copied in from `ghcr.io/astral-sh/uv`. Run `uv sync --frozen --no-dev` from `api/pyproject.toml` and `uv.lock`.
  - Copy `api/` to `/app` and `model-pricing.json` to `/app/model-pricing.json`, and set `ENV PRICING_FILE=/app/model-pricing.json`.
  - Run as a non-root user and expose 8000.
  - `HEALTHCHECK` curls `/health`.
  - `CMD ["sh","-c","uv run alembic upgrade head && uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*'"]`.
  - Use a single uvicorn worker, because the ingestion worker runs in the lifespan. `SKIP LOCKED` keeps multiple replicas safe if it's ever scaled.
- **`web/Dockerfile`:**
  - Multi-stage on `node:24-alpine` with corepack pnpm: `pnpm install --frozen-lockfile`, then `pnpm build` (Next `output: "standalone"`).
  - The runner copies `.next/standalone`, `.next/static` and `public`, then runs `node server.js` on port 3000 as non-root.
  - **Build args** become ENV for the `NEXT_PUBLIC_*` vars: `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_UMAMI_SCRIPT_URL`, `NEXT_PUBLIC_UMAMI_WEBSITE_ID`.
  - `next.config.ts` `loadEnvConfig("..")` must not fail when there is no root env file. That's fine by default; verify it.
- **`.dockerignore`** at the root: `node_modules`, `.next`, `.venv`, `.env*`, `docs/plan`, `**/__pycache__`, `.git`.
- **Test locally first.** Build both images with `docker build -f api/Dockerfile .` and `docker build -f web/Dockerfile .`, run them, and hit `/health`.

## 2. MinIO (via `/add-minio-storage-to-coolify`)
- **Service:** `documind-minio` on the shared Coolify network, with **no public domain or port**.
- **Bucket:** `documind-docs`, private, with a dedicated access key and secret for the app.
- **Env for the api app:** `S3_ENDPOINT=http://<minio-internal-host>:9000`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET=documind-docs`, `S3_REGION=us-east-1`, `S3_FORCE_PATH_STYLE=true`.
- **The api app must join the same network.** The skill covers this.

## 3. Coolify apps (via `/add-app-to-coolify`)
- **`documind-api`:**
  - Dockerfile build pack, base dir `/`, Dockerfile `api/Dockerfile`, port 8000, domain `https://api.documind.zeeshanai.cloud`, health check `/health`.
  - **Runtime env:** DATABASE_URL (prod schema), DOCUMIND_API_KEY (**generate a new prod key**, distinct from dev), OPENAI_API_KEY, OPENAI_CHAT_MODEL, OPENAI_ROUTER_MODEL, OPENAI_EMBEDDING_MODEL, OPENAI_EMBEDDING_DIM, OPENAI_CHAT_SERVICE_TIER, OPENAI_BACKGROUND_SERVICE_TIER, PRICING_FILE, S3_*.
- **`documind-web`:**
  - Dockerfile `web/Dockerfile`, port 3000, domain `https://documind.zeeshanai.cloud`.
  - **Build-time env:** `NEXT_PUBLIC_APP_URL=https://documind.zeeshanai.cloud`, `NEXT_PUBLIC_UMAMI_SCRIPT_URL` and `NEXT_PUBLIC_UMAMI_WEBSITE_ID`. Umami stays gated off until Phase 9 if preferred.
  - **Runtime env:**
    - Auth: `BETTER_AUTH_SECRET` (**new prod secret**), `BETTER_AUTH_URL=https://documind.zeeshanai.cloud`, `PLATFORM_ADMIN_EMAILS`.
    - Data and services: DATABASE_URL, GOOGLE_CLIENT_ID/SECRET, RESEND_API_KEY, RESEND_FROM_EMAIL, UPSTASH_REDIS_REST_URL/TOKEN, N8N_CONTACT_WEBHOOK_URL, N8N_API_KEY.
    - API access: `API_BASE_URL` and `DOCUMIND_API_KEY` (the same prod key as the api).
      - `API_BASE_URL` is `https://api.documind.zeeshanai.cloud`. If both apps share a Docker network, it can instead be the internal URL `http://documind-api:8000` for lower latency and no TLS hop; prefer internal if available.
- **Better Auth.** Add `https://documind.zeeshanai.cloud` to `trustedOrigins`; the code reads it from env. Secure cookies are automatic on https.
- **Proxy timeouts.** Make sure Coolify/Traefik doesn't buffer or time out SSE. Set a long read timeout or the equivalent label if the skill notes one, and check that streaming works through `api.documind…` and the web BFF.

## 4. Database migrations in prod
- **Better Auth tables:**
  - If prod uses the same schema as dev (`documind`), they already exist.
  - If prod uses a fresh schema, run `pnpm dlx @better-auth/cli migrate` locally with `DATABASE_URL` pointed at the prod schema. Do this once and verify the tables.
- **App tables** come from `alembic upgrade head`, which runs on api container start.
- **Seed prod data.** Sign up as admin on prod, create org `simtora`, then run the seed script **inside the api container**: `docker exec -it <api-container> uv run python -m scripts.seed_policies --org-slug simtora --dir /app/seed --wait`. Either copy `docs/policies` into the image under `/app/seed`, behind a build arg, or `docker cp` it in. The PDFs then land in **prod** MinIO.

## 5. Google OAuth (manual step — ask the user)
- **In Google Cloud Console → OAuth client:**
  - Authorized redirect URI: `https://documind.zeeshanai.cloud/api/auth/callback/google`.
  - Authorized JavaScript origin: `https://documind.zeeshanai.cloud`.
- Keep the localhost entries for dev.

## 6. Auto-deploy (GitHub Actions)
- **Workflow.** `.github/workflows/deploy.yml` runs on push to `main`.
  - It uses `dorny/paths-filter` so that `api/**` or `model-pricing.json` triggers the api deploy and `web/**` triggers the web deploy.
  - Each deploy calls the Coolify deploy webhook/API with `Authorization: Bearer ${{ secrets.COOLIFY_API_TOKEN }}`. The skill has the exact endpoint.
- **Repo secrets.** Add `COOLIFY_API_TOKEN` and `COOLIFY_BASE_URL` with `gh secret set`. **Ask the user before setting secrets.**
- **Optional CI job** before deploy: `api` runs `ruff check` and `pytest -m "not db"`; `web` runs `pnpm typecheck`, `pnpm lint` and `pnpm build`.

## 7. Production smoke tests
- [ ] `https://api.documind.zeeshanai.cloud/health` returns 200 over valid TLS.
- [ ] `/v1/me` without the key returns 401.
- [ ] `https://documind.zeeshanai.cloud` loads with valid TLS. The landing, contact and privacy pages work, and a contact submit reaches n8n.
- [ ] Sign-up email OTP arrives; Google sign-in works on prod.
- [ ] The admin bootstrap works on prod, and the seeded docs all reach Ready.
- [ ] Chat streams through prod (SSE not buffered), and citations open the PDF from prod MinIO.
- [ ] MinIO is **not** reachable publicly: check that port 9000/9001 on the VPS IP refuses or times out, and that no domain points at it.
- [ ] A push to `main` that touches `web/` redeploys only web.
- [ ] Record disk usage after deploy (`df -h /`) in Status.md.

## Acceptance criteria
- [ ] Every smoke test passes.
- [ ] Status.md is updated with the prod URLs, Coolify app names/UUIDs, MinIO service name, deploy workflow, and any proxy/SSE settings that were needed. **Never put secrets in Status.md.**

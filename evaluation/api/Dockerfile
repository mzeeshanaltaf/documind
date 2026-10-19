# DocuMind Evaluation API (FastAPI). Build context = repo root:
#   docker build -f evaluation/api/Dockerfile -t documind-eval-api .
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.8 /uv /uvx /bin/

# UV_NO_SYNC: `uv run …` (bootstrap/import scripts via `docker exec`) uses the baked venv as-is.
ENV PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_NO_SYNC=1 \
    PATH="/srv/evaluation/api/.venv/bin:$PATH"

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 app

# The repo layout is kept under /srv: config.py finds the repo root four levels above app/core
# (/srv), and with it the golden set at /srv/api/eval/golden.jsonl for scripts.import_golden.
WORKDIR /srv/evaluation/api

# Dependencies first (cached until the lockfile changes), then the code.
COPY evaluation/api/pyproject.toml evaluation/api/uv.lock evaluation/api/.python-version ./
RUN uv sync --frozen --no-dev --no-install-project

COPY evaluation/api/ ./
COPY api/eval/golden.jsonl /srv/api/eval/golden.jsonl
RUN uv sync --frozen --no-dev && chown -R app:app /srv

# The deployed commit for /health.version: Coolify passes SOURCE_COMMIT when "Include source
# commit in build" is on. Declared last so a new commit doesn't invalidate the layers above.
ARG SOURCE_COMMIT=dev
ENV GIT_SHA=$SOURCE_COMMIT

USER app
EXPOSE 8100

# /health is always 200 while the process serves (db and DocuMind state are in the body).
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8100/health || exit 1

# One process: the worker slots and the sweeper run in the lifespan (SKIP LOCKED keeps a second
# replica safe). `exec` makes uvicorn PID 1 so it gets SIGTERM (graceful job release).
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8100"]

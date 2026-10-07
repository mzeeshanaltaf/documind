# DocuMind API (FastAPI). Build context = repo root:
#   docker build -f api/Dockerfile -t documind-api .
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.8 /uv /uvx /bin/

# UV_NO_SYNC: `uv run …` (e.g. the seed script via `docker exec`) uses the baked venv as-is.
ENV PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_NO_SYNC=1 \
    PATH="/app/.venv/bin:$PATH" \
    PRICING_FILE=/app/model-pricing.json

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 app

WORKDIR /app

# Dependencies first (cached until the lockfile changes), then the code.
COPY api/pyproject.toml api/uv.lock api/.python-version ./
RUN uv sync --frozen --no-dev --no-install-project

COPY api/ ./
COPY model-pricing.json /app/model-pricing.json
RUN uv sync --frozen --no-dev && chown -R app:app /app

USER app
EXPOSE 8000

# /health is always 200 while the process serves (db state is in the body).
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8000/health || exit 1

# One worker: the ingestion worker runs in the lifespan (SKIP LOCKED keeps replicas safe).
# `exec` makes uvicorn PID 1 so it gets SIGTERM on redeploys.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*'"]

# DocuMind API

FastAPI service for DocuMind: ingestion, hybrid retrieval (BM25 + pgvector) and agentic chat.
Reads env from the repo-root `.env.local`. See the root [README](../README.md).

```bash
uv run alembic upgrade head          # app tables in the DATABASE_URL `schema`
uv run uvicorn app.main:app --reload --port 8000
uv run pytest && uv run ruff check .
```

- `GET /health` is public. Every `/v1` route needs `X-API-Key`; most also need `X-User-Id`
  (a Better Auth user id). Swagger at `/docs` has an Authorize button for the key.
- Smoke test: `curl -H "X-API-Key: …" -H "X-User-Id: <user id>" localhost:8000/v1/me`.
- Errors are always `{"error": {"code", "message"}}`; responses carry `X-Request-ID`.

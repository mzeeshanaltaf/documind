# DocuMind API

FastAPI service for DocuMind: ingestion, hybrid retrieval (BM25 + pgvector) and agentic chat.
Reads env from the repo-root `.env.local`. See the root [README](../README.md).

```bash
uv run uvicorn app.main:app --reload --port 8000
uv run pytest && uv run ruff check .
```

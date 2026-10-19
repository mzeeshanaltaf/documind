# DocuMind Evaluation API

FastAPI service behind the eval web (`evaluation/web`, E5). It stores versioned datasets, runs
evaluations as durable Postgres jobs, and calls DocuMind's `/v1` as the `eval-bot` service admin.
Design: `docs/plan/eval/README.md`; working guide: `evaluation/CLAUDE.md`.

```bash
uv sync
uv run alembic upgrade head                                   # schema from EVAL_DATABASE_URL
uv run python -m scripts.bootstrap_service_users --org-slug simtora   # then copy the ids to .env.local
uv run python -m scripts.import_golden                        # needs DocuMind on DOCUMIND_API_URL
uv run uvicorn app.main:app --reload --port 8100
uv run pytest && uv run ruff check .
```

Every `/v1` route needs `X-API-Key: $EVAL_API_KEY` and `X-User-Id` of a DocuMind platform admin.
`GET /health` is public and always 200.

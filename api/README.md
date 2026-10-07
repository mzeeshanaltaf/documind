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
- Errors are always `{"error": {"code", "message"[, "details"]}}`; responses carry `X-Request-ID`.

## Ingestion
- `POST /v1/orgs/{org_id}/documents` (multipart `files[]`, platform admin) stores each PDF in
  MinIO and queues an `ingestion_jobs` row. The worker started in the lifespan
  (`INGEST_CONCURRENCY` loops) runs download → parse → metadata → chunk → embed → index;
  poll `GET …/documents/{id}/job` for `stage`/`progress`.
- Seed the policy PDFs (skips duplicates; `--wait` processes the jobs inline):
  `uv run python -m scripts.seed_policies --org-slug simtora --wait`

## Chat
`POST /v1/orgs/{org_id}/chat` with `{message, conversation_id?, document_ids?}` streams
Server-Sent Events: `meta` → `routing` → `sources` → `delta`… → `citations` → `usage` → `done`
(or `error`).

```bash
curl -N -X POST localhost:8000/v1/orgs/<org id>/chat -H "X-API-Key: …" -H "X-User-Id: …" \
  -H "Content-Type: application/json" -d '{"message":"How much PTO do employees in Germany get?"}'
```

1. **Router** (`agents/router.py`): one structured call picks 1–3 departments and a jurisdiction
   from the org catalog, rewrites follow-ups into a standalone query and splits multi-part
   questions. With `document_ids` it only rewrites (and only when there is history).
2. **Retrieval** (`rag/`): BM25 in SQL + pgvector per (query × department), fused with RRF, a
   jurisdiction boost, adjacent-chunk de-dup and a ~6,000-token budget (`top_k` per org).
3. **Answer** (`agents/answer.py`): one streamed call with specialist personas and numbered
   sources; `[n]` markers become citations (`agents/citations.py`).

Every OpenAI call writes an `llm_usage` row (`router`, `embed_query`, `answer`, `title`). A client
disconnect saves the partial answer as `status='stopped'`. Also: conversations
(`/v1/orgs/{org_id}/conversations`, `/v1/conversations/{id}`, owner-only), feedback
(`POST /v1/messages/{id}/feedback`), settings (`GET/PUT /v1/orgs/{org_id}/settings`, admin),
analytics (`GET /v1/analytics`, `GET /v1/admin/orgs`, admin).

## Retrieval eval
`uv run python -m eval.run_eval --org-slug simtora` routes each question in `eval/golden.jsonl`,
runs BM25-only, vector-only and hybrid retrieval, and writes hit@5/hit@8/MRR plus routing
accuracy to `eval/results/<date>.md`.

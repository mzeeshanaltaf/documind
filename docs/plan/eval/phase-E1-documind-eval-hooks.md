# Phase E1 — DocuMind Eval Hooks

**Goal:** Add small, admin-only hooks to DocuMind's `api/`. With them the harness can:
- tag its requests, so cost is attributable per run and per case;
- override the retrieval and model config per request, for A/B experiments;
- see every retrieved context with text and scores;
- run retrieval without generating an answer;
- read a document's chunks (for E7).

Eval traffic must be **invisible** to users: no conversation-list entries, no analytics, no quota, no titles. Normal chat behaviour must not change at all.

**Depends on:** nothing (DocuMind Phases 1–5). **Unblocks:** E2.

## Skills to load
- `/fastapi-python`

## Known facts
- **`X-Request-ID`** must match `^[A-Za-z0-9._-]{1,128}$` (`app/core/log.py`); colons are rejected. The harness sends `eval.<run8>.<case_key>.<attempt>`.
- **`llm_usage.operation`** has no CHECK constraint; `conversations` and `messages` do (CLAUDE.md › Phase 3).
- **DocuMind's BFF** (`web/src/app/api/backend/[...path]/route.ts`) forwards only `content-type`/`accept`, so a browser can't inject eval headers. Add a comment there saying so.
- **`get_actor`'s header param is `user_id`.** New routes must not name a path or query param `user_id`; see Status.md › quotas.

## 1. Migration — `api/alembic/versions/0003_eval_hooks.py`
- Follow `0002_quotas_bookmarks.py`: the schema comes from `get_settings().db_schema`, and constraint names use `op.f()`.
- **`conversations`:**
  - `is_eval boolean NOT NULL DEFAULT false`
  - `eval_run_id text NULL`
  - `eval_case_id text NULL`
  - partial index `ix_conversations_eval_run_id (eval_run_id) WHERE eval_run_id IS NOT NULL`
- **`llm_usage`:**
  - `eval_run_id text NULL`
  - `eval_case_id text NULL`
  - partial index `(eval_run_id, created_at) WHERE eval_run_id IS NOT NULL`
- Update `app/models/chat.py` and `app/models/usage.py`, then run `alembic check`.

## 2. Eval context — `api/app/core/eval.py`
- `@dataclass(frozen=True) EvalContext(run_id: str, case_id: str | None)`.
- `get_eval_context(actor: ActorDep, x_eval_run_id: Header, x_eval_case_id: Header) -> EvalContext | None`:
  - no headers → `None`;
  - a value that doesn't match `^[A-Za-z0-9_-]{1,100}$` → 422 `invalid_eval_header`;
  - headers present but the actor isn't a platform admin → 403 `eval_forbidden`.
- `EvalDep = Annotated[EvalContext | None, Depends(get_eval_context)]`.

## 3. Metering & quota — `api/app/llm/usage.py`, `api/app/services/chat.py`
- **`UsageCtx`** gains `eval_run_id: str | None = None` and `eval_case_id: str | None = None`. `record_usage` writes them and **skips `quota.add_tokens`** when `eval_run_id` is set.
- **`prepare_turn(..., eval_ctx)`:**
  - for eval turns, skip `quota.enforce` and `quota.record_message`;
  - a new eval conversation gets `is_eval=true`, `eval_run_id`, `eval_case_id` and `title=f"[eval] {case_id}"`;
  - continuing a conversation requires `conversation.is_eval == (eval_ctx is not None)`, otherwise 404.
- **`run_chat`** skips `schedule_title` for eval turns, and every `UsageCtx` it builds carries the eval tags.

## 4. Per-request overrides — `api/app/schemas/chat.py`
- **`ChatOverrides(extra="forbid")`:**
  - `top_k: int | None (1..30)`
  - `retrieval_mode: Literal["bm25","vector","hybrid"] | None`
  - `chat_model`, `router_model`: validated against the pricing models, as settings do
  - `chat_service_tier: Literal["standard","flex","auto"] | None`
  - `include_source_text: bool = True`
- **`ChatRequest.overrides: ChatOverrides | None = None`.**
- **`prepare_turn`:**
  - raises 403 `overrides_require_eval` unless `eval_ctx` is set;
  - applies the overrides as `dataclasses.replace(settings, …)`.
- **`ChatTurn`** gains `eval`, `retrieval_mode` and `include_source_text`; `run_chat` passes `mode=turn.retrieval_mode` to `retrieve()`.

## 5. Eval-mode SSE (only when `turn.eval` is set)
| Event | What eval mode sends |
|---|---|
| `routing` | `route.as_dict()` plus `document_ids`. A superset that adds `needs_clarification`, `clarifying_question` and each part's `query`. |
| `sources` | `[s.as_dict() for s in sources]`: chunk id, `text`, `section_path`, `content_type`, `department`, `owner`, `scores{bm25_rank, vector_rank, rrf, score, part}`. Only when `include_source_text`. |
| `usage` | adds `by_operation: [{operation, model, tier_requested, tier_actual, input_tokens, cached_tokens, output_tokens, cost_usd, latency_ms, ttft_ms}]` and `retrieval: retrieval.summary()` |

Non-eval payloads stay byte-identical; a test asserts this.

## 6. Eval router — `api/app/routers/eval.py` + `api/app/services/eval.py`
All routes are admin-only and registered in `routers/v1.py`.

| Route | Behaviour |
|---|---|
| `POST /v1/orgs/{org_id}/retrieve` | **Body:** `{query 1..4000, history?: [{role, content}] ≤ 6, document_ids?, modes: [Mode] 1..3 unique (default ["hybrid"]), top_k?, router_model?, chat_service_tier?}`. **Behaviour:** routes once (or `rewrite_only` when scoped), embeds once, then runs `retrieve()` per mode, the same pattern as `eval/run_eval.py::evaluate_one`. **Returns:** `{routing, queries, results: {mode: {sources, retrieval}}, usage{…, by_operation}, timings_ms}`. No conversation and no quota; usage rows are tagged when `EvalDep` is set. |
| `GET /v1/orgs/{org_id}/documents/{document_id}/chunks?offset&limit≤500` | `{document{id, doc_code, title, department, jurisdiction, doc_type, owner, page_count}, total, chunks[{id, chunk_index, text, section_path, section_number, section_title, page_start, page_end, content_type, token_count}]}` |
| `GET /v1/admin/eval/info` | `{version, defaults, chat_models, prompt_hashes{router, rewrite, answer_rules, specialists, title}` (sha256 of the prompt constants)`, retrieval{RRF_K, METHOD_WEIGHTS, boosts, DEFAULT_TOP_K, TOKEN_BUDGET, SOURCES_PER_PART, MAX_SOURCES, MAX_TOKEN_BUDGET}, pricing_sha256}` |
| `GET /v1/admin/eval-runs/{run_id}/usage` | totals, `by_operation` and `by_case[{eval_case_id, calls, input, cached, output, cost_usd}]` from `llm_usage` |
| `DELETE /v1/admin/eval-runs/{run_id}/conversations` | deletes the `is_eval AND eval_run_id = :run` conversations (messages cascade) and returns `{deleted}` |

## 7. Exclusions (eval traffic hidden everywhere)
| File | Change |
|---|---|
| `services/analytics.py` | `USAGE_SCOPE` gets `AND u.eval_run_id IS NULL`; `MESSAGE_SCOPE` gets `AND NOT c.is_eval`. In `ADMIN_ORGS_SQL`, the conversation count excludes eval conversations and the cost excludes eval usage. |
| `services/my_analytics.py` | `MESSAGES_CTE` and the conversations query get `AND NOT c.is_eval`; `USAGE_SCOPE` gets `AND u.eval_run_id IS NULL`. |
| `services/conversations.py` | `list_conversations` filters `Conversation.is_eval.is_(False)`; `BOOKMARKS_SQL` gets `AND NOT c.is_eval`. |

## 8. Version
- `/health` returns `version` from env `GIT_SHA` (default `"dev"`).
- `api/Dockerfile`: `ARG SOURCE_COMMIT` → `ENV GIT_SHA=$SOURCE_COMMIT`.
- Enable "Include source commit in build" on `documind-api` in Coolify. If the variable doesn't arrive, pass it as a build arg from the workflow.

## 9. Tests — `api/tests/test_eval_hooks.py` (real dev DB, OpenAI monkeypatched as in `test_chat_stream.py`)
- **Eval chat:** the conversation is `is_eval`; it's absent from the conversation list, bookmarks, admin analytics, my-analytics and the admin-orgs count; `quota_usage` is unchanged; the `llm_usage` rows carry the eval ids; no `title` row is written.
- **Authorization:** overrides without eval headers → 403; eval headers as a non-admin → 403; bad header characters → 422.
- **Overrides:** `retrieval_mode=bm25` changes the sources; `top_k=3` gives at most 3 sources.
- **SSE payloads:** the eval `sources` event has `text`; the non-eval payload is unchanged.
- **`/retrieve`:** three modes make one router call and one embed call.
- **Chunks endpoint:** a member gets 403.
- **Cleanup endpoint:** deletes only that run's conversations.

## Acceptance criteria
- [ ] `uv run alembic upgrade head` and `uv run alembic check` are clean on `documind_dev`.
- [ ] A `curl -N` eval chat streams `sources` with `text`, and `routing` with `needs_clarification`.
- [ ] After 3 eval chats as the admin, the conversation list, analytics and quota show no change, and `llm_usage` rows are tagged.
- [ ] `/retrieve` with `modes=[bm25,vector,hybrid]` gives the same ranks as `run_eval` for 5 golden questions.
- [ ] `uv run pytest tests/test_eval_hooks.py` and `uv run ruff check .` pass.
- [ ] `PYTHONIOENCODING=utf-8 uv run python -m eval.run_eval --org-slug simtora` is unchanged (hybrid hit@5 1.000, MRR 0.944).
- [ ] Deployed to `documind-api` (the migration runs on start); `/health` shows a version.
- [ ] Status.md › Evaluation harness is updated.

# Phase E3 — Run Engine & Deterministic Metrics

**Goal:** Run an evaluation from start to finish on the server. A run:
- snapshots its full config;
- calls DocuMind once per case, in full mode or retrieval-only mode;
- stores every retrieved context;
- computes the deterministic metrics (retrieval, routing, citations, operational, leakage);
- aggregates them with confidence intervals and slices;
- streams live progress;
- supports pause, resume and stop, survives restarts, and exports CSV/JSON.

**Depends on:** E2. **Unblocks:** E4.

## Skills to load
- `/fastapi-python`

## 1. Run creation — `services/runs.py`, `routers/runs.py`
**`POST /v1/runs`** takes:

| Field | Values |
|---|---|
| `dataset_version_id` | published versions only |
| `org_slug` | |
| `mode` | `full` or `retrieval_only` |
| `overrides` | `top_k`, `retrieval_mode`, `chat_model`, `router_model`, `chat_service_tier` |
| `retrieval_modes` | for retrieval-only; default all three |
| `metrics` | enabled keys and thresholds |
| `judge` | E4 |
| `name`, `tags`, `max_judge_cost_usd` | |
| `cleanup_conversations` | default true |

**Steps:**
1. Resolve the org id with `me()`. Fetch the org's documents once and store them (doc id set and code → id map) in the snapshot; the leakage check needs them.
2. Resolve each case's `scope_doc_codes` to `document_ids`. A missing code makes that case `skipped`, with a reason.
3. Build the **snapshot**:
   - DocuMind `/health.version` and `/admin/eval/info`;
   - the org's effective settings;
   - the dataset version and its `content_hash`;
   - eval `GIT_SHA`;
   - the `judge-pricing.json` sha (from E4).
4. Compute `config_hash` = sha256 of the canonical config.
5. Insert the `run_cases` rows (`correlation_id = eval:<runId>:<case_key>`) and enqueue one `case_generate` job per case.

**Other routes:**
- `GET /v1/runs` (filters: dataset, org, status, tag), `GET /v1/runs/{id}`, `DELETE /v1/runs/{id}` (also cleans DocuMind).
- `GET /v1/runs/{id}/cases?status&type&passed&metric&lt=` and `GET /v1/runs/{id}/cases/{run_case_id}` (full drill-down).

## 2. Handlers — `worker/handlers/case_generate.py`, `run_finalize.py`
**`case_generate`** (runs under `DocuMindLimiter`):
1. Set `status='generating'`. Headers: `X-Eval-Run-Id=<run uuid>`, `X-Eval-Case-Id=<run_case uuid>`, `X-Request-ID=eval.<run8>.<case_key>.<attempt>`.
2. **Retrieval-only:** `POST /retrieve` with `modes`; store `retrieved_contexts` per mode.
3. **Full:**
   - send each `setup_turns` message first (keep the `conversation_id`; the answers go into the trace);
   - then send the scored turn with `overrides` and `document_ids`;
   - collect `routing`, `sources` (with text), the delta text, `citations` and `usage` (`by_operation`, retrieval summary).
4. Persist the answer, routing, citations, `needs_clarification`, latency, TTFT, tokens and DocuMind cost, and the trace (every non-delta event plus timings).
5. Compute the deterministic metrics (§3) into `metric_scores`.
6. If any judge metric is enabled, set `generated` and enqueue `case_judge` (E4). Otherwise set `done` and count it.

**Recovery (chat isn't idempotent):** on a retry with a stored `conversation_id`, first `GET /v1/conversations/{id}`.
- If the assistant message is `complete`, rebuild from it.
- Otherwise delete that conversation and start over.

**Errors:** a 4xx other than 429 is permanent; the case goes to `error` with `error_stage` and the run continues. A 429, a 5xx or a timeout gets a backoff retry.

**`run_finalize`:**
1. Compute aggregates (§4).
2. Reconcile DocuMind cost with `/admin/eval-runs/{id}/usage` and store both numbers.
3. If `cleanup_conversations`, call `DELETE /admin/eval-runs/{id}/conversations`.
4. Set the status: `completed`, `stopped` (partial) or `failed`.

**Counting:** atomically, `UPDATE runs SET done_cases = done_cases + 1 … RETURNING done_cases + failed_cases >= total_cases`. When true, enqueue `run_finalize`; the unique partial index makes duplicates impossible.

## 3. Deterministic metrics — `app/metrics/`
- **`registry.py`:** `MetricSpec(key, group, scale, direction, default_threshold, applies_to(case), requires_judge, gating, compute)`. Each metric is a pure function `(case, run_case, contexts) -> MetricResult(value, status, details)`.
- **`retrieval.py`:**
  - `hit@5`, `hit@k`, `mrr`, `recall_doc@k`, `recall_section@k`, `precision@k`, `ndcg@k`;
  - `routing_hit`, `routing_jaccard`, `jurisdiction_acc`, `jurisdiction_false_pos`.
  - The relevance label is the same as `api/eval/run_eval.py::is_hit`. Port it and cite the source.
- **`citations.py`:**
  - `citation_validity` on the raw answer text: `\[(\d+)\]` markers whose n is among the sources / all markers;
  - `cited_section_hit`, `cited_doc_precision`, `page_hit`.
- **`operational.py`:** latency, TTFT, tokens and cost per case; error rate at run level.
- **`safety.py`:** `leakage`, which is 1 if:
  - any source `document_id` isn't in the org's document set; or
  - any `forbidden_doc_codes` code, or any `injection_canary`/canary phrase, appears in the answer, sources or citations.

  `fingerprints.txt` is a short list of distinctive phrases from DocuMind's `ANSWER_RULES`, used by E8's `injection_resisted`.
- **Gates:** `passed` = every gating metric that applies passes. Thresholds come from the run config.

## 4. Aggregates — `app/stats/`, `services/aggregates.py`
- **`bootstrap.py`:** percentile bootstrap, B=2000, `numpy.random.default_rng(seed)` with `seed = hash(run_id, metric)`.
- **`intervals.py`:** Wilson 95% interval for binary metrics (the bootstrap degenerates to [1, 1] at 1.0).
- **`aggregates.py`:** for every metric × mode × slice, store n, mean, CI, `ci_method` and `pass_rate` in `run_aggregates`; for latency and TTFT, also p50/p95.
  - Slices: `all`, `type:*`, `dept:*`, `juris:*`, `tag:*`, `difficulty:*`, `source:*`.
  - NA, error and refusal statuses are excluded from the mean, and their counts are reported.

## 5. Controls
| Route | Behaviour |
|---|---|
| `POST /v1/runs/{id}/pause` | `pausing`: the claim skips the run; once no job is running, it becomes `paused`. |
| `POST /v1/runs/{id}/resume` | back to `running` |
| `POST /v1/runs/{id}/stop` | `stopping`: queued jobs are cancelled, in-flight jobs finish, then finalize runs with `partial=true` and status `stopped`. |

Invalid transitions get 409. A restart mid-run resumes it through lock reclaim (E2).

## 6. Progress — `GET /v1/runs/{id}/events`
- sse-starlette with a 15 s ping, polling the DB once per second.
- A `run` event carries status, counters and cost. `case` events carry `run_cases` with `updated_at > cursor` (limit 50 per tick).
- The event id is the cursor, and `Last-Event-ID` is honoured. The stream closes on a terminal status.

## 7. Export — `GET /v1/runs/{id}/export?format=csv|json`
- **CSV:** one row per case, with the case fields, status, passed, each metric's value, latency and cost.
- **JSON:** the run plus snapshot, cases, metric details and contexts.

## 8. Tests
- **Unit (pure, < 10 s):**
  - every retrieval metric on hand-computed fixtures, including nDCG with duplicates, MRR with no hit, and empty sources;
  - citation validity with an invalid `[9]`;
  - leakage on a foreign doc id;
  - Wilson against known values;
  - bootstrap determinism under a seed.
- **db-marked with respx-mocked DocuMind** (recorded SSE fixtures):
  - a 5-case full run completes;
  - one case returns 422 → `error`, and the run still completes;
  - pause then resume;
  - stop → partial;
  - a retry recovers an existing conversation;
  - finalize is enqueued exactly once under concurrent completions.

## Acceptance criteria
- [ ] A retrieval-only run of `golden` v1 against local DocuMind reproduces `api/eval/results/2026-10-18.md` within ±1 case (hybrid hit@5 1.000, MRR ≈ 0.944; bm25 hit@5 0.967).
- [ ] A full run completes with latency, TTFT, cost, citation validity and leakage per case. The stored DocuMind cost matches `/admin/eval-runs/{id}/usage` within 1%.
- [ ] Pause, then kill and restart the API process, then resume: the run finishes with no duplicate DocuMind conversations.
- [ ] Stop produces `partial=true`, with aggregates over the finished cases.
- [ ] The DocuMind eval conversations are deleted at finalize.
- [ ] `curl -N` on `/runs/{id}/events` shows case events as they finish.
- [ ] ruff and pytest pass. Status.md is updated.

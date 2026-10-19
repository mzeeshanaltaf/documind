# Phase E7 — Synthetic Test Sets & Reference Enrichment

**Goal:**
- Grow the test set beyond the 30 hand-written questions by generating candidates from the indexed PDFs. The case types are single-hop, multi-hop, jurisdiction, comparative, unanswerable and out-of-scope.
- Validate each candidate automatically, and have a human approve, edit or reject it before it enters a dataset.
- Enrich `golden` with reference answers and key facts, so the reference-based metrics come alive.

**Depends on:** E6. **Unblocks:** E8.

## Skills to load
- `/claude-api`
- `/impeccable`
- `/fastapi-python`

## 1. Migration — `alembic/versions/0002_synthetic.py`
| Table | Columns |
|---|---|
| `synthetic_batches` | `org_id`, `org_slug`, `target_dataset_id`, `kind` (synthetic, enrichment), `config` jsonb (doc ids, type counts, generator model, seed), `status`, `prompt_version_ids`, `cost_usd`, `candidate_count`, `created_by` |
| `synthetic_candidates` | `batch_id`, `type`, `status` (pending, approved, rejected), `question`, `setup_turns`, `reference_answer`, `key_facts`, `expected_doc_codes`, `expected_sections`, `expected_pages`, `expected_jurisdiction`, `expected_behavior`, `source_chunk_ids`, `source_excerpt` jsonb, `rationale`, `checks` jsonb, `edited`, `target_case_key` (enrichment), `reviewer_id`, `reviewed_at`, `case_id` |

## 2. Chunk sampling — `services/synthetic.py`
- **Source:** chunks come from DocuMind's E1 endpoint `GET /orgs/{id}/documents/{doc}/chunks`.
- **Eligibility:** skip `content_type ∈ {revision_history, glossary}` and chunks under 80 tokens.
- **Stratification:** across documents and departments, proportional to each document's chunk count, with at least 1 per selected document. The seed is stored so a batch can be reproduced.
- **Seeds per type:**

  | Type | Seed |
  |---|---|
  | single-hop | one chunk |
  | multi-hop | two chunks from different sections of the same document, or across documents through doc-code references in the text |
  | jurisdiction | a base HR chunk (SIM-HR-001) paired with a country-supplement chunk (SIM-HR-101..105) that has a matching section title |
  | comparative | the same topic in two country supplements |
  | unanswerable | a policy-adjacent topic the catalog doesn't cover. Validated by a DocuMind `/retrieve` plus Haiku confirming "the contexts don't answer this". |
  | out-of-scope | not about company policy at all |

## 3. Generation — `worker/handlers/synthetic_generate.py`, prompts `gen.*`
- **One job per candidate,** Opus 5.5 at effort high, prompts `gen.single_hop`, `gen.multi_hop`, `gen.jurisdiction`, `gen.comparative`, `gen.unanswerable`, `gen.out_of_scope`.
- **Output:** `{question, reference_answer, key_facts[{fact, weight}], expected_doc_codes, expected_sections, expected_pages, expected_jurisdiction, expected_behavior, rationale}`.
- **Prompt rules:**
  - write questions the way an employee would ask them (paraphrased, not copied);
  - the question must be self-contained;
  - the answer must come only from the given chunks;
  - expected sections must use the `CODE §n` format taken from the chunk metadata.
- **Validation (`gen.validate`, Sonnet, medium):** `{answerable_from_sources, self_contained, ambiguity, issues, keep}`.
- **Deterministic checks:**
  - lexical overlap between question and chunk (a high value flags copy-paste);
  - dedupe: token Jaccard ≥ 0.7 against the target dataset and the batch;
  - every expected section exists in the chunk metadata.
- **Storage:** results go into `checks`. A candidate that fails a hard check is auto-`rejected` with the reason; the human can still restore it.
- **Metering and limits:** all calls are metered in `judge_calls` (purpose `synthetic`) with the batch cost, and a cost cap applies per batch.

## 4. Enrichment — `gen.enrich_reference`
- **Batch `kind=enrichment`:** for each case of a dataset version, fetch the chunks of its expected sections, then generate `reference_answer` and `key_facts` as candidates with `target_case_key`.
- **Commit:** approved candidates update those cases in a **new draft version**. Published versions are never mutated.

## 5. API and review UI
- **Routes:**
  - `POST|GET /v1/synthetic-batches`, `GET /v1/synthetic-batches/{id}`, `GET …/candidates?status&type`;
  - `PATCH /v1/candidates/{id}` (an edit sets `edited=true`), `POST /v1/candidates/{id}/approve|reject`;
  - `POST /v1/synthetic-batches/{id}/commit {dataset_id}`: approved candidates go into a new draft version (new `case_key`s `syn-<batch8>-NNN`, `source='synthetic'`).
- **Pages:**
  - `/synthetic`: batch list.
  - `/synthetic/new`: org, document multi-select, type counts, generator model, seed, and the estimated cost (≈ $0.07 per candidate).
  - `/synthetic/[batchId]`: a review queue, one candidate at a time:
    - the source excerpt with the answer span in highlighter yellow;
    - the checks as chips;
    - inline editing;
    - keyboard shortcuts **a** approve, **e** edit, **r** reject, **j/k** next/previous;
    - a progress counter and a commit button.

## 6. Tests
- **Unit:** stratified sampling is deterministic under a seed; the dedupe threshold; the overlap check; the section-existence check; commit creates a draft and leaves the published version untouched.
- **Fake Anthropic:** generation and validation flows, and auto-reject.

## Acceptance criteria
- [ ] A 40-candidate batch across all six types on `simtora` gives at least 70% that pass validation and at least 60% approved by the owner. The cost is shown per batch.
- [ ] `golden` v2 (enriched) has a reference answer and key facts on all 30 cases.
- [ ] A full run on v2 fills `correctness`, `key_fact_recall` and `context_recall`.
- [ ] A dataset `synthetic-v1` (≥ 60 approved cases) is published and runs end to end.
- [ ] Status.md records the approval rates and a few of the rejection reasons.

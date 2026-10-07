# Phase 4 — Document Ingestion (parse → metadata → chunk → embed → index)

**Goal:** An admin uploads a PDF and it goes through a durable background pipeline. The pipeline extracts rich document- and chunk-level metadata, makes heading-aware chunks, embeds them and writes both the pgvector and BM25 indexes. The phase also builds the OpenAI wrapper and cost metering that Phase 5 reuses. Finally, all 14 PDFs in `docs/policies/` are seeded into the `simtora` org.

**Depends on:** Phase 3. **Unblocks:** Phase 5.

## Skills to load
- `/fastapi-python`

## 1. LLM layer (`api/app/llm/`), built here and reused by Phase 5
- **`pricing.py`.** Loads `model-pricing.json` once.
  - **Tier mapping.** A tier name maps to its pricing key: the API values `"default"` and `"standard"` map to `standard`, and `"flex"` maps to `flex`.
  - **Formula.** `cost(model, tier, input, cached, output) = ((input - cached)*inputPerMillion + cached*cachedInputPerMillion + output*outputPerMillion) / 1e6`.
  - **Fallback.** An unknown model or tier is priced at `standard` with `estimated=True`; an unknown model is priced at 0 with `estimated=True`.
  - Use `Decimal`.
- **`client.py`.** A single `AsyncOpenAI` client.
  - **Tier mapping for requests.** Settings tier `standard` maps to API `default`; `flex` maps to `flex`; `auto` maps to `auto`.
    - Confirm the accepted and returned values against the Phase 1 smoke-test notes in Status.md.
  - **`async def respond(...)`.** Signature: `(*, model, input, instructions=None, text_format=None, tier, operation, ctx: UsageCtx) -> (response, usage_row)`.
    - It measures latency, reads usage (`input_tokens`, `input_tokens_details.cached_tokens`, `output_tokens`, `output_tokens_details.reasoning_tokens`) and `response.service_tier`, then records an `llm_usage` row.
  - **`async def embed(texts, *, operation, ctx)`.** Batches of ≤ 100 inputs. Records `prompt_tokens` as `input_tokens`, priced with the embedding model.
  - **Flex handling.** Use a timeout of 600s for flex calls. On a 429 or "resource unavailable", retry once with jitter, then **fall back to `default`**. Log the fallback in the usage row: `service_tier_requested=flex`, `actual=default`.
  - **Errors.** Write a usage row with `status='error'` and re-raise.
- **`usage.py`.** `UsageCtx(org_id, user_id=None, conversation_id=None, message_id=None, document_id=None)`, and `record_usage(...)`, which inserts into `llm_usage` in its own short session so it never breaks the caller's transaction.
- **Tests (`tests/test_pricing.py`):**
  - gpt-6-luna standard: 1,000,000 input with 200,000 cached and 100,000 output → `0.8*0.1 + 0.2*0.01 + 0.1*0.5 = 0.132`.
  - flex halves it.
  - An unknown tier is flagged as estimated.

## 2. Parsing — `api/app/ingestion/parser.py` (pdfplumber)
- **Output.** `ParsedDocument(pages: int, header: dict, title_lines: list[str], blocks: list[Block])`, where `Block(kind: heading|paragraph|list|table, level: int|None, text: str, page: int)`.
- **Per page:**
  - Call `page.extract_words(extra_attrs=["size", "fontname"], keep_blank_chars=False, use_text_flow=True)`, then group words into lines by `top`.
  - **Body font size** is the mode of line sizes across the doc.
  - **Heading levels**, from size relative to body (sizes are compared after rounding):
    - largest size → level 1 (doc title / "Part N – …")
    - next → level 2 (e.g. `3.1 Open Door…`)
    - next, or bold at body size on a short line without a trailing period → level 3 (e.g. "Steps", "Mediation").
    - Calibrate on `HR-Policy-Manual.pdf` pages 30–31.
  - **Tables.** `page.find_tables()`. Words inside table bboxes are excluded from prose. Each table becomes one `table` block rendered as Markdown (header row from the first row, cells whitespace-normalized).
  - **Drop** footer lines matching `^Page \d+ of \d+$` and rule-only lines.
  - **Lists.** Lines starting with `•`, `-`, `\d+\.` or `\([a-z]\)` become list items, merged into a `list` block.
  - **Paragraphs.** Merge consecutive body lines, de-hyphenating where a line ends in `-` and the next starts lowercase.
- **Header table** (`header.py`). On page 1, find the first table whose first column contains "Document ID". Map the normalized keys:
  - `Document ID` → `doc_code`
  - `Version` → `version`
  - `Owner` → `owner`
  - `Approved by` → `approved_by`
  - `Effective date` → `effective_date`. Parse the first "Month D, YYYY" with dateutil, keeping the raw text if parsing fails.
  - `Review cycle` → `review_cycle`
  - `Applies to` → `applies_to`
  - `Related manuals` → `related_doc_codes`, by regex `\b[A-Z]{2,5}-[A-Z]{2,5}-\d{2,4}\b`, deduplicated and excluding its own code.
- **Title and entity.** Page-1 level-1 lines before the table:
  - Two lines: the first is `legal_entity`, the second is `title`.
  - One line containing ` – `: split it into entity and title (e.g. Company Overview).
  - Otherwise, the title comes from the LLM step.
- **Outline.** The list of level-1 and level-2 headings with their page, stored as `documents.outline` (`[{number, title, page, level}]`). It's used by the UI and the router catalog.
- **Generic PDFs** (no header table) still parse. Their metadata comes from the LLM in step 3.

## 3. Document metadata — `api/app/ingestion/metadata.py`
- **Department and jurisdiction.** One `respond()` call on the **background tier**, with strict json_schema output: `{department, jurisdiction, doc_type, title?, legal_entity?, summary}`.
  - **Input:** filename, header dict, title lines, outline, and the first ~1,500 tokens of text.
  - **Allowed values:**
    - `department`: HR, IT, Finance, Procurement, Facilities, Compliance, Corporate, International, Legal, Operations, Other.
    - `jurisdiction`: ISO-3166 alpha-2 (US, PK, DE, FR, AU, GB) or `GLOBAL`. Use `GB`, not `UK`; the UI displays "United Kingdom".
    - `doc_type`: policy_manual, country_supplement, global_supplement, overview, procedure, other.
  - **`summary`:** 2–3 sentences on what the document covers and who it applies to.
- **Precedence.** Deterministic header values win over LLM values for fields both provide. The admin can edit everything later (Phase 6).
- **Expected results for the seed set** (assert these in a test that uses a fixture JSON of LLM output, or check them manually):

| File | doc_code | dept | juris | doc_type |
|---|---|---|---|---|
| HR-Policy-Manual | SIM-HR-001 | HR | US | policy_manual |
| HR-Global-People-Supplement | SIM-HR-002 | HR | GLOBAL | global_supplement |
| HR-Pakistan-Manual | SIM-HR-101 | HR | PK | country_supplement |
| HR-Germany-Manual | SIM-HR-102 | HR | DE | country_supplement |
| HR-France-Manual | SIM-HR-103 | HR | FR | country_supplement |
| HR-Australia-Manual | SIM-HR-104 | HR | AU | country_supplement |
| HR-United-Kingdom-Manual | SIM-HR-105 | HR | GB | country_supplement |
| International-Operations-Supplement | SIM-GLB-001 | International | GLOBAL | global_supplement |
| IT-Policy-Manual | SIM-IT-001 | IT | US/GLOBAL | policy_manual |
| Finance-and-Accounting-Manual | SIM-FIN-001 | Finance | US/GLOBAL | policy_manual |
| Procurement-Policy-Manual | SIM-PRC-001 | Procurement | US/GLOBAL | policy_manual |
| Code-of-Ethics-and-Compliance-Manual | SIM-CMP-001 | Compliance | GLOBAL | policy_manual |
| Facilities-and-Office-Administration-Manual | SIM-FAC-001 | Facilities | US/GLOBAL | policy_manual |
| Company-Overview | SIM-OVR-001 | Corporate | GLOBAL | overview |

  Read each manual's "Applies to" before asserting the US vs GLOBAL cells.

## 4. Chunking — `api/app/ingestion/chunker.py`
- **Tokens** are counted with `tiktoken.get_encoding("o200k_base")`.
- **Section tracking.** Walk the blocks with a heading stack to build `section_path`, e.g. `["Part 3 – Dealing with Employee Concerns", "3.1 Open Door and Grievance Procedure", "Steps"]`.
  - `section_number` is the nearest `^\d+(\.\d+)*` or `^[A-Z]\.` (appendix) prefix in the path.
  - `section_title` is that heading's text without the number.
- **Boundaries:**
  - Never merge across a change of `section_number`.
  - Level-3 subheadings within one numbered section may be merged together.
  - Target is **600 tokens**, with a hard max of 800.
  - When a section exceeds the max, split at block boundaries (then at sentences), carrying the last ~90 tokens (15%) into the next chunk as overlap.
- **Tables.** A table of ≤ 800 tokens is one chunk (`content_type=table`) whose text is prefixed by its nearest heading. Larger tables are split by rows with the header row repeated, with neighbours marked via `chunk_index` adjacency.
- **`content_type`:**
  - `table` or `list` if the chunk is mostly that block kind;
  - `appendix` if the path contains Appendix/Appendices;
  - `glossary` or `revision_history` by heading text;
  - `prose` otherwise.
- **Pages.** `page_start` and `page_end` are the min and max pages of the contributing blocks.
- **`cross_refs`.** Doc codes matching the regex above, plus in-text section refs (`\((\d+\.\d+)\)` and `(?:section|§)\s*(\d+\.\d+)`).
- **`embed_text`** puts the contextual header first, then the chunk text:
  `[{doc_code} · {title} v{version} · {jurisdiction} · {department} | {" › ".join(section_path)}]\n{text}`
  - This header is also BM25-indexed, so codes and section names are searchable.
  - `text` (without the header) is what's displayed and highlighted.

## 5. BM25 tokenizer — `api/app/rag/tokenizer.py` (shared with Phase 5)
- **Normalize.** Lowercase and NFKC.
- **Tokens.** Match with regex `[a-z0-9]+(?:[.\-/][a-z0-9]+)*`. For compound tokens like `sim-hr-102`, `3.1` or `w-2`, emit the compound token **and** its alphanumeric parts.
- **Filter.** Drop English stopwords (keep an embedded ~150-word list in the module) and single characters except digits.
- **Stem** alphabetic tokens with `snowballstemmer.stemmer("english")`. Leave numeric and compound tokens unstemmed.
- **API.** `tokenize(text) -> list[str]` and `term_freqs(text) -> Counter`.
- **BM25 length.** `bm25_len = sum(tf)` over `embed_text`.

## 6. Indexing — `api/app/ingestion/indexer.py`
- **Embed.** Embed every `embed_text` (operation `embed_ingest`, with `document_id` in the context).
- **Single transaction:**
  1. Delete the document's existing chunks (re-index case); `chunk_terms` cascade.
  2. Insert the chunks, with the denormalized dept, juris and doc_type.
  3. Bulk-insert `chunk_terms`. Use `asyncpg` `copy_records_to_table` via `await session.connection()` → `get_raw_connection()` for speed.
  4. Upsert `bm25_stats` for the org: `INSERT … SELECT count(*), coalesce(avg(bm25_len),0) FROM chunks WHERE org_id=:org ON CONFLICT (org_id) DO UPDATE …`.
  5. Update the document: status `ready`, `indexed_at`, `page_count`, metadata and outline.
- **Stats on delete.** The same `bm25_stats` refresh runs after a document is deleted.

## 7. Worker — `api/app/ingestion/worker.py`
- **Start.** Launched from the FastAPI lifespan as `asyncio.create_task(worker.run())` (`ingest_concurrency` loops). It polls every 2s.
- **Claim a job:**
  ```sql
  UPDATE ingestion_jobs SET status='running', locked_at=now(), started_at=coalesce(started_at, now()), attempts=attempts+1
  WHERE id = (SELECT id FROM ingestion_jobs
              WHERE status='queued' OR (status='running' AND locked_at < now() - interval '15 minutes')
              ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
  RETURNING *;
  ```
- **Stages** update `stage` and `progress` as they go: `downloading`(5) → `parsing`(20) → `metadata`(35) → `chunking`(50) → `embedding`(60–90) → `indexing`(95) → done(100).
- **Status updates.** The document's status is set to `processing`, then to `ready` or `failed`.
- **Failure.** Store `error` (first 2,000 chars). If `attempts < 3`, set the status back to `queued`; otherwise mark it `failed`.
- **Safe to restart.** A stale `running` lock is reclaimed after 15 minutes.

## 8. Documents API — `api/app/routers/documents.py` (all under `/v1/orgs/{org_id}`)
| Method & path | Who | Notes |
|---|---|---|
| `POST /documents` (multipart `files[]`) | admin | Accepts PDFs only: check the `%PDF-` magic bytes and size ≤ `max_upload_mb`. Hash with sha256 while streaming to a temp file. A duplicate returns 409 with the existing id. Upload to MinIO, insert `documents` + `ingestion_jobs`, and return 202 with the list. |
| `GET /documents` | member | Filters: `status`, `department`, `q` (title/code ilike). Includes the latest job's stage and progress. |
| `GET /documents/{id}` | member | Includes outline, summary and chunk count. |
| `PATCH /documents/{id}` | admin | Edits metadata fields. Updates the chunks' denormalized columns. Returns `needs_reindex=true` if a field used in `embed_text` changed. |
| `POST /documents/{id}/reindex` | admin | Enqueues a job. |
| `DELETE /documents/{id}` | admin | Deletes the DB rows (cascade), the MinIO object, and refreshes `bm25_stats`. |
| `GET /documents/{id}/file` | member | `StreamingResponse` from MinIO with `application/pdf`, `Content-Disposition: inline; filename=…` and `Cache-Control: private, max-age=300`. |
| `GET /documents/{id}/job` | member | Latest job status, for polling. |

Business logic lives in `api/app/services/documents.py`, so the router stays thin and the seed script can reuse it.

## 9. Seed script — `api/scripts/seed_policies.py`
- **Run:** `uv run python -m scripts.seed_policies --org-slug simtora [--dir ../docs/policies] [--wait]`.
- **Org lookup.** It finds the org id by slug in `organization`. The org is created in the UI in Phase 2; if it's missing, the script fails with a clear message.
- **Ingest.** For each PDF it calls the same service used by `POST /documents` (skipping sha256 duplicates). With `--wait`, it processes the jobs inline instead of relying on the server worker.
- **Output.** A summary table: file, doc_code, dept, juris, chunks, status.

## 10. Tests
- **`test_header_parser.py`.** For all 14 PDFs, `doc_code`, `version` and `effective_date` are parsed, and `related_doc_codes` is non-empty. Use the table in section 3.
- **`test_parser.py`.** On `HR-Policy-Manual.pdf`:
  - There's a level-2 heading "3.1 Open Door and Grievance Procedure" on page 30.
  - The grievance table (Stage / What happens / Typical timescale) is a `table` block on page 31.
  - The text "Page 30 of 78" appears in no block.
- **`test_chunker.py`:**
  - No chunk spans two `section_number`s.
  - `token_count` ≤ 800.
  - The chunk containing "Open Door" has `section_number == "3.1"` and `page_start == 30`.
  - `embed_text` starts with `[SIM-HR-001`.
- **`test_tokenizer.py`.** `"SIM-HR-102 §3.1 employees' leave"` contains `sim-hr-102`, `sim`, `hr`, `102`, `3.1`, `employe` and `leav`.

## Acceptance criteria
- [ ] Every test passes.
- [ ] The seed script ingests all 14 PDFs into `simtora` and every one reaches `ready`, with sensible chunk counts (spot-check a few `chunks` rows: section_path, pages and content_type).
- [ ] `bm25_stats` has a row for the org, and `chunk_terms` is populated.
- [ ] `llm_usage` has `classify`, `summarize` and `embed_ingest` rows with tokens and cost. The classify/summarize rows show the flex tier requested and the actual tier.
- [ ] `GET /documents/{id}/file` streams a PDF that opens.
- [ ] Re-uploading the same PDF returns 409. Reindex works. Delete removes the MinIO object and the chunks.
- [ ] Status.md is updated, including the chunk-count summary and any parser heuristics that needed tuning.

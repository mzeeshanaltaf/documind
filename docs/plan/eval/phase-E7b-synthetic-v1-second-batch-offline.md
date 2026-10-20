# Phase E7b — Synthetic v1, second batch (offline, answered by Claude Code)

**Goal:** Grow `synthetic-v1` past the **60-case acceptance target** (it has 39 published cases in v1) by generating a second batch of **60 candidates** with **no Anthropic API spend**. Claude Code answers the generation and validation prompts through the offline task queue (`EVAL_JUDGE_MODE=offline`). The owner reviews and commits the batch on dev, it is published as `synthetic-v1` **v2**, and v2 is promoted to prod with `export_dataset` → `import_dataset`.

**Depends on:** E7 (batches, review queue), the offline mode from 2026-10-20 (`scripts/offline_tasks.py`), and the dataset export/import scripts. **Unblocks:** E9 (a larger approved set to review and calibrate against). It is an extension of E7, not a new numbered phase.

## Why offline
The Anthropic account hit its spend limit (access back **2026-11-01**), and an API batch of 60 costs about $4.2. Offline mode reuses the same prompts, schemas, checks and review queue, and the first two batches already ran this way at $0.

## Skills to load
- `/fastapi-python` (only if the scripts or schemas are touched)

## Starting state (verify first)
| Item | Expected |
|---|---|
| Dataset `synthetic-v1` (dev and prod) | v1 published, **39 cases**: 12 single_hop, 8 multi_hop, 8 jurisdiction, 4 comparative, 4 out_of_scope, 3 unanswerable. Content hash `672ba0ab…` |
| Dataset `golden` | v2 published (35 cases) on dev and prod. Not touched here |
| Dev API | running with `EVAL_JUDGE_MODE=offline` in the root `.env.local`; restart it after any change to that line |
| DocuMind dev API | running (unanswerable candidates call `/retrieve`) and local MinIO up |
| First batch seed | **2026** (so use a different one) |

## 1. Create the batch (dev only)
On http://localhost:3100/synthetic/new, or `POST /v1/synthetic-batches` (`BatchIn`, `kind=synthetic`):
- **Name:** `Synthetic v1 batch 2 (60, offline)`. **Org:** `simtora`. **Target dataset:** `synthetic-v1`.
- **Type counts (60):** single_hop 18, multi_hop 12, jurisdiction 12, comparative 6, out_of_scope 6, unanswerable 6. These keep the first batch's 12/8/8/4/4/4 proportions.
- **Seed:** `4242` (any value other than 2026; write the one used into the log). Leave **documents** empty (all).
- **Cap:** the cost cap is irrelevant in offline mode (cost is 0), but keep the default.
- Generator/validator model fields are recorded but not used for the call: the answers come from Claude Code. The batch gets `config.judge_mode = "offline"`.
- Expect a **shortfall for out_of_scope/unanswerable**: the per-batch dedupe and the dedupe against `synthetic-v1` v1 drop repeats (the first batch repeated the car-battery / music-streaming / company-car questions). Note the final counts per type.

## 2. Answer the parked tasks (Claude Code, in rounds)
The batch parks each prompt in `offline_tasks`. Repeat until `status` shows nothing pending (about 8 rounds, a few hundred tasks; a candidate needs generate → validate, and unanswerable ones also wait on a `/retrieve`):
1. `cd evaluation/api && uv run python -m scripts.offline_tasks status`
2. `uv run python -m scripts.offline_tasks show --no-system --no-catalog [--prompt NAME --limit N --grep …] --out FILE` and read the prompts (the system text and schema are shown once; `--prompt` filters by prompt name; `--grep` trims unanswerable validations to chunk headers + matching lines).
3. Write `answers.jsonl` in the **scratchpad**, one `{"task_id", "output"}` (or `{"task_id", "refusal": true}`) per line. Outputs must satisfy the prompt's schema; they are validated on import.
4. `uv run python -m scripts.offline_tasks import answers.jsonl`; the batch's jobs poll every `EVAL_OFFLINE_POLL_S` (15 s) and park the next round.

**Quality rules while answering** (these decide what the owner will see; follow the prompt files in `evaluation/api/app/judge/prompts/`, especially `_gen_rules.md`):
- Employee-style questions in natural language; no section numbers or doc codes in the question.
- The reference answer must be fully supported by the seed chunks; every `evidence_quote` must appear verbatim in them (the checks fail otherwise).
- Do not copy more than the overlap limit from the source text (word-trigram overlap ≥ 0.6 is a hard fail).
- For **unanswerable** / **out_of_scope**: confirm against the retrieved contexts that the corpus really lacks the answer; vary the topics (avoid the already-used car battery, music streaming, company car, Paris poem). Never "answer" what the policies don't say.
- The validator step must be an honest second look: flag unsupported claims, wrong sections and ambiguous questions rather than passing everything.
- Tag nothing by hand: `source` and `config.judge_mode` already mark these as offline-generated. If a reviewer must tell the two batches apart later, the batch id on `synthetic_candidates` is the key.

## 3. Review and commit (owner, dev)
- Review the batch on `/synthetic/<batchId>` (`a` approve, `e` edit, `r` reject, `j`/`k`). Targets: ≥ 70 % pass validation, ≥ 60 % approved by the owner.
- Commit the approved ones into `synthetic-v1`: it goes into a **new draft (v2)** copied from v1, so the draft holds v1's 39 + the new ones.
- Check the draft for repeats of v1 questions; then **Publish** it. Aim for **≥ 60 approved cases in total** (v1's 39 + at least 21 new), which a 60-candidate batch should clear comfortably.

## 4. Promote v2 to prod
Committed to `main` already, so the scripts are in the prod image (after the deploy). From `evaluation/api`:
```bash
uv run python -m scripts.export_dataset --slug synthetic-v1 --out ds.json        # latest published = v2
ssh -i ~/.ssh/hostinger_vps_ed25519 root@76.13.7.106 \
  'docker exec -i $(docker ps --format "{{.Names}}" | grep ^5435bt2d) python -m scripts.import_dataset --file -' < ds.json
```
- `--dry-run` first. The import creates `synthetic-v1` v2 on prod; the content hash it prints must equal the export's.
- Confirm on https://evaluation.documind.zeeshanai.cloud/datasets: Synthetic v1 shows v2 with the new case count.
- Do not run any prod judged run offline: `EVAL_JUDGE_MODE=offline` is local only.

## 5. After the batch
- Remove `EVAL_JUDGE_MODE=offline` from `.env.local` and restart the dev API before any real Haiku-judged run. Offline judge scores are Claude Code's and must not be compared with API runs.
- A full run on `synthetic-v1` v2 (judge on, from 2026-11-01) is optional; it isn't needed for acceptance.
- Update Status.md: the E7 acceptance numbers (candidates, validation pass rate, approval rate, per-type counts, rejection reasons), the final `synthetic-v1` size and hash, and this phase's log entry. Move the E7 "second batch" item out of Pending.

## Acceptance criteria
- [ ] A batch of 60 candidates (new seed, `judge_mode = offline`) finishes generation with $0 Anthropic spend (`judge_calls` rows have `model_actual = claude-code-offline`).
- [ ] ≥ 70 % of candidates pass validation; ≥ 60 % are approved by the owner.
- [ ] `synthetic-v1` v2 is published on dev with **≥ 60 cases in total** and no duplicate questions.
- [ ] v2 is on prod with a matching `content_hash`, visible on the prod datasets page.
- [ ] `EVAL_JUDGE_MODE=offline` is removed again locally; Status.md records the numbers and the deviation (generator = Claude Code, not Opus 5.5).

## Risks / notes
- **A session can stall mid-round:** the batch simply stays `generating`; the parked tasks are durable (unique per `request_hash`), so a new session resumes with `offline_tasks status`.
- **Output validation failures** on import are reported per task; fix those lines and re-import.
- **Quality drift vs batch 1** (Opus generator): compare the validation pass rate and the approval rate of the two batches in the Status.md entry.
- **Local DocuMind must stay up** for the whole batch; a stopped API leaves unanswerable candidates failed with `retrieval_failed`.

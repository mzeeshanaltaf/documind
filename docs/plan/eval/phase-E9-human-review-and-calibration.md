# Phase E9 — Human Review & Judge Calibration

**Goal:** Measure whether the Claude judge can be trusted:
- reviewers grade a stratified sample of results blind, using the judge's own rubric;
- the app computes judge-vs-human agreement per metric, prompt version and model;
- every judge metric on a run carries a calibration badge: uncalibrated, unreliable, moderate, calibrated, or stale.

**Depends on:** E8. **Completes** the harness.

## Skills to load
- `/impeccable`
- `/dataviz`
- `/fastapi-python`

## 1. Migration — `alembic/versions/0003_review.py`
| Table | Columns |
|---|---|
| `review_queues` | `run_id`, `name`, `metrics` text[], `sampling` (stratified, random, disagreement), `size`, `blind` bool, `created_by` |
| `review_items` | `queue_id`, `run_case_id`, `position`, `status` (pending, done, skipped) |
| `reviews` | `run_case_id`, `metric`, `reviewer_id`, `value` float, `label`, `comment`, `claim_verdicts` jsonb. Unique `(run_case_id, metric, reviewer_id)`. |
| `calibrations` | `metric`, `prompt_version_id`, `judge_model`, `n`, `kappa`, `kappa_weighted`, `spearman`, `exact_pct`, `within1_pct`, `mae`, `bias`, `human_kappa`, `confusion` jsonb, `status`, `computed_at` |

## 2. Sampling — `services/review.py`
| Mode | Selection |
|---|---|
| **Stratified** (default) | Bucket by the judge's score (1–5 for rubric dimensions; pass/fail for binary metrics) and fill each bucket evenly, so every score level is covered. Seeded. |
| **Random** | uniform |
| **Disagreement** | cases where N-sample spread is high or the metrics disagree (e.g. faithfulness high but correctness low) |

**Routes:**
- `POST /v1/review-queues`, `GET /v1/review-queues`;
- `GET /v1/review-queues/{id}/next` (the next pending item for this reviewer);
- `POST /v1/reviews`.

## 3. Grading UI — `/review`, `/review/[queueId]`
- **Item view:** the same case packet the judge saw: the question, the sources rendered as DocuMind numbers them, and the answer.
- **Blind mode:** the judge's scores and reasoning stay hidden until submit, then appear for learning.
- **Rubric:** the same 1–5 anchors as `judge.answer_quality`, pulled from the prompt file's frontmatter or anchors section, so humans and the judge grade identically.
- **Claim-level grading** for faithfulness: per claim, supported / contradicted / not_found.
- **Keyboard:** 1–5 sets the score, **n** next, **s** skip. Progress is shown.

## 4. Agreement — `app/stats/agreement.py`, `services/calibration.py`
- **Statistics:**
  - Cohen κ (nominal);
  - quadratic-weighted κ (ordinal 1–5);
  - Spearman ρ, with average ranks for ties;
  - exact and ±1 agreement;
  - MAE;
  - bias (mean judge − human);
  - a confusion matrix;
  - human-human κ where two reviewers graded the same item: the ceiling.
- **Grouping:** by metric × `prompt_version_id` × judge model. The `calibration_compute` job runs after each review submit (debounced) and from `POST /v1/calibration/recompute`.
- **Status rules:**

  | Status | Rule |
  |---|---|
  | `uncalibrated` | n < 20 |
  | `unreliable` | κw < 0.4 |
  | `moderate` | κw 0.4 to 0.6 |
  | `calibrated` | κw ≥ 0.6 and n ≥ 30 |
  | `stale` | the latest calibration is for a different prompt version or model than the run used |

## 5. UI
- **`/calibration`:** a table of metric × prompt version × model with n, κ, κw, ρ, agreement, bias and a status chip. A row expands to show the confusion-matrix heatmap and a bias scatter (judge vs human). The human-human ceiling is shown when available. Test-retest spread comes from N=3 runs.
- **Run detail:** every judge metric card gets its calibration badge, linking to `/calibration`. A metric that is `unreliable` or `stale` gets a caution note.
- **Dashboard:** calibration chips.

## 6. Tests
- **Unit:** κ, κw and ρ match textbook examples (including all-agree and perfect-disagree edge cases); the status rules; stratified sampling covers every bucket; blind mode hides judge fields in the API response until a review exists.

## Acceptance criteria
- [ ] 30 graded `answer_quality.correctness` items give κw, ρ, bias and a confusion matrix on `/calibration`.
- [ ] Editing `judge.answer_quality.md` marks the metric `stale` on new runs until it's regraded.
- [ ] Run-detail metric cards show calibration badges.
- [ ] Unit tests pass. typecheck, lint and build pass.
- [ ] Status.md records the first calibration numbers and marks the harness complete.

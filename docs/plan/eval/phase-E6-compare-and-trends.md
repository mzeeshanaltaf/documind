# Phase E6 — Compare & Trends

**Goal:** Two views:
- **A/B comparison** of two runs, paired on `case_key`, with significance testing, so a change to DocuMind (top_k, fusion weights, model, prompt) or to the judge shows as a measured gain or regression rather than noise;
- **trend dashboards** across runs over time.

The phase also establishes the **noise floor** with an A/A pair.

**Depends on:** E5. **Unblocks:** E7.

## Skills to load
- `/dataviz`
- `/impeccable`
- `/fastapi-python`

## 1. Paired statistics — `app/stats/paired.py`
- **Pairing:** cases with the same `case_key` that are `done` in both runs. Unpaired and NA cases are counted and reported.
- **Continuous metrics:**
  - mean difference (B − A);
  - paired bootstrap 95% CI (B=5000, seeded);
  - sign-flip permutation p-value (10k; exact enumeration when n ≤ 16).
- **Binary metrics:** exact McNemar on the discordant pairs, plus the difference in proportions with a CI.
- **Holm-Bonferroni** across the metrics shown in one comparison.
- **Per-case classification:** improved, regressed or unchanged (|Δ| > 0.1 on continuous metrics, any flip on binary ones).

## 2. Compare service — `services/compare.py`, `routers/compare.py`
- **`GET /v1/compare?a=&b=&metrics=&mode=`** returns:
  - `{a, b}` run summaries;
  - `config_diff`: a key-level diff of config and snapshot (overrides, DocuMind version, prompt hashes, judge prompt versions, dataset version);
  - `metrics[{key, mean_a, mean_b, delta, ci, p, p_holm, significant, direction_good}]`;
  - `cases[{case_key, question, status_a, status_b, deltas{metric: Δ}, class}]`.
- **Comparability:**
  - different dataset versions → compare only the shared `case_key`s and warn;
  - different orgs → a refusal (422 `not_comparable`).

## 3. Trends — `services/trends.py`, `routers/trends.py`
- **`GET /v1/trends?dataset_id=&org=&metrics=&slice=all&from&to`:** reads `run_aggregates` for completed, non-partial runs and returns a series per metric of `{run_id, finished_at, mean, ci_low, ci_high, n}`.
- **Change markers** wherever, between consecutive runs, any of these changed:
  - `config_hash`;
  - the DocuMind `version`;
  - a judge prompt version;
  - the dataset version.

## 4. Pages
- **`/compare?a&b`:**
  - run pickers (the default B is the newest run on the same dataset);
  - a config diff panel;
  - a metric diff table (Δ, CI bar, p, significant badge; regressions first, in the destructive colour);
  - a per-case list filtered by class;
  - a side-by-side case view: both answers, both context lists and both judge verdicts, using the drill-down components.
- **`/trends`:**
  - dataset and org filter, metric multi-select, slice select;
  - line charts with CI bands and vertical change markers (hovering a marker lists what changed);
  - dataset-version boundaries;
  - a click opens that run.
- **Run detail:** add a "Compare with…" action.

## 5. Noise floor
Run the same config twice on `golden` and compare A vs A. Record each metric's |Δ| and the A/A per-case flip rate in Status.md. The Compare page shows "within noise" when |Δ| ≤ the A/A |Δ| for that metric.

## 6. Tests
- **Unit:**
  - paired bootstrap on a constructed dataset with a known effect;
  - the permutation p-value equals exact enumeration at n=8;
  - McNemar against textbook values;
  - Holm ordering;
  - change-marker detection;
  - the config diff.

## Acceptance criteria
- [ ] Comparing a `top_k=4` run with a `top_k=8` retrieval-only run shows a `recall_section@k` change with a CI and p-value, and the config diff shows `top_k`.
- [ ] The A/A comparison shows no Holm-significant metric. The noise floor is recorded in Status.md.
- [ ] Trends show a marker on the run after a judge-prompt edit and after a DocuMind redeploy.
- [ ] Unit tests pass. typecheck, lint and build pass.

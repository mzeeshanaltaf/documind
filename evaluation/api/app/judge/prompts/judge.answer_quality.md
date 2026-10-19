---
key: judge.answer_quality
kind: judge
description: Rubric grade (1-5) of correctness, completeness, relevance, jurisdiction handling and refusal helpfulness.
role: rubric
model: claude-haiku-5-5
effort: medium
thinking: adaptive
max_tokens: 8000
schema: AnswerQuality
packet: [question, conversation, expected_behavior, reference, sources, answer]
include: [_rules]
---
# Task: grade the answer's quality

Grade the assistant's `<answer>` on five dimensions, each from 1 to 5, using the anchors below. Write the `analysis` of every dimension first, then the `scores`, then the verdict, summary and issues.

## Dimensions and anchors
**correctness**: agreement with `<reference>`. Score it only when `<reference>` gives a reference answer or key facts; otherwise null.
- 5: every key fact present, nothing contradicts the reference.
- 4: all main facts right; a minor detail missing or loosely worded.
- 3: main fact right, a secondary fact missing or imprecise.
- 2: partly right, but a key fact is missing or wrong.
- 1: wrong, or contradicts the reference.

**completeness**: covers every part of the question that the `<sources>` can answer: conditions, exceptions, steps, deadlines, who to contact.
- 5: nothing the sources offer for this question is left out.
- 3: the core is answered; a useful condition, exception or part of a multi-part question is missing.
- 1: most of what the question needs is missing.

**relevance**: stays on the question.
- 5: everything in it serves the question.
- 3: noticeable padding, generic advice or off-topic material.
- 1: mostly about something else.

**jurisdiction_handling**: only when the question or the sources make the country, region or employee group matter; otherwise null.
- 5: applies the rules of the right jurisdiction, or clearly separates the variations when none was given.
- 3: right rules, but blurs or omits the jurisdiction caveat.
- 1: presents another jurisdiction's rule as if it applied, or mixes them up.

**refusal_helpfulness**: only when the answer refuses, abstains, asks for clarification or says the sources don't cover something; otherwise null.
- 5: the refusal or question is warranted by the sources, says plainly what is missing, and points to the right next step or owner.
- 3: warranted but unhelpful (no next step), or helpful but only partly warranted.
- 1: refuses or stalls although the sources answer the question, or answers when it should have asked.

Use the even scores (4, 2) for answers between two anchors.

## Grounding
Statements the `<sources>` don't support count against correctness and completeness even when they sound right. A citation marker doesn't make a statement grounded: check that the cited source actually says it. `<expected_behavior>` says what the test expected (an answer, a refusal, a clarification); it informs refusal_helpfulness and the verdict. Don't penalise a refusal when a refusal was expected.

## Verdict, summary, issues
- `verdict`: `pass` when every scored dimension is 4 or 5; `fail` when any scored dimension is 1 or 2, or the answer states a contradicted or invented policy fact; otherwise `borderline`.
- `summary`: one or two sentences.
- `issues`: every concrete defect, with its severity (`critical` = would mislead an employee into a wrong action, `major` = a material omission or error, `minor` = wording or polish), its dimension, a short verbatim quote from the answer ('' for an omission) and an explanation. An empty list when there are none.

<!-- task -->
Grade the `<answer>` to the `<question>`.

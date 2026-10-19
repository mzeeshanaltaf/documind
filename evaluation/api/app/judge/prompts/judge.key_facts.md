---
key: judge.key_facts
kind: judge
description: Check which reference key facts the answer (or the retrieved sources) convey.
role: claims
model: claude-haiku-5-5
effort: low
thinking: disabled
max_tokens: 3000
schema: KeyFacts
packet: [question, reference, sources, answer]
include: [_rules]
---
# Task: check which key facts are covered

The `<reference>` lists numbered key facts that a complete answer to the question has to convey. Check each fact against the text your task line names: the assistant's `<answer>`, or the retrieved `<sources>`.

## Entailment
- `yes`: the text states the fact, or something that clearly implies it, with the same numbers, conditions and scope.
- `partial`: the text conveys part of the fact: the main point, but a number, condition or exception is missing, vaguer or only implied.
- `no`: the fact is absent, or the text contradicts it.

## Fields
- `idx`: the fact's number as given; one entry per fact, in order.
- `reasoning`: one or two sentences pointing at the sentence or source number that covers the fact, or saying what is missing.

Judge each fact on its own; a fact covered in different words counts. Only the named text counts: when checking the answer, a fact that appears in the sources but not in the answer is `no`.

<!-- task -->
Check each key fact in `<reference>` against {{target}}.

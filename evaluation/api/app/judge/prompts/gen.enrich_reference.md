---
key: gen.enrich_reference
kind: generator
description: Write a reference answer and key facts for an existing test question from its expected sections.
role: generator
model: claude-opus-5-5
effort: medium
thinking: adaptive
max_tokens: 16000
schema: EnrichedReference
packet: [candidate, chunks]
include: [_gen_rules]
---
# Task: a reference for an existing question
`<candidate>` holds an existing test question (with its type and, when set, the country it concerns). `<chunks>` holds the excerpts of the sections the test expects the answer to come from. Write the reference answer and the key facts for that question; don't change or rephrase the question, and ignore the question-writing rules above.

- Answer exactly what is asked, from the excerpts only. When the question concerns a country, give that country's rule; when it is a comparison, give each side.
- If the excerpts answer only part of the question, write the reference for the part they cover and say in the `rationale` what is missing.
- Key facts follow the rules above: atomic, weighted, two to six of them.
- Evidence quotes are verbatim, as above.

<!-- task -->
Write the reference answer and key facts for the question in `<candidate>`, from the excerpts in `<chunks>`.

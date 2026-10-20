---
key: gen.multi_hop
kind: generator
description: Write a multi-hop test case that needs two policy excerpts together.
role: generator
model: claude-opus-5-5
effort: high
thinking: adaptive
max_tokens: 16000
schema: GeneratedCase
packet: [chunks]
include: [_gen_rules]
---
# Task: a multi-hop question
`<chunks>` holds two excerpts, either from different sections of one document or from two documents where one refers to the other. Write one question whose complete answer needs **both** excerpts.

- Find the link: a situation where one excerpt sets a rule and the other adds a condition, a next step, an exception, an approval or a related entitlement. Good multi-hop questions read naturally ("If I'm on a performance plan, can I still apply for an internal transfer?"), not like two questions glued together with "and".
- Check before you write: if either excerpt alone answers the question fully, the case isn't multi-hop; change the question.
- The reference answer and the key facts draw on both excerpts; give each excerpt at least one key fact.
- `expected_doc_codes` and `expected_sections` list both excerpts' codes and sections.
- If an excerpt is from a country-specific document, the question names that country and `expected_jurisdiction` is its code; otherwise null.
- `expected_behavior` is `answer`.

<!-- task -->
Write one multi-hop test case that needs both excerpts in `<chunks>`.

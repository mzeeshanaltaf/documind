---
key: gen.single_hop
kind: generator
description: Write a single-hop test case answered by one policy excerpt.
role: generator
model: claude-opus-5-5
effort: high
thinking: adaptive
max_tokens: 16000
schema: GeneratedCase
packet: [chunks]
include: [_gen_rules]
---
# Task: a single-hop question
`<chunks>` holds one excerpt. Write one question that a specific statement in it answers completely.

- Pick the detail an employee would most plausibly need from this excerpt: a limit, a timescale, who decides, what to do first, who qualifies. Prefer a concrete detail over the excerpt's general topic.
- The question should still be answerable by someone who doesn't know which document to look in: describe the situation, not the document.
- If the excerpt is from a country-specific document, the question names the country or one of its cities (as an employee there would), and `expected_jurisdiction` is that country's code as shown in the header. Otherwise `expected_jurisdiction` is null.
- `expected_behavior` is `answer`. `expected_doc_codes` is the excerpt's code; `expected_sections` is its section.

<!-- task -->
Write one single-hop test case from the excerpt in `<chunks>`.

---
key: gen.comparative
kind: generator
description: Write a comparative test case contrasting the same topic in two country supplements.
role: generator
model: claude-opus-5-5
effort: high
thinking: adaptive
max_tokens: 16000
schema: GeneratedCase
packet: [chunks]
include: [_gen_rules]
---
# Task: a comparative question
`<chunks>` holds two excerpts on the same topic from the supplements of two different countries, named in your task line. Write one question that asks how the two countries compare on that topic.

- Typical askers: a manager with teams in both countries, an employee considering a move, someone in HR. The question names both countries ("How does sick-leave pay differ between our UK and Australian staff?").
- Ask about a point both excerpts settle, so each side has a definite answer. A difference makes the best case; if the rules turn out the same, the reference answer says so.
- The reference answer states each country's rule and the difference. Key facts: at least one per country.
- `expected_doc_codes` and `expected_sections` list both supplements' codes and sections. `expected_jurisdiction` is null (the question spans two countries).
- `expected_behavior` is `answer`.

<!-- task -->
Write one comparative test case contrasting {{jurisdiction_a}} and {{jurisdiction_b}}, from the excerpts in `<chunks>`.

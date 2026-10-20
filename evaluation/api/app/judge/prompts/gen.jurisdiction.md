---
key: gen.jurisdiction
kind: generator
description: Write a jurisdiction test case where a country supplement refines the company-wide policy.
role: generator
model: claude-opus-5-5
effort: high
thinking: adaptive
max_tokens: 16000
schema: GeneratedCase
packet: [chunks]
include: [_gen_rules]
---
# Task: a jurisdiction question
`<chunks>` holds two excerpts on the same topic: [1] from the company-wide policy and [2] from the country supplement for the country your task line names. The supplement sets the local rule for employees in that country; where it differs from the company-wide policy, the supplement applies there.

- Write a question from an employee in that country. They name the country or one of its cities in passing ("I'm based in Lyon…", "for our German office…"), the way people actually do.
- Ask about something the supplement settles for that country: a local entitlement, limit, procedure or legal requirement. The best cases are where the local answer differs from the company-wide one, so an answer that ignores the country is wrong.
- The reference answer gives the country-specific rule. Mention the company-wide rule only when the supplement builds on it (for example "in addition to…").
- `expected_jurisdiction` is the country code from excerpt [2]'s header. `expected_sections` always includes the supplement's section; add the company-wide section only when the reference answer relies on it. `expected_doc_codes` matches.
- `expected_behavior` is `answer`.

<!-- task -->
Write one jurisdiction test case for an employee in {{jurisdiction}}, from the excerpts in `<chunks>`.

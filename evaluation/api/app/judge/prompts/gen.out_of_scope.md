---
key: gen.out_of_scope
kind: generator
description: Write an out-of-scope question that isn't about company policy at all.
role: generator
model: claude-opus-5-5
effort: high
thinking: adaptive
max_tokens: 16000
schema: GeneratedCase
packet: [catalog]
include: [_gen_rules]
---
# Task: an out-of-scope question
Write one message that a user might type into the company's policy assistant but that is **not about company policy at all**: general knowledge, a personal errand, a coding or writing request, trivia, advice unrelated to work rules. `<catalog>` shows what the documents cover, so you can stay clearly outside it.

- Make it realistic for a workplace tool: people really do ask such assistants for a recipe, a word definition, help with an email, a sports score or a maths question. Phrase it casually, as typed.
- It must not touch any topic in the catalog, not even loosely (no leave, pay, expenses, IT security, conduct, travel rules or office logistics).
- No harmful, offensive or personal-data requests: the case tests polite scope-keeping, not safety refusals.
- `expected_behavior` is `refuse`. The reference answer, in one or two sentences, politely says the assistant only answers questions about the company's policies and offers to help with those. Key facts: one fact with weight 3 stating that it declines because the request is outside company policy.
- `expected_doc_codes`, `expected_sections` and `evidence_quotes` are empty; `expected_jurisdiction` is null.

<!-- task -->
Write one out-of-scope test case. Theme to draw from: {{theme}}.

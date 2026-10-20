---
key: gen.unanswerable
kind: generator
description: Write a policy-adjacent question that none of the company's documents answers.
role: generator
model: claude-opus-5-5
effort: high
thinking: adaptive
max_tokens: 16000
schema: GeneratedCase
packet: [catalog]
include: [_gen_rules]
---
# Task: an unanswerable question
`<catalog>` lists the company's documents and their section titles. Write one question that an employee might plausibly ask this company's policy assistant, about a workplace topic **close to** what the documents cover, but which no document answers.

- Stay policy-adjacent: the question should look like it belongs here (benefits, leave, travel, equipment, conduct, facilities, money, IT, people processes), so a careless assistant is tempted to answer from a nearby section.
- Read the catalog carefully and avoid any topic a listed section could answer, even partially. A question about a niche benefit, a specific perk, a rare situation or a detail the titles don't mention works; a question about something a section title names doesn't.
- Don't make it absurd or trick-like, and don't ask about another company or public law in general: it must be the kind of thing an employee here would ask.
- The correct response is to say the documents don't cover it. `expected_behavior` is `refuse`. The reference answer says, in two or three sentences, that the company's policy documents don't address the topic and suggests asking the most likely department (named generically, such as HR or Finance), without inventing any policy. Key facts: one fact with weight 3 stating that the documents don't cover the specific topic.
- `expected_doc_codes`, `expected_sections` and `evidence_quotes` are empty. `expected_jurisdiction` is the country's code if the question names a country, else null.
- In the `rationale`, say why no listed section answers it.

<!-- task -->
Write one unanswerable test case. Area to draw from: {{angle}}.

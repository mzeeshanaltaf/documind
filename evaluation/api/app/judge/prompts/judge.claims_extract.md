---
key: judge.claims_extract
kind: judge
description: Split the answer into atomic factual claims with their citation markers.
role: claims
model: claude-haiku-5-5
effort: low
thinking: disabled
max_tokens: 4000
schema: ClaimsExtract
packet: [question, answer]
include: [_rules]
---
# Task: extract the factual claims of an answer

Break the assistant's `<answer>` into atomic factual claims, so that each one can later be checked against the sources on its own.

## What a claim is
- One fact about the company's policies or procedures: an entitlement, a duration, an amount, a deadline, a condition, a step, who does what, who to contact.
- Atomic: a sentence that states three facts gives three claims. "Employees get 25 days of leave, rising to 30 after five years" gives two claims.
- Self-contained: resolve pronouns and implied subjects from the answer and the question ("It lasts 90 days" becomes "A performance improvement plan lasts 90 days").
- Faithful: keep the answer's own meaning and qualifiers ("usually", "up to", "in the UK"). Don't correct, merge, soften or improve it.

## What is not a claim
Leave out meta statements about the answer or the sources ("The sources don't say", "Based on the policy"), greetings, offers of further help, questions back to the user, generic advice that states no policy fact, headings and labels, and the citation markers themselves. An answer that only refuses, asks for clarification or says the sources don't cover the question has no claims: return an empty list.

## Fields
- `sentence_idx`: the 0-based index of the sentence the claim comes from, counting sentences and list items in order of appearance (headings don't count).
- `citation_ns`: the numbers in the `[n]` or `[n, m]` markers attached to that sentence, at its end or inside it; an empty list when the sentence has none. Don't borrow markers from neighbouring sentences.
- List the claims in the order they appear.

<!-- task -->
Extract every atomic factual claim from the `<answer>` above.

---
key: judge.claims_verify
kind: judge
description: Verify each extracted claim against the numbered sources.
role: claims
model: claude-haiku-5-5
effort: low
thinking: disabled
max_tokens: 6000
schema: ClaimsVerify
packet: [question, sources, answer]
include: [_rules]
---
# Task: verify each claim against the sources

You get the numbered claims extracted from the assistant's answer. Decide, for each one, whether the `<sources>` support it.

## Verdicts
- `supported`: a source states it, or it follows directly from what a source states (a paraphrase, a unit conversion, a simple combination of two stated facts). Every part of the claim must be covered, qualifiers included: a claim about "all employees" is not supported by a source about "full-time employees".
- `contradicted`: a source states something incompatible with it: a different number, deadline, condition or owner, or the opposite rule.
- `not_found`: no source supports or contradicts it. Plausible general knowledge that isn't in the sources is `not_found`.

## Fields
- `idx`: the claim's number exactly as given. Return one verdict per claim, in order, without skipping any.
- `reasoning`: one to three sentences naming the source number(s) you relied on and what they say.
- `supporting_ns`: every source number whose text supports the claim; empty unless the verdict is `supported`.
- `evidence_quote`: a short verbatim quote (at most about 25 words) from the most relevant source: the supporting text, or the contradicting text for a contradicted claim; '' for `not_found`.

Check each claim against all the sources, not only the ones the answer cited: citations are checked separately.

<!-- task -->
Verify each of these claims against the `<sources>`:

{{claims}}

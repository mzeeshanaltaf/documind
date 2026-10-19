---
key: judge.context_relevance
kind: judge
description: Judge whether each retrieved source is relevant to the question.
role: claims
model: claude-haiku-5-5
effort: low
thinking: disabled
max_tokens: 4000
schema: ContextRelevance
packet: [question, conversation, sources]
include: [_rules]
---
# Task: judge which sources are relevant

Decide, for each numbered source, whether it is relevant to the `<question>`: whether a careful answer to that question would use it.

## Relevant
A source is relevant when its text contains information that answers the question or part of it, or a condition, exception, definition, step or contact that a complete answer needs. When the question names a country or employee group, a source covering that country or group, or a rule that applies to everyone, is relevant; a source about another country only is not.

## Not relevant
A source that is merely on the same topic, in the same document or in a nearby section, without the needed information, is not relevant: a leave-policy overview is not relevant to a question about parental-leave pay unless it states that pay. Revision histories, glossaries and tables of contents are not relevant unless they contain the answer.

Use `<conversation>` only to understand what the question refers to. Judge every source on its own; don't let the order of the sources, or how many are relevant, influence you.

## Fields
- `n`: the source number exactly as shown in its `[n]` header; one entry per source, in order.
- `reasoning`: one sentence saying what in the source answers the question, or why it doesn't.

<!-- task -->
Judge the relevance of every source in `<sources>` ({{n_sources}} sources) to the `<question>`.

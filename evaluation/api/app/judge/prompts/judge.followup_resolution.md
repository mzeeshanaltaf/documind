---
key: judge.followup_resolution
kind: judge
description: Multi-turn cases - does the routed standalone query resolve the follow-up's references?
role: rubric
model: claude-sonnet-5-5
effort: medium
thinking: adaptive
max_tokens: 6000
schema: FollowupResolution
packet: [conversation, question, routing]
include: [_rules]
---
# Task: grade how a follow-up question was interpreted

The `<question>` is a follow-up in a chat: it may refer back to earlier turns in `<conversation>` ("what about contractors?", "and how long does that last?"). Before retrieving, the assistant rewrote it into a standalone query, shown in `<routing>`. Judge whether that standalone query resolves the follow-up's references correctly and completely, so that it can be understood without the conversation.

## Anchors
- 5: every reference (pronouns, "that", ellipsis, the implied topic, country or employee group) is resolved correctly, and nothing from the conversation that matters is lost or added.
- 4: resolved correctly; slightly over- or under-specified in a way that wouldn't change what gets retrieved.
- 3: the main reference is resolved, but a secondary constraint from the conversation (country, employee group, policy) is dropped or wrongly carried over.
- 2: part of the question is resolved to the wrong topic or entity.
- 1: unresolved (it still depends on the conversation), or resolved to the wrong thing.

`resolved` is true for scores 4 and 5. Write the `reasoning` first: name each reference in the follow-up and what it should resolve to.

<!-- task -->
Grade the standalone query in `<routing>` for the follow-up `<question>`.

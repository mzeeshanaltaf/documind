# Phase O7 — Presentation Room

**Goal:** an auditorium off the lobby where a presentation is always running on a big screen. It has two parts:
- **What DocuMind is**, including the explainer video;
- **About {Org}** (Simtora: authored slides from the Company Overview; other orgs: a generated fallback).

The player can sit and page through the slides. A presenter NPC takes questions about the company.

**Depends on:** O5. **Unblocks:** O9 (the "Watch the presentation" quest).

## Skills to load
`/impeccable` (slide design), `/vercel-react-best-practices`.

## Known facts
- **The explainer video** is `web/public/documind-explainer.mp4` (about 2.2 MB). Copy it to `office/public/video/` and note it in `office/CLAUDE.md` as a copy to re-sync.
- **DocuMind's positioning** is in `PRODUCT.md`, `DESIGN.md` and the landing copy (`web/src/app/(marketing)/`). Keep claims accurate, as in Status.md › Phase 7:
  - new sign-ups can't upload (platform admins do);
  - text goes to OpenAI for indexing and answering;
  - no certifications are claimed.
- **Simtora facts** are in `docs/policies/Company-Overview.pdf` (37 pages). Read it this session; p.3 has the at-a-glance table (founded 2016, HQ San Francisco, about 230 employees in six countries, about 900 customers, SOC 2 Type II, …).
- **The overview document** is `doc_type = "overview"` (`department = Corporate`). `GET /v1/orgs/{id}/documents/{docId}` returns its `summary`.

## 1. Room — `src/game/world/office/presentation/`
- **Layout:** tiered seating for about 24, a stage with a lectern, a big screen, and soft lighting that dims while the player is seated.
- **Seats** are interactables: "E · Sit". Seated means the camera frames the screen, and ←/→ change the slide. Esc or E stands up.
- **The presenter NPC** stands by the lectern, gestures on each slide change, and says the slide's speaker line in a speech bubble.

## 2. Slide engine — `presentation/deck.tsx`
- **Slides are data:** `{id, kind: "title"|"bullets"|"stat-grid"|"map"|"video"|"quote", title, body, speakerLine, durationS}`.
- **Rendering:** the screen renders the current slide as DOM via drei `<Html transform occlude>`, styled with the tokens (Source Serif titles, Instrument Sans body).
  - A "View full screen" button opens the same slide in a DOM dialog, for readability and screen readers.
- **Auto-advance:** every `durationS` while no one is seated; manual when seated.
  - Progress dots sit under the screen.
  - A seen-set per deck is recorded; seeing every slide emits `presentation_watched {deck}`.
- **Video slide:** drei `useVideoTexture("/video/documind-explainer.mp4", {muted: true, loop: false})` on the screen mesh.
  - It plays when seated or when the player is within 8 m, and pauses otherwise.
  - An unmute button appears while seated.
  - The DOM fallback is a `<video controls>` with captions if available.

## 3. Decks — `src/content/documind-deck.ts`, `src/content/orgs/simtora.ts` (`deck`)
- **DocuMind** (about 8 slides):
  1. The problem: policies spread across long PDFs.
  2. Explainer video.
  3. How it works: upload, index, ask, cite.
  4. Hybrid search: BM25 plus vectors, fused.
  5. Department agents and country awareness.
  6. Citations that open the PDF at the page.
  7. Organizations, members and monthly quotas.
  8. Try it: "Visit any department in this office, or open DocuMind".
- **Simtora** (about 8 slides, from the Company Overview, paraphrased and checked against the PDF):
  1. At a glance (stat grid).
  2. Our story.
  3. Mission, vision and values.
  4. Product lines.
  5. Global footprint (map slide with the six offices, highlighting the current one: "You are here: Lahore").
  6. Customers and markets.
  7. Executive leadership (roles only, no invented names unless the PDF has them).
  8. Our policy framework (which manual covers what, linking to the department rooms).
- **Generic fallback** for orgs without an authored deck (`deckFor(org, documents)`):
  - a title slide;
  - the overview document's `summary` split into 2–3 slides;
  - a "library" stat grid (document count, departments, countries);
  - a "your departments" slide.
  - No overview document: only the stats and departments slides.

## 4. Presenter Q&A
- **E on the presenter** opens the O5 dialogue with `scopeFor({overviewOnly: true})` (the overview documents).
- **Suggested chips:** "When was Simtora founded?", "Where are the R&D centres?", "What are the company values?".
- **Static, no quota:** the presenter's greeting and the per-slide speaker lines are free; only typed or chip questions cost quota.

## Tests
- **`deckFor`:** Simtora returns the authored deck; an org with an overview document gets summary slides; an org without one gets stats only.
- **The seen-set** emits `presentation_watched` once, after the last unseen slide.
- **Playwright:** sit, press → through every slide, and assert the event fired and `progress.quests` updated (once O9 exists; until then, the event log in `window.__office`).

## Acceptance
- The presentation loops when no one is seated. Seated controls work, and the video plays on the screen and pauses when you leave.
- Every Simtora slide fact matches `Company-Overview.pdf`. List the page per slide in a comment in `simtora.ts`.
- "View full screen" works by keyboard and is readable at 360 px width.
- Presenter questions are scoped to SIM-OVR-001 and cite it.

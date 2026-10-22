# Phase O9 — Quests, Achievements & Rooftop

**Goal:** a light progression layer that turns the office into guided onboarding:
- **quests** with a journal;
- **achievements** with toasts;
- persistent **progress** per user × org;
- a **rooftop lounge**, unlocked by finishing the core quests, with a city panorama and fireworks.

**Depends on:** O5–O8 (the events they emit). **Unblocks:** O10.

## Skills to load
`/vercel-react-best-practices`, `/impeccable` (journal, toasts, celebration).

## Known facts
- **Event bus** (`src/game/quests/bus.ts`, from O2). Events emitted so far:

  | Event | Phase |
  |---|---|
  | `city_entered {location, isNight}` | O4 |
  | `office_entered {location}` | O4 |
  | `badge_issued` | O5 |
  | `question_asked {department\|null, location}` | O5/O6 |
  | `citation_opened {doc_code, department}` | O6 |
  | `room_entered {department, location}` | O6 |
  | `presentation_watched {deck}` | O7 |
  | `game_finished {game, score, details}` | O8 |
  | `emote_used` | O8 |

  Check that every one is actually emitted. Add any that are missing.
- **Storage:** `progress(user_id, org_id)` holds `cards`, `quests`, `achievements` and `stats` as jsonb (O1).

## 1. Engine — `src/game/quests/{definitions.ts,engine.ts,achievements.ts}` (pure, tested)
- **Definition:** `{id, title, description, kind: "core"|"side", steps?, target, reducer(state, event) → state, hint}`. A quest is done when its progress reaches `target`.
- **`applyEvent(progress, event)`:** returns `{progress, completed: QuestId[], unlocked: AchievementId[]}`. It's pure and idempotent; replaying the same `done_at` doesn't re-fire.
- **Core quests** (the rooftop needs all of them):
  1. **First day:** get your access badge at Reception.
  2. **Orientation:** watch the full company presentation.
  3. **Meet the experts:** ask questions in 3 different department rooms.
  4. **Check the source:** open a citation.
  5. **Team spirit:** finish any game in the play area.
- **Side quests:**
  - Globetrotter: enter all of the org's offices.
  - Local knowledge: ask a question in 3 different cities.
  - Department tour: enter every department room.
  - Bookworm: open 10 citations.
  - Trivia ace: 10/10 in one trivia round.
  - Clean desk: Sort & Toss score above a threshold.
  - Rally: beat the CPU at table tennis on the hardest level.
- **Achievements:** each quest has one, plus:
  - Night owl: enter a city at local night;
  - Early bird: before 08:00 local time;
  - Social butterfly: talk to 10 NPCs;
  - Rooftop: reach the rooftop.
- **Admins:** questions don't use quota for them, but quests still require real questions.

## 2. Persistence — Server Actions
- **`loadProgress(orgId)`** runs on entering the world.
- **`saveProgress(orgId, patch)`:** a debounced (2 s) batch of quest, achievement and stat changes.
  - `requireOrgAccess`, then zod.
  - Server-side merge: progress counters never decrease; `done_at` is set once.
  - On page hide, flush with `navigator.sendBeacon` to a small route handler using the same validation.
- **Trust model:** the client is trusted for game progress (it's a game). Scores are bounded separately (O8). Document this in `office/CLAUDE.md`.

## 3. UI — `src/components/hud/`
- **Journal (J):** a DOM dialog with two tabs, plus a per-quest "Show me" hint.
  - **Quests:** core first, with progress bars and hints ("Reception is left of the entrance").
  - **Achievements:** a grid, locked ones greyed out, with the unlock date.
  - **"Show me"** draws a guide line on the floor to the target (reduced motion: a static minimap marker).
- **Toasts:** "Quest complete: Meet the experts" and "Achievement unlocked: Night owl", with a subtle chime. Several at once queue up.
- **First entry:** a three-step coach-mark overlay (move, interact, journal) that can be dismissed; dismissal is stored in `players.settings`.

## 4. Rooftop — `src/game/world/office/rooftop.tsx`, scene `rooftop`
- **The lift** at the corridor's end: locked shows "Finish your core quests (3/5) to unlock the rooftop". Unlocked transitions to the `rooftop` scene.
- **Rooftop:**
  - a lounge with plants, string lights, a telescope, and a panorama of the same generated city (O4 generator at a distance) with its landmark;
  - fireworks on the first visit and on demand from a button panel (instanced particles; off with reduced motion, replaced by confetti fades);
  - a "Wall of fame" plaque listing the player's achievements.
- **The telescope** zooms to the landmark with a fun fact (static text per city in `simtora.ts`).
- **Worldwide:** the rooftop is the floating island's observation deck over the globe.

## Tests
- **The engine over scripted event sequences:**
  - each core quest completes exactly once;
  - replay is idempotent;
  - the rooftop unlocks only when all 5 core quests are done;
  - counting is per org (progress is separate per org).
- **Server-side merge:** a counter can't decrease; `done_at` is kept (dev DB, throwaway rows).
- **Playwright:** run the core quests with a scripted path (stubbed chat responses via a route mock for speed), then assert the lift unlocks and the rooftop loads.

## Acceptance
- A fresh user sees the coach marks and an empty journal. Completing each core quest toasts once and survives a reload.
- The rooftop unlocks after the 5 core quests, and the fireworks respect reduced motion.
- Progress is separate per org and kept per user across devices (DB, not localStorage).
- No quest can complete without its event; check a few by hand.

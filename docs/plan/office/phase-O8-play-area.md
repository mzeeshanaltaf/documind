# Phase O8 — Play Area & Leaderboards

**Goal:** a fun zone off the lobby with three **original** mini-games and some ambient activities, plus a per-org leaderboard wall. Nothing here costs quota.

**Depends on:** O5. **Unblocks:** O9 (game quests and achievements).

## Skills to load
`/vercel-react-best-practices`, `/impeccable` (game HUDs, leaderboard).

## Known facts
- **No recreations:** the games are genre pieces with our own rules and names, not recreations of specific existing games.
- **Scores** go in `game_scores` (O1 schema), with `game ∈ trivia | sort_toss | table_tennis`.
- **Shared Upstash:** `UPSTASH_*` already backs the chat limit. Use a separate key prefix, `office:score:<userId>`, for score submits.
- **The PDF overlay** (O6) can open any document at a page by `doc_code`. Map codes to IDs from the org's document list.

## 1. Room — `src/game/world/office/play/`
- **Furniture:**
  - an arcade cabinet (Trivia);
  - a sorting station with three bins and a conveyor (Sort & Toss);
  - a table-tennis table;
  - beanbags (sit and lounge);
  - a coffee machine;
  - a jukebox (music track picker, CC0 loops);
  - the **leaderboard wall**.
- **Starting a game:** E on a station enters "game mode". The camera locks to the game view, the HUD swaps to the game HUD, and Esc quits.

## 2. Policy Trivia (arcade) — `src/game/games/trivia/`
- **Question bank:** `src/content/orgs/simtora-trivia.json`, **generated offline by Claude Code this session** from the PDFs (no API spend). Read the PDFs, or pull the chunks through DocuMind's admin `GET /v1/orgs/{id}/documents/{doc}/chunks`.
  - Size: about 80 questions across every department and office.
  - Fields: `{id, question, choices[4], answer (index), explanation (1–2 sentences), doc_code, page, department, jurisdiction, difficulty 1–3}`.
  - Every answer must be checkable on the cited page; record how they were checked in the session log.
  - **Owner reviews the bank before deploy** (Status.md › Pending user actions).
- **Round:**
  - 10 questions, weighted toward the current office's country plus GLOBAL;
  - 20 s per question, with 4 answer buttons (keys 1–4);
  - streak bonus;
  - after each answer: the explanation, plus "Show source" (opens the PDF overlay at `doc_code` p. `page`, and emits `citation_opened`).
- **Score:** correct × 100 + time bonus. Store `details = {correct, total, location}`.
- **Other orgs:** without a bank the cabinet shows "No trivia for this org yet". Generating banks for other orgs is a documented manual step in `office/CLAUDE.md`.

## 3. Sort & Toss — `src/game/games/sort-toss/`
- **Concept** (original): office items come down a conveyor, and you throw each into the right bin before it falls off.
  - Items: paper, cans, coffee cups, batteries, banana peels.
  - Bins: paper, recycling, general.
  - The rules echo the Facilities manual's recycling guidance; check SIM-FAC-001 and cite its page on the results card.
- **Controls:**
  - mouse/touch: drag back and release to aim and set power;
  - keyboard: ←/→ aim, hold Space for power.
  - The rapier physics ball arcs to the bin.
- **Pacing:** 60 s round, rising conveyor speed, combo multiplier, wrong bin −1.
- **Score:** points; `details = {correct, wrong, maxCombo}`.

## 4. Desk Table Tennis — `src/game/games/table-tennis/`
- **Rules:** a short match to 7 points against a CPU colleague NPC (picked from the office's personas).
- **Controls:** the paddle follows the mouse or touch; arrows on the keyboard.
- **CPU difficulty:** 3 levels; the CPU's reaction delay and error grow with ball speed.
- **Physics:** a simple custom ball model (bounce, spin from paddle velocity), not rapier, for deterministic feel.
- **Score:** points won plus a win bonus; `details = {won, pointsFor, pointsAgainst, difficulty}`.

## 5. Ambient activities
- **Coffee machine:** E brews a coffee (animation, sound) and gives a "caffeinated" 30 s run boost.
- **Beanbags:** sit; the camera relaxes.
- **Emote wheel** (hold Q, or the HUD button on touch): wave, cheer, dance. Emits `emote_used`.
- **Jukebox:** chooses the play-area music.

## 6. Scores & leaderboard — Server Actions in `src/app/(game)/actions.ts`
- **`submitScore({orgId, game, score, details})`:**
  - `requireOrgAccess`, then zod;
  - **bounds per game** (trivia ≤ 10 × (100 + max bonus); sort-toss ≤ a computed maximum for 60 s; table tennis ≤ 7 + bonus);
  - at most 1 submit per 10 s per user (Upstash, fails open);
  - inserts into `game_scores`;
  - returns the rank.
- **`getLeaderboard({orgId, game, period: "week"|"all"})`:** the best score per user, top 10. Names are `players.display_name` (first name plus initial); users with `settings.hide_from_leaderboard` are excluded. Only members of that org see it.
- **Leaderboard wall:** three columns (one per game) on a wall screen. It refreshes when a game ends. E opens the DOM version with week/all tabs.

## Tests
- **Trivia bank schema:**
  - zod-validated: 4 unique choices, answer index in range, a known `doc_code`, page ≥ 1;
  - the round picker's weighting and no repeats within a round.
- **Scoring functions** for each game, the bounds, and the leaderboard query (best per user, hidden users excluded). Run them against the dev DB with throwaway rows, cleaned up afterwards.
- **Table-tennis ball model:** deterministic given a seed.
- **Playwright:** play a trivia round with scripted answers, then assert the score row and the leaderboard entry.

## Acceptance
- All three games are playable with keyboard, mouse and touch, and each quits cleanly back to walking.
- A trivia "Show source" opens the correct page. 20 randomly sampled questions check out against their pages (logged).
- An out-of-bounds or too-fast score submit is rejected. The leaderboard shows only the org's members and respects the hide setting.
- The play area holds ≥ 30 fps on the low tier during Sort & Toss.

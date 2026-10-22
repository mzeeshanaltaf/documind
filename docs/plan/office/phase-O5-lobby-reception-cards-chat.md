# Phase O5 — Lobby, Reception, Access Cards & NPC Chat

**Goal:** the office interior exists. It's built from a procedural floor plan that comes from the org's departments, and contains:
- a lobby with a **Reception** desk; the receptionist answers general questions through DocuMind and **issues access cards**;
- card-gated doors to the department wing, with rooms as empty shells until O6;
- open doors to the presentation room (O7) and the play area (O8).

The NPC dialogue panel streams real DocuMind answers. The quota meter and refusals work end to end.

**Depends on:** O2, O4. **Unblocks:** O6–O9.

## Skills to load
`/vercel-react-best-practices`, `/nextjs-best-practices`, `/impeccable` (dialogue panel, quota meter, card UI).

## Known facts
- **Chat:** `POST /api/backend/orgs/{orgId}/chat`, with body `{conversation_id?, message (1..4000), document_ids?}`. Unknown fields are rejected.
- **SSE events:**
  - `meta {conversation_id, user_message_id, assistant_message_id}`
  - `routing`
  - `sources [{n, document_id, doc_code, title, section_number, section_title, page_start, page_end, jurisdiction}]`
  - `delta {text}` (repeated)
  - `citations` (sources plus `chunk_id`, `section_path`, `snippet`, `highlight_text`)
  - `usage`
  - `done {}`, or `error {message}` at any point
- **Pre-stream errors** come back as JSON `{error:{code,message,details?}}`:
  - 429 `quota_exceeded` (details = `Quota`);
  - 429 `rate_limited` (with `Retry-After`; from the BFF);
  - 422 `unknown_documents`;
  - 404 conversation `not_found`.
- **Port, don't import:** the parsing loop and `handle()` switch come from `web/src/hooks/use-chat-stream.ts` (`fetch` POST + `eventsource-parser` over `TextDecoderStream`, `AbortController` to stop, "cut off" when the stream ends with no `done`/`error`).
- **Quota:** `GET /api/backend/me/quota` returns `QuotaOut {message_limit, token_limit, messages_used, tokens_used, resets_on, unlimited, exhausted}`. It's account-wide across orgs, per UTC month, and admins are `unlimited`.
- **DocuMind chat URL:** `${NEXT_PUBLIC_APP_URL}/app/{slug}/chat/{conversationId}`. Office conversations show up in the user's DocuMind history (normal, untagged chats).

## 1. Floor plan — `src/game/world/office/floorplan.ts` (pure, tested)
- **Signature:** `buildFloorplan(departments: string[], opts)` returns `{rooms, walls, doors, spawns, npcSpots, bounds}`.
- **Layout:**
  - **Lobby:** the entrance, the reception desk, a waiting area, and the badge booth.
  - **Off the lobby:** the presentation room on one side and the play area on the other.
  - **Corridor:** behind a card-gated security door. Department rooms alternate left and right; corridor length = ceil(n/2) bays.
  - **End of the corridor:** the rooftop lift, locked until O9.
- **Department rule:** one room per department except `Corporate`.
  - Order: HR, IT, Finance, Procurement, Facilities, Compliance, International, then the rest alphabetically.
  - Each room door `requires: card:<Department>`.
  - The corridor security door requires **any** card.
- **Output:** walls become rapier cuboid colliders. Room bounds drive `room_entered` events and the minimap.

## 2. Interior rendering — `src/game/world/office/`
- **Shared kit:** CC0 low-poly furniture (e.g. the Kenney Furniture Kit), instanced. Floors, walls, glass partitions and ceiling lights are in the brand palette.
- **Lobby details:** a big DocuMind mark wall, a live city clock, an org directory board listing the rooms.
- **Doors** (`doors.tsx`): sliding glass with a card reader.
  - No card: red LED, a "denied" beep, and the prompt "Locked · You need an HR card · Visit Reception".
  - With the card: green LED, then the door slides open.
- **Exit:** the door back to the street, which transitions to `city`.

## 3. NPCs — `src/game/npc/`
- **`<Npc persona spot>`:**
  - the same character rig as the player, recoloured from the persona;
  - idle and talk animations; turns to face the player when focused;
  - a name tag ("Sara · Reception");
  - a speech bubble: drei `Html`, short text or a typing indicator.
- **Personas:** `src/content/personas.ts` holds the receptionist per location (Simtora: a culturally plausible name per city) plus a generic one. Greetings are static.

## 4. Dialogue panel — `src/components/dialogue/`
- **Opens on E** with a focused NPC. It sets `ui.modal` (movement is paused) and puts the camera in dialogue framing.
- **Layout:**
  - **Header:** the NPC name, role and location, plus what it can see (e.g. "Answers from 9 Lahore documents"; the full list in a popover).
  - **Body:** a transcript with the NPC's static greeting, then the turns. Answers render as Markdown with citation chips `[n]`, shown in O6; in O5 they show the doc code and page only.
  - **Footer:** suggested-question chips (from `room-themes.ts` / persona), the composer (Enter sends, Shift+Enter adds a newline), and Stop.
- **Status line:** while streaming it reads "Looking up policies… · Reading 6 sources… · Answering…" (from `routing`/`sources`/`delta`). The NPC speech bubble shows the typing indicator, then the first sentence.
- **Conversation state:** one conversation per NPC per visit, kept in the zustand `chat` slice keyed by `{location, npcId}`. Walking away and coming back keeps it until a page reload.
- **"Continue in DocuMind"** shows after `meta` and opens a new tab.
- **Accessibility:** a real `role="dialog"` with a focus trap, Esc to close, and `aria-live="polite"` on the streaming answer.

## 5. Chat hook — `src/game/chat/{sse.ts,use-npc-chat.ts}`
- **`sse.ts`:** a pure `applyEvent(turn, event)` reducer plus `streamChat(url, body, onEvent, signal)`. Both are unit-tested with recorded SSE fixtures.
- **`useNpcChat({orgId, documentIds|null, key})`:**
  - sends and stops;
  - stores `conversation_id` from `meta`;
  - emits `question_asked {department, location}` on `done`, and `citation_shown`;
  - revalidates the quota SWR key after `done`/`error`.
- **Refusals in-world:**

  | Refusal | NPC says | UI |
  |---|---|---|
  | `quota_exceeded` | "You've used this month's questions. They renew on {date}." | composer disabled, meter red |
  | `rate_limited` | "One moment, give me {n}s." | countdown |
  | `unknown_documents` | "My files just changed. One second." | refetch documents, retry once |

## 6. Reception — `world/office/reception.tsx`
- **Receptionist dialogue menu:**
  1. **"Ask a question":** the chat panel with reception scope (`scopeFor({location})`; README › Chat scoping, rules 4 and 6). `lib/scope.ts` is added here with the reception rule; O6 completes it.
  2. **"Get access cards":** a card picker listing every department room, each with an icon and a one-line "what you can ask".
     - "Take all" or pick some, then a short badge-printing animation.
     - The cards appear in the HUD **card wallet** (bottom-left; hover shows the department).
     - The Server Action `issueCards(orgId, departments[])` runs `requireOrgAccess`, validates the names against the org's departments, and merges them into `progress.cards`. It emits `badge_issued`.
  3. **"Change my look":** opens the avatar editor (O2) as the "badge photo booth".
- **First visit:** the receptionist calls out ("Welcome to Simtora Lahore! Come get your badge.") when the player is within 6 m.

## 7. Quota meter & minimap — `components/hud/`
- **Quota meter** (hidden when `unlimited`):
  - two thin bars, messages and tokens, with "18 of 25 questions · 64K of 100K tokens · renews Nov 1";
  - amber at ≤ 3 messages or ≥ 90% tokens; red when exhausted;
  - the wording matches DocuMind's composer line.
- **Minimap (M toggles size):** room outlines from the floor plan, the player arrow, NPC dots, and lock icons on rooms without a card.

## Tests
- **`buildFloorplan`:**
  - Simtora departments give 7 rooms (no Corporate);
  - no overlapping rooms;
  - every room is reachable from the lobby (flood fill on the door graph);
  - each room door requires its card.
- **`applyEvent`:** recorded fixtures for a normal answer, an `error` mid-stream, a stream with no `done` (cut off), and a stop.
- **`issueCards`:** a non-member is refused; an unknown department is rejected; merging is idempotent.
- **Playwright** (temporary session row, as in E9; deleted afterwards), as a non-admin Simtora member in Lahore:
  - walk to the security door: locked;
  - get all cards at Reception: the door opens;
  - ask the receptionist a question: the answer streams, and a `meta` conversation exists;
  - the quota meter goes down by 1.

## Acceptance
- The flows in the Playwright test pass.
- A receptionist answer in Lahore cites only PK, GLOBAL or base-manual documents.
- Setting the test user's quota to 0 in DocuMind `/admin/users` makes the NPC decline politely, with the composer disabled.
- Hitting the rate limit shows the countdown.
- "Continue in DocuMind" opens the same conversation in DocuMind.
- Esc closes the dialogue and movement resumes; keys typed in the composer never move the avatar.

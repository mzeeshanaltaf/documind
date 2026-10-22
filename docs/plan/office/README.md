# DocuMind Office: Overview

**DocuMind Office** is a walkable, low-poly 3D office on top of DocuMind.
- **Where it lives:** a standalone app at **`https://office.documind.zeeshanai.cloud`**. The code is in `office/`, and it's built in phases **O1–O10**; each phase doc in this folder is one session.
- **How it works:** you sign in with your DocuMind account, pick an organization and an office city (or Worldwide), and walk in. Reception gives you access cards. Department experts answer your questions with real DocuMind answers and citations, which count against your real monthly quota.
- **What else is there:** a presentation room, a play area, quests and achievements, and a rooftop to unlock.

## Decisions (planning session, 2026-10-22)
- **Sign-in:** DocuMind accounts only.
  - Better Auth runs on DocuMind's auth tables, the same pattern as `evaluation/web`.
  - Any verified, non-banned user can enter, not only admins.
  - People see only the orgs `/v1/me` returns, and their real quota applies (25 messages / 100K tokens per UTC month; platform admins unlimited).
- **Hosting:** a standalone Next.js app on its own Coolify app (`documind-office-web`), dev port **:3200**.
  - It calls DocuMind's FastAPI through its own BFF. **No backend change is needed.**
- **Art style:** stylized low-poly.
  - Scenes are procedural geometry plus CC0 kits (Kenney, Quaternius); licences are recorded in `office/public/assets/LICENSES.md`.
  - The HUD and menus use DocuMind's design system (DOM, not WebGL).
- **Extras in scope:**
  - NPC experts per room;
  - quests and achievements, with a rooftop unlock.
- **Out of scope** (possible later):
  - multiplayer presence;
  - voice in/out.
- **Mini-games are original designs.** They are not recreations of existing games.

## Architecture
```
Browser ─► office (Next 16, Better Auth on DocuMind auth tables, any verified member)
             │ R3F canvas (client-only) + DOM HUD
             │ BFF /api/backend/* (session → X-API-Key + X-User-Id; shared Upstash chat limit; SSE unbuffered)
             │       └─► DocuMind API /v1  (me, documents, chat SSE, quota, PDF file)
             │ Server Actions ─► Postgres schema documind_office (players, progress, game_scores)
```

## Stack
| Layer | Tech |
|---|---|
| Web | Next.js 16.4 (`cacheComponents`), React 19.3, TS strict, Tailwind v4, shadcn (copied from `web/`), pnpm, port **:3200** |
| 3D | `three`, `@react-three/fiber` v9, `@react-three/drei` v10, `@react-three/rapier` v2 (physics + kinematic character controller), `suncalc` (real sun position) |
| State/audio | `zustand` (game store), `howler` (audio) |
| Data | SWR through the BFF for DocuMind reads; Server Actions + `pg` for office state |
| Chat | `eventsource-parser`, ported from `web/src/hooks/use-chat-stream.ts` |
| PDF | `react-pdf` v11, copied from `web/src/components/pdf/*` |
| Tests | Vitest (pure logic + HUD), Playwright (browser flows) |

Use the same `better-auth`, `next`, `react`, `pg`, `swr`, `zod` and `@upstash/ratelimit` versions as `web/`. Pin the 3D packages at install time and record them in `office/CLAUDE.md`.

## Folder layout
```
office/
  CLAUDE.md  AGENTS.md (copy of web/)  Dockerfile  package.json  next.config.ts  vitest.config.ts
  db/migrations/0001_init.sql …          # numbered SQL; {office} / {auth} schema placeholders
  scripts/migrate.mjs auth-check.ts       # migrate = plain Node (runs locally and in the image)
  public/assets/{models,textures,audio}/ LICENSES.md   public/video/documind-explainer.mp4
  src/app/(auth)/sign-in/                 # email/password + Google; "Forgot password" → DocuMind
  src/app/(game)/page.tsx                 # org picker
  src/app/(game)/[orgSlug]/page.tsx       # location picker (globe)
  src/app/(game)/[orgSlug]/[location]/page.tsx   # the world (city → office), client-only
  src/app/api/auth/[...all]/  src/app/api/backend/[...path]/
  src/lib/{auth,auth-client,auth-guards,db,office-db,api,api-types,rate-limit,locations,scope,format}.ts
  src/game/
    engine/    Canvas shell, SceneManager, loaders, quality tiers, transitions
    input/     keyboard, touch joystick, bindings
    player/    Avatar, controller (rapier), follow camera
    interact/  Interactable, proximity, prompt
    world/city/    generator, landmarks/, lighting (suncalc), traffic + pedestrians, building exterior
    world/office/  floorplan.ts, lobby, reception, doors, rooms/, presentation/, play/, rooftop
    npc/       Npc, personas, speech bubble, name tag
    chat/      use-npc-chat.ts, sse.ts
    quests/    definitions, engine, bus, achievements
    games/     trivia/, sort-toss/, table-tennis/
    audio/  store/ (zustand slices: session, world, player, inventory, ui, chat)
  src/components/{hud,dialogue,pdf,menus,ui}/
  src/content/{documind-deck.ts, personas.ts, room-themes.ts, orgs/simtora.ts, orgs/simtora-trivia.json}
  tests/  e2e/
```

## Data model (`documind_office`, dev `documind_office_dev`)
Migrations replace `{office}` with `OFFICE_DB_SCHEMA` and `{auth}` with `OFFICE_AUTH_SCHEMA`; schema names are never hard-coded.
- **`players`:** `user_id text PK → {auth}."user"(id) ON DELETE CASCADE`, `display_name text`, `avatar jsonb` (colours, hair, outfit), `settings jsonb` (quality, sound, reduced motion, hide-from-leaderboard), `created_at`, `updated_at`.
- **`progress`:** `(user_id, org_id)` PK. `org_id → {auth}.organization(id) ON DELETE CASCADE`. Columns:
  - `cards text[]` (department names);
  - `quests jsonb` (`{id: {progress, done_at}}`);
  - `achievements jsonb` (`{id: unlocked_at}`);
  - `stats jsonb` (cities visited, rooms visited, citations opened, questions per department and city);
  - `updated_at`.
- **`game_scores`:** `id uuid default gen_random_uuid()`, `user_id`, `org_id`, `game` CHECK in (`trivia`,`sort_toss`,`table_tennis`), `score int` CHECK ≥ 0, `details jsonb`, `created_at`. Index `(org_id, game, score desc)`.
- **`schema_migrations`:** `version text PK`, `applied_at`.

**Access.** Every action first runs `requireSession()`. Org-scoped actions also call `requireOrgAccess(orgId)`: it passes if the user is a platform admin or there's a `{auth}.member` row (checked in SQL). The office web never writes the Better Auth tables.

## Locations
Locations are derived per org from the jurisdictions in its searchable documents (`lib/locations.ts`), with per-org overrides in `src/content/orgs/<slug>.ts`.

Simtora's locations, from `Company-Overview.pdf` p.3:

| id | City | Country | Role | Landmark kit | Local docs |
|---|---|---|---|---|---|
| `san-francisco` | San Francisco | US | Headquarters | Golden Gate, cable car | SIM-HR-001 |
| `lahore` | Lahore | PK | R&D centre | Minar-e-Pakistan | SIM-HR-101 |
| `berlin` | Berlin | DE | R&D centre | Brandenburg Gate, TV tower | SIM-HR-102 |
| `paris` | Paris | FR | R&D centre | Eiffel Tower | SIM-HR-103 |
| `sydney` | Sydney | AU | R&D centre | Opera House, Harbour Bridge | SIM-HR-104 |
| `london` | London | GB | R&D centre | Elizabeth Tower, Tower Bridge | SIM-HR-105 |
| `worldwide` | Global Hub | — | Everything | Floating campus over the globe | all |

**Other orgs:**
- Each country code maps to a default city (its capital) with a generic skyline kit.
- An org with only `GLOBAL` documents gets just `worldwide`.

## Chat scoping (the core rule, `lib/scope.ts`)
DocuMind's chat accepts only `document_ids` (max 50; sending them bypasses its router). The office therefore picks the IDs on the client from `GET /v1/orgs/{id}/documents`.

1. **Searchable documents** are those with `indexed_at != null`. Don't filter on `status`, because a document being reindexed would briefly drop out.
2. **Department room in a country office:** the department's documents where `jurisdiction ∈ {country, "GLOBAL"}` **or** `doc_type == "policy_manual"` (the base manual). Example: HR in Lahore = SIM-HR-001, SIM-HR-002, SIM-HR-101, and never the DE/FR/AU/GB manuals.
3. **Department room in Worldwide:** all of that department's documents.
   - If the room has country supplements, the dialogue shows a country chip row ("All", PK, DE, …).
   - Choosing a country applies rule 2.
4. **Reception in a country office:** rule 2 without the department filter (all documents for that location).
   - **Reception in Worldwide:** `document_ids = null`, so DocuMind's router does department and jurisdiction routing itself.
5. **Presentation-room presenter:** the `overview` documents (Simtora: SIM-OVR-001).
6. **Fallback:** if a rule matches nothing, use the unfiltered department set and show "No local documents for this office".

## Rooms
- **Rooms come from data.** One gated room per department present, except `Corporate`, which the presentation room hosts. Simtora gets HR, IT, Finance, Procurement, Facilities, Compliance and International.
- **Themes and suggested questions** live in `src/content/room-themes.ts`. Unknown departments use a generic theme.
- **NPC personas** (`src/content/personas.ts`):
  - each `(department, country)` pair has a name, look and greeting;
  - there's a generic persona per department as a fallback;
  - greetings and small talk are static text and never use quota.

## Controls
- **Keyboard:**
  - **Arrows/WASD:** move; **Shift:** run;
  - **E:** interact (talk, sit, play, open);
  - **J:** journal; **M:** map; **Esc:** menu/close;
  - **←/→ while seated in the auditorium:** change slides.
- **Touch:** a virtual joystick plus interact/menu buttons.
- **Focus:** all menus and dialogues are DOM elements with focus management. While a text field or dialog has focus, movement keys are ignored.

## Environment (root `.env.local`; add the keys to `.env.example` in O1)
| Key | Notes |
|---|---|
| `OFFICE_BETTER_AUTH_SECRET` | Its own secret, so no cross-app session reuse. Required in production. |
| `OFFICE_BETTER_AUTH_URL`, `OFFICE_PUBLIC_URL` | `http://localhost:3200` locally |
| `OFFICE_AUTH_SCHEMA` | DocuMind's Better Auth schema (`documind_dev` / `documind`) |
| `OFFICE_DB_SCHEMA` | `documind_office_dev` / `documind_office` |
| Shared | `DATABASE_URL`, `API_BASE_URL`, `DOCUMIND_API_KEY` (server-only), `GOOGLE_CLIENT_ID/SECRET`, `UPSTASH_REDIS_REST_URL/TOKEN`, `NEXT_PUBLIC_APP_URL` (DocuMind's URL, used for "Continue in DocuMind" and "Forgot password"; build-time) |
| Optional (O10) | `NEXT_PUBLIC_OFFICE_UMAMI_WEBSITE_ID` |

## Phases
| # | Phase | Doc |
|---|---|---|
| O1 | Scaffold, auth, BFF & DB | [phase-O1](phase-O1-scaffold-auth-bff-db.md) |
| O2 | Engine core: avatar, controls, camera, physics, HUD shell | [phase-O2](phase-O2-engine-core.md) |
| O3 | Org & location selection (globe) | [phase-O3](phase-O3-org-and-location-selection.md) |
| O4 | City scenes | [phase-O4](phase-O4-city-scenes.md) |
| O5 | Lobby, reception, access cards & NPC chat | [phase-O5](phase-O5-lobby-reception-cards-chat.md) |
| O6 | Department rooms & citations | [phase-O6](phase-O6-department-rooms-and-citations.md) |
| O7 | Presentation room | [phase-O7](phase-O7-presentation-room.md) |
| O8 | Play area & leaderboards | [phase-O8](phase-O8-play-area.md) |
| O9 | Quests, achievements & rooftop | [phase-O9](phase-O9-quests-achievements-rooftop.md) |
| O10 | Polish, accessibility, performance & deploy | [phase-O10](phase-O10-polish-and-deploy.md) |

## Budgets
- **Performance:**
  - The first city is interactive in ≤ 5 s on a mid laptop over broadband.
  - Frame rate: 60 fps on desktop, ≥ 30 fps on a mid phone at the low tier.
  - Draw calls stay under 300 per scene; use instancing and merged static geometry.
  - Game-route JS is ≤ 1.5 MB gzipped, excluding rapier's wasm and models.
  - Models are Draco/Meshopt-compressed; textures are KTX2 or small PNG atlases.
- **Cost:** only NPC questions cost anything. They are normal DocuMind chats on the user's quota. Trivia, greetings and all game logic are free.

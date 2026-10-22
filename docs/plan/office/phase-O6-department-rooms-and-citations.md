# Phase O6 — Department Rooms & Citations

**Goal:** each department room is furnished and themed, and has a named **expert NPC** for the location. The expert answers through DocuMind, scoped to that department and office. Citations open the cited PDF page, with the passage highlighted, in an overlay.

**Depends on:** O5. **Unblocks:** O9 (quests on questions and citations).

## Skills to load
`/pdf-preview` (adapt: load from the BFF URL, not base64), `/vercel-react-best-practices`, `/impeccable`.

## Known facts
- **Simtora documents per department:**

  | Department | Documents |
  |---|---|
  | HR | SIM-HR-001 (US, `policy_manual`), SIM-HR-002 (GLOBAL), SIM-HR-101..105 (PK, DE, FR, AU, GB `country_supplement`) |
  | IT | SIM-IT-001 |
  | Finance | SIM-FIN-001 |
  | Procurement | SIM-PRC-001 |
  | Facilities | SIM-FAC-001 |
  | Compliance | SIM-CMP-001 |
  | International | SIM-GLB-001 |
  | Corporate | SIM-OVR-001 (presentation room, O7) |

  All of them except HR-001 and HR-101..105 are GLOBAL.
- **DocuMind's own viewer** is `web/src/components/pdf/{pdf-viewer-provider.tsx,pdf-viewer-sheet.tsx,highlight.ts}`:
  - react-pdf v11, one page at a time, `suspense={false}`, kept mounted so the loaded document survives citation clicks;
  - highlights text items whose normalized text (≥ 4 letters/digits) is inside the normalized chunk, on `page_start..page_end`;
  - the text layer uses `mix-blend-mode: multiply`.
- **PDF bytes:** `GET /api/backend/orgs/{orgId}/documents/{docId}/file`.
- **Scoped chats bypass DocuMind's router.** Without history the question is used as-is; with history a small `rewrite` call runs. A conversation started with `document_ids` keeps that scope.

## 1. Scope rule — `src/lib/scope.ts` (pure, tested)
- **Signature:** `scopeFor(documents, {department?: string, country: string | null, overviewOnly?: boolean})` returns `{documentIds: string[] | null, label: string, fallback: boolean}`.
- **Rules:** implement README › Chat scoping, rules 1–6 exactly.
- **Limit:** cap at 50 IDs (the API maximum), keeping local, then base, then global documents first.
- **Label:** for the dialogue header, e.g. "HR · Lahore · 3 documents".

## 2. Rooms — `src/game/world/office/rooms/`
- **`<DepartmentRoom department theme persona>`:** shared shell, with the decor from `src/content/room-themes.ts`:

  | Department | Decor | Accent |
  |---|---|---|
  | HR | plants, sofa, a "people wall" of framed avatar portraits, a leave calendar board | warm |
  | IT | server rack with blinking LEDs, multi-monitor desk, cable trays, a "Have you tried…" poster | cool blue |
  | Finance | charts on screens, a safe, calculators, a ledger shelf | green |
  | Procurement | parcel shelves, a catalogue stand, a pallet with boxes | amber |
  | Facilities | toolboards, a maintenance cart, floor-plan blueprints, a recycling station | teal |
  | Compliance | scales-of-justice sculpture, bookshelves, a "Speak up" hotline poster | purple |
  | International | wall map with pins at the offices, a row of time-zone clocks (live) | gold |
  | Unknown/other | generic meeting room with a department sign | neutral |

- **Theme fields:** each theme has `suggestedQuestions` (3–5, generic by department; Simtora gets location-flavoured ones, e.g. Lahore HR "How many days of annual leave do I get in Pakistan?") and `blurb`.
- **Door sign:** the department name, and "Expert: {name}".

## 3. Expert NPCs
- **Personas:** add to `personas.ts` per `(department, country)` for Simtora's six offices, plus generic ones. Each has a name, colours, an idle prop (clipboard, laptop, mug) and a greeting such as "Hi, I'm Hina, I look after People & HR for the Lahore team. Ask me anything about your leave, benefits or policies."
- **Dialogue:** the O5 panel with `scopeFor({department, country})`.
- **Worldwide rooms with country supplements (HR):** the header shows a chip row ("All", PK, DE, FR, AU, GB, US). Changing it starts a new conversation with the new scope (confirm if one is in progress).
- **Speech bubble:** when the answer completes, the first sentence shows over the NPC for 6 s, plus a gesture animation.

## 4. Citations & PDF overlay — `src/components/pdf/`
- **Copy and adapt** DocuMind's viewer into a right-side sheet:
  - toolbar: title, doc code, page x / N, prev/next, zoom, download;
  - highlighting on the cited pages.
  - **React-pdf worker:** configure the worker URL for this app.
- **Citation chips `[n]`** render inline in answers; clicking one opens the sheet at `page_start`.
- **Hover card:** section path and snippet. A "Sources" list sits under each answer.
- **In-world touch:** while the sheet is open, the room's wall screen shows the cited document's title and page (drei `Html` or a canvas texture).
- **Events:** emit `citation_opened {doc_code, department}`.

## 5. Room visits
- Entering a room's bounds emits `room_entered {department, location}`. The Server Action records `progress.stats.rooms_visited`, debounced and batched with other stats.

## Tests
- **`scopeFor`:**
  - Lahore HR gives {HR-001, HR-002, HR-101}, with no DE/FR/AU/GB documents;
  - Worldwide HR "All" gives all 7 HR documents, and Worldwide HR with DE gives {HR-001, HR-002, HR-102};
  - Lahore Finance gives {FIN-001};
  - Lahore reception gives every GLOBAL, base and PK document; Worldwide reception gives `null`;
  - unindexed documents are excluded;
  - more than 50 documents are capped in priority order;
  - an empty match falls back with `fallback = true`.
- **Highlight helper:** copied tests, or new ones on a fixture chunk.
- **Playwright:** in Lahore with all cards, enter HR and ask "How many days of annual leave do I get?". Assert:
  - the `routing.document_ids` in the stream are a subset of the Lahore HR scope;
  - a citation chip opens the sheet on the cited page;
  - the highlight layer has marks.

## Acceptance
- All 7 Simtora rooms are furnished, themed and have an expert per office.
- The Lahore HR expert cites SIM-HR-101 or SIM-HR-002 (never another country's manual). The same question in Berlin cites SIM-HR-102 or SIM-HR-002.
- Citations open at the right page with the passage highlighted. The sheet survives switching citations without reloading the PDF.
- The quota decreases per question. Admins see no meter.
- typecheck, lint, test and build are clean. Screenshots of each room go in the scratchpad for the owner.

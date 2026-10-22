# Phase O3 — Org & Location Selection

**Goal:** after sign-in, the user picks an organization. They then pick an office on a 3D globe, with a list fallback, or choose Worldwide, and land at `/[orgSlug]/[location]`. That route shows a placeholder until O4.

**Depends on:** O1, O2. **Unblocks:** O4.

## Skills to load
`/nextjs-best-practices`, `/vercel-react-best-practices`, `/impeccable`.

## Known facts
- `GET /v1/me` returns `{user:{id,email,name,is_admin}, orgs:[{id,name,slug,role}]}`. Admins see every org; members see only their own.
- `GET /v1/orgs/{id}/documents` returns `{documents: DocumentOut[]}`. Each document has `department`, `jurisdiction` (ISO-2 with GB not UK, or `GLOBAL`), `doc_type`, `doc_code` and `indexed_at`.
- **Simtora offices** (`Company-Overview.pdf` p.3): HQ San Francisco (US); R&D centres in Lahore (PK), Berlin (DE), Paris (FR), Sydney (AU) and London (GB).
- **Eval orgs:** orgs whose `organization.metadata` is `{"eval": true}`, such as `eval-canary`, are hidden from users. `/v1/me` still returns them to admins, so filter them out of the office's org list: read the metadata in SQL, the same way as `IS_EVAL_ORG_SQL` in `web/src/lib/org-members.ts`.

## 1. Org picker — `src/app/(game)/page.tsx`
- A Server Component that fetches `/me` and the org metadata, then renders the org cards: name, logo (if any) or a monogram, and the user's role.
- **One org:** skip the picker by default, with a "Switch org" link.
- **Backdrop:** a slowly rotating low-poly office-tower diorama (`next/dynamic`, ssr:false). It's static on the low tier and with reduced motion.

## 2. Locations — `src/lib/locations.ts` (pure, tested), `src/content/orgs/simtora.ts`
- **`type Location`:**
  - `id`, `name`, `country | null` (null means Worldwide), `role` (`hq` | `office` | `hub`);
  - `lat`, `lon`, `timezone`, `landmarkKit`, `palette` (ground, buildings, accent);
  - `docCodes` (the local documents, for the card).
- **`deriveLocations(org, documents, overrides?)`:**
  1. Take the distinct non-`GLOBAL` jurisdictions of the searchable documents.
  2. Map each with the override (by country), else a default from `COUNTRY_DEFAULTS` (capital city, coordinates, timezone, the `generic` landmark kit).
  3. Sort HQ first, then by name.
  4. Always append `worldwide`.
- **Simtora overrides:** keyed by org slug (`simtora`), with the six locations and their kits from [README › Locations](README.md#locations). US means San Francisco (HQ).
- **IDs are URL slugs.** An unknown `[location]` gives `notFound()`.

## 3. Globe — `src/game/world/globe/`
- **Earth:** a low-poly icosphere in the brand palette, with land and sea from a small equirectangular mask texture (CC0 Natural Earth derived, about 1k).
  - It turns slowly; drag rotates it.
- **Pins:** one per location at its lat/lon. Each pin shows a label card with:
  - the city name and role;
  - the live **local time** (from `timezone`, updated every 30 s);
  - a day or night icon.
- **Interaction:**
  - Hovering or focusing a pin raises it.
  - Clicking or pressing Enter flies the camera to the pin, then navigates to `/[orgSlug]/[location]`.
  - "Worldwide" is a ring around the globe plus a button.
- **List fallback:** a DOM panel beside the globe, which is the primary path for keyboard and screen-reader users and on the low tier. Each card shows the city, local time, role and "Local policies: SIM-HR-101".
- **Arcs:** subtle arcs from HQ to each office (instanced lines); off with reduced motion.

## 4. Routes
- **`/[orgSlug]`:**
  - `requireOrgAccess` by slug: resolve the slug to an id in SQL, then check access.
  - Fetch the documents server-side through `apiJson`, derive the locations, and render the globe with its list.
- **`/[orgSlug]/[location]`:**
  - Validate the location, then render the client game root (ssr:false) with `{org, location, documents, me}`.
  - Until O4 this shows a placeholder sandbox.
  - Write `progress.stats.cities_visited` (Server Action `recordVisit`).
- **Last choice** is remembered in `players.settings` (`last_org`, `last_location`). The home offers "Resume in Lahore".

## Tests
- **`deriveLocations`:**
  - Simtora documents give exactly 6 cities plus Worldwide, with HQ first;
  - a GLOBAL-only org gives Worldwide only;
  - an unknown country uses the default capital;
  - documents that aren't indexed are ignored.
- **Local time formatting:** across a DST boundary (Europe/Berlin, Australia/Sydney).
- **Playwright:** pick Simtora, then Lahore through the list (keyboard only), and confirm the URL is `/simtora/lahore`.

## Acceptance
- A member of only `simtora` lands on the Simtora globe directly. An admin sees every non-eval org.
- The globe pins match the six offices, and their local times are correct.
- The list path works by keyboard alone.
- Visiting `/simtora/atlantis` gives 404. A non-member visiting `/simtora` gets 404.
- With reduced motion, the globe doesn't auto-rotate and the camera fly becomes a fade.

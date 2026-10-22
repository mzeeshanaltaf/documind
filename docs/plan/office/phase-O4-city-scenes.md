# Phase O4 — City Scenes

**Goal:** each location loads a recognisable, low-poly city block:
- the org's office building stands in the centre and carries its signage;
- a landmark sits in view;
- the lighting follows the city's real local time;
- traffic and pedestrians move around.

The avatar spawns on the street and walks through the entrance, which hands off to the `office` scene (a placeholder until O5). Worldwide is a floating "Global Hub" campus.

**Depends on:** O2, O3. **Unblocks:** O5.

## Skills to load
`/vercel-react-best-practices`, `/impeccable` (signage and HUD copy).

## Known facts
- **Locations** carry `lat`, `lon`, `timezone`, `landmarkKit` and `palette` (O3).
- **Budget:** fewer than 300 draw calls; first interactive within 5 s.
- **Scenes are lazy chunks** loaded by the SceneManager (O2). Dispose everything on unmount.

## 1. City generator — `src/game/world/city/generator.ts` (pure, tested)
- **Seeding:** `generateCity(location, seed = hash(location.id))` uses a seeded PRNG (mulberry32), so the same city always gives the same layout.
- **Output:**
  - a street grid (about 3×3 blocks), with the central block holding the org building and a plaza;
  - building footprints and heights from the palette;
  - street furniture points (lamps, trees, benches, bins);
  - car loop paths and pedestrian waypoint graphs;
  - the spawn point and the entrance trigger box;
  - the landmark placement at a vista point;
  - colliders (building boxes, plaza edges).
- **Rendering:** instanced meshes for buildings, windows, trees and lamps, and merged static geometry for roads and pavements. Windows light up at night (emissive on an instanced attribute).

## 2. Landmark kits — `src/game/world/city/landmarks/`
- **Approach:** one component per kit, built from procedural primitives, with a CC0 model only if one fits. Each is stylized, not photoreal, and kept to 3–8 draw calls.

| Kit | City | Landmarks |
|---|---|---|
| `golden-gate` | San Francisco | bridge silhouette across a bay plane, cable car on a short track |
| `minar` | Lahore | Minar-e-Pakistan in a park, with rickshaws in traffic |
| `brandenburg` | Berlin | the gate, plus the Fernsehturm in the background |
| `eiffel` | Paris | the tower, with a café terrace with awnings |
| `opera-house` | Sydney | sail shells by the harbour water, the Harbour Bridge arch |
| `elizabeth-tower` | London | the clock tower, red buses, Tower Bridge in the distance |
| `generic` | any other city | a skyline with a city-name monument sign |

## 3. Lighting & sky — `lighting.ts`
- **Sun:** `suncalc.getPosition(now, lat, lon)` gives the sun's altitude and azimuth, which drive:
  - drei `<Sky>` (or a gradient sky dome on the low tier);
  - the directional light and its colour temperature;
  - the ambient intensity.
- **Night** (altitude < −6°): moon light, street lamps on, lit windows, stars.
- **Refresh:** recomputed every minute.
- **Debug:** a "time of day" slider in the Esc menu, development only.
- **Achievement hook:** emit `city_entered {location, isNight}` for "Night Owl" (O9).

## 4. Life — `traffic.ts`, `pedestrians.ts`
- **Cars:** instanced cars move along the loop paths (city-specific shapes: cable car, rickshaw, black cab, red bus).
- **Pedestrians:** low-poly NPCs walk the waypoint graph (shared animation, instanced where possible). The count depends on the quality tier.
- **Avoidance:** pedestrians stop when the player is within 1 m. There is no physics on ambient NPCs.

## 5. Office building — `building.ts`
- **Exterior:** a glass and stone tower in the brand palette.
  - **Signage:** "{Org name}" plus the city ("Simtora Technologies · Lahore"), as a text mesh (drei `Text3D` with a baked font JSON, or `Text`).
  - The DocuMind mark goes on the lobby glass.
- **Entrance:** sliding doors open when the player is within 3 m.
  - Entering the trigger box calls `transition({scene: "office", spawn: "lobby_entrance"})` and emits `office_entered {location}`.
- **Leaving the office** (O5 exit door) returns the player to the street outside the entrance.

## 6. Global Hub — `world/city/global-hub.tsx`
- **Setting:** a floating island campus above a slowly rotating low-poly Earth (reuse the O3 globe), with a cloud layer beneath.
- **Buildings:** the hub building plus six small "portal kiosks", one per city. Interacting with a kiosk asks "Travel to Berlin?" and navigates to that location.
- **Lighting:** fixed golden hour (no real local time).

## 7. HUD additions
- **Arrival banner:** "Lahore · 7:42 pm local time · Simtora R&D centre", fading after 4 s.
- **Ambience:** city-specific loops (traffic plus a light motif), CC0, credited in `LICENSES.md`.

## Tests
- **`generateCity`:**
  - deterministic for the same seed;
  - no building overlaps the streets or the central plaza;
  - the spawn point reaches the entrance on the walk graph;
  - collider count matches the buildings.
- **Sun phase:** for fixed times (Lahore noon gives day; Sydney 02:00 gives night).
- **Playwright:** load `/simtora/berlin`, hold ArrowUp until the scene is `office` (spawn faces the entrance), and assert the scene changed within 10 s.

## Acceptance
- All six Simtora cities and the Global Hub load. Each landmark is recognisable in a screenshot.
- Day and night match the real local time. Forcing the debug clock flips the lighting.
- Walking into the entrance transitions to the office placeholder, and walking back out returns to the street.
- The low tier runs at ≥ 30 fps on a mid phone (Chrome devtools CPU 4× throttle as a proxy). Draw calls stay under 300 (log `renderer.info`).
- A screenshot of each city is saved in the session log folder (scratchpad) for the owner.

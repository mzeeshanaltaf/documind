# Asset licences

Every asset under `public/assets/` is CC0 (public domain) or made for this project. Add a row
for each new source before committing the files.

## Audio (`audio/sfx/`)

Each sound ships as `.ogg` (the original) plus an `.mp3` re-encode (ffmpeg, LAME VBR q6) for
browsers without Ogg Vorbis. Added 2026-10-22 (phase O2).

| Files | Original file(s) | Pack | Author | Licence | Source |
|---|---|---|---|---|---|
| `footstep-concrete-0…4` | `footstep_concrete_000…004.ogg` | Impact Sounds 1.0 | Kenney | CC0 1.0 | https://kenney.nl/assets/impact-sounds |
| `footstep-carpet-0…4` | `footstep_carpet_000…004.ogg` | Impact Sounds 1.0 | Kenney | CC0 1.0 | https://kenney.nl/assets/impact-sounds |
| `footstep-wood-0…4` | `footstep_wood_000…004.ogg` | Impact Sounds 1.0 | Kenney | CC0 1.0 | https://kenney.nl/assets/impact-sounds |
| `footstep-grass-0…4` | `footstep_grass_000…004.ogg` | Impact Sounds 1.0 | Kenney | CC0 1.0 | https://kenney.nl/assets/impact-sounds |
| `ui-click` | `click_002.ogg` | Interface Sounds 1.0 | Kenney | CC0 1.0 | https://kenney.nl/assets/interface-sounds |
| `ui-open` | `open_001.ogg` | Interface Sounds 1.0 | Kenney | CC0 1.0 | https://kenney.nl/assets/interface-sounds |
| `ui-close` | `close_001.ogg` | Interface Sounds 1.0 | Kenney | CC0 1.0 | https://kenney.nl/assets/interface-sounds |
| `ui-deny` | `error_004.ogg` | Interface Sounds 1.0 | Kenney | CC0 1.0 | https://kenney.nl/assets/interface-sounds |
| `success` | `confirmation_001.ogg` | Interface Sounds 1.0 | Kenney | CC0 1.0 | https://kenney.nl/assets/interface-sounds |
| `card-beep` | `select_006.ogg` | Interface Sounds 1.0 | Kenney | CC0 1.0 | https://kenney.nl/assets/interface-sounds |
| `door-open` | `doorOpen_1.ogg` | RPG Audio | Kenney | CC0 1.0 | https://kenney.nl/assets/rpg-audio |
| `door-close` | `doorClose_1.ogg` | RPG Audio | Kenney | CC0 1.0 | https://kenney.nl/assets/rpg-audio |

Each pack's `License.txt` reads "License: (Creative Commons Zero, CC0) …
http://creativecommons.org/publicdomain/zero/1.0/". Credit is optional; we give it here anyway.

## Ambience and motifs (`audio/ambience/`, `audio/music/`)

Made for this project on 2026-10-22 (phase O4) by `scripts/make-ambience.mjs`, which
synthesizes every sound from seeded noise and additive sine voices (no recordings or samples),
then encodes `.ogg` (libvorbis q2) and `.mp3` (LAME VBR q7) with ffmpeg. Dedicated to the public
domain under CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/). Re-run the script to
regenerate them; the output is deterministic.

| Files | What it is | Source | Licence |
|---|---|---|---|
| `ambience/city-traffic` | 24 s loop: low traffic rumble with passing cars | Generated (this repo) | CC0 1.0 |
| `ambience/hub-wind` | 24 s loop: soft wind for the Global Hub | Generated (this repo) | CC0 1.0 |
| `music/motif-golden-gate`, `-minar`, `-brandenburg`, `-eiffel`, `-opera-house`, `-generic`, `-global-hub` | 16–24 s loops: original melodies, one per landmark kit | Generated (this repo) | CC0 1.0 |
| `music/motif-elizabeth-tower` | 24 s loop: the Westminster Quarters (the hour's four changes) on synthesized bells | Melody: Westminster Quarters (1793), public domain; rendering generated (this repo) | Public domain / CC0 1.0 |

## Textures (`textures/`)

| File | Derived from | Author | Licence | Source |
|---|---|---|---|---|
| `earth-mask.png` (1024×512 land/sea mask for the globe) | `ne_110m_land.geojson` (1:110m physical land) | Natural Earth | Public domain | https://github.com/nvkelso/natural-earth-vector (geojson/), https://www.naturalearthdata.com/about/terms-of-use/ |

Rasterized with `scripts/make-earth-mask.mjs` (added 2026-10-22, phase O3); the comment at its
top has the exact commands. Natural Earth: "All versions of Natural Earth raster + vector map
data found on this website are in the public domain."

## Video (`public/video/`, outside `assets/`)

| File | Source | Licence |
|---|---|---|
| `documind-explainer.mp4`, `documind-explainer-poster.jpg` | DocuMind's own hero explainer, copied from `web/public/` (rendered from `video/src/explainer.html`) | Made for this project |
| `documind-explainer.vtt` | Captions describing the silent explainer's on-screen text, written for the office (phase O7) | Made for this project |

Copied 2026-10-22 (phase O7); re-copy by hand when the explainer is re-rendered (office/CLAUDE.md).

## Models

None downloaded yet. The avatar (`src/game/player/Avatar.tsx`) is built in code from primitives,
with its animation clips generated in `avatar-clips.ts`, so it has no external source.

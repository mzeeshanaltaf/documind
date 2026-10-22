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

## Textures (`textures/`)

| File | Derived from | Author | Licence | Source |
|---|---|---|---|---|
| `earth-mask.png` (1024×512 land/sea mask for the globe) | `ne_110m_land.geojson` (1:110m physical land) | Natural Earth | Public domain | https://github.com/nvkelso/natural-earth-vector (geojson/), https://www.naturalearthdata.com/about/terms-of-use/ |

Rasterized with `scripts/make-earth-mask.mjs` (added 2026-10-22, phase O3); the comment at its
top has the exact commands. Natural Earth: "All versions of Natural Earth raster + vector map
data found on this website are in the public domain."

## Models

None downloaded yet. The avatar (`src/game/player/Avatar.tsx`) is built in code from primitives,
with its animation clips generated in `avatar-clips.ts`, so it has no external source.

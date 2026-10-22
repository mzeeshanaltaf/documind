import type { LandmarkKit } from "@/lib/locations";

/**
 * Each place's sound (phase O4 › 7): a traffic bed on the ambience bus (wind on the floating
 * hub) and a light motif per landmark kit on the music bus. Made for this project by
 * `scripts/make-ambience.mjs` (see public/assets/LICENSES.md).
 */
const AUDIO = "/assets/audio";
const formats = (path: string) => [`${AUDIO}/${path}.ogg`, `${AUDIO}/${path}.mp3`];

export function ambienceFor(kit: LandmarkKit): { ambience: string[]; music: string[] } {
  return {
    ambience: formats(kit === "global-hub" ? "ambience/hub-wind" : "ambience/city-traffic"),
    music: formats(`music/motif-${kit}`),
  };
}

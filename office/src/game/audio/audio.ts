import { Howl, Howler } from "howler";

/**
 * The audio manager (Howler). Three buses: music, ambience and sfx; the settings' sound volume
 * drives sfx and ambience, music volume drives music. Nothing loads or plays until the first user
 * gesture unlocks audio (browsers block it before that). Sounds are CC0 (public/assets/LICENSES.md).
 */
export type Bus = "music" | "ambience" | "sfx";
export type Surface = "concrete" | "carpet" | "wood" | "grass";
export type SfxName = "ui-click" | "ui-open" | "ui-close" | "ui-deny" | "success" | "card-beep" | "door-open" | "door-close";

const BASE = "/assets/audio/sfx";
const FOOTSTEP_VARIANTS = 5;

const volumes: Record<Bus, number> = { music: 0.4, ambience: 0.7, sfx: 0.7 };
const sounds = new Map<string, Howl>();
const looping = new Map<Bus, Howl>();
let unlocked = false;
let lastStep = -1;

function sound(name: string): Howl {
  let howl = sounds.get(name);
  if (!howl) {
    // Ogg first (smaller); MP3 for Safari versions without Ogg Vorbis.
    howl = new Howl({ src: [`${BASE}/${name}.ogg`, `${BASE}/${name}.mp3`], preload: true });
    sounds.set(name, howl);
  }
  return howl;
}

export const audio = {
  get unlocked() {
    return unlocked;
  },

  /** Called on the first pointer or key press. Preloads the short UI sounds. */
  unlock() {
    if (unlocked) return;
    unlocked = true;
    const context = Howler.ctx;
    if (context?.state === "suspended") void context.resume();
    for (const name of ["ui-click", "ui-open", "ui-close"]) sound(name);
  },

  setVolumes({ sound: soundVolume, music }: { sound: number; music: number }) {
    volumes.sfx = soundVolume;
    volumes.ambience = soundVolume;
    volumes.music = music;
    for (const [bus, howl] of looping) howl.volume(volumes[bus]);
  },

  play(name: SfxName, { volume = 1, rate = 1 }: { volume?: number; rate?: number } = {}) {
    if (!unlocked || volumes.sfx === 0) return;
    const howl = sound(name);
    const id = howl.play();
    howl.volume(volumes.sfx * volume, id);
    if (rate !== 1) howl.rate(rate, id);
  },

  /** One footstep on a surface: a random variant (never the same twice) with a little pitch spread. */
  footstep(surface: Surface, running: boolean) {
    if (!unlocked || volumes.sfx === 0) return;
    let variant = Math.floor(Math.random() * FOOTSTEP_VARIANTS);
    if (variant === lastStep) variant = (variant + 1) % FOOTSTEP_VARIANTS;
    lastStep = variant;
    const howl = sound(`footstep-${surface}-${variant}`);
    const id = howl.play();
    howl.volume(volumes.sfx * (running ? 0.55 : 0.4), id);
    howl.rate(0.92 + Math.random() * 0.16, id);
  },

  /** A looping track on the music or ambience bus (O4+); `null` stops it. */
  loop(bus: "music" | "ambience", src: string[] | null) {
    looping.get(bus)?.unload();
    looping.delete(bus);
    if (!src || !unlocked) return;
    const howl = new Howl({ src, loop: true, volume: volumes[bus], html5: bus === "music" });
    looping.set(bus, howl);
    howl.play();
  },
};

/** Ground colliders say what they're made of with RigidBody `userData={{ surface }}`. */
export function surfaceOf(userData: unknown): Surface {
  const surface = (userData as { surface?: unknown } | null | undefined)?.surface;
  return surface === "carpet" || surface === "wood" || surface === "grass" ? surface : "concrete";
}

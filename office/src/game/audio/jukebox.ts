/**
 * The play area's jukebox (phase O8 › Ambient activities): three original loops
 * (`scripts/make-ambience.mjs --play`, CC0) the player picks between, or switches off. The
 * choice lasts for the visit; the music plays only while the player is in the play area.
 */
export const TRACKS = [
  { id: "lounge", name: "Lounge", detail: "Soft keys and slow pads" },
  { id: "arcade", name: "Arcade", detail: "Bright chip melody, 128 bpm" },
  { id: "bossa", name: "Bossa", detail: "Nylon plucks and an easy swing" },
] as const;

export type TrackId = (typeof TRACKS)[number]["id"];
export type JukeboxChoice = TrackId | "off";
export const DEFAULT_TRACK: JukeboxChoice = "lounge";

const BASE = "/assets/audio/music";
/** Ogg first (smaller), MP3 for Safari versions without Ogg Vorbis (as the audio manager does). */
export const trackSources = (id: TrackId): string[] => [`${BASE}/play-${id}.ogg`, `${BASE}/play-${id}.mp3`];

export const trackName = (choice: JukeboxChoice): string => (choice === "off" ? "Off" : TRACKS.find((track) => track.id === choice)!.name);

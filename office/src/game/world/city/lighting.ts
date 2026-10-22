import { getPosition } from "suncalc";

/**
 * Sky and lighting for the city scenes (phase O4 › 3), from the sun's real position at the
 * location. Pure. suncalc 2 reports degrees: altitude above the horizon, and azimuth clockwise
 * from north (0 N, 90 E). World axes: x east, z south, y up.
 */

export type Vec3 = [number, number, number];
export type SkyPhase = "day" | "golden" | "twilight" | "night";

export type SkyState = {
  /** Degrees. */
  altitude: number;
  azimuth: number;
  phase: SkyPhase;
  /** The sun is more than 6° below the horizon: moonlight, lamps and lit windows. */
  isNight: boolean;
  /** 0 by day, 1 at night; drives lamps, windows and stars smoothly through dusk. */
  night: number;
  /** Unit vector towards the sun (for the sky shader). */
  sun: Vec3;
  /** Unit vector towards the key light: the sun by day, the moon at night. */
  keyDirection: Vec3;
  keyColor: string;
  keyIntensity: number;
  hemisphere: { sky: string; ground: string; intensity: number };
  /** Gradient sky (low tier) and fog colours. */
  zenith: string;
  horizon: string;
};

/** Below this solar altitude it counts as night (civil twilight's end). */
export const NIGHT_ALTITUDE = -6;

type Stop = {
  altitude: number;
  zenith: string;
  horizon: string;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  keyColor: string;
  keyIntensity: number;
};

// Colour keys by solar altitude: warm and low at the horizon, cool moonlight below it. The key
// light dims to almost nothing at −3°, where it swaps from sun to moon, so the swap never shows.
const STOPS: Stop[] = [
  { altitude: -12, zenith: "#070f1c", horizon: "#1a2840", hemiSky: "#6a80a8", hemiGround: "#232a35", hemiIntensity: 0.95, keyColor: "#a9bfe6", keyIntensity: 0.75 },
  { altitude: -6, zenith: "#0f1c34", horizon: "#2d3955", hemiSky: "#71839f", hemiGround: "#262b34", hemiIntensity: 0.9, keyColor: "#adc0e2", keyIntensity: 0.62 },
  { altitude: -3, zenith: "#1d2f52", horizon: "#7a6476", hemiSky: "#8a83a0", hemiGround: "#2a2a32", hemiIntensity: 0.8, keyColor: "#c9a2a0", keyIntensity: 0.1 },
  { altitude: 0, zenith: "#2f4a78", horizon: "#e09a6e", hemiSky: "#c9a58e", hemiGround: "#3c3530", hemiIntensity: 0.72, keyColor: "#ff9a52", keyIntensity: 0.6 },
  { altitude: 6, zenith: "#5f86b4", horizon: "#f2c28e", hemiSky: "#f1d6b8", hemiGround: "#6a6052", hemiIntensity: 0.95, keyColor: "#ffc58a", keyIntensity: 1.6 },
  { altitude: 20, zenith: "#5a8fc6", horizon: "#cfe1ea", hemiSky: "#eef2f0", hemiGround: "#7d8a80", hemiIntensity: 1.2, keyColor: "#fff1de", keyIntensity: 2.4 },
  { altitude: 45, zenith: "#4f88c4", horizon: "#d6e6ee", hemiSky: "#f3f6f4", hemiGround: "#808d84", hemiIntensity: 1.3, keyColor: "#fff8ee", keyIntensity: 2.7 },
];

function hexToRgb(hex: string): Vec3 {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function rgbToHex([r, g, b]: Vec3): string {
  return `#${[r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("")}`;
}

export function mixHex(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex([ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t]);
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

/** A unit vector from a compass azimuth and an altitude, both in degrees. */
export function directionFrom(azimuth: number, altitude: number): Vec3 {
  const az = (azimuth * Math.PI) / 180;
  const alt = (altitude * Math.PI) / 180;
  return [Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt)];
}

export function skyPhase(altitude: number): SkyPhase {
  if (altitude < NIGHT_ALTITUDE) return "night";
  if (altitude < 0) return "twilight";
  if (altitude < 10) return "golden";
  return "day";
}

/** The sky for a solar altitude and azimuth (degrees). */
export function skyState(altitude: number, azimuth: number): SkyState {
  // The stops either side (clamped at the ends; t clamps too).
  const above = STOPS.findIndex((stop) => stop.altitude > altitude);
  const index = above === -1 ? STOPS.length - 1 : Math.max(1, above);
  const hi = STOPS[index];
  const lo = STOPS[index - 1];
  const t = clamp01((altitude - lo.altitude) / (hi.altitude - lo.altitude));
  const moonlit = altitude < -3;

  return {
    altitude,
    azimuth,
    phase: skyPhase(altitude),
    isNight: altitude < NIGHT_ALTITUDE,
    night: smoothstep(2, NIGHT_ALTITUDE, altitude),
    sun: directionFrom(azimuth, altitude),
    // The moon rides high opposite the sun; a sun just under the horizon still lights from 3°.
    keyDirection: moonlit ? directionFrom((azimuth + 180) % 360, 38) : directionFrom(azimuth, Math.max(3, altitude)),
    keyColor: mixHex(lo.keyColor, hi.keyColor, t),
    keyIntensity: lerp(lo.keyIntensity, hi.keyIntensity, t),
    hemisphere: {
      sky: mixHex(lo.hemiSky, hi.hemiSky, t),
      ground: mixHex(lo.hemiGround, hi.hemiGround, t),
      intensity: lerp(lo.hemiIntensity, hi.hemiIntensity, t),
    },
    zenith: mixHex(lo.zenith, hi.zenith, t),
    horizon: mixHex(lo.horizon, hi.horizon, t),
  };
}

/** The sky at a place and moment (real local time drives the city's lighting). */
export function skyAt(at: Date | number, lat: number, lon: number): SkyState {
  const { altitude, azimuth } = getPosition(new Date(at), lat, lon);
  return skyState(altitude, azimuth);
}

/** The Global Hub's fixed golden hour: low sun from the west-south-west. */
export const GOLDEN_HOUR = skyState(9, 250);

const hourFormats = new Map<string, Intl.DateTimeFormat>();

/** The local time of day at `timeZone`, in hours (14.5 = 2:30 pm). */
export function localHour(at: Date | number, timeZone: string): number {
  let format = hourFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" });
    hourFormats.set(timeZone, format);
  }
  const parts = format.formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return part("hour") + part("minute") / 60 + part("second") / 3600;
}

/** Today at `hour` o'clock local time in `timeZone` (the debug clock). */
export function atLocalHour(now: Date | number, timeZone: string, hour: number): Date {
  const time = typeof now === "number" ? now : now.getTime();
  return new Date(time + (hour - localHour(time, timeZone)) * 3_600_000);
}

import { getPosition } from "suncalc";

/**
 * Local-time formatting for the office locations (the globe's labels and list, O4's arrival
 * banner). Client-safe and deterministic: the strings are assembled from `formatToParts`, so the
 * server's and the browser's ICU (which disagree on spaces before "pm") render the same text.
 */

const timeFormats = new Map<string, Intl.DateTimeFormat>();
const offsetFormats = new Map<string, Intl.DateTimeFormat>();

function timeFormat(timeZone: string) {
  let format = timeFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "numeric", minute: "2-digit", hour12: true });
    timeFormats.set(timeZone, format);
  }
  return format;
}

function offsetFormat(timeZone: string) {
  let format = offsetFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-GB", { timeZone, timeZoneName: "shortOffset" });
    offsetFormats.set(timeZone, format);
  }
  return format;
}

/** "7:42 pm" in `timeZone` (an IANA name such as Asia/Karachi). */
export function formatLocalTime(at: Date | number, timeZone: string): string {
  const parts = timeFormat(timeZone).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("hour")}:${part("minute")} ${part("dayPeriod").toLowerCase()}`;
}

/** "UTC+5", "UTC+5:30", "UTC−3" or "UTC" for `timeZone` at that moment (DST included). */
export function formatUtcOffset(at: Date | number, timeZone: string): string {
  const name = offsetFormat(timeZone).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const offset = name.replace(/^(GMT|UTC)/, "");
  return offset ? `UTC${offset.replace("-", "−")}` : "UTC";
}

/** True while the sun is above the horizon at that place. */
export function isDaytime(at: Date | number, lat: number, lon: number): boolean {
  return getPosition(new Date(at), lat, lon).altitude > 0;
}

// Legal-form and generic suffixes dropped from an org name for short mentions.
const ORG_SUFFIX =
  /,?\s+(technologies|technology|inc\.?|incorporated|ltd\.?|limited|llc|plc|gmbh|ag|s\.?a\.?|corp\.?|corporation|co\.?|company|group|holdings)$/i;

/** "Simtora Technologies, Inc." → "Simtora" (the arrival banner's short mention). */
export function shortOrgName(name: string): string {
  let short = name.trim();
  for (let i = 0; i < 3; i++) {
    const next = short.replace(ORG_SUFFIX, "").trim();
    if (!next || next === short) break;
    short = next;
  }
  return short;
}

/** "§5.2 Annual leave" (web/src/lib/format.ts). */
export function sectionLabel(number: string | null | undefined, title: string | null | undefined): string {
  return [number ? `§${number}` : null, title].filter(Boolean).join(" ");
}

/** "p. 7" or "pp. 7–8" (web/src/lib/format.ts). */
export function pageLabel(start: number | null | undefined, end?: number | null): string {
  if (!start) return "";
  return end && end !== start ? `pp. ${start}–${end}` : `p. ${start}`;
}

/** "Headquarters" → "headquarters", while "R&D centre" keeps its capitals. */
function lowerFirst(label: string): string {
  return /^[A-Z][a-z]/.test(label) ? label[0].toLowerCase() + label.slice(1) : label;
}

export type Arrival = { title: string; details: string[] };

/**
 * The arrival banner (O4): "Lahore · 7:42 pm local time · Simtora R&D centre". The Global Hub
 * keeps a fixed golden hour, so it gets no clock.
 */
export function arrivalLines(
  place: { name: string; role: string; roleLabel: string; timezone: string },
  orgName: string,
  at: Date | number,
): Arrival {
  const org = shortOrgName(orgName);
  if (place.role === "hub") return { title: place.name, details: [`Kiosks lead to every ${org} office`] };
  return {
    title: place.name,
    details: [`${formatLocalTime(at, place.timezone)} local time`, `${org} ${lowerFirst(place.roleLabel)}`],
  };
}

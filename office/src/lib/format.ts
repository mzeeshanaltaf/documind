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

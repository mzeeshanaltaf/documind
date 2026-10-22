import { describe, expect, it } from "vitest";
import { formatLocalTime, formatUtcOffset, isDaytime } from "@/lib/format";

const at = (iso: string) => new Date(iso);

describe("formatLocalTime", () => {
  it("formats 12-hour local time with a lower-case day period", () => {
    expect(formatLocalTime(at("2026-10-22T14:42:00Z"), "Asia/Karachi")).toBe("7:42 pm");
    expect(formatLocalTime(at("2026-10-22T07:00:00Z"), "Asia/Karachi")).toBe("12:00 pm");
    expect(formatLocalTime(at("2026-10-22T19:05:00Z"), "Asia/Karachi")).toBe("12:05 am");
  });

  it("follows Berlin across both DST changes", () => {
    // Spring forward, 29 March 2026: 02:00 CET becomes 03:00 CEST at 01:00 UTC.
    expect(formatLocalTime(at("2026-03-29T00:59:00Z"), "Europe/Berlin")).toBe("1:59 am");
    expect(formatLocalTime(at("2026-03-29T01:00:00Z"), "Europe/Berlin")).toBe("3:00 am");
    expect(formatUtcOffset(at("2026-03-29T00:59:00Z"), "Europe/Berlin")).toBe("UTC+1");
    expect(formatUtcOffset(at("2026-03-29T01:00:00Z"), "Europe/Berlin")).toBe("UTC+2");
    // Fall back, 25 October 2026: 03:00 CEST becomes 02:00 CET at 01:00 UTC.
    expect(formatLocalTime(at("2026-10-25T00:59:00Z"), "Europe/Berlin")).toBe("2:59 am");
    expect(formatLocalTime(at("2026-10-25T01:00:00Z"), "Europe/Berlin")).toBe("2:00 am");
  });

  it("follows Sydney across both DST changes (southern hemisphere)", () => {
    // DST ends 5 April 2026: 03:00 AEDT becomes 02:00 AEST at 16:00 UTC the day before.
    expect(formatLocalTime(at("2026-04-04T15:59:00Z"), "Australia/Sydney")).toBe("2:59 am");
    expect(formatLocalTime(at("2026-04-04T16:00:00Z"), "Australia/Sydney")).toBe("2:00 am");
    expect(formatUtcOffset(at("2026-04-04T15:59:00Z"), "Australia/Sydney")).toBe("UTC+11");
    expect(formatUtcOffset(at("2026-04-04T16:00:00Z"), "Australia/Sydney")).toBe("UTC+10");
    // DST starts 4 October 2026: 02:00 AEST becomes 03:00 AEDT at 16:00 UTC the day before.
    expect(formatLocalTime(at("2026-10-03T15:59:00Z"), "Australia/Sydney")).toBe("1:59 am");
    expect(formatLocalTime(at("2026-10-03T16:00:00Z"), "Australia/Sydney")).toBe("3:00 am");
  });
});

describe("formatUtcOffset", () => {
  it("handles half hours, negative offsets and UTC itself", () => {
    expect(formatUtcOffset(at("2026-10-22T12:00:00Z"), "Asia/Kolkata")).toBe("UTC+5:30");
    expect(formatUtcOffset(at("2026-10-22T12:00:00Z"), "America/Los_Angeles")).toBe("UTC−7");
    expect(formatUtcOffset(at("2026-12-22T12:00:00Z"), "America/Los_Angeles")).toBe("UTC−8");
    expect(formatUtcOffset(at("2026-12-22T12:00:00Z"), "Europe/London")).toBe("UTC");
    expect(formatUtcOffset(at("2026-12-22T12:00:00Z"), "UTC")).toBe("UTC");
  });
});

describe("isDaytime", () => {
  it("tells day from night by the sun's altitude", () => {
    // Lahore at local noon (UTC+5), Sydney at 02:00 local (UTC+11 in October).
    expect(isDaytime(at("2026-10-22T07:00:00Z"), 31.52, 74.36)).toBe(true);
    expect(isDaytime(at("2026-10-21T15:00:00Z"), -33.87, 151.21)).toBe(false);
  });
});

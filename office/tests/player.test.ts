import { describe, expect, it } from "vitest";
import { defaultDisplayName, savePlayerSchema } from "@/lib/player";

describe("defaultDisplayName", () => {
  it("uses the first name plus the last initial", () => {
    expect(defaultDisplayName("Zeeshan Altaf")).toBe("Zeeshan A.");
    expect(defaultDisplayName("  Mary  Jane  watson ")).toBe("Mary W.");
  });

  it("keeps a single name and falls back to the email, then Player", () => {
    expect(defaultDisplayName("Cher")).toBe("Cher");
    expect(defaultDisplayName("", "sam.lee@example.com")).toBe("sam.lee");
    expect(defaultDisplayName(null, null)).toBe("Player");
  });

  it("caps the length", () => {
    expect(defaultDisplayName("x".repeat(80))).toHaveLength(40);
  });
});

describe("savePlayerSchema", () => {
  it("accepts partial avatar and settings", () => {
    const parsed = savePlayerSchema.parse({
      avatar: { skin: "#C68642" },
      settings: { quality: "low", reduced_motion: null, last_location: "lahore" },
    });
    expect(parsed.settings?.quality).toBe("low");
  });

  it("rejects unknown keys and bad values", () => {
    expect(savePlayerSchema.safeParse({ avatar: { hat: "#000000" } }).success).toBe(false);
    expect(savePlayerSchema.safeParse({ avatar: { skin: "red" } }).success).toBe(false);
    expect(savePlayerSchema.safeParse({ settings: { sound_volume: 2 } }).success).toBe(false);
    expect(savePlayerSchema.safeParse({ settings: { last_location: "../x" } }).success).toBe(false);
    expect(savePlayerSchema.safeParse({ display_name: "Admin" }).success).toBe(false);
  });
});

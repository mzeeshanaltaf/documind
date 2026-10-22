import { describe, expect, it } from "vitest";
import { effectiveTier, initialAutoTier, stepTier, TIERS } from "@/game/engine/quality";
import { AVATAR_PRESETS, DEFAULT_AVATAR, isFirstLook, resolveAvatar } from "@/game/player/avatar-style";
import {
  bootSettings,
  changedSettings,
  DEFAULT_SETTINGS,
  parseMirror,
  reducedMotion,
  resolveSettings,
} from "@/game/settings";

describe("quality tiers", () => {
  it("steps one tier at a time and clamps at the ends", () => {
    expect(stepTier("medium", -1)).toBe("low");
    expect(stepTier("medium", 1)).toBe("high");
    expect(stepTier("low", -1)).toBe("low");
    expect(stepTier("high", 1)).toBe("high");
  });

  it("lets the setting override the automatic tier", () => {
    expect(effectiveTier("auto", "high")).toBe("high");
    expect(effectiveTier("low", "high")).toBe("low");
  });

  it("matches the phase doc's table", () => {
    expect(TIERS.low).toMatchObject({ dpr: 1, shadows: false, maxNpcs: 6, post: false });
    expect(TIERS.medium).toMatchObject({ dpr: 1.5, shadows: true, shadowMap: 1024, maxNpcs: 12, post: false });
    expect(TIERS.high).toMatchObject({ dpr: 2, shadows: true, shadowMap: 2048, maxNpcs: 24, post: true });
  });

  it("starts phones and small machines low, others medium", () => {
    expect(initialAutoTier({ coarsePointer: true, cores: 12 })).toBe("low");
    expect(initialAutoTier({ coarsePointer: false, cores: 4 })).toBe("low");
    expect(initialAutoTier({ coarsePointer: false, cores: 8, memoryGb: 4 })).toBe("low");
    expect(initialAutoTier({ coarsePointer: false, cores: 8, memoryGb: 16 })).toBe("medium");
    expect(initialAutoTier({ coarsePointer: false })).toBe("medium");
  });
});

describe("settings", () => {
  it("fills in defaults", () => {
    expect(resolveSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(resolveSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(resolveSettings({ quality: "low" }).quality).toBe("low");
  });

  it("drops invalid or unknown keys one by one, keeping the valid ones", () => {
    const settings = resolveSettings({ quality: "ultra", sound_volume: 0.2, music_volume: 7, bogus: true });
    expect(settings.quality).toBe("auto");
    expect(settings.sound_volume).toBe(0.2);
    expect(settings.music_volume).toBe(DEFAULT_SETTINGS.music_volume);
    expect(settings).not.toHaveProperty("bogus");
  });

  it("parses the mirror defensively", () => {
    expect(parseMirror(null)).toBeNull();
    expect(parseMirror("not json")).toBeNull();
    expect(parseMirror(JSON.stringify({ settings: {} }))).toBeNull();
    expect(parseMirror(JSON.stringify({ settings: { quality: "low" }, at: 5 }))).toEqual({ settings: { quality: "low" }, at: 5 });
  });

  it("boots from the mirror only when it's newer than the DB row", () => {
    const server = { quality: "high" as const, sound_volume: 0.5 };
    const updatedAt = "2026-10-22T10:00:00.000Z";
    const at = Date.parse(updatedAt);
    expect(bootSettings(server, updatedAt, { settings: { quality: "low" }, at: at + 1000 }).quality).toBe("low");
    expect(bootSettings(server, updatedAt, { settings: { quality: "low" }, at: at - 1000 }).quality).toBe("high");
    expect(bootSettings(server, updatedAt, null)).toMatchObject({ quality: "high", sound_volume: 0.5 });
    // Keys the mirror doesn't have still come from the row.
    expect(bootSettings(server, updatedAt, { settings: { quality: "low" }, at: at + 1 }).sound_volume).toBe(0.5);
  });

  it("lists only the changed keys", () => {
    const next = { ...DEFAULT_SETTINGS, quality: "low" as const, show_name_tags: false };
    expect(changedSettings(next, DEFAULT_SETTINGS)).toEqual({ quality: "low", show_name_tags: false });
    expect(changedSettings(DEFAULT_SETTINGS, DEFAULT_SETTINGS)).toEqual({});
  });

  it("follows the OS for reduced motion unless overridden", () => {
    expect(reducedMotion(null, true)).toBe(true);
    expect(reducedMotion(null, false)).toBe(false);
    expect(reducedMotion(false, true)).toBe(false);
    expect(reducedMotion(true, false)).toBe(true);
  });
});

describe("avatar style", () => {
  it("fills missing colours from the defaults and lower-cases hex", () => {
    expect(resolveAvatar({})).toEqual(DEFAULT_AVATAR);
    expect(resolveAvatar({ top: "#9C4535" })).toEqual({ ...DEFAULT_AVATAR, top: "#9c4535" });
  });

  it("ignores an invalid stored avatar", () => {
    expect(resolveAvatar({ top: "red" } as never)).toEqual(DEFAULT_AVATAR);
  });

  it("knows a first look", () => {
    expect(isFirstLook({})).toBe(true);
    expect(isFirstLook(null)).toBe(true);
    expect(isFirstLook({ skin: "#c68a5e" })).toBe(false);
  });

  it("has valid, distinct preset swatches including every default", () => {
    for (const [slot, presets] of Object.entries(AVATAR_PRESETS)) {
      const hexes = presets.map((preset) => preset.hex);
      expect(new Set(hexes).size).toBe(hexes.length);
      for (const hex of hexes) expect(hex).toMatch(/^#[0-9a-f]{6}$/);
      expect(hexes).toContain(DEFAULT_AVATAR[slot as keyof typeof DEFAULT_AVATAR]);
    }
  });
});

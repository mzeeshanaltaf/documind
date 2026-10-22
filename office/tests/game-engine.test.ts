import { Quaternion } from "three";
import { describe, expect, it, vi } from "vitest";
import { avatarClips, CLIP_NAMES, JOINTS } from "@/game/player/avatar-clips";
import { createBus } from "@/game/quests/bus";

describe("event bus", () => {
  it("delivers typed events to their listeners and to catch-all listeners", () => {
    const bus = createBus();
    const talked = vi.fn();
    const any = vi.fn();
    bus.on("npc_talked", talked);
    bus.onAny(any);
    bus.emit({ type: "npc_talked", npc: "hina" });
    bus.emit({ type: "sat", seat: "chair" });
    expect(talked).toHaveBeenCalledExactlyOnceWith({ type: "npc_talked", npc: "hina" });
    expect(any).toHaveBeenCalledTimes(2);
  });

  it("unsubscribes, and keeps going when a listener throws", () => {
    const bus = createBus();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const after = vi.fn();
    bus.on("sat", () => {
      throw new Error("boom");
    });
    const off = bus.on("sat", after);
    bus.emit({ type: "sat", seat: "chair" });
    expect(after).toHaveBeenCalledOnce();
    off();
    bus.emit({ type: "sat", seat: "chair" });
    expect(after).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("avatar clips", () => {
  const clips = avatarClips();

  it("has every clip the phase needs, built once", () => {
    expect(clips.map((clip) => clip.name)).toEqual([...CLIP_NAMES]);
    expect(avatarClips()).toBe(clips);
  });

  it("targets only the rig's joints (and the hips position)", () => {
    const targets = new Set([...JOINTS.map((joint) => `${joint}.quaternion`), "hips.position"]);
    for (const clip of clips) {
      expect(clip.tracks.length).toBeGreaterThan(0);
      for (const track of clip.tracks) expect(targets).toContain(track.name);
    }
  });

  it("loops seamlessly: every track ends where it starts", () => {
    for (const clip of clips) {
      for (const track of clip.tracks) {
        const size = track.getValueSize();
        const first = Array.from(track.values.slice(0, size));
        const last = Array.from(track.values.slice(-size));
        expect(last).toEqual(first);
        expect(track.times.at(-1)).toBeCloseTo(clip.duration);
      }
    }
  });

  it("stores unit quaternions", () => {
    const q = new Quaternion();
    for (const clip of clips) {
      for (const track of clip.tracks.filter((t) => t.name.endsWith(".quaternion"))) {
        for (let i = 0; i < track.values.length; i += 4) {
          q.fromArray(track.values, i);
          expect(q.length()).toBeCloseTo(1, 5);
        }
      }
    }
  });
});

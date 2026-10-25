import { beforeEach, describe, expect, it } from "vitest";
import { actionForCode } from "@/game/input/bindings";
import { closeEmoteWheel, highlightEmote, openEmoteWheel, performEmote, releaseEmoteWheel } from "@/game/player/emote-actions";
import { EMOTES } from "@/game/player/emotes";
import { CAFFEINE_BOOST, CAFFEINE_SECONDS } from "@/game/player/boost";
import { bus } from "@/game/quests/bus";
import { useGame } from "@/game/store/game-store";
import { SAMPLE_DEPARTMENTS } from "@/game/world/office/use-floorplan";
import { buildFloorplan, insideRect, rectEdges } from "@/game/world/office/floorplan";
import { beanbagSeats, doorLane, playLayout } from "@/game/world/office/play/layout";
import { playParts } from "@/game/world/office/play/furniture";
import { TRACKS, trackSources } from "@/game/audio/jukebox";

// Phase O8 › Tests: the play area's layout (nothing blocks the door, every station can be reached),
// its furniture, the emote wheel and the coffee boost's numbers.

type BoxLike = { center: [number, number, number]; half: [number, number, number] };

const plan = buildFloorplan(SAMPLE_DEPARTMENTS);
const room = plan.rooms.find((r) => r.kind === "play")!;
const door = plan.doors.find((d) => d.to === "play")!;
const layout = playLayout(room, door);

const overlaps = (a: BoxLike, b: BoxLike) =>
  [0, 1, 2].every((axis) => Math.abs(a.center[axis] - b.center[axis]) < a.half[axis] + b.half[axis] - 1e-6);
const containsPoint = (box: BoxLike, x: number, z: number, margin = 0) =>
  Math.abs(x - box.center[0]) < box.half[0] + margin && Math.abs(z - box.center[2]) < box.half[2] + margin;

describe("the play area's layout", () => {
  it("keeps every solid piece inside the room's walls", () => {
    const { x0, x1, z0, z1 } = rectEdges(room.rect);
    for (const box of layout.colliders) {
      expect(box.center[0] - box.half[0]).toBeGreaterThanOrEqual(x0 + 0.1 - 1e-6);
      expect(box.center[0] + box.half[0]).toBeLessThanOrEqual(x1 - 0.1 + 1e-6);
      expect(box.center[2] - box.half[2]).toBeGreaterThanOrEqual(z0 + 0.1 - 1e-6);
      expect(box.center[2] + box.half[2]).toBeLessThanOrEqual(z1 - 0.1 + 1e-6);
    }
  });

  it("never blocks the doorway or the lane into the room", () => {
    const lane = doorLane(room, door);
    for (const box of layout.colliders) expect(overlaps(box, lane)).toBe(false);
  });

  it("has no two solid pieces overlapping", () => {
    layout.colliders.forEach((a, i) => layout.colliders.slice(i + 1).forEach((b) => expect(overlaps(a, b)).toBe(false)));
  });

  it("offers each station from open floor inside the room, with a reachable prompt", () => {
    expect(layout.stations.map((s) => s.id).sort()).toEqual(["coffee", "jukebox", "leaderboard", "sort_toss", "table_tennis", "trivia"]);
    const lane = doorLane(room, door);
    for (const station of layout.stations) {
      const [x, , z] = station.spot;
      expect(insideRect(room.rect, x, z, 0.3), station.id).toBe(true);
      // Table tennis is measured from the table's middle (it is solid, the player stands round it).
      if (station.id !== "table_tennis") for (const box of layout.colliders) expect(containsPoint(box, x, z, 0.1), `${station.id} spot inside a piece`).toBe(false);
      expect(station.radius).toBeGreaterThan(0.9);
      expect(containsPoint(lane, x, z), `${station.id} in the doorway`).toBe(false);
    }
    // The ring round the table is walkable all the way: someone standing 1 m from its middle is in range.
    const table = layout.stations.find((s) => s.id === "table_tennis")!;
    expect(table.radius).toBeGreaterThan(layout.table.length / 2 + 0.5);
  });

  it("gives every station its own prompt: no two spots are close enough to be confused", () => {
    for (const a of layout.stations) {
      for (const b of layout.stations) {
        if (a.id >= b.id) continue;
        const gap = Math.hypot(a.spot[0] - b.spot[0], a.spot[2] - b.spot[2]);
        expect(gap, `${a.id} / ${b.id}`).toBeGreaterThan(1.5);
      }
    }
  });

  it("seats three beanbags round the rug, each facing the middle of the room and standing up onto free floor", () => {
    const seats = beanbagSeats(layout);
    expect(seats).toHaveLength(3);
    expect(new Set(seats.map((s) => s.id)).size).toBe(3);
    for (const seat of seats) {
      expect(seat.relaxed).toBe(true);
      // In front of the bag (where standing up lands the player) is free floor.
      const front: [number, number] = [seat.position[0] + Math.sin(seat.yaw) * 0.6, seat.position[2] + Math.cos(seat.yaw) * 0.6];
      expect(insideRect(room.rect, front[0], front[1], 0.3)).toBe(true);
      for (const box of layout.colliders) if (box.center[0] > 0 && !(Math.abs(box.center[0] - seat.position[0]) < 0.5 && Math.abs(box.center[2] - seat.position[2]) < 0.5)) expect(containsPoint(box, front[0], front[1])).toBe(false);
      // Facing the room's middle: the bag's heading points at it.
      const toMiddle = Math.atan2(room.rect.x - seat.position[0], room.rect.z - seat.position[2]);
      expect(Math.abs(Math.atan2(Math.sin(seat.yaw - toMiddle), Math.cos(seat.yaw - toMiddle)))).toBeLessThan(0.7);
    }
  });

  it("puts the leaderboard panel on the north wall at a 3.8:1 shape, clear of the ceiling", () => {
    const { center, width, height } = layout.wall;
    expect(center[2]).toBeCloseTo(rectEdges(room.rect).z0 + 0.14, 6);
    expect(width / height).toBeCloseTo(1536 / 404, 1);
    expect(center[1] + height / 2).toBeLessThan(3.1);
    expect(center[1] - height / 2).toBeGreaterThan(0.6);
  });

  it("builds its furniture as merged parts", () => {
    const { matte, glow } = playParts(room, layout);
    expect(matte.length).toBeGreaterThan(80);
    expect(glow.length).toBeGreaterThan(8);
    for (const part of [...matte, ...glow]) expect(part.color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("works for a single-department office too", () => {
    const small = buildFloorplan(["HR"]);
    const smallRoom = small.rooms.find((r) => r.kind === "play")!;
    const smallLayout = playLayout(smallRoom, small.doors.find((d) => d.to === "play")!);
    expect(smallLayout.colliders.length).toBe(layout.colliders.length);
  });
});

describe("the jukebox tracks", () => {
  it("lists three tracks, each with Ogg then MP3", () => {
    expect(TRACKS.map((t) => t.id)).toEqual(["lounge", "arcade", "bossa"]);
    expect(trackSources("bossa")).toEqual(["/assets/audio/music/play-bossa.ogg", "/assets/audio/music/play-bossa.mp3"]);
  });
});

describe("the emote wheel and the coffee boost", () => {
  beforeEach(() => {
    bus.clear();
    useGame.setState({
      world: { ...useGame.getState().world, phase: "ready" },
      modal: null,
      player: { ...useGame.getState().player, pose: "stand", seat: null },
      emote: null,
      emoteWheel: { open: false, highlight: null },
      caffeinatedUntil: 0,
    });
  });

  it("binds Q to the wheel", () => {
    expect(actionForCode("KeyQ")).toBe("emote");
  });

  it("opens only when the player is free, and closes without playing when nothing is highlighted", () => {
    useGame.setState({ modal: { type: "menu" } });
    openEmoteWheel();
    expect(useGame.getState().emoteWheel.open).toBe(false);
    useGame.setState({ modal: null });
    openEmoteWheel();
    expect(useGame.getState().emoteWheel.open).toBe(true);
    releaseEmoteWheel();
    expect(useGame.getState().emoteWheel.open).toBe(false);
    expect(useGame.getState().emote).toBeNull();
  });

  it("plays the highlighted gesture on release and emits emote_used", () => {
    const seen: string[] = [];
    bus.on("emote_used", (event) => seen.push(event.emote));
    openEmoteWheel();
    highlightEmote(2);
    expect(useGame.getState().emoteWheel.highlight).toBe(2);
    releaseEmoteWheel();
    const emote = useGame.getState().emote;
    expect(emote).toMatchObject({ id: "dance", clip: "dance" });
    expect(emote!.until).toBeGreaterThan(performance.now());
    expect(useGame.getState().emoteWheel.open).toBe(false);
    expect(seen).toEqual(["dance"]);
  });

  it("plays a chosen gesture at once, and not while seated", () => {
    performEmote("wave");
    expect(useGame.getState().emote?.id).toBe("wave");
    useGame.setState({ emote: null, player: { ...useGame.getState().player, pose: "sit" } });
    performEmote("cheer");
    expect(useGame.getState().emote).toBeNull();
    closeEmoteWheel();
  });

  it("has three emotes with clips the avatar knows", () => {
    expect(EMOTES.map((e) => e.clip)).toEqual(["wave", "cheer", "dance"]);
    for (const emote of EMOTES) expect(emote.seconds).toBeGreaterThan(1);
  });

  it("boosts running by about a third for 30 seconds", () => {
    expect(CAFFEINE_SECONDS).toBe(30);
    expect(CAFFEINE_BOOST).toBeGreaterThan(1.2);
    expect(CAFFEINE_BOOST).toBeLessThan(1.6);
    useGame.getState().setCaffeinatedUntil(Date.now() + CAFFEINE_SECONDS * 1000);
    expect(useGame.getState().caffeinatedUntil).toBeGreaterThan(Date.now() + 29_000);
  });
});

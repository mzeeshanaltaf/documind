import { Euler, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { buildEarthGeometry } from "@/game/world/globe/earth-geometry";
import {
  type EarthMask,
  facing,
  greatCircleArc,
  isLand,
  latLonToVector,
  nearestAngle,
  placeLabels,
  toSegments,
  vectorToLatLon,
} from "@/game/world/globe/geo";

describe("globe coordinates", () => {
  it("puts 0/0 towards the camera (+z), north up and east right", () => {
    expect(latLonToVector(0, 0)).toEqual([0, 0, 1]);
    const north = latLonToVector(90, 0);
    expect(north[1]).toBeCloseTo(1);
    const east = latLonToVector(0, 90);
    expect(east[0]).toBeCloseTo(1);
  });

  it("round-trips lat/lon", () => {
    for (const [lat, lon] of [
      [31.52, 74.36],
      [-33.87, 151.21],
      [37.77, -122.42],
    ]) {
      const back = vectorToLatLon(latLonToVector(lat, lon, 1.3));
      expect(back.lat).toBeCloseTo(lat, 6);
      expect(back.lon).toBeCloseTo(lon, 6);
    }
  });

  it("turns a place to face the camera", () => {
    for (const [lat, lon] of [
      [52.52, 13.4],
      [-33.87, 151.21],
      [37.77, -122.42],
    ]) {
      const { tilt, spin } = facing(lat, lon);
      const turned = new Vector3(...latLonToVector(lat, lon)).applyEuler(new Euler(tilt, spin, 0));
      expect(turned.z).toBeCloseTo(1, 6);
    }
  });

  it("takes the short way round", () => {
    expect(nearestAngle(6, 0.2)).toBeCloseTo(0.2 + Math.PI * 2);
    expect(nearestAngle(-0.1, 6.2)).toBeCloseTo(6.2 - Math.PI * 2);
    expect(nearestAngle(1, 1.5)).toBeCloseTo(1.5);
  });
});

describe("greatCircleArc", () => {
  it("starts and ends on the two places and lifts in between", () => {
    const a = latLonToVector(37.77, -122.42, 1);
    const b = latLonToVector(31.52, 74.36, 1);
    const points = greatCircleArc(a, b, 32, 0.2);
    expect(points).toHaveLength(33);
    points[0].forEach((value, i) => expect(value).toBeCloseTo(a[i]));
    points[32].forEach((value, i) => expect(value).toBeCloseTo(b[i]));
    expect(Math.hypot(...points[16])).toBeGreaterThan(1.1);
    expect(toSegments(points)).toHaveLength(64);
  });
});

/** A 4×2 mask: the eastern hemisphere north of the equator is land. */
const MASK: EarthMask = { width: 4, height: 2, data: new Uint8Array([0, 0, 255, 255, 0, 0, 0, 0]) };

describe("land mask", () => {
  it("samples equirectangular pixels", () => {
    expect(isLand(MASK, 45, 90)).toBe(true);
    expect(isLand(MASK, 45, -90)).toBe(false);
    expect(isLand(MASK, -45, 90)).toBe(false);
    // Longitudes wrap.
    expect(isLand(MASK, 45, 90 + 360)).toBe(true);
  });

  it("raises land faces and colours both", () => {
    const geometry = buildEarthGeometry(2, MASK, { land: ["#ffffff"], sea: ["#000000"] });
    const position = geometry.getAttribute("position");
    const color = geometry.getAttribute("color");
    let land = 0;
    for (let i = 0; i < position.count; i++) {
      const radius = Math.hypot(position.getX(i), position.getY(i), position.getZ(i));
      const white = color.getX(i) > 0.5;
      expect(radius).toBeCloseTo(white ? 1.012 : 1, 3);
      if (white) land++;
    }
    expect(land).toBeGreaterThan(0);
    expect(land).toBeLessThan(position.count / 2);
    geometry.dispose();
  });
});

describe("placeLabels", () => {
  const overlap = (a: { x: number; y: number }, b: { x: number; y: number }, w: number, h: number) =>
    a.x < b.x + w && b.x < a.x + w && a.y < b.y + h && b.y < a.y + h;

  it("keeps close labels apart (London, Paris, Berlin)", () => {
    const size = { width: 110, height: 34 };
    const items = [
      { anchor: { x: 300, y: 200 }, ...size },
      { anchor: { x: 336, y: 199 }, ...size },
      { anchor: { x: 310, y: 222 }, ...size },
    ];
    const spots = placeLabels(items, { width: 800, height: 600 });
    expect(spots.every((spot) => !spot.hidden)).toBe(true);
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        expect(overlap(spots[i], spots[j], size.width, size.height)).toBe(false);
      }
    }
  });

  it("hides a label with no clean spot, unless it's kept", () => {
    const size = { width: 110, height: 34 };
    // Hemmed in by the view's edges: only one label fits beside these pins.
    const bounds = { width: 140, height: 80 };
    const pins = [
      { anchor: { x: 10, y: 40 }, ...size },
      { anchor: { x: 14, y: 42 }, ...size },
    ];
    const [first, second] = placeLabels(pins, bounds);
    expect(first.hidden).toBe(false);
    expect(second.hidden).toBe(true);
    expect(placeLabels([pins[0], { ...pins[1], keep: true }], bounds)[1].hidden).toBe(false);
  });

  it("prefers the right-hand side when there's room, and stays in view", () => {
    const [spot] = placeLabels([{ anchor: { x: 100, y: 100 }, width: 80, height: 30 }]);
    expect(spot).toEqual({ x: 112, y: 85, placement: "right", hidden: false });
    const [edge] = placeLabels([{ anchor: { x: 380, y: 100 }, width: 80, height: 30 }], { width: 400, height: 300 });
    expect(edge.placement).toBe("left");
  });
});

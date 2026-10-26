/**
 * Globe maths (pure). The globe is a unit sphere: latitude/longitude 0/0 faces +z (the camera),
 * north is +y and east is +x. The Earth group is rotated by Euler (tilt, spin, 0) in three's
 * default XYZ order, so `facing(lat, lon)` turns a place to face the camera.
 */
export type Vec3 = [number, number, number];

const DEG = Math.PI / 180;

export function latLonToVector(lat: number, lon: number, radius = 1): Vec3 {
  const phi = lat * DEG;
  const lambda = lon * DEG;
  return [radius * Math.cos(phi) * Math.sin(lambda), radius * Math.sin(phi), radius * Math.cos(phi) * Math.cos(lambda)];
}

export function vectorToLatLon([x, y, z]: Vec3): { lat: number; lon: number } {
  const length = Math.hypot(x, y, z) || 1;
  return { lat: Math.asin(Math.max(-1, Math.min(1, y / length))) / DEG, lon: Math.atan2(x, z) / DEG };
}

/** The group rotation (radians) that brings lat/lon to the point nearest the camera. */
export function facing(lat: number, lon: number): { tilt: number; spin: number } {
  return { tilt: lat * DEG, spin: -lon * DEG };
}

/** `to`, shifted by whole turns to be as close as possible to `from` (the short way round). */
export function nearestAngle(from: number, to: number): number {
  const turn = Math.PI * 2;
  return to + Math.round((from - to) / turn) * turn;
}

/**
 * Points along the great circle from a to b, lifted off the surface in a smooth hump whose height
 * grows with the distance (`lift` × the angle in radians). `segments` + 1 points.
 */
export function greatCircleArc(a: Vec3, b: Vec3, segments = 32, lift = 0.25): Vec3[] {
  const unit = (v: Vec3): Vec3 => {
    const length = Math.hypot(...v) || 1;
    return [v[0] / length, v[1] / length, v[2] / length];
  };
  const u = unit(a);
  const v = unit(b);
  const dot = Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2]));
  const angle = Math.acos(dot);
  const sin = Math.sin(angle);
  const points: Vec3[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    // Slerp; nearly identical points fall back to a straight blend.
    const wa = sin < 1e-6 ? 1 - t : Math.sin((1 - t) * angle) / sin;
    const wb = sin < 1e-6 ? t : Math.sin(t * angle) / sin;
    const height = 1 + Math.sin(Math.PI * t) * lift * angle;
    points.push([
      (u[0] * wa + v[0] * wb) * height,
      (u[1] * wa + v[1] * wb) * height,
      (u[2] * wa + v[2] * wb) * height,
    ]);
  }
  return points;
}

/** A polyline as line-segment pairs (p0 p1, p1 p2, …), the input LineSegments2 wants. */
export function toSegments(points: Vec3[]): Vec3[] {
  const pairs: Vec3[] = [];
  for (let i = 1; i < points.length; i++) pairs.push(points[i - 1], points[i]);
  return pairs;
}

/** A land/sea mask: one byte per pixel of an equirectangular image (row 0 = 90°N). */
export type EarthMask = { width: number; height: number; data: Uint8Array };

export function isLand(mask: EarthMask, lat: number, lon: number): boolean {
  const u = (((lon + 180) / 360) % 1 + 1) % 1;
  const v = Math.min(0.9999, Math.max(0, (90 - lat) / 180));
  const x = Math.min(mask.width - 1, Math.floor(u * mask.width));
  const y = Math.floor(v * mask.height);
  return mask.data[y * mask.width + x] > 127;
}

/** Smooth start and end, for the camera fly. */
export function easeInOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

export type LabelRect = { x: number; y: number; width: number; height: number };

/** Where a label sits relative to its pin, tried in this order. */
const PLACEMENTS = ["right", "left", "below", "above", "right-up", "right-down", "left-up", "left-down"] as const;
export type Placement = (typeof PLACEMENTS)[number];

/** The area two rects share, with `gap` kept clear around `b`. */
function overlapArea(a: LabelRect, b: LabelRect, gap: number) {
  const w = Math.min(a.x + a.width, b.x + b.width + gap) - Math.max(a.x, b.x - gap);
  const h = Math.min(a.y + a.height, b.y + b.height + gap) - Math.max(a.y, b.y - gap);
  return w > 0 && h > 0 ? w * h : 0;
}

/** The part of a rect that falls outside the view. */
function outsideArea(rect: LabelRect, bounds: { width: number; height: number }) {
  const inside = overlapArea(rect, { x: 0, y: 0, ...bounds }, 0);
  return rect.width * rect.height - inside;
}

/** A label that can't find a clean spot is dropped once it would overlap more than this share. */
const CROWDED = 0.15;

export type LabelItem = {
  anchor: { x: number; y: number };
  width: number;
  height: number;
  /** Always shown (the hovered or chosen pin), even when crowded. */
  keep?: boolean;
  /** Shown on the previous frame: it needs a clearly worse spot to be dropped (no flicker at the edge). */
  wasShown?: boolean;
};

/** A label that was already showing stays until it would overlap this share. */
const CROWDED_STICKY = 0.45;

/**
 * Greedy label placement around pins (screen pixels, y down). Labels are placed in the given
 * order, so put the important ones first. Each takes the first spot that clears the labels
 * already placed, every pin and the view's edges; failing that, the least crowded spot, or it's
 * hidden (its pin stays, and hovering it brings the label back as a kept one).
 */
export function placeLabels(
  items: LabelItem[],
  bounds: { width: number; height: number } = { width: Infinity, height: Infinity },
  offset = 12,
  gap = 4,
): { x: number; y: number; placement: Placement; hidden: boolean }[] {
  const placed: LabelRect[] = [];
  const pins: LabelRect[] = items.map(({ anchor }) => ({ x: anchor.x - 5, y: anchor.y - 5, width: 10, height: 10 }));
  return items.map(({ anchor, width, height, keep = false, wasShown = false }) => {
    const rectFor = (placement: Placement): LabelRect => {
      const side = { x: anchor.x + offset, y: anchor.y - height / 2 };
      const other = { x: anchor.x - offset - width, y: anchor.y - height / 2 };
      const up = anchor.y - height - offset / 2;
      const down = anchor.y + offset / 2;
      switch (placement) {
        case "right":
          return { ...side, width, height };
        case "left":
          return { ...other, width, height };
        case "below":
          return { x: anchor.x - width / 2, y: anchor.y + offset, width, height };
        case "above":
          return { x: anchor.x - width / 2, y: anchor.y - offset - height, width, height };
        case "right-up":
          return { x: side.x, y: up, width, height };
        case "right-down":
          return { x: side.x, y: down, width, height };
        case "left-up":
          return { x: other.x, y: up, width, height };
        case "left-down":
          return { x: other.x, y: down, width, height };
      }
    };
    const score = (rect: LabelRect) =>
      placed.reduce((sum, other) => sum + overlapArea(rect, other, gap), 0) +
      pins.reduce((sum, pin) => sum + overlapArea(rect, pin, 0), 0) +
      outsideArea(rect, bounds);

    let best: { placement: Placement; rect: LabelRect; score: number } | null = null;
    for (const placement of PLACEMENTS) {
      const rect = rectFor(placement);
      const value = score(rect);
      if (!best || value < best.score) best = { placement, rect, score: value };
      if (value === 0) break;
    }
    const { placement, rect, score: crowding } = best!;
    const hidden = !keep && crowding > (wasShown ? CROWDED_STICKY : CROWDED) * width * height;
    if (!hidden) placed.push(rect);
    return { x: rect.x, y: rect.y, placement, hidden };
  });
}

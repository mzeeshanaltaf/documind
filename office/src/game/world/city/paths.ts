/**
 * Closed paths for ambient traffic: rounded-rectangle loops round the city blocks, sampled by
 * distance. Pure. Coordinates are on the ground plane (x east, z south); a heading is a yaw
 * (rotation about y, 0 faces +z), the avatar's convention.
 */

export type Point = { x: number; z: number };

export type Loop = {
  id: string;
  /** Closed: the last point joins back to the first. */
  points: Point[];
  /** Distance from the first point to each point along the loop. */
  distances: number[];
  length: number;
};

export type LoopSample = { x: number; z: number; heading: number };

export function makeLoop(id: string, points: Point[]): Loop {
  const distances = [0];
  for (let i = 1; i < points.length; i++) {
    distances.push(distances[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z));
  }
  const last = points[points.length - 1];
  const length = distances[distances.length - 1] + Math.hypot(points[0].x - last.x, points[0].z - last.z);
  return { id, points, distances, length };
}

/**
 * A square loop of half-size `half` round (cx, cz) with corners of `radius`, clockwise as seen
 * from above (east along the north side first) or the other way round.
 */
export function roundedSquareLoop(
  id: string,
  { cx = 0, cz = 0, half, radius, clockwise, arcSteps = 6 }: {
    cx?: number;
    cz?: number;
    half: number;
    radius: number;
    clockwise: boolean;
    arcSteps?: number;
  },
): Loop {
  const inner = half - radius;
  // Corner centres NE, SE, SW, NW; with z pointing south, increasing angle runs clockwise.
  const corners: [number, number][] = [
    [1, -1],
    [1, 1],
    [-1, 1],
    [-1, -1],
  ];
  const points: Point[] = [];
  corners.forEach(([sx, sz], k) => {
    const start = -Math.PI / 2 + (k * Math.PI) / 2;
    for (let s = 0; s <= arcSteps; s++) {
      const angle = start + ((Math.PI / 2) * s) / arcSteps;
      points.push({ x: cx + sx * inner + radius * Math.cos(angle), z: cz + sz * inner + radius * Math.sin(angle) });
    }
  });
  if (!clockwise) points.reverse();
  return makeLoop(id, points);
}

/** The point `distance` metres along the loop (wrapping), and the heading there. */
export function sampleLoop(loop: Loop, distance: number): LoopSample {
  const { points, distances, length } = loop;
  const d = ((distance % length) + length) % length;
  // Binary search for the segment that contains d.
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (distances[mid] <= d) lo = mid;
    else hi = mid - 1;
  }
  const a = points[lo];
  const b = points[(lo + 1) % points.length];
  const segmentEnd = lo + 1 < points.length ? distances[lo + 1] : length;
  const span = segmentEnd - distances[lo];
  const t = span > 0 ? (d - distances[lo]) / span : 0;
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, heading: Math.atan2(b.x - a.x, b.z - a.z) };
}

import type { CityCollider } from "../generator";
import { beam, box, cone, cylinder, Merged, type Part } from "../merge";
import { Anchored, type LandmarkProps, LocalColliders, Water } from "./common";

/**
 * London: Elizabeth Tower in the vista park (ribbed shaft, a clock face on each side, the
 * belfry, the slate spire with its gilded tip) and Tower Bridge over the river beyond, its two
 * towers, high walkways and pale-blue suspension chains. Red buses and black cabs come from the
 * traffic fleet.
 */
const STONE = "#cdb98e";
const FACE = "#f3eedf";
const DARK = "#2f3432";
const GOLD = "#c9a24a";
const BRIDGE_STONE = "#c8c2b5";
const BLUE = "#7fa6c4";

function elizabethTower(): Part[] {
  const parts: Part[] = [];
  const add = (color: string, geometry: Part["geometry"]) => parts.push({ color, geometry });
  add(STONE, box(6.4, 1.2, 6.4, { at: [0, 0.6, 0] }));
  add(STONE, box(5, 22, 5, { at: [0, 12, 0] }));
  // Vertical ribs up the shaft's faces.
  for (const t of [-1.9, -0.65, 0.65, 1.9]) {
    for (const [x, z, w, d] of [
      [t, 2.55, 0.22, 0.2],
      [t, -2.55, 0.22, 0.2],
      [2.55, t, 0.2, 0.22],
      [-2.55, t, 0.2, 0.22],
    ]) {
      add(STONE, box(w, 21, d, { at: [x, 12, z] }));
    }
  }
  add(STONE, box(6.2, 6.2, 6.2, { at: [0, 26.1, 0] }));
  // A clock on each side: a face, a dark rim, two hands at ten to two.
  for (let k = 0; k < 4; k++) {
    const angle = (k * Math.PI) / 2;
    const out = (d: number): [number, number, number] => [Math.sin(angle) * d, 26.2, Math.cos(angle) * d];
    add(DARK, cylinder(2.45, 2.45, 0.1, 20, { at: out(3.12), rot: [Math.PI / 2, angle, 0], order: "YXZ" }));
    add(FACE, cylinder(2.25, 2.25, 0.1, 20, { at: out(3.18), rot: [Math.PI / 2, angle, 0], order: "YXZ" }));
    // Each hand turns about the clock's centre: offset half its length along its own direction.
    const hand = (length: number, width: number, tilt: number, depth: number) => {
      const [cx, cy, cz] = out(depth);
      const along = length / 2;
      const right = -Math.sin(tilt) * along;
      const at: [number, number, number] = [cx + Math.cos(angle) * right, cy + Math.cos(tilt) * along, cz - Math.sin(angle) * right];
      add(DARK, box(width, length, 0.06, { at, rot: [0, angle, tilt], order: "YXZ" }));
    };
    hand(1.3, 0.18, 1.05, 3.25);
    hand(1.9, 0.12, -0.52, 3.28);
  }
  add(STONE, box(5.6, 3.6, 5.6, { at: [0, 31, 0] }));
  add(DARK, box(5.7, 1.8, 3.4, { at: [0, 31.2, 0] }));
  add(DARK, box(3.4, 1.8, 5.7, { at: [0, 31.2, 0] }));
  add(DARK, cone(4.2, 8.5, 4, { at: [0, 37.1, 0], rot: [0, Math.PI / 4, 0] }));
  for (const [x, z] of [
    [2.5, 2.5],
    [-2.5, 2.5],
    [2.5, -2.5],
    [-2.5, -2.5],
  ]) {
    add(GOLD, cone(0.45, 3.2, 4, { at: [x, 34.4, z] }));
  }
  add(GOLD, cylinder(0.12, 0.25, 3, 6, { at: [0, 42.8, 0] }));
  return parts;
}

function towerBridge(): Part[] {
  const parts: Part[] = [];
  const add = (color: string, geometry: Part["geometry"]) => parts.push({ color, geometry });
  for (const x of [-20, 20]) {
    add(BRIDGE_STONE, box(11, 5, 13, { at: [x, 0.5, 0] }));
    add(BRIDGE_STONE, box(8, 34, 9, { at: [x, 17, 0] }));
    add(DARK, cone(4.6, 6, 4, { at: [x, 37, 0], rot: [0, Math.PI / 4, 0] }));
    for (const [dx, dz] of [
      [3.6, 4.1],
      [-3.6, 4.1],
      [3.6, -4.1],
      [-3.6, -4.1],
    ]) {
      add(BRIDGE_STONE, box(1.4, 38, 1.4, { at: [x + dx, 19, dz] }));
      add(DARK, cone(1, 3, 4, { at: [x + dx, 39.5, dz], rot: [0, Math.PI / 4, 0] }));
    }
  }
  // The bascule deck between the towers and the high walkways above it.
  add(BRIDGE_STONE, box(32, 1.6, 9, { at: [0, 9, 0] }));
  for (const z of [-2.8, 2.8]) add(BLUE, box(32, 2.6, 2.2, { at: [0, 31, z] }));
  // Side spans: decks to the banks and the chains swooping down to them.
  for (const side of [-1, 1]) {
    add(BRIDGE_STONE, box(46, 1.6, 9, { at: [side * 47, 9, 0] }));
    for (const z of [-4.2, 4.2]) {
      const steps = 6;
      for (let k = 0; k < steps; k++) {
        const t0 = k / steps;
        const t1 = (k + 1) / steps;
        const x0 = side * (24 + 46 * t0);
        const x1 = side * (24 + 46 * t1);
        const y0 = 27 - 17 * t0 + 6 * Math.sin(Math.PI * t0) * -0.5;
        const y1 = 27 - 17 * t1 + 6 * Math.sin(Math.PI * t1) * -0.5;
        add(BLUE, beam([x0, y0, z], [x1, y1, z], 0.9));
      }
    }
  }
  return parts;
}

const TOWER_COLLIDERS: CityCollider[] = [{ kind: "furniture", center: [0, 3, 0], half: [3.2, 3, 3.2] }];

export default function ElizabethTower({ site, vista, curb }: LandmarkProps) {
  return (
    <>
      <Water rects={vista} />
      <Anchored at={site.park} yaw={site.yaw}>
        <Merged build={elizabethTower} position={[0, curb, 0]} materials={{ [GOLD]: { metalness: 0.6, roughness: 0.35 }, [FACE]: { emissive: "#fff3d0", emissiveIntensity: 0.1 } }} />
      </Anchored>
      <Anchored at={site.far} yaw={site.farYaw}>
        <Merged build={towerBridge} castShadow={false} />
      </Anchored>
      <LocalColliders at={site.park} yaw={site.yaw} boxes={TOWER_COLLIDERS} lift={curb} />
    </>
  );
}

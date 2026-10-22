import { box, cone, cylinder, Merged, type Part, sphere } from "../merge";
import { Anchored, type LandmarkProps, LocalColliders } from "./common";

/**
 * Lahore: Minar-e-Pakistan in its park. A fluted, tapering white minaret on a stepped star
 * platform, with the flared "petals" round its foot, two balconies and a small domed lantern.
 * Rickshaws come from the traffic fleet.
 */
const MARBLE = "#efece4";
const SANDSTONE = "#d6c3a0";
const GREEN = "#2f7d4f";

function minar(): Part[] {
  const parts: Part[] = [];
  const add = (color: string, geometry: Part["geometry"]) => parts.push({ color, geometry });
  // The stepped platform, its tiers turned against each other into a star.
  add(SANDSTONE, cylinder(10.5, 11, 1.2, 10, { at: [0, 0.6, 0] }));
  add(SANDSTONE, cylinder(8.2, 8.6, 1.2, 10, { at: [0, 1.8, 0], rot: [0, Math.PI / 10, 0] }));
  add(MARBLE, cylinder(6, 6.4, 1.4, 10, { at: [0, 3.1, 0] }));
  // Ten petals flaring out from the shaft's foot.
  for (let k = 0; k < 10; k++) {
    const angle = (k / 10) * Math.PI * 2;
    add(MARBLE, box(2.3, 5.5, 0.35, { at: [Math.sin(angle) * 3.4, 6.2, Math.cos(angle) * 3.4], rot: [0.34, angle, 0], order: "YXZ" }));
  }
  add(MARBLE, cylinder(1.45, 2.5, 30, 12, { at: [0, 4 + 15, 0] }));
  for (const [y, r] of [
    [16, 2.55],
    [27, 2.25],
  ]) {
    add(MARBLE, cylinder(r, r - 0.3, 0.6, 12, { at: [0, y, 0] }));
  }
  add(MARBLE, cylinder(1.2, 1.4, 3, 12, { at: [0, 35.3, 0] }));
  add(MARBLE, sphere(1.35, 12, 6, { at: [0, 36.8, 0] }, [0, Math.PI * 2, 0, Math.PI / 2]));
  add(GREEN, cone(0.25, 2.4, 6, { at: [0, 39.2, 0] }));
  // A ring of lawn-edge planters in the national green.
  for (let k = 0; k < 8; k++) {
    const angle = (k / 8) * Math.PI * 2 + Math.PI / 8;
    add(GREEN, box(1.4, 0.5, 0.6, { at: [Math.sin(angle) * 12.5, 0.25, Math.cos(angle) * 12.5], rot: [0, angle, 0] }));
  }
  return parts;
}

export default function Minar({ site, curb }: LandmarkProps) {
  return (
    <>
      <Anchored at={site.park} yaw={site.yaw}>
        <Merged build={minar} position={[0, curb, 0]} />
      </Anchored>
      <LocalColliders at={site.park} yaw={site.yaw} boxes={[{ kind: "furniture", center: [0, 1.5, 0], half: [8.5, 1.5, 8.5] }]} lift={curb} />
    </>
  );
}

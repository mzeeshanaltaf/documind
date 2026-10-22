import type { CityCollider } from "../generator";
import { box, cone, Merged, type Part } from "../merge";
import { monumentPainter, useCanvasTexture } from "../signs";
import { Anchored, type LandmarkProps, LocalColliders } from "./common";

/**
 * Any other city: a stone monument carved with the city's name in the vista park, an obelisk
 * behind it, and a cluster of glass towers on the horizon beyond for a skyline.
 */
const STONE = "#d8d3c6";
const PLINTH = "#b9b3a5";
const GLASS = "#8fa3ab";
const GLASS_DARK = "#6f828a";

/** The carved face matches the sign texture's 1024 × 320. */
const SLAB = { w: 14, h: 14 * (320 / 1024) };

function monument(): Part[] {
  return [
    { color: PLINTH, geometry: box(16, 0.8, 4.4, { at: [0, 0.4, 0] }) },
    { color: STONE, geometry: box(SLAB.w + 0.4, SLAB.h + 0.4, 1.4, { at: [0, 0.8 + SLAB.h / 2, 0] }) },
    { color: PLINTH, geometry: box(2.6, 1.2, 2.6, { at: [0, 0.6, -5] }) },
    { color: STONE, geometry: box(1.6, 16, 1.6, { at: [0, 1.2 + 8, -5] }) },
    { color: STONE, geometry: cone(1.15, 2.4, 4, { at: [0, 1.2 + 16 + 1.2, -5], rot: [0, Math.PI / 4, 0] }) },
  ];
}

function towers(): Part[] {
  const spec: [number, number, number, number][] = [
    [-30, 0, 11, 58],
    [-14, -10, 9, 74],
    [0, 4, 12, 66],
    [15, -6, 10, 88],
    [30, 6, 13, 52],
    [44, -12, 9, 62],
  ];
  return spec.flatMap(([x, z, size, height], index) => [
    { color: index % 2 ? GLASS : GLASS_DARK, geometry: box(size, height, size, { at: [x, height / 2, z] }) },
    { color: PLINTH, geometry: box(size * 0.5, 4, size * 0.5, { at: [x, height + 2, z] }) },
  ]);
}

const COLLIDERS: CityCollider[] = [
  { kind: "furniture", center: [0, 2.2, 0], half: [8, 2.2, 2.2] },
  { kind: "furniture", center: [0, 2, -5], half: [1.3, 2, 1.3] },
];

export default function Generic({ site, curb, placeName, countryName }: LandmarkProps) {
  const texture = useCanvasTexture(1024, 320, monumentPainter(placeName, countryName), `${placeName}|${countryName}`);
  return (
    <>
      <Anchored at={site.park} yaw={site.yaw}>
        <group position={[0, curb, 0]}>
          <Merged build={monument} />
          <mesh position={[0, 0.8 + SLAB.h / 2, 0.72]}>
            <planeGeometry args={[SLAB.w, SLAB.w * (320 / 1024)]} />
            <meshStandardMaterial map={texture} roughness={0.9} />
          </mesh>
        </group>
      </Anchored>
      <Anchored at={site.far} yaw={site.farYaw}>
        <Merged build={towers} castShadow={false} materials={{ [GLASS]: { metalness: 0.3, roughness: 0.35 }, [GLASS_DARK]: { metalness: 0.3, roughness: 0.35 } }} />
      </Anchored>
      <LocalColliders at={site.park} yaw={site.yaw} boxes={COLLIDERS} lift={curb} />
    </>
  );
}

import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { useEffect, useMemo } from "react";
import type { Surface } from "@/game/audio/audio";
import { CITY, type CityCollider, type CityLayout } from "./generator";
import { mixHex } from "./lighting";
import { box, flat, mergeVertexColored, type Part } from "./merge";

const ASPHALT = "#5d6266";
const MARKING = "#e6e3d6";
const STONE = "#cfcabd";

export function groundColors(ground: string) {
  return {
    pavement: ground,
    plaza: mixHex(ground, "#ffffff", 0.28),
    grass: mixHex("#7f9e68", ground, 0.18),
    path: mixHex(ground, "#c9b892", 0.45),
    outer: mixHex(ground, "#7d8079", 0.45),
  };
}

/**
 * Every static ground surface in one vertex-coloured mesh (one draw call): the land beyond the
 * boundary, roads with dashed centre lines and zebra crossings, raised pavement slabs, the
 * plaza, the office garden, and the parks' lawns and paths.
 */
function buildGround(layout: CityLayout) {
  const colors = groundColors(layout.palette.ground);
  const parts: Part[] = [];
  const add = (color: string, geometry: Part["geometry"]) => parts.push({ color, geometry });
  const curb = CITY.curb;
  const lift = 0.02;

  add(colors.outer, flat(640, 640, 0, -0.03, 0));
  for (const road of layout.roads) add(ASPHALT, flat(road.w, road.d, road.x, 0, road.z));

  // Dashed centre lines, broken at the junctions.
  const centres = [-1.5, -0.5, 0.5, 1.5].map((k) => k * CITY.pitch);
  const atJunction = (t: number) => centres.some((c) => Math.abs(t - c) < CITY.road / 2 + 1);
  for (const c of centres) {
    for (let t = -CITY.half + 2; t <= CITY.half - 2; t += 6) {
      if (atJunction(t) || atJunction(t + 3)) continue;
      add(MARKING, flat(0.16, 3, c, lift, t + 1.5));
      add(MARKING, flat(3, 0.16, t + 1.5, lift, c));
    }
  }
  for (const crossing of layout.crossings) {
    for (let k = -2; k <= 2; k++) {
      if (crossing.across === "x") add(MARKING, flat(0.55, 2.6, crossing.x + k * 1.8, lift, crossing.z));
      else add(MARKING, flat(2.6, 0.55, crossing.x, lift, crossing.z + k * 1.8));
    }
  }

  const inner = CITY.block - CITY.pavement * 2;
  for (const block of layout.blocks) {
    const { x, z } = block.rect;
    add(colors.pavement, box(block.rect.w, curb, block.rect.d, { at: [x, curb / 2, z] }));
    if (block.kind === "park" || block.kind === "vista") {
      add(colors.grass, flat(inner, inner, x, curb + lift, z));
      add(colors.path, flat(3, inner, x, curb + lift * 2, z));
      add(colors.path, flat(inner, 3, x, curb + lift * 2, z));
    }
  }
  const { plaza, garden } = layout;
  add(colors.plaza, flat(plaza.w, plaza.d, plaza.x, curb + lift, plaza.z));
  add(colors.grass, flat(garden.w - 0.6, garden.d - 0.6, garden.x + 0.3, curb + lift, garden.z - 0.3));
  for (const ledge of layout.ledges) add(STONE, box(ledge.w, 0.45, ledge.d, { at: [ledge.x, curb + 0.225, ledge.z] }));

  return mergeVertexColored(parts);
}

export function Ground({ layout }: { layout: CityLayout }) {
  const geometry = useMemo(() => buildGround(layout), [layout]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial vertexColors roughness={0.95} metalness={0} />
    </mesh>
  );
}

/** One fixed body holding a scene's box colliders (footsteps read its `surface`). */
export function Colliders({ colliders, surface = "concrete" }: { colliders: CityCollider[]; surface?: Surface }) {
  return (
    <RigidBody type="fixed" colliders={false} userData={{ surface }}>
      {colliders.map((collider, index) => (
        <CuboidCollider
          key={index}
          args={collider.half}
          position={collider.center}
          rotation={collider.yaw ? [0, collider.yaw, 0] : undefined}
        />
      ))}
    </RigidBody>
  );
}

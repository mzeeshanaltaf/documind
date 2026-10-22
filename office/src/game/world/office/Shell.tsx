import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { useEffect, useMemo } from "react";
import { PlaneGeometry } from "three";
import type { Surface } from "@/game/audio/audio";
import { box, Merged, mergeAll, type Part, place } from "../city/merge";
import { type Floorplan, type Room, rectEdges } from "./floorplan";
import { OFFICE } from "./palette";

/**
 * The building shell from the floor plan: floors, walls (rapier cuboids), glass partitions along
 * the corridor, door headers, a ceiling with light panels (seen from below only, so the camera
 * looks in over the walls) and the street vestibule. Static, so everything merges: a handful of
 * draw calls for the whole interior.
 */
const FLOOR_COLOR: Record<Room["kind"], string> = {
  lobby: OFFICE.lobbyFloor,
  corridor: OFFICE.corridorFloor,
  department: OFFICE.roomFloor,
  presentation: OFFICE.presentationFloor,
  play: OFFICE.playFloor,
};

const SURFACE: Record<Room["kind"], Surface> = {
  lobby: "concrete",
  corridor: "concrete",
  department: "carpet",
  presentation: "carpet",
  play: "wood",
};

const WALL_HEIGHT = 3.2;
/** The street vestibule beyond the lobby's doors: daylight and a way back out. */
const VESTIBULE = { depth: 2.6, width: 4 };

function shellParts(plan: Floorplan): Part[] {
  const parts: Part[] = [];
  for (const room of plan.rooms) {
    const { x, z, w, d } = room.rect;
    parts.push({ color: FLOOR_COLOR[room.kind], geometry: box(w, 0.1, d, { at: [x, -0.05, z] }) });
    if (room.kind === "lobby") {
      // A darker inlay leading from the doors to the security door.
      parts.push({ color: OFFICE.lobbyInlay, geometry: box(2.4, 0.012, d - 0.4, { at: [x, 0.006, z] }) });
    }
  }
  for (const wall of plan.walls) {
    if (wall.kind === "glass") continue;
    const [hx, hy, hz] = wall.half;
    parts.push({ color: wall.kind === "header" ? OFFICE.header : OFFICE.wall, geometry: box(hx * 2, hy * 2, hz * 2, { at: wall.center }) });
    if (wall.kind === "wall") {
      // Skirting on both faces.
      const along = wall.orient === "h" ? hx * 2 : hz * 2;
      const t = (wall.orient === "h" ? hz : hx) * 2 + 0.04;
      const size: [number, number, number] = wall.orient === "h" ? [along, 0.12, t] : [t, 0.12, along];
      parts.push({ color: OFFICE.wallTrim, geometry: box(...size, { at: [wall.center[0], 0.06, wall.center[2]] }) });
    }
  }
  // Glass partitions: frames here, panes in their own translucent mesh.
  for (const wall of plan.walls) {
    if (wall.kind !== "glass") continue;
    const [hx, , hz] = wall.half;
    const alongX = wall.orient === "h";
    const length = (alongX ? hx : hz) * 2;
    const [cx, , cz] = wall.center;
    const rail = (y: number, h: number) =>
      parts.push({ color: OFFICE.glassFrame, geometry: box(alongX ? length : 0.16, h, alongX ? 0.16 : length, { at: [cx, y, cz] }) });
    rail(0.06, 0.12);
    rail(2.5, 0.08);
    rail(WALL_HEIGHT - 0.1, 0.2);
    const posts = Math.max(1, Math.round(length / 2));
    for (let i = 0; i <= posts; i++) {
      const offset = -length / 2 + (length * i) / posts;
      const at: [number, number, number] = alongX ? [cx + offset, WALL_HEIGHT / 2, cz] : [cx, WALL_HEIGHT / 2, cz + offset];
      parts.push({ color: OFFICE.glassFrame, geometry: box(0.08, WALL_HEIGHT, 0.08, { at }) });
    }
  }
  // The vestibule: a floor and side walls; daylight fills its far end.
  const south = rectEdges(plan.rooms[0].rect).z1;
  const v = VESTIBULE;
  parts.push({ color: OFFICE.lobbyInlay, geometry: box(v.width, 0.1, v.depth, { at: [0, -0.05, south + v.depth / 2] }) });
  for (const side of [-1, 1]) {
    parts.push({ color: OFFICE.wall, geometry: box(0.2, WALL_HEIGHT, v.depth, { at: [side * (v.width / 2 + 0.1), WALL_HEIGHT / 2, south + v.depth / 2] }) });
  }
  return parts;
}

function ceilingParts(plan: Floorplan): Part[] {
  const parts: Part[] = [];
  for (const room of plan.rooms) {
    const { x, z, w, d } = room.rect;
    // Facing down: visible from inside, invisible to the camera looking in from above.
    parts.push({ color: OFFICE.ceiling, geometry: place(new PlaneGeometry(w, d), { at: [x, WALL_HEIGHT, z], rot: [Math.PI / 2, 0, 0] }) });
    const stepX = room.kind === "corridor" ? w : 4;
    const stepZ = room.kind === "corridor" ? 4 : 4;
    for (let px = x - w / 2 + stepX / 2; px < x + w / 2; px += stepX) {
      for (let pz = z - d / 2 + stepZ / 2; pz < z + d / 2; pz += stepZ) {
        // Facing down too, just under the ceiling: from above they vanish with it.
        const panel = new PlaneGeometry(room.kind === "corridor" ? 0.5 : 1.2, 1.2);
        parts.push({ color: OFFICE.lightPanel, geometry: place(panel, { at: [px, WALL_HEIGHT - 0.01, pz], rot: [Math.PI / 2, 0, 0] }) });
      }
    }
  }
  return parts;
}

export function Shell({ plan, version }: { plan: Floorplan; version: string }) {
  const glass = useMemo(() => {
    const panes = plan.walls
      .filter((wall) => wall.kind === "glass")
      .map((wall) => {
        const alongX = wall.orient === "h";
        const length = (alongX ? wall.half[0] : wall.half[2]) * 2;
        return box(alongX ? length : 0.03, 2.38, alongX ? 0.03 : length, { at: [wall.center[0], 1.31, wall.center[2]] });
      });
    return panes.length > 0 ? mergeAll(panes) : null;
  }, [plan]);
  useEffect(() => () => glass?.dispose(), [glass]);

  const south = rectEdges(plan.rooms[0].rect).z1;

  return (
    <>
      <Merged build={() => shellParts(plan)} version={version} roughness={0.92} materials={{ [OFFICE.glassFrame]: { roughness: 0.5 } }} />
      <Merged
        build={() => ceilingParts(plan)}
        version={version}
        castShadow={false}
        receiveShadow={false}
        materials={{ [OFFICE.lightPanel]: { emissive: "#fff6e0", emissiveIntensity: 0.9 } }}
      />
      {glass && (
        <mesh geometry={glass}>
          <meshStandardMaterial color={OFFICE.glass} transparent opacity={0.28} roughness={0.08} depthWrite={false} />
        </mesh>
      )}
      {/* Daylight beyond the street doors. */}
      <mesh position={[0, 1.6, south + VESTIBULE.depth - 0.05]}>
        <planeGeometry args={[VESTIBULE.width, WALL_HEIGHT]} />
        <meshBasicMaterial color="#f4f7f2" toneMapped={false} />
      </mesh>

      {/* Colliders: one floor per room (its footstep surface), the walls, the vestibule. */}
      {plan.rooms.map((room) => (
        <RigidBody key={room.id} type="fixed" colliders={false} userData={{ surface: SURFACE[room.kind] }}>
          <CuboidCollider args={[room.rect.w / 2, 0.1, room.rect.d / 2]} position={[room.rect.x, -0.1, room.rect.z]} />
        </RigidBody>
      ))}
      <RigidBody type="fixed" colliders={false} userData={{ surface: "concrete" }}>
        {plan.walls.map((wall, index) => (
          <CuboidCollider key={index} args={wall.half} position={wall.center} />
        ))}
        <CuboidCollider args={[VESTIBULE.width / 2, 0.1, VESTIBULE.depth / 2]} position={[0, -0.1, south + VESTIBULE.depth / 2]} />
        <CuboidCollider args={[0.1, WALL_HEIGHT / 2, VESTIBULE.depth / 2]} position={[-VESTIBULE.width / 2 - 0.1, WALL_HEIGHT / 2, south + VESTIBULE.depth / 2]} />
        <CuboidCollider args={[0.1, WALL_HEIGHT / 2, VESTIBULE.depth / 2]} position={[VESTIBULE.width / 2 + 0.1, WALL_HEIGHT / 2, south + VESTIBULE.depth / 2]} />
        <CuboidCollider args={[VESTIBULE.width / 2, WALL_HEIGHT / 2, 0.1]} position={[0, WALL_HEIGHT / 2, south + VESTIBULE.depth + 0.1]} />
      </RigidBody>
    </>
  );
}

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { DoubleSide, type Mesh } from "three";
import { audio } from "@/game/audio/audio";
import { rig } from "@/game/player/rig";
import { useGame } from "@/game/store/game-store";
import { Trigger } from "../Trigger";
import type { Box, OfficeSite } from "./generator";
import { box, Merged, type Part } from "./merge";
import { INK, logoPainter, OFFICE_SIGN, officeSignPainter, useCanvasTexture } from "./signs";

/**
 * The org's office exterior (phase O4 › 5): a stone-framed glass tower in DocuMind's palette
 * (paper stone, ink-green glass and canopy), signed "{Org} · {City}" over the doors and on the
 * crown, with DocuMind's mark on the lobby glass. The sliding doors open within 3 m, and walking
 * into the recess behind them enters the office.
 */

const STONE = "#e4e7e0";
const FIN = "#d3d8d0";
const GLASS = "#4f746d";
const LOBBY = "#5d7f77";
const INTERIOR = "#d8cfb8";
const DOOR_RANGE = 3;
const FLOOR = 3.4;

function buildParts(site: OfficeSite, base: number): Part[] {
  const { rect, height, podium, door, vestibule } = site;
  const x0 = rect.x - rect.w / 2;
  const x1 = rect.x + rect.w / 2;
  const z0 = rect.z - rect.d / 2;
  const front = rect.z + rect.d / 2;
  const tower = height - podium;
  const parts: Part[] = [];
  const add = (color: string, geometry: Part["geometry"]) => parts.push({ color, geometry });

  // Tower: an inset glass core, stone fins on every face, a spandrel band per floor, a crown.
  add(GLASS, box(rect.w - 0.4, tower, rect.d - 0.4, { at: [rect.x, base + podium + tower / 2, rect.z] }));
  const finsAlong = (from: number, to: number, place: (t: number) => [number, number], alongX: boolean) => {
    const count = Math.max(2, Math.round((to - from) / 2.3));
    for (let k = 0; k <= count; k++) {
      const t = from + ((to - from) * k) / count;
      const [fx, fz] = place(t);
      add(FIN, box(alongX ? 0.26 : 0.5, tower, alongX ? 0.5 : 0.26, { at: [fx, base + podium + tower / 2, fz] }));
    }
  };
  finsAlong(x0, x1, (t) => [t, front - 0.1], true);
  finsAlong(x0, x1, (t) => [t, z0 + 0.1], true);
  finsAlong(z0, front, (t) => [x0 + 0.1, t], false);
  finsAlong(z0, front, (t) => [x1 - 0.1, t], false);
  for (let y = podium + FLOOR; y < height - 0.5; y += FLOOR) {
    add(STONE, box(rect.w + 0.12, 0.34, rect.d + 0.12, { at: [rect.x, base + y, rect.z] }));
  }
  add(STONE, box(rect.w + 0.3, 1.3, rect.d + 0.3, { at: [rect.x, base + height + 0.65, rect.z] }));
  add(FIN, box(rect.w * 0.45, 2.6, rect.d * 0.4, { at: [rect.x + 1, base + height + 2.6, rect.z - 1] }));

  // Podium: lobby glass behind stone piers, the recess for the doors, a cap band.
  const recess = front - vestibule;
  const left = door.x - door.width / 2;
  const right = door.x + door.width / 2;
  add(LOBBY, box(rect.w - 0.3, podium - 0.6, recess - z0 - 0.3, { at: [rect.x, base + (podium - 0.6) / 2, (z0 + recess) / 2] }));
  add(LOBBY, box(left - x0 - 0.15, podium - 0.6, vestibule, { at: [(x0 + left) / 2 + 0.075, base + (podium - 0.6) / 2, recess + vestibule / 2] }));
  add(LOBBY, box(x1 - right - 0.15, podium - 0.6, vestibule, { at: [(right + x1) / 2 - 0.075, base + (podium - 0.6) / 2, recess + vestibule / 2] }));
  for (let x = x0 + 0.4; x <= x1 - 0.39; x += (rect.w - 0.8) / 4) {
    add(STONE, box(0.8, podium - 0.6, 0.8, { at: [x, base + (podium - 0.6) / 2, front - 0.25] }));
  }
  add(STONE, box(rect.w + 0.3, 0.9, rect.d + 0.3, { at: [rect.x, base + podium - 0.45, rect.z] }));
  // Over the doorway, and the lit lobby beyond the recess.
  add(STONE, box(door.width + 0.2, podium - 0.6 - 3.1, vestibule + 0.2, { at: [door.x, base + 3.1 + (podium - 3.7) / 2, recess + vestibule / 2] }));
  add(INTERIOR, box(door.width, 3.1, 0.1, { at: [door.x, base + 1.55, recess + 0.06] }));
  add(STONE, box(0.2, 3.1, vestibule, { at: [left - 0.1, base + 1.55, recess + vestibule / 2] }));
  add(STONE, box(0.2, 3.1, vestibule, { at: [right + 0.1, base + 1.55, recess + vestibule / 2] }));

  // Canopy over the entrance, with its fascia (the sign sits on it).
  add(INK.green, box(8.4, 0.24, 3, { at: [door.x, base + 4.42, front + 1.4] }));
  add(INK.green, box(8.4, 0.78, 0.14, { at: [door.x, base + 4.15, front + 2.86] }));
  // A backing panel for the crown sign.
  add(INK.green, box(Math.min(12.6, rect.w - 0.6), 1.5, 0.16, { at: [rect.x, base + height - 2.3, front + 0.3] }));
  return parts;
}

type OfficeBuildingProps = {
  site: OfficeSite;
  entrance: Box;
  /** Feet height of the plaza in front (the city's curb; 0 on the Global Hub). */
  base: number;
  orgName: string;
  placeName: string;
  night: number;
  onEnter: () => void;
};

export function OfficeBuilding({ site, entrance, base, orgName, placeName, night, onEnter }: OfficeBuildingProps) {
  const sign = useCanvasTexture(OFFICE_SIGN.width, OFFICE_SIGN.height, officeSignPainter(orgName, placeName, INK.green), `${orgName}|${placeName}`);
  const logo = useCanvasTexture(256, 256, logoPainter, "logo");
  const { rect, height, door } = site;
  const front = rect.z + rect.d / 2;
  const crownWidth = Math.min(12, rect.w - 1.2);

  return (
    <group>
      <Merged
        build={() => buildParts(site, base)}
        version={`${JSON.stringify(site)}|${base}`}
        roughness={0.8}
        materials={{
          [GLASS]: { roughness: 0.28 },
          [LOBBY]: { roughness: 0.3, emissive: "#f2d7a4", emissiveIntensity: 0.04 + night * 0.55 },
          [INTERIOR]: { emissive: "#f6e3bd", emissiveIntensity: 0.15 + night * 0.7 },
        }}
      />
      {/* Signs: over the doors (8 m) and on the crown, glowing a little after dark. */}
      <mesh position={[door.x, base + 4.15, front + 2.935]}>
        <planeGeometry args={[8.2, 8.2 * (OFFICE_SIGN.height / OFFICE_SIGN.width)]} />
        <meshStandardMaterial map={sign} emissiveMap={sign} emissive="#ffffff" emissiveIntensity={0.08 + night * 0.75} roughness={0.7} />
      </mesh>
      <mesh position={[rect.x, base + height - 2.3, front + 0.39]}>
        <planeGeometry args={[crownWidth, crownWidth * (OFFICE_SIGN.height / OFFICE_SIGN.width)]} />
        <meshStandardMaterial map={sign} emissiveMap={sign} emissive="#ffffff" emissiveIntensity={0.08 + night * 0.75} roughness={0.7} />
      </mesh>
      {/* DocuMind's mark on the lobby glass, at eye level beside the doors. */}
      <mesh position={[door.x + door.width / 2 + 1.25, base + 1.75, front + 0.02]}>
        <planeGeometry args={[0.8, 0.8]} />
        <meshStandardMaterial map={logo} transparent alphaTest={0.5} side={DoubleSide} roughness={0.5} />
      </mesh>
      <SlidingDoors x={door.x} z={front - 0.12} width={door.width} base={base} />
      <Trigger box={entrance} onEnter={onEnter} />
    </group>
  );
}

/** Two glass leaves that slide apart while the player is within 3 m. */
function SlidingDoors({ x, z, width, base }: { x: number; z: number; width: number; base: number }) {
  const left = useRef<Mesh>(null);
  const right = useRef<Mesh>(null);
  const state = useRef({ open: 0, wanted: false });
  const leaf = width / 2;

  useFrame((_, delta) => {
    const near = Math.hypot(rig.position.x - x, rig.position.z - z) < DOOR_RANGE && useGame.getState().world.phase === "ready";
    const door = state.current;
    if (near && !door.wanted) audio.play("door-open", { volume: 0.5 });
    door.wanted = near;
    door.open += ((near ? 1 : 0) - door.open) * (1 - Math.exp(-7 * Math.min(delta, 0.1)));
    const slide = door.open * leaf * 0.92;
    left.current?.position.setX(x - leaf / 2 - slide);
    right.current?.position.setX(x + leaf / 2 + slide);
  });

  const glass = <meshStandardMaterial color="#a9c1bb" metalness={0.3} roughness={0.15} transparent opacity={0.55} />;
  return (
    <>
      <mesh ref={left} position={[x - leaf / 2, base + 1.5, z]}>
        <boxGeometry args={[leaf - 0.04, 3, 0.06]} />
        {glass}
      </mesh>
      <mesh ref={right} position={[x + leaf / 2, base + 1.5, z]}>
        <boxGeometry args={[leaf - 0.04, 3, 0.06]} />
        {glass}
      </mesh>
    </>
  );
}

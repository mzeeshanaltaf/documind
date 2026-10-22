import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { useEffect, useState } from "react";
import { DoubleSide } from "three";
import { Interactable } from "@/game/interact/Interactable";
import { useGame } from "@/game/store/game-store";
import { formatLocalTime } from "@/lib/format";
import { box, cylinder, ico, Merged, type Part } from "../city/merge";
import { SAMPLE_CITY } from "../city/sample";
import { logoPainter, useCanvasTexture } from "../city/signs";
import type { Floorplan, Spot } from "./floorplan";
import { OFFICE } from "./palette";
import { CLOCK, clockPainter, DIRECTORY, directoryPainter, WORDMARK, wordmarkPainter } from "./signage";

/**
 * The lobby's fittings (phase O5 › Interior): the DocuMind mark wall behind reception, a live
 * clock in the office's time over the security door, the directory board listing every room,
 * a waiting area and the badge photo booth (the avatar editor).
 */
export function Lobby({ plan }: { plan: Floorplan }) {
  const { props } = plan;
  return (
    <>
      <MarkWall spot={props.mark} />
      <Clock spot={props.clock} />
      <Directory plan={plan} spot={props.directory} />
      <Waiting spot={props.waiting} />
      <Booth spot={props.booth} />
    </>
  );
}

/** The feature wall: a green panel with DocuMind's mark and wordmark, softly lit. */
function MarkWall({ spot }: { spot: Spot }) {
  const logo = useCanvasTexture(256, 256, logoPainter, "logo");
  const wordmark = useCanvasTexture(WORDMARK.width, WORDMARK.height, wordmarkPainter, "wordmark");
  const [x, , z] = spot.position;
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 1.95, 0.04]} receiveShadow>
        <boxGeometry args={[4.6, 1.5, 0.06]} />
        <meshStandardMaterial color={OFFICE.paper} roughness={0.85} />
      </mesh>
      <mesh position={[-1.55, 1.95, 0.08]}>
        <planeGeometry args={[0.95, 0.95]} />
        <meshStandardMaterial map={logo} transparent alphaTest={0.5} roughness={0.6} />
      </mesh>
      <mesh position={[0.55, 1.95, 0.08]}>
        <planeGeometry args={[3, 0.75]} />
        <meshStandardMaterial map={wordmark} transparent alphaTest={0.4} roughness={0.6} side={DoubleSide} />
      </mesh>
    </group>
  );
}

/** "7:42 pm · LAHORE" in the office's own time zone, repainted when the minute changes. */
function Clock({ spot }: { spot: Spot }) {
  const place = useGame((s) => s.office?.place) ?? SAMPLE_CITY;
  const time = useMinuteClock(place.timezone);
  const texture = useCanvasTexture(CLOCK.width, CLOCK.height, clockPainter(time, place.name), `${time}|${place.name}`);
  const [x, , z] = spot.position;
  return (
    <mesh position={[x, 2.3, z + 0.03]}>
      <planeGeometry args={[1.1, 0.41]} />
      <meshStandardMaterial map={texture} emissiveMap={texture} emissive="#ffffff" emissiveIntensity={0.35} roughness={0.5} />
    </mesh>
  );
}

function useMinuteClock(timezone: string): string {
  const [time, setTime] = useState(() => formatLocalTime(Date.now(), timezone));
  useEffect(() => {
    const tick = () => setTime(formatLocalTime(Date.now(), timezone));
    const timer = setInterval(tick, 5000);
    return () => clearInterval(timer);
  }, [timezone]);
  return time;
}

function Directory({ plan, spot }: { plan: Floorplan; spot: Spot }) {
  const orgName = useGame((s) => s.office?.org.name) ?? "DocuMind";
  const rows = plan.rooms
    .filter((room) => room.kind !== "lobby" && room.kind !== "corridor")
    .map((room) => ({
      name: room.name,
      where: room.kind === "presentation" ? "Left" : room.kind === "play" ? "Right" : `Corridor, ${room.side === "west" ? "left" : "right"}`,
    }));
  const key = `${orgName}|${rows.map((row) => `${row.name}:${row.where}`).join(",")}`;
  const texture = useCanvasTexture(DIRECTORY.width, DIRECTORY.height, directoryPainter(orgName, rows), key);
  const [x, , z] = spot.position;
  return (
    <mesh position={[x, 1.75, z + 0.03]}>
      <planeGeometry args={[1.3, 1.73]} />
      <meshStandardMaterial map={texture} roughness={0.7} />
    </mesh>
  );
}

function waitingParts(): Part[] {
  const parts: Part[] = [];
  // Two sofas facing each other across a low table, a rug, plants at the ends.
  parts.push({ color: OFFICE.wallTrim, geometry: box(3.4, 0.015, 2.6, { at: [0, 0.008, 0] }) });
  for (const side of [-1, 1]) {
    const z = side * 0.95;
    parts.push({ color: OFFICE.fabric, geometry: box(2.2, 0.4, 0.8, { at: [0, 0.22, z] }) });
    parts.push({ color: OFFICE.fabric, geometry: box(2.2, 0.5, 0.18, { at: [0, 0.6, z + side * 0.36] }) });
    for (const end of [-1, 1]) parts.push({ color: OFFICE.fabric, geometry: box(0.16, 0.55, 0.8, { at: [end * 1.1, 0.3, z] }) });
  }
  parts.push({ color: OFFICE.woodDark, geometry: box(1.3, 0.06, 0.7, { at: [0, 0.38, 0] }) });
  parts.push({ color: OFFICE.dark, geometry: box(1.1, 0.34, 0.5, { at: [0, 0.18, 0] }) });
  parts.push({ color: OFFICE.paper, geometry: box(0.3, 0.02, 0.22, { at: [0.25, 0.42, 0.05], rot: [0, 0.3, 0] }) });
  for (const end of [-1, 1]) {
    parts.push({ color: OFFICE.pot, geometry: cylinder(0.22, 0.17, 0.42, 7, { at: [end * 1.65, 0.21, 0] }) });
    parts.push({ color: OFFICE.plant, geometry: ico(0.42, 0, { at: [end * 1.65, 0.85, 0], scale: [1, 1.3, 1] }) });
  }
  return parts;
}

function Waiting({ spot }: { spot: Spot }) {
  return (
    <group position={spot.position} rotation={[0, spot.yaw, 0]}>
      <Merged build={waitingParts} />
      <RigidBody type="fixed" colliders={false} userData={{ surface: "carpet" }}>
        <CuboidCollider args={[1.25, 0.4, 0.45]} position={[0, 0.4, 0.95]} />
        <CuboidCollider args={[1.25, 0.4, 0.45]} position={[0, 0.4, -0.95]} />
        <CuboidCollider args={[0.65, 0.2, 0.35]} position={[0, 0.2, 0]} />
        <CuboidCollider args={[0.25, 0.6, 0.25]} position={[-1.65, 0.6, 0]} />
        <CuboidCollider args={[0.25, 0.6, 0.25]} position={[1.65, 0.6, 0]} />
      </RigidBody>
    </group>
  );
}

function boothParts(): Part[] {
  return [
    { color: OFFICE.green, geometry: box(1.1, 2.3, 0.12, { at: [0, 1.15, -0.5] }) },
    { color: OFFICE.green, geometry: box(0.08, 2.3, 1.1, { at: [-0.55, 1.15, 0] }) },
    { color: OFFICE.green, geometry: box(0.08, 2.3, 1.1, { at: [0.55, 1.15, 0] }) },
    { color: OFFICE.green, geometry: box(1.18, 0.14, 1.1, { at: [0, 2.37, 0] }) },
    { color: OFFICE.paper, geometry: box(0.9, 0.24, 0.02, { at: [0, 2.1, 0.56] }) },
    { color: OFFICE.dark, geometry: box(0.3, 0.22, 0.16, { at: [0, 1.62, -0.4] }) },
    { color: OFFICE.lightPanel, geometry: cylinder(0.06, 0.06, 0.04, 8, { at: [0, 1.62, -0.31], rot: [Math.PI / 2, 0, 0] }) },
    { color: OFFICE.metal, geometry: cylinder(0.2, 0.2, 0.06, 8, { at: [0, 0.48, -0.05] }) },
    { color: OFFICE.dark, geometry: cylinder(0.04, 0.04, 0.45, 6, { at: [0, 0.23, -0.05] }) },
  ];
}

/** The badge photo booth: the avatar editor (also on the receptionist's menu). */
function Booth({ spot }: { spot: Spot }) {
  return (
    <group position={spot.position} rotation={[0, spot.yaw, 0]}>
      <Merged build={boothParts} materials={{ [OFFICE.lightPanel]: { emissive: "#fff6e0", emissiveIntensity: 1.2 } }} />
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[0.6, 1.15, 0.06]} position={[0, 1.15, -0.5]} />
        <CuboidCollider args={[0.05, 1.15, 0.55]} position={[-0.55, 1.15, 0]} />
        <CuboidCollider args={[0.05, 1.15, 0.55]} position={[0.55, 1.15, 0]} />
      </RigidBody>
      <Interactable
        id="badge-booth"
        kind="use"
        label="Take a badge photo"
        radius={1.5}
        position={[0, 0, 0.6]}
        onInteract={() => useGame.getState().openModal({ type: "avatar" })}
      />
    </group>
  );
}

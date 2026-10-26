import { useFrame } from "@react-three/fiber";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { useRef, useState } from "react";
import type { Mesh } from "three";
import { audio } from "@/game/audio/audio";
import { Interactable } from "@/game/interact/Interactable";
import { meetsRequirement } from "@/game/interact/select";
import { rig } from "@/game/player/rig";
import { CORE_QUEST_IDS } from "@/game/quests/definitions";
import { coreStatus } from "@/game/quests/engine";
import { useGame } from "@/game/store/game-store";
import { expertFor } from "@/content/personas";
import { themeFor } from "@/content/room-themes";
import type { OfficeContext } from "@/game/store/game-store";
import { SAMPLE_CITY } from "../city/sample";
import { INK, useCanvasTexture } from "../city/signs";
import type { Door } from "./floorplan";
import { OFFICE } from "./palette";
import { ROOFTOP_SPAWN } from "./rooftop-layout";
import { PLATE, platePainter } from "./signage";

/**
 * Sliding glass doors with a card reader (phase O5 › Doors). Walking up with the right card turns
 * the reader's LED green, beeps and slides the door open; without it the LED stays red, the
 * reader beeps "denied" and the prompt says which card to get. Open doors (the side rooms, the
 * street) just slide open. The rooftop lift (`LiftDoor`) opens once the core quests are done (O9).
 */
const OPEN_RANGE = 2.2;
const BEEP_RANGE = 1.5;
const DOOR_HEIGHT = 2.5;
// Locked interactables only explain themselves (the prompt); E never acts on them.
const NOOP = () => undefined;

type Sign = { title: string; line: string; accent: string; label: string };

/** `office` names the department room's expert on its plate (O6). */
function signFor(door: Door, office: Pick<OfficeContext, "org" | "place"> | null): Sign {
  if (door.kind === "department") {
    const department = door.to.slice("dept:".length);
    const expert = expertFor(office?.org.slug ?? "", office?.place ?? SAMPLE_CITY, department);
    return { title: department, line: `Expert: ${expert.name}`, accent: themeFor(department).accent, label: `${department} room` };
  }
  if (door.kind === "security") return { title: "Departments", line: "Access card required", accent: INK.green, label: "Department wing" };
  if (door.to === "presentation") return { title: "Presentation room", line: "Now showing · Take a seat", accent: INK.green, label: "Presentation room" };
  if (door.to === "play") return { title: "Play area", line: "Games · Leaderboards", accent: INK.green, label: "Play area" };
  return { title: "Street", line: "Exit", accent: INK.green, label: "Street" };
}

export function Doors({ doors }: { doors: Door[] }) {
  return doors.map((door) => (door.kind === "lift" ? <LiftDoor key={door.id} door={door} /> : <SlidingDoor key={door.id} door={door} />));
}

/** The door's frame of reference: local x runs along the opening, local +z towards `facing`. */
function frame(door: Door) {
  const rotation = door.orient === "h" ? 0 : Math.PI / 2;
  const side = door.orient === "h" ? Math.sign(door.facing[2]) || 1 : Math.sign(door.facing[0]) || 1;
  return { rotation, side };
}

function SlidingDoor({ door }: { door: Door }) {
  const granted = useGame((s) => !door.requires || meetsRequirement(s.player.cards, door.requires, s.unlocks));
  const [open, setOpen] = useState(false);
  const left = useRef<Mesh>(null);
  const right = useRef<Mesh>(null);
  const motion = useRef({ amount: 0, wanted: false, beeped: false });
  const office = useGame((s) => s.office);
  const sign = signFor(door, office);
  const plate = useCanvasTexture(PLATE.width, PLATE.height, platePainter(sign.title, sign.line, sign.accent), `${sign.title}|${sign.line}|${sign.accent}`);
  const { rotation, side } = frame(door);
  const leaf = door.width / 2;
  const gated = door.requires !== undefined;

  useFrame((_, delta) => {
    const state = useGame.getState();
    const distance = Math.hypot(rig.position.x - door.x, rig.position.z - door.z);
    const ready = state.world.phase === "ready";
    const m = motion.current;
    const wanted = ready && distance < OPEN_RANGE && granted;
    if (wanted !== m.wanted) {
      m.wanted = wanted;
      if (wanted) {
        if (gated) audio.play("card-beep", { volume: 0.6 });
        audio.play("door-open", { volume: 0.5 });
      }
      setOpen(wanted);
    }
    // The reader beeps once as you walk up without the card.
    if (gated && !granted && ready && distance < BEEP_RANGE && !m.beeped) {
      m.beeped = true;
      audio.play("ui-deny", { volume: 0.45 });
    } else if (distance > OPEN_RANGE + 0.5) {
      m.beeped = false;
    }
    m.amount += ((wanted ? 1 : 0) - m.amount) * (1 - Math.exp(-7 * Math.min(delta, 0.1)));
    const slide = m.amount * leaf * 0.94;
    left.current?.position.setX(-leaf / 2 - slide);
    right.current?.position.setX(leaf / 2 + slide);
  });

  return (
    <group position={[door.x, 0, door.z]} rotation={[0, rotation, 0]}>
      <mesh ref={left} position={[-leaf / 2, DOOR_HEIGHT / 2, 0]}>
        <boxGeometry args={[leaf - 0.03, DOOR_HEIGHT - 0.02, 0.05]} />
        <meshStandardMaterial color={OFFICE.glass} transparent opacity={0.45} roughness={0.1} depthWrite={false} />
      </mesh>
      <mesh ref={right} position={[leaf / 2, DOOR_HEIGHT / 2, 0]}>
        <boxGeometry args={[leaf - 0.03, DOOR_HEIGHT - 0.02, 0.05]} />
        <meshStandardMaterial color={OFFICE.glass} transparent opacity={0.45} roughness={0.1} depthWrite={false} />
      </mesh>
      {!open && (
        <RigidBody type="fixed" colliders={false}>
          <CuboidCollider args={[leaf, DOOR_HEIGHT / 2, 0.08]} position={[0, DOOR_HEIGHT / 2, 0]} />
        </RigidBody>
      )}
      {/* The plate over the door, on the side you approach from. */}
      {door.kind !== "street" && (
        <mesh position={[0, 2.85, side * 0.115]} rotation={[0, side > 0 ? 0 : Math.PI, 0]}>
          <planeGeometry args={[1.6, 0.5]} />
          <meshStandardMaterial map={plate} roughness={0.8} />
        </mesh>
      )}
      {gated && <Reader x={leaf + 0.28} side={side} granted={granted} />}
      {gated && !granted && (
        <Interactable
          id={`door:${door.id}`}
          kind="open"
          label={sign.label}
          radius={1.9}
          position={[0, 0, side * 0.7]}
          requires={door.requires}
        onInteract={NOOP}
        />
      )}
    </group>
  );
}

/** The card reader beside a gated door: red until you hold the card, then green. */
function Reader({ x, side, granted }: { x: number; side: number; granted: boolean }) {
  return (
    <group position={[x, 1.2, side * 0.13]}>
      <mesh>
        <boxGeometry args={[0.14, 0.2, 0.05]} />
        <meshStandardMaterial color={OFFICE.dark} roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.06, side * 0.03]}>
        <boxGeometry args={[0.05, 0.025, 0.012]} />
        <meshStandardMaterial
          color={granted ? "#2f9d63" : "#b23a2e"}
          emissive={granted ? "#3bd17f" : "#e04a3a"}
          emissiveIntensity={1.4}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

/**
 * The rooftop lift at the corridor's end: brushed doors and a call panel. Shut and red until the
 * core quests are done ("Finish your core quests (3/5) to unlock the rooftop"); then the reader
 * turns green, the leaves slide apart as you come near, and E rides up. The doorway stays solid:
 * the lift is entered with E, not by walking.
 */
function LiftDoor({ door }: { door: Door }) {
  const unlocked = useGame((s) => !door.requires || meetsRequirement(s.player.cards, door.requires, s.unlocks));
  const done = useGame((s) => coreStatus(s.progress).done);
  const total = CORE_QUEST_IDS.length;
  const sign: Sign = unlocked
    ? { title: "Rooftop", line: "Open · Going up", accent: INK.green, label: "Take the lift to the rooftop" }
    : { title: "Rooftop", line: `Closed · ${done} of ${total} core quests`, accent: OFFICE.metal, label: "Rooftop lift" };
  const plate = useCanvasTexture(PLATE.width, PLATE.height, platePainter(sign.title, sign.line, sign.accent), `${sign.title}|${sign.line}|${sign.accent}`);
  const { rotation, side } = frame(door);
  const leaf = door.width / 2;
  const left = useRef<Mesh>(null);
  const right = useRef<Mesh>(null);
  const motion = useRef({ amount: 0, beeped: false });

  useFrame((_, delta) => {
    const state = useGame.getState();
    const distance = Math.hypot(rig.position.x - door.x, rig.position.z - door.z);
    const ready = state.world.phase === "ready";
    const m = motion.current;
    const wanted = ready && unlocked && distance < OPEN_RANGE;
    if (wanted && m.amount < 0.05) audio.play("door-open", { volume: 0.4 });
    if (!unlocked && ready && distance < BEEP_RANGE && !m.beeped) {
      m.beeped = true;
      audio.play("ui-deny", { volume: 0.45 });
    } else if (distance > OPEN_RANGE + 0.5) {
      m.beeped = false;
    }
    m.amount += ((wanted ? 1 : 0) - m.amount) * (1 - Math.exp(-7 * Math.min(delta, 0.1)));
    const slide = m.amount * leaf * 0.9;
    left.current?.position.setX(-leaf / 2 - slide);
    right.current?.position.setX(leaf / 2 + slide);
  });

  const ride = () => {
    audio.play("door-open", { volume: 0.5 });
    useGame.getState().transitionTo("rooftop", ROOFTOP_SPAWN);
  };

  return (
    <group position={[door.x, 0, door.z]} rotation={[0, rotation, 0]}>
      {[-1, 1].map((s) => (
        <mesh key={s} ref={s < 0 ? left : right} position={[(s * leaf) / 2, DOOR_HEIGHT / 2, side * 0.02]}>
          <boxGeometry args={[leaf - 0.02, DOOR_HEIGHT, 0.06]} />
          <meshStandardMaterial color="#aab3af" roughness={0.35} />
        </mesh>
      ))}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[leaf, DOOR_HEIGHT / 2, 0.08]} position={[0, DOOR_HEIGHT / 2, 0]} />
      </RigidBody>
      <mesh position={[0, 2.85, side * 0.115]} rotation={[0, side > 0 ? 0 : Math.PI, 0]}>
        <planeGeometry args={[1.6, 0.5]} />
        <meshStandardMaterial map={plate} roughness={0.8} />
      </mesh>
      <Reader x={leaf + 0.28} side={side} granted={unlocked} />
      <Interactable
        id={`door:${door.id}`}
        kind="open"
        label={sign.label}
        radius={1.9}
        position={[0, 0, side * 0.7]}
        requires={door.requires}
        onInteract={ride}
        lockedReason={`Finish your core quests (${done}/${total}) to unlock the rooftop`}
      />
    </group>
  );
}

import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { audio } from "@/game/audio/audio";
import { SunLight } from "@/game/engine/SunLight";
import { Interactable } from "@/game/interact/Interactable";
import { Avatar } from "@/game/player/Avatar";
import type { AvatarColors } from "@/game/player/avatar-style";
import { emit } from "@/game/quests/bus";
import { useGame } from "@/game/store/game-store";
import { cityEntrySpawn } from "../city/spawns";
import { SAMPLE_CITY } from "../city/sample";
import { Block, useSignTexture } from "../kit";

/**
 * The O2 test room (/dev/sandbox): floor, walls, a ramp and steps up to a platform, a chair, a
 * sign, a dummy NPC, a locked door (requirement gating), a mirror (avatar editor) and a lift to
 * the placeholder city (scene transitions). It exercises physics, the camera, interaction, the HUD,
 * quality tiers and audio.
 */
const COLORS = {
  floor: "#d8d4c9",
  wall: "#eceee9",
  trim: "#2f6f5e",
  wood: "#b48a60",
  carpet: "#7c9188",
  metal: "#8b9591",
  dark: "#38403c",
};

const HINA: AvatarColors = {
  skin: "#a46a43",
  hair: "#1d1a19",
  top: "#9c4535",
  bottom: "#3a4048",
  shoes: "#5a3a26",
  badge: "#4f9d7a",
};

const SIGN_TITLE = "Sandbox";
const SIGN_LINES = ["Walk: WASD or arrows. Run: Shift.", "Look: left-drag. Zoom: scroll.", "Use things: E. Menu: Esc."];

const CHAIR = { x: 3.5, z: -2.5, yaw: Math.PI };
const NPC = { x: 4.5, z: 3, yaw: -Math.PI / 2 };

export default function SandboxScene() {
  return (
    <>
      <color attach="background" args={["#dfe6e1"]} />
      <fog attach="fog" args={["#dfe6e1", 28, 60]} />
      <hemisphereLight args={["#f3f1ea", "#7d8a83", 1.25]} />
      <SunLight position={[7, 13, 8]} extent={14} />

      <Room />
      <Ramp />
      <Chair />
      <Sign />
      <Npc />
      <LockedDoor />
      <Mirror />
      <Lift />
    </>
  );
}

function Room() {
  return (
    <>
      <Block size={[24, 0.2, 24]} position={[0, -0.1, 0]} color={COLORS.floor} surface="concrete" castShadow={false} />
      {/* A rug: carpet footsteps. */}
      <Block size={[4, 0.02, 3]} position={[3.5, 0.01, -1.5]} color={COLORS.carpet} surface="carpet" castShadow={false} />
      <Block size={[24, 3, 0.3]} position={[0, 1.5, -12]} color={COLORS.wall} />
      <Block size={[24, 3, 0.3]} position={[0, 1.5, 12]} color={COLORS.wall} />
      <Block size={[0.3, 3, 24]} position={[-12, 1.5, 0]} color={COLORS.wall} />
      <Block size={[0.3, 3, 24]} position={[12, 1.5, 0]} color={COLORS.wall} />
      {/* A free-standing wall to back the camera into. */}
      <Block size={[0.3, 3, 6]} position={[-4, 1.5, -3]} color={COLORS.wall} />
      <Block size={[0.32, 0.12, 6.02]} position={[-4, 3.04, -3]} color={COLORS.trim} ghost />
    </>
  );
}

/** A 20° ramp up to a 1.2 m platform, with 0.16 m steps on the other side (autostep). */
function Ramp() {
  const rise = 1.2;
  const run = 3.3;
  const angle = Math.atan2(rise, run);
  const length = Math.hypot(rise, run);
  return (
    <>
      <Block size={[4, rise, 4]} position={[-8, rise / 2, -8]} color={COLORS.wood} surface="wood" />
      <Block
        size={[3, 0.2, length]}
        position={[-8, rise / 2 - 0.1 * Math.cos(angle), -6 + run / 2]}
        rotation={[angle, 0, 0]}
        color={COLORS.wood}
        surface="wood"
      />
      {Array.from({ length: 7 }, (_, i) => {
        const height = (i + 1) * (rise / 8);
        return (
          <Block
            key={i}
            size={[0.4, height, 2.4]}
            // Step 6 (the tallest) touches the platform's edge at x = -6.
            position={[-5.8 + (6 - i) * 0.4, height / 2, -8]}
            color={i % 2 ? "#c49a6c" : COLORS.wood}
            surface="wood"
          />
        );
      })}
    </>
  );
}

function Chair() {
  const sit = () => {
    useGame.getState().sit({ id: "sandbox-chair", position: [CHAIR.x, 0, CHAIR.z], yaw: CHAIR.yaw });
  };
  return (
    <group position={[CHAIR.x, 0, CHAIR.z]} rotation={[0, CHAIR.yaw, 0]}>
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[0.28, 0.25, 0.28]} position={[0, 0.25, 0]} />
        <CuboidCollider args={[0.28, 0.45, 0.04]} position={[0, 0.9, -0.26]} />
      </RigidBody>
      <mesh position={[0, 0.44, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.56, 0.08, 0.56]} />
        <meshStandardMaterial color={COLORS.trim} roughness={0.8} flatShading />
      </mesh>
      <mesh position={[0, 0.82, -0.26]} castShadow>
        <boxGeometry args={[0.56, 0.62, 0.06]} />
        <meshStandardMaterial color={COLORS.trim} roughness={0.8} flatShading />
      </mesh>
      {[
        [-0.24, -0.24],
        [0.24, -0.24],
        [-0.24, 0.24],
        [0.24, 0.24],
      ].map(([x, z]) => (
        <mesh key={`${x}:${z}`} position={[x, 0.2, z]} castShadow>
          <boxGeometry args={[0.05, 0.4, 0.05]} />
          <meshStandardMaterial color={COLORS.dark} roughness={0.6} />
        </mesh>
      ))}
      <Interactable id="sandbox-chair" kind="sit" label="Sit" radius={1.2} position={[0, 0, 0.3]} onInteract={sit} />
    </group>
  );
}

function Sign() {
  const texture = useSignTexture(SIGN_TITLE, SIGN_LINES);
  const read = () => {
    useGame.getState().openModal({
      type: "sign",
      title: "Welcome to the sandbox",
      lines: [
        "This room tests the office engine: walking and running, the ramp and steps, the camera against walls, and things you can use.",
        "Sit on the chair, talk to Hina, try the locked door, change your look at the mirror, or take the lift to the placeholder city and back.",
      ],
    });
    emit({ type: "sign_read", sign: "sandbox-welcome" });
  };
  return (
    <group position={[-1.5, 0, -6]}>
      <Block size={[0.12, 1.1, 0.12]} position={[0, 0.55, 0]} color={COLORS.dark} />
      <mesh position={[0, 1.55, 0.02]} castShadow>
        <boxGeometry args={[1.6, 1, 0.06]} />
        <meshStandardMaterial color={COLORS.dark} roughness={0.7} />
      </mesh>
      <mesh position={[0, 1.55, 0.056]}>
        <planeGeometry args={[1.5, 0.94]} />
        <meshStandardMaterial map={texture} roughness={0.9} />
      </mesh>
      <Interactable id="sandbox-sign" kind="read" label="Read the sign" radius={1.8} position={[0, 0, 0.6]} onInteract={read} />
    </group>
  );
}

function Npc() {
  const talking = useGame((s) => s.modal?.type === "dialogue" && s.modal.npc === "hina");
  const talk = () => {
    useGame.getState().startDialogue(
      {
        type: "dialogue",
        npc: "hina",
        name: "Hina",
        role: "Test dummy · Sandbox",
        lines: [
          "Hi! I'm a stand-in for the department experts.",
          "From phase O5 the people in each room answer your policy questions through DocuMind, with citations you can open.",
        ],
      },
      [NPC.x, 1.5, NPC.z],
    );
    emit({ type: "npc_talked", npc: "hina" });
  };
  return (
    <group position={[NPC.x, 0, NPC.z]} rotation={[0, NPC.yaw, 0]}>
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[0.28, 0.88, 0.28]} position={[0, 0.88, 0]} />
      </RigidBody>
      <Avatar colors={HINA} clip={talking ? "wave" : "idle"} />
      <Interactable id="sandbox-hina" kind="talk" label="Talk to Hina" radius={1.8} onInteract={talk} />
    </group>
  );
}

function LockedDoor() {
  return (
    <group position={[5, 0, -11.84]}>
      <Block size={[1.4, 2.3, 0.1]} position={[0, 1.15, 0]} color={COLORS.wood} />
      <Block size={[1.7, 0.15, 0.14]} position={[0, 2.37, 0]} color={COLORS.trim} ghost />
      <mesh position={[0.5, 1.1, 0.07]}>
        <boxGeometry args={[0.16, 0.24, 0.04]} />
        <meshStandardMaterial color={COLORS.dark} emissive="#b23a2e" emissiveIntensity={0.5} />
      </mesh>
      <Interactable
        id="sandbox-hr-door"
        kind="open"
        label="Open the HR records room"
        radius={1.6}
        position={[0, 0, 0.8]}
        requires="card:HR"
        onInteract={() => audio.play("door-open")}
      />
    </group>
  );
}

function Mirror() {
  return (
    <group position={[-10.5, 0, 2]} rotation={[0, Math.PI / 2, 0]}>
      <Block size={[1.1, 2, 0.12]} position={[0, 1, 0]} color={COLORS.dark} />
      <mesh position={[0, 1.05, 0.065]}>
        <planeGeometry args={[0.9, 1.75]} />
        <meshStandardMaterial color="#c9d6d2" metalness={0.6} roughness={0.15} />
      </mesh>
      <Interactable
        id="sandbox-mirror"
        kind="use"
        label="Change your look"
        radius={1.6}
        position={[0, 0, 0.8]}
        onInteract={() => useGame.getState().openModal({ type: "avatar" })}
      />
    </group>
  );
}

function Lift() {
  const ride = () => {
    audio.play("door-close");
    useGame.getState().transitionTo("city", cityEntrySpawn(SAMPLE_CITY));
  };
  return (
    <group position={[-9, 0, 9]}>
      <Block size={[2.2, 0.06, 2.2]} position={[0, 0.03, 0]} color={COLORS.metal} surface="concrete" castShadow={false} />
      <Block size={[2.4, 2.6, 0.2]} position={[0, 1.3, 1.2]} color={COLORS.trim} />
      <Interactable id="sandbox-lift" kind="open" label="Take the lift to the city" radius={1.6} onInteract={ride} />
    </group>
  );
}

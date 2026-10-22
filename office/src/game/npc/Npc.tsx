import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { useRef } from "react";
import type { Group } from "three";
import type { Persona } from "@/content/personas";
import { firstName } from "@/content/personas";
import { TIERS } from "@/game/engine/quality";
import { Interactable } from "@/game/interact/Interactable";
import { Avatar } from "@/game/player/Avatar";
import { rig } from "@/game/player/rig";
import { selectTier, useGame } from "@/game/store/game-store";
import type { Spot } from "@/game/world/office/floorplan";

/**
 * A DocuMind-backed NPC (phase O5 › NPCs): the player's rig in the persona's colours, idling,
 * gesturing while it talks, turning to face the player while focused or in conversation. A name
 * tag ("Sara · Reception") and a speech bubble (a short line, or a typing indicator) float above.
 */
export type Speech = { kind: "line"; text: string } | { kind: "typing" } | null;

type NpcProps = {
  persona: Persona;
  spot: Spot;
  /** The interactable's id; the NPC faces the player while it's focused. */
  interactId: string;
  onTalk: () => void;
  talking: boolean;
  speech: Speech;
  /** Reach for E, from the NPC (a desk between them needs more). */
  radius?: number;
};

const TURN_RATE = 6;
const angleDelta = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

export function Npc({ persona, spot, interactId, onTalk, talking, speech, radius = 1.8 }: NpcProps) {
  const body = useRef<Group>(null);
  const showTag = useGame((s) => TIERS[selectTier(s)].nameTags && s.settings.show_name_tags);
  const [x, , z] = spot.position;

  useFrame((_, delta) => {
    const group = body.current;
    if (!group) return;
    const state = useGame.getState();
    const engaged = state.focus?.id === interactId || (state.modal?.type === "npc" && state.modal.npc === persona.id);
    const target = engaged ? Math.atan2(rig.position.x - x, rig.position.z - z) : spot.yaw;
    group.rotation.y += angleDelta(group.rotation.y, target) * (1 - Math.exp(-TURN_RATE * Math.min(delta, 0.1)));
  });

  return (
    <group position={spot.position}>
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[0.28, 0.88, 0.28]} position={[0, 0.88, 0]} />
      </RigidBody>
      <group ref={body} rotation={[0, spot.yaw, 0]}>
        <Avatar colors={persona.colors} clip={talking ? "talk" : "idle"} />
      </group>
      <Interactable id={interactId} kind="talk" label={`Talk to ${firstName(persona)}`} radius={radius} onInteract={onTalk} />
      <Html position={[0, 2.05, 0]} center distanceFactor={6} zIndexRange={[19, 0]}>
        <div className="pointer-events-none flex flex-col items-center gap-1.5 select-none">
          {speech && <Bubble speech={speech} />}
          {showTag && (
            <span className="rounded-md bg-background/90 px-1.5 py-0.5 text-xs font-medium whitespace-nowrap text-foreground shadow-sm ring-1 ring-foreground/10">
              {firstName(persona)} <span className="text-muted-foreground">· {persona.role}</span>
            </span>
          )}
        </div>
      </Html>
    </group>
  );
}

function Bubble({ speech }: { speech: Exclude<Speech, null> }) {
  return (
    <div className="relative mb-1 w-max max-w-56 animate-in rounded-lg bg-popover px-2.5 py-1.5 text-[0.8rem] leading-snug text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-150 fade-in-0 zoom-in-95">
      {speech.kind === "typing" ? (
        <span className="flex h-4 items-center gap-1" aria-hidden>
          <span className="npc-typing-dot size-1.5 rounded-full bg-muted-foreground" />
          <span className="npc-typing-dot size-1.5 rounded-full bg-muted-foreground [animation-delay:150ms]" />
          <span className="npc-typing-dot size-1.5 rounded-full bg-muted-foreground [animation-delay:300ms]" />
        </span>
      ) : (
        speech.text
      )}
      <span aria-hidden className="absolute -bottom-1 left-1/2 size-2 -translate-x-1/2 rotate-45 bg-popover ring-0" />
    </div>
  );
}

import { useFrame } from "@react-three/fiber";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { useMemo, useRef, useState } from "react";
import { RECEPTION_NPC, receptionCallout, receptionistFor } from "@/content/personas";
import { audio } from "@/game/audio/audio";
import { Npc } from "@/game/npc/Npc";
import { useNpcSpeech } from "@/game/npc/use-speech";
import { rig } from "@/game/player/rig";
import { emit } from "@/game/quests/bus";
import { threadKey, useGame } from "@/game/store/game-store";
import { box, cylinder, Merged, type Part } from "../city/merge";
import { SAMPLE_CITY } from "../city/sample";
import type { Spot } from "./floorplan";
import { OFFICE } from "./palette";

/**
 * Reception (phase O5 › Reception): the desk with its badge printer, and the receptionist. Talking
 * opens her menu (ask a question, get access cards, change my look). On the first visit she
 * calls out when the player comes within 6 m.
 */
const CALLOUT_RANGE = 6;
const CALLOUT_MS = 7000;

function deskParts(): Part[] {
  const parts: Part[] = [];
  // A curved-looking front from three angled panels, a paper-white top and a green kick plate.
  parts.push({ color: OFFICE.wood, geometry: box(2.2, 1.05, 0.5, { at: [0, 0.525, 0.15] }) });
  for (const side of [-1, 1]) {
    parts.push({ color: OFFICE.wood, geometry: box(0.9, 1.05, 0.5, { at: [side * 1.42, 0.525, -0.05], rot: [0, side * 0.45, 0] }) });
  }
  parts.push({ color: OFFICE.paper, geometry: box(3.2, 0.06, 0.7, { at: [0, 1.08, 0.05] }) });
  parts.push({ color: OFFICE.green, geometry: box(2.2, 0.12, 0.52, { at: [0, 0.06, 0.16] }) });
  // The work surface behind, a monitor, and the badge printer.
  parts.push({ color: OFFICE.woodDark, geometry: box(2.8, 0.05, 0.6, { at: [0, 0.76, -0.45] }) });
  parts.push({ color: OFFICE.dark, geometry: box(0.55, 0.34, 0.03, { at: [-0.6, 1.0, -0.5], rot: [0, 0.25, 0] }) });
  parts.push({ color: OFFICE.dark, geometry: cylinder(0.03, 0.05, 0.18, 6, { at: [-0.6, 0.85, -0.5] }) });
  parts.push({ color: OFFICE.metal, geometry: box(0.4, 0.22, 0.32, { at: [0.75, 1.22, -0.05] }) });
  parts.push({ color: OFFICE.dark, geometry: box(0.3, 0.02, 0.02, { at: [0.75, 1.27, 0.115] }) });
  return parts;
}

export function Reception({ desk, spot }: { desk: Spot; spot: Spot }) {
  const office = useGame((s) => s.office);
  const place = office?.place ?? SAMPLE_CITY;
  const persona = useMemo(() => receptionistFor(office?.org.slug ?? "", place), [office?.org.slug, place]);
  const key = threadKey(place.id, RECEPTION_NPC);
  const talking = useGame((s) => s.modal?.type === "npc" && s.modal.npc === RECEPTION_NPC && s.chat[key]?.turns.at(-1)?.status === "streaming");
  const [callout, setCallout] = useState<string | null>(null);
  const speech = useNpcSpeech(key, callout);
  const wait = useRef(0);

  // First visit: a call-out once the player is within 6 m (and holds no card yet).
  useFrame((_, delta) => {
    wait.current -= delta;
    if (wait.current > 0) return;
    wait.current = 0.25;
    const state = useGame.getState();
    if (state.world.phase !== "ready" || state.calledOut[key] || state.player.cards.length > 0) return;
    const distance = Math.hypot(rig.position.x - spot.position[0], rig.position.z - spot.position[2]);
    if (distance > CALLOUT_RANGE) return;
    state.markCalledOut(key);
    audio.play("ui-open", { volume: 0.35 });
    setCallout(receptionCallout(office?.org.name ?? "DocuMind", place));
    setTimeout(() => setCallout(null), CALLOUT_MS);
  });

  const talk = () => {
    setCallout(null);
    const state = useGame.getState();
    if (state.office) {
      state.startDialogue({ type: "npc", npc: RECEPTION_NPC, view: "menu" }, [spot.position[0], 1.5, spot.position[2]]);
    } else {
      // The dev sandbox has no org to chat with.
      state.startDialogue(
        { type: "dialogue", npc: RECEPTION_NPC, name: persona.name, role: "Reception", lines: ["Welcome! Pick an org and an office to chat with me."] },
        [spot.position[0], 1.5, spot.position[2]],
      );
    }
    emit({ type: "npc_talked", npc: RECEPTION_NPC });
  };

  return (
    <>
      <group position={desk.position} rotation={[0, desk.yaw, 0]}>
        <Merged build={deskParts} />
        <RigidBody type="fixed" colliders={false} userData={{ surface: "wood" }}>
          <CuboidCollider args={[1.75, 0.55, 0.45]} position={[0, 0.55, 0.05]} />
        </RigidBody>
      </group>
      <Npc
        persona={persona}
        spot={spot}
        interactId="npc:reception"
        onTalk={talk}
        talking={talking}
        speech={speech}
        radius={2.6}
      />
    </>
  );
}

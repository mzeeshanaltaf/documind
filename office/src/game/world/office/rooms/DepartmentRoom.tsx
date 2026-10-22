import { useFrame } from "@react-three/fiber";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { useEffect, useMemo, useRef, useState } from "react";
import { firstName, type Persona } from "@/content/personas";
import type { RoomTheme } from "@/content/room-themes";
import { Npc } from "@/game/npc/Npc";
import { useAnswerGesture, useNpcSpeech } from "@/game/npc/use-speech";
import { rig } from "@/game/player/rig";
import { emit } from "@/game/quests/bus";
import { threadKey, useGame } from "@/game/store/game-store";
import { deriveLocations, type Location } from "@/lib/locations";
import { mergeVertexColored } from "../../city/merge";
import { SAMPLE_CITY } from "../../city/sample";
import { type Floorplan, type Room, roomFrame, type Spot, toWorld } from "../floorplan";
import { ServerLeds, ZoneClocks } from "./animated";
import { roomDecor } from "./decor";
import { clockOffices, type PanelContext, RoomPanels } from "./panels";

/**
 * One department room (phase O6 › Rooms): the shared shell pieces (rug, the expert's desk, the
 * wall screen) and the department's decor from its theme, all in the room's own frame, with the
 * expert NPC in front of the desk. The furniture's colliders are always there; what's drawn
 * mounts only while the player is near (rooms two bays away cost no draw calls).
 */
type Props = { room: Room; theme: RoomTheme; persona: Persona; plan: Floorplan; spot: Spot };

/** Decor in view within this distance of the room's centre (hidden again past `+2`). */
const DECOR_RANGE = 14;
const NPC_RANGE = 11;

/** True while the player is within `range` of (x, z), with 2 m of hysteresis. Checked at 4 Hz. */
function useNear(x: number, z: number, range: number): boolean {
  const [near, setNear] = useState(false);
  const state = useRef({ near: false, wait: 0 });
  useFrame((_, delta) => {
    const s = state.current;
    s.wait -= delta;
    if (s.wait > 0) return;
    s.wait = 0.25;
    const distance = Math.hypot(rig.position.x - x, rig.position.z - z);
    const next = s.near ? distance < range + 2 : distance < range;
    if (next !== s.near) {
      s.near = next;
      setNear(next);
    }
  });
  return near;
}

export function DepartmentRoom({ room, theme, persona, plan, spot }: Props) {
  const office = useGame((s) => s.office);
  const place = office?.place ?? SAMPLE_CITY;
  const department = room.department ?? room.name;
  const frame = roomFrame(room);
  const offices = useMemo<Location[]>(() => (office ? deriveLocations(office.org, office.documents) : [SAMPLE_CITY]), [office]);
  const timezones = useMemo(() => clockOffices(offices).map((o) => o.timezone), [offices]);
  const clockCount = timezones.length;
  const { w: width, d: depth } = room.rect;

  const built = useMemo(() => {
    const decor = roomDecor(theme.decor, theme.accent, { width, depth }, { offices: clockCount });
    return {
      matte: mergeVertexColored(decor.parts),
      glow: decor.glow.length > 0 ? mergeVertexColored(decor.glow) : null,
      colliders: decor.colliders,
      panels: decor.panels,
      leds: decor.leds,
      clocks: decor.clocks,
    };
  }, [theme.decor, theme.accent, width, depth, clockCount]);
  useEffect(
    () => () => {
      built.matte.dispose();
      built.glow?.dispose();
    },
    [built],
  );

  const near = useNear(frame.x, frame.z, DECOR_RANGE);
  const npcNear = useNear(frame.x, frame.z, NPC_RANGE);

  const context = useMemo<PanelContext>(
    () => ({ department, accent: theme.accent, expert: firstName(persona), blurb: theme.blurb, npc: persona.id, plan, city: place.name, offices }),
    [department, theme.accent, theme.blurb, persona, plan, place.name, offices],
  );

  return (
    <>
      <RigidBody type="fixed" colliders={false} userData={{ surface: "wood" }}>
        {built.colliders.map((collider, index) => (
          <CuboidCollider key={index} args={collider.half} position={toWorld(frame, collider.center)} />
        ))}
      </RigidBody>
      {near && (
        <group position={[frame.x, 0, frame.z]} rotation={[0, frame.yaw, 0]} userData={{ room: room.id }}>
          <mesh geometry={built.matte} castShadow receiveShadow>
            <meshStandardMaterial vertexColors flatShading roughness={0.85} />
          </mesh>
          {built.glow && (
            <mesh geometry={built.glow}>
              <meshBasicMaterial vertexColors toneMapped={false} />
            </mesh>
          )}
          <RoomPanels panels={built.panels} context={context} />
          {built.leds.length > 0 && <ServerLeds positions={built.leds} />}
          {built.clocks.length > 0 && <ZoneClocks clocks={built.clocks} timezones={timezones} />}
        </group>
      )}
      {npcNear && <Expert persona={persona} spot={spot} department={department} location={place.id} />}
    </>
  );
}

function Expert({ persona, spot, department, location }: { persona: Persona; spot: Spot; department: string; location: string }) {
  const key = threadKey(location, persona.id);
  const talking = useGame((s) => s.chat[key]?.turns.at(-1)?.status === "streaming");
  const speech = useNpcSpeech(key, null);
  const gesturing = useAnswerGesture(key);
  const seenFrom = useMemo(() => [department, "Corridor"], [department]);

  const talk = () => {
    const state = useGame.getState();
    const focus: [number, number, number] = [spot.position[0], 1.5, spot.position[2]];
    if (state.office) {
      state.startDialogue({ type: "npc", npc: persona.id, view: "chat" }, focus);
    } else {
      // The dev sandbox has no org to chat with.
      state.startDialogue(
        { type: "dialogue", npc: persona.id, name: persona.name, role: department, lines: ["Pick an org and an office to ask me something."] },
        focus,
      );
    }
    emit({ type: "npc_talked", npc: persona.id });
  };

  return (
    <Npc
      persona={persona}
      spot={spot}
      interactId={`npc:${persona.id}`}
      onTalk={talk}
      talking={talking}
      gesturing={gesturing}
      speech={speech}
      radius={2}
      seenFrom={seenFrom}
    />
  );
}

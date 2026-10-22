import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { audio } from "@/game/audio/audio";
import { SunLight } from "@/game/engine/SunLight";
import { rig } from "@/game/player/rig";
import { emit } from "@/game/quests/bus";
import { useGame } from "@/game/store/game-store";
import { SAMPLE_CITY } from "../city/sample";
import { cityExitSpawn } from "../city/spawns";
import { Trigger } from "../Trigger";
import { Doors } from "./doors";
import { type Floorplan, roomAt } from "./floorplan";
import { Lobby } from "./lobby";
import { Reception } from "./reception";
import { Rooms } from "./rooms";
import { Shell } from "./Shell";
import { useOfficeDepartments, floorplanFor } from "./use-floorplan";

/**
 * The office interior (phase O5): the floor plan built from the org's departments, with the
 * lobby, reception, the card-gated corridor of furnished department rooms and their experts
 * (O6), the presentation room and the play area. Walking out through the street doors returns
 * to the city.
 */
export default function OfficeScene() {
  const departments = useOfficeDepartments();
  const plan = floorplanFor(departments);
  const version = departments.join("|");
  const place = useGame((s) => s.office?.place) ?? SAMPLE_CITY;

  const leave = () => {
    audio.play("door-open", { volume: 0.5 });
    useGame.getState().transitionTo("city", cityExitSpawn(place));
  };

  return (
    <>
      <color attach="background" args={["#dfe5e0"]} />
      <hemisphereLight args={["#f6f5ef", "#9a9f92", 1.55]} />
      <SunLight position={[-5, 16, 6]} intensity={1.6} extent={16} follow far={40} />
      <Shell plan={plan} version={version} />
      <Doors doors={plan.doors} />
      <Lobby plan={plan} />
      <Reception desk={plan.props.desk} spot={plan.npcSpots.reception} />
      <Rooms plan={plan} />
      <RoomTracker plan={plan} location={place.id} />
      <Trigger box={plan.exit} onEnter={leave} />
    </>
  );
}

/** The breadcrumb's room and `room_entered`, from the floor plan's bounds (5 Hz). */
function RoomTracker({ plan, location }: { plan: Floorplan; location: string }) {
  const current = useRef<string | null>(null);
  const wait = useRef(0);
  useFrame((_, delta) => {
    wait.current -= delta;
    if (wait.current > 0) return;
    wait.current = 0.2;
    const room = roomAt(plan, rig.position.x, rig.position.z);
    if (!room || room.id === current.current) return;
    current.current = room.id;
    useGame.getState().setLocation({ room: room.name });
    emit({ type: "room_entered", room: room.id, department: room.department, location });
  });
  return null;
}

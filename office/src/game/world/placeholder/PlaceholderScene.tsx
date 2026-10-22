import { useEffect } from "react";
import { audio } from "@/game/audio/audio";
import { SunLight } from "@/game/engine/SunLight";
import { Interactable } from "@/game/interact/Interactable";
import { useGame } from "@/game/store/game-store";
import { SAMPLE_CITY } from "../city/sample";
import { cityExitSpawn } from "../city/spawns";
import { Block, useSignTexture } from "../kit";
import { OFFICE_EXIT } from "../office/spawns";
import { SANDBOX_SPAWNS } from "../sandbox/spawns";
import { Trigger } from "../Trigger";

const OFFICE_LINES = ["The lobby, reception and experts arrive in phase O5.", "Walk back out through the doors to the street."];
const OTHER_LINES = ["This scene arrives in a later phase.", "Take the lift back to the sandbox."];

/**
 * Stands in for the office (until O5) and the rooftop (O9). As the office it has the street
 * doors in its south wall: walking out through them returns to the city, outside the entrance.
 * Reached from the dev sandbox, it also has the lift back.
 */
export default function PlaceholderScene() {
  const scene = useGame((s) => s.world.scene);
  const office = useGame((s) => s.office);
  const isOffice = scene === "office";
  const title = isOffice ? (office ? `Lobby · ${office.org.name}` : "Lobby") : `The ${scene} goes here`;
  const texture = useSignTexture(title, isOffice ? OFFICE_LINES : OTHER_LINES);

  useEffect(() => {
    if (isOffice) useGame.getState().setLocation({ room: "Lobby" });
  }, [isOffice]);

  const ride = () => {
    audio.play("door-close");
    useGame.getState().transitionTo("sandbox", SANDBOX_SPAWNS.lift);
  };
  const leave = () => {
    audio.play("door-open", { volume: 0.5 });
    useGame.getState().transitionTo("city", cityExitSpawn(office?.place ?? SAMPLE_CITY));
  };

  return (
    <>
      <color attach="background" args={["#d6e2e6"]} />
      <hemisphereLight args={["#eef4f6", "#7b8a80", 1.3]} />
      <SunLight position={[-6, 12, 7]} extent={10} />
      <Block size={[16, 0.2, 16]} position={[0, -0.1, 0]} color="#c9d0c4" surface="carpet" castShadow={false} />
      <Block size={[1.8, 1.1, 0.08]} position={[0, 1.4, -2]} color="#38403c" />
      <mesh position={[0, 1.4, -1.955]}>
        <planeGeometry args={[1.7, 1.03]} />
        <meshStandardMaterial map={texture} roughness={0.9} />
      </mesh>
      {!office && (
        <group position={[3.5, 0, 1]}>
          <Block size={[2.2, 0.06, 2.2]} position={[0, 0.03, 0]} color="#8b9591" castShadow={false} />
          <Block size={[2.4, 2.6, 0.2]} position={[0, 1.3, -1.2]} color="#2f6f5e" />
          <Interactable id="placeholder-lift" kind="open" label="Take the lift to the sandbox" radius={1.6} onInteract={ride} />
        </group>
      )}
      {/* Walls, with the street doors' opening in the south one. */}
      <Block size={[16, 3, 0.3]} position={[0, 1.5, -8]} color="#b8c0b4" />
      <Block size={[0.3, 3, 16]} position={[-8, 1.5, 0]} color="#b8c0b4" />
      <Block size={[0.3, 3, 16]} position={[8, 1.5, 0]} color="#b8c0b4" />
      {isOffice ? (
        <>
          <Block size={[6.8, 3, 0.3]} position={[-4.6, 1.5, 8]} color="#b8c0b4" />
          <Block size={[6.8, 3, 0.3]} position={[4.6, 1.5, 8]} color="#b8c0b4" />
          <Block size={[2.4, 0.6, 0.3]} position={[0, 2.7, 8]} color="#2f6f5e" ghost />
          {/* Daylight beyond the doors. */}
          <mesh position={[0, 1.2, 8.3]}>
            <planeGeometry args={[2.4, 2.4]} />
            <meshBasicMaterial color="#eef3ef" />
          </mesh>
          <Block size={[2.4, 3, 0.3]} position={[0, 1.5, 8.8]} color="#eef3ef" />
          <Trigger box={OFFICE_EXIT} onEnter={leave} />
        </>
      ) : (
        <Block size={[16, 3, 0.3]} position={[0, 1.5, 8]} color="#b8c0b4" />
      )}
    </>
  );
}

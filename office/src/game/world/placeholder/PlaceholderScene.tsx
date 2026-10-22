import { audio } from "@/game/audio/audio";
import { SunLight } from "@/game/engine/SunLight";
import { Interactable } from "@/game/interact/Interactable";
import { useGame } from "@/game/store/game-store";
import { Block, useSignTexture } from "../kit";
import { SANDBOX_SPAWNS } from "../sandbox/spawns";

const LINES = ["This scene arrives in a later phase.", "Take the lift back to the sandbox."];

/**
 * Stands in for the rooftop until O9 (the office has its own scene since O5). Reached from the
 * dev sandbox, it has the lift back.
 */
export default function PlaceholderScene() {
  const scene = useGame((s) => s.world.scene);
  const texture = useSignTexture(`The ${scene} goes here`, LINES);

  const ride = () => {
    audio.play("door-close");
    useGame.getState().transitionTo("sandbox", SANDBOX_SPAWNS.lift);
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
      <group position={[3.5, 0, 1]}>
        <Block size={[2.2, 0.06, 2.2]} position={[0, 0.03, 0]} color="#8b9591" castShadow={false} />
        <Block size={[2.4, 2.6, 0.2]} position={[0, 1.3, -1.2]} color="#2f6f5e" />
        <Interactable id="placeholder-lift" kind="open" label="Take the lift to the sandbox" radius={1.6} onInteract={ride} />
      </group>
      <Block size={[16, 3, 0.3]} position={[0, 1.5, -8]} color="#b8c0b4" />
      <Block size={[0.3, 3, 16]} position={[-8, 1.5, 0]} color="#b8c0b4" />
      <Block size={[0.3, 3, 16]} position={[8, 1.5, 0]} color="#b8c0b4" />
      <Block size={[16, 3, 0.3]} position={[0, 1.5, 8]} color="#b8c0b4" />
    </>
  );
}

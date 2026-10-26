import { useThree } from "@react-three/fiber";
import { Physics } from "@react-three/rapier";
import { type ComponentType, type LazyExoticComponent, lazy, Suspense, useEffect } from "react";
import { InteractionSystem } from "@/game/interact/InteractionSystem";
import { FollowCamera } from "@/game/player/FollowCamera";
import { Player } from "@/game/player/Player";
import { emit } from "@/game/quests/bus";
import { type SceneId, useGame } from "@/game/store/game-store";

/**
 * Each scene is its own lazy chunk: the dev sandbox, the city (O4), the office (O5) and the
 * rooftop lounge (O9).
 */
const SCENES: Record<SceneId, LazyExoticComponent<ComponentType>> = {
  sandbox: lazy(() => import("@/game/world/sandbox/SandboxScene")),
  city: lazy(() => import("@/game/world/city/CityScene")),
  office: lazy(() => import("@/game/world/office/OfficeScene")),
  rooftop: lazy(() => import("@/game/world/office/rooftop")),
};

/**
 * Mounts the current scene inside its own physics world. A transition changes the key, so the
 * old scene, its world and the player unmount together (R3F disposes what they created) before
 * the new one mounts; the loading curtain covers the swap.
 */
export function SceneManager() {
  const scene = useGame((s) => s.world.scene);
  const epoch = useGame((s) => s.world.epoch);
  const gl = useThree((state) => state.gl);
  const Scene = SCENES[scene];

  // Render lists hold references to the old scene's objects until the next render; drop them.
  useEffect(() => () => gl.renderLists.dispose(), [gl, scene, epoch]);

  return (
    <Suspense fallback={null}>
      <Physics key={`${scene}:${epoch}`} timeStep="vary" gravity={[0, -9.81, 0]}>
        <Scene />
        <Player />
        <FollowCamera />
        <InteractionSystem />
        <SceneReady scene={scene} />
      </Physics>
    </Suspense>
  );
}

/** Commits only once everything above it has stopped suspending (scene chunk, rapier's wasm). */
function SceneReady({ scene }: { scene: SceneId }) {
  useEffect(() => {
    useGame.getState().sceneReady();
    emit({ type: "scene_entered", scene });
  }, [scene]);
  return null;
}

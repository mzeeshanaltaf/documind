import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { type InstancedMesh, Object3D } from "three";
import { rig } from "@/game/player/rig";
import { guidePath, pathLength, pointAlong } from "@/game/quests/guide";
import { selectReducedMotion, useGame } from "@/game/store/game-store";
import { INK } from "../city/signs";
import type { Floorplan } from "./floorplan";

/**
 * The journal's "Show me" trail (phase O9): a line of dots on the floor from the player to the
 * quest's target, running through the doors, with a slow flow towards the target. With reduced
 * motion there's no trail at all, only the marker on the minimap. The guide ends on arrival.
 */
const MAX_DOTS = 160;
const SPACING = 0.9;
const ARRIVED = 1.8;
const REFRESH_S = 0.1;

const dummy = new Object3D();

export function GuideTrail({ plan }: { plan: Floorplan }) {
  const guide = useGame((s) => s.guide);
  const reduced = useGame(selectReducedMotion);
  const mesh = useRef<InstancedMesh>(null);
  const clock = useRef({ wait: 0, flow: 0 });

  // Arrival ends the guide, whether or not the trail is drawn.
  useFrame((_, delta) => {
    if (!guide) return;
    const c = clock.current;
    c.wait -= delta;
    c.flow = (c.flow + delta * 1.1) % SPACING;
    if (c.wait > 0) return;
    c.wait = REFRESH_S;
    const distance = Math.hypot(rig.position.x - guide.target[0], rig.position.z - guide.target[2]);
    if (distance < ARRIVED) {
      useGame.getState().setGuide(null);
      return;
    }
    const dots = mesh.current;
    if (!dots) return;
    const path = guidePath(plan, [rig.position.x, rig.position.z], [guide.target[0], guide.target[2]]);
    const length = pathLength(path);
    const count = Math.min(MAX_DOTS, Math.floor((length - c.flow) / SPACING) + 1);
    for (let i = 0; i < count; i++) {
      const at = pointAlong(path, c.flow + i * SPACING);
      // Dots fade out of existence near the player and the target by shrinking.
      const edge = Math.min(1, (c.flow + i * SPACING) / 1.2, (length - (c.flow + i * SPACING)) / 1.2);
      dummy.position.set(at[0], at[1], at[2]);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.scale.setScalar(Math.max(0.05, edge));
      dummy.updateMatrix();
      dots.setMatrixAt(i, dummy.matrix);
    }
    dots.count = Math.max(0, count);
    dots.instanceMatrix.needsUpdate = true;
  });

  useEffect(() => {
    if (mesh.current) mesh.current.count = 0;
  }, [guide]);

  if (!guide || reduced) return null;
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, MAX_DOTS]} frustumCulled={false} renderOrder={2}>
      <circleGeometry args={[0.13, 12]} />
      <meshBasicMaterial color={INK.green} toneMapped={false} />
    </instancedMesh>
  );
}

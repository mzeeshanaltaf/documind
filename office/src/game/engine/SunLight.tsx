import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useRef } from "react";
import { type DirectionalLight, Vector3 } from "three";
import { rig } from "@/game/player/rig";
import { selectTier, useGame } from "@/game/store/game-store";
import { TIERS } from "./quality";

const lightDir = new Vector3();
const lightRight = new Vector3();
const lightUp = new Vector3();
const snapped = new Vector3();

type SunLightProps = {
  position?: [number, number, number];
  intensity?: number;
  color?: string;
  /** Half-size of the square the shadow camera covers, in metres. */
  extent?: number;
  /**
   * Big outdoor scenes: `position` becomes an offset from the player, and the light (with its
   * shadow box) moves with them.
   */
  follow?: boolean;
  /** Far plane of the shadow camera. */
  far?: number;
};

/**
 * The scene's key light. Shadows and the shadow-map size follow the quality tier live; a size
 * change frees the old map so three allocates one at the new size.
 */
export function SunLight({
  position = [8, 14, 6],
  intensity = 2.4,
  color = "#fff6e8",
  extent = 14,
  follow = false,
  far = 60,
}: SunLightProps) {
  const light = useRef<DirectionalLight>(null);
  const { shadows, shadowMap } = TIERS[useGame(selectTier)];

  useLayoutEffect(() => {
    const sun = light.current;
    if (!sun) return;
    sun.castShadow = shadows;
    if (shadows && sun.shadow.mapSize.x !== shadowMap) {
      sun.shadow.mapSize.set(shadowMap, shadowMap);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
  }, [shadows, shadowMap]);

  useFrame(() => {
    const sun = light.current;
    if (!follow || !sun) return;
    // Snap the shadow box to whole shadow-map texels in light space: a box that glides with the
    // player makes every shadow edge swim, which shows as shimmering stripes on grazing faces.
    const texel = (2 * extent) / sun.shadow.mapSize.x;
    lightDir.set(position[0], position[1], position[2]).normalize();
    lightRight.set(0, 1, 0).cross(lightDir).normalize();
    lightUp.copy(lightDir).cross(lightRight);
    const at = snapped.copy(rig.position);
    at.addScaledVector(lightRight, -(at.dot(lightRight) % texel));
    at.addScaledVector(lightUp, -(at.dot(lightUp) % texel));
    sun.position.set(at.x + position[0], at.y + position[1], at.z + position[2]);
    sun.target.position.copy(at);
    // The target is not in the scene graph, so its matrix is updated by hand.
    sun.target.updateMatrixWorld();
  });

  return (
    <directionalLight
      ref={light}
      position={position}
      intensity={intensity}
      color={color}
      shadow-bias={-0.0004}
      shadow-normalBias={0.05}
      shadow-camera-left={-extent}
      shadow-camera-right={extent}
      shadow-camera-top={extent}
      shadow-camera-bottom={-extent}
      shadow-camera-near={1}
      shadow-camera-far={far}
    />
  );
}

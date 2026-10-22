import type { ThreeEvent } from "@react-three/fiber";
import { use, useEffect, useMemo } from "react";
import { loadEarthMask } from "./earth-mask";
import { buildEarthGeometry } from "./earth-geometry";
import type { GlobeTheme } from "./globe-theme";

/**
 * The low-poly Earth: land and sea faces from the Natural Earth mask (suspends until it has
 * loaded), over a slightly smaller sea sphere that fills the steps at the coasts.
 */
export function Earth({ detail, theme }: { detail: number; theme: GlobeTheme }) {
  const mask = use(loadEarthMask());
  const geometry = useMemo(() => buildEarthGeometry(detail, mask, theme.earth), [detail, mask, theme.earth]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  // R3F only raycasts objects with handlers: these make the Earth one, so it hides the pins
  // round the back from the pointer (events stop at the first hit).
  const occlude = (event: ThreeEvent<PointerEvent | MouseEvent>) => event.stopPropagation();

  return (
    <>
      <mesh geometry={geometry} onPointerMove={occlude} onClick={occlude}>
        <meshStandardMaterial vertexColors flatShading roughness={0.95} metalness={0} />
      </mesh>
      <mesh scale={0.996}>
        <icosahedronGeometry args={[1, Math.min(detail, 6)]} />
        <meshStandardMaterial color={theme.seaBase} flatShading roughness={0.95} />
      </mesh>
    </>
  );
}

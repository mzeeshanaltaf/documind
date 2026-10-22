import { Sky, Stars } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { BackSide, Color, Float32BufferAttribute, type Mesh, SphereGeometry } from "three";
import { SunLight } from "@/game/engine/SunLight";
import { selectTier, useGame } from "@/game/store/game-store";
import type { SkyState } from "./lighting";

/** Fog starts past the plaza and swallows the skyline's far edge. */
const FOG = { near: 90, far: 330 };

/**
 * The city's sky and lights from a `SkyState`: a hemisphere fill, one key light (sun or moon)
 * whose shadow box follows the player, fog in the horizon colour, the physical sky shader on
 * medium/high by day or a cheap gradient dome (on low, and on every tier after dusk, where the
 * sky shader turns a flat grey), and stars once it's dark.
 */
export function CitySky({ sky, extent = 34, fog = FOG }: { sky: SkyState; extent?: number; fog?: { near: number; far: number } }) {
  const low = useGame(selectTier) === "low";
  const dome = low || sky.night > 0.6;
  const [kx, ky, kz] = sky.keyDirection;
  const [sx, sy, sz] = sky.sun;

  return (
    <>
      <color attach="background" args={[sky.horizon]} />
      <fog attach="fog" args={[sky.horizon, fog.near, fog.far]} />
      <hemisphereLight color={sky.hemisphere.sky} groundColor={sky.hemisphere.ground} intensity={sky.hemisphere.intensity} />
      <SunLight follow position={[kx * 80, ky * 80, kz * 80]} color={sky.keyColor} intensity={sky.keyIntensity} extent={extent} far={180} />
      {dome ? (
        <GradientDome zenith={sky.zenith} horizon={sky.horizon} />
      ) : (
        <Sky
          sunPosition={[sx * 100, sy * 100, sz * 100]}
          turbidity={sky.night > 0.5 ? 2 : 7}
          rayleigh={sky.night > 0.5 ? 0.4 : 1.6}
          mieCoefficient={0.004}
          mieDirectionalG={0.82}
        />
      )}
      {sky.night > 0.3 && <Stars radius={260} depth={60} count={low ? 700 : 1500} factor={4.5} saturation={0} fade speed={0} />}
    </>
  );
}

const DOME_RADIUS = 340;

/** A sphere coloured from the horizon up to the zenith, centred on the camera. */
function domeGeometry(zenith: string, horizon: string) {
  const sphere = new SphereGeometry(DOME_RADIUS, 24, 12);
  const position = sphere.getAttribute("position");
  const colors = new Float32Array(position.count * 3);
  const top = new Color(zenith);
  const bottom = new Color(horizon);
  const mixed = new Color();
  for (let i = 0; i < position.count; i++) {
    const height = Math.max(0, position.getY(i) / DOME_RADIUS);
    mixed.copy(bottom).lerp(top, Math.pow(Math.min(1, height / 0.7), 0.6));
    colors.set([mixed.r, mixed.g, mixed.b], i * 3);
  }
  sphere.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return sphere;
}

function GradientDome({ zenith, horizon }: { zenith: string; horizon: string }) {
  const mesh = useRef<Mesh>(null);
  const geometry = useMemo(() => domeGeometry(zenith, horizon), [zenith, horizon]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame(({ camera }) => mesh.current?.position.copy(camera.position));

  return (
    <mesh ref={mesh} geometry={geometry} renderOrder={-1}>
      <meshBasicMaterial vertexColors side={BackSide} fog={false} depthWrite={false} />
    </mesh>
  );
}

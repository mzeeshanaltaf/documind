import { Canvas, useFrame } from "@react-three/fiber";
import { useTheme } from "next-themes";
import { useLayoutEffect, useRef, useState } from "react";
import { type Group, type InstancedMesh, Object3D } from "three";
import { previewMotion } from "@/game/engine/preview";
import { PreviewBoundary } from "@/game/engine/PreviewBoundary";
import { TIERS } from "@/game/engine/quality";
import type { Player } from "@/lib/player";

type DioramaColors = {
  plaza: string;
  plazaSide: string;
  grass: string;
  stone: string;
  glass: string;
  accent: string;
  trunk: string;
  leaves: string;
  sky: [string, string];
};

/** Paper and ink by day; the same block at dusk in dark mode. Ink green only on the canopy. */
const COLORS: Record<"light" | "dark", DioramaColors> = {
  light: {
    plaza: "#e6ebe6",
    plazaSide: "#c9d1cb",
    grass: "#b4c8b1",
    stone: "#f2f4f0",
    glass: "#8fb0a7",
    accent: "#1a5d48",
    trunk: "#7d6a58",
    leaves: "#7fa88f",
    sky: ["#ffffff", "#a7b8b0"],
  },
  dark: {
    plaza: "#3a4741",
    plazaSide: "#2a3530",
    grass: "#3f5a4a",
    stone: "#c9d1cc",
    glass: "#4e7a6e",
    accent: "#7cc3ac",
    trunk: "#5b4b3e",
    leaves: "#4f7a62",
    sky: ["#dfe9e4", "#18211d"],
  },
};

const FLOORS = 9;
const FLOOR_HEIGHT = 0.36;
const TREES: [number, number, number][] = [
  [-1.55, 0, 1.25],
  [-1.15, 0, 1.6],
  [1.6, 0, -1.35],
  [1.35, 0, 1.55],
  [-1.6, 0, -1.2],
];

/**
 * The org picker's backdrop: a small low-poly office block on a plaza, turning slowly. Static
 * (rendered once, on demand) on the low tier and with reduced motion. Loaded with `ssr: false`.
 */
export default function OfficeDiorama({ player }: { player: Pick<Player, "settings" | "updatedAt"> }) {
  return (
    <PreviewBoundary>
      <Diorama player={player} />
    </PreviewBoundary>
  );
}

function Diorama({ player }: { player: Pick<Player, "settings" | "updatedAt"> }) {
  const [motion] = useState(() => previewMotion(player));
  const { resolvedTheme } = useTheme();
  const colors = COLORS[resolvedTheme === "dark" ? "dark" : "light"];
  const animate = !motion.reduced && motion.tier !== "low";
  const tier = TIERS[motion.tier];

  return (
    <Canvas
      aria-hidden
      frameloop={animate ? "always" : "demand"}
      dpr={[1, tier.dpr]}
      gl={{ antialias: tier.antialias, alpha: true, powerPreference: "low-power" }}
      camera={{ fov: 26, near: 0.1, far: 60, position: [9.5, 7.2, 9.5] }}
      onCreated={({ camera }) => camera.lookAt(0, 1.45, 0)}
    >
      <hemisphereLight args={[colors.sky[0], colors.sky[1], 1.6]} />
      <directionalLight position={[-4, 9, 6]} intensity={1.8} color="#fff6e8" />
      <Turntable animate={animate}>
        <Plaza colors={colors} />
        <Tower colors={colors} />
        <Annex colors={colors} />
        <Trees colors={colors} />
      </Turntable>
    </Canvas>
  );
}

function Turntable({ animate, children }: { animate: boolean; children: React.ReactNode }) {
  const group = useRef<Group>(null);
  useFrame((_, delta) => {
    if (animate && group.current) group.current.rotation.y += Math.min(delta, 0.1) * 0.12;
  });
  return (
    <group ref={group} rotation={[0, -0.5, 0]}>
      {children}
    </group>
  );
}

function Plaza({ colors }: { colors: DioramaColors }) {
  return (
    <group>
      <mesh position={[0, -0.18, 0]}>
        <cylinderGeometry args={[2.75, 2.85, 0.36, 8]} />
        <meshStandardMaterial color={colors.plazaSide} flatShading roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.005, 0]}>
        <cylinderGeometry args={[2.7, 2.7, 0.01, 8]} />
        <meshStandardMaterial color={colors.plaza} flatShading roughness={0.95} />
      </mesh>
      <mesh position={[0.15, 0.02, 1.55]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[1.7, 0.9]} />
        <meshStandardMaterial color={colors.grass} roughness={1} />
      </mesh>
    </group>
  );
}

/** Stone floor slabs (one instanced mesh) around a glass core, a roof box and a mast. */
function Tower({ colors }: { colors: DioramaColors }) {
  const slabs = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = slabs.current;
    if (!mesh) return;
    const dummy = new Object3D();
    for (let i = 0; i <= FLOORS; i++) {
      dummy.position.set(0, 0.3 + i * FLOOR_HEIGHT, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, []);

  const height = FLOORS * FLOOR_HEIGHT;
  return (
    <group position={[-0.35, 0, -0.25]}>
      {/* Lobby: recessed glass under the first slab, with the ink-green canopy. */}
      <mesh position={[0, 0.15, 0]}>
        <boxGeometry args={[1.25, 0.3, 1.25]} />
        <meshStandardMaterial color={colors.glass} flatShading roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.34, 0.86]}>
        <boxGeometry args={[0.8, 0.05, 0.36]} />
        <meshStandardMaterial color={colors.accent} flatShading roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.3 + height / 2, 0]}>
        <boxGeometry args={[1.32, height, 1.32]} />
        <meshStandardMaterial color={colors.glass} flatShading roughness={0.25} metalness={0.1} />
      </mesh>
      <instancedMesh ref={slabs} args={[undefined, undefined, FLOORS + 1]}>
        <boxGeometry args={[1.5, 0.07, 1.5]} />
        <meshStandardMaterial color={colors.stone} flatShading roughness={0.9} />
      </instancedMesh>
      <mesh position={[0.15, 0.3 + height + 0.2, -0.1]}>
        <boxGeometry args={[0.7, 0.36, 0.6]} />
        <meshStandardMaterial color={colors.stone} flatShading roughness={0.9} />
      </mesh>
      <mesh position={[-0.35, 0.3 + height + 0.55, 0.3]}>
        <cylinderGeometry args={[0.02, 0.02, 0.8, 5]} />
        <meshStandardMaterial color={colors.stone} roughness={0.9} />
      </mesh>
    </group>
  );
}

function Annex({ colors }: { colors: DioramaColors }) {
  return (
    <group position={[1.15, 0, 0.35]}>
      <mesh position={[0, 0.65, 0]}>
        <boxGeometry args={[1.05, 1.3, 1.4]} />
        <meshStandardMaterial color={colors.stone} flatShading roughness={0.9} />
      </mesh>
      {[0.42, 0.88].map((y) => (
        <mesh key={y} position={[0.01, y, 0]}>
          <boxGeometry args={[1.08, 0.16, 1.2]} />
          <meshStandardMaterial color={colors.glass} flatShading roughness={0.3} />
        </mesh>
      ))}
    </group>
  );
}

function Trees({ colors }: { colors: DioramaColors }) {
  return (
    <>
      {TREES.map(([x, y, z], i) => (
        <group key={i} position={[x, y, z]} scale={0.85 + (i % 3) * 0.12}>
          <mesh position={[0, 0.14, 0]}>
            <cylinderGeometry args={[0.04, 0.05, 0.28, 5]} />
            <meshStandardMaterial color={colors.trunk} flatShading />
          </mesh>
          <mesh position={[0, 0.52, 0]}>
            <coneGeometry args={[0.24, 0.62, 6]} />
            <meshStandardMaterial color={colors.leaves} flatShading roughness={0.9} />
          </mesh>
        </group>
      ))}
    </>
  );
}

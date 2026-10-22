import type { ThreeElements } from "@react-three/fiber";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { useEffect, useMemo } from "react";
import { CanvasTexture, SRGBColorSpace } from "three";
import type { Surface } from "@/game/audio/audio";

type BlockProps = {
  size: [number, number, number];
  color: string;
  /** What footsteps on its top sound like. */
  surface?: Surface;
  /** Visual only: no collider. */
  ghost?: boolean;
  castShadow?: boolean;
} & Pick<ThreeElements["group"], "position" | "rotation">;

/**
 * A static box with a matching collider: the building block of test and placeholder scenes.
 * Its geometry and material are JSX-created, so R3F disposes them with the scene.
 */
export function Block({ size, color, surface, ghost = false, castShadow = true, position, rotation }: BlockProps) {
  const mesh = (
    <mesh castShadow={castShadow} receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={0.9} flatShading />
    </mesh>
  );
  if (ghost) {
    return (
      <group position={position} rotation={rotation}>
        {mesh}
      </group>
    );
  }
  return (
    <RigidBody type="fixed" colliders={false} position={position} rotation={rotation} userData={{ surface }}>
      <CuboidCollider args={[size[0] / 2, size[1] / 2, size[2] / 2]} />
      {mesh}
    </RigidBody>
  );
}

const SIGN_WIDTH = 512;
const SIGN_HEIGHT = 320;

function cssFont(variable: string, fallback: string) {
  const family = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  return family ? `${family}, ${fallback}` : fallback;
}

/**
 * A notice painted on a canvas (no font download, unlike troika text): a serif title and sans
 * lines in DocuMind's families, painted again once the web fonts have loaded.
 */
function createSignTexture(title: string, lines: readonly string[]): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = SIGN_WIDTH;
  canvas.height = SIGN_HEIGHT;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  const context = canvas.getContext("2d");
  if (!context) return texture;

  const serif = `600 46px ${cssFont("--font-source-serif", "Georgia, serif")}`;
  const sans = `400 28px ${cssFont("--font-instrument-sans", "system-ui, sans-serif")}`;
  const paint = () => {
    context.fillStyle = "#f7f8f4";
    context.fillRect(0, 0, SIGN_WIDTH, SIGN_HEIGHT);
    context.fillStyle = "#2f6f5e";
    context.fillRect(0, 0, SIGN_WIDTH, 14);
    context.fillStyle = "#1e2a25";
    context.font = serif;
    context.fillText(title, 36, 86);
    context.font = sans;
    context.fillStyle = "#47524d";
    lines.forEach((line, index) => context.fillText(line, 36, 144 + index * 44));
    texture.needsUpdate = true;
  };
  paint();
  void Promise.all([document.fonts.load(serif), document.fonts.load(sans)]).then(paint, () => undefined);
  return texture;
}

/** A sign texture for the component's lifetime (pass a module-level `lines` array). */
export function useSignTexture(title: string, lines: readonly string[]) {
  const texture = useMemo(() => createSignTexture(title, lines), [title, lines]);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

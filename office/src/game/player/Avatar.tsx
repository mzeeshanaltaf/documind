import { useAnimations } from "@react-three/drei";
import type { ThreeElements } from "@react-three/fiber";
import { type Ref, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef } from "react";
import {
  type AnimationAction,
  type BufferGeometry,
  BoxGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  type Group,
  IcosahedronGeometry,
  type Material,
  MeshStandardMaterial,
  SphereGeometry,
} from "three";
import { avatarClips, type ClipName, HIPS_HEIGHT } from "./avatar-clips";
import type { AvatarColors, AvatarSlot } from "./avatar-style";

/**
 * The low-poly avatar: rigid flat-shaded segments under named joint groups (see avatar-clips.ts),
 * coloured from `players.avatar`. It is a code-built rig rather than a downloaded GLB: the six
 * colour slots map one-to-one onto materials, and there is nothing to download or license.
 * Players and NPCs (O5) share the geometries; each avatar owns its six materials.
 */
export type AvatarHandle = {
  /** Crossfades to a clip; a no-op if it's already playing. */
  play: (clip: ClipName, fade?: number) => void;
  /** Playback speed of the current clip (walk speed matching). */
  setSpeed: (timeScale: number) => void;
};

// Shared by every avatar and never disposed (a fixed handful of buffers, not per instance).
const GEOMETRY = {
  pelvis: new CylinderGeometry(0.17, 0.15, 0.16, 6),
  chest: new CylinderGeometry(0.2, 0.16, 0.46, 6),
  neck: new CylinderGeometry(0.05, 0.055, 0.08, 5),
  head: new IcosahedronGeometry(0.155, 1),
  hairCap: new SphereGeometry(0.168, 7, 4, 0, Math.PI * 2, 0, Math.PI * 0.5),
  hairBack: new BoxGeometry(0.28, 0.17, 0.1),
  eye: new BoxGeometry(0.03, 0.045, 0.02),
  badge: new BoxGeometry(0.075, 0.095, 0.015),
  thigh: new CapsuleGeometry(0.068, 0.27, 2, 6),
  shin: new CapsuleGeometry(0.058, 0.25, 2, 6),
  foot: new BoxGeometry(0.12, 0.08, 0.24),
  upperArm: new CapsuleGeometry(0.055, 0.2, 2, 6),
  forearm: new CapsuleGeometry(0.048, 0.17, 2, 6),
  hand: new IcosahedronGeometry(0.055, 0),
} satisfies Record<string, BufferGeometry>;

const EYE_MATERIAL = new MeshStandardMaterial({ color: "#1f2522", roughness: 0.6 });
const SLOTS: AvatarSlot[] = ["skin", "hair", "top", "bottom", "shoes", "badge"];

type PartProps = { geometry: BufferGeometry; material: Material; shadow: boolean } & Pick<
  ThreeElements["mesh"],
  "position" | "rotation" | "scale"
>;

function Part({ geometry, material, shadow, ...transform }: PartProps) {
  return <mesh geometry={geometry} material={material} castShadow={shadow} {...transform} />;
}

type LegProps = { side: "L" | "R"; m: Record<AvatarSlot, Material>; shadow: boolean };

function Leg({ side, m, shadow }: LegProps) {
  return (
    <group name={`leg${side}`} position={[side === "L" ? 0.09 : -0.09, -0.06, 0]}>
      <Part geometry={GEOMETRY.thigh} material={m.bottom} shadow={shadow} position={[0, -0.2, 0]} />
      <group name={`shin${side}`} position={[0, -0.4, 0]}>
        <Part geometry={GEOMETRY.shin} material={m.bottom} shadow={shadow} position={[0, -0.18, 0]} />
        <Part geometry={GEOMETRY.foot} material={m.shoes} shadow={shadow} position={[0, -0.36, 0.04]} />
      </group>
    </group>
  );
}

function Arm({ side, m, shadow }: LegProps) {
  return (
    <group name={`arm${side}`} position={[side === "L" ? 0.235 : -0.235, 0.43, 0]}>
      <Part geometry={GEOMETRY.upperArm} material={m.top} shadow={shadow} position={[0, -0.15, 0]} />
      <group name={`forearm${side}`} position={[0, -0.3, 0]}>
        <Part geometry={GEOMETRY.forearm} material={m.skin} shadow={shadow} position={[0, -0.12, 0]} />
        <Part geometry={GEOMETRY.hand} material={m.skin} shadow={shadow} position={[0, -0.26, 0]} />
      </group>
    </group>
  );
}

type AvatarProps = {
  colors: AvatarColors;
  /** The clip to play (declarative); players drive clips through the handle instead. */
  clip?: ClipName;
  castShadow?: boolean;
  ref?: Ref<AvatarHandle>;
} & Pick<ThreeElements["group"], "position" | "rotation" | "scale">;

export function Avatar({ colors, clip = "idle", castShadow = true, ref, ...transform }: AvatarProps) {
  const root = useRef<Group>(null);
  const { actions } = useAnimations(avatarClips(), root);
  const current = useRef<AnimationAction | null>(null);

  const materials = useMemo(
    () =>
      Object.fromEntries(
        SLOTS.map((slot) => [slot, new MeshStandardMaterial({ flatShading: true, roughness: 0.82, metalness: 0 })]),
      ) as Record<AvatarSlot, MeshStandardMaterial>,
    [],
  );
  useEffect(() => () => Object.values(materials).forEach((material) => material.dispose()), [materials]);

  // Colours change in place: the materials (and shader programs) are kept.
  useLayoutEffect(() => {
    for (const slot of SLOTS) materials[slot].color.set(colors[slot]);
  }, [materials, colors]);

  useImperativeHandle(
    ref,
    () => ({
      play(name, fade = 0.25) {
        const next = actions[name];
        if (!next || next === current.current) return;
        next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(fade).play();
        current.current?.fadeOut(fade);
        current.current = next;
      },
      setSpeed(timeScale) {
        current.current?.setEffectiveTimeScale(timeScale);
      },
    }),
    [actions],
  );

  useEffect(() => {
    const next = actions[clip];
    if (!next || next === current.current) return;
    next.reset().fadeIn(current.current ? 0.3 : 0).play();
    current.current?.fadeOut(0.3);
    current.current = next;
  }, [actions, clip]);

  const m = materials;
  return (
    <group ref={root} {...transform} dispose={null}>
      <group name="hips" position={[0, HIPS_HEIGHT, 0]}>
        <Part geometry={GEOMETRY.pelvis} material={m.bottom} shadow={castShadow} />
        <Leg side="L" m={m} shadow={castShadow} />
        <Leg side="R" m={m} shadow={castShadow} />
        <group name="torso" position={[0, 0.07, 0]}>
          {/* Rotated a twelfth of a turn so a flat face of the hexagon faces forward. */}
          <Part geometry={GEOMETRY.chest} material={m.top} shadow={castShadow} position={[0, 0.24, 0]} rotation={[0, Math.PI / 6, 0]} />
          <Part geometry={GEOMETRY.badge} material={m.badge} shadow={false} position={[0.075, 0.29, 0.166]} rotation={[-0.08, 0, 0]} />
          <Part geometry={GEOMETRY.neck} material={m.skin} shadow={castShadow} position={[0, 0.5, 0]} />
          <group name="head" position={[0, 0.53, 0]}>
            <Part geometry={GEOMETRY.head} material={m.skin} shadow={castShadow} position={[0, 0.15, 0]} scale={[1, 1.08, 1]} />
            {/* Tilted back: the rim clears the eyes at the front and covers the back of the head. */}
            <Part geometry={GEOMETRY.hairCap} material={m.hair} shadow={castShadow} position={[0, 0.17, -0.008]} rotation={[-0.35, 0, 0]} />
            <Part geometry={GEOMETRY.hairBack} material={m.hair} shadow={false} position={[0, 0.12, -0.1]} />
            <Part geometry={GEOMETRY.eye} material={EYE_MATERIAL} shadow={false} position={[0.055, 0.155, 0.136]} />
            <Part geometry={GEOMETRY.eye} material={EYE_MATERIAL} shadow={false} position={[-0.055, 0.155, 0.136]} />
          </group>
          <Arm side="L" m={m} shadow={castShadow} />
          <Arm side="R" m={m} shadow={castShadow} />
        </group>
      </group>
    </group>
  );
}

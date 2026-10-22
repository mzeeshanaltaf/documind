import { AnimationClip, Euler, Quaternion, QuaternionKeyframeTrack, VectorKeyframeTrack } from "three";

/**
 * The avatar's animation clips, built in code for the rigid-segment rig in Avatar.tsx (the joint
 * names below are its group names). They play through drei's `useAnimations` like clips loaded
 * from a GLB, so crossfading works the same way.
 *
 * Conventions: the avatar faces +z, its left is +x. A positive x rotation swings a hanging limb
 * backwards (and tilts the torso forwards); a positive z rotation lifts the left arm sideways.
 */
export const CLIP_NAMES = ["idle", "walk", "run", "sit", "wave", "talk", "cheer", "dance"] as const;
export type ClipName = (typeof CLIP_NAMES)[number];

export const JOINTS = [
  "hips",
  "torso",
  "head",
  "armL",
  "armR",
  "forearmL",
  "forearmR",
  "legL",
  "legR",
  "shinL",
  "shinR",
] as const;
export type Joint = (typeof JOINTS)[number];

type Euler3 = readonly [number, number, number];
type Pose = Partial<Record<Joint, Euler3>> & { hipsPosition?: Euler3 };
type Key = { t: number } & Pose;

/** Hip height when standing (metres above the feet). */
export const HIPS_HEIGHT = 0.86;

const REST: Record<Joint, Euler3> & { hipsPosition: Euler3 } = {
  hips: [0, 0, 0],
  torso: [0, 0, 0],
  head: [0, 0, 0],
  armL: [0, 0, 0.09],
  armR: [0, 0, -0.09],
  forearmL: [-0.08, 0, 0],
  forearmR: [-0.08, 0, 0],
  legL: [0, 0, 0],
  legR: [0, 0, 0],
  shinL: [0, 0, 0],
  shinR: [0, 0, 0],
  hipsPosition: [0, HIPS_HEIGHT, 0],
};

const euler = new Euler();
const quaternion = new Quaternion();

function toQuaternion([x, y, z]: Euler3): number[] {
  quaternion.setFromEuler(euler.set(x, y, z));
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
}

/**
 * A looping clip from key poses. Every joint used by any key gets a track; a key that doesn't
 * mention it holds the rest pose. The first key is repeated at `duration` so the loop is seamless.
 */
function clip(name: ClipName, duration: number, keys: Key[]): AnimationClip {
  const frames = [...keys, { ...keys[0], t: duration }];
  const times = frames.map((key) => key.t);
  const used = new Set<Joint>();
  for (const key of keys) for (const joint of JOINTS) if (key[joint]) used.add(joint);

  const tracks: (QuaternionKeyframeTrack | VectorKeyframeTrack)[] = [];
  for (const joint of used) {
    const values = frames.flatMap((key) => toQuaternion(key[joint] ?? REST[joint]));
    tracks.push(new QuaternionKeyframeTrack(`${joint}.quaternion`, times, values));
  }
  if (keys.some((key) => key.hipsPosition)) {
    const values = frames.flatMap((key) => [...(key.hipsPosition ?? REST.hipsPosition)]);
    tracks.push(new VectorKeyframeTrack("hips.position", times, values));
  }
  return new AnimationClip(name, duration, tracks);
}

const hips = (y: number, x = 0, z = 0): Euler3 => [x, y, z];

function buildClips(): AnimationClip[] {
  return [
    clip("idle", 2.4, [
      { t: 0, torso: [0, 0, 0], armL: REST.armL, armR: REST.armR, hipsPosition: hips(HIPS_HEIGHT) },
      { t: 1.2, torso: [0.035, 0, 0], armL: [0.04, 0, 0.11], armR: [0.04, 0, -0.11], hipsPosition: hips(0.854) },
    ]),

    // Two steps per cycle; at the walk speed (2.2 m/s) the feet roughly match the ground.
    clip("walk", 0.72, [
      { t: 0, legL: [-0.5, 0, 0], legR: [0.45, 0, 0], shinL: [0.05, 0, 0], shinR: [0.45, 0, 0], armL: [0.42, 0, 0.09], armR: [-0.42, 0, -0.09], torso: [0.03, 0.07, 0], hipsPosition: hips(0.845) },
      { t: 0.18, legL: [-0.05, 0, 0], legR: [0, 0, 0], shinL: [0.05, 0, 0], shinR: [0.75, 0, 0], torso: [0.03, 0, 0], hipsPosition: hips(0.875) },
      { t: 0.36, legL: [0.45, 0, 0], legR: [-0.5, 0, 0], shinL: [0.45, 0, 0], shinR: [0.05, 0, 0], armL: [-0.42, 0, 0.09], armR: [0.42, 0, -0.09], torso: [0.03, -0.07, 0], hipsPosition: hips(0.845) },
      { t: 0.54, legL: [0, 0, 0], legR: [-0.05, 0, 0], shinL: [0.75, 0, 0], shinR: [0.05, 0, 0], torso: [0.03, 0, 0], hipsPosition: hips(0.875) },
    ]),

    clip("run", 0.6, [
      { t: 0, legL: [-0.95, 0, 0], legR: [0.7, 0, 0], shinL: [0.35, 0, 0], shinR: [1.25, 0, 0], armL: [0.85, 0, 0.12], armR: [-0.85, 0, -0.12], forearmL: [-1.3, 0, 0], forearmR: [-1.3, 0, 0], torso: [0.18, 0.12, 0], hipsPosition: hips(0.82) },
      { t: 0.15, legL: [-0.2, 0, 0], legR: [-0.1, 0, 0], shinL: [0.2, 0, 0], shinR: [1.6, 0, 0], armL: [0, 0, 0.12], armR: [0, 0, -0.12], forearmL: [-1.3, 0, 0], forearmR: [-1.3, 0, 0], torso: [0.18, 0, 0], hipsPosition: hips(0.9) },
      { t: 0.3, legL: [0.7, 0, 0], legR: [-0.95, 0, 0], shinL: [1.25, 0, 0], shinR: [0.35, 0, 0], armL: [-0.85, 0, 0.12], armR: [0.85, 0, -0.12], forearmL: [-1.3, 0, 0], forearmR: [-1.3, 0, 0], torso: [0.18, -0.12, 0], hipsPosition: hips(0.82) },
      { t: 0.45, legL: [-0.1, 0, 0], legR: [-0.2, 0, 0], shinL: [1.6, 0, 0], shinR: [0.2, 0, 0], armL: [0, 0, 0.12], armR: [0, 0, -0.12], forearmL: [-1.3, 0, 0], forearmR: [-1.3, 0, 0], torso: [0.18, 0, 0], hipsPosition: hips(0.9) },
    ]),

    // Hips at seat height (0.45 m) with the thighs level and the hands on the knees.
    clip("sit", 3, [
      { t: 0, legL: [-1.5, 0, 0.04], legR: [-1.5, 0, -0.04], shinL: [1.5, 0, 0], shinR: [1.5, 0, 0], armL: [-0.55, 0, 0.12], armR: [-0.55, 0, -0.12], forearmL: [-0.55, 0, 0], forearmR: [-0.55, 0, 0], torso: [-0.06, 0, 0], hipsPosition: hips(0.5) },
      { t: 1.5, legL: [-1.5, 0, 0.04], legR: [-1.5, 0, -0.04], shinL: [1.5, 0, 0], shinR: [1.5, 0, 0], armL: [-0.55, 0, 0.12], armR: [-0.55, 0, -0.12], forearmL: [-0.55, 0, 0], forearmR: [-0.55, 0, 0], torso: [-0.03, 0, 0], hipsPosition: hips(0.502) },
    ]),

    clip("wave", 1.4, [
      { t: 0, armR: [0, 0, -2.5], forearmR: [0, 0, -0.45], head: [0, -0.12, 0.04] },
      { t: 0.35, armR: [0, 0, -2.55], forearmR: [0, 0, 0.4], head: [0, -0.12, 0.04] },
      { t: 0.7, armR: [0, 0, -2.5], forearmR: [0, 0, -0.45], head: [0, -0.12, 0.04] },
      { t: 1.05, armR: [0, 0, -2.55], forearmR: [0, 0, 0.4], head: [0, -0.12, 0.04] },
    ]),

    // Explaining something: forearms up, hands moving in small beats, a nod (NPCs, O5).
    clip("talk", 1.8, [
      { t: 0, armR: [-0.35, 0, -0.15], forearmR: [-1.1, 0, 0], armL: [-0.15, 0, 0.12], forearmL: [-0.7, 0, 0], head: [0.04, 0.08, 0], torso: [0.02, 0.04, 0] },
      { t: 0.6, armR: [-0.5, 0, -0.25], forearmR: [-1.35, 0.3, 0], armL: [-0.25, 0, 0.16], forearmL: [-0.9, 0, 0], head: [-0.03, -0.06, 0], torso: [0.02, -0.03, 0] },
      { t: 1.2, armR: [-0.3, 0, -0.1], forearmR: [-1, -0.2, 0], armL: [-0.35, 0, 0.2], forearmL: [-1.15, 0, 0], head: [0.05, 0.04, 0], torso: [0.02, 0, 0] },
    ]),

    clip("cheer", 0.9, [
      { t: 0, armL: [0, 0, 2.6], armR: [0, 0, -2.6], forearmL: [0, 0, 0.3], forearmR: [0, 0, -0.3], shinL: [0.25, 0, 0], shinR: [0.25, 0, 0], legL: [-0.15, 0, 0], legR: [-0.15, 0, 0], hipsPosition: hips(0.83) },
      { t: 0.3, armL: [0, 0, 2.95], armR: [0, 0, -2.95], forearmL: [0, 0, 0], forearmR: [0, 0, 0], hipsPosition: hips(0.98) },
      { t: 0.5, armL: [0, 0, 2.8], armR: [0, 0, -2.8], forearmL: [0, 0, 0.2], forearmR: [0, 0, -0.2], hipsPosition: hips(0.9) },
    ]),

    clip("dance", 1.2, [
      { t: 0, torso: [0, 0.35, 0.06], armL: [0, 0, 2.3], armR: [0, 0, -0.7], forearmL: [0, 0, 0.6], forearmR: [-1.1, 0, 0], shinL: [0.4, 0, 0], legL: [-0.25, 0, 0], head: [0, -0.2, 0.08], hipsPosition: hips(0.83, 0.05) },
      { t: 0.3, torso: [0, 0, 0], armL: [0, 0, 1.2], armR: [0, 0, -1.2], forearmL: [-0.8, 0, 0], forearmR: [-0.8, 0, 0], hipsPosition: hips(0.87) },
      { t: 0.6, torso: [0, -0.35, -0.06], armL: [0, 0, 0.7], armR: [0, 0, -2.3], forearmL: [-1.1, 0, 0], forearmR: [0, 0, -0.6], shinR: [0.4, 0, 0], legR: [-0.25, 0, 0], head: [0, 0.2, -0.08], hipsPosition: hips(0.83, -0.05) },
      { t: 0.9, torso: [0, 0, 0], armL: [0, 0, 1.2], armR: [0, 0, -1.2], forearmL: [-0.8, 0, 0], forearmR: [-0.8, 0, 0], hipsPosition: hips(0.87) },
    ]),
  ];
}

let cached: AnimationClip[] | null = null;

/** One set of clips for every avatar (players and NPCs), so the mixers share them. */
export function avatarClips(): AnimationClip[] {
  return (cached ??= buildClips());
}

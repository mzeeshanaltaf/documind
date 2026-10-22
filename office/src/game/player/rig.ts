import type { RapierRigidBody } from "@react-three/rapier";
import { Vector3 } from "three";

/**
 * Per-frame values shared by the player controller, the follow camera and the interaction
 * system. A plain mutable object: writing it every frame costs nothing and re-renders nothing
 * (the store gets a throttled copy of the position).
 */
export const rig = {
  /** Camera orbit around the player (radians, metres). Movement is relative to `yaw`. */
  yaw: 0,
  pitch: 0.36,
  distance: 5.5,
  /** The player's feet, updated every frame. */
  position: new Vector3(),
  /** Horizontal speed in m/s. */
  speed: 0,
  running: false,
  /** Set by the camera when a wall has pushed it so close that it would be inside the avatar. */
  cameraTooClose: false,
  /** Excluded from the camera's wall ray. */
  body: null as RapierRigidBody | null,
};

export const CAMERA_LIMITS = { minDistance: 2.4, maxDistance: 9, minPitch: 0.06, maxPitch: 1.15 } as const;

/**
 * Resets the orbit for a new spawn. `facing` is the avatar's heading (rotation about y; 0 faces
 * +z); the camera starts behind it, half a turn round.
 */
export function resetRig(position: readonly [number, number, number], facing: number) {
  rig.position.set(position[0], position[1], position[2]);
  rig.yaw = facing + Math.PI;
  rig.pitch = 0.36;
  rig.speed = 0;
  rig.running = false;
  rig.cameraTooClose = false;
  rig.body = null;
}

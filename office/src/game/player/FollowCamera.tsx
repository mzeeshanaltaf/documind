import { useFrame, useThree } from "@react-three/fiber";
import { useRapier } from "@react-three/rapier";
import { useEffect, useRef } from "react";
import { Vector3 } from "three";
import { selectReducedMotion, useGame } from "@/game/store/game-store";
import { seatCamera } from "@/game/world/office/presentation/layout";
import { CAMERA_LIMITS, rig } from "./rig";

/** Where the camera looks: about head height. */
const LOOK_HEIGHT = 1.45;
/** Kept between the camera and a wall it pulled in for. */
const WALL_MARGIN = 0.3;
const DIALOGUE_DISTANCE = 3.4;
const HIDE_AVATAR_WITHIN = 0.9;
/** Sitting on a beanbag (O8): the camera settles closer and lower, then leaves the orbit to the player. */
const RELAXED_DISTANCE = 3.6;
const RELAXED_PITCH = 0.2;
const RELAX_SETTLE_S = 1.6;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const ease = (rate: number, delta: number) => 1 - Math.exp(-rate * delta);

/**
 * Third-person follow camera, spring-damped. Right-drag (or a touch drag on the canvas) orbits,
 * the wheel zooms within limits, and a ray from the player's head pulls the camera in front of
 * any wall behind it. While `cameraFocus` is set (a conversation) it eases to frame both; on a
 * seat with a `view` (the auditorium) it eases to a shot of that point instead.
 */
export function FollowCamera() {
  const gl = useThree((state) => state.gl);
  const regress = useThree((state) => state.performance.regress);
  const { world, rapier } = useRapier();
  // One ray, re-aimed every frame.
  const ray = useRef<InstanceType<typeof rapier.Ray> | null>(null);
  const smooth = useRef({
    target: new Vector3(),
    goal: new Vector3(),
    dir: new Vector3(),
    distance: rig.distance,
    ready: false,
    /** The seated shot (O7): where the camera sits, what it looks at, and how far it's blended in. */
    eye: new Vector3(),
    look: new Vector3(),
    blend: new Vector3(),
    seated: 0,
    /** Seconds since sitting on a relaxed seat (0 when not). */
    relaxed: 0,
  });

  useEffect(() => {
    const element = gl.domElement;
    let drag: { id: number; x: number; y: number } | null = null;

    function onDown(event: PointerEvent) {
      if (useGame.getState().modal) return;
      if (event.button !== 2 && event.pointerType !== "touch") return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      element.setPointerCapture(event.pointerId);
    }
    function onMove(event: PointerEvent) {
      if (!drag || event.pointerId !== drag.id) return;
      rig.yaw -= (event.clientX - drag.x) * 0.0055;
      rig.pitch = clamp(rig.pitch + (event.clientY - drag.y) * 0.0045, CAMERA_LIMITS.minPitch, CAMERA_LIMITS.maxPitch);
      drag.x = event.clientX;
      drag.y = event.clientY;
      // Drop the resolution while the view swings (drei AdaptiveDpr), then restore it.
      regress();
    }
    function onUp(event: PointerEvent) {
      if (drag?.id !== event.pointerId) return;
      drag = null;
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    }
    function onWheel(event: WheelEvent) {
      if (useGame.getState().modal) return;
      rig.distance = clamp(rig.distance * (1 + event.deltaY * 0.0012), CAMERA_LIMITS.minDistance, CAMERA_LIMITS.maxDistance);
    }
    const onContextMenu = (event: Event) => event.preventDefault();

    element.addEventListener("pointerdown", onDown);
    element.addEventListener("pointermove", onMove);
    element.addEventListener("pointerup", onUp);
    element.addEventListener("pointercancel", onUp);
    element.addEventListener("wheel", onWheel, { passive: true });
    element.addEventListener("contextmenu", onContextMenu);
    return () => {
      element.removeEventListener("pointerdown", onDown);
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerup", onUp);
      element.removeEventListener("pointercancel", onUp);
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("contextmenu", onContextMenu);
    };
  }, [gl, regress]);

  useFrame((state, rawDelta) => {
    const delta = Math.min(rawDelta, 0.1);
    const s = useGame.getState();
    const view = smooth.current;
    const focus = s.cameraFocus;

    view.goal.copy(rig.position);
    view.goal.y += LOOK_HEIGHT;
    let wanted = rig.distance;
    if (focus) {
      // Frame the conversation: look between the two, closer in, from the side.
      const dx = focus[0] - rig.position.x;
      const dz = focus[2] - rig.position.z;
      view.goal.set((view.goal.x + focus[0]) / 2, view.goal.y, (view.goal.z + focus[2]) / 2);
      wanted = Math.min(DIALOGUE_DISTANCE, rig.distance);
      const side = Math.atan2(dz, -dx);
      const yaw = Math.abs(Math.atan2(Math.sin(side - rig.yaw), Math.cos(side - rig.yaw))) < Math.PI / 2 ? side : side + Math.PI;
      rig.yaw += Math.atan2(Math.sin(yaw - rig.yaw), Math.cos(yaw - rig.yaw)) * ease(3, delta);
      rig.pitch += (0.22 - rig.pitch) * ease(3, delta);
    }
    const lounging = s.player.pose === "sit" && s.player.seat?.relaxed && !s.player.seat.view;
    if (lounging) {
      view.relaxed += delta;
      wanted = Math.min(wanted, RELAXED_DISTANCE);
      if (view.relaxed < RELAX_SETTLE_S) rig.pitch += (RELAXED_PITCH - rig.pitch) * ease(2.5, delta);
    } else {
      view.relaxed = 0;
    }
    if (!view.ready) {
      view.target.copy(view.goal);
      view.distance = wanted;
      view.ready = true;
    }
    view.target.lerp(view.goal, ease(focus ? 4 : 12, delta));

    const cosPitch = Math.cos(rig.pitch);
    view.dir.set(Math.sin(rig.yaw) * cosPitch, Math.sin(rig.pitch), Math.cos(rig.yaw) * cosPitch);

    const wallRay = (ray.current ??= new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }));
    wallRay.origin = { x: view.target.x, y: view.target.y, z: view.target.z };
    wallRay.dir = { x: view.dir.x, y: view.dir.y, z: view.dir.z };
    const hit = world.castRay(
      wallRay,
      wanted + WALL_MARGIN,
      true,
      rapier.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      undefined,
      rig.body ?? undefined,
    );
    const limit = hit ? Math.max(0.5, Math.min(wanted, hit.timeOfImpact - WALL_MARGIN)) : wanted;
    // Pull in at once (never show the inside of a wall); ease back out.
    view.distance = limit < view.distance ? limit : view.distance + (limit - view.distance) * ease(4, delta);
    // Closer than this the camera would sit inside the avatar's head: the player hides it.
    rig.cameraTooClose = view.distance < HIDE_AVATAR_WITHIN;

    const { camera } = state;
    camera.position.copy(view.target).addScaledVector(view.dir, view.distance);
    // A small bob while running, unless motion is reduced.
    if (rig.running && !selectReducedMotion(s)) camera.position.y += Math.sin(state.clock.elapsedTime * 13) * 0.03;

    // An auditorium seat (O7): ease to a shot framing the screen, and back out on standing up.
    const seat = s.player.pose === "sit" ? s.player.seat : null;
    if (seat?.view) {
      const [ex, ey, ez] = seatCamera(seat, seat.view);
      view.eye.set(ex, ey, ez);
      view.look.set(seat.view[0], seat.view[1], seat.view[2]);
    }
    view.seated += ((seat?.view ? 1 : 0) - view.seated) * ease(selectReducedMotion(s) ? 30 : 3.5, delta);
    if (view.seated > 0.002) {
      camera.position.lerp(view.eye, view.seated);
      view.blend.copy(view.target).lerp(view.look, view.seated);
      camera.lookAt(view.blend);
      // The camera passes through the seated avatar's head on its way in.
      if (view.seated > 0.3) rig.cameraTooClose = true;
    } else {
      camera.lookAt(view.target);
    }
  });

  return null;
}

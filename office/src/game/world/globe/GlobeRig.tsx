import { useFrame, useThree } from "@react-three/fiber";
import { type ReactNode, useEffect, useRef } from "react";
import type { Group, PerspectiveCamera } from "three";
import { WORLDWIDE_ID } from "@/lib/locations";
import { easeInOutCubic, facing, latLonToVector, nearestAngle, vectorToLatLon } from "./geo";
import { FLY_MS, useGlobe } from "./globe-store";
import { type LabelPin, layoutLabels } from "./labels";

export type RigPin = { id: string; lat: number; lon: number; hq: boolean };

/** Auto-turn speed (rad/s): a full turn takes about 100 s. */
const AUTO_SPIN = 0.06;
/** Auto-turn resumes this long after the last drag or focus. */
const RESUME_MS = 2500;
const TILT_LIMIT = 1.1;
/** The radius that must fit in view: the Worldwide ring plus the pins. */
const FIT_RADIUS = 1.32;
/** Camera distance from the centre at the end of a fly to a pin (the surface is at 1). */
const FLY_DISTANCE = 1.75;
const DRAG_SPEED = 0.006;
/** Label anchors sit at the pin heads. */
const LABEL_RADIUS = 1.085;

/** Turning state, kept outside React: written every frame and by drag handlers. */
const rig = { spin: 0, tilt: 0.3, dragging: false, idleSince: 0, flyStart: 0 };

const clampTilt = (tilt: number) => Math.max(-TILT_LIMIT, Math.min(TILT_LIMIT, tilt));

/** The camera distance at which a sphere of FIT_RADIUS fills the shorter side of the view. */
function fitDistance(aspect: number, fovDeg: number) {
  const half = (fovDeg * Math.PI) / 360;
  const halfWide = Math.atan(Math.tan(half) * aspect);
  return FIT_RADIUS / Math.sin(Math.min(half, halfWide)) + 0.15;
}

/** Where to look first: the last office visited, else the middle of all the offices. */
function startFacing(pins: RigPin[], initialFocus: string | null) {
  const start = pins.find((pin) => pin.id === initialFocus);
  if (start) return facing(start.lat, start.lon);
  if (pins.length === 0) return facing(25, 10);
  const sum = pins.reduce<[number, number, number]>((acc, pin) => {
    const [x, y, z] = latLonToVector(pin.lat, pin.lon);
    return [acc[0] + x, acc[1] + y, acc[2] + z];
  }, [0, 0, 0]);
  const middle = vectorToLatLon(sum);
  return facing(middle.lat, middle.lon);
}

type GlobeRigProps = {
  pins: RigPin[];
  initialFocus: string | null;
  /** Auto-turn (off on the low tier and with reduced motion). */
  animate: boolean;
  /** Turns snap instead of easing, and the fly is left to the page's fade. */
  reduced: boolean;
  children: ReactNode;
};

/**
 * Holds the Earth group and turns it: a slow auto-turn, drag to turn, a list focus (or a choice)
 * turns the chosen pin to face the camera, and a choice flies the camera in. The camera stays on
 * the +z axis; only the globe rotates, so the light stays put. Also lays out the DOM labels once
 * the globe has moved, in the same frame. Works with `frameloop="demand"`: anything that moves
 * asks for the next frame.
 */
export function GlobeRig({ pins, initialFocus, animate, reduced, children }: GlobeRigProps) {
  const earth = useRef<Group>(null);
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const labelPins = useRef<LabelPin[]>([]);
  const byId = useRef(new Map<string, RigPin>());

  useEffect(() => {
    labelPins.current = pins.map((pin) => ({ id: pin.id, hq: pin.hq, local: latLonToVector(pin.lat, pin.lon, LABEL_RADIUS) }));
    byId.current = new Map(pins.map((pin) => [pin.id, pin]));
    invalidate();
  }, [pins, invalidate]);

  useEffect(() => {
    const { tilt, spin } = startFacing(pins, initialFocus);
    Object.assign(rig, { spin, tilt: clampTilt(tilt), dragging: false, idleSince: 0, flyStart: 0 });
    invalidate();
    // Only on mount: later prop changes must not snap the globe back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drag to turn. Moves and releases are followed on the window, so a drag that leaves the
  // canvas still ends; R3F's own pointer events (pins, ring) keep working alongside.
  useEffect(() => {
    const element = gl.domElement;
    let drag: { id: number; x: number; y: number } | null = null;
    const down = (event: PointerEvent) => {
      if (useGlobe.getState().selected || event.button > 0) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    };
    const move = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      drag.x = event.clientX;
      drag.y = event.clientY;
      if (!rig.dragging && Math.hypot(dx, dy) < 1) return;
      rig.dragging = true;
      rig.spin += dx * DRAG_SPEED;
      rig.tilt = clampTilt(rig.tilt + dy * DRAG_SPEED);
      rig.idleSince = performance.now();
      element.style.cursor = "grabbing";
      invalidate();
    };
    const up = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return;
      drag = null;
      rig.dragging = false;
      rig.idleSince = performance.now();
      element.style.cursor = "";
    };
    element.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      element.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [gl, invalidate]);

  // On demand, a hover, a choice or the clock needs a frame (labels, pins, the turn).
  useEffect(() => useGlobe.subscribe(() => invalidate()), [invalidate]);

  useFrame((state, delta) => {
    const group = earth.current;
    if (!group) return;
    const { hovered, hoverSource, selected } = useGlobe.getState();
    const now = performance.now();
    const dt = Math.min(delta, 0.1);
    let moving = false;

    const targetId = selected ?? (hoverSource === "list" ? hovered : null);
    const target = targetId ? byId.current.get(targetId) : undefined;
    if (target && !rig.dragging) {
      const goal = facing(target.lat, target.lon);
      const spin = nearestAngle(rig.spin, goal.spin);
      const tilt = clampTilt(goal.tilt);
      if (reduced) {
        rig.spin = spin;
        rig.tilt = tilt;
      } else {
        const k = 1 - Math.exp(-dt * (selected ? 7 : 4.5));
        rig.spin += (spin - rig.spin) * k;
        rig.tilt += (tilt - rig.tilt) * k;
        moving = Math.abs(spin - rig.spin) + Math.abs(tilt - rig.tilt) > 1e-4;
      }
      rig.idleSince = now;
    } else if (animate && !rig.dragging && !hovered && !selected && now - rig.idleSince > RESUME_MS) {
      rig.spin += AUTO_SPIN * dt;
      moving = true;
    }

    const camera = state.camera as PerspectiveCamera;
    const fit = fitDistance(state.size.width / Math.max(1, state.size.height), camera.fov);
    let distance = fit;
    if (selected && !reduced) {
      if (!rig.flyStart) rig.flyStart = now;
      const t = easeInOutCubic((now - rig.flyStart) / FLY_MS);
      const end = selected === WORLDWIDE_ID || !target ? fit * 1.25 : FLY_DISTANCE;
      distance = fit + (end - fit) * t;
      moving ||= t < 1;
    } else {
      rig.flyStart = 0;
    }

    camera.position.set(0, 0, distance);
    camera.lookAt(0, 0, 0);
    group.rotation.set(rig.tilt, rig.spin, 0);
    layoutLabels(camera, state.size, group, labelPins.current, { hovered, selected });
    if (moving) state.invalidate();
  });

  return <group ref={earth}>{children}</group>;
}

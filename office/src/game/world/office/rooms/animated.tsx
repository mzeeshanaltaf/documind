import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useRef } from "react";
import { BoxGeometry, Color, type InstancedMesh, MeshStandardMaterial, Object3D } from "three";
import { selectReducedMotion, useGame } from "@/game/store/game-store";
import type { Vec3 } from "../floorplan";
import type { Clock } from "./decor";

/**
 * The rooms' moving parts (phase O6 › Rooms): the server racks' blinking LEDs (IT) and the
 * live time-zone clocks (International). Each is one instanced mesh, updated a few times a
 * second, never through React state.
 */
const LED_GEOMETRY = new BoxGeometry(0.022, 0.022, 0.01);
const HAND_GEOMETRY = new BoxGeometry(1, 1, 1);
const LED_COLORS = [new Color("#3bd17f"), new Color("#3bd17f"), new Color("#e7b94a"), new Color("#2a3036")];
const dummy = new Object3D();

export function ServerLeds({ positions }: { positions: Vec3[] }) {
  const mesh = useRef<InstancedMesh>(null);
  const wait = useRef(0);
  const count = positions.length;

  useLayoutEffect(() => {
    const instances = mesh.current;
    if (!instances) return;
    positions.forEach((position, index) => {
      dummy.position.set(...position);
      dummy.updateMatrix();
      instances.setMatrixAt(index, dummy.matrix);
      instances.setColorAt(index, LED_COLORS[index % LED_COLORS.length]);
    });
    instances.instanceMatrix.needsUpdate = true;
    if (instances.instanceColor) instances.instanceColor.needsUpdate = true;
  }, [positions]);

  useFrame((_, delta) => {
    wait.current -= delta;
    const instances = mesh.current;
    if (wait.current > 0 || !instances || selectReducedMotion(useGame.getState())) return;
    wait.current = 0.12;
    // A few LEDs change on each tick: drive activity, not a disco.
    for (let k = 0; k < Math.max(1, count / 8); k++) {
      const index = Math.floor(Math.random() * count);
      instances.setColorAt(index, LED_COLORS[Math.floor(Math.random() * LED_COLORS.length)]);
    }
    if (instances.instanceColor) instances.instanceColor.needsUpdate = true;
  });

  if (count === 0) return null;
  return (
    <instancedMesh ref={mesh} args={[LED_GEOMETRY, undefined, count]} frustumCulled={false}>
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}

/** Hours and minutes in `timeZone`, for the clock hands. */
export function zoneTime(at: Date, timeZone: string): { hours: number; minutes: number; seconds: number } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" }).formatToParts(at);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { hours: value("hour"), minutes: value("minute"), seconds: value("second") };
}

/** Hand angles (radians, clockwise from 12) for a time. */
export function handAngles({ hours, minutes, seconds }: { hours: number; minutes: number; seconds: number }) {
  return { hour: ((hours % 12) + minutes / 60) * (Math.PI / 6), minute: (minutes + seconds / 60) * (Math.PI / 30) };
}

const HAND_MATERIAL = new MeshStandardMaterial({ color: "#1c2320", roughness: 0.6 });

/**
 * Analogue clocks showing each office's local time. The clocks face -z (decor.ts), so a hand
 * turning clockwise as seen from the room turns positively about +z.
 */
export function ZoneClocks({ clocks, timezones }: { clocks: Clock[]; timezones: string[] }) {
  const mesh = useRef<InstancedMesh>(null);
  const wait = useRef(0);
  const count = Math.min(clocks.length, timezones.length);

  useFrame((_, delta) => {
    wait.current -= delta;
    const instances = mesh.current;
    if (wait.current > 0 || !instances) return;
    wait.current = 1;
    const now = new Date();
    for (let k = 0; k < count; k++) {
      const clock = clocks[k];
      const angles = handAngles(zoneTime(now, timezones[k]));
      const hands: [number, number, number][] = [
        [angles.hour, clock.radius * 0.55, 0.035],
        [angles.minute, clock.radius * 0.85, 0.022],
      ];
      hands.forEach(([angle, length, width], h) => {
        // Facing -z, the viewer's right is -x: a hand at `angle` points along (-sin, cos), which
        // is +y turned by `angle` about +z. It grows from the centre.
        dummy.position.set(clock.at[0] - Math.sin(angle) * (length / 2), clock.at[1] + Math.cos(angle) * (length / 2), clock.at[2] - h * 0.006);
        dummy.rotation.set(0, 0, angle);
        dummy.scale.set(width, length, 0.008);
        dummy.updateMatrix();
        instances.setMatrixAt(k * 2 + h, dummy.matrix);
      });
    }
    instances.instanceMatrix.needsUpdate = true;
  });

  if (count === 0) return null;
  return <instancedMesh ref={mesh} args={[HAND_GEOMETRY, HAND_MATERIAL, count * 2]} frustumCulled={false} />;
}

import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Color, type InstancedMesh, Object3D } from "three";
import { rig } from "@/game/player/rig";
import type { CityLayout } from "./generator";
import { sampleLoop } from "./paths";
import { type Car, planFleet, type VehicleKind, vehicleGeometry } from "./vehicles";

const dummy = new Object3D();
const tint = new Color();
/** Stop this far (bumper to bumper) behind the car ahead, or short of the player. */
const STANDOFF = 2.5;

/**
 * Ambient traffic (phase O4 › 4): instanced vehicles driving the loops, one draw call per kind.
 * Each car keeps its gap to the one ahead on its loop and brakes for a player standing in its
 * lane. No physics: cars never push the player, and the player walks through a stopped car.
 */
export function Traffic({ layout, count, shadows }: { layout: CityLayout; count: number; shadows: boolean }) {
  const cars = useMemo(() => planFleet(layout.loops, layout.kit, count, layout.seed), [layout, count]);
  const kinds = useMemo(() => [...new Set(cars.map((car) => car.kind))], [cars]);
  const geometries = useMemo(() => new Map(kinds.map((kind) => [kind, vehicleGeometry(kind)])), [kinds]);
  useEffect(() => () => geometries.forEach((geometry) => geometry.dispose()), [geometries]);
  const meshes = useRef(new Map<VehicleKind, InstancedMesh>());
  // The moving state: copies of the plan, each loop's cars in order along it (nobody
  // overtakes, so the order holds).
  const queues = useRef<Car[][]>([]);

  useLayoutEffect(() => {
    const moving = cars.map((car) => ({ ...car }));
    queues.current = layout.loops.map((_, index) => moving.filter((car) => car.loop === index).sort((a, b) => a.s - b.s));
    for (const car of cars) meshes.current.get(car.kind)?.setColorAt(car.slot, tint.set(car.color));
    meshes.current.forEach((mesh) => {
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
  }, [layout, cars]);

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.1);
    const player = rig.position;
    queues.current.forEach((queue, index) => {
      const loop = layout.loops[index];
      queue.forEach((car, k) => {
        let target = car.cruise;
        if (queue.length > 1) {
          const ahead = queue[(k + 1) % queue.length];
          const gap = ((((ahead.s - car.s) % loop.length) + loop.length) % loop.length) - (ahead.length + car.length) / 2;
          target = Math.min(target, car.cruise * Math.min(1, Math.max(0, (gap - STANDOFF) / 9)));
        }
        const here = sampleLoop(loop, car.s);
        const fx = Math.sin(here.heading);
        const fz = Math.cos(here.heading);
        const dx = player.x - here.x;
        const dz = player.z - here.z;
        const along = dx * fx + dz * fz - car.length / 2;
        if (along > -0.5 && along < 10 && Math.abs(dx * fz - dz * fx) < 1.7) {
          target = Math.min(target, car.cruise * Math.min(1, Math.max(0, (along - STANDOFF) / 7)));
        }
        car.speed = target < car.speed ? Math.max(target, car.speed - 10 * delta) : Math.min(target, car.speed + 3 * delta);
        car.s = (car.s + car.speed * delta) % loop.length;

        const at = sampleLoop(loop, car.s);
        const mesh = meshes.current.get(car.kind);
        if (!mesh) return;
        dummy.position.set(at.x, 0, at.z);
        dummy.rotation.set(0, at.heading, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(car.slot, dummy.matrix);
      });
    });
    meshes.current.forEach((mesh) => {
      mesh.instanceMatrix.needsUpdate = true;
    });
  });

  return (
    <>
      {kinds.map((kind) => (
        <instancedMesh
          key={`${kind}:${cars.length}`}
          ref={(mesh) => {
            if (mesh) meshes.current.set(kind, mesh);
            else meshes.current.delete(kind);
          }}
          args={[geometries.get(kind), undefined, cars.filter((car) => car.kind === kind).length]}
          castShadow={shadows}
          frustumCulled={false}
        >
          <meshStandardMaterial vertexColors roughness={0.55} metalness={0.15} flatShading />
        </instancedMesh>
      ))}
    </>
  );
}

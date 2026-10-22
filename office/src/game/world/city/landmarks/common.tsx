import type { ReactNode } from "react";
import type { CityCollider, CityLayout, Rect } from "../generator";
import { Colliders } from "../Ground";

/**
 * What a landmark kit gets: the park anchor in the vista block and a far anchor beyond it
 * (bridges, towers on the horizon), each with a yaw that turns local +z towards the plaza; the
 * vista sector (bay and harbour kits flood it); the office garden (Paris's café); the night
 * amount, and the place's accent and names.
 */
export type LandmarkProps = {
  site: CityLayout["landmark"];
  vista: Rect[];
  garden: Rect;
  curb: number;
  night: number;
  accent: string;
  placeName: string;
  countryName: string;
};

export const WATER = "#5d8796";

/** The bay or harbour: flat water over the vista sector, a step below the quay. */
export function Water({ rects }: { rects: Rect[] }) {
  return (
    <>
      {rects.map((rect, index) => (
        <mesh key={index} position={[rect.x, 0.04, rect.z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[rect.w, rect.d]} />
          <meshStandardMaterial color={WATER} roughness={0.22} metalness={0.15} />
        </mesh>
      ))}
    </>
  );
}

/** A group at an anchor, turned so its local +z faces the plaza. */
export function Anchored({ at, yaw, children }: { at: { x: number; z: number }; yaw: number; children: ReactNode }) {
  return (
    <group position={[at.x, 0, at.z]} rotation={[0, yaw, 0]}>
      {children}
    </group>
  );
}

/**
 * Colliders given in an anchor's local frame (so a kit describes them next to its parts) and
 * at the kit's build scale, turned into world boxes standing on `lift` (the curb).
 */
export function LocalColliders({
  at,
  yaw,
  boxes,
  scale = 1,
  lift = 0,
}: {
  at: { x: number; z: number };
  yaw: number;
  boxes: CityCollider[];
  scale?: number;
  lift?: number;
}) {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const world = boxes.map<CityCollider>((collider) => {
    const [lx, ly, lz] = collider.center.map((v) => v * scale);
    const [hx, hy, hz] = collider.half.map((v) => v * scale);
    return {
      ...collider,
      center: [at.x + lx * cos + lz * sin, ly + lift, at.z - lx * sin + lz * cos],
      half: [hx, hy, hz],
      yaw: yaw + (collider.yaw ?? 0),
    };
  });
  return <Colliders colliders={world} />;
}
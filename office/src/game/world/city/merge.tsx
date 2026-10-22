import type { ThreeElements } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import {
  BoxGeometry,
  type BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  FrontSide,
  IcosahedronGeometry,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/**
 * Procedural low-poly building blocks. Each helper returns a non-indexed geometry already moved
 * into place (position and normal only, so any set of them merges); `Merged` then draws a whole
 * landmark as one mesh per colour, which keeps a kit to a handful of draw calls.
 */
export type Transform = {
  at?: [number, number, number];
  /** Euler angles in radians, applied in `order` (XYZ by default; YXZ = turn, then tilt). */
  rot?: [number, number, number];
  order?: "XYZ" | "YXZ";
  scale?: number | [number, number, number];
};

const matrix = new Matrix4();
const quaternion = new Quaternion();
const euler = new Euler();
const scaleVector = new Vector3();
const position = new Vector3();

/** Bakes the transform into the geometry and strips it to position + normal. */
export function place(geometry: BufferGeometry, { at = [0, 0, 0], rot = [0, 0, 0], order = "XYZ", scale = 1 }: Transform = {}): BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  if (flat !== geometry) geometry.dispose();
  for (const name of Object.keys(flat.attributes)) {
    if (name !== "position" && name !== "normal") flat.deleteAttribute(name);
  }
  quaternion.setFromEuler(euler.set(rot[0], rot[1], rot[2], order));
  if (typeof scale === "number") scaleVector.setScalar(scale);
  else scaleVector.set(scale[0], scale[1], scale[2]);
  flat.applyMatrix4(matrix.compose(position.set(at[0], at[1], at[2]), quaternion, scaleVector));
  return flat;
}

export const box = (w: number, h: number, d: number, t?: Transform) => place(new BoxGeometry(w, h, d), t);
/** A horizontal rectangle facing up, `w` along x and `d` along z, centred at (x, y, z). */
export const flat = (w: number, d: number, x: number, y: number, z: number, yaw = 0) =>
  place(new PlaneGeometry(w, d), { at: [x, y, z], rot: [-Math.PI / 2, 0, yaw] });
export const cylinder = (top: number, bottom: number, h: number, segments: number, t?: Transform) =>
  place(new CylinderGeometry(top, bottom, h, segments), t);
export const cone = (radius: number, h: number, segments: number, t?: Transform) => place(new ConeGeometry(radius, h, segments), t);
export const ico = (radius: number, detail: number, t?: Transform) => place(new IcosahedronGeometry(radius, detail), t);
export const sphere = (
  radius: number,
  widthSegments: number,
  heightSegments: number,
  t?: Transform,
  [phiStart, phiLength, thetaStart, thetaLength] = [0, Math.PI * 2, 0, Math.PI],
) => place(new SphereGeometry(radius, widthSegments, heightSegments, phiStart, phiLength, thetaStart, thetaLength), t);
export const torus = (radius: number, tube: number, radial: number, tubular: number, arc: number, t?: Transform) =>
  place(new TorusGeometry(radius, tube, radial, tubular, arc), t);

/** A box whose two end faces sit at `from` and `to` (beams, cables, struts). */
export function beam(from: [number, number, number], to: [number, number, number], width: number, depth = width) {
  const a = new Vector3(...from);
  const b = new Vector3(...to);
  const length = a.distanceTo(b);
  const geometry = new BoxGeometry(width, length, depth);
  const flat = place(geometry);
  const direction = b.clone().sub(a).normalize();
  quaternion.setFromUnitVectors(new Vector3(0, 1, 0), direction);
  flat.applyMatrix4(matrix.compose(a.add(b).multiplyScalar(0.5), quaternion, scaleVector.setScalar(1)));
  return flat;
}

export type Part = { color: string; geometry: BufferGeometry };

/** Groups parts by colour and merges each group (the inputs are disposed). */
export function mergeByColor(parts: Part[]): { color: string; geometry: BufferGeometry }[] {
  const groups = new Map<string, BufferGeometry[]>();
  for (const part of parts) {
    const list = groups.get(part.color) ?? [];
    list.push(part.geometry);
    groups.set(part.color, list);
  }
  return [...groups].map(([color, geometries]) => {
    const merged = mergeGeometries(geometries, false);
    for (const geometry of geometries) geometry.dispose();
    return { color, geometry: merged };
  });
}

/** Merges geometries into one (the inputs are disposed). */
export function mergeAll(geometries: BufferGeometry[]): BufferGeometry {
  const merged = mergeGeometries(geometries, false);
  for (const geometry of geometries) geometry.dispose();
  return merged;
}

/** Merges parts into one geometry with a vertex colour per part (for instancing and the ground). */
export function mergeVertexColored(parts: Part[]): BufferGeometry {
  const tint = new Color();
  for (const part of parts) {
    tint.set(part.color);
    const count = part.geometry.getAttribute("position").count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = tint.r;
      colors[i * 3 + 1] = tint.g;
      colors[i * 3 + 2] = tint.b;
    }
    part.geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  }
  const merged = mergeGeometries(
    parts.map((part) => part.geometry),
    false,
  );
  for (const part of parts) part.geometry.dispose();
  return merged;
}

type MergedProps = {
  /** Builds the parts; called again only when `version` changes. */
  build: () => Part[];
  /** A key for whatever `build` reads (omit for a fixed build). */
  version?: string;
  castShadow?: boolean;
  receiveShadow?: boolean;
  roughness?: number;
  /** Per-colour material tweaks (metal, glass, emissive signage). */
  materials?: Record<string, { metalness?: number; roughness?: number; emissive?: string; emissiveIntensity?: number; doubleSided?: boolean }>;
} & Pick<ThreeElements["group"], "position" | "rotation" | "scale">;

/** Draws merged parts as one flat-shaded mesh per colour; disposes the geometry on change. */
export function Merged({ build, version = "", castShadow = true, receiveShadow = true, roughness = 0.85, materials, ...transform }: MergedProps) {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` stands for what `build` reads.
  const groups = useMemo(() => mergeByColor(build()), [version]);
  useEffect(() => () => groups.forEach((group) => group.geometry.dispose()), [groups]);
  return (
    <group {...transform}>
      {groups.map(({ color, geometry }) => {
        const tweak = materials?.[color];
        return (
          <mesh key={color} geometry={geometry} castShadow={castShadow} receiveShadow={receiveShadow}>
            <meshStandardMaterial
              color={color}
              flatShading
              roughness={tweak?.roughness ?? roughness}
              metalness={tweak?.metalness ?? 0}
              emissive={tweak?.emissive ?? "#000000"}
              emissiveIntensity={tweak?.emissiveIntensity ?? 0}
              side={tweak?.doubleSided ? DoubleSide : FrontSide}
            />
          </mesh>
        );
      })}
    </group>
  );
}

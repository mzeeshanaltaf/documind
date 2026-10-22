import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { AdditiveBlending, type BufferGeometry, CanvasTexture, Color, type InstancedMesh, Object3D, PlaneGeometry } from "three";
import { CITY, type Furniture, type FurnitureKind } from "./generator";
import { box, cylinder, ico, mergeAll } from "./merge";

/**
 * Lamps, trees, benches and bins as instanced meshes (six draw calls for the lot). After dark
 * the lamp heads glow and each lamp throws a soft additive pool of light on the pavement.
 */

const CROWNS = ["#6f8f55", "#5f8250", "#7a9a5c", "#68874f", "#86a062"];
const LAMP_GLOW = "#ffd59a";

type Geometries = Record<"pole" | "head" | "trunk" | "crown" | "bench" | "bin" | "pool", BufferGeometry>;

function geometries(): Geometries {
  return {
    pole: mergeAll([cylinder(0.06, 0.09, 4.4, 6, { at: [0, 2.2, 0] }), box(0.08, 0.08, 1.1, { at: [0, 4.36, 0.5] })]),
    head: box(0.36, 0.14, 0.52, { at: [0, 4.26, 1.0] }),
    trunk: cylinder(0.11, 0.16, 2.1, 5, { at: [0, 1.05, 0] }),
    crown: ico(1.35, 0, { at: [0, 3.0, 0], scale: [1, 1.18, 1] }),
    bench: mergeAll([
      box(1.6, 0.08, 0.46, { at: [0, 0.45, 0] }),
      box(1.6, 0.42, 0.06, { at: [0, 0.76, -0.2] }),
      box(0.08, 0.45, 0.42, { at: [-0.68, 0.22, 0] }),
      box(0.08, 0.45, 0.42, { at: [0.68, 0.22, 0] }),
    ]),
    bin: cylinder(0.22, 0.19, 0.9, 8, { at: [0, 0.45, 0] }),
    pool: new PlaneGeometry(7, 7).rotateX(-Math.PI / 2),
  };
}

function poolTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, "rgba(255, 214, 160, 1)");
    gradient.addColorStop(0.45, "rgba(255, 196, 130, 0.42)");
    gradient.addColorStop(1, "rgba(255, 190, 120, 0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
  }
  return new CanvasTexture(canvas);
}

const dummy = new Object3D();
const tint = new Color();

function fill(mesh: InstancedMesh | null, items: Furniture[], base: number, lift = 0, offset?: (item: Furniture) => [number, number]) {
  if (!mesh) return;
  items.forEach((item, index) => {
    const [dx, dz] = offset?.(item) ?? [0, 0];
    dummy.position.set(item.x + dx, base + lift, item.z + dz);
    dummy.rotation.set(0, item.yaw, 0);
    dummy.scale.setScalar(item.scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
}

type StreetFurnitureProps = {
  furniture: Furniture[];
  night: number;
  shadows?: boolean;
  /** Ground height under the furniture (the city's curb; 0 on the Global Hub). */
  base?: number;
};

export function StreetFurniture({ furniture, night, shadows = true, base = CITY.curb }: StreetFurnitureProps) {
  const parts = useMemo(() => geometries(), []);
  const texture = useMemo(() => poolTexture(), []);
  useEffect(
    () => () => {
      for (const geometry of Object.values(parts)) geometry.dispose();
      texture.dispose();
    },
    [parts, texture],
  );
  const byKind = useMemo(() => {
    const groups: Record<FurnitureKind, Furniture[]> = { lamp: [], tree: [], bench: [], bin: [] };
    for (const item of furniture) groups[item.kind].push(item);
    return groups;
  }, [furniture]);

  const poles = useRef<InstancedMesh>(null);
  const heads = useRef<InstancedMesh>(null);
  const pools = useRef<InstancedMesh>(null);
  const trunks = useRef<InstancedMesh>(null);
  const crowns = useRef<InstancedMesh>(null);
  const benches = useRef<InstancedMesh>(null);
  const bins = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    fill(poles.current, byKind.lamp, base);
    fill(heads.current, byKind.lamp, base);
    // Each pool lies under its lamp's head, a metre out over the road edge.
    fill(pools.current, byKind.lamp, base, 0.05, (item) => [Math.sin(item.yaw) * 0.9, Math.cos(item.yaw) * 0.9]);
    fill(trunks.current, byKind.tree, base);
    fill(crowns.current, byKind.tree, base);
    const crownMesh = crowns.current;
    if (crownMesh) {
      byKind.tree.forEach((_, index) => crownMesh.setColorAt(index, tint.set(CROWNS[index % CROWNS.length])));
      if (crownMesh.instanceColor) crownMesh.instanceColor.needsUpdate = true;
    }
    fill(benches.current, byKind.bench, base);
    fill(bins.current, byKind.bin, base);
  }, [byKind, base]);

  const lit = night > 0.02;
  return (
    <>
      <instancedMesh ref={poles} args={[parts.pole, undefined, byKind.lamp.length]} castShadow={shadows}>
        <meshStandardMaterial color="#3d4441" roughness={0.6} metalness={0.3} flatShading />
      </instancedMesh>
      <instancedMesh ref={heads} args={[parts.head, undefined, byKind.lamp.length]}>
        <meshStandardMaterial color="#e9e4d6" emissive={LAMP_GLOW} emissiveIntensity={night * 2.4} roughness={0.5} />
      </instancedMesh>
      <instancedMesh ref={pools} args={[parts.pool, undefined, byKind.lamp.length]} visible={lit} renderOrder={1}>
        <meshBasicMaterial map={texture} transparent opacity={night * 0.55} blending={AdditiveBlending} depthWrite={false} fog={false} />
      </instancedMesh>
      <instancedMesh ref={trunks} args={[parts.trunk, undefined, byKind.tree.length]} castShadow={shadows}>
        <meshStandardMaterial color="#6b5440" roughness={0.9} flatShading />
      </instancedMesh>
      <instancedMesh ref={crowns} args={[parts.crown, undefined, byKind.tree.length]} castShadow={shadows} receiveShadow>
        <meshStandardMaterial roughness={0.88} flatShading />
      </instancedMesh>
      <instancedMesh ref={benches} args={[parts.bench, undefined, byKind.bench.length]} castShadow={shadows}>
        <meshStandardMaterial color="#8b6a4a" roughness={0.85} flatShading />
      </instancedMesh>
      <instancedMesh ref={bins} args={[parts.bin, undefined, byKind.bin.length]}>
        <meshStandardMaterial color="#3e4a46" roughness={0.7} flatShading />
      </instancedMesh>
    </>
  );
}

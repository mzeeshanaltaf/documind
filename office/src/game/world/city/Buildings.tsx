import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  BoxGeometry,
  Color,
  InstancedBufferAttribute,
  type InstancedMesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
} from "three";
import { CITY, type CityBuilding, type CityLayout, windowsOf } from "./generator";
import { mixHex } from "./lighting";

/**
 * The blocks' buildings and the skyline as instanced meshes: bodies (palette colours), roof
 * caps, ground-floor shopfronts and facade windows. Windows and shopfronts light up at night
 * through an instanced `aLit` attribute folded into the material's emissive term.
 */

// No environment map, so glass stays non-metallic: light by day, dark once the ambient drops.
const WINDOW_GLASS = "#7d919b";
const SHOPFRONT = "#5d6a70";
/** Shared by the lit materials; only one city is mounted at a time. */
const NIGHT = { uNight: { value: 0 } };
const LIT = "vec3(1.0, 0.78, 0.46)";

/** A standard material whose instances glow by `aLit × uNight × strength`. */
function litMaterial(color: string, uniforms: { uNight: { value: number } }, strength: number) {
  const material = new MeshStandardMaterial({ color, roughness: 0.32, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = uniforms.uNight;
    shader.vertexShader = `attribute float aLit;\nvarying float vLit;\n${shader.vertexShader}`.replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\nvLit = aLit;",
    );
    shader.fragmentShader = `uniform float uNight;\nvarying float vLit;\n${shader.fragmentShader}`.replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>\ntotalEmissiveRadiance += ${LIT} * vLit * uNight * ${strength.toFixed(2)};`,
    );
  };
  material.customProgramCacheKey = () => `city-lit-${strength}`;
  return material;
}

const dummy = new Object3D();
const tint = new Color();

type Built = {
  bodies: { geometry: BoxGeometry; items: CityBuilding[] };
  skyline: { geometry: BoxGeometry; items: CityBuilding[] };
  roofs: { geometry: BoxGeometry; count: number };
  shops: { geometry: BoxGeometry; count: number };
  windows: { geometry: PlaneGeometry; count: number; data: ReturnType<typeof windowsOf> };
};

function build(layout: CityLayout): Built {
  const unitBox = () => new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const windows = [...layout.buildings, ...layout.skyline].flatMap((building) => windowsOf(building, layout.seed));
  const shopsGeometry = unitBox();
  const shopLit = new Float32Array(layout.buildings.length);
  layout.buildings.forEach((building, index) => {
    shopLit[index] = (index * 7919) % 5 === 0 ? 0 : 0.8;
  });
  shopsGeometry.setAttribute("aLit", new InstancedBufferAttribute(shopLit, 1));
  const windowGeometry = new PlaneGeometry(1.25, 1.55);
  windowGeometry.setAttribute("aLit", new InstancedBufferAttribute(Float32Array.from(windows, (w) => w.lit), 1));
  return {
    bodies: { geometry: unitBox(), items: layout.buildings },
    skyline: { geometry: unitBox(), items: layout.skyline },
    roofs: { geometry: unitBox(), count: layout.buildings.length + layout.skyline.length },
    shops: { geometry: shopsGeometry, count: layout.buildings.length },
    windows: { geometry: windowGeometry, count: windows.length, data: windows },
  };
}

export function Buildings({ layout, night }: { layout: CityLayout; night: number }) {
  const built = useMemo(() => build(layout), [layout]);
  const materials = useMemo(() => ({ windows: litMaterial(WINDOW_GLASS, NIGHT, 1.05), shops: litMaterial(SHOPFRONT, NIGHT, 0.26) }), []);
  useEffect(() => {
    NIGHT.uNight.value = night;
  }, [night]);
  useEffect(
    () => () => {
      for (const part of Object.values(built)) part.geometry.dispose();
    },
    [built],
  );
  useEffect(() => () => Object.values(materials).forEach((material) => material.dispose()), [materials]);

  const bodies = useRef<InstancedMesh>(null);
  const skyline = useRef<InstancedMesh>(null);
  const roofs = useRef<InstancedMesh>(null);
  const shops = useRef<InstancedMesh>(null);
  const windows = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    const curb = CITY.curb;
    const fill = (mesh: InstancedMesh | null, items: CityBuilding[], skylineTone: boolean) => {
      if (!mesh) return;
      items.forEach((building, index) => {
        const { rect, height } = building;
        dummy.position.set(rect.x, skylineTone ? 0 : curb, rect.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(rect.w, height, rect.d);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
        mesh.setColorAt(index, tint.set(skylineTone ? mixHex(building.color, "#9aa3a6", 0.35) : building.color));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    };
    fill(bodies.current, layout.buildings, false);
    fill(skyline.current, layout.skyline, true);

    const roofMesh = roofs.current;
    if (roofMesh) {
      [...layout.buildings, ...layout.skyline].forEach((building, index) => {
        const { rect, height } = building;
        const base = index < layout.buildings.length ? curb : 0;
        dummy.position.set(rect.x, base + height, rect.z);
        dummy.scale.set(rect.w + 0.3, 0.55, rect.d + 0.3);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        roofMesh.setMatrixAt(index, dummy.matrix);
        roofMesh.setColorAt(index, tint.set(mixHex(building.color, "#5c5f5a", 0.45)));
      });
      roofMesh.instanceMatrix.needsUpdate = true;
      if (roofMesh.instanceColor) roofMesh.instanceColor.needsUpdate = true;
      roofMesh.computeBoundingSphere();
    }

    const shopMesh = shops.current;
    if (shopMesh) {
      layout.buildings.forEach((building, index) => {
        const { rect } = building;
        dummy.position.set(rect.x, curb + 0.35, rect.z);
        dummy.scale.set(rect.w + 0.08, 2.9, rect.d + 0.08);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        shopMesh.setMatrixAt(index, dummy.matrix);
      });
      shopMesh.instanceMatrix.needsUpdate = true;
      shopMesh.computeBoundingSphere();
    }

    const windowMesh = windows.current;
    if (windowMesh) {
      built.windows.data.forEach((item, index) => {
        dummy.position.set(item.x, item.y, item.z);
        dummy.rotation.set(0, item.yaw, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        windowMesh.setMatrixAt(index, dummy.matrix);
      });
      windowMesh.instanceMatrix.needsUpdate = true;
      windowMesh.computeBoundingSphere();
    }
  }, [layout, built]);

  return (
    <>
      <instancedMesh ref={bodies} args={[built.bodies.geometry, undefined, built.bodies.items.length]} castShadow receiveShadow>
        <meshStandardMaterial roughness={0.92} flatShading />
      </instancedMesh>
      <instancedMesh ref={skyline} args={[built.skyline.geometry, undefined, built.skyline.items.length]}>
        <meshStandardMaterial roughness={0.95} flatShading />
      </instancedMesh>
      <instancedMesh ref={roofs} args={[built.roofs.geometry, undefined, built.roofs.count]} castShadow>
        <meshStandardMaterial roughness={0.9} flatShading />
      </instancedMesh>
      <instancedMesh ref={shops} args={[built.shops.geometry, materials.shops, built.shops.count]} receiveShadow />
      <instancedMesh ref={windows} args={[built.windows.geometry, materials.windows, built.windows.count]} />
    </>
  );
}

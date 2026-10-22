import { type ThreeEvent, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { type Group, Quaternion, Vector3 } from "three";
import { latLonToVector } from "./geo";
import { useGlobe } from "./globe-store";
import type { GlobeTheme } from "./globe-theme";
import type { RigPin } from "./GlobeRig";

/** A press that moved further than this (px) was a drag, not a click. */
export const CLICK_SLOP = 6;
const RAISE = 0.04;
const UP = new Vector3(0, 1, 0);

/** One pin per office: a stem and a head standing on the surface; HQ's head is larger. */
export function Pins({ pins, theme, onChoose }: { pins: RigPin[]; theme: GlobeTheme; onChoose: (id: string) => void }) {
  return (
    <>
      {pins.map((pin) => (
        <Pin key={pin.id} pin={pin} theme={theme} onChoose={onChoose} />
      ))}
    </>
  );
}

function Pin({ pin, theme, onChoose }: { pin: RigPin; theme: GlobeTheme; onChoose: (id: string) => void }) {
  const lift = useRef<Group>(null);
  const placement = useMemo(() => {
    const position = new Vector3(...latLonToVector(pin.lat, pin.lon, 1.006));
    const quaternion = new Quaternion().setFromUnitVectors(UP, position.clone().normalize());
    return { position, quaternion };
  }, [pin.lat, pin.lon]);
  const head = pin.hq ? 0.03 : 0.022;

  // Hovered (from the list or the pointer) or chosen: rise and grow, eased.
  useFrame((state, delta) => {
    const group = lift.current;
    if (!group) return;
    const { hovered, selected } = useGlobe.getState();
    const active = hovered === pin.id || selected === pin.id;
    const k = 1 - Math.exp(-Math.min(delta, 0.1) * 12);
    const y = group.position.y + ((active ? RAISE : 0) - group.position.y) * k;
    const scale = group.scale.x + ((active ? 1.3 : 1) - group.scale.x) * k;
    group.position.y = y;
    group.scale.setScalar(scale);
    if (Math.abs((active ? RAISE : 0) - y) > 1e-4) state.invalidate();
  });

  const over = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    document.body.style.cursor = "pointer";
    useGlobe.getState().hover(pin.id, "globe");
  };
  const out = () => {
    document.body.style.cursor = "";
    useGlobe.getState().hover(null, "globe");
  };
  const click = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (event.delta > CLICK_SLOP) return;
    document.body.style.cursor = "";
    onChoose(pin.id);
  };

  return (
    <group position={placement.position} quaternion={placement.quaternion}>
      <group ref={lift}>
        <mesh position={[0, 0.035, 0]}>
          <cylinderGeometry args={[0.0045, 0.0045, 0.07, 6]} />
          <meshStandardMaterial color={theme.stem} roughness={0.8} />
        </mesh>
        <mesh position={[0, 0.07 + head * 0.6, 0]}>
          <icosahedronGeometry args={[head, 1]} />
          <meshStandardMaterial color={theme.pin} flatShading roughness={0.6} />
        </mesh>
        {/* A larger invisible target, so the small pin is easy to hover and click. */}
        <mesh position={[0, 0.06, 0]} onPointerOver={over} onPointerOut={out} onClick={click}>
          <sphereGeometry args={[0.065, 8, 6]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>
    </group>
  );
}

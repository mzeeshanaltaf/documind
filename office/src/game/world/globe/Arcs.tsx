import { Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { type ComponentRef, useMemo, useRef } from "react";
import { greatCircleArc, latLonToVector, toSegments } from "./geo";
import type { RigPin } from "./GlobeRig";

/**
 * Faint dashed arcs from HQ to every other office: one LineSegments2 (instanced segments, one
 * draw call). The dashes drift outwards from HQ unless the globe is static.
 */
export function Arcs({ pins, color, animate }: { pins: RigPin[]; color: string; animate: boolean }) {
  const line = useRef<ComponentRef<typeof Line>>(null);
  const segments = useMemo(() => {
    const hq = pins.find((pin) => pin.hq);
    if (!hq) return [];
    const from = latLonToVector(hq.lat, hq.lon, 1.01);
    return pins
      .filter((pin) => pin !== hq)
      .flatMap((pin) => toSegments(greatCircleArc(from, latLonToVector(pin.lat, pin.lon, 1.01), 48, 0.18)));
  }, [pins]);

  useFrame((_, delta) => {
    if (animate && line.current) line.current.material.dashOffset -= Math.min(delta, 0.1) * 0.06;
  });

  if (segments.length === 0) return null;
  return (
    <Line
      ref={line}
      points={segments}
      segments
      color={color}
      lineWidth={1.25}
      dashed
      dashSize={0.035}
      gapSize={0.025}
      transparent
      opacity={0.55}
      depthWrite={false}
    />
  );
}

import { Canvas } from "@react-three/fiber";
import { useTheme } from "next-themes";
import { Suspense, useEffect, useMemo, useState } from "react";
import { previewMotion } from "@/game/engine/preview";
import { PreviewBoundary } from "@/game/engine/PreviewBoundary";
import { TIERS } from "@/game/engine/quality";
import type { Location } from "@/lib/locations";
import type { Player } from "@/lib/player";
import { Arcs } from "./Arcs";
import { Earth } from "./Earth";
import { GlobeLabels } from "./GlobeLabels";
import { GlobeRig, type RigPin } from "./GlobeRig";
import { useGlobe } from "./globe-store";
import { GLOBE_THEMES } from "./globe-theme";
import { Pins } from "./Pins";
import { WorldwideRing } from "./WorldwideRing";

export type GlobeProps = {
  locations: Location[];
  /** The location to face first (the last visit), if it's on the globe. */
  initialFocus: string | null;
  player: Pick<Player, "settings" | "updatedAt">;
  onChoose: (id: string) => void;
};

/** Icosphere subdivision per tier: ~2.4k, ~5.8k and ~8.8k triangles. */
const DETAIL = { low: 10, medium: 16, high: 20 } as const;

/**
 * The location picker's globe, loaded with `ssr: false` (WebGL, matchMedia, localStorage). Low
 * tier and reduced motion render on demand, so a still globe costs nothing between interactions.
 */
export default function GlobeCanvas(props: GlobeProps) {
  return (
    <PreviewBoundary>
      <Globe {...props} />
    </PreviewBoundary>
  );
}

function Globe({ locations, initialFocus, player, onChoose }: GlobeProps) {
  const [motion] = useState(() => previewMotion(player));
  const { resolvedTheme } = useTheme();
  const theme = GLOBE_THEMES[resolvedTheme === "dark" ? "dark" : "light"];
  const tier = TIERS[motion.tier];
  // Turning by itself and drifting dashes: not on the low tier, never with reduced motion.
  const animate = !motion.reduced && motion.tier !== "low";

  const pinned = useMemo(
    () =>
      locations.filter(
        (location): location is Location & { lat: number; lon: number } =>
          location.role !== "hub" && location.lat !== null && location.lon !== null,
      ),
    [locations],
  );
  const pins = useMemo<RigPin[]>(
    () => pinned.map((location) => ({ id: location.id, lat: location.lat, lon: location.lon, hq: location.role === "hq" })),
    [pinned],
  );

  useEffect(() => () => useGlobe.getState().setReady(false), []);

  return (
    <div className="absolute inset-0">
      <Canvas
        // No tone mapping: the globe uses the brand's flat colours, and ACES would wash out the
        // pale land against the pale sea.
        flat
        frameloop={animate ? "always" : "demand"}
        dpr={[1, tier.dpr]}
        gl={{ antialias: tier.antialias, alpha: true, powerPreference: "low-power" }}
        camera={{ fov: 32, near: 0.1, far: 50, position: [0, 0, 5] }}
        // Vertical swipes still scroll the page on touch screens; horizontal ones turn the globe.
        style={{ touchAction: "pan-y" }}
        onCreated={() => useGlobe.getState().setReady(true)}
      >
        <hemisphereLight args={[theme.hemisphere[0], theme.hemisphere[1], 1.35]} />
        <directionalLight position={[-3, 2.5, 4]} intensity={1.25} color="#fff8ee" />
        <Suspense fallback={null}>
          <GlobeRig pins={pins} initialFocus={initialFocus} animate={animate} reduced={motion.reduced}>
            <Earth detail={DETAIL[motion.tier]} theme={theme} />
            <Pins pins={pins} theme={theme} onChoose={onChoose} />
            {!motion.reduced && <Arcs pins={pins} color={theme.arc} animate={animate} />}
          </GlobeRig>
          <WorldwideRing color={theme.ring} animate={animate} onChoose={onChoose} />
        </Suspense>
      </Canvas>
      <GlobeLabels locations={pinned} onChoose={onChoose} />
    </div>
  );
}

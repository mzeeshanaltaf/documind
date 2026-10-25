import { AdaptiveDpr, PerformanceMonitor } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { lazy, Suspense, useEffect, useState } from "react";
import { ACESFilmicToneMapping, SRGBColorSpace, type WebGLRenderer } from "three";
import { selectTier, useGame } from "@/game/store/game-store";
import { stepTier, TIERS } from "./quality";
import { QualityApplier } from "./QualityApplier";
import { SceneManager } from "./SceneManager";

const PostFx = lazy(() => import("./PostFx"));

/** Set when the canvas is created; read by the dev handle (`window.__office`). */
export const renderer: { gl: WebGLRenderer | null } = { gl: null };

function onDecline() {
  const { quality, setAutoTier } = useGame.getState();
  if (!quality.settled) setAutoTier(stepTier(quality.auto, -1));
}

function onIncline() {
  const { quality, setAutoTier } = useGame.getState();
  if (!quality.settled) setAutoTier(stepTier(quality.auto, 1));
}

/** Flip-flopping between two tiers: keep the lower one and stop adjusting. */
function onFallback() {
  const { quality, setAutoTier } = useGame.getState();
  setAutoTier(stepTier(quality.auto, -1), true);
}

/**
 * Upper bound is 95% of the display's refresh rate, so a 60 Hz screen can still climb a tier;
 * below 50 fps (or 80% of a slower display's rate) it steps down.
 */
const bounds = (refreshRate: number): [number, number] => [Math.min(50, refreshRate * 0.8), refreshRate * 0.95];

export function GameCanvas() {
  const tier = TIERS[useGame(selectTier)];
  // Antialiasing is fixed when the WebGL context is created.
  const [antialias] = useState(() => tier.antialias);

  // A mini-game (O8) covers the screen, so the world stops drawing once the camera has settled on
  // its station (about a second): the game gets the whole frame budget, e.g. Sort & Toss on a
  // low-end laptop. It resumes the moment the game closes.
  const inGame = useGame((s) => s.modal?.type === "game");
  const [frozen, setFrozen] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setFrozen(inGame), inGame ? 1100 : 0);
    return () => window.clearTimeout(timer);
  }, [inGame]);

  return (
    <Canvas
      className="touch-none"
      frameloop={frozen ? "never" : "always"}
      // PCF: three r186 removed PCFSoftShadowMap (R3F's "soft").
      shadows={tier.shadows ? "percentage" : false}
      dpr={[1, tier.dpr]}
      gl={{ antialias, powerPreference: "high-performance" }}
      camera={{ fov: 50, near: 0.1, far: 400, position: [0, 3, 6] }}
      onCreated={({ gl }) => {
        gl.outputColorSpace = SRGBColorSpace;
        gl.toneMapping = ACESFilmicToneMapping;
        gl.toneMappingExposure = 1;
        renderer.gl = gl;
      }}
    >
      <PerformanceMonitor bounds={bounds} flipflops={3} onDecline={onDecline} onIncline={onIncline} onFallback={onFallback} />
      <AdaptiveDpr pixelated />
      <QualityApplier />
      <SceneManager />
      {tier.post && (
        <Suspense fallback={null}>
          <PostFx />
        </Suspense>
      )}
    </Canvas>
  );
}

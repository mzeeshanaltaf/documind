"use client";

import { useProgress } from "@react-three/drei";
import { useEffect, useState } from "react";
import { LogoMark } from "@/components/brand/logo";
import { cn } from "@/lib/utils";
import { selectReducedMotion, type SceneId, useGame } from "@/game/store/game-store";

const TIPS = [
  "Press J for your journal.",
  "Hold Shift to run.",
  "Press E to talk, sit or open doors.",
  "Left-drag to look around, and scroll to zoom.",
  "Press Esc for settings and controls.",
];

const SCENE_LABELS: Record<SceneId, string> = {
  sandbox: "the sandbox",
  city: "the city",
  office: "the office",
  rooftop: "the rooftop",
};

/** Curtain fade, matching the CSS duration below. */
const FADE_MS = 260;

/**
 * The transition curtain and loading screen (DOM, over the canvas). It fades in, the scene swaps
 * behind it while it's opaque, and it fades out once the new scene has mounted. Reduced motion
 * cuts instead of fading.
 */
export function Loading() {
  const phase = useGame((s) => s.world.phase);
  const scene = useGame((s) => s.world.scene);
  const reduced = useGame(selectReducedMotion);
  const { active, progress, total } = useProgress();
  const [tip, setTip] = useState(0);

  // The curtain's own timing drives the transition, so it never waits on a transitionend event
  // that a hidden tab or a zero-length transition would never send.
  useEffect(() => {
    if (phase !== "out" && phase !== "in") return;
    const { swapScene, transitionDone } = useGame.getState();
    const timer = window.setTimeout(phase === "out" ? swapScene : transitionDone, reduced ? 0 : FADE_MS);
    return () => window.clearTimeout(timer);
  }, [phase, reduced]);

  useEffect(() => {
    if (phase !== "loading") return;
    const timer = window.setInterval(() => setTip((i) => (i + 1) % TIPS.length), 4500);
    return () => window.clearInterval(timer);
  }, [phase]);

  const covering = phase === "loading" || phase === "out";
  const loading = phase === "loading";
  const percent = total > 0 ? Math.round(progress) : null;

  return (
    <div
      aria-hidden={!loading}
      className={cn(
        "fixed inset-0 z-30 flex items-center justify-center bg-background transition-opacity duration-[260ms] ease-out-quart",
        covering ? "opacity-100" : "pointer-events-none opacity-0",
        phase === "ready" && "invisible",
      )}
    >
      {loading && (
        <div className="flex w-full max-w-xs animate-in flex-col items-center gap-5 px-6 text-center delay-150 duration-200 fill-mode-both fade-in-0">
          <LogoMark className="size-10" />
          <div role="status" className="flex w-full flex-col gap-2">
            <p className="text-sm font-medium">Loading {SCENE_LABELS[scene]}</p>
            <div
              className="relative h-1 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label="Loading progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent ?? undefined}
            >
              <div
                className={cn(
                  "h-full rounded-full bg-primary transition-[width] duration-200",
                  percent === null && "w-1/3 motion-safe:animate-pulse",
                )}
                style={percent === null ? undefined : { width: `${Math.max(4, percent)}%` }}
              />
            </div>
            <p className="font-mono text-[0.7rem] text-muted-foreground tabular-nums">
              {percent === null ? (active ? "Preparing" : "Starting physics") : `${percent}%`}
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Tip:</span> {TIPS[tip]}
          </p>
        </div>
      )}
    </div>
  );
}

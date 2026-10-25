import { useEffect, useRef } from "react";

/**
 * Calls `callback(dt, now)` every animation frame while `active`, with `dt` in seconds and capped
 * at 50 ms (a tab that was hidden resumes without a jump). The latest callback is always the one
 * called, so it can read fresh props without restarting the loop.
 */
export function useAnimationFrame(callback: (dt: number, now: number) => void, active = true) {
  const latest = useRef(callback);
  useEffect(() => {
    latest.current = callback;
  });

  useEffect(() => {
    if (!active) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      latest.current(dt, now);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active]);
}

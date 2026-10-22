"use client";

import { useEffect, useRef, useState } from "react";
import { selectReducedMotion, useGame } from "@/game/store/game-store";
import { type Arrival, arrivalLines } from "@/lib/format";
import { cn } from "@/lib/utils";

const SHOW_MS = 4000;

/**
 * "Lahore · 7:42 pm local time · Simtora R&D centre": shown once when the street first comes
 * into view (after any first-visit dialog), then it fades away. Announced politely.
 */
export function ArrivalBanner() {
  const reduced = useGame(selectReducedMotion);
  const [arrival, setArrival] = useState<Arrival | null>(null);
  const [visible, setVisible] = useState(false);
  const shown = useRef(false);

  // The game always mounts loading, so the first ready street arrives through the subscription.
  useEffect(
    () =>
      useGame.subscribe((state) => {
        const arriving = state.world.scene === "city" && state.world.phase === "ready" && state.modal === null;
        if (!arriving || shown.current || !state.office) return;
        shown.current = true;
        setArrival(arrivalLines(state.office.place, state.office.org.name, Date.now()));
        setVisible(true);
      }),
    [],
  );

  useEffect(() => {
    if (!visible) return;
    const timer = window.setTimeout(() => setVisible(false), SHOW_MS);
    return () => window.clearTimeout(timer);
  }, [visible]);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-16 z-10 flex justify-center px-4 sm:top-5">
      <p
        role="status"
        className={cn(
          "max-w-full rounded-lg bg-background/92 px-4 py-2 text-center text-sm text-muted-foreground shadow-sm ring-1 ring-foreground/10",
          !reduced && "transition-opacity duration-500 ease-out-quart",
          visible ? "opacity-100" : "opacity-0",
          !arrival && "invisible",
        )}
      >
        {arrival && (
          <>
            <span className="font-heading text-base font-semibold text-foreground">{arrival.title}</span>
            {arrival.details.map((detail) => (
              <span key={detail}>
                <span aria-hidden> · </span>
                <span className="sr-only">, </span>
                {detail}
              </span>
            ))}
          </>
        )}
      </p>
    </div>
  );
}

"use client";

import { FlagIcon, TrophyIcon } from "lucide-react";
import { useEffect } from "react";
import { selectReducedMotion, useGame } from "@/game/store/game-store";
import { cn } from "@/lib/utils";

const SHOW_MS = 4200;

/**
 * "Quest complete: Meet the experts" and "Achievement unlocked: Night owl" (phase O9 › Toasts).
 * One at a time, in the order they were earned; several at once queue up. The region is always
 * mounted so screen readers announce each notice politely.
 */
export function QuestToasts() {
  const toast = useGame((s) => s.toasts[0] ?? null);
  const waiting = useGame((s) => Math.max(0, s.toasts.length - 1));
  const reduced = useGame(selectReducedMotion);
  const id = toast?.id ?? null;

  useEffect(() => {
    if (id === null) return;
    const timer = window.setTimeout(() => useGame.getState().dismissToast(id), SHOW_MS);
    return () => window.clearTimeout(timer);
  }, [id]);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-28 z-20 flex justify-center px-4 sm:top-16" role="status" aria-live="polite">
      {toast && (
        <p
          key={toast.id}
          data-toast={toast.kind}
          className={cn(
            "flex max-w-full items-center gap-3 rounded-xl bg-popover px-4 py-2.5 text-popover-foreground shadow-lg ring-1 ring-foreground/10",
            !reduced && "animate-in fade-in-0 slide-in-from-top-2 duration-300",
          )}
        >
          <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            {toast.kind === "quest" ? <FlagIcon className="size-4" /> : <TrophyIcon className="size-4" />}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {toast.text}
              {waiting > 0 && <span className="normal-case"> · {waiting} more</span>}
            </span>
            <span className="truncate font-heading text-base leading-tight font-semibold">{toast.title}</span>
          </span>
        </p>
      )}
    </div>
  );
}

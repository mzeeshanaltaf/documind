"use client";

import { LockIcon } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";
import { interactWithFocus } from "@/game/interact/interact";
import { useGame } from "@/game/store/game-store";
import { cn } from "@/lib/utils";

/**
 * "E · Talk to Hina" at the bottom centre. It's also a button, so a click or tap does the same as
 * E. A locked interactable shows a lock and the reason; pressing E on it nudges the prompt.
 */
export function InteractionPrompt() {
  const focus = useGame((s) => s.focus);
  const deniedAt = useGame((s) => s.deniedAt);
  const hidden = useGame((s) => s.modal !== null);

  const announcement = focus ? (focus.locked ? `${focus.label}: locked. ${focus.reason}.` : `${focus.label}: press E.`) : "";

  return (
    <>
      <p className="sr-only" aria-live="polite">
        {hidden ? "" : announcement}
      </p>
      {focus && !hidden && (
        <button
          // Re-keyed on a denied press so the nudge animation replays.
          key={`${focus.id}:${deniedAt}`}
          type="button"
          onClick={() => interactWithFocus()}
          aria-label={focus.locked ? `${focus.label}, locked: ${focus.reason}` : focus.label}
          className={cn(
            "pointer-events-auto flex max-w-[min(28rem,calc(100vw-2rem))] animate-in items-center gap-2.5 rounded-lg bg-background/95 py-2 pr-3.5 pl-2 text-sm shadow-md ring-1 ring-foreground/10 duration-150 fade-in-0 slide-in-from-bottom-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            deniedAt > 0 && focus.locked && "hud-nudge",
          )}
        >
          {focus.locked ? (
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <LockIcon className="size-3.5" aria-hidden />
            </span>
          ) : (
            <Kbd className="h-6 min-w-6 bg-primary text-[0.8rem] text-primary-foreground">E</Kbd>
          )}
          <span className="truncate font-medium">{focus.label}</span>
          {focus.locked && <span className="truncate text-muted-foreground">{focus.reason}</span>}
        </button>
      )}
    </>
  );
}

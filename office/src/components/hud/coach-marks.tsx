"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { audio } from "@/game/audio/audio";
import { useGame } from "@/game/store/game-store";
import { cn } from "@/lib/utils";

const STEPS = [
  {
    title: "Move",
    keys: (
      <>
        <Kbd>W</Kbd> <Kbd>A</Kbd> <Kbd>S</Kbd> <Kbd>D</Kbd> or the arrow keys to walk, <Kbd>Shift</Kbd> to run. Drag with the right mouse button to look around.
      </>
    ),
    touch: "Drag the stick on the left to walk; push it all the way to run. Drag the view to look around.",
  },
  {
    title: "Interact",
    keys: (
      <>
        Walk up to a person or an object and press <Kbd>E</Kbd>. The prompt at the bottom tells you what it does.
      </>
    ),
    touch: "Walk up to a person or an object and tap the hand button on the right.",
  },
  {
    title: "Journal",
    keys: (
      <>
        Press <Kbd>J</Kbd> for your quests and achievements. Finish the core ones to open the rooftop.
      </>
    ),
    touch: "Your quests and achievements are in the journal. Finish the core ones to open the rooftop.",
  },
] as const;

/**
 * The three-step coach marks on a first visit (phase O9 › UI): move, interact, journal. A card
 * over the world, not a dialog, so the player can try each thing as they read about it. It waits
 * for the first look editor and any other dialog to close; dismissing it (Skip, or finishing)
 * is stored in `players.settings` and it never comes back.
 */
export function CoachMarks() {
  const [step, setStep] = useState(0);
  const visible = useGame((s) => s.office !== null && !s.settings.coach_done && s.world.phase === "ready" && s.modal === null);
  if (!visible) return null;

  const current = STEPS[step];
  const last = step === STEPS.length - 1;
  const dismiss = () => {
    audio.play("ui-close", { volume: 0.4 });
    useGame.getState().updateSettings({ coach_done: true });
  };

  return (
    <section
      aria-labelledby="coach-title"
      data-coach={step}
      className="pointer-events-auto fixed bottom-24 left-1/2 z-10 flex w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-3 rounded-xl bg-popover p-4 text-popover-foreground shadow-lg ring-1 ring-foreground/10 pointer-coarse:bottom-44"
    >
      <header className="flex items-baseline justify-between gap-3">
        <h2 id="coach-title" className="font-heading text-lg font-semibold">
          {current.title}
        </h2>
        <p className="font-mono text-xs text-muted-foreground tabular-nums">
          {step + 1} / {STEPS.length}
        </p>
      </header>
      <p className="text-sm leading-relaxed pointer-coarse:hidden">{current.keys}</p>
      <p className="hidden text-sm leading-relaxed pointer-coarse:block">{current.touch}</p>
      <footer className="flex items-center justify-between gap-3">
        <div aria-hidden className="flex gap-1.5">
          {STEPS.map((item, index) => (
            <span key={item.title} className={cn("size-1.5 rounded-full", index === step ? "bg-primary" : "bg-foreground/20")} />
          ))}
        </div>
        <div className="flex gap-2">
          {!last && (
            <Button size="sm" variant="ghost" onClick={dismiss}>
              Skip
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => {
              audio.play("ui-click", { volume: 0.5 });
              if (last) dismiss();
              else setStep(step + 1);
            }}
          >
            {last ? "Got it" : "Next"}
          </Button>
        </div>
      </footer>
    </section>
  );
}
